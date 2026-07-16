import {
  addDoc,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { firestoreDb, isFirebaseConfigured, serverTimestamp } from './firebase.js';
import { marketplaceMetadata } from '../../scripts/marketplace-sync/normalize.js';

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

function baseOrderPayload({ type, code, courier, date, time, user, packer = '', note = '' }) {
  return {
    code,
    normalizedCode: normalizeCode(code),
    courier,
    date,
    packer,
    note,
    status: type === 'admin' ? 'pending' : 'packer_scanned',
    sheetSyncStatus: 'pending',
    sheetSyncError: '',
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

async function findRecentOrder({ courier, normalizedCode, days = 3 }) {
  const orders = await getRecentOrders(500);
  const now = Date.now();
  const lookbackMs = (days + 1) * 24 * 60 * 60 * 1000;
  return orders.find((order) => {
    const sameOrder = order.courier === courier
      && normalizeCode(order.normalizedCode || order.code) === normalizedCode;
    const updated = new Date(order.updatedAtIso ?? 0).getTime();
    return sameOrder && (!Number.isFinite(updated) || now - updated <= lookbackMs);
  }) ?? null;
}

async function findRecentAdminOrderByCode({ normalizedCode, days = 3 }) {
  const orders = await getRecentOrders(500);
  const now = Date.now();
  const lookbackMs = (days + 1) * 24 * 60 * 60 * 1000;
  return orders.find((order) => {
    const updated = new Date(order.updatedAtIso ?? 0).getTime();
    return order.admin?.scannedAt
      && normalizeCode(order.normalizedCode || order.code) === normalizedCode
      && (!Number.isFinite(updated) || now - updated <= lookbackMs);
  }) ?? null;
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

async function getRecentOrders(maxRows = 500) {
  if (!canWriteFirestore()) {
    return [];
  }

  const snap = await getDocs(query(collection(firestoreDb, 'orders'), orderBy('updatedAt', 'desc'), limit(maxRows)));
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
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
    limit(1),
  ));
  const normalizedDoc = normalizedSnap.docs[0];
  if (normalizedDoc) {
    return { id: normalizedDoc.id, ...normalizedDoc.data() };
  }

  const exactSnap = await getDocs(query(
    ordersRef,
    where('trackingNo', '==', String(trackingNo).trim()),
    limit(1),
  ));
  const exactDoc = exactSnap.docs[0];
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
    snap.docs.forEach((item) => existingOrderIds.add(item.id));
  }

  const writes = [];
  const imported = groups.filter((group, index) => {
    const id = groupIds[index];
    if (existingOrderIds.has(id)) return false;
    writes.push({
      ref: doc(marketplaceCollection, id),
      data: {
        platform: group.platform,
        orderId: group.orderId,
        trackingNo: group.trackingNo,
        normalizedTrackingNo: group.normalizedTrackingNo,
        marketplaceSkus: group.marketplaceSkus,
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
      const group = groupByTracking.get(current.normalizedCode);
      if (!group || (
        current.marketplaceOrderId === group.orderId
        && sameStringList(current.marketplaceSkus, group.marketplaceSkus)
      )) continue;
      writes.push({ ref: match.ref, data: {
        marketplaceOrderId: group.orderId,
        marketplaceSkus: group.marketplaceSkus,
      }, options: { merge: true } });
      updatedScans += 1;
    }
  }

  await commitMarketplaceWrites(writes);
  return { imported, duplicates, matchedScans, updatedScans, readQueries, writes: writes.length };
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
    };
  }).filter((item) => item.orderId && item.normalizedTrackingNo);
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
  if (!canWriteFirestore() || !result?.code) {
    return;
  }

  await addDoc(collection(firestoreDb, 'scanEvents'), {
    type,
    code: result.code,
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

  const normalizedCode = normalizeCode(code);
  const marketplaceData = await findMarketplaceMetadataByTracking(normalizedCode);
  const recent = await findRecentAdminOrderByCode({ normalizedCode }) ?? await findRecentOrder({ courier, normalizedCode });
  const ref = doc(firestoreDb, 'orders', recent?.id ?? orderId({ date, courier, code: normalizedCode }));

  const result = await runTransaction(firestoreDb, async (transaction) => {
    const snap = await transaction.get(ref);
    const existing = snap.exists() ? snap.data() : null;

    if (existing?.packerScan?.scannedAt && note !== 'ลูกค้ายกเลิก') {
      if (marketplaceData) {
        transaction.set(ref, marketplaceData, { merge: true });
      }
      return {
        status: 'duplicate',
        id: ref.id,
        existing,
        sheetSyncStatus: existing.sheetSyncStatus ?? 'pending',
      };
    }

    const wrongCourier = Boolean(existing?.admin?.scannedAt && existing.courier && existing.courier !== courier);
    const correctedNote = wrongCourier
      ? [note, `แพ็คเกอร์เลือกขนส่งไม่ตรงกับแอดมิน (เลือก ${courier})`].filter(Boolean).join(' | ')
      : note;
    const nextStatus = existing?.admin?.scannedAt ? 'matched' : note ? 'issue' : 'packer_scanned';
    const payload = existing
      ? {
          packer,
          note: correctedNote,
          status: nextStatus,
          sheetSyncStatus: 'pending',
          sheetSyncError: '',
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
          ...baseOrderPayload({ type: 'packer', code: normalizedCode, courier, date, time, user, packer, note }),
          status: nextStatus,
          createdAt: serverTimestamp(),
          createdAtIso: nowIso(),
        };

    if (marketplaceData) {
      Object.assign(payload, marketplaceData);
    }

    transaction.set(ref, payload, { merge: true });

    return {
      status: existing?.admin?.scannedAt ? 'matched' : 'created',
      id: ref.id,
      existing,
      wrongCourier,
      courier: existing?.courier ?? courier,
      sheetSyncStatus: 'pending',
    };
  });

  await backfillLateMarketplaceMetadata(result?.id, normalizedCode, marketplaceData);
  return result;
}

export async function recordAdminScanPrimary({ code, courier, date, time, user }) {
  if (!canWriteFirestore()) {
    return null;
  }

  const normalizedCode = normalizeCode(code);
  const marketplaceData = await findMarketplaceMetadataByTracking(normalizedCode);
  const recent = await findRecentOrder({ courier, normalizedCode });
  const ref = doc(firestoreDb, 'orders', recent?.id ?? orderId({ date, courier, code: normalizedCode }));

  const result = await runTransaction(firestoreDb, async (transaction) => {
    const snap = await transaction.get(ref);
    const existing = snap.exists() ? snap.data() : null;

    if (existing?.admin?.scannedAt) {
      if (marketplaceData) {
        transaction.set(ref, marketplaceData, { merge: true });
      }
      return {
        status: 'duplicate',
        id: ref.id,
        existing,
        sheetSyncStatus: existing.sheetSyncStatus ?? 'pending',
      };
    }

    const nextStatus = existing?.packerScan?.scannedAt ? 'matched' : 'pending';
    const payload = existing
      ? {
          status: nextStatus,
          sheetSyncStatus: 'pending',
          sheetSyncError: '',
          updatedAt: serverTimestamp(),
          updatedAtIso: nowIso(),
          user: userPayload(user),
          admin: {
            scannedAt: `${date}T${time}`,
            scannedBy: userPayload(user),
          },
        }
      : {
          ...baseOrderPayload({ type: 'admin', code: normalizedCode, courier, date, time, user }),
          status: nextStatus,
          createdAt: serverTimestamp(),
          createdAtIso: nowIso(),
        };

    if (marketplaceData) {
      Object.assign(payload, marketplaceData);
    }

    transaction.set(ref, payload, { merge: true });

    return {
      status: existing?.packerScan?.scannedAt ? 'matched' : 'created',
      id: ref.id,
      existing,
      sheetSyncStatus: 'pending',
    };
  });

  await backfillLateMarketplaceMetadata(result?.id, normalizedCode, marketplaceData);
  return result;
}

export async function markSheetSyncResult({ orderId: id, ok, result = null, error = null }) {
  if (!canWriteFirestore() || !id) {
    return;
  }

  const ref = doc(firestoreDb, 'orders', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return;
  }

  await updateDoc(ref, {
    sheetSyncStatus: ok ? 'synced' : 'failed',
    sheetSyncError: ok ? '' : String(error?.message ?? error ?? 'Unknown sync error'),
    sheetSyncedAt: ok ? serverTimestamp() : null,
    sheetResultStatus: result?.status ?? '',
    sheetUrl: result?.sheetUrl ?? '',
    updatedAt: serverTimestamp(),
    updatedAtIso: nowIso(),
  });
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
  const orders = (await getRecentOrders(1000)).filter((order) => {
    const scanDate = order.packerScan?.scannedAt?.split('T')[0];
    return scanDate === date;
  });
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
    : await getRecentOrders(1000);

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
  const orders = (await getRecentOrders(2000)).filter((order) => {
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
  const orders = await getRecentOrders(1000);
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
