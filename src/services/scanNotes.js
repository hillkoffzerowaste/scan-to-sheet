export function mergeScanNotes(...values) {
  const notes = [];
  for (const value of values) {
    for (const note of String(value ?? '').split('|').map((item) => item.trim()).filter(Boolean)) {
      if (!notes.includes(note)) notes.push(note);
    }
  }
  return notes.join(' | ');
}

const SCAN_COUNT_REMARK_PATTERN = /^\[สแกนซ้ำ: Admin (?:อย่างน้อย )?\d+ ครั้ง, Packer (?:อย่างน้อย )?\d+ ครั้ง\]$/;

export function scanCountRemarkParts(note) {
  return String(note ?? '').split(' | ').filter((part) => SCAN_COUNT_REMARK_PATTERN.test(part));
}

export function withoutScanCountRemark(note) {
  return String(note ?? '').split(' | ').filter((part) => !SCAN_COUNT_REMARK_PATTERN.test(part)).join(' | ');
}
