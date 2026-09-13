import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { firestoreDb } from './firebase.js';
import {
  REMOTE_CONTROL_COLLECTION,
  normalizeRemoteControlPayload,
  remoteControlDocId,
} from './remoteControlRules.js';

function remoteControlDoc(tab) {
  const docId = remoteControlDocId(tab);
  if (!firestoreDb || !docId) {
    const error = new Error('ยังไม่ได้ตั้งค่า Firebase');
    error.code = firestoreDb ? 'REMOTE_CONTROL_TAB_INVALID' : 'FIREBASE_NOT_CONFIGURED';
    throw error;
  }
  return doc(firestoreDb, REMOTE_CONTROL_COLLECTION, docId);
}

export function subscribeRemoteControl({ tab, onChange, onError }) {
  // Effects call this during render. Throwing here would take down the whole app on a device
  // where Firestore is not configured, which is a far worse failure than losing the remote.
  if (!firestoreDb || !remoteControlDocId(tab)) {
    onError?.(Object.assign(new Error('ยังไม่ได้ตั้งค่า Firebase'), { code: 'FIREBASE_NOT_CONFIGURED' }));
    return () => {};
  }
  return onSnapshot(
    remoteControlDoc(tab),
    (snapshot) => onChange(snapshot.exists() ? snapshot.data() : null),
    onError,
  );
}

export async function writeRemoteControl({ courier, packer, origin, uid, tab }) {
  const payload = normalizeRemoteControlPayload({ courier, packer, tab });
  // setDoc without merge: the rules check keys().hasOnly on the resulting document, so a merge
  // that leaves an old key behind would be rejected with no obvious cause.
  await setDoc(remoteControlDoc(tab), {
    ...payload,
    origin,
    updatedAt: serverTimestamp(),
    updatedByUid: uid,
  });
}
