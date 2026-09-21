import { doc, onSnapshot, setDoc } from 'firebase/firestore';

import {
  DEFAULT_EXTERNAL_TOOLS_CONFIG,
  normalizeExternalToolsConfig,
  validateExternalToolsConfig,
} from './externalToolsConfig.js';
import { firestoreDb, serverTimestamp } from '../../services/firebase.js';

const EMPTY_UNSUBSCRIBE = () => {};

function createExternalToolsError(code, message, cause) {
  const error = Object.assign(new Error(message), { code });
  if (cause) error.detail = cause;
  return error;
}

export function subscribeExternalTools({ onChange, onError } = {}) {
  const notifyChange = typeof onChange === 'function' ? onChange : EMPTY_UNSUBSCRIBE;
  const notifyError = typeof onError === 'function' ? onError : EMPTY_UNSUBSCRIBE;

  if (!firestoreDb) {
    notifyChange(DEFAULT_EXTERNAL_TOOLS_CONFIG, { source: 'default' });
    return EMPTY_UNSUBSCRIBE;
  }

  try {
    return onSnapshot(
      doc(firestoreDb, 'staffSettings', 'externalTools'),
      (snapshot) => {
        if (!snapshot.exists()) {
          notifyChange(DEFAULT_EXTERNAL_TOOLS_CONFIG, { source: 'default' });
          return;
        }

        const config = normalizeExternalToolsConfig(snapshot.data());
        if (!config) {
          notifyError(createExternalToolsError(
            'EXTERNAL_TOOLS_INVALID',
            'การตั้งค่าเครื่องมือภายนอกไม่ถูกต้อง',
          ));
          return;
        }

        notifyChange(config, { source: 'firestore' });
      },
      (cause) => {
        notifyError(createExternalToolsError(
          'EXTERNAL_TOOLS_READ_FAILED',
          'อ่านการตั้งค่าเครื่องมือภายนอกไม่สำเร็จ',
          cause,
        ));
      },
    );
  } catch (cause) {
    notifyError(createExternalToolsError(
      'EXTERNAL_TOOLS_READ_FAILED',
      'อ่านการตั้งค่าเครื่องมือภายนอกไม่สำเร็จ',
      cause,
    ));
    return EMPTY_UNSUBSCRIBE;
  }
}

export async function saveExternalToolsConfig(config, firebaseUser) {
  const normalized = validateExternalToolsConfig(config);
  if (!firestoreDb || !firebaseUser?.uid) {
    throw createExternalToolsError(
      'EXTERNAL_TOOLS_AUTH_REQUIRED',
      'ต้องเข้าสู่ระบบ Firebase ในฐานะ Admin',
    );
  }

  try {
    await setDoc(doc(firestoreDb, 'staffSettings', 'externalTools'), {
      ...normalized,
      updatedAt: serverTimestamp(),
      updatedByUid: firebaseUser.uid,
    });
  } catch (cause) {
    throw createExternalToolsError(
      'EXTERNAL_TOOLS_SAVE_FAILED',
      'บันทึกการตั้งค่าเครื่องมือภายนอกไม่สำเร็จ',
      cause,
    );
  }

  return normalized;
}

