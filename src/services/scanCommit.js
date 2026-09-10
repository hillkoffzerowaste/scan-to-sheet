const FALLBACK_OUTBOX_KEY = 'scan-to-sheet:firestore-fallback-outbox:v1';
const activeCommits = new WeakMap();
const unsavedEntries = new WeakMap();

function fallbackError(code, message, detail) {
  const error = new Error(message);
  error.code = code;
  if (detail) error.detail = detail;
  return error;
}

function getStorage(storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    if (typeof target?.getItem !== 'function' || typeof target?.setItem !== 'function') {
      throw new Error('Storage unavailable');
    }
    return target;
  } catch (error) {
    throw fallbackError('FALLBACK_OUTBOX_READ_FAILED', 'เปิดคิวสำรองในเครื่องไม่ได้ กรุณาตรวจสอบพื้นที่จัดเก็บก่อนสแกนต่อ', error);
  }
}

function readOutbox(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(FALLBACK_OUTBOX_KEY) ?? '[]');
    if (!Array.isArray(parsed)) throw new Error('Invalid outbox');
    const savedIds = new Set(parsed.map((entry) => entry?.id).filter(Boolean));
    return [...parsed, ...(unsavedEntries.get(storage) ?? []).filter((entry) => !savedIds.has(entry.id))];
  } catch (error) {
    throw fallbackError('FALLBACK_OUTBOX_READ_FAILED', 'อ่านคิวสำรองในเครื่องไม่ได้ ยังไม่ได้เขียนทับข้อมูลเดิม กรุณาให้ผู้ดูแลตรวจสอบ', error);
  }
}

function writeOutbox(items, storage) {
  try {
    storage.setItem(FALLBACK_OUTBOX_KEY, JSON.stringify(items));
    unsavedEntries.delete(storage);
  } catch (error) {
    throw fallbackError('FALLBACK_OUTBOX_WRITE_FAILED', 'บันทึกคิวสำรองลงเครื่องไม่สำเร็จ กรุณาเปิดหน้านี้ค้างไว้และตรวจสอบพื้นที่จัดเก็บก่อนลองใหม่', error);
  }
}

function ambiguousContext() {
  return fallbackError('FALLBACK_CONTEXT_AMBIGUOUS', 'ข้อมูลโหมดหรือขนส่งของรายการค้างไม่ชัดเจน ยังเก็บรายการเดิมไว้ กรุณาให้ผู้ดูแลตรวจสอบก่อนสแกนต่อ');
}

function snapshotContext(context) {
  if (!['packer', 'admin'].includes(context?.type) || typeof context?.courier !== 'string' || !context.courier.trim()) {
    throw ambiguousContext();
  }
  return {
    type: context.type,
    courier: context.courier,
    // Firebase User objects also contain credentials; persist only scan-event attribution.
    user: context.user ? {
      uid: context.user.uid ?? '',
      email: context.user.email ?? '',
      displayName: context.user.displayName ?? context.user.name ?? '',
    } : null,
    packer: context.packer ?? '',
    note: context.note ?? '',
  };
}

function outboxEntry(item) {
  if (item?.result) {
    if (!item.result.code) throw ambiguousContext();
    return { ...item, context: snapshotContext(item.context) };
  }
  if (!item?.code) throw ambiguousContext();
  const statusType = ['success', 'cancelled', 'returned'].includes(item.status)
    ? 'packer'
    : item.status === 'admin_scan' ? 'admin' : null;
  const flagType = typeof item.isPacker === 'boolean' ? (item.isPacker ? 'packer' : 'admin') : null;
  if ((item.isPacker != null && !flagType) || (flagType && statusType && flagType !== statusType)) {
    throw ambiguousContext();
  }
  // duplicate and admin_matched alone do not identify the original caller. A Sheet row
  // can also belong to an earlier actor, so never derive user/packer/note from that row.
  const context = snapshotContext({ type: flagType ?? statusType, courier: item.selectedCourier ?? item.courier });
  return { id: globalThis.crypto.randomUUID(), result: item, context };
}

export function getFallbackOutbox(storage) {
  return readOutbox(getStorage(storage));
}

async function runFallbackCommit({ appendToSheet, mirrorToFirestore, context, storage }) {
  const pending = readOutbox(storage).map(outboxEntry);
  // Persist migration and check storage before creating another Sheet row.
  writeOutbox(pending, storage);
  while (pending.length > 0) {
    const item = pending[0];
    try {
      await mirrorToFirestore(item.result, item.context);
    } catch {
      break;
    }
    pending.shift();
    writeOutbox(pending, storage);
  }
  if (pending.length >= 50) {
    throw fallbackError('FALLBACK_OUTBOX_FULL', 'คิวสำรองครบ 50 รายการแล้ว กรุณากู้คืนรายการค้างก่อนสแกนต่อ');
  }

  const sheetResult = await appendToSheet();
  try {
    await mirrorToFirestore(sheetResult, context);
    return sheetResult;
  } catch {
    const entry = { id: globalThis.crypto.randomUUID(), result: sheetResult, context };
    pending.push(entry);
    // If storage becomes full after the Sheet write, retain only the unsaved entry in
    // memory. The next attempt merges it with fresh storage, including other tabs' work.
    unsavedEntries.set(storage, [entry]);
    try {
      writeOutbox(pending, storage);
    } catch (error) {
      return {
        ...sheetResult,
        status: 'firestore_unconfirmed',
        error,
        message: `บันทึก Google Sheet แล้ว แต่ยังยืนยัน Firestore ไม่สำเร็จ และ${error.message}`,
      };
    }
    return {
      ...sheetResult,
      status: 'firestore_unconfirmed',
      message: 'บันทึก Google Sheet แล้ว แต่ยังยืนยัน Firestore ไม่สำเร็จ',
    };
  }
}

export async function commitFallbackScan({ appendToSheet, mirrorToFirestore, context, storage }) {
  const savedContext = snapshotContext(context);
  const target = getStorage(storage);
  const previous = activeCommits.get(target) ?? Promise.resolve();
  const run = () => runFallbackCommit({ appendToSheet, mirrorToFirestore, context: savedContext, storage: target });
  const task = previous.catch(() => {}).then(() => {
    // Web Locks coordinate localStorage across tabs; the promise chain also protects
    // callers within this module when Web Locks are unavailable or storage is injected.
    const locks = storage == null ? globalThis.navigator?.locks : null;
    return locks?.request ? locks.request(FALLBACK_OUTBOX_KEY, run) : run();
  });
  activeCommits.set(target, task);
  try {
    return await task;
  } finally {
    if (activeCommits.get(target) === task) activeCommits.delete(target);
  }
}
