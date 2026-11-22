import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicalScanOutbox } from './physicalScanOutbox.js';

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

const job = (id, actorUid = 'u1') => ({ id, code: 'TRACK1', context: { attempt: { id, actorUid, role: 'packer', tracking: 'TRACK1', date: '2026-11-22', courier: 'Flash', source: 'manual' } } });

test('reload restores identical attempts only for their captured actor and acknowledgement removes only that attempt', async () => {
  const local = storage();
  const first = createPhysicalScanOutbox(local);
  await first.add(job('one'));
  await first.add(job('two'));
  await first.add(job('other', 'u2'));
  const reloaded = createPhysicalScanOutbox(local);
  assert.deepEqual(reloaded.list('u1').map(item => item.id), ['one', 'two']);
  assert.equal(reloaded.list('u1')[0].context.attempt.id, 'one');
  await reloaded.acknowledge('one');
  assert.deepEqual(createPhysicalScanOutbox(local).list('u1').map(item => item.id), ['two']);
  assert.equal(reloaded.list('u2')[0].id, 'other');
});

test('rejects the 101st pending physical scan before persistence and preserves failed writes', async () => {
  const local = storage();
  const outbox = createPhysicalScanOutbox(local);
  for (let i = 0; i < 100; i += 1) await outbox.add(job(String(i)));
  await assert.rejects(async () => outbox.add(job('overflow')), { code: 'SCAN_OUTBOX_FULL' });
  assert.equal(createPhysicalScanOutbox(local).list('u1').length, 100);
  local.setItem = () => { throw new Error('quota'); };
  await assert.rejects(async () => outbox.acknowledge('0'), { code: 'SCAN_OUTBOX_WRITE_FAILED' });
  assert.equal(outbox.list('u1').length, 100);
});

test('corrupt storage and duplicate identities cannot silently replace a captured physical scan', async () => {
  const local = storage();
  const outbox = createPhysicalScanOutbox(local);
  await outbox.add(job('one'));
  await assert.rejects(async () => outbox.add(job('one', 'u2')), { code: 'SCAN_ATTEMPT_EXISTS' });
  assert.equal(outbox.list('u1').length, 1);
  assert.throws(() => createPhysicalScanOutbox({ getItem: () => '{', setItem() {} }).list('u1'), { code: 'SCAN_OUTBOX_READ_FAILED' });
});

test('another tab cannot persist or acknowledge until its shared storage lock is granted', async () => {
  const local = storage();
  let grant;
  const locks = { request: (_key, action) => new Promise(resolve => { grant = () => resolve(action()); }) };
  const first = createPhysicalScanOutbox(local, locks);
  const second = createPhysicalScanOutbox(local);
  const waiting = first.add(job('one'));
  await second.add(job('two'));
  assert.deepEqual(second.list('u1').map(item => item.id), ['two']);
  grant();
  await waiting;
  assert.deepEqual(second.list('u1').map(item => item.id), ['two', 'one']);
});

test('blocked localStorage getter produces a recoverable outbox error instead of crashing construction', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
  try {
    const outbox = createPhysicalScanOutbox();
    assert.throws(() => outbox.list('u1'), { code: 'SCAN_OUTBOX_READ_FAILED' });
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});
