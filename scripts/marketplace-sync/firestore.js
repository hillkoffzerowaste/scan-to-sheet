import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { marketplaceMetadata, orderDocumentId } from './normalize.js';

const MAX_BATCH_WRITES = 400;
// Firestore caps an `in` filter at 30 values.
const TRACKING_QUERY_CHUNK = 30;
// Orders one chunk of tracking numbers may match. A tracking number appears once per day it
// was scanned, so ten rows per number is far above the real ratio and still bounds the read.
const RECONCILE_MATCH_LIMIT = TRACKING_QUERY_CHUNK * 10;

const LEGACY_MARKETPLACE_FIRESTORE_ERROR =
  'Marketplace import no longer writes Firestore; use the web upload to Master Sheet.';

export function chunkTrackingNumbers(orders, chunkSize = TRACKING_QUERY_CHUNK) {
  // One tracking number can arrive on several orders (split shipments, re-imports). Querying
  // per order billed a read for each repeat; dedupe first, then ask in chunks.
  const byTracking = new Map();
  for (const order of orders ?? []) {
    const metadata = marketplaceMetadata(order);
    if (!metadata || !order.normalizedTrackingNo) continue;
    if (!byTracking.has(order.normalizedTrackingNo)) {
      byTracking.set(order.normalizedTrackingNo, metadata);
    }
  }

  const trackingNumbers = [...byTracking.keys()];
  const chunks = [];
  for (let index = 0; index < trackingNumbers.length; index += chunkSize) {
    chunks.push(trackingNumbers.slice(index, index + chunkSize));
  }
  return { byTracking, chunks };
}

async function reconcileScannedOrders({ db, orders }) {
  let batch = db.batch();
  let batchSize = 0;
  let reconciled = 0;

  async function commitBatch() {
    if (batchSize === 0) return;
    await batch.commit();
    batch = db.batch();
    batchSize = 0;
  }

  const { byTracking, chunks } = chunkTrackingNumbers(orders);

  for (const chunk of chunks) {
    const matches = await db.collection('orders')
      .where('normalizedCode', 'in', chunk)
      .limit(RECONCILE_MATCH_LIMIT)
      .get();

    if (matches.size >= RECONCILE_MATCH_LIMIT) {
      console.warn(`reconcileScannedOrders: hit the ${RECONCILE_MATCH_LIMIT}-document ceiling; results may be incomplete.`);
    }

    for (const match of matches.docs) {
      // The chunk asked for many tracking numbers at once, so each match must be paired
      // back to the metadata of its own order rather than the loop's current one.
      const metadata = byTracking.get(match.get('normalizedCode'));
      if (!metadata) continue;
      batch.set(match.ref, metadata, { merge: true });
      batchSize += 1;
      reconciled += 1;
      if (batchSize >= MAX_BATCH_WRITES) {
        await commitBatch();
      }
    }
  }

  await commitBatch();
  return reconciled;
}

export async function initFirestore({ config, baseDir }) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    : JSON.parse(await readFile(path.resolve(baseDir, config.serviceAccountPath), 'utf8'));

  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }

  return getFirestore();
}

export async function upsertOrders({ db, config, platform, orders, machineName }) {
  // This module used to be the scheduled marketplace writer. Keep the exported function
  // as a hard stop so an old scheduler cannot silently recreate 74k-read/write usage by
  // calling the module directly while the worker entrypoint is disabled.
  throw new Error(LEGACY_MARKETPLACE_FIRESTORE_ERROR);
}

export async function setSyncStatus({ db, config, platform, status }) {
  const collectionName = config.collections?.status ?? 'syncStatus';
  await db.collection(collectionName).doc(platform).set(
    {
      ...status,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function acquireSyncLock({ db, lockKey = 'marketplace-worker', ownerToken, machineName, ttlMs }) {
  const lockRef = db.collection('syncLocks').doc(lockKey);
  const now = Date.now();
  const expiresAt = new Date(now + ttlMs);

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(lockRef);
    const lock = snap.exists ? snap.data() : null;
    const currentExpiresAt = lock?.expiresAt?.toDate?.() ?? (lock?.expiresAt ? new Date(lock.expiresAt) : null);
    const ownedByOther = lock?.ownerToken && lock.ownerToken !== ownerToken;
    const stillActive = currentExpiresAt && currentExpiresAt.getTime() > now;

    if (ownedByOther && stillActive) {
      return false;
    }

    transaction.set(lockRef, {
      ownerToken,
      lockKey,
      machineName,
      lockedAt: FieldValue.serverTimestamp(),
      expiresAt,
    }, { merge: true });
    return true;
  });
}

export async function releaseSyncLock({ db, lockKey = 'marketplace-worker', ownerToken }) {
  const lockRef = db.collection('syncLocks').doc(lockKey);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(lockRef);
    const lock = snap.exists ? snap.data() : null;
    if (lock?.ownerToken === ownerToken) {
      transaction.set(lockRef, {
        releasedAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(0),
      }, { merge: true });
    }
  });
}
