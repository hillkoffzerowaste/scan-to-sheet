import {
  addDoc,
  collection,
  doc,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  startAfter,
  setDoc,
  where,
} from 'firebase/firestore';
import { firebaseAuth, firestoreDb, isFirebaseConfigured, serverTimestamp } from './firebase.js';
import { nextCalendarDate } from './calendarDate.js';
import {
  isSheetSyncClaimable,
  prioritizeSheetSyncCandidates,
  shouldIncludeInManualSheetRecovery,
  shouldReconcileSheetOnRescan,
  isSheetSyncVerified,
} from './sheetSync.js';
import { collectFirestorePages } from './firestorePagination.js';
import { buildRecoveredOrderFields, chooseCanonicalOrder, mergeExistingOrderWithCandidate, mergeScanEventIntoOrder } from './orderRecovery.js';
import { getScanEventDate } from './scanRow.js';
import {
  getMissingOrderQueryFilters,
  getMissingOrderQueryWindow,
  uniqueQueryDates,
} from './firestoreQueryPlanning.js';

// Upper bound on the documents a "ทุกวัน" search may read. The search itself keeps only 50
// matches, so paging the whole `orders` collection billed a read per order ever scanned to
// display a fixed handful. Orders are swept newest-first, so a full code still resolves via
// the indexed lookup in searchScansFirestore even when it falls outside this window.
const ALL_DAY_SEARCH_SCAN_LIMIT = 2000;

// Upper bound on the documents the Drive badge's periodic check may read. An order stays in
// `status: 'pending'` until a Packer scans it, so the set never shrinks on its own and the
// sweep billed a read per stale order every interval, forever. Reading newest-first makes the
// cap safe: the caller discards every order older than its lookback window anyway.
const PENDING_BADGE_SCAN_LIMIT = 500;

// Upper bound on one day's orders. A day is already a narrow window, but "narrow" is not
// "bounded": a bad import or a runaway retry can leave far more documents on a date than a
// warehouse ships, and the daily reads run on a timer. Paging to a declared ceiling keeps
// the cost knowable, and hitting it is logged rather than silently truncated.
const DAILY_ORDER_SCAN_LIMIT = 3000;

// Custom couriers are added by hand from the UI; a few dozen is the realistic ceiling.
const COURIER_SCAN_LIMIT = 200;

/**
 * Report a query that came back exactly at its ceiling. Silent truncation is the failure
 * mode these caps introduce — a report that quietly drops rows looks like missing data.
 */
function warnIfCapped(label, count, cap) {
  if (count >= cap) {
    console.warn(`${label}: hit the ${cap}-document ceiling; results may be incomplete.`);
  }
  return count;
}

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

const ORDER_AUDIT_EVENTS = new Set([
  'admin_scanned',
  'packer_scanned',
  'sheet_sync_pending',
  'sheet_sync_writing',
  'sheet_sync_verified',
  'sheet_sync_failed',
  'status_repaired',
]);

function currentActor() {
  return userPayload(firebaseAuth?.currentUser);
}

function orderAuditPayload({ orderId: id, order, type, detail = {}, actor = currentActor() }) {
  if (!ORDER_AUDIT_EVENTS.has(type)) throw new Error(`Unsupported order audit event: ${type}`);
  return {
    orderId: id,
    type,
    code: String(order?.code ?? order?.normalizedCode ?? ''),
    courier: String(order?.courier ?? ''),
    actor,
    detail,
    createdAt: serverTimestamp(),
    createdAtIso: nowIso(),
  };
}

function addOrderAuditInTransaction(transaction, { orderId: id, order, type, detail = {}, actor = currentActor() }) {
  // Firestore event documents are append-only. Keeping this in the same transaction as the
  // order transition means an audit entry cannot be lost when a scan/update succeeds.
  transaction.set(doc(collection(firestoreDb, 'orderAuditEvents')), orderAuditPayload({
    orderId: id, order, type, detail, actor,
  }));
}

