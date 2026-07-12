import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { orderDocumentId } from './normalize.js';

export async function initFirestore({ config, baseDir }) {
  const serviceAccountPath = path.resolve(baseDir, config.serviceAccountPath);
  const serviceAccount = JSON.parse(await readFile(serviceAccountPath, 'utf8'));

  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }

  return getFirestore();
}

export async function upsertOrders({ db, config, platform, orders, machineName }) {
  const collectionName = config.collections?.orders ?? 'marketplaceOrders';
  let upserted = 0;
  let batch = db.batch();
  let batchSize = 0;

  for (const order of orders) {
    const docId = orderDocumentId(order);
    if (!docId) {
      continue;
    }
    batch.set(
      db.collection(collectionName).doc(docId),
      {
        ...order,
        buyerName: FieldValue.delete(),
        rawText: FieldValue.delete(),
        platform,
        source: 'playwright',
        syncMachine: machineName,
        scrapedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    upserted += 1;
    batchSize += 1;

    if (batchSize >= 400) {
      await batch.commit();
      batch = db.batch();
      batchSize = 0;
    }
  }

  if (batchSize > 0) {
    await batch.commit();
  }

  return upserted;
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
