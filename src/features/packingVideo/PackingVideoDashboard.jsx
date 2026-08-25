import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Play, RefreshCw, Search } from 'lucide-react';

import { getBangkokParts } from '../../services/googleSheets.js';
import { formatBangkokStamp, formatDuration } from '../../services/packingVideoFormat.js';
import {
  PACKING_VIDEO_STATUS,
  PACKING_VIDEO_STATUS_VALUES,
  packingVideoStatusLabel,
} from '../../services/packingVideoModel.js';
import { logPackingVideoAudit, searchPackingVideos } from '../../services/packingVideos.js';
import {
  PACKING_VIDEO_ACTION,
  resolveUploadAction,
  reviewReasonText,
  uploadActionLabel,
} from './logic/packingVideoActions.js';
import {
  DASHBOARD_MAX_ITEMS,
  applyResidualFilters,
  buildRecordingQuery,
  normalizePackingFilters,
} from './logic/packingVideoFilters.js';
import { PACKING_STATIONS, packingStationLabel } from './packingVideoStations.js';

const EMPTY_FORM = {
  trackingNo: '',
  orderId: '',
  startDate: '',
  endDate: '',
  platform: '',
  packer: '',
  stationId: '',
  status: '',
};

const FILTER_ERRORS = {
  PACKING_VIDEO_FILTER_TOO_BROAD: 'เลือกช่วงวันที่ได้ไม่เกิน 31 วัน',
  PACKING_VIDEO_UNBOUNDED_QUERY: 'การค้นหาต้องมีเงื่อนไขอย่างน้อยหนึ่งอย่าง',
};

function toDate(value) {
  if (!value) return null;
  return typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
}

