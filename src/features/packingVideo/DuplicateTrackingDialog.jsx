import React, { useEffect, useRef } from 'react';

import { formatBuddhistDateTime } from '../../services/packingVideoFormat.js';
import { packingStationLabel } from './packingVideoStations.js';

function toDate(value) {
  if (!value) return null;
  return typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
}

/**
 * Shown when a tracking number already has recordings.
 *
 * A real modal, unlike the rest of the screen: the packer must resolve it before scanning
 * again, otherwise a duplicate parcel could quietly be recorded twice under different intents.
 */
export default function DuplicateTrackingDialog({ tracking, history, onContinue, onRerecord, onCancel }) {
  const firstButtonRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    firstButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      // Trap focus: a barcode gun firing into the page behind the dialog would be worse here
      // than anywhere else, because the answer changes what gets recorded.
      const focusable = dialogRef.current?.querySelectorAll('button');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const latest = history[0] ?? {};
  const latestAt = toDate(latest.startedAt);

  return (
    <div className="pv-modal-overlay" role="presentation">
      <div
        className="pv-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pv-dup-title"
        ref={dialogRef}
      >
        <h3 id="pv-dup-title">Tracking นี้มีประวัติการบันทึกแล้ว</h3>
        <dl className="pv-dup-detail">
          <div><dt>เลขพัสดุ</dt><dd>{tracking}</dd></div>
          <div><dt>บันทึกล่าสุด</dt><dd>{latestAt ? formatBuddhistDateTime(latestAt) : 'ไม่ทราบเวลา'}</dd></div>
          <div><dt>ผู้แพ็ค</dt><dd>{latest.packer || 'ไม่ระบุ'}</dd></div>
          <div><dt>จุดแพ็ค</dt><dd>{latest.stationId ? packingStationLabel(latest.stationId) : 'ไม่ระบุ'}</dd></div>
          <div><dt>บันทึกไปแล้ว</dt><dd>{history.length} ครั้ง</dd></div>
        </dl>
        <p className="pv-hint">วิดีโอใหม่จะถูกเก็บเพิ่มเป็นครั้งถัดไป ไม่ทับไฟล์เดิม</p>

        <div className="pv-modal-actions">
          <button type="button" className="pv-primary-button" ref={firstButtonRef} onClick={onContinue}>
            เปิดออเดอร์เดิมต่อ
          </button>
          <button type="button" className="pv-secondary-button" onClick={onRerecord}>
            บันทึกวิดีโอใหม่
          </button>
          <button type="button" className="pv-ghost-button" onClick={onCancel}>
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}
