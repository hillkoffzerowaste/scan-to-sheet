import { PACKING_VIDEO_STATUS } from './packingVideoModel.js';

/**
 * Local durable store for packing videos.
 *
 * Every recording is written here before anything is uploaded — not only when the network is
 * down. A MediaRecorder blob lives in the tab's heap alone, so a refresh, an OOM kill or a
 * power cut would destroy the one piece of evidence the feature exists to produce. Writing
 * here always also means there is exactly one code path, instead of an offline branch that is
 * never exercised until the day it matters.
 */

export const DB_NAME = 'scan-to-sheet-packing-videos';
export const DB_VERSION = 1;
export const STORE_VIDEOS = 'videos';
export const STORE_CHUNKS = 'chunks';
export const STORE_META = 'meta';

/** Refuse to start a recording with less headroom than a long clip could need. */
export const MIN_FREE_BYTES = 500 * 1024 * 1024;
export const MAX_QUEUE_ITEMS = 20;
export const MAX_QUEUE_BYTES = 2 * 1024 * 1024 * 1024;
export const QUEUE_WARN_ITEMS = 5;
/** Metadata outlives the blob so the day's list renders without hitting Firestore. */
export const METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function unavailable() {
  return Object.assign(new Error('เบราว์เซอร์นี้เก็บวิดีโอในเครื่องไม่ได้'), {
    code: 'PACKING_VIDEO_DB_UNAVAILABLE',
  });
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

let dbPromise;

export function openPackingVideoDb() {
  if (typeof indexedDB === 'undefined') return Promise.reject(unavailable());

  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
        const videos = db.createObjectStore(STORE_VIDEOS, { keyPath: 'videoId' });
        videos.createIndex('by_status', 'status');
        videos.createIndex('by_createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunks = db.createObjectStore(STORE_CHUNKS, { keyPath: ['videoId', 'seq'] });
        chunks.createIndex('by_videoId', 'videoId');
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? unavailable());
  });

  return dbPromise;
}

async function withStore(storeName, mode, run) {
  const db = await openPackingVideoDb();
  const tx = db.transaction(storeName, mode);
  const result = await run(tx.objectStore(storeName));
  await txDone(tx);
  return result;
}

/**
 * Ask the browser to stop treating this data as disposable.
 *
 * Without it Chrome may evict the store on its own when the disk fills, silently taking
 * not-yet-uploaded recordings with it.
 */
export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return Boolean(await navigator.storage?.persist?.());
  } catch {
    return false;
  }
}

export async function checkRecordingCapacity() {
  const pending = await listPendingVideos();
  const queuedBytes = pending.reduce((sum, row) => sum + Number(row.sizeBytes ?? 0), 0);

  if (pending.length >= MAX_QUEUE_ITEMS || queuedBytes >= MAX_QUEUE_BYTES) {
    throw Object.assign(
      new Error('พื้นที่เก็บวิดีโอในเครื่องเต็ม กรุณารอให้อัปโหลดเสร็จก่อนเริ่มแพ็คใหม่'),
      { code: 'PACKING_VIDEO_QUEUE_FULL' },
    );
  }

  let free = Infinity;
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota != null && estimate?.usage != null) free = estimate.quota - estimate.usage;
  } catch {
    // An unavailable estimate must not block packing; the queue caps above still apply.
  }

  if (free < MIN_FREE_BYTES) {
    throw Object.assign(
      new Error('พื้นที่ว่างในเครื่องเหลือน้อยเกินไป กรุณารอให้อัปโหลดเสร็จก่อนเริ่มแพ็คใหม่'),
      { code: 'PACKING_VIDEO_DISK_LOW' },
    );
  }

  return { pendingCount: pending.length, queuedBytes, free, warn: pending.length >= QUEUE_WARN_ITEMS };
}

export function appendChunk(videoId, seq, blob) {
  return withStore(STORE_CHUNKS, 'readwrite', (store) =>
    promisify(store.put({ videoId, seq, blob, storedAt: Date.now() })));
}