export default function PackingVideoDashboard({
  packerOptions,
  user,
  deviceId,
  queue,
  localVideos = [],
  onLocalChange,
}) {
  // Search reads Firestore, but a clip's document is only created *while* it uploads — so a clip
  // that never uploaded (a defective one parked in needs_review, or one that failed every
  // attempt) cannot be found here at all. Its own workstation is the only place that knows it
  // exists, which is why the local rows are listed separately rather than searched for.
  const localVideoIds = useMemo(
    () => new Set(localVideos.map((row) => row.videoId)),
    [localVideos],
  );
  const localPending = useMemo(
    () => localVideos
      .filter((row) => resolveUploadAction(row, { localVideoIds }).action !== PACKING_VIDEO_ACTION.none)
      .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0)),
    [localVideos, localVideoIds],
  );

  const [form, setForm] = useState(EMPTY_FORM);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [player, setPlayer] = useState(null);
  const [releasing, setReleasing] = useState(null);
  const videoRef = useRef(null);

  const setField = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  /**
   * Nothing loads until the packer asks. Auto-loading on mount would bill a Firestore read
   * per row every time someone glances at this tab.
   */
  const runSearch = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const filters = normalizePackingFilters(form, { today: getBangkokParts().date });
      const descriptor = buildRecordingQuery(filters);
      const found = await searchPackingVideos(descriptor, { maxItems: DASHBOARD_MAX_ITEMS });
      setRows(applyResidualFilters(found, filters));
    } catch (caught) {
      setRows([]);
      setError(FILTER_ERRORS[caught?.code] ?? caught?.message ?? 'ค้นหาไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }, [form]);

  async function openPlayer(row) {
    if (!row.storageUrl && !row.driveUrl) return;
    // Recorded before the URL is opened, so the log reflects viewing rather than clicking.
    await logPackingVideoAudit({
      videoId: row.videoId,
      action: 'view',
      actor: { uid: user?.uid, email: user?.email },
      deviceId,
    }).catch(() => setError('บันทึกประวัติการเปิดดูไม่สำเร็จ แต่ยังเปิดดูวิดีโอได้'));
    setPlayer(row);
  }

  function closePlayer() {
    const element = videoRef.current;
    if (element) {
      element.pause();
      element.removeAttribute('src');
      element.load();
    }
    setPlayer(null);
  }

  useEffect(() => () => closePlayer(), []);

  async function retryUpload(row) {
    setError('');
    setReleasing(null);
    try {
      await queue?.retry(row.videoId);
      // The local list is the only view of a clip with no Firestore document yet, so it has to
      // be refreshed here; re-running the search would not show the change.
      await onLocalChange?.();
      if (rows !== null) await runSearch();
    } catch (caught) {
      setError(caught?.message ?? 'สั่งอัปโหลดไม่สำเร็จ');
    }
  }

  return (
    <section className="pv-dashboard" aria-labelledby="pv-dashboard-title">
      <header className="pv-panel-header">
        <h3 id="pv-dashboard-title">ค้นหาวิดีโอแพ็คพัสดุ</h3>
        <p>ระบุเลขพัสดุ เลขออเดอร์ หรือช่วงวันที่ แล้วกดค้นหา — ถ้าไม่ระบุอะไรเลยระบบจะค้นเฉพาะวันนี้</p>
      </header>

      <div className="pv-filter-grid">
        <label className="pv-field"><span>Tracking</span>
          <input value={form.trackingNo} onChange={setField('trackingNo')} autoComplete="off" />
        </label>
        <label className="pv-field"><span>เลขออเดอร์</span>
          <input value={form.orderId} onChange={setField('orderId')} autoComplete="off" />
        </label>
        <label className="pv-field"><span>วันที่เริ่ม</span>
          <input type="date" value={form.startDate} onChange={setField('startDate')} />
        </label>
        <label className="pv-field"><span>ถึงวันที่</span>
          <input type="date" value={form.endDate} onChange={setField('endDate')} />
        </label>
        <label className="pv-field"><span>แพลตฟอร์ม</span>
          <select value={form.platform} onChange={setField('platform')}>
            <option value="">ทั้งหมด</option>
            <option value="shopee">Shopee</option>
            <option value="lazada">Lazada</option>
            <option value="tiktok">TikTok</option>
          </select>
        </label>
        <label className="pv-field"><span>ผู้แพ็ค</span>
          <select value={form.packer} onChange={setField('packer')}>
            <option value="">ทั้งหมด</option>
            {packerOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="pv-field"><span>จุดแพ็ค</span>
          <select value={form.stationId} onChange={setField('stationId')}>
            <option value="">ทั้งหมด</option>
            {PACKING_STATIONS.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
          </select>
        </label>
        <label className="pv-field"><span>สถานะ</span>
          <select value={form.status} onChange={setField('status')}>
            <option value="">ทั้งหมด</option>
            {PACKING_VIDEO_STATUS_VALUES.map((value) => (
              <option key={value} value={value}>{packingVideoStatusLabel(value)}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="pv-actions">
        <button type="button" className="pv-primary-button" onClick={runSearch} disabled={busy}>
          <Search size={18} aria-hidden="true" />
          <span>{busy ? 'กำลังค้นหา…' : 'ค้นหา'}</span>
        </button>
        <button type="button" className="pv-ghost-button" onClick={() => { setForm(EMPTY_FORM); setRows(null); setError(''); }}>
          ล้างเงื่อนไข
        </button>
      </div>

      {error && (
        <p className="pv-banner pv-banner-danger" role="alert">
          <CircleAlert size={16} aria-hidden="true" />{error}
        </p>
      )}

      {localPending.length > 0 && (
        <section className="pv-local-queue" aria-labelledby="pv-local-title">
          <header className="pv-panel-header">
            <h4 id="pv-local-title">ยังอยู่ในเครื่องนี้ ({localPending.length})</h4>
            <p>
              คลิปที่ยังไม่ได้ขึ้นระบบ จะค้นหาจากเครื่องอื่นไม่เจอเพราะยังไม่มีข้อมูลบนเซิร์ฟเวอร์
              ต้องสั่งอัปโหลดจากเครื่องนี้
            </p>
          </header>
          <div className="pv-table-wrap">
            <table className="pv-table">
              <thead>
                <tr>
                  <th scope="col">เวลาเริ่ม</th>
                  <th scope="col">Tracking</th>
                  <th scope="col">ผู้แพ็ค</th>
                  <th scope="col">ความยาว</th>
                  <th scope="col">สถานะ</th>
                  <th scope="col">สั่งอัปโหลด</th>
                </tr>
              </thead>
              <tbody>
                {localPending.map((row) => {
                  const upload = resolveUploadAction(row, { localVideoIds });
                  const inReview = row.status === PACKING_VIDEO_STATUS.needsReview;
                  return (
                    <tr key={row.videoId}>
                      <td data-label="เวลาเริ่ม">{row.startedAt ? formatBangkokStamp(toDate(row.startedAt)) : '—'}</td>
                      <td data-label="Tracking">{row.trackingNo || '—'}</td>
                      <td data-label="ผู้แพ็ค">{row.packer || '—'}</td>
                      <td data-label="ความยาว">{formatDuration(row.durationMs)}</td>
                      <td data-label="สถานะ">
                        {packingVideoStatusLabel(row.status)}
                        {inReview && <small className="pv-hint">{reviewReasonText(row)}</small>}
                      </td>
                      <td data-label="สั่งอัปโหลด">
                        <button
                          type="button"
                          className="pv-link-button"
                          disabled={!upload.enabled}
                          title={upload.reason || undefined}
                          onClick={() => (
                            upload.action === PACKING_VIDEO_ACTION.release
                              ? setReleasing(row)
                              : retryUpload(row)
                          )}
                        >
                          <RefreshCw size={14} aria-hidden="true" /> {uploadActionLabel(upload.action)}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {rows !== null && (
        <div className="pv-table-wrap">
          <table className="pv-table">
            <thead>
              <tr>
                <th scope="col">วันที่</th>
                <th scope="col">Tracking</th>
                <th scope="col">แพลตฟอร์ม</th>
                <th scope="col">ผู้แพ็ค</th>
                <th scope="col">จุดแพ็ค</th>
                <th scope="col">ความยาว</th>
                <th scope="col">สถานะ</th>
                <th scope="col">วิดีโอ</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} className="pv-empty">ไม่พบวิดีโอตามเงื่อนไขนี้</td></tr>
              )}
              {rows.map((row) => {
                const playable = Boolean(row.storageUrl || row.driveUrl);
                // The blob only exists on the workstation that recorded it, so an upload
                // action anywhere else has nothing to send.
                const upload = resolveUploadAction(row, { localVideoIds });
                const hasAction = upload.action !== PACKING_VIDEO_ACTION.none;
                const inReview = row.status === PACKING_VIDEO_STATUS.needsReview;
                return (
                  <tr key={row.videoId}>
                    <td data-label="วันที่">{row.startedAt ? formatBangkokStamp(toDate(row.startedAt)) : row.bangkokDate}</td>
                    <td data-label="Tracking">{row.trackingNo}</td>
                    <td data-label="แพลตฟอร์ม">{String(row.platform ?? '').toUpperCase() || '—'}</td>
                    <td data-label="ผู้แพ็ค">{row.packer || '—'}</td>
                    <td data-label="จุดแพ็ค">{packingStationLabel(row.stationId)}</td>
                    <td data-label="ความยาว">{formatDuration(row.durationMs)}</td>
                    <td data-label="สถานะ">
                      {packingVideoStatusLabel(row.status)}
                      {inReview && <small className="pv-hint">{reviewReasonText(row)}</small>}
                    </td>
                    <td data-label="วิดีโอ">
                      {playable && (
                        <button type="button" className="pv-link-button" onClick={() => openPlayer(row)}>
                          <Play size={14} aria-hidden="true" /> เปิดดู
                        </button>
                      )}
                      {hasAction && (
                        <button
                          type="button"
                          className="pv-link-button"
                          disabled={!upload.enabled}
                          title={upload.reason || undefined}
                          onClick={() => (
                            upload.action === PACKING_VIDEO_ACTION.release
                              ? setReleasing(row)
                              : retryUpload(row)
                          )}
                        >
                          <RefreshCw size={14} aria-hidden="true" /> {uploadActionLabel(upload.action)}
                        </button>
                      )}
                      {!playable && !hasAction && '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {releasing && (
        <div className="pv-modal-overlay" role="presentation" onClick={() => setReleasing(null)}>
          <div
            className="pv-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="pv-release-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="pv-release-title">อัปโหลดคลิปที่ไม่สมบูรณ์?</h3>
            <dl className="pv-dup-detail">
              <div><dt>เลขพัสดุ</dt><dd>{releasing.trackingNo}</dd></div>
              <div><dt>ผู้แพ็ค</dt><dd>{releasing.packer || 'ไม่ระบุ'}</dd></div>
              <div><dt>สาเหตุที่ต้องตรวจ</dt><dd>{reviewReasonText(releasing)}</dd></div>
            </dl>
            <p className="pv-hint">
              คลิปนี้อาจขาดภาพบางช่วง อัปโหลดแล้วจะย้ายเข้า Drive เหมือนคลิปอื่น
              แต่หมายเหตุที่บอกว่าไม่สมบูรณ์จะติดไปกับแถวในชีตด้วย
            </p>
            <div className="pv-modal-actions">
              <button
                type="button"
                className="pv-primary-button"
                autoFocus
                onClick={() => retryUpload(releasing)}
              >
                อัปโหลดเลย
              </button>
              <button type="button" className="pv-ghost-button" onClick={() => setReleasing(null)}>
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {player && (
        <div className="pv-modal-overlay" role="presentation" onClick={closePlayer}>
          <div
            className="pv-modal pv-player"
            role="dialog"
            aria-modal="true"
            aria-label={`วิดีโอของเลขพัสดุ ${player.trackingNo}`}
            onClick={(event) => event.stopPropagation()}
          >
            <h3>{player.trackingNo}</h3>
            {/* preload="metadata": a full preload would pull tens of megabytes for a click. */}
            <video ref={videoRef} controls playsInline preload="metadata" src={player.driveUrl || player.storageUrl} />
            <button type="button" className="pv-secondary-button" onClick={closePlayer}>ปิด</button>
          </div>
        </div>
      )}
    </section>
  );
}
