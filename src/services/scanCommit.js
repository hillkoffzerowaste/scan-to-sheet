const FALLBACK_OUTBOX_KEY = 'scan-to-sheet:firestore-fallback-outbox:v1';

function getStorage(storage) {
  return storage ?? globalThis.localStorage;
}

function readOutbox(storage) {
  try {
    const parsed = JSON.parse(getStorage(storage)?.getItem(FALLBACK_OUTBOX_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOutbox(items, storage) {
  try {
    getStorage(storage)?.setItem(FALLBACK_OUTBOX_KEY, JSON.stringify(items.slice(-50)));
  } catch {
    // Storage is best effort; the visible result still tells the operator that Firestore failed.
  }
}

export function getFallbackOutbox(storage) {
  return readOutbox(storage);
}

export async function commitFallbackScan({ appendToSheet, mirrorToFirestore, storage }) {
  const pending = readOutbox(storage);
  for (const item of pending) {
    try {
      await mirrorToFirestore(item);
      pending.splice(pending.indexOf(item), 1);
    } catch {
      break;
    }
  }
  writeOutbox(pending, storage);

  const sheetResult = await appendToSheet();

  try {
    await mirrorToFirestore(sheetResult);
    writeOutbox(pending, storage);
    return sheetResult;
  } catch {
    pending.push(sheetResult);
    writeOutbox(pending, storage);
    return {
      ...sheetResult,
      status: 'firestore_unconfirmed',
      message: 'บันทึก Google Sheet แล้ว แต่ยังยืนยัน Firestore ไม่สำเร็จ',
    };
  }
}
