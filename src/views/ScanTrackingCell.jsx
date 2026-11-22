import React from 'react';
import { getScanCountSummary } from '../services/scanAttempts.js';

export function ScanTrackingCell({ row, tracking, role = 'packer' }) {
  const counts = getScanCountSummary(row);
  const duplicate = role === 'admin' ? counts.scanTotalAdmin > 1 : counts.scanTotalPacker > 1;
  const qualifier = counts.scanHistoryUnknown ? 'อย่างน้อย ' : '';
  return <td data-scan-role={role} className={`code-cell${duplicate ? ' scan-tracking-duplicate' : ''}`}>
    {tracking || '-'}
    {counts.scanCountRevision > 0 && <div className="scan-count-summary">
      <span>Admin {qualifier}{counts.scanTotalAdmin} / Packer {qualifier}{counts.scanTotalPacker}</span>
      {counts.scanDuplicateAdmin > 0 && <span>Admin ซ้ำ {qualifier}{counts.scanDuplicateAdmin}</span>}
      {counts.scanDuplicatePacker > 0 && <span>Packer ซ้ำ {qualifier}{counts.scanDuplicatePacker}</span>}
      {counts.scanTotalAdmin > 1 && counts.scanTotalPacker > 1 && <strong>เสี่ยงทำออเดอร์ซ้ำ ต้องตรวจสอบ</strong>}
      {counts.scanHistoryUnknown && <span>ประวัติก่อนเริ่มนับไม่ครบ</span>}
    </div>}
  </td>;
}
