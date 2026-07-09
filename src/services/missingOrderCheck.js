import { getBangkokParts } from './googleSheets.js';

const PACKERS = ['มุก', 'ยุทธ', 'กิต', 'มาย', 'หล้า'];

/**
 * Build a formatted alert message for pending/missing orders.
 */
export function buildMissingAlertMessage(results, courier = null) {
  const { matched, pending, tooSoon, cancelled, damaged, checkTime, thresholdMinutes } = results;
  const generatedAt = getBangkokParts();
  const courierLabel = courier || 'ทุกขนส่ง';

  const lines = [];

  if (pending.length > 0) {
    lines.push('### 🚨 ตรวจพบออเดอร์เสี่ยงตกหล่น (ยังไม่ได้แสกนส่ง)');
    lines.push('');
    lines.push(`* **ขนส่ง:** ${courierLabel}`);
    lines.push(`* **จำนวนที่ตกหล่น:** ${pending.length} รายการ`);
    lines.push(`* **เกณฑ์เวลา:** เกิน ${thresholdMinutes} นาทีหลัง Admin ลง Drive`);
    lines.push('');
    lines.push('**รายชื่อเลขพัสดุที่ยังไม่ได้แสกนเข้าระบบ:**');
    pending.forEach((row, idx) => {
      const adminTime = row.adminTime || row.time || '--:--';
      const adminDate = row.adminDate || row.date || '';
      const datePrefix = adminDate && adminDate !== generatedAt.date ? `${adminDate} ` : '';
      lines.push(`${idx + 1}. \`${row.adminCode}\` (ลง Drive เมื่อ: ${datePrefix}${adminTime} น.) | Courier: ${row.courier}`);
    });
    lines.push('');
  }

  if (cancelled.length > 0) {
    lines.push('### ❌ พบออเดอร์ที่ถูกยกเลิก');
    lines.push('');
    cancelled.forEach((row, idx) => {
      lines.push(`${idx + 1}. \`${row.adminCode}\` — ${row.courier} (${row.date} ${row.time})`);
    });
    lines.push('');
  }

  if (damaged.length > 0) {
    lines.push('### ⚠️ พบออเดอร์ที่สินค้าเสียหาย');
    lines.push('');
    damaged.forEach((row, idx) => {
      lines.push(`${idx + 1}. \`${row.adminCode}\` — ${row.courier} (${row.date} ${row.time})`);
    });
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`✅ จับคู่สำเร็จแล้ว: ${matched.length} รายการ`);
  if (tooSoon.length > 0) {
    lines.push(`⏳ รอแพ็ค (ยังไม่ถึง ${thresholdMinutes} นาที): ${tooSoon.length} รายการ`);
  }
  if (pending.length === 0) {
    lines.push(`🎉 ไม่มีออเดอร์ตกหล่นในช่วง ${results.hoursLookback} ชม.ที่ผ่านมา`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`*แนะนำให้แอดมินประสานงานกับ Packer (${PACKERS.join(', ')}) เพื่อเช็คว่าสินค้ายังอยู่ที่จุดแพ็คหรือไม่*`);
  lines.push('');
  lines.push(`_ตรวจสอบเมื่อ: ${generatedAt.date} ${generatedAt.time} | ดูย้อนหลัง ${results.hoursLookback} ชม._`);

  return lines.join('\n');
}

/**
 * Build a compact summary for clipboard / sharing.
 */
export function buildCompactSummary(results, courier = null) {
  const { matched, pending, tooSoon, cancelled, damaged } = results;
  const generatedAt = getBangkokParts();
  const courierLabel = courier || 'ทุกขนส่ง';

  const lines = [
    `📋 สรุปออเดอร์ ${courierLabel} | ${generatedAt.date} ${generatedAt.time}`,
    `✅ จับคู่: ${matched.length} | 🚨 ตกหล่น: ${pending.length} | ⏳ รอแพ็ค: ${tooSoon.length} | ❌ ยกเลิก: ${cancelled.length} | ⚠️ เสียหาย: ${damaged.length}`,
  ];

  if (pending.length > 0) {
    lines.push('');
    lines.push('🚨 เลขตกหล่น:');
    pending.forEach((row, idx) => {
      lines.push(`${idx + 1}. ${row.adminCode} (${row.courier})`);
    });
  }

  return lines.join('\n');
}

/**
 * Format missing order check results into a UI-friendly structure.
 * Returns an array of sections, each with type, label, rows, and count.
 */
export function formatMissingResultsForUI(results) {
  const sections = [];

  if (results.pending.length > 0) {
    sections.push({
      type: 'pending',
      label: '🚨 เสี่ยงตกหล่น',
      rows: results.pending,
      count: results.pending.length,
      color: 'danger',
    });
  }

  if (results.cancelled.length > 0) {
    sections.push({
      type: 'cancelled',
      label: '❌ ลูกค้ายกเลิก',
      rows: results.cancelled,
      count: results.cancelled.length,
      color: 'danger',
    });
  }

  if (results.damaged.length > 0) {
    sections.push({
      type: 'damaged',
      label: '⚠️ สินค้าเสียหาย',
      rows: results.damaged,
      count: results.damaged.length,
      color: 'warning',
    });
  }

  if (results.tooSoon.length > 0) {
    sections.push({
      type: 'tooSoon',
      label: '⏳ รอแพ็ค (ยังไม่ถึงเกณฑ์เวลา)',
      rows: results.tooSoon,
      count: results.tooSoon.length,
      color: 'muted',
    });
  }

  if (results.matched.length > 0) {
    sections.push({
      type: 'matched',
      label: '✅ จับคู่สำเร็จ',
      rows: results.matched,
      count: results.matched.length,
      color: 'success',
    });
  }

  return sections;
}

/**
 * Build a simple dashboard summary object.
 */
export function buildDashboardSummary(results) {
  return {
    matchedCount: results.matched.length,
    pendingCount: results.pending.length,
    tooSoonCount: results.tooSoon.length,
    cancelledCount: results.cancelled.length,
    damagedCount: results.damaged.length,
    totalAdminScans: results.totalAdminScans,
    checkTime: results.checkTime,
    thresholdMinutes: results.thresholdMinutes,
    hoursLookback: results.hoursLookback,
  };
}