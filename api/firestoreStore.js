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

function stableId(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
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
      const { expiresAtMs, ...session } = value;
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
    const app = getApps()[0] || initializeApp({ credential: applicationDefault() });
    defaultStore = createFirestoreStore(getFirestore(app));
  }
  return defaultStore;
}
