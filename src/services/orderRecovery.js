function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function scanTimestamp(event) {
  const date = String(event?.date ?? '').trim();
  const time = String(event?.time ?? '').trim();
  return date && time ? `${date}T${time}` : '';
}

function eventUser(event) {
  return event?.user ?? { uid: '', email: '', name: '' };
}

export function mergeScanEventIntoOrder(existing, event) {
  const code = String(event?.code ?? existing?.code ?? '').trim();
  const normalizedCode = normalizeCode(event?.normalizedCode || code || existing?.normalizedCode);
  const next = {
    ...(existing ?? {}),
    code,
    normalizedCode,
    date: existing?.date || event?.date || '',
    courier: existing?.courier || event?.courier || '',
    updatedAtIso: event?.createdAtIso || existing?.updatedAtIso || '',
  };
  const scannedAt = scanTimestamp(event);

  if (event?.type === 'admin') {
    next.admin = {
      scannedAt: scannedAt || existing?.admin?.scannedAt || '',
      scannedBy: eventUser(event),
    };
  }

  if (event?.type === 'packer') {
    next.packer = event?.packer || existing?.packer || '';
    next.note = event?.note ?? existing?.note ?? '';
    next.packerScan = {
      scannedAt: scannedAt || existing?.packerScan?.scannedAt || '',
      scannedBy: eventUser(event),
      packer: next.packer,
      note: next.note,
    };
  }

  const hasAdmin = Boolean(next.admin?.scannedAt);
  const hasPacker = Boolean(next.packerScan?.scannedAt);
  next.status = hasAdmin && hasPacker
    ? 'matched'
    : hasAdmin
      ? 'pending'
      : hasPacker
        ? 'packer_scanned'
        : (event?.status || existing?.status || 'pending');
  return next;
}

export function mergeExistingOrderWithCandidate(existing, candidate) {
  if (!existing) return candidate;

  return {
    ...candidate,
    ...existing,
    code: existing.code || candidate?.code || '',
    normalizedCode: existing.normalizedCode || candidate?.normalizedCode || normalizeCode(existing.code || candidate?.code),
    date: existing.date || candidate?.date || '',
    courier: existing.courier || candidate?.courier || '',
    admin: existing.admin?.scannedAt ? existing.admin : (candidate?.admin ?? null),
    packerScan: existing.packerScan?.scannedAt ? existing.packerScan : (candidate?.packerScan ?? null),
    packer: existing.packer || candidate?.packer || '',
    note: existing.note ?? candidate?.note ?? '',
    status: existing.status || candidate?.status || 'pending',
  };
}

export function buildRecoveredOrderFields({
  effectiveExisting,
  date,
  time,
  courier,
  code,
  packer = '',
  note = '',
  user,
}) {
  const recoveredCode = String(effectiveExisting?.code || effectiveExisting?.normalizedCode || code || '').trim();
  const recoveredAdmin = effectiveExisting?.admin ?? null;
  const recoveredDate = effectiveExisting?.date || date;
  const recoveredCourier = effectiveExisting?.courier || courier;
  const status = recoveredAdmin?.scannedAt ? 'matched' : note ? 'issue' : 'packer_scanned';

  return {
    code: recoveredCode,
    normalizedCode: normalizeCode(recoveredCode),
    date: recoveredDate,
    courier: recoveredCourier,
    packer,
    note,
    status,
    admin: recoveredAdmin,
    packerScan: {
      scannedAt: `${date}T${time}`,
      scannedBy: user ?? { uid: '', email: '', name: '' },
      packer,
      note,
    },
  };
}
