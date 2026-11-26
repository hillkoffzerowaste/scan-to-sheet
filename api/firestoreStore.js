import crypto from 'node:crypto';

import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LOCK_TTL_MS = 5 * 60 * 1000;
export const SHEET_RATE_LIMIT = 30;
export const SHEET_RATE_WINDOW_MS = 60 * 1000;

const SESSION_COLLECTION = 'serverSessions';
const SHEET_CONFIG_COLLECTION = 'serverSheetConfigs';
const LOCK_COLLECTION = 'systemLocks';
const RATE_COLLECTION = 'systemRateLimits';
const LINE_EVENT_COLLECTION = 'lineWebhookEvents';

export function redactLineEvent(event) {
  if (!event || typeof event !== 'object') return {};
  const value = JSON.parse(JSON.stringify(event));
  if (value.replyToken) delete value.replyToken;
  if (value.source?.userId) delete value.source.userId;
  return value;
}

function stableId(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function nextIsoDay(day) {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function scanSeconds(value) {
  const match = String(value || '').match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
  return match
    ? (Number(match[1]) * 60 * 60) + (Number(match[2]) * 60) + Number(match[3] || 0)
    : null;
}

function isShippedStatus(value) {
  const status = String(value?.status || '').toLowerCase();
  return [
    'matched',
    'success',
    'ส่งออกแล้ว',
    'สแกนแล้ว',
    'shipped',
    'handed over',
  ].some((marker) => status.includes(marker));
}

function orderKey(value, index) {
  const candidate = [
    value?.tracking,
    value?.trackingNumber,
    value?.normalizedCode,
    value?.code,
    value?.adminCode,
  ].find((item) => String(item || '').trim());
  return candidate ? `tracking:${String(candidate).trim().toLowerCase()}` : `row:${index}`;
}

function mergeOrderRecords(orders) {
  const merged = new Map();
  orders.forEach((value, index) => {
    const key = orderKey(value, index);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, value);
      return;
    }
    const combined = {
      ...current,
      ...value,
      admin: {
        ...(current.admin || {}),
        ...(value.admin || {}),
        scannedAt: value.admin?.scannedAt || current.admin?.scannedAt || '',
      },
      packerScan: {
        ...(current.packerScan || {}),
        ...(value.packerScan || {}),
        scannedAt: value.packerScan?.scannedAt || current.packerScan?.scannedAt || '',
      },
    };
    if (isShippedStatus(current) || isShippedStatus(value)) {
      combined.status = isShippedStatus(value) ? value.status : current.status;
    }
    merged.set(key, combined);
  });
  return [...merged.values()];
}

