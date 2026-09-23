import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Database,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldAlert,
  Truck,
  Upload,
} from 'lucide-react';

function formatNumber(value) {
  return new Intl.NumberFormat('th-TH').format(Number(value) || 0);
}

function rowTime(row) {
  return row.adminTime || row.time || '-';
}

function rowCode(row) {
  return row.adminCode || row.code || row.no || '-';
}

function normalizeActivity(row, source) {
  if (source === 'drive') {
    return {
      id: `drive-${row.id || rowCode(row)}-${row.date || ''}-${rowTime(row)}`,
      source: 'Drive',
      code: rowCode(row),
      courier: row.courier || '-',
      owner: row.adminEmail || row.email || 'Admin',
      time: rowTime(row),
      status: row.status || 'รับเข้าแล้ว',
      statusTone: row.status === 'พบใน Packer' ? 'success' : 'info',
    };
  }

  return {
    id: `packer-${row.id || rowCode(row)}-${row.date || ''}-${rowTime(row)}`,
    source: 'Packer',
    code: row.code || row.no || '-',
    courier: row.courier || row.courierNo || '-',
    owner: row.packer || row.email || '-',
    time: row.time || '-',
    status: row.status || 'บันทึกแล้ว',
    statusTone: row.status === 'ผิดปกติ' ? 'warning' : 'success',
  };
}

function EmptyState({ signedIn, message }) {
  return (
    <div className="wms-empty-state" role="status">
      <ClipboardList size={24} aria-hidden="true" />
      <strong>{signedIn ? 'ยังไม่มีรายการในขอบเขตนี้' : 'เข้าสู่ระบบเพื่อดูข้อมูลจริง'}</strong>
      <span>{message}</span>
    </div>
  );
}

