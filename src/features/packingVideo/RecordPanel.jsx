import React, { useEffect, useRef, useState } from 'react';
import { CircleAlert, PackageCheck, RotateCcw, X } from 'lucide-react';

import { barcodeCharacterFromKeyEvent } from '../../services/barcodeKeyboard.js';
import { getPackingStream } from '../../services/packingRecorder.js';
import { formatBangkokStamp } from '../../services/packingVideoFormat.js';
import { useRecordingClock } from './hooks/useRecordingClock.js';
import { PACKING_STATE } from './logic/packingSessionMachine.js';
import { packingVideoErrorText } from './logic/packingVideoMessages.js';
import { packingStationLabel } from './packingVideoStations.js';

const STATUS_TEXT = {
  [PACKING_STATE.idle]: 'พร้อมรับเลขพัสดุ',
  [PACKING_STATE.searching]: 'กำลังค้นหาออเดอร์…',
  [PACKING_STATE.notFound]: 'ไม่พบออเดอร์ของเลขพัสดุนี้ ยิงเลขใหม่ได้เลย',
  [PACKING_STATE.starting]: 'กำลังเปิดกล้อง…',
  [PACKING_STATE.recording]: 'กำลังบันทึกวิดีโอ',
  [PACKING_STATE.finalizing]: 'กำลังปิดไฟล์วิดีโอ…',
  [PACKING_STATE.cameraError]: 'เปิดกล้องไม่สำเร็จ',
};

