import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, runTransaction, doc, getDoc, setDoc, writeBatch, serverTimestamp, terminate } from 'firebase/firestore';
import { commitScanAttemptTransaction, runScanAttemptWithContentionRetry, scanTrackingKey } from '../src/services/scanAttempts.js';


test('physical scan transactions and rules hold across real concurrent clients', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
const emulatorUrl = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`);
const projectId = 'demo-scan-duplicate-verification';
const clients = ['operator-one', 'operator-two', 'outsider'].map((uid, index) => {
  const app = initializeApp({ projectId, apiKey: 'emulator-only' }, `duplicate-verification-${index}`);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, emulatorUrl.hostname, Number(emulatorUrl.port), { mockUserToken: { sub: uid, user_id: uid, operator: index < 2 } });
  return { app, db, uid };
});
let passed = 0;
async function check(name, callback) {
  await callback();
  passed += 1;
  console.log(`PASS ${name}`);
}
const tracking = `TH${Date.now()}01`;
const key = scanTrackingKey(tracking);
const canonicalId = `tracking_${key}`;
function attempt(client, id, role = 'admin', courier = 'Flash', date = '2026-11-22') {
  return { id, role, tracking, courier, date, actorUid: client.uid, source: 'keyboard' };
}
async function commit(client, event) {
  const eventTracking = event.tracking;
  const eventKey = scanTrackingKey(eventTracking);
  return runScanAttemptWithContentionRetry({ commit: onReadOrder => runTransaction(client.db, transaction => commitScanAttemptTransaction({
    transaction, attempt: event, onReadOrder,
    pointerRef: doc(client.db, 'scanTrackingPointers', eventKey),
    receiptRef: doc(client.db, 'scanAttemptReceipts', event.id),
    orderRef: id => doc(client.db, 'orders', id),
    timestamp: serverTimestamp(),
    makeOrder(existing) {
      const field = event.role === 'admin' ? 'admin' : 'packerScan';
      return {
        ...(existing ?? { code: eventTracking, normalizedCode: eventTracking, courier: event.courier, date: event.date, status: 'pending', sheetSyncStatus: 'pending' }),
        [field]: existing?.[field]?.scannedAt ? existing[field] : { scannedAt: `${event.date}T10:00:00` },
      };
    },
  })), readCurrentRevision: async () => {
    const pointer = await getDoc(doc(client.db, 'scanTrackingPointers', eventKey));
    if (!pointer.exists()) return 0;
    const snap = await getDoc(doc(client.db, 'orders', pointer.data().orderId));
    return snap.data()?.scanCountRevision ?? 0;
  } });
}
async function order() { return (await getDoc(doc(clients[0].db, 'orders', canonicalId))).data(); }
async function denied(callback) { await assert.rejects(callback, error => error.code === 'permission-denied'); }
try {
  const first = attempt(clients[0], `first-${Date.now()}`);
  await check('first counted scan commits order, pointer and receipt atomically', async () => {
    const result = await commit(clients[0], first);
    assert.equal(result.id, canonicalId);
    assert.equal((await order()).scanTotalAdmin, 1);
    assert.equal((await order()).scanTotalPacker, 0);
    assert.equal((await order()).scanCountRevision, 1);
  });
  await check('same receipt replay never increments count', async () => {
    await commit(clients[0], first);
    await commit(clients[0], first);
    assert.equal((await order()).scanTotalAdmin, 1);
  });
  await check('two real clients scanning simultaneously retain both increments', async () => {
    const a = attempt(clients[0], `parallel-a-${Date.now()}`);
    const b = attempt(clients[1], `parallel-b-${Date.now()}`, 'admin', 'Shopee', '2026-11-23');
    await Promise.all([commit(clients[0], a), commit(clients[1], b)]);
    const state = await order();
    assert.equal(state.scanTotalAdmin, 3);
    assert.equal(state.scanDuplicateAdmin, 2);
    assert.equal(state.scanCountRevision, 3);
    assert.equal(state.courier, 'Flash');
    assert.equal(state.date, '2026-11-22');
  });
  await check('Packer count remains independent and repeats produce both-side risk', async () => {
    await commit(clients[1], attempt(clients[1], `packer-a-${Date.now()}`, 'packer'));
    await commit(clients[1], attempt(clients[1], `packer-b-${Date.now()}`, 'packer'));
    assert.equal((await order()).scanTotalAdmin, 3);
    assert.equal((await order()).scanTotalPacker, 2);
    assert.equal((await order()).scanDuplicatePacker, 1);
  });
  await check('simultaneous first scans across courier and midnight share a single canonical order', async () => {
    const freshTracking = `${tracking}02`;
    const events = [
      { ...attempt(clients[0], `first-parallel-a-${Date.now()}`, 'admin', 'Flash', '2026-11-22'), tracking: freshTracking },
      { ...attempt(clients[1], `first-parallel-b-${Date.now()}`, 'packer', 'Shopee', '2026-11-23'), tracking: freshTracking },
    ];
    const results = await Promise.all([commit(clients[0], events[0]), commit(clients[1], events[1])]);
    assert.equal(results[0].id, results[1].id);
    const fresh = (await getDoc(doc(clients[0].db, 'orders', results[0].id))).data();
    assert.equal(fresh.scanTotalAdmin, 1);
    assert.equal(fresh.scanTotalPacker, 1);
    assert.equal(fresh.scanCountRevision, 2);
  });
  for (const [name, patch] of [
    ['negative total', { scanTotalAdmin: -1 }],
    ['fractional total', { scanTotalAdmin: 3.5 }],
    ['count reduction', { scanTotalAdmin: 2 }],
    ['count jump', { scanTotalAdmin: 99 }],
    ['revision jump', { scanCountRevision: 99 }],
    ['count deletion', null],
  ]) {
    await check(`rules reject ${name}`, async () => {
      if (patch) await denied(() => setDoc(doc(clients[0].db, 'orders', canonicalId), patch, { merge: true }));
      else {
        const state = await order();
        delete state.scanTotalAdmin;
        await denied(() => setDoc(doc(clients[0].db, 'orders', canonicalId), state));
      }
    });
  }
  await check('rules reject receipt mutation', async () => {
    await denied(() => setDoc(doc(clients[0].db, 'scanAttemptReceipts', first.id), { actorUid: clients[1].uid }, { merge: true }));
  });
  await check('rules reject pointer reassignment', async () => {
    await denied(() => setDoc(doc(clients[0].db, 'scanTrackingPointers', key), { tracking, orderId: 'another-order' }));
  });
  await check('rules reject unauthorised reader', async () => {
    await denied(() => getDoc(doc(clients[2].db, 'orders', canonicalId)));
  });
  await check('rules reject forged receipt actor even in otherwise consistent atomic batch', async () => {
    const db = clients[0].db;
    const state = await order();
    const event = attempt(clients[1], `forged-${Date.now()}`);
    const batch = writeBatch(db);
    batch.set(doc(db, 'orders', canonicalId), { ...state, scanTotalAdmin: 4, scanDuplicateAdmin: 3, scanCountRevision: 6, scanLastAttemptId: event.id });
    batch.set(doc(db, 'scanAttemptReceipts', event.id), { ...event, orderId: canonicalId, trackingKey: key, revision: 6, createdAt: serverTimestamp() });
    await denied(() => batch.commit());
  });
  console.log(`RESULT ${passed} checks passed against real Firestore emulator rules`);
} finally {
  for (const { db, app } of clients) { await terminate(db); await deleteApp(app); }
}

});
