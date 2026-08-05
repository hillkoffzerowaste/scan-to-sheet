/**
 * missingOrderCheck.js
 * UI formatting helpers for the missing-order cross-check results.
 */

/**
 * Build a human-readable alert message for clipboard sharing.
 */
export function buildMissingAlertMessage(results) {
  if (!results) return '';

  const dateLabel = formatDateLabel(results);
  const lines = [
    `⚠️ รายงานออเดอร์ตกหล่น (${dateLabel})`,
    `ย้อนหลัง ${results.hoursLookback} ชม. | เกณฑ์แจ้งเตือน ${results.thresholdMinutes} นาที`,
    `ตรวจสอบเวลา: ${formatCheckTime(results.checkTime)}`,
    '',
    `📦 ทั้งหมดที่ลง Drive: ${results.totalAdminScans} รายการ`,
    `✅ จับคู่แล้ว (Packer สแกนแล้ว): ${results.matched?.length ?? 0} รายการ`,
    `⏳ ยังไม่แพ็ค (เกินเวลา): ${results.pending?.length ?? 0} รายการ`,
    `🕐 รอแพ็ค (ยังไม่เกินเวลา): ${results.tooSoon?.length ?? 0} รายการ`,
    `❌ ยกเลิก: ${results.cancelled?.length ?? 0} รายการ`,
    `↩️ สินค้าตีกลับ: ${results.returned?.length ?? 0} รายการ`,
    `💥 สินค้าเสียหาย: ${results.damaged?.length ?? 0} รายการ`,
  ];

  if ((results.pending?.length ?? 0) > 0) {
    lines.push('', '━━━ ⏳ ออเดอร์ตกหล่น (เกินเวลา) ━━━');
    for (const row of results.pending) {
      const code = row.adminCode || 'ไม่ระบุ';
      const courier = row.courier || 'ไม่ระบุ';
      const time = row.adminTime || row.time || '--:--';
      lines.push(`  ${code} | ${courier} | ${time}`);
    }
  }

  if (results.tooSoon?.length > 0) {
    lines.push('', '━━━ 🕐 รอแพ็ค (ยังไม่เกินเวลา) ━━━');
    for (const row of results.tooSoon) {
      const code = row.adminCode || 'ไม่ระบุ';
      const courier = row.courier || 'ไม่ระบุ';
      const time = row.adminTime || row.time || '--:--';
      lines.push(`  ${code} | ${courier} | ${time}`);
    }
  }

  lines.push('', 'สร้างจากระบบ Scan to Sheet');
  return lines.join('\n');
}

/**
 * Build a compact summary for clipboard sharing.
 */
export function buildCompactSummary(results) {
  if (!results) return '';

  const pendingCount = results.pending?.length ?? 0;
  const tooSoonCount = results.tooSoon?.length ?? 0;

  const lines = [
    `ตรวจออเดอร์ตกหล่น (${formatDateLabel(results)})`,
    `⏳ ตกหล่น ${pendingCount} | 🕐 รอแพ็ค ${tooSoonCount} | ✅ จับคู่ ${results.matched?.length ?? 0}`,
  ];

  if (results.pending?.length > 0) {
    const topPending = results.pending.slice(0, 5).map(
      (row) => `${row.adminCode || '?'} (${row.courier || '?'})`
    );
    lines.push(`หลุด: ${topPending.join(', ')}`);
    if (results.pending.length > 5) {
      lines.push(`...และอีก ${results.pending.length - 5} รายการ`);
    }
  }

  return lines.join('\n');
}

/**
 * Format missing-order results into UI section cards.
 * Each card has: type, label, count, color, rows
 */
/**
 * Split `pending` into the two buckets the UI shows side by side.
 *
 * `pendingOverOneDay` is a *subset* of `pending`, so anything reading both must subtract or
 * it reports the same order twice. Keeping the split here is what stops the dashboard cards
 * and the section list from disagreeing about the identical result set.
 */
export function splitPendingOrders(results) {
  const pending = results?.pending ?? [];
  const overOneDay = results?.pendingOverOneDay ?? [];
  const overdueSet = new Set(overOneDay);
  return {
    recent: pending.filter((row) => !overdueSet.has(row)),
    overOneDay,
    total: pending.length,
  };
}

export function formatMissingResultsForUI(results) {
  if (!results) return [];

  const sections = [];
  const { recent: regularPending } = splitPendingOrders(results);

  // Guard on the filtered list, not on `results.pending`: when every overdue order is also
  // over one day old, the old guard still rendered this card with count 0 and no rows,
  // directly above the card that actually held them.
  if (regularPending.length > 0) {
    sections.push({
      type: 'pending',
      label: '⏳ ออเดอร์ตกหล่น (เกินเวลา)',
      count: regularPending.length,
      color: 'warning',
      rows: regularPending,
    });
  }

  if (results.pendingOverOneDay?.length > 0) {
    sections.push({
      type: 'pendingOverOneDay',
      label: 'รอแพ็คเกิน 1 วัน',
      count: results.pendingOverOneDay.length,
      color: 'danger',
      rows: results.pendingOverOneDay,
    });
  }

  if (results.tooSoon?.length > 0) {
    sections.push({
      type: 'tooSoon',
      label: '🕐 รอแพ็ค (ยังไม่เกินเวลา)',
      count: results.tooSoon.length,
      color: 'muted',
      rows: results.tooSoon,
    });
  }

  if (results.matched?.length > 0) {
    sections.push({
      type: 'matched',
      label: '✅ จับคู่แล้ว (Packer สแกนแล้ว)',
      count: results.matched.length,
      color: 'success',
      rows: results.matched,
    });
  }

  if (results.cancelled?.length > 0) {
    sections.push({
      type: 'cancelled',
      label: '❌ ยกเลิก',
      count: results.cancelled.length,
      color: 'muted',
      rows: results.cancelled,
    });
  }

  if (results.returned?.length > 0) {
    sections.push({
      type: 'returned',
      label: '↩️ สินค้าตีกลับ',
      count: results.returned.length,
      color: 'muted',
      rows: results.returned,
    });
  }

  if (results.damaged?.length > 0) {
    sections.push({
      type: 'damaged',
      label: '💥 สินค้าเสียหาย',
      count: results.damaged.length,
      color: 'warning',
      rows: results.damaged,
    });
  }

  return sections;
}

/**
 * Build a compact dashboard summary for the drive tab.
 */
export function buildDashboardSummary(results) {
  if (!results) return null;

  // The two pending cards sit next to each other, so they must not both count the same
  // order: 5 orders over one day used to read as "ตกหล่น 5" plus "รอแพ็คเกิน 1 วัน 5".
  const pending = splitPendingOrders(results);

  return {
    matchedCount: results.matched?.length ?? 0,
    pendingCount: pending.recent.length,
    pendingOverOneDayCount: pending.overOneDay.length,
    pendingTotalCount: pending.total,
    tooSoonCount: results.tooSoon?.length ?? 0,
  };
}

// ── Internal helpers ──

function formatDateLabel(results) {
  if (!results?.checkTime) return '';
  try {
    const d = new Date(results.checkTime);
    const date = d.toLocaleDateString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  } catch {
    return '';
  }
}

function formatCheckTime(checkTime) {
  try {
    const d = new Date(checkTime);
    const date = d.toLocaleDateString('th-TH', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  } catch {
    return checkTime ?? '';
  }
}
