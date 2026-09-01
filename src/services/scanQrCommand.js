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

export function resolveScanQrCommand(command, { couriers = [], staff = [] } = {}) {
  if (!command) return null;
  if (command.kind === 'courier') {
    // A courier QR must open the scan popup even while the live courier list is still loading.
    // Keep the current display spelling when it is known, otherwise use the QR payload itself.
    const courier = couriers.find((item) => clean(item).toLowerCase() === command.courier.toLowerCase());
    return { ...command, courier: courier ?? command.courier };
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
    return packer && sameNicknameCount === 1 ? { ...command, packer } : null;
  }
  return null;
}