export default function RecordPanel({
  session,
  station,
  packer,
  deviceCode,
  queueSummary,
  online,
}) {
  const { state, scan, packDone, cancel, restart, retryCamera, scanInputRef } = session;
  const [scanValue, setScanValue] = useState('');
  const videoRef = useRef(null);
  const { label: elapsedLabel } = useRecordingClock(state.status === PACKING_STATE.recording ? state.startedAt : null);

  const errorText = packingVideoErrorText(state.errorCode);
  const isRecording = state.status === PACKING_STATE.recording;
  const busy = [PACKING_STATE.searching, PACKING_STATE.starting, PACKING_STATE.finalizing].includes(state.status);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    const stream = getPackingStream();
    if (stream && element.srcObject !== stream) element.srcObject = stream;
  }, [state.status]);

  function handleSubmit(event) {
    event.preventDefault();
    const code = scanValue.trim();
    setScanValue('');
    if (code) scan(code);
  }

  function handleKeyDown(event) {
    // Barcode guns emit the active Windows layout in `key` — Thai characters when the OS is
    // switched — while `code` keeps the physical US position. Same fix as the main scan input.
    const character = barcodeCharacterFromKeyEvent(event);
    if (character === null) return;
    event.preventDefault();
    setScanValue((current) => `${current}${character}`);
  }

  const order = state.order;
  const items = Array.isArray(order?.items) ? order.items : [];
  const totalQty = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  return (
    <section className="pv-record" aria-labelledby="pv-record-title">
      <header className="pv-panel-header pv-record-header">
        <div>
          <h3 id="pv-record-title">กำลังแพ็คออเดอร์</h3>
          <p>
            {packingStationLabel(station)} · ผู้แพ็ค {packer} · เครื่อง {deviceCode}
          </p>
        </div>
        {isRecording && (
          <span className="pv-recording-pill">
            <span className="pv-rec-dot" aria-hidden="true" />
            กำลังบันทึก
          </span>
        )}
      </header>

      {(!online || queueSummary.pendingCount > 0 || queueSummary.failedCount > 0) && (
        <p className={`pv-banner ${queueSummary.failedCount > 0 ? 'pv-banner-danger' : 'pv-banner-warn'}`}>
          <CircleAlert size={16} aria-hidden="true" />
          {!online && 'ตอนนี้ออฟไลน์ วิดีโอจะถูกเก็บไว้ในเครื่องและอัปโหลดให้เมื่อกลับมาออนไลน์ '}
          {queueSummary.pendingCount > 0 && `รออัปโหลด ${queueSummary.pendingCount} รายการ `}
          {queueSummary.failedCount > 0 && `· อัปโหลดไม่สำเร็จ ${queueSummary.failedCount} รายการ`}
        </p>
      )}

      <form className="pv-scan-form" onSubmit={handleSubmit}>
        <label className="pv-field" htmlFor="pv-scan-input">
          <span>Tracking</span>
          <input
            id="pv-scan-input"
            ref={scanInputRef}
            value={scanValue}
            autoComplete="off"
            placeholder="สแกนเลข Tracking"
            disabled={busy || state.status === PACKING_STATE.duplicatePrompt}
            onChange={(event) => setScanValue(event.target.value)}
            onKeyDown={handleKeyDown}
          />
        </label>
        <button type="submit" className="pv-secondary-button" disabled={busy || !scanValue.trim()}>
          ค้นหา
        </button>
      </form>

      {/* Announced politely so a packer using a screen reader hears the state change without
          the running timer being read out every second. */}
      <p className="pv-live-status" role="status" aria-live="polite">
        {/* A lookup failure also lands on `notFound`, whose status line says the parcel has no
            order — untrue when the real problem was an expired sign-in or lost Wi-Fi. The banner
            below states the actual cause, so it speaks alone. */}
        {errorText ? '' : (STATUS_TEXT[state.status] ?? '')}
      </p>
      {errorText && (
        <p className="pv-banner pv-banner-danger" role="alert">
          <CircleAlert size={16} aria-hidden="true" />
          {errorText}
        </p>
      )}

      {order && (
        <dl className="pv-order-card">
          <div><dt>แพลตฟอร์ม</dt><dd>{String(order.platform ?? '').toUpperCase() || '—'}</dd></div>
          <div><dt>เลขออเดอร์</dt><dd>{order.orderId || '—'}</dd></div>
          <div className="pv-order-items">
            <dt>รายการสินค้า</dt>
            <dd>
              {items.length
                ? <ul>{items.map((item, index) => (
                  <li key={`${item.sku ?? index}`}>{item.name || item.sku || 'ไม่ระบุชื่อสินค้า'} × {item.quantity ?? 1}</li>
                ))}</ul>
                : 'ไม่มีรายละเอียดสินค้า'}
            </dd>
          </div>
          <div><dt>จำนวนรวม</dt><dd>{totalQty || '—'} ชิ้น</dd></div>
        </dl>
      )}

      <div className={`pv-preview ${isRecording ? 'pv-preview-live' : ''}`}>
        <video ref={videoRef} muted playsInline autoPlay aria-label="ภาพจากกล้อง" />
        {!isRecording && <p className="pv-preview-idle">ภาพจากกล้องจะแสดงเมื่อเริ่มบันทึก</p>}
      </div>

      <dl className="pv-timer-row">
        <div>
          <dt>เวลาเริ่ม</dt>
          <dd>{state.startedAt ? formatBangkokStamp(state.startedAt).slice(11) : '—'}</dd>
        </div>
        <div>
          <dt>เวลาที่บันทึก</dt>
          {/* Hidden from assistive tech: read aloud it would interrupt every second. */}
          <dd className="pv-timer" aria-hidden="true">{elapsedLabel}</dd>
        </div>
      </dl>

      <div className="pv-actions">
        <button type="button" className="pv-primary-button" disabled={!isRecording} onClick={packDone}>
          <PackageCheck size={18} aria-hidden="true" />
          <span>แพ็คเสร็จ</span>
        </button>
        <button type="button" className="pv-secondary-button" disabled={!isRecording} onClick={cancel}>
          <X size={18} aria-hidden="true" />
          <span>ยกเลิก</span>
        </button>
        <button type="button" className="pv-danger-button" disabled={!isRecording} onClick={restart}>
          <RotateCcw size={18} aria-hidden="true" />
          <span>บันทึกใหม่</span>
        </button>
      </div>

      {state.status === PACKING_STATE.cameraError && (
        <button type="button" className="pv-secondary-button" onClick={retryCamera}>
          ลองเปิดกล้องอีกครั้ง
        </button>
      )}
    </section>
  );
}
