import test from 'node:test';
import assert from 'node:assert/strict';

import { PACKER_UNASSIGNED } from '../constants.js';
import {
  REMOTE_CONTROL_TABS,
  REMOTE_ORIGIN_DESKTOP,
  REMOTE_ORIGIN_REMOTE,
  normalizeRemoteControlPayload,
  remoteControlDocId,
  remoteControlSignature,
  shouldApplyRemoteControlDoc,
  shouldWriteRemoteControl,
} from './remoteControlRules.js';

const COURIERS = ['Shopee', 'Flash', 'J&T'];
const PACKERS = [PACKER_UNASSIGNED, 'กิต', 'มาย'];

test('a signature cannot be forged by a name that contains the separator', () => {
  assert.notEqual(
    remoteControlSignature({ courier: 'A|B', packer: '' }),
    remoteControlSignature({ courier: 'A', packer: 'B' }),
  );
  assert.equal(
    remoteControlSignature({ courier: 'Flash', packer: 'กิต' }),
    remoteControlSignature({ courier: 'Flash', packer: 'กิต' }),
  );
});

test('a side ignores the echo of its own write', () => {
  const applied = shouldApplyRemoteControlDoc({
    data: { courier: 'Flash', packer: 'กิต', origin: REMOTE_ORIGIN_DESKTOP },
    myOrigin: REMOTE_ORIGIN_DESKTOP,
    knownCouriers: COURIERS,
    knownPackers: PACKERS,
  });
  assert.equal(applied, null);
});

test('a command from the other side is applied with both halves', () => {
  const applied = shouldApplyRemoteControlDoc({
    data: { courier: 'Flash', packer: 'กิต', origin: REMOTE_ORIGIN_REMOTE },
    myOrigin: REMOTE_ORIGIN_DESKTOP,
    knownCouriers: COURIERS,
    knownPackers: PACKERS,
  });
  assert.equal(applied.courier, 'Flash');
  assert.equal(applied.packer, 'กิต');
});

test('a courier this side has never heard of is refused so scanning cannot continue on a ghost state', () => {
  const applied = shouldApplyRemoteControlDoc({
    data: { courier: 'ขนส่งผี', packer: 'กิต', origin: REMOTE_ORIGIN_REMOTE },
    myOrigin: REMOTE_ORIGIN_DESKTOP,
    knownCouriers: COURIERS,
    knownPackers: PACKERS,
  });
  assert.equal(applied, null);
});

test('an unknown packer keeps the courier half instead of dropping the whole command', () => {
  // The packer list changes during the day, so one stale name must not cost the courier switch.
  const applied = shouldApplyRemoteControlDoc({
    data: { courier: 'J&T', packer: 'คนใหม่', origin: REMOTE_ORIGIN_REMOTE },
    myOrigin: REMOTE_ORIGIN_DESKTOP,
    knownCouriers: COURIERS,
    knownPackers: PACKERS,
  });
  assert.equal(applied.courier, 'J&T');
  assert.equal(applied.packer, null);
});

test('a snapshot identical to what was already applied is refused', () => {
  const signature = remoteControlSignature({ courier: 'Flash', packer: 'กิต' });
  const applied = shouldApplyRemoteControlDoc({
    data: { courier: 'Flash', packer: 'กิต', origin: REMOTE_ORIGIN_REMOTE },
    myOrigin: REMOTE_ORIGIN_DESKTOP,
    knownCouriers: COURIERS,
    knownPackers: PACKERS,
    lastAppliedSignature: signature,
  });
  assert.equal(applied, null);
});

test('a missing or malformed document is refused without throwing', () => {
  const cases = [undefined, null, {}, { courier: 'Flash' }, { origin: REMOTE_ORIGIN_REMOTE }, 'Flash'];
  for (const data of cases) {
    assert.equal(
      shouldApplyRemoteControlDoc({
        data,
        myOrigin: REMOTE_ORIGIN_DESKTOP,
        knownCouriers: COURIERS,
        knownPackers: PACKERS,
      }),
      null,
      `payload ${JSON.stringify(data)} must be refused`,
    );
  }
});

test('the desktop does not mirror back the selection it just received', () => {
  // This is what keeps the two sides from writing to each other forever.
  const received = { courier: 'Flash', packer: 'กิต' };
  const signature = remoteControlSignature(received);
  assert.equal(shouldWriteRemoteControl({ next: received, lastAppliedSignature: signature }), false);
  assert.equal(
    shouldWriteRemoteControl({ next: { courier: 'Shopee', packer: 'กิต' }, lastAppliedSignature: signature }),
    true,
  );
  assert.equal(shouldWriteRemoteControl({ next: { courier: '', packer: 'กิต' } }), false);
});

test('a payload is trimmed, capped and given a packer before it reaches the rules', () => {
  assert.deepEqual(
    normalizeRemoteControlPayload({ courier: '  Flash  ', packer: '   ' }),
    { courier: 'Flash', packer: PACKER_UNASSIGNED },
  );
  const long = normalizeRemoteControlPayload({ courier: 'x'.repeat(120), packer: 'y'.repeat(120) });
  assert.equal(long.courier.length, 80);
  assert.equal(long.packer.length, 80);
  assert.throws(() => normalizeRemoteControlPayload({ courier: '   ', packer: 'กิต' }), {
    code: 'REMOTE_CONTROL_COURIER_REQUIRED',
  });
});

test('each workspace has its own board and nothing else can name one', () => {
  // Packer and Drive share one selectedCourier on the desktop. A single board would have let
  // the packing room retarget the courier under an Admin receiving parcels into Drive.
  assert.deepEqual(REMOTE_CONTROL_TABS, ['packer', 'drive']);
  assert.equal(remoteControlDocId('packer'), 'packer');
  assert.equal(remoteControlDocId('drive'), 'drive');
  for (const tab of ['reports', 'staff', 'current', '', undefined, null, '../orders']) {
    assert.equal(remoteControlDocId(tab), null, `${tab} must not address a board`);
  }
});

test('the Drive board never carries a packer', () => {
  // Drive does not record one (requiresPacker is packer-mode only), but the rules demand a
  // non-empty string, so it is pinned to the unassigned marker instead of leaking a name.
  assert.deepEqual(
    normalizeRemoteControlPayload({ courier: 'Flash', packer: 'กิต', tab: 'drive' }),
    { courier: 'Flash', packer: PACKER_UNASSIGNED },
  );
  const applied = shouldApplyRemoteControlDoc({
    data: { courier: 'Flash', packer: 'กิต', origin: REMOTE_ORIGIN_REMOTE },
    tab: 'drive',
    myOrigin: REMOTE_ORIGIN_DESKTOP,
    knownCouriers: COURIERS,
    knownPackers: PACKERS,
  });
  assert.equal(applied.courier, 'Flash');
  assert.equal(applied.packer, null);
});
