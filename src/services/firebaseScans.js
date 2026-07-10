import { addDoc, collection, doc, setDoc } from 'firebase/firestore';
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
