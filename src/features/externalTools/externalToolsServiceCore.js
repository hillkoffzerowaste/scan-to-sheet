import {
  DEFAULT_EXTERNAL_TOOLS_CONFIG,
  normalizeExternalToolsConfig,
  validateExternalToolsConfig,
} from './externalToolsConfig.js';

const EMPTY_UNSUBSCRIBE = () => {};

function createExternalToolsError(code, message, cause) {
  const error = Object.assign(new Error(message), { code });
  if (cause) error.detail = cause;
  return error;
}

function getVersion(snapshot) {
  const exists = snapshot.exists();
  const revision = exists && typeof snapshot.data()?.revision === 'string'
    ? snapshot.data().revision
    : null;
  return { exists, revision };
}

function matchesVersion(actual, expected) {
  return actual.exists === expected.exists && actual.revision === expected.revision;
}

export function createExternalToolsService({
  db,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  revisionFactory = () => globalThis.crypto.randomUUID(),
}) {
  function subscribeExternalTools({ onChange, onError } = {}) {
    const notifyChange = typeof onChange === 'function' ? onChange : EMPTY_UNSUBSCRIBE;
    const notifyError = typeof onError === 'function' ? onError : EMPTY_UNSUBSCRIBE;

    if (!db) {
      notifyChange(DEFAULT_EXTERNAL_TOOLS_CONFIG, { source: 'default', ready: false, version: null });
      return EMPTY_UNSUBSCRIBE;
    }

    const reportReadError = (cause) => notifyError(createExternalToolsError(
      'EXTERNAL_TOOLS_READ_FAILED',
      'อ่านการตั้งค่าเครื่องมือภายนอกไม่สำเร็จ',
      cause,
    ));

    try {
      return onSnapshot(
        doc(db, 'staffSettings', 'externalTools'),
        { includeMetadataChanges: true },
        (snapshot) => {
          const fromCache = Boolean(snapshot.metadata?.fromCache);
          const ready = !fromCache;
          const source = fromCache ? 'cache' : 'firestore';
          const version = ready ? getVersion(snapshot) : null;

          if (!snapshot.exists()) {
            notifyChange(DEFAULT_EXTERNAL_TOOLS_CONFIG, { source, ready, version });
            return;
          }

          const config = normalizeExternalToolsConfig(snapshot.data());
          if (!config) {
            // Cache data may be stale or partial; wait for the authoritative server snapshot.
            if (ready) {
              notifyError(createExternalToolsError(
                'EXTERNAL_TOOLS_INVALID',
                'การตั้งค่าเครื่องมือภายนอกไม่ถูกต้อง',
              ));
            }
            return;
          }

          notifyChange(config, { source, ready, version });
        },
        reportReadError,
      );
    } catch (cause) {
      reportReadError(cause);
      return EMPTY_UNSUBSCRIBE;
    }
  }

  async function saveExternalToolsConfig(config, firebaseUser, expectedVersion) {
    const normalized = validateExternalToolsConfig(config);
    if (!db || !firebaseUser?.uid) {
      throw createExternalToolsError(
        'EXTERNAL_TOOLS_AUTH_REQUIRED',
        'ต้องเข้าสู่ระบบ Firebase ในฐานะ Admin',
      );
    }
    if (!expectedVersion || typeof expectedVersion.exists !== 'boolean') {
      throw createExternalToolsError(
        'EXTERNAL_TOOLS_CONFLICT',
        'ข้อมูลการตั้งค่าล่าสุดไม่พร้อม กรุณาโหลดค่าจากเซิร์ฟเวอร์ก่อนบันทึก',
      );
    }

    const reference = doc(db, 'staffSettings', 'externalTools');
    const nextRevision = revisionFactory();
    try {
      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(reference);
        const actualVersion = getVersion(snapshot);
        if (!matchesVersion(actualVersion, expectedVersion)) {
          throw createExternalToolsError(
            'EXTERNAL_TOOLS_CONFLICT',
            'มี Admin อีกเครื่องบันทึกการตั้งค่าใหม่แล้ว กรุณาโหลดค่าล่าสุดก่อนบันทึก',
          );
        }

        transaction.set(reference, {
          ...normalized,
          revision: nextRevision,
          updatedAt: serverTimestamp(),
          updatedByUid: firebaseUser.uid,
        });
      });
    } catch (cause) {
      if (cause?.code === 'EXTERNAL_TOOLS_CONFLICT') throw cause;
      throw createExternalToolsError(
        'EXTERNAL_TOOLS_SAVE_FAILED',
        'บันทึกการตั้งค่าเครื่องมือภายนอกไม่สำเร็จ',
        cause,
      );
    }

    return {
      config: normalized,
      version: { exists: true, revision: nextRevision },
    };
  }

  return { subscribeExternalTools, saveExternalToolsConfig };
}
