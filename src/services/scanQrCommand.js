const QR_PREFIX = 'SCAN_TO_SHEET';
const QR_VERSION = '1';
const QR_PACKER_POSITIONS = new Set(['leader', 'checker', 'packer']);

function clean(value) {
  return String(value ?? '').trim();
}

function encode(value) {
  return encodeURIComponent(clean(value));
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function resolveUniqueOption(options, value) {
  const normalizedValue = clean(value).toLocaleLowerCase('th');
  if (!normalizedValue) return null;
  const matches = options.filter((option) => (
    clean(option).toLocaleLowerCase('th') === normalizedValue
  ));
  return matches.length === 1 ? matches[0] : null;
}

function resolveUniquePacker(options, value) {
  const normalizedValue = clean(value).toLocaleLowerCase('th');
  if (!normalizedValue) return null;
  const matches = options.filter((option) => (
    clean(option).toLocaleLowerCase('th') === normalizedValue
  ));
  return matches.length === 1 ? matches[0] : null;
}

export function createCourierQrCommand(role, courier) {
  const normalizedRole = clean(role).toUpperCase();
  const normalizedCourier = clean(courier);
  if (!['ADMIN', 'PACKER'].includes(normalizedRole) || !normalizedCourier) {
    throw new Error('ข้อมูล QR ขนส่งไม่ถูกต้อง');
  }
  return [QR_PREFIX, QR_VERSION, normalizedRole, 'COURIER', encode(normalizedCourier)].join(':');
}

export function createPackerQrCommand(staffId) {
  const normalizedStaffId = clean(staffId);
  if (!normalizedStaffId) throw new Error('ข้อมูล QR Packer ไม่ถูกต้อง');
  return [QR_PREFIX, QR_VERSION, 'PACKER', 'STAFF', encode(normalizedStaffId)].join(':');
}

export function parseScanQrCommand(rawValue) {
  const parts = clean(rawValue).split(':');
  if (parts.length !== 5 || parts[0].toUpperCase() !== QR_PREFIX || parts[1] !== QR_VERSION) return null;

  const [,, rawRole, rawTarget, encodedValue] = parts;
  const role = rawRole.toUpperCase();
  const target = rawTarget.toUpperCase();
  const value = clean(decode(encodedValue));
  if (!value) return null;

  if (target === 'COURIER' && ['ADMIN', 'PACKER'].includes(role)) {
    return { kind: 'courier', role: role.toLowerCase(), courier: value };
  }
  if (role === 'PACKER' && target === 'STAFF') {
    return { kind: 'packer', role: 'packer', staffId: value };
  }
  return null;
}

export function resolveScanQrCommand(command, { couriers = [], packers = [], staff = [] } = {}) {
  if (!command) return null;
  if (command.kind === 'courier') {
    // QR may select only one courier that is already available to the operator. This prevents
    // an old or mistyped QR payload from creating a selection that does not exist in the list.
    const courier = resolveUniqueOption(couriers, command.courier);
    return courier ? { ...command, courier } : null;
  }
  if (command.kind === 'packer') {
    const activePackers = staff.filter((item) => (
      item.active !== false
      && QR_PACKER_POSITIONS.has(item.position)
      && clean(item.nickname)
    ));
    const member = activePackers.find((item) => clean(item.id) === command.staffId);
    const packer = clean(member?.nickname);
    const sameNicknameCount = activePackers.filter((item) => (
      clean(item.nickname).toLocaleLowerCase('th') === packer.toLocaleLowerCase('th')
    )).length;
    const dropdownPacker = resolveUniqueOption(packers, packer);
    return packer && sameNicknameCount === 1 && dropdownPacker
      ? { ...command, packer: dropdownPacker }
      : null;
  }
  return null;
}

// Some printed QR labels contain only the visible name instead of the structured
// SCAN_TO_SHEET command. Resolve those names only when exactly one active option matches.
export function resolveScanQrName(rawValue, { couriers = [], packers = [] } = {}) {
  const value = clean(rawValue);
  if (!value) return null;

  const courier = resolveUniqueOption(couriers, value);
  const packer = resolveUniquePacker(packers, value);
  if (courier && packer) return null;
  if (courier) return { kind: 'courier', courier };
  if (packer) return { kind: 'packer', packer };
  return null;
}

export function getScanQrAnnouncement(command) {
  if (command?.kind === 'courier' && clean(command.courier)) {
    return `เลือกขนส่ง ${clean(command.courier)} แล้ว`;
  }
  if (command?.kind === 'packer' && clean(command.packer)) {
    return `เลือก Packer ${clean(command.packer)} แล้ว`;
  }
  return '';
}