export async function readChunks(videoId) {
  const rows = await withStore(STORE_CHUNKS, 'readonly', (store) =>
    promisify(store.index('by_videoId').getAll(videoId)));
  return rows.sort((left, right) => left.seq - right.seq);
}

export function clearChunks(videoId) {
  return withStore(STORE_CHUNKS, 'readwrite', async (store) => {
    const rows = await promisify(store.index('by_videoId').getAllKeys(videoId));
    rows.forEach((key) => store.delete(key));
  });
}

/** The durable hand-off point: after this resolves, the recording survives a crash. */
export async function finalizeRecording(record) {
  const row = {
    ...record,
    status: record.status ?? PACKING_VIDEO_STATUS.pendingUpload,
    uploadAttempts: 0,
    nextAttemptAt: 0,
    leaseUntil: 0,
    retryNo: 0,
    createdAt: record.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  await withStore(STORE_VIDEOS, 'readwrite', (store) => promisify(store.put(row)));
  await clearChunks(record.videoId);
  return row;
}

export function listPendingVideos() {
  return withStore(STORE_VIDEOS, 'readonly', async (store) => {
    const rows = await promisify(store.getAll());
    return rows.filter((row) => row.blob);
  });
}

export function getVideo(videoId) {
  return withStore(STORE_VIDEOS, 'readonly', (store) => promisify(store.get(videoId)));
}

export function updateVideo(videoId, patch) {
  return withStore(STORE_VIDEOS, 'readwrite', async (store) => {
    const current = await promisify(store.get(videoId));
    if (!current) return null;
    const nextRow = { ...current, ...patch, updatedAt: Date.now() };
    await promisify(store.put(nextRow));
    return nextRow;
  });
}

export function dropBlob(videoId) {
  return updateVideo(videoId, { blob: null });
}

export async function summarizeQueue() {
  const rows = await withStore(STORE_VIDEOS, 'readonly', (store) => promisify(store.getAll()));
  const pending = rows.filter((row) => row.blob && row.status === PACKING_VIDEO_STATUS.pendingUpload);
  const failed = rows.filter((row) => row.status === PACKING_VIDEO_STATUS.uploadFailed);
  return {
    pendingCount: pending.length,
    failedCount: failed.length,
    pendingBytes: pending.reduce((sum, row) => sum + Number(row.sizeBytes ?? 0), 0),
  };
}

/**
 * Chunks with no finalized row belong to a recording the tab never got to close — a crash or
 * a forced reload. They are surfaced for the packer to decide on, never uploaded silently:
 * an incomplete clip should not look like a clean one.
 */
export async function findInterruptedRecordings() {
  const db = await openPackingVideoDb();
  const tx = db.transaction([STORE_CHUNKS, STORE_VIDEOS], 'readonly');
  const chunkIds = await promisify(tx.objectStore(STORE_CHUNKS).getAllKeys());
  const finalized = new Set(await promisify(tx.objectStore(STORE_VIDEOS).getAllKeys()));
  await txDone(tx);

  const orphans = new Map();
  chunkIds.forEach(([videoId]) => {
    if (finalized.has(videoId)) return;
    orphans.set(videoId, (orphans.get(videoId) ?? 0) + 1);
  });
  return [...orphans].map(([videoId, chunkCount]) => ({ videoId, chunkCount }));
}

export function getMeta(key) {
  return withStore(STORE_META, 'readonly', async (store) => (await promisify(store.get(key)))?.value ?? null);
}

export function setMeta(key, value) {
  return withStore(STORE_META, 'readwrite', (store) => promisify(store.put({ key, value })));
}

/** Drops metadata rows whose blob is long gone. Never touches anything still holding a file. */
export function purgeOldMetadata(now = Date.now()) {
  return withStore(STORE_VIDEOS, 'readwrite', async (store) => {
    const rows = await promisify(store.getAll());
    const stale = rows.filter((row) => !row.blob && now - Number(row.createdAt ?? 0) > METADATA_TTL_MS);
    stale.forEach((row) => store.delete(row.videoId));
    return stale.length;
  });
}