function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function orderId({ date, courier, code }) {
  return [date, courier, normalizeCode(code)]
    .map((part) => String(part ?? '').trim().replace(/[\/\\#?\[\]]/g, '_'))
    .join('__');
}

function nowIso() {
  return new Date().toISOString();
}

function newSheetSyncAttemptId() {
  return `sheet_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function pendingSheetSyncFields(attemptId = newSheetSyncAttemptId()) {
  return {
    sheetSyncStatus: 'pending',
    sheetSyncError: '',
    sheetSyncAttemptId: attemptId,
    sheetSyncStartedAtIso: nowIso(),
  };
}

function baseOrderPayload({ type, code, courier, date, time, user, packer = '', note = '', sheetSyncAttemptId = undefined }) {
  return {
    code,
    normalizedCode: normalizeCode(code),
    courier,
    date,
    packer,
    note,
    status: type === 'admin' ? 'pending' : 'packer_scanned',
    ...pendingSheetSyncFields(sheetSyncAttemptId),
    updatedAt: serverTimestamp(),
    updatedAtIso: nowIso(),
    user: userPayload(user),
    createdBy: userPayload(user),
    admin: type === 'admin'
      ? {
          scannedAt: `${date}T${time}`,
          scannedBy: userPayload(user),
        }
      : null,
    packerScan: type === 'packer'
      ? {
          scannedAt: `${date}T${time}`,
          scannedBy: userPayload(user),
          packer,
          note,
        }
      : null,
  };
}

function isCancelledOrder(order) {
  return order.status === 'cancelled' || String(order.note ?? '').includes('ยกเลิก');
}

function isDamagedOrder(order) {
  return order.status === 'damaged' || String(order.note ?? '').includes('เสียหาย');
}

function isReturnedOrder(order) {
  return order.status === 'returned' || String(order.note ?? '').includes('ตีกลับ');
}

function timeFromScan(scan, fallback = '') {
  const value = scan?.scannedAt ?? fallback;
  return String(value).includes('T') ? String(value).split('T')[1] : value;
}

function orderToRow(order, id = '') {
  const packerScan = order.packerScan ?? null;
  const admin = order.admin ?? null;
  const code = order.code || order.normalizedCode || '';
  const packerTime = timeFromScan(packerScan, order.time || '');
  const adminTime = timeFromScan(admin, order.time || '');
  const hasPacker = Boolean(packerScan?.scannedAt || order.status === 'packer_scanned' || order.status === 'matched');
  const hasAdmin = Boolean(admin?.scannedAt || order.status === 'pending' || order.status === 'matched');
  const status = isCancelledOrder(order)
    ? 'Cancelled'
    : isReturnedOrder(order)
      ? 'Returned'
    : isDamagedOrder(order)
      ? 'Damaged'
      : hasPacker
        ? 'Success'
        : 'รอแพ็ค';

  return {
    id,
    no: id,
    courierNo: '',
    date: getScanEventDate(order),
    time: packerTime || adminTime,
    courier: order.courier,
    code: hasPacker ? code : '',
    adminCode: hasAdmin ? code : '',
    email: packerScan?.scannedBy?.email || admin?.scannedBy?.email || order.user?.email || '',
    packer: order.packer ?? packerScan?.packer ?? '',
    status,
    note: order.note ?? '',
    adminDate: hasAdmin ? String(admin?.scannedAt ?? order.date).split('T')[0] : '',
    adminTime,
    sheetSyncStatus: order.sheetSyncStatus ?? 'pending',
    sheetSyncError: order.sheetSyncError ?? '',
  };
}

function findRecentOrder(orders, { courier, normalizedCode, days = 3, anyCourier = false }) {
  const now = Date.now();
  const lookbackMs = (days + 1) * 24 * 60 * 60 * 1000;
  return orders.find((order) => {
    const matchesCourier = anyCourier || order.courier === courier;
    const sameOrder = matchesCourier
      && normalizeCode(order.normalizedCode || order.code) === normalizedCode;
    if (!sameOrder) return false;
    const updated = new Date(order.updatedAtIso ?? 0).getTime();
    const withinLookback = !Number.isFinite(updated) || now - updated <= lookbackMs;
    // For cancellation / damage, ignore recency and always match
    return withinLookback || days >= 365;
  }) ?? null;
}

function findRecentAdminOrderByCode(orders, { normalizedCode, days = 3 }) {
  const now = Date.now();
  const lookbackMs = (days + 1) * 24 * 60 * 60 * 1000;
  return orders.find((order) => {
    if (!order.admin?.scannedAt) return false;
    if (normalizeCode(order.normalizedCode || order.code) !== normalizedCode) return false;
    const updated = new Date(order.updatedAtIso ?? 0).getTime();
    const withinLookback = !Number.isFinite(updated) || now - updated <= lookbackMs;
    return withinLookback || days >= 365;
  }) ?? null;
}

async function getRecentOrdersByCode(normalizedCode, maxRows = 10) {
  if (!canWriteFirestore() || !normalizedCode) return [];
  const snap = await getDocs(query(
    collection(firestoreDb, 'orders'),
    where('normalizedCode', '==', normalizedCode),
    orderBy('updatedAt', 'desc'),
    limit(maxRows),
  ));
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

function reportDay(date) {
  return {
    date,
    total: 0,
    cancelledTotal: 0,
    returnedTotal: 0,
    damagedTotal: 0,
    couriers: [],
  };
}

async function getOrdersByDate(date) {
  if (!canWriteFirestore()) {
    return [];
  }

  const orders = await collectFirestorePages(async (cursor, size) => {
    const constraints = [
      collection(firestoreDb, 'orders'),
      where('date', '==', date),
      // Order by id: the equality filter plus __name__ needs no composite index, and a
      // stable order is what makes startAfter paging correct.
      orderBy(documentId()),
      limit(size),
    ];
    if (cursor) {
      constraints.push(startAfter(cursor));
    }
    const snap = await getDocs(query(...constraints));
    return {
      items: snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
      nextCursor: snap.docs.at(-1) ?? null,
    };
  }, { maxItems: DAILY_ORDER_SCAN_LIMIT });

  warnIfCapped(`orders for ${date}`, orders.length, DAILY_ORDER_SCAN_LIMIT);
  return orders;
}

async function getOrdersByDates(dates = []) {
  const queryDates = uniqueQueryDates(dates);
  return (await Promise.all(queryDates.map((date) => getOrdersByDate(date)))).flat();
}

async function getOrdersByAdminScanWindow({ now = new Date(), hoursLookback = 48, pageSize = 500 } = {}) {
  if (!canWriteFirestore()) {
    return [];
  }

  const { start, end } = getMissingOrderQueryWindow({ now, hoursLookback });
  return collectFirestorePages(async (cursor, size) => {
    const constraints = [
      collection(firestoreDb, 'orders'),
      where('admin.scannedAt', '>=', start),
      where('admin.scannedAt', '<', end),
      orderBy('admin.scannedAt', 'asc'),
      limit(size),
    ];
    if (cursor) {
      constraints.push(startAfter(cursor));
    }
    const snap = await getDocs(query(...constraints));
    return {
      items: snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
      nextCursor: snap.docs.at(-1) ?? null,
    };
  }, { pageSize });
}

async function getPendingOrdersForMissingCheck(pageSize = 500) {
  if (!canWriteFirestore()) {
    return [];
  }

  const filter = getMissingOrderQueryFilters({ summaryOnly: true });
  const fetchPage = (newestFirst) => async (cursor, size) => {
    const constraints = [
      collection(firestoreDb, 'orders'),
      where(filter.field, filter.operator, filter.value),
      ...(newestFirst ? [orderBy('admin.scannedAt', 'desc')] : []),
      limit(size),
    ];
    if (cursor) {
      constraints.push(startAfter(cursor));
    }
    const snap = await getDocs(query(...constraints));
    return {
      items: snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
      nextCursor: snap.docs.at(-1) ?? null,
    };
  };

  try {
    return await collectFirestorePages(fetchPage(true), {
      pageSize,
      maxItems: PENDING_BADGE_SCAN_LIMIT,
    });
  } catch (error) {
    // Newest-first needs the (status, admin.scannedAt) composite index. While that index is
    // still building, sweep unordered instead of blanking the badge. The fallback stays
    // uncapped on purpose: without an order, Firestore returns documents by id — that is
    // `date__courier__code`, so a cap there would keep the oldest stale orders and drop
    // exactly the recent ones the badge is meant to count.
    console.warn('Pending badge query failed; using unordered fallback:', error);
    return collectFirestorePages(fetchPage(false), { pageSize });
  }
}

async function getPackerOrdersByScanDate(date) {
  if (!canWriteFirestore()) {
    return [];
  }

  const start = `${date}T00:00:00`;
  const end = `${nextCalendarDate(date)}T00:00:00`;
  try {
    const orders = await collectFirestorePages(async (cursor, size) => {
      const constraints = [
        collection(firestoreDb, 'orders'),
        where('packerScan.scannedAt', '>=', start),
        where('packerScan.scannedAt', '<', end),
        orderBy('packerScan.scannedAt'),
        limit(size),
      ];
      if (cursor) {
        constraints.push(startAfter(cursor));
      }
      const snap = await getDocs(query(...constraints));
      return {
        items: snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
        nextCursor: snap.docs.at(-1) ?? null,
      };
    }, { maxItems: DAILY_ORDER_SCAN_LIMIT });

    warnIfCapped(`packer scans for ${date}`, orders.length, DAILY_ORDER_SCAN_LIMIT);
    return orders;
  } catch (error) {
    // Keep the Packer screen usable when the nested-field query is temporarily
    // unavailable (for example during an index/rules rollout). The daily
    // order query is already used by the rows view, so use it as a safe
    // fallback and filter the scan timestamp locally.
    console.warn('Packer summary query failed; using daily-order fallback:', error);
    const orders = await getOrdersByDate(date);
    return orders.filter((order) => {
      const scannedAt = String(order.packerScan?.scannedAt ?? '');
      return scannedAt >= start && scannedAt < end;
    });
  }
}

async function getAdminOrdersByScanDate(date) {
  if (!canWriteFirestore()) {
    return [];
  }

  const start = `${date}T00:00:00`;
  const end = `${nextCalendarDate(date)}T00:00:00`;
  try {
    const orders = await collectFirestorePages(async (cursor, size) => {
      const constraints = [
        collection(firestoreDb, 'orders'),
        where('admin.scannedAt', '>=', start),
        where('admin.scannedAt', '<', end),
        orderBy('admin.scannedAt'),
        limit(size),
      ];
      if (cursor) {
        constraints.push(startAfter(cursor));
      }
      const snap = await getDocs(query(...constraints));
      return {
        items: snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
        nextCursor: snap.docs.at(-1) ?? null,
      };
    }, { maxItems: DAILY_ORDER_SCAN_LIMIT });

    warnIfCapped(`admin scans for ${date}`, orders.length, DAILY_ORDER_SCAN_LIMIT);
    return orders;
  } catch (error) {
    console.warn('Admin summary query failed; using daily-order fallback:', error);
    const orders = await getOrdersByDate(date);
    return orders.filter((order) => {
      const scannedAt = String(order.admin?.scannedAt ?? '');
      return scannedAt >= start && scannedAt < end;
    });
  }
}

async function getAllOrders(pageSize = 500, maxItems = ALL_DAY_SEARCH_SCAN_LIMIT) {
  if (!canWriteFirestore()) {
    return [];
  }

  return collectFirestorePages(async (cursor, size) => {
    const constraints = [
      collection(firestoreDb, 'orders'),
      orderBy('updatedAt', 'desc'),
      limit(size),
    ];
    if (cursor) {
      constraints.push(startAfter(cursor));
    }
    const snap = await getDocs(query(...constraints));
    return {
      items: snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
      nextCursor: snap.docs.at(-1) ?? null,
    };
  }, { pageSize, maxItems });
}

/**
 * Source orders for a "ทุกวัน" search, which has no date window to bound it.
 *
 * A full tracking number resolves through the `normalizedCode` index and so reaches any day
 * at the cost of one indexed query. Only a partial code needs the sweep, and that one stops
 * at ALL_DAY_SEARCH_SCAN_LIMIT instead of reading the entire collection.
 */
async function getOrdersForAllDaySearch(normalizedCode, maxRows) {
  const exactMatches = await getRecentOrdersByCode(normalizedCode, maxRows);
  return exactMatches.length ? exactMatches : getAllOrders();
}

async function getScanEventCandidates(normalizedCode, rawCode) {
  if (!canWriteFirestore() || !normalizedCode) return [];

  const snapshots = await Promise.all([
    getDocs(query(
      collection(firestoreDb, 'scanEvents'),
      where('normalizedCode', '==', normalizedCode),
      limit(50),
    )),
    getDocs(query(
      collection(firestoreDb, 'scanEvents'),
      where('code', '==', rawCode),
      limit(50),
    )),
  ]);
  const candidates = new Map();

  for (const snap of snapshots) {
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      if (data.duplicateOf) continue;
      const candidateId = orderId({
        date: data.date,
        courier: data.courier,
        code: data.normalizedCode || data.code || normalizedCode,
      });
      const event = {
        ...data,
        id: docSnap.id,
        createdAtIso: data.createdAt
          ? (typeof data.createdAt.toDate === 'function' ? data.createdAt.toDate().toISOString() : data.createdAt)
          : '',
      };
      const current = candidates.get(candidateId);
      const merged = mergeScanEventIntoOrder(current, event);
      candidates.set(candidateId, { ...merged, id: candidateId, fromScanEvents: true });
    }
  }

  return [...candidates.values()];
}

export function canUseFirestorePrimary() {
  return canWriteFirestore();
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
  if (!canWriteFirestore()) {
    throw new Error('Firestore unavailable');
  }

  if (!result?.code) {
    return;
  }

  await addDoc(collection(firestoreDb, 'scanEvents'), {
    type,
    code: result.code,
    normalizedCode: normalizeCode(result.code).toUpperCase(),
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

export async function recordPackerScanPrimary({ code, courier, date, time, user, packer = '', note = '' }) {
  if (!canWriteFirestore()) {
    return null;
  }

  const normalizedCode = normalizeCode(code).toUpperCase();
  // These lookups do not depend on one another. Run them together so the scan confirmation
  // waits for one Firestore round trip rather than serial reads before its transaction.
  const [byNormalized, rawDocs, byScanEvents] = await Promise.all([
    getRecentOrdersByCode(normalizedCode, 50),
    getDocs(query(
      collection(firestoreDb, 'orders'),
      where('code', '==', code),
      limit(50),
    )).then((rawSnap) => rawSnap.docs.map((item) => ({ id: item.id, ...item.data() }))).catch(() => []),
    getScanEventCandidates(normalizedCode, code).catch(() => []),
  ]);
  const existingIds = new Set(byNormalized.map((order) => order.id));
  // Older orders can have only `code`. De-duplicate after the parallel raw-code query returns.
  const byRawCode = rawDocs.filter((order) => !existingIds.has(order.id));
  const allCandidates = [...byNormalized, ...byRawCode, ...byScanEvents];

  // Find best matching existing order — prioritize admin-scanned, then any packer
  // For cancellation/damage, ignore courier constraint so cross-courier edits work
  const isCancelling = note === 'ลูกค้ายกเลิก';
  const anyCourier = isCancelling;
  const recent = chooseCanonicalOrder(allCandidates, normalizedCode)
    ?? findRecentAdminOrderByCode(allCandidates, { normalizedCode, days: 365 })
    ?? findRecentOrder(allCandidates, { courier, normalizedCode, days: 365, anyCourier });

  // If still not found, look for ANY order with this code regardless of courier/recency
  const fallbackByCode = !recent
    ? allCandidates.find((order) => normalizeCode(order.normalizedCode || order.code) === normalizedCode)
    : null;

  // Always use existing document ID when found; otherwise generate ID using the original order's date
  const existingOrder = recent || fallbackByCode;
  const ref = doc(firestoreDb, 'orders', existingOrder?.id ?? orderId({
    date: existingOrder?.date ?? date,
    courier: existingOrder?.courier ?? courier,
    code: normalizedCode,
  }));
  const attemptId = newSheetSyncAttemptId();

  const result = await runTransaction(firestoreDb, async (transaction) => {
    const snap = await transaction.get(ref);
    const existing = snap.exists() ? snap.data() : null;

    if (existing?.packerScan?.scannedAt && note !== 'ลูกค้ายกเลิก') {
      const needsSheetRetry = shouldReconcileSheetOnRescan(existing, 'packerScan');
      if (needsSheetRetry) {
        transaction.set(ref, {
          ...pendingSheetSyncFields(attemptId),
          updatedAt: serverTimestamp(),
          updatedAtIso: nowIso(),
        }, { merge: true });
      }
      return {
        status: needsSheetRetry ? (existing.admin?.scannedAt ? 'matched' : 'created') : 'duplicate',
        id: ref.id,
        existing,
        sheetSyncAttemptId: needsSheetRetry ? attemptId : (existing.sheetSyncAttemptId ?? ''),
        sheetSyncStatus: needsSheetRetry ? 'pending' : (existing.sheetSyncStatus ?? 'pending'),
      };
    }

    // When the order was found only via scanEvents (not in orders), treat the synthetic as existing
    // so we update with the correct original date and courier instead of today's values
    const recoveryCandidate = existingOrder?.fromScanEvents ? existingOrder : null;
    const effectiveExisting = existing
      ? mergeExistingOrderWithCandidate(existing, recoveryCandidate)
      : recoveryCandidate;

    const wrongCourier = Boolean(effectiveExisting?.admin?.scannedAt && effectiveExisting.courier && effectiveExisting.courier !== courier);
    const correctedNote = wrongCourier
      ? [note, `แพ็คเกอร์เลือกขนส่งไม่ตรงกับแอดมิน (เลือก ${courier})`].filter(Boolean).join(' | ')
      : note;
    const nextStatus = effectiveExisting?.admin?.scannedAt ? 'matched' : note ? 'issue' : 'packer_scanned';
    const effectiveDate = effectiveExisting?.date ?? date;
    const effectiveCourier = effectiveExisting?.courier ?? courier;
    const recoveredFields = effectiveExisting
      ? buildRecoveredOrderFields({
          effectiveExisting,
          date,
          time,
          courier,
          code: normalizedCode,
          packer,
          note: correctedNote,
          user,
        })
      : null;
    const payload = effectiveExisting
      ? {
          ...recoveredFields,
          packer,
          date: effectiveDate,
          note: correctedNote,
          status: nextStatus,
          courier: effectiveCourier,
          ...pendingSheetSyncFields(attemptId),
          updatedAt: serverTimestamp(),
          updatedAtIso: nowIso(),
          user: userPayload(user),
          packerScan: {
            scannedAt: `${date}T${time}`,
            scannedBy: userPayload(user),
            packer,
            note: correctedNote,
          },
        }
      : {
          ...baseOrderPayload({ type: 'packer', code: normalizedCode, courier, date, time, user, packer, note, sheetSyncAttemptId: attemptId }),
          status: nextStatus,
          createdAt: serverTimestamp(),
          createdAtIso: nowIso(),
        };

    transaction.set(ref, payload, { merge: true });
    addOrderAuditInTransaction(transaction, {
      orderId: ref.id,
      order: payload,
      type: 'packer_scanned',
      detail: { note: correctedNote },
      actor: userPayload(user),
    });

    const adminScannedAt = effectiveExisting?.admin?.scannedAt ?? '';
    return {
      status: effectiveExisting?.admin?.scannedAt ? 'matched' : 'created',
      id: ref.id,
      existing: existing ?? effectiveExisting,
      wrongCourier,
      courier: effectiveCourier,
      admin: effectiveExisting?.admin ?? null,
      adminDate: adminScannedAt.split('T')[0] || effectiveDate,
      adminTime: adminScannedAt.split('T')[1] || '',
      adminCode: effectiveExisting?.code || normalizedCode,
      sheetSyncStatus: 'pending',
      sheetSyncAttemptId: attemptId,
    };
  });

  return result;
}

export async function recordAdminScanPrimary({ code, courier, date, time, user }) {
  if (!canWriteFirestore()) {
    return null;
  }

  const normalizedCode = normalizeCode(code).toUpperCase();
  const [orderCandidates, scanEventCandidates] = await Promise.all([
    getRecentOrdersByCode(normalizedCode, 50),
    getScanEventCandidates(normalizedCode, code).catch(() => []),
  ]);
  const allCandidates = [...orderCandidates, ...scanEventCandidates];
  const recent = chooseCanonicalOrder(allCandidates, normalizedCode)
    ?? findRecentOrder(allCandidates, { courier, normalizedCode });
  const ref = doc(firestoreDb, 'orders', recent?.id ?? orderId({ date, courier, code: normalizedCode }));
  const attemptId = newSheetSyncAttemptId();

  const result = await runTransaction(firestoreDb, async (transaction) => {
    const snap = await transaction.get(ref);
    const existing = snap.exists() ? snap.data() : null;

    if (existing?.admin?.scannedAt) {
      // A manual rescan is an explicit request to reconcile the Sheet. Keep
      // the Firestore document as the source of truth, but issue a fresh
      // attempt for every unsynced state, including a recent pending attempt.
      const needsSheetRetry = shouldReconcileSheetOnRescan(existing, 'admin');
      if (needsSheetRetry) {
        transaction.set(ref, {
          ...pendingSheetSyncFields(attemptId),
          updatedAt: serverTimestamp(),
          updatedAtIso: nowIso(),
        }, { merge: true });
      }
      return {
        status: needsSheetRetry ? (existing.packerScan?.scannedAt ? 'matched' : 'retry') : 'duplicate',
        id: ref.id,
        existing,
        sheetSyncAttemptId: needsSheetRetry ? attemptId : (existing.sheetSyncAttemptId ?? ''),
        sheetSyncStatus: needsSheetRetry ? 'pending' : (existing.sheetSyncStatus ?? 'pending'),
      };
    }

    const recoveryCandidate = recent?.fromScanEvents ? recent : null;
    const effectiveExisting = existing
      ? mergeExistingOrderWithCandidate(existing, recoveryCandidate)
      : recoveryCandidate;
    const nextStatus = effectiveExisting?.packerScan?.scannedAt ? 'matched' : 'pending';
    const payload = existing
      ? {
          code: effectiveExisting?.code || normalizedCode,
          normalizedCode: effectiveExisting?.normalizedCode || normalizedCode,
          courier: effectiveExisting?.courier || courier,
          date: effectiveExisting?.date || date,
          packer: effectiveExisting?.packer || '',
          note: effectiveExisting?.note || '',
          ...(effectiveExisting?.packerScan ? { packerScan: effectiveExisting.packerScan } : {}),
          status: nextStatus,
          ...pendingSheetSyncFields(attemptId),
          updatedAt: serverTimestamp(),
          updatedAtIso: nowIso(),
          user: userPayload(user),
          admin: {
            scannedAt: `${date}T${time}`,
            scannedBy: userPayload(user),
          },
        }
      : effectiveExisting
        ? {
            code: effectiveExisting.code || normalizedCode,
            normalizedCode: effectiveExisting.normalizedCode || normalizedCode,
            courier: effectiveExisting.courier || courier,
            date: effectiveExisting.date || date,
            packer: effectiveExisting.packer || '',
            note: effectiveExisting.note || '',
            status: nextStatus,
            admin: {
              scannedAt: `${date}T${time}`,
              scannedBy: userPayload(user),
            },
            packerScan: effectiveExisting.packerScan || null,
            ...pendingSheetSyncFields(attemptId),
            updatedAt: serverTimestamp(),
            updatedAtIso: nowIso(),
            user: userPayload(user),
            createdAt: serverTimestamp(),
            createdAtIso: nowIso(),
          }
      : {
          ...baseOrderPayload({ type: 'admin', code: normalizedCode, courier, date, time, user, sheetSyncAttemptId: attemptId }),
          status: nextStatus,
          createdAt: serverTimestamp(),
          createdAtIso: nowIso(),
        };

    transaction.set(ref, payload, { merge: true });
    addOrderAuditInTransaction(transaction, {
      orderId: ref.id,
      order: payload,
      type: 'admin_scanned',
      actor: userPayload(user),
    });

    return {
      status: effectiveExisting?.packerScan?.scannedAt ? 'matched' : 'created',
      id: ref.id,
      existing: existing ?? effectiveExisting,
      sheetSyncStatus: 'pending',
      sheetSyncAttemptId: attemptId,
    };
  });

  return result;
}

export async function markSheetSyncWriting({ orderId: id, attemptId = '', recordAudit = true }) {
  if (!canWriteFirestore() || !id) return false;

  const ref = doc(firestoreDb, 'orders', id);
  return runTransaction(firestoreDb, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) return false;
    const current = snap.data();
    if (attemptId && current.sheetSyncAttemptId !== attemptId) return false;
    if (isSheetSyncVerified(current)) return false;
    transaction.update(ref, {
      sheetSyncStatus: 'writing',
      sheetSyncError: '',
      sheetSyncStartedAtIso: nowIso(),
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso(),
    });
    if (recordAudit) {
      addOrderAuditInTransaction(transaction, {
        orderId: id,
        order: current,
        type: 'sheet_sync_writing',
        detail: { attemptId: current.sheetSyncAttemptId ?? '' },
      });
    }
    return true;
  });
}

export async function markSheetSyncResult({ orderId: id, attemptId = '', ok, result = null, error = null, recordAudit = true }) {
  if (!canWriteFirestore() || !id) {
    return false;
  }

  const ref = doc(firestoreDb, 'orders', id);
  return runTransaction(firestoreDb, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) return false;
    const current = snap.data();
    if (attemptId && current.sheetSyncAttemptId !== attemptId) return false;
    const nextStatus = ok ? 'verified' : 'failed';
    transaction.update(ref, {
      sheetSyncStatus: nextStatus,
      sheetSyncError: ok ? '' : String(error?.message ?? error ?? 'Unknown sync error'),
      sheetSyncedAt: ok ? serverTimestamp() : null,
      sheetVerifiedAt: ok ? serverTimestamp() : null,
      sheetVerifiedAtIso: ok ? nowIso() : '',
      sheetResultStatus: result?.status ?? '',
      sheetUrl: result?.sheetUrl ?? '',
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso(),
    });
    // A periodic readback may find an already-correct row. Record the first verification
    // and every repair, but do not flood the audit trail for routine no-change checks.
    const type = ok
      ? result?.repaired
        ? 'status_repaired'
        : isSheetSyncVerified(current) && result?.status === 'duplicate'
          ? null
          : 'sheet_sync_verified'
      : 'sheet_sync_failed';
    if (type && recordAudit) {
      addOrderAuditInTransaction(transaction, {
        orderId: id,
        order: current,
        type,
        detail: ok
          ? { attemptId: current.sheetSyncAttemptId ?? '', sheetStatus: result?.status ?? '' }
          : { attemptId: current.sheetSyncAttemptId ?? '', error: String(error?.message ?? error ?? 'Unknown sync error').slice(0, 500) },
      });
    }
    return true;
  });
}

export async function claimRecoverableSheetSyncs({
  maxRows = 20,
  includeSynced = false,
  role = 'both',
  dates = [],
  recordAudit = true,
} = {}) {
  if (!canWriteFirestore()) return [];
  let candidates;
  if (includeSynced) {
    const recoveryDates = [...new Set(dates.filter(Boolean))];
    const dateOrders = await getOrdersByDates(recoveryDates);
    const scanDateOrders = role === 'admin'
      ? []
      : (await Promise.all(recoveryDates.map((date) => getPackerOrdersByScanDate(date)))).flat();
    const adminScanOrders = role === 'packer'
      ? []
      : await getOrdersByAdminScanWindow({ hoursLookback: 48, pageSize: Math.min(100, maxRows * 5) }).catch(() => []);
    const byId = new Map([...dateOrders, ...scanDateOrders, ...adminScanOrders].map((order) => [order.id, order]));
    const eligible = [...byId.values()].filter((order) => shouldIncludeInManualSheetRecovery(order, role));
    const failed = eligible.filter((order) => order.sheetSyncStatus === 'failed');
    const pending = eligible.filter((order) => order.sheetSyncStatus === 'pending');
    // Rotate routine verification across the whole day: the least recently read-back row
    // goes first, so the first 20 document ids are not the only rows checked forever.
    const verified = eligible
      .filter((order) => isSheetSyncVerified(order))
      .sort((left, right) => {
        const leftAt = new Date(left.sheetVerifiedAtIso ?? 0).getTime() || 0;
        const rightAt = new Date(right.sheetVerifiedAtIso ?? 0).getTime() || 0;
        return leftAt - rightAt;
      });
    candidates = [...prioritizeSheetSyncCandidates({ failed, pending, maxRows }), ...verified]
      .filter((order, index, list) => list.findIndex((item) => item.id === order.id) === index)
      .slice(0, Math.max(0, maxRows));
  } else {
    const statuses = ['failed', 'pending', 'writing'];
    const snapshots = await Promise.all(statuses.map((status) => getDocs(query(
      collection(firestoreDb, 'orders'), where('sheetSyncStatus', '==', status), limit(maxRows),
    ))));
    candidates = prioritizeSheetSyncCandidates({
      failed: snapshots[0]?.docs,
      pending: [...(snapshots[1]?.docs ?? []), ...(snapshots[2]?.docs ?? [])],
      maxRows,
    });
  }
  const claimed = [];

  for (const candidate of candidates) {
    const ref = candidate.ref ?? doc(firestoreDb, 'orders', candidate.id);
    const attemptId = newSheetSyncAttemptId();
    const order = await runTransaction(firestoreDb, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) return null;
      const current = snap.data();
      const manualSyncedClaim = includeSynced
        && isSheetSyncVerified(current)
        && shouldIncludeInManualSheetRecovery({ id: ref.id, ...current }, role);
      if (manualSyncedClaim ? false : !isSheetSyncClaimable(current)) return null;
      transaction.update(ref, {
        ...pendingSheetSyncFields(attemptId),
        updatedAt: serverTimestamp(),
        updatedAtIso: nowIso(),
      });
      if (recordAudit) {
        addOrderAuditInTransaction(transaction, {
          orderId: ref.id,
          order: current,
          type: 'sheet_sync_pending',
          detail: { attemptId, recovery: true },
        });
      }
      return { id: ref.id, ...current, sheetSyncAttemptId: attemptId, sheetSyncStatus: 'pending' };
    });
    if (order) claimed.push(order);
  }

  return claimed;
}

function courierDocId(name) {
  return String(name ?? '').trim().toLowerCase().replace(/[\/\\#?\[\]]/g, '_').slice(0, 120);
}

function mergeCouriers(defaultCouriers, extraCouriers) {
  return [...new Set([...defaultCouriers, ...extraCouriers]
    .map((name) => String(name ?? '').trim())
    .filter(Boolean))];
}

const COURIER_CACHE_KEY = 'scan-to-sheet-couriers-cache-v1';
const COURIER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function loadCachedCouriers() {
  try {
    const cached = JSON.parse(localStorage.getItem(COURIER_CACHE_KEY));
    if (cached && cached.time && Date.now() - cached.time < COURIER_CACHE_TTL_MS) {
      return cached.data;
    }
  } catch {
    // ignore
  }
  return null;
}

function saveCachedCouriers(data) {
  try {
    localStorage.setItem(COURIER_CACHE_KEY, JSON.stringify({ time: Date.now(), data }));
  } catch {
    // ignore
  }
}

export function subscribeCouriers({ defaultCouriers = [], onChange, onError }) {
  if (!canWriteFirestore()) {
    onChange?.(mergeCouriers(defaultCouriers, []));
    return () => {};
  }

  let cancelled = false;

  void (async () => {
    // Serve cache immediately if available
    const cached = loadCachedCouriers();
    if (cached && !cancelled) {
      onChange?.(mergeCouriers(defaultCouriers, cached));
    }

    try {
      const snapshot = await getDocs(query(
        collection(firestoreDb, 'couriers'),
        limit(COURIER_SCAN_LIMIT),
      ));
      if (cancelled) return;
      warnIfCapped('courier list', snapshot.size, COURIER_SCAN_LIMIT);
      const customCouriers = snapshot.docs.map((item) => item.data().name);
      saveCachedCouriers(customCouriers);
      onChange?.(mergeCouriers(defaultCouriers, customCouriers));
    } catch (error) {
      if (!cancelled) {
        // Fallback to cache on error
        if (cached) {
          onChange?.(mergeCouriers(defaultCouriers, cached));
        }
        onError?.(error);
      }
    }
  })();

  return () => {
    cancelled = true;
  };
}

export async function addCourier({ name, user }) {
  if (!canWriteFirestore()) throw new Error('Firebase ยังไม่พร้อมใช้งาน');
  const courier = String(name ?? '').trim();
  if (!courier) throw new Error('กรุณาระบุชื่อขนส่ง');
  if (courier.length > 80) throw new Error('ชื่อขนส่งยาวเกิน 80 ตัวอักษร');
  const id = courierDocId(courier);
  if (!id) throw new Error('ชื่อขนส่งไม่ถูกต้อง');
  await setDoc(doc(firestoreDb, 'couriers', id), {
    name: courier,
    createdBy: userPayload(user),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return courier;
}

export async function backfillOrdersFromSheetRows({ rows, user }) {
  if (!canWriteFirestore()) {
    return { imported: 0, skipped: rows.length, failed: 0 };
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const code = normalizeCode(row.code || row.adminCode);
    const courier = row.courier;
    const date = row.date || row.adminDate || row._sheetDate;
    if (!code || !courier || !date) {
      skipped += 1;
      continue;
    }

    const ref = doc(firestoreDb, 'orders', orderId({ date, courier, code }));
    const hasPacker = Boolean(row.code);
    const hasAdmin = Boolean(row.adminCode);
    const note = row.note ?? '';
    // 'Returned' is written to the Sheet by every issue scan carrying the 'สินค้าตีกลับ' note
    // (see getScanIssueMeta). Without this branch a returned parcel came back from the Sheet
    // as 'matched' — counted as shipped — and dropped out of the pending badge's status query.
    const status = row.status === 'Cancelled'
      ? 'cancelled'
      : row.status === 'Returned'
        ? 'returned'
      : row.status === 'Damaged'
        ? 'damaged'
        : hasPacker && hasAdmin
          ? 'matched'
          : hasPacker
            ? 'packer_scanned'
            : 'pending';

    try {
      await setDoc(
        ref,
        {
          code,
          normalizedCode: code,
          courier,
          date,
          packer: row.packer ?? '',
          note,
          status,
          sheetSyncStatus: 'verified',
          sheetSyncError: '',
          sheetSyncedAt: serverTimestamp(),
          sheetUrl: row.sheetUrl ?? '',
          importedFromSheet: true,
          importedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedAtIso: nowIso(),
          user: userPayload(user),
          createdBy: userPayload(user),
          admin: hasAdmin
            ? {
                scannedAt: `${row.adminDate || date}T${row.adminTime || row.time || '00:00:00'}`,
                scannedBy: { email: row.email ?? '', name: '', uid: '' },
              }
            : null,
          packerScan: hasPacker
            ? {
                scannedAt: `${date}T${row.time || row.adminTime || '00:00:00'}`,
                scannedBy: { email: row.email ?? '', name: '', uid: '' },
                packer: row.packer ?? '',
                note,
              }
            : null,
        },
        { merge: true },
      );
      imported += 1;
    } catch {
      failed += 1;
    }
  }

  return { imported, skipped, failed };
}

export async function fetchTodaySummaryFirestore({ couriers = [], date }) {
  const orders = await getPackerOrdersByScanDate(date);
  const courierCounts = couriers.map((courier) => ({
    courier,
    count: orders.filter((order) => order.courier === courier && order.packerScan?.scannedAt && !isCancelledOrder(order)).length,
  }));

  const packerMap = new Map();
  for (const order of orders) {
    const packer = String(order.packer ?? order.packerScan?.packer ?? '').trim();
    if (packer && order.packerScan?.scannedAt && !isCancelledOrder(order)) {
      packerMap.set(packer, (packerMap.get(packer) ?? 0) + 1);
    }
  }

  return {
    courierCounts,
    packerCounts: [...packerMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([packer, count]) => ({ packer, count })),
  };
}

export async function getTodayRowsFirestore({ courier, date }) {
  const orders = await getPackerOrdersByScanDate(date);
  return orders
    .filter((order) => order.courier === courier && order.packerScan?.scannedAt)
    .sort((a, b) => String(b.packerScan?.scannedAt ?? '').localeCompare(String(a.packerScan?.scannedAt ?? '')))
    .map((order) => orderToRow(order, order.id));
}

export async function getDriveRowsFirestore({ date }) {
  const orders = await getAdminOrdersByScanDate(date);
  return orders
    .filter((order) => order.admin?.scannedAt)
    .sort((a, b) => String(b.admin?.scannedAt ?? '').localeCompare(String(a.admin?.scannedAt ?? '')))
    .map((order) => orderToRow(order, order.id));
}

export async function searchScansFirestore({ query: searchQuery, couriers = [], dates = null, limit: maxRows = 50 }) {
  const term = normalizeCode(searchQuery);
  const sourceOrders = dates?.length
    ? await getOrdersByDates(dates)
    : await getOrdersForAllDaySearch(term, maxRows);

  return sourceOrders
    .filter((order) => {
      const matchesCode = normalizeCode(order.code || order.normalizedCode).includes(term);
      const matchesCourier = couriers.length === 0 || couriers.includes(order.courier);
      return matchesCode && matchesCourier;
    })
    .sort((a, b) => String(b.updatedAtIso ?? '').localeCompare(String(a.updatedAtIso ?? '')))
    .slice(0, maxRows)
    .map((order) => orderToRow(order, order.id));
}

export async function getScanReportFirestore({ couriers = [], dates }) {
  const uniqueDates = [...new Set(dates)].filter(Boolean).sort();
  const orders = (await getOrdersByDates(uniqueDates)).filter((order) => {
    const eventDate = order.packerScan?.scannedAt?.split('T')[0]
      || order.admin?.scannedAt?.split('T')[0]
      || order.date;
    return uniqueDates.includes(eventDate);
  });
  const dayMap = new Map(uniqueDates.map((date) => [date, {
    ...reportDay(date),
    couriers: couriers.map((courier) => ({ courier, count: 0 })),
  }]));
  const courierTotals = couriers.map((courier) => ({ courier, count: 0 }));
  const cancelledRows = [];
  const returnedRows = [];
  const damagedRows = [];

  for (const order of orders) {
    const eventDate = order.packerScan?.scannedAt?.split('T')[0]
      || order.admin?.scannedAt?.split('T')[0]
      || order.date;
    const day = dayMap.get(eventDate);
    if (!day) continue;
    const row = orderToRow(order, order.id);
    const hasPacker = Boolean(order.packerScan?.scannedAt);
    const cancelled = isCancelledOrder(order);
    const damaged = isDamagedOrder(order);
    const returned = isReturnedOrder(order);

    if (cancelled) {
      day.cancelledTotal += 1;
      cancelledRows.push(row);
    } else if (damaged) {
      day.damagedTotal += 1;
      damagedRows.push(row);
    } else if (returned) {
      day.returnedTotal += 1;
      returnedRows.push(row);
    } else if (hasPacker) {
      day.total += 1;
      const dayCourier = day.couriers.find((item) => item.courier === order.courier);
      if (dayCourier) dayCourier.count += 1;
      const totalCourier = courierTotals.find((item) => item.courier === order.courier);
      if (totalCourier) totalCourier.count += 1;
    }
  }

  return {
    total: [...dayMap.values()].reduce((sum, day) => sum + day.total, 0),
    cancelledTotal: cancelledRows.length,
    returnedTotal: returnedRows.length,
    damagedTotal: damagedRows.length,
    couriers: courierTotals,
    days: [...dayMap.values()],
    cancelledRows,
    returnedRows,
    damagedRows,
  };
}

export async function checkMissingOrdersFirestore({
  courier = null,
  hoursLookback = 48,
  thresholdMinutes = 30,
  summaryOnly = false,
}) {
  const now = Date.now();
  // The periodic Drive badge only needs pending orders. Manual checks keep the
  // complete result set so the report can still show every category.
  const orders = summaryOnly
    ? await getPendingOrdersForMissingCheck()
    : await getOrdersByAdminScanWindow({ now: new Date(now), hoursLookback });
  const lookbackMs = hoursLookback * 60 * 60 * 1000;
  const thresholdMs = thresholdMinutes * 60 * 1000;
  const matched = [];
  const pending = [];
  const pendingOverOneDay = [];
  const tooSoon = [];
  const cancelled = [];
  const returned = [];
  const damaged = [];

  for (const order of orders) {
    if (courier && order.courier !== courier) continue;
    if (!order.admin?.scannedAt) continue;
    const adminMs = new Date(order.admin.scannedAt).getTime();
    if (Number.isFinite(adminMs) && now - adminMs > lookbackMs) continue;
    const row = orderToRow(order, order.id);

    if (isCancelledOrder(order)) {
      cancelled.push(row);
    } else if (isReturnedOrder(order)) {
      // A return is recorded as a Packer scan carrying the 'สินค้าตีกลับ' note, so without
      // this branch it satisfied the `packerScan.scannedAt` test below and was counted as
      // 'จับคู่แล้ว' — inflating the shipped figure. The Sheet backend mis-filed the same
      // order as 'pending', so the two backends disagreed on the identical order.
      returned.push(row);
    } else if (isDamagedOrder(order)) {
      damaged.push(row);
    } else if (order.packerScan?.scannedAt) {
      matched.push(row);
    } else if (Number.isFinite(adminMs) && now - adminMs < thresholdMs) {
      tooSoon.push(row);
    } else {
      pending.push(row);
      if (Number.isFinite(adminMs) && now - adminMs >= 24 * 60 * 60 * 1000) pendingOverOneDay.push(row);
    }
  }

  return {
    matched,
    pending,
    pendingOverOneDay,
    tooSoon,
    cancelled,
    returned,
    damaged,
    totalAdminScans: matched.length + pending.length + tooSoon.length
      + cancelled.length + returned.length + damaged.length,
    checkTime: new Date().toISOString(),
    thresholdMinutes,
    hoursLookback,
  };
}
