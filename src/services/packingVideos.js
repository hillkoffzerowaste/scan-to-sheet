import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  startAfter,
  updateDoc,
  where,
} from 'firebase/firestore';

import { firestoreDb, serverTimestamp } from './firebase.js';
import { collectFirestorePages } from './firestorePagination.js';
import {
  MAX_ATTEMPT_NO,
  buildPackingVideoDoc,
  nextAttemptNo,
  normalizePackingTracking,
} from './packingVideoModel.js';

const COLLECTION = 'packingVideos';
const TRACKING_COLLECTION = 'packingVideoTracking';
const AUDIT_COLLECTION = 'packingVideoAudit';

/** How many previous attempts the duplicate dialog needs. It shows the latest; a few is plenty. */
const HISTORY_LIMIT = 5;
/** One `view` per video per viewer per this window. Scrolling a dashboard must not bill a
 *  write per card. */
const VIEW_AUDIT_THROTTLE_MS = 10 * 60 * 1000;

const recentViewAudits = new Map();

function requireFirestore() {
  if (!firestoreDb) {
    throw Object.assign(new Error('ระบบข้อมูลวิดีโอยังไม่พร้อมใช้งาน'), {
      code: 'PACKING_VIDEO_FIRESTORE_UNAVAILABLE',
    });
  }
}

/**
 * Reserves the next attempt number for a tracking number.
 *
 * A transaction on one counter document rather than a max() over past videos: the query would
 * bill a read per attempt and would still race two stations packing the same parcel. The rules
 * enforce the same +1 step server-side, so a buggy client cannot skip or reuse a number.
 */
export async function allocatePackingAttempt({ trackingNo, videoId }) {
  requireFirestore();
  const normalized = normalizePackingTracking(trackingNo);
  if (!normalized) {
    throw Object.assign(new Error('ไม่พบเลขพัสดุ'), { code: 'PACKING_VIDEO_MISSING_TRACKING' });
  }

  const counterRef = doc(firestoreDb, TRACKING_COLLECTION, normalized);
  return runTransaction(firestoreDb, async (tx) => {
    const snapshot = await tx.get(counterRef);
    const attemptNo = nextAttemptNo(snapshot.exists() ? snapshot.data().lastAttemptNo : 0);
    const payload = {
      normalizedTrackingNo: normalized,
      lastAttemptNo: attemptNo,
      lastVideoId: String(videoId ?? ''),
      updatedAt: serverTimestamp(),
    };
    if (snapshot.exists()) tx.update(counterRef, payload);
    else tx.set(counterRef, payload);
    return attemptNo;
  });
}

export async function createPackingVideo(input) {
  requireFirestore();
  const payload = buildPackingVideoDoc({ ...input, updatedAt: serverTimestamp() });
  const videoRef = doc(firestoreDb, COLLECTION, payload.videoId);
  // A retry must reuse the immutable reservation. Rewriting its full payload would be a broad
  // client update, which Rules intentionally reject after the document already exists.
  const existing = await getDoc(videoRef);
  if (existing.exists()) return { id: existing.id, ...existing.data() };
  await setDoc(videoRef, payload);
  return payload;
}

/** Only the upload-lane fields; anything else would be rejected by the rules anyway. */
export async function updatePackingVideoUpload(videoId, patch) {
  requireFirestore();
  await updateDoc(doc(firestoreDb, COLLECTION, videoId), { ...patch, updatedAt: serverTimestamp() });
}

export async function getPackingVideo(videoId) {
  requireFirestore();
  const snapshot = await getDoc(doc(firestoreDb, COLLECTION, videoId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

/** Past attempts for a tracking number — what the duplicate dialog reads back to the packer. */
export async function findPackingVideosByTracking({ trackingNo }) {
  requireFirestore();
  const normalized = normalizePackingTracking(trackingNo);
  if (!normalized) return [];

  const snapshot = await getDocs(query(
    collection(firestoreDb, COLLECTION),
    where('normalizedTrackingNo', '==', normalized),
    orderBy('startedAt', 'desc'),
    limit(HISTORY_LIMIT),
  ));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

/**
 * Runs a dashboard search.
 *
 * `descriptor` comes from `buildRecordingQuery`, which always carries a limit — an unbounded
 * sweep here would bill a read for every video ever recorded.
 */
export async function searchPackingVideos(descriptor, { maxItems } = {}) {
  requireFirestore();
  if (!descriptor?.limit) {
    throw Object.assign(new Error('การค้นหาต้องมีขอบเขต'), { code: 'PACKING_VIDEO_UNBOUNDED_QUERY' });
  }

  const build = (cursor, size) => {
    const constraints = descriptor.where.map((clause) => where(clause.field, clause.op, clause.value));
    descriptor.orderBy.forEach((clause) => constraints.push(orderBy(clause.field, clause.direction)));
    if (cursor) constraints.push(startAfter(cursor));
    constraints.push(limit(size));
    return query(collection(firestoreDb, COLLECTION), ...constraints);
  };

  return collectFirestorePages(
    async (cursor, size) => {
      const snapshot = await getDocs(build(cursor, size));
      return {
        items: snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
        cursor: snapshot.docs.at(-1) ?? null,
        done: snapshot.docs.length < size,
      };
    },
    { pageSize: descriptor.limit, maxItems: maxItems ?? descriptor.limit },
  );
}

export async function logPackingVideoAudit({ videoId, action, actor, deviceId, detail = {} }) {
  requireFirestore();
  if (action === 'view') {
    const key = `${videoId}:${actor?.uid ?? ''}`;
    const last = recentViewAudits.get(key) ?? 0;
    if (Date.now() - last < VIEW_AUDIT_THROTTLE_MS) return false;
    recentViewAudits.set(key, Date.now());
  }

  await addDoc(collection(firestoreDb, AUDIT_COLLECTION), {
    videoId: String(videoId ?? ''),
    action,
    actorUid: String(actor?.uid ?? ''),
    actorEmail: String(actor?.email ?? ''),
    at: serverTimestamp(),
    deviceId: String(deviceId ?? ''),
    detail,
  });
  return true;
}

export { MAX_ATTEMPT_NO };
