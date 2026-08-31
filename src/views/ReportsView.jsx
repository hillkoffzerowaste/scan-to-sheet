import React from 'react';
import { BarChart3, CalendarDays, ClipboardCopy, RefreshCw, Upload } from 'lucide-react';

// แยกออกมาจาก App.jsx โดยไม่แก้ตัว JSX เลย — เป็นการย้ายโค้ดล้วน
function ReportsView({
  activeTab,
  isSignedIn,
  reportMode,
  setReportMode,
  reportDate,
  setReportDate,
  reportStartDate,
  setReportStartDate,
  reportEndDate,
  setReportEndDate,
  reportMonth,
  setReportMonth,
  reportBusy,
  reportData,
  generateReport,
  copyReport,
  backfillBusy,
  backfillSelectedReportRange,
  couriers,
}) {
  return (
        <details className="report-panel secondary-panel" open={activeTab === 'reports'}>
          <summary className="report-header secondary-panel-summary">
            <div>
              <p className="eyebrow">Reports</p>
              <h2>รายงานสแกน</h2>
            </div>
            <div className="report-badge">
              <BarChart3 size={18} />
              <span>{reportData ? `${reportData.total} รายการ` : 'รอสร้างรายงาน'}</span>
            </div>
          </summary>

          <div className="report-controls">
            <div className="segmented-control">
              <button className={reportMode === 'daily' ? 'active' : ''} type="button" onClick={() => setReportMode('daily')}>
                รายวัน
              </button>
              <button className={reportMode === 'range' ? 'active' : ''} type="button" onClick={() => setReportMode('range')}>
                ช่วงวันที่
              </button>
              <button className={reportMode === 'month' ? 'active' : ''} type="button" onClick={() => setReportMode('month')}>
                รายเดือน
              </button>
            </div>

            {reportMode === 'daily' && (
              <label className="field-control">
                <span>วันที่</span>
                <input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
              </label>
            )}

            {reportMode === 'range' && (
              <div className="range-fields">
                <label className="field-control">
                  <span>เริ่มต้น</span>
                  <input type="date" value={reportStartDate} onChange={(event) => setReportStartDate(event.target.value)} />
                </label>
                <label className="field-control">
                  <span>สิ้นสุด</span>
                  <input type="date" value={reportEndDate} onChange={(event) => setReportEndDate(event.target.value)} />
                </label>
              </div>
            )}

            {reportMode === 'month' && (
              <label className="field-control">
                <span>เดือน</span>
                <input type="month" value={reportMonth} onChange={(event) => setReportMonth(event.target.value)} />
              </label>
            )}

            <button className="secondary-button report-button" type="button" onClick={generateReport} disabled={!isSignedIn || reportBusy}>
              {reportBusy ? <RefreshCw size={16} className="spin" /> : <CalendarDays size={16} />}
              <span>สร้างรายงาน</span>
            </button>

            <button className="secondary-button report-button" type="button" onClick={backfillSelectedReportRange} disabled={!isSignedIn || backfillBusy}>
              {backfillBusy ? <RefreshCw size={16} className="spin" /> : <Upload size={16} />}
              <span>Import Sheet to Firestore</span>
            </button>

            <button className="ghost-button report-button" type="button" onClick={copyReport} disabled={!reportData}>
              <ClipboardCopy size={16} />
              <span>คัดลอกรายงาน</span>
            </button>
          </div>

          <div className="report-summary">
            <div>
              <span>ช่วงรายงาน</span>
              <strong>{reportData?.label ?? '-'}</strong>
            </div>
            <div>
              <span>ยอดส่งจริง</span>
              <strong>{reportData?.total ?? 0}</strong>
            </div>
            <div>
              <span>ยกเลิก</span>
              <strong>{reportData?.cancelledTotal ?? 0}</strong>
            </div>
            <div>
              <span>ตีกลับ</span>
              <strong>{reportData?.returnedTotal ?? 0}</strong>
            </div>
            <div>
              <span>สินค้าเสียหาย</span>
              <strong>{reportData?.damagedTotal ?? 0}</strong>
            </div>
            <div>
              <span>จำนวนวัน</span>
              <strong>{reportData?.days?.length ?? 0}</strong>
            </div>
          </div>

          <div className="report-grid">
            {couriers.map((courier) => {
              const count = reportData?.couriers?.find((item) => item.courier === courier)?.count ?? 0;
              return (
                <div className="report-card" key={courier}>
                  <span>{courier}</span>
                  <strong>{count}</strong>
                </div>
              );
            })}
          </div>

          <div className="recent-header">
            <h3>สรุปตามวันที่</h3>
          </div>
          <div className="table-wrap report-table">
            <table>
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>ส่งจริง</th>
                  <th>ยกเลิก</th>
                  <th>ตีกลับ</th>
                  <th>เสียหาย</th>
                  {couriers.map((courier) => (
                    <th key={courier}>{courier}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!reportData ? (
                  <tr>
                    <td colSpan={couriers.length + 5} className="empty-cell">
                      เลือกรูปแบบรายงานแล้วกดสร้างรายงาน
                    </td>
                  </tr>
                ) : (
                  reportData.days.map((day) => (
                    <tr key={day.date}>
                      <td>{day.date}</td>
                      <td>{day.total}</td>
                      <td>{day.cancelledTotal ?? 0}</td>
                      <td>{day.returnedTotal ?? 0}</td>
                      <td>{day.damagedTotal ?? 0}</td>
                      {couriers.map((courier) => (
                        <td key={courier}>{day.couriers.find((item) => item.courier === courier)?.count ?? 0}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="recent-header">
            <h3>รายการสินค้าตีกลับ</h3>
          </div>
          <div className="table-wrap report-table">
            <table>
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>เวลา</th>
                  <th>ขนส่ง</th>
                  <th>Tracking / Barcode</th>
                </tr>
              </thead>
              <tbody>
                {!reportData ? (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      เลือกรูปแบบรายงานแล้วกดสร้างรายงาน
                    </td>
                  </tr>
                ) : reportData.returnedRows?.length > 0 ? (
                  reportData.returnedRows.map((row) => (
                    <tr key={`${row.date}-${row.time}-${row.courier}-${row.code}`}>
                      <td>{row.date}</td>
                      <td>{row.time}</td>
                      <td>{row.courier}</td>
                      <td className="code-cell">{row.code}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      ไม่มีรายการสินค้าตีกลับในช่วงนี้
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="recent-header">
            <h3>รายการสินค้าเสียหาย</h3>
          </div>
          <div className="table-wrap report-table">
            <table>
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>เวลา</th>
                  <th>ขนส่ง</th>
                  <th>Tracking / Barcode</th>
                </tr>
              </thead>
              <tbody>
                {!reportData ? (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      เลือกรูปแบบรายงานแล้วกดสร้างรายงาน
                    </td>
                  </tr>
                ) : reportData.damagedRows?.length > 0 ? (
                  reportData.damagedRows.map((row) => (
                    <tr key={`${row.date}-${row.time}-${row.courier}-${row.code}`}>
                      <td>{row.date}</td>
                      <td>{row.time}</td>
                      <td>{row.courier}</td>
                      <td className="code-cell">{row.code}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      ไม่มีรายการสินค้าเสียหายในช่วงนี้
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="recent-header">
            <h3>รายการยกเลิก</h3>
          </div>
          <div className="table-wrap report-table">
            <table>
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>เวลา</th>
                  <th>ขนส่ง</th>
                  <th>Tracking / Barcode</th>
                </tr>
              </thead>
              <tbody>
                {!reportData ? (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      เลือกรูปแบบรายงานแล้วกดสร้างรายงาน
                    </td>
                  </tr>
                ) : reportData.cancelledRows?.length > 0 ? (
                  reportData.cancelledRows.map((row) => (
                    <tr key={`${row.date}-${row.time}-${row.courier}-${row.code}`}>
                      <td>{row.date}</td>
                      <td>{row.time}</td>
                      <td>{row.courier}</td>
                      <td className="code-cell">{row.code}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      ไม่มีรายการยกเลิกในช่วงนี้
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </details>
  );
}

export default ReportsView;