function DashboardView({
  dashboardSummary,
  driveRecentRows,
  driveTotalCount,
  isSheetConnected,
  isSignedIn,
  handleCheckMissingOrders,
  missingAlertBadge,
  missingBusy,
  packerCounts,
  recentRows,
  refreshAllCounts,
  scanQueueSnapshot,
  selectedCourier,
  summary,
  switchTab,
  today,
  totalTodayCount,
}) {
  const [activityFilter, setActivityFilter] = useState('all');
  const [query, setQuery] = useState('');

  const activityRows = useMemo(() => {
    const rows = [
      ...(activityFilter === 'all' || activityFilter === 'packer'
        ? (recentRows || []).map((row) => normalizeActivity(row, 'packer'))
        : []),
      ...(activityFilter === 'all' || activityFilter === 'drive'
        ? (driveRecentRows || []).map((row) => normalizeActivity(row, 'drive'))
        : []),
    ];
    const normalizedQuery = query.trim().toLowerCase();
    return rows
      .filter((row) => !normalizedQuery
        || [row.code, row.courier, row.owner, row.status, row.source]
          .some((value) => String(value).toLowerCase().includes(normalizedQuery)))
      .sort((a, b) => String(b.time).localeCompare(String(a.time)))
      .slice(0, 80);
  }, [activityFilter, driveRecentRows, query, recentRows]);

  const pendingQueue = (scanQueueSnapshot?.pending?.length || 0)
    + (scanQueueSnapshot?.processing ? 1 : 0);
  const failedQueue = scanQueueSnapshot?.failed || 0;
  const missingCount = dashboardSummary?.pendingTotalCount ?? missingAlertBadge ?? 0;
  const courierMax = Math.max(...(summary || []).map((item) => item.count || 0), 1);
  const packerMax = Math.max(...(packerCounts || []).map((item) => item.count || 0), 1);
  const dateLabel = today?.date || '-';

  return (
    <section className="wms-dashboard" aria-labelledby="dashboard-title">
      <header className="wms-page-header">
        <div>
          <span className="wms-kicker">มุมมอง WMS · งานภายใน</span>
          <h2 id="dashboard-title">ศูนย์ควบคุมงาน</h2>
          <p>ภาพรวมการแพ็กสินค้า การรับเข้า Drive และคิวเขียนข้อมูลของวันนี้</p>
        </div>
        <div className="wms-page-actions">
          <span className="wms-date-label">ข้อมูลวันที่ {dateLabel}</span>
          <button className="secondary-button" type="button" onClick={() => void refreshAllCounts()} disabled={!isSignedIn}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>รีเฟรชข้อมูล</span>
          </button>
          <button className="secondary-button" type="button" onClick={() => void handleCheckMissingOrders()} disabled={!isSignedIn || missingBusy}>
            <ShieldAlert size={16} aria-hidden="true" />
            <span>{missingBusy ? 'กำลังตรวจ...' : 'ตรวจออเดอร์ที่หาย'}</span>
          </button>
          <button className="primary-button" type="button" onClick={() => switchTab('packer')}>
            <PackageCheck size={16} aria-hidden="true" />
            <span>ไปหน้าสแกน</span>
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      {!isSignedIn ? (
        <div className="wms-dashboard-login-state">
          <Database size={28} aria-hidden="true" />
          <div className="wms-dashboard-login-copy">
            <strong>ศูนย์ควบคุมพร้อมใช้งาน</strong>
            <p>เข้าสู่ระบบด้วย Google จากแถบบนเพื่อดูข้อมูลจริงจาก Firestore และ Google Sheet</p>
          </div>
        </div>
      ) : (
        <>
          <div className="wms-kpi-grid" aria-label="สรุปยอดวันนี้">
            <article className="wms-kpi-card">
              <div className="wms-kpi-label">
                <div className="wms-kpi-icon success"><PackageCheck size={18} aria-hidden="true" /></div>
                <span>แพ็กสำเร็จวันนี้</span>
              </div>
              <strong>{formatNumber(totalTodayCount)}</strong>
              <small>รวมทุกขนส่งจาก Packer</small>
            </article>
            <article className="wms-kpi-card">
              <div className="wms-kpi-label">
                <div className="wms-kpi-icon info"><Upload size={18} aria-hidden="true" /></div>
                <span>รับเข้า Drive วันนี้</span>
              </div>
              <strong>{formatNumber(driveTotalCount)}</strong>
              <small>รายการที่ Admin รับเข้า</small>
            </article>
            <article className="wms-kpi-card">
              <div className="wms-kpi-label">
                <div className="wms-kpi-icon warning"><Activity size={18} aria-hidden="true" /></div>
                <span>คิวรอเขียน Sheet</span>
              </div>
              <strong>{formatNumber(pendingQueue)}</strong>
              <small>{failedQueue > 0 ? `ไม่สำเร็จ ${formatNumber(failedQueue)} รายการ` : 'สถานะคิวปกติ'}</small>
            </article>
            <article className="wms-kpi-card">
              <div className="wms-kpi-label">
                <div className="wms-kpi-icon danger"><ShieldAlert size={18} aria-hidden="true" /></div>
                <span>ออเดอร์ที่ต้องตรวจ</span>
              </div>
              <strong>{formatNumber(missingCount)}</strong>
              <small>{dashboardSummary ? 'จากการตรวจสอบล่าสุด' : 'กดตรวจจากเมนูเครื่องมือ'}</small>
            </article>
          </div>

          <div className="wms-dashboard-grid">
            <section className="wms-panel wms-activity-panel" aria-labelledby="dashboard-activity-title">
              <div className="wms-panel-header">
                <div>
                  <span className="wms-kicker">รายการล่าสุด</span>
                  <h3 id="dashboard-activity-title">กิจกรรมวันนี้</h3>
                </div>
                <span className="wms-scope-label">Packer: {selectedCourier}</span>
              </div>
              <div className="wms-filter-row">
                <div className="segmented-control" aria-label="กรองประเภทรายการ">
                  {[
                    ['all', 'ทั้งหมด'],
                    ['packer', 'Packer'],
                    ['drive', 'Drive'],
                  ].map(([value, label]) => (
                    <button key={value} className={activityFilter === value ? 'active' : ''} type="button" onClick={() => setActivityFilter(value)}>
                      {label}
                    </button>
                  ))}
                </div>
                <label className="wms-search-field">
                  <Search size={15} aria-hidden="true" />
                  <span className="visually-hidden">ค้นหารายการล่าสุด</span>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหา Tracking, ขนส่ง หรือผู้ปฏิบัติงาน" />
                </label>
              </div>
              <p className="wms-scope-note">รายการ Packer อ้างอิงขนส่งที่เลือกอยู่: <strong>{selectedCourier}</strong> · แสดงข้อมูลของวันที่ {dateLabel}</p>
              <div className="table-wrap wms-table-wrap">
                <table className="wms-table">
                  <thead>
                    <tr>
                      <th>ประเภท</th>
                      <th>Tracking / Barcode</th>
                      <th>ขนส่ง</th>
                      <th>ผู้ปฏิบัติงาน</th>
                      <th>เวลา</th>
                      <th>สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityRows.length === 0 ? (
                      <tr><td colSpan={6}><EmptyState signedIn={isSignedIn} message="ยังไม่มีรายการจริงที่ตรงกับตัวกรองนี้" /></td></tr>
                    ) : activityRows.map((row) => (
                      <tr key={row.id}>
                        <td><span className={`wms-source-badge ${row.source === 'Drive' ? 'drive' : 'packer'}`}>{row.source}</span></td>
                        <td className="code-cell">{row.code}</td>
                        <td>{row.courier}</td>
                        <td>{row.owner}</td>
                        <td>{row.time}</td>
                        <td><span className={`wms-status-badge ${row.statusTone}`}>{row.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <aside className="wms-dashboard-side">
              <section className="wms-panel" aria-labelledby="dashboard-connection-title">
                <div className="wms-panel-header compact">
                  <div>
                    <span className="wms-kicker">ระบบ</span>
                    <h3 id="dashboard-connection-title">การเชื่อมต่อและคิว</h3>
                  </div>
                  <CheckCircle2 size={18} className="wms-success-icon" aria-hidden="true" />
                </div>
                <div className="wms-connection-list">
                  <div><span>Firebase / Firestore</span><strong className="wms-text-success">เชื่อมต่อแล้ว</strong></div>
                  <div><span>Google Sheet</span><strong className={isSheetConnected ? 'wms-text-success' : 'wms-text-warning'}>{isSheetConnected ? 'พร้อมใช้งาน' : 'ไม่อยู่ใน session'}</strong></div>
                  <div><span>คิวเขียนข้อมูล</span><strong className={pendingQueue > 0 ? 'wms-text-warning' : 'wms-text-success'}>{pendingQueue > 0 ? 'กำลังดำเนินการ' : 'ว่าง'}</strong></div>
                </div>
                <button className="ghost-button wms-full-button" type="button" onClick={() => switchTab('drive')}>
                  <Truck size={15} aria-hidden="true" /> ตรวจงานรับเข้า Drive <ArrowRight size={14} aria-hidden="true" />
                </button>
              </section>

              <section className="wms-panel" aria-labelledby="dashboard-courier-title">
                <div className="wms-panel-header compact">
                  <div>
                    <span className="wms-kicker">ยอดแยกตามขนส่ง</span>
                    <h3 id="dashboard-courier-title">ปริมาณงานวันนี้</h3>
                  </div>
                  <BarChart3 size={18} aria-hidden="true" />
                </div>
                <div className="wms-bar-list">
                  {(summary || []).map((item) => (
                    <div className="wms-bar-item" key={item.courier}>
                      <div><span>{item.courier}</span><strong>{formatNumber(item.count)}</strong></div>
                      <span className="wms-bar-track"><span style={{ width: `${Math.round(((item.count || 0) / courierMax) * 100)}%` }} /></span>
                    </div>
                  ))}
                  {(summary || []).length === 0 && <span className="wms-inline-empty">ยังไม่มีข้อมูลขนส่ง</span>}
                </div>
              </section>

              <section className="wms-panel" aria-labelledby="dashboard-packer-title">
                <div className="wms-panel-header compact">
                  <div>
                    <span className="wms-kicker">ยอดแยกตาม Packer</span>
                    <h3 id="dashboard-packer-title">ทีมปฏิบัติงานวันนี้</h3>
                  </div>
                  <PackageCheck size={18} aria-hidden="true" />
                </div>
                <div className="wms-bar-list">
                  {(packerCounts || []).slice(0, 8).map((item) => {
                    const name = item.packer || item.name || '-';
                    const count = item.count || 0;
                    return (
                      <div className="wms-bar-item" key={name}>
                        <div><span>{name}</span><strong>{formatNumber(count)}</strong></div>
                        <span className="wms-bar-track"><span style={{ width: `${Math.round((count / packerMax) * 100)}%` }} /></span>
                      </div>
                    );
                  })}
                  {(packerCounts || []).length === 0 && <span className="wms-inline-empty">ยังไม่มีข้อมูล Packer</span>}
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

export default DashboardView;
