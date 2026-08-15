import React from 'react';
import { Camera, CheckCircle2, CircleAlert, MonitorSmartphone, Play } from 'lucide-react';

import { PACKING_STATIONS } from './packingVideoStations.js';

const CAMERA_HINTS = {
  PACKING_VIDEO_PERMISSION_DENIED: 'ยังไม่ได้อนุญาตให้ใช้กล้อง',
  PACKING_VIDEO_NO_CAMERA: 'ไม่พบกล้องบนเครื่องนี้',
  PACKING_VIDEO_CAMERA_BUSY: 'กล้องถูกโปรแกรมอื่นใช้อยู่',
  PACKING_VIDEO_CAMERA_UNSUPPORTED: 'กล้องไม่รองรับความละเอียดที่ตั้งไว้',
  PACKING_VIDEO_UNSUPPORTED_BROWSER: 'เบราว์เซอร์นี้บันทึกวิดีโอไม่ได้',
};

export default function SetupPanel({
  station,
  packer,
  deviceSeq,
  deviceCode,
  packerOptions,
  cameraInfo,
  isSignedIn,
  onStationChange,
  onPackerChange,
  onDeviceSeqChange,
  onStart,
}) {
  const ready = Boolean(station && packer && isSignedIn);
  const cameraLabel = cameraInfo.ready
    ? `พร้อมใช้งาน${cameraInfo.resolution ? ` (${cameraInfo.resolution})` : ''}`
    : CAMERA_HINTS[cameraInfo.errorCode] ?? 'ยังไม่ได้เปิดกล้อง';

  return (
    <section className="pv-setup" aria-labelledby="pv-setup-title">
      <header className="pv-panel-header">
        <h3 id="pv-setup-title">ตั้งค่าการใช้งาน</h3>
        <p>
          โมดูลนี้ใช้กับออเดอร์ที่ต้องมีหลักฐานการแพ็คเท่านั้น
          เลือกจุดแพ็คและผู้แพ็คให้ตรงกับหน้างานก่อนเริ่ม
        </p>
      </header>

      <div className="pv-field-grid">
        <label className="pv-field">
          <span>จุดแพ็ค</span>
          <select value={station} onChange={(event) => onStationChange(event.target.value)}>
            <option value="">— เลือกจุดแพ็ค —</option>
            {PACKING_STATIONS.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </label>

        <label className="pv-field">
          <span>ผู้แพ็ค</span>
          <select value={packer} onChange={(event) => onPackerChange(event.target.value)}>
            <option value="">— เลือกชื่อพนักงาน —</option>
            {packerOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>

        <label className="pv-field">
          <span>เลขเครื่องที่จุดนี้</span>
          <input
            type="number"
            min="1"
            max="99"
            value={deviceSeq}
            onChange={(event) => onDeviceSeqChange(Number(event.target.value))}
          />
        </label>
      </div>

      <dl className="pv-status-list">
        <div className="pv-status-row">
          <dt><MonitorSmartphone size={16} aria-hidden="true" /> อุปกรณ์</dt>
          <dd>{deviceCode || 'เลือกจุดแพ็คก่อน'}</dd>
        </div>
        <div className="pv-status-row">
          <dt><Camera size={16} aria-hidden="true" /> สถานะกล้อง</dt>
          <dd className={cameraInfo.ready ? 'pv-ok' : 'pv-warn'}>
            {cameraInfo.ready ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
            {cameraLabel}
          </dd>
        </div>
        <div className="pv-status-row">
          <dt>สถานะระบบ</dt>
          <dd className={isSignedIn ? 'pv-ok' : 'pv-warn'}>
            {isSignedIn ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
            {isSignedIn ? 'เชื่อมต่อแล้ว' : 'ยังไม่ได้เข้าสู่ระบบ'}
          </dd>
        </div>
      </dl>

      <button type="button" className="pv-primary-button" disabled={!ready} onClick={onStart}>
        <Play size={18} aria-hidden="true" />
        <span>เริ่มใช้งาน</span>
      </button>
      {!ready && (
        <p className="pv-hint">
          {isSignedIn ? 'เลือกจุดแพ็คและผู้แพ็คให้ครบก่อนเริ่มใช้งาน' : 'เข้าสู่ระบบด้วย Google ก่อนเริ่มใช้งาน'}
        </p>
      )}
    </section>
  );
}
