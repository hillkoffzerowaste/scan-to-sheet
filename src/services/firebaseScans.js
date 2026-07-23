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
  writeBatch,
} from 'firebase/firestore';
import { firestoreDb, isFirebaseConfigured, serverTimestamp } from './firebase.js';
import { marketplaceMetadata } from '../../scripts/marketplace-sync/normalize.js';
import { isCompleteScanOrder, marketplaceMetadataChanged } from './marketplaceImport.js';
import { nextCalendarDate } from './calendarDate.js';
import { isSheetSyncClaimable, shouldReconcileSheetOnRescan } from './sheetSync.js';
import { collectFirestorePages } from './firestorePagination.js';
import { buildRecoveredOrderFields, mergeExistingOrderWithCandidate, mergeScanEventIntoOrder } from './orderRecovery.js';

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
    date: order.date,
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

  const snap = await getDocs(query(collection(firestoreDb, 'orders'), where('date', '==', date)));
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

async function getPackerOrdersByScanDate(date) {
  if (!canWriteFirestore()) {
    return [];
  }

  const start = `${date}T00:00:00`;
  const end = `${nextCalendarDate(date)}T00:00:00`;
  try {
    const snap = await getDocs(query(
      collection(firestoreDb, 'orders'),
      where('packerScan.scannedAt', '>=', start),
      where('packerScan.scannedAt', '<', end),
    ));
    return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
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

async function getAllOrders(pageSize = 500) {
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
  }, { pageSize });
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

export async function findMarketplaceOrderByTracking({ trackingNo }) {
  if (!canWriteFirestore() || !trackingNo) {
    return null;
  }

  const normalizedTrackingNo = normalizeCode(trackingNo).replace(/[^A-Z0-9]/g, '');
  const ordersRef = collection(firestoreDb, 'marketplaceOrders');
  const normalizedSnap = await getDocs(query(
    ordersRef,
    where('normalizedTrackingNo', '==', normalizedTrackingNo),
  ));
  const normalizedDoc = [...normalizedSnap.docs].sort((left, right) => {
    const score = (item) => {
      const data = item.data();
      return (data.orderId ? 2 : 0) + (Array.isArray(data.marketplaceSkus) && data.marketplaceSkus.length ? 1 : 0);
    };
    return score(right) - score(left);
  })[0];
  if (normalizedDoc) {
    return { id: normalizedDoc.id, ...normalizedDoc.data() };
  }

  const exactSnap = await getDocs(query(
    ordersRef,
    where('trackingNo', '==', String(trackingNo).trim()),
  ));
  const exactDoc = [...exactSnap.docs].sort((left, right) => {
    const score = (item) => {
      const data = item.data();
      return (data.orderId ? 2 : 0) + (Array.isArray(data.marketplaceSkus) && data.marketplaceSkus.length ? 1 : 0);
    };
    return score(right) - score(left);
  })[0];
  return exactDoc ? { id: exactDoc.id, ...exactDoc.data() } : null;
}

function sameStringList(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

async function commitMarketplaceWrites(writes) {
  for (let index = 0; index < writes.length; index += 400) {
    const batch = writeBatch(firestoreDb);
    writes.slice(index, index + 400).forEach((write) => {
      batch.set(write.ref, write.data, write.options);
    });
    await batch.commit();
  }
}

export async function importMarketplaceOrders(groups, { knownExistingOrderIds = null } = {}) {
  if (!canWriteFirestore()) throw new Error('Firebase ยังไม่พร้อมใช้งาน');
  const marketplaceCollection = collection(firestoreDb, 'marketplaceOrders');
  const existingOrderIds = new Set(knownExistingOrderIds ?? []);
  const existingOrders = new Map();
  const groupByTracking = new Map(groups.map((group) => [group.normalizedTrackingNo, group]));
  const groupIds = groups.map((group) => `${group.platform}__${group.orderId}`);
  const idsToCheck = [...new Set(groupIds.filter((id) => !existingOrderIds.has(id)))];
  let readQueries = 0;

  for (let index = 0; index < idsToCheck.length; index += 30) {
    const snap = await getDocs(query(
      marketplaceCollection,
      where(documentId(), 'in', idsToCheck.slice(index, index + 30)),
    ));
    readQueries += 1;
    snap.docs.forEach((item) => {
      existingOrderIds.add(item.id);
      existingOrders.set(item.id, item.data());
    });
  }

  const writes = [];
  let metadataUpdated = 0;
  const imported = groups.filter((group, index) => {
    const id = groupIds[index];
    if (existingOrderIds.has(id)) {
      const existing = existingOrders.get(id);
      const canonicalMetadata = {
        trackingNo: group.trackingNo,
        normalizedTrackingNo: group.normalizedTrackingNo,
        marketplaceSkus: group.marketplaceSkus,
        items: Array.isArray(group.items) ? group.items : [],
        sellerOrderStatus: group.sellerOrderStatus ?? '',
        expectedShipAt: group.expectedShipAt ?? '',
        importSource: 'web_upload',
      };
      if (existing && marketplaceMetadataChanged(existing, canonicalMetadata)) {
        writes.push({
          ref: doc(marketplaceCollection, id),
          data: {
            ...canonicalMetadata,
            updatedAt: serverTimestamp(),
          },
          options: { merge: true },
        });
        metadataUpdated += 1;
      }
      return false;
    }
    writes.push({
      ref: doc(marketplaceCollection, id),
      data: {
        platform: group.platform,
        orderId: group.orderId,
        trackingNo: group.trackingNo,
        normalizedTrackingNo: group.normalizedTrackingNo,
        marketplaceSkus: group.marketplaceSkus,
        items: Array.isArray(group.items) ? group.items : [],
        sellerOrderStatus: group.sellerOrderStatus ?? '',
        expectedShipAt: group.expectedShipAt ?? '',
        importSource: 'web_upload',
        importedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
    });
    return true;
  }).length;
  const duplicates = groups.length - imported;
  let matchedScans = 0;
  let updatedScans = 0;
  const scannedTrackingCodes = new Set();
  const trackingCodes = [...groupByTracking.keys()].filter(Boolean);
  for (let index = 0; index < trackingCodes.length; index += 30) {
    const matches = await getDocs(query(
      collection(firestoreDb, 'orders'),
      where('normalizedCode', 'in', trackingCodes.slice(index, index + 30)),
    ));
    readQueries += 1;
    for (const match of matches.docs) {
      matchedScans += 1;
      const current = match.data();
      if (isCompleteScanOrder(current)) {
        scannedTrackingCodes.add(normalizeCode(current.normalizedCode || current.code).replace(/[^A-Z0-9]/g, ''));
      }
      const group = groupByTracking.get(current.normalizedCode);
      if (!group || (
        current.marketplaceOrderId === group.orderId
        && sameStringList(current.marketplaceSkus, group.marketplaceSkus)
        && JSON.stringify(Array.isArray(current.marketplaceItems) ? current.marketplaceItems : [])
          === JSON.stringify(Array.isArray(group.items) ? group.items : [])
      )) continue;
      writes.push({ ref: match.ref, data: {
        marketplaceOrderId: group.orderId,
        marketplaceSkus: group.marketplaceSkus,
        marketplaceItems: Array.isArray(group.items) ? group.items : [],
      }, options: { merge: true } });
      updatedScans += 1;
    }
  }

  await commitMarketplaceWrites(writes);
  const orderStates = groups.map((group) => ({
    ...group,
    scanned: scannedTrackingCodes.has(group.normalizedTrackingNo),
  }));
  return {
    imported, duplicates, metadataUpdated, matchedScans, updatedScans,
    readQueries, writes: writes.length, orderStates,
  };
}

export async function getUploadedMarketplaceOrders() {
  if (!canWriteFirestore()) return [];
  const snap = await getDocs(query(collection(firestoreDb, 'marketplaceOrders'), where('importSource', '==', 'web_upload')));
  return snap.docs.map((item) => {
    const data = item.data();
    return {
      platform: data.platform ?? '', orderId: data.orderId ?? '', trackingNo: data.trackingNo ?? '',
      normalizedTrackingNo: data.normalizedTrackingNo ?? '',
      marketplaceSkus: Array.isArray(data.marketplaceSkus) ? data.marketplaceSkus : [],
      items: Array.isArray(data.items) ? data.items : [],
      sellerOrderStatus: data.sellerOrderStatus ?? '',
      expectedShipAt: data.expectedShipAt ?? '',
    };
  }).filter((item) => item.orderId && (item.normalizedTrackingNo || item.marketplaceSkus.length));
}

async function findMarketplaceMetadataByTracking(trackingNo) {
  const order = await findMarketplaceOrderByTracking({ trackingNo });
  return marketplaceMetadata(order);
}

async function backfillLateMarketplaceMetadata(id, trackingNo, existingMetadata) {
  if (existingMetadata || !id) return;
  const metadata = await findMarketplaceMetadataByTracking(trackingNo);
  if (metadata) {
    await setDoc(doc(firestoreDb, 'orders', id), metadata, { merge: true });
  }
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
  const marketplaceData = await findMarketplaceMetadataByTracking(normalizedCode);

  // Search broadly — older docs may only have `code` not `normalizedCode`
  const byNormalized = await getRecentOrdersByCode(normalizedCode, 50);
  const existingIds = new Set(byNormalized.map((o) => o.id));

  // Also search by raw code field (backwards compat for orders created before normalizedCode existed)
  let byRawCode = [];
  try {
    const rawSnap = await getDocs(query(
      collection(firestoreDb, 'orders'),
      where('code', '==', code),
      limit(50),
    ));
    byRawCode = rawSnap.docs
      .filter((d) => !existingIds.has(d.id))
      .map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    // Field may be missing on some documents — safe to ignore
  }

  const byScanEvents = await getScanEventCandidates(normalizedCode, code).catch(() => []);
  const allCandidates = [...byNormalized, ...byRawCode, ...byScanEvents];

  // Find best matching existing order — prioritize admin-scanned, then any packer
  // For cancellation/damage, ignore courier constraint so cross-courier edits work
  const isCancelling = note === 'ลูกค้ายกเลิก';
  const anyCourier = isCancelling;
  const recent = findRecentAdminOrderByCode(allCandidates, { normalizedCode, days: 365 })
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
      if (marketplaceData) {
        transaction.set(ref, marketplaceData, { merge: true });
      }
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

    if (marketplaceData) {
      Object.assign(payload, marketplaceData);
    }

    transaction.set(ref, payload, { merge: true });

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

  await backfillLateMarketplaceMetadata(result?.id, normalizedCode, marketplaceData);
  return result;
}

export async function recordAdminScanPrimary({ code, courier, date, time, user }) {
  if (!canWriteFirestore()) {
    return null;
  }

  const normalizedCode = normalizeCode(code).toUpperCase();
  const marketplaceData = await findMarketplaceMetadataByTracking(normalizedCode);
  const orderCandidates = await getRecentOrdersByCode(normalizedCode);
  const scanEventCandidates = await getScanEventCandidates(normalizedCode, code).catch(() => []);
  const recent = findRecentOrder([...orderCandidates, ...scanEventCandidates], { courier, normalizedCode });
  const ref = doc(firestoreDb, 'orders', recent?.id ?? orderId({ date, courier, code: normalizedCode }));
  const attemptId = newSheetSyncAttemptId();

  const result = await runTransaction(firestoreDb, async (transaction) => {
    const snap = await transaction.get(ref);
    const existing = snap.exists() ? snap.data() : null;

    if (existing?.admin?.scannedAt) {
      if (marketplaceData) {
        transaction.set(ref, marketplaceData, { merge: true });
      }
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

    if (marketplaceData) {
      Object.assign(payload, marketplaceData);
    }

    transaction.set(ref, payload, { merge: true });

    return {
      status: effectiveExisting?.packerScan?.scannedAt ? 'matched' : 'created',
      id: ref.id,
      existing: existing ?? effectiveExisting,
      sheetSyncStatus: 'pending',
      sheetSyncAttemptId: attemptId,
    };
  });

  await backfillLateMarketplaceMetadata(result?.id, normalizedCode, marketplaceData);
  return result;
}

export async function markSheetSyncResult({ orderId: id, attemptId = '', ok, result = null, error = null }) {
  if (!canWriteFirestore() || !id) {
    return false;
  }

  const ref = doc(firestoreDb, 'orders', id);
  return runTransaction(firestoreDb, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) return false;
    const current = snap.data();
    if (attemptId && current.sheetSyncAttemptId !== attemptId) return false;
    transaction.update(ref, {
      sheetSyncStatus: ok ? 'synced' : 'failed',
      sheetSyncError: ok ? '' : String(error?.message ?? error ?? 'Unknown sync error'),
      sheetSyncedAt: ok ? serverTimestamp() : null,
      sheetResultStatus: result?.status ?? '',
      sheetUrl: result?.sheetUrl ?? '',
      updatedAt: serverTimestamp(),
      updatedAtIso: nowIso(),
    });
    return true;
  });
}

export async function claimRecoverableSheetSyncs({ maxRows = 20 } = {}) {
  if (!canWriteFirestore()) return [];
  const statuses = ['pending', 'failed'];
  const snapshots = await Promise.all(statuses.map((status) => getDocs(query(
    collection(firestoreDb, 'orders'), where('sheetSyncStatus', '==', status), limit(maxRows),
  ))));
  const candidates = snapshots.flatMap((snap) => snap.docs).slice(0, maxRows);
  const claimed = [];

  for (const candidate of candidates) {
    const ref = candidate.ref;
    const attemptId = newSheetSyncAttemptId();
    const order = await runTransaction(firestoreDb, async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) return null;
      const current = snap.data();
      if (!isSheetSyncClaimable(current)) return null;
      transaction.update(ref, {
        ...pendingSheetSyncFields(attemptId),
        updatedAt: serverTimestamp(),
        updatedAtIso: nowIso(),
      });
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
      const snapshot = await getDocs(collection(firestoreDb, 'couriers'));
      if (cancelled) return;
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
    const status = row.status === 'Cancelled'
      ? 'cancelled'
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
          sheetSyncStatus: 'synced',
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
  const orders = await getOrdersByDate(date);
  return orders
    .filter((order) => order.courier === courier && order.packerScan?.scannedAt)
    .sort((a, b) => String(b.packerScan?.scannedAt ?? '').localeCompare(String(a.packerScan?.scannedAt ?? '')))
    .map((order) => orderToRow(order, order.id));
}

export async function getDriveRowsFirestore({ date }) {
  const orders = await getOrdersByDate(date);
  return orders
    .filter((order) => order.admin?.scannedAt)
    .sort((a, b) => String(b.admin?.scannedAt ?? '').localeCompare(String(a.admin?.scannedAt ?? '')))
    .map((order) => orderToRow(order, order.id));
}

export async function searchScansFirestore({ query: searchQuery, couriers = [], dates = null, limit: maxRows = 50 }) {
  const term = normalizeCode(searchQuery);
  const sourceOrders = dates?.length
    ? (await Promise.all(dates.map((date) => getOrdersByDate(date)))).flat()
    : await getAllOrders();

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
  const orders = (await getAllOrders()).filter((order) => {
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

export async function checkMissingOrdersFirestore({ courier = null, hoursLookback = 48, thresholdMinutes = 30 }) {
  const orders = await getAllOrders();
  const now = Date.now();
  const lookbackMs = hoursLookback * 60 * 60 * 1000;
  const thresholdMs = thresholdMinutes * 60 * 1000;
  const matched = [];
  const pending = [];
  const pendingOverOneDay = [];
  const tooSoon = [];
  const cancelled = [];
  const damaged = [];

  for (const order of orders) {
    if (courier && order.courier !== courier) continue;
    if (!order.admin?.scannedAt) continue;
    const adminMs = new Date(order.admin.scannedAt).getTime();
    if (Number.isFinite(adminMs) && now - adminMs > lookbackMs) continue;
    const row = orderToRow(order, order.id);

    if (isCancelledOrder(order)) {
      cancelled.push(row);
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
    damaged,
    totalAdminScans: matched.length + pending.length + tooSoon.length + cancelled.length + damaged.length,
    checkTime: new Date().toISOString(),
    thresholdMinutes,
    hoursLookback,
  };
}