export function summarizeLineOrders(orders, day) {
  const summary = {};
  const couriers = {};
  let cutoffOrders = 0;
  let cutoffShippedOrders = 0;
  let shippedAllOrders = 0;

  for (const value of mergeOrderRecords(orders)) {
    const rawStatus = String(value?.status || '').toLowerCase();
    const excluded = ['cancelled', 'returned', 'damaged'].includes(rawStatus);
    const matched = isShippedStatus(value);
    const adminScannedAt = String(value?.admin?.scannedAt || '');
    const packerScannedAt = String(value?.packerScan?.scannedAt || '');
    const adminSeconds = scanSeconds(adminScannedAt);
    const packerSeconds = scanSeconds(packerScannedAt);
    const inCutoffCohort = !excluded && adminScannedAt.startsWith(`${day}T`) && adminSeconds !== null && adminSeconds <= 14 * 60 * 60;
    const shippedOnDay = !excluded && matched && packerScannedAt.startsWith(`${day}T`) && packerSeconds !== null && packerSeconds <= 18 * 60 * 60;

    if (inCutoffCohort) cutoffOrders += 1;
    if (inCutoffCohort && shippedOnDay) cutoffShippedOrders += 1;
    if (!shippedOnDay) continue;

    shippedAllOrders += 1;
    const courier = String(value?.courier || 'ไม่ระบุขนส่ง').trim() || 'ไม่ระบุขนส่ง';
    couriers[courier] = (couriers[courier] || 0) + 1;
  }

  const outstandingOrders = Math.max(0, cutoffOrders - cutoffShippedOrders);
  summary['ส่งออกทั้งหมด'] = shippedAllOrders;
  summary['ค้างจากฐานก่อน 14:00'] = outstandingOrders;
  return {
    total: shippedAllOrders,
    summary,
    couriers,
    baseTime: '14:00',
    cutoffOrders,
    cutoffShippedOrders,
    shippedAllOrders,
    outstandingOrders,
    cutoffSla: cutoffOrders ? Math.round((cutoffShippedOrders / cutoffOrders) * 10000) / 100 : null,
    outputRate: cutoffOrders ? Math.round((shippedAllOrders / cutoffOrders) * 10000) / 100 : null,
    matchedBeforeBase: cutoffShippedOrders,
    matchedAfterBase: Math.max(0, shippedAllOrders - cutoffShippedOrders),
    matchedUnknownTime: 0,
  };
}

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function createFirestoreStore(db, {
  now = () => Date.now(),
  sessionTtlMs = SESSION_TTL_MS,
  lockTtlMs = LOCK_TTL_MS,
} = {}) {
  if (!db) throw new TypeError('Firestore database is required');

  const sessionRef = (sessionId) => db.collection(SESSION_COLLECTION).doc(String(sessionId));
  const configRef = (email) => db.collection(SHEET_CONFIG_COLLECTION).doc(stableId(normalizeEmail(email)));
  const lockRef = (resource) => db.collection(LOCK_COLLECTION).doc(stableId(resource));
  const rateRef = () => db.collection(RATE_COLLECTION).doc('all-sheets');

  return {
    async setSession(sessionId, session) {
      await sessionRef(sessionId).set({
        ...session,
        expiresAtMs: now() + sessionTtlMs,
      });
    },

    async getSession(sessionId) {
      if (!sessionId) return null;
      const snapshot = await sessionRef(sessionId).get();
      if (!snapshot.exists) return null;
      const value = snapshot.data() ?? {};
      if (Number(value.expiresAtMs) <= now()) return null;
      const session = { ...value };
      delete session.expiresAtMs;
      return session;
    },

    async deleteSession(sessionId) {
      if (sessionId) await sessionRef(sessionId).delete();
    },

    async getSheetConfig(email) {
      const normalized = normalizeEmail(email);
      if (!normalized) return null;
      const snapshot = await configRef(normalized).get();
      return snapshot.exists ? (snapshot.data()?.config ?? null) : null;
    },

    async setSheetConfig(email, config) {
      const normalized = normalizeEmail(email);
      if (!normalized || !config?.master?.id) return;
      await configRef(normalized).set({ config, updatedAtMs: now() });
    },

    async saveLineEvent(eventId, event) {
      const id = String(eventId ?? '').trim();
      if (!id || !event || typeof event !== 'object') return false;
      const ref = db.collection(LINE_EVENT_COLLECTION).doc(id);
      return db.runTransaction(async (transaction) => {
        const existing = await transaction.get(ref);
        if (existing.exists) return false;
        transaction.create(ref, { ...event, receivedAtMs: now() });
        return true;
      });
    },

    async searchLineTracking(query, { limit = 20 } = {}) {
      const term = String(query ?? '').toLowerCase().replace(/[\s\-_.()/]/g, '');
      if (!term) return [];
      let snapshot;
      try {
        snapshot = await db.collection('orders').orderBy('date', 'desc').limit(3000).get();
      } catch {
        snapshot = await db.collection('orders').limit(3000).get();
      }
      const results = [];
      for (const doc of snapshot.docs) {
        const value = doc.data() ?? {};
        const code = String(value.code ?? value.normalizedCode ?? '');
        const adminCode = String(value.adminCode ?? '');
        const matches = [code, adminCode].some((candidate) => candidate.toLowerCase().replace(/[\s\-_.()/]/g, '').includes(term));
        if (!matches) continue;
        results.push({
          id: doc.id,
          code,
          adminCode,
          courier: String(value.courier ?? ''),
          date: String(value.date ?? ''),
          status: String(value.status ?? ''),
          adminScannedAt: String(value.admin?.scannedAt ?? ''),
          packerScannedAt: String(value.packerScan?.scannedAt ?? ''),
          note: String(value.note ?? ''),
        });
        if (results.length >= limit) break;
      }
      return results;
    },

    async summarizeLineToday(date, { limit = 3000 } = {}) {
      const day = String(date || '').trim();
      const nextDay = nextIsoDay(day);
      let snapshots;
      try {
        snapshots = await Promise.all([
          db.collection('orders').where('admin.scannedAt', '>=', `${day}T00:00:00`).where('admin.scannedAt', '<', `${nextDay}T00:00:00`).limit(limit).get(),
          db.collection('orders').where('packerScan.scannedAt', '>=', `${day}T00:00:00`).where('packerScan.scannedAt', '<', `${nextDay}T00:00:00`).limit(limit).get(),
        ]);
      } catch {
        snapshots = [await db.collection('orders').limit(limit).get()];
      }
      const documents = new Map();
      for (const snapshot of snapshots) for (const doc of snapshot.docs) documents.set(doc.id, doc);
      return summarizeLineOrders([...documents.values()].map((doc) => doc.data() ?? {}), day);
    },

    async acquireLock(resource, lockId) {
      const ref = lockRef(resource);
      return db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        const value = current.exists ? (current.data() ?? {}) : {};
        const currentOwner = String(value.ownerId ?? '');
        const expiresAtMs = Number(value.expiresAtMs) || 0;
        const nowMs = now();
        if (currentOwner && currentOwner !== String(lockId) && expiresAtMs > nowMs) {
          return { acquired: false, retryAfterMs: Math.max(250, expiresAtMs - nowMs) };
        }
        transaction.set(ref, {
          ownerId: String(lockId),
          expiresAtMs: nowMs + lockTtlMs,
          updatedAtMs: nowMs,
        });
        return { acquired: true, retryAfterMs: 250 };
      });
    },

    async renewLock(resource, lockId) {
      const ref = lockRef(resource);
      return db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        const value = current.exists ? (current.data() ?? {}) : {};
        if (String(value.ownerId ?? '') !== String(lockId)) return false;
        const nowMs = now();
        transaction.set(ref, {
          ...value,
          ownerId: String(lockId),
          expiresAtMs: nowMs + lockTtlMs,
          updatedAtMs: nowMs,
        });
        return true;
      });
    },

    async releaseLock(resource, lockId) {
      const ref = lockRef(resource);
      return db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        const value = current.exists ? (current.data() ?? {}) : {};
        if (String(value.ownerId ?? '') !== String(lockId)) return false;
        transaction.delete(ref);
        return true;
      });
    },

    async throttle(requestId, { limit = SHEET_RATE_LIMIT, windowMs = SHEET_RATE_WINDOW_MS } = {}) {
      const ref = rateRef();
      return db.runTransaction(async (transaction) => {
        const current = await transaction.get(ref);
        const value = current.exists ? (current.data() ?? {}) : {};
        const nowMs = now();
        const windowStartedAtMs = Number(value.windowStartedAtMs) || nowMs;
        const withinWindow = nowMs - windowStartedAtMs < windowMs;
        const requestIds = withinWindow && Array.isArray(value.requestIds) ? value.requestIds : [];
        if (requestId && requestIds.includes(String(requestId))) {
          return { acquired: true, retryAfterMs: 0 };
        }
        const count = withinWindow ? Number(value.count) || 0 : 0;
        if (count >= limit) {
          return { acquired: false, retryAfterMs: Math.max(250, windowStartedAtMs + windowMs - nowMs) };
        }
        transaction.set(ref, {
          windowStartedAtMs: withinWindow ? windowStartedAtMs : nowMs,
          count: count + 1,
          requestIds: [...requestIds, String(requestId ?? '')].filter(Boolean).slice(-limit),
          updatedAtMs: nowMs,
        });
        return { acquired: true, retryAfterMs: 0 };
      });
    },
  };
}

let defaultStore;

export function getFirestoreStore() {
  if (!defaultStore) {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    const app = getApps()[0] || initializeApp({
      credential: applicationDefault(),
      ...(projectId ? { projectId } : {}),
    });
    defaultStore = createFirestoreStore(getFirestore(app));
  }
  return defaultStore;
}
