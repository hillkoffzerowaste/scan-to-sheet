import {
  addDoc,
  collection,
  doc,
  getDoc,
  runTransaction,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { firestoreDb, isFirebaseConfigured, serverTimestamp } from './firebase.js';

function canWriteFirestore() {
  return Boolean(isFirebaseConfigured && firestoreDb);
}

function userPayload(user) {
  return {
    uid: user?.uid ?? '',
    email: user?.email ?? '',
    name: user?.displayName ?? user?.name ?? '',
  };
}

function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function orderId({ date, courier, code }) {
  return [date, courier, normalizeCode(code)]
    .map((part) => String(part ?? '').trim().replace(/[\/\\#?\[\]]/g, '_'))
    .join('__');
}

function nowIso() {
  return new Date().toISOString();
}

function baseOrderPayload({ type, code, courier, date, time, user, packer = '', note = '' }) {
  return {
    code,
    normalizedCode: normalizeCode(code),
    courier,
    date,
    packer,
    note,
    status: type === 'admin' ? 'pending' : 'packer_scanned',
    sheetSyncStatus: 'pending',
    sheetSyncError: '',
    updatedAt: serverTimestamp(),
    updatedAtIso: nowIso(),
    user: userPayload(user),
    createdBy: userPayload(user),
    admin: type === 'admin'
      ? {
          scannedAt: `${date}T${time}`,
          scannedBy: userPayload(user),
        }
      : null,
    packerScan: type === 'packer'
      ? {
          scannedAt: `${date}T${time}`,
          scannedBy: userPayload(user),
          packer,
          note,
        }
      : null,
  };
}

export function canUseFirestorePrimary() {
  return canWriteFirestore();
}

export async function upsertFirebaseUser(user) {
  if (!canWriteFirestore() || !user?.uid) {
    return;
  }

  await setDoc(
    doc(firestoreDb, 'users', user.uid),
    {
      ...userPayload(user),
      lastSeenAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function mirrorScanToFirestore({ type, result, courier, user, packer = '', note = '' }) {
  if (!canWriteFirestore() || !result?.code) {
    return;
  }

  await addDoc(collection(firestoreDb, 'scanEvents'), {
    type,
    code: result.code,
    courier,
    status: result.status,
    date: result.date,
    time: result.time,
    packer,
    note,
    sheetUrl: result.sheetUrl ?? '',
    merged: Boolean(result.merged),
    user: userPayload(user),
    createdAt: serverTimestamp(),
  });
}

export async function recordPackerScanPrimary({ code, courier, date, time, user, packer = '', note = '' }) {
  if (!canWriteFirestore()) {
    return null;
  }

  const normalizedCode = normalizeCode(code);
  const ref = doc(firestoreDb, 'orders', orderId({ date, courier, code: normalizedCode }));

  return runTransaction(firestoreDb, async (transaction) => {
    const snap = await transaction.get(ref);
    const existing = snap.exists() ? snap.data() : null;

    if (existing?.packerScan?.scannedAt && note !== 'ลูกค้ายกเลิก') {
      return {
        status: 'duplicate',
        id: ref.id,
        existing,
        sheetSyncStatus: existing.sheetSyncStatus ?? 'pending',
      };
    }

    const nextStatus = existing?.admin?.scannedAt ? 'matched' : note ? 'issue' : 'packer_scanned';
    const payload = existing
      ? {
          packer,
          note,
          status: nextStatus,
          sheetSyncStatus: 'pending',
          sheetSyncError: '',
          updatedAt: serverTimestamp(),
          updatedAtIso: nowIso(),
          user: userPayload(user),
          packerScan: {
            scannedAt: `${date}T${time}`,
            scannedBy: userPayload(user),
            packer,
            note,
          },
        }
      : {
          ...baseOrderPayload({ type: 'packer', code: normalizedCode, courier, date, time, user, packer, note }),
          status: nextStatus,
          createdAt: serverTimestamp(),
          createdAtIso: nowIso(),
        };

    transaction.set(ref, payload, { merge: true });

    return {
      status: existing?.admin?.scannedAt ? 'matched' : 'created',
      id: ref.id,
      existing,
      sheetSyncStatus: 'pending',
    };
  });
}

export async function recordAdminScanPrimary({ code, courier, date, time, user }) {
  if (!canWriteFirestore()) {
    return null;
  }

  const normalizedCode = normalizeCode(code);
  const ref = doc(firestoreDb, 'orders', orderId({ date, courier, code: normalizedCode }));

  return runTransaction(firestoreDb, async (transaction) => {
    const snap = await transaction.get(ref);
    const existing = snap.exists() ? snap.data() : null;

    if (existing?.admin?.scannedAt) {
      return {
        status: 'duplicate',
        id: ref.id,
        existing,
        sheetSyncStatus: existing.sheetSyncStatus ?? 'pending',
      };
    }

    const nextStatus = existing?.packerScan?.scannedAt ? 'matched' : 'pending';
    const payload = existing
      ? {
          status: nextStatus,
          sheetSyncStatus: 'pending',
          sheetSyncError: '',
          updatedAt: serverTimestamp(),
          updatedAtIso: nowIso(),
          user: userPayload(user),
          admin: {
            scannedAt: `${date}T${time}`,
            scannedBy: userPayload(user),
          },
        }
      : {
          ...baseOrderPayload({ type: 'admin', code: normalizedCode, courier, date, time, user }),
          status: nextStatus,
          createdAt: serverTimestamp(),
          createdAtIso: nowIso(),
        };

    transaction.set(ref, payload, { merge: true });

    return {
      status: existing?.packerScan?.scannedAt ? 'matched' : 'created',
      id: ref.id,
      existing,
      sheetSyncStatus: 'pending',
    };
  });
}

export async function markSheetSyncResult({ orderId: id, ok, result = null, error = null }) {
  if (!canWriteFirestore() || !id) {
    return;
  }

  const ref = doc(firestoreDb, 'orders', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return;
  }

  await updateDoc(ref, {
    sheetSyncStatus: ok ? 'synced' : 'failed',
    sheetSyncError: ok ? '' : String(error?.message ?? error ?? 'Unknown sync error'),
    sheetSyncedAt: ok ? serverTimestamp() : null,
    sheetResultStatus: result?.status ?? '',
    sheetUrl: result?.sheetUrl ?? '',
    updatedAt: serverTimestamp(),
    updatedAtIso: nowIso(),
  });
}
