import React from 'react';
import { AlertTriangle, ArrowRightLeft, Camera, CheckCircle2, ClipboardCopy, Clock3, ExternalLink, FileSpreadsheet, MonitorCheck, PackageCheck, Play, Plus, RefreshCw, ScanLine, Search, ShieldAlert, Square, Truck, Upload } from 'lucide-react';
import { CAMERA_REGION_ID, DEFAULT_LOOKBACK_HOURS, ISSUE_CUSTOMER_CANCELLED, ISSUE_DAMAGED, ISSUE_RETURNED, PACKER_UNASSIGNED } from '../constants.js';
import { DeploymentUpdateBanner, StatusBanner } from './StatusBanner.jsx';
import { CourierQrPanel } from './ScanQrPanels.jsx';

// แยกออกมาจาก App.jsx โดยไม่แก้ตัว JSX เลย — เป็นการย้ายโค้ดล้วน
function WorkflowView({
  activeTab,
  addingCourier,
  allowAnyTrackingFormat,
  busy,
  cameraActive,
  cameraMessage,
  cameraMessageType,
  config,
  copyCompactSummary,
  copyMissingReport,
  courierSelectValue,
  couriers,
  dashboardSummary,
  deploymentUpdateAvailable,
  displayedCourierCounts,
  displayedRecentRows,
  driveRecentRows,
  driveTotalCount,
  firebaseUser,
  handleAddCourier,
  handleBarcodeKeyDown,
  handleCheckMissingOrders,
  handleScanSubmit,
  handleSearchSubmit,
  inputRef,
  isPackerReady,
  isSheetConnected,
  isSignedIn,
  markSearchResultDamaged,
  marketplaceFileRef,
  marketplaceFilterPlatform,
  marketplaceUploadBusy,
  marketplaceUploadResult,
  missingBusy,
  missingResults,
  missingUISections,
  newCourierName,
  packerCounts,
  packerOptions,
  recentRows,
  recoverSelectedSheetRange,
  refreshAllCounts,
  qrLayout,
  resetQrLayout,
  scanFlash,
  scanMethod,
  scanQueueSnapshot,
  scanQueueStatusText,
  scanRemark,
  scanValue,
  searchBusy,
  searchEndDate,
  searchMode,
  searchResults,
  searchScope,
  searchStartDate,
  searchValue,
  selectedCount,
  selectedCourier,
  selectedPacker,
  setAllowAnyTrackingFormat,
  setCourierSelectValue,
  setMarketplaceFilterPlatform,
  setNewCourierName,
  setScanMethod,
  setScanPopupOpen,
  setScanRemark,
  setScanValue,
  setSearchEndDate,
  setSearchMode,
  setSearchScope,
  setSearchStartDate,
  setSearchValue,
  setSelectedCourier,
  setSelectedPacker,
  setSheetRecoveryEndDate,
  setSheetRecoveryStartDate,
  setShowAllRecentRows,
  setThresholdMinutes,
  setQrLayout,
  sheetRecoveryBusy,
  sheetRecoveryEndDate,
  sheetRecoveryStartDate,
  sheetUrl,
  showAllRecentRows,
  startCamera,
  status,
  stopCamera,
  summary,
  thresholdMinutes,
  today,
  token,
  totalTodayCount,
  uploadMarketplaceFiles,
}) {
  return (
        <>
          <section className={`workflow-guide ${activeTab === 'drive' ? 'drive-workflow-guide' : 'packer-workflow-guide'}`}>
            {activeTab === 'drive' ? <Upload size={24} /> : <PackageCheck size={24} />}
            <div>
              <strong>{activeTab === 'drive' ? 'รับเข้า Drive' : 'แพ็กสินค้า'}</strong>
              <p>{activeTab === 'drive' ? 'สแกนรับพัสดุเข้าระบบก่อนส่งให้ Packer แพ็กสินค้า' : 'สแกนพัสดุหลังแพ็กเสร็จ เพื่อบันทึกผู้แพ็กและสถานะ'}</p>
            </div>
          </section>

          <section className={`workspace-grid qr-layout-${qrLayout}`}>
        <aside className={`side-panel workflow-${activeTab}`}>
          <div className="panel-heading">
            <Truck size={18} />
            <span>เลือกขนส่ง</span>
          </div>

          <div className="courier-list">
            {couriers.map((courier) => (
              <button
                className={`courier-button ${courier === selectedCourier ? 'active' : ''}`}
                key={courier}
                type="button"
                onClick={() => {
                  setSelectedCourier(courier);
                  setScanPopupOpen(true);
                  setScanRemark('');
                }}
                disabled={!isSignedIn || cameraActive}
              >
                <span>{courier}</span>
                <strong>{displayedCourierCounts.find((item) => item.courier === courier)?.count ?? 0}</strong>
              </button>
            ))}
          </div>

          <form className="courier-add-form" onSubmit={(event) => { event.preventDefault(); void handleAddCourier(); }}>
            <label htmlFor="courier-select">เพิ่มขนส่งเอง</label>
            <div className="courier-add-row">
              <select
                id="courier-select"
                value={courierSelectValue}
                onKeyDown={handleBarcodeKeyDown}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value) {
                    setSelectedCourier(value);
                    setAllowAnyTrackingFormat(true);
                    setScanPopupOpen(true);
                    setScanRemark('');
                    setCourierSelectValue('');
                  }
                }}
                disabled={!firebaseUser || addingCourier}
              >
                <option value="">เลือกจากขนส่งที่มี...</option>
                {couriers.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="courier-add-divider">
              <span>หรือพิมพ์ชื่อขนส่งใหม่</span>
            </div>
            <div>
              <input
                id="new-courier-name"
                value={newCourierName}
                onChange={(event) => setNewCourierName(event.target.value)}
                placeholder="เช่น DHL"
                maxLength={80}
                disabled={!firebaseUser || addingCourier}
              />
              <button type="submit" disabled={!firebaseUser || addingCourier || !newCourierName.trim()} title="เพิ่มขนส่ง">
                <Plus size={16} />
              </button>
            </div>
            <small>ผู้ใช้ที่ลงชื่อเข้าใช้เพิ่มได้ และจะแสดงทั้งหน้าแพ็ก/Drive</small>
          </form>

          <div className="scan-tool-panel" aria-label="เลือกวิธีสแกน">
            <div className="segmented-control">
              <button
                className={scanMethod === 'manual' ? 'active' : ''}
                type="button"
                onClick={() => setScanMethod('manual')}
              >
                <ScanLine size={16} />
                <span>เครื่องยิง/พิมพ์</span>
              </button>
              <button
                className={scanMethod === 'camera' ? 'active' : ''}
                type="button"
                onClick={() => setScanMethod('camera')}
              >
                <Camera size={16} />
                <span>กล้องมือถือ</span>
              </button>
            </div>
            {scanMethod === 'manual' && (
              <label className="manual-format-option">
                <input
                  type="checkbox"
                  checked={allowAnyTrackingFormat}
                  onChange={(event) => setAllowAnyTrackingFormat(event.target.checked)}
                  disabled={!isSignedIn || busy}
                />
                <span>เลขพิเศษ: ไม่ตรวจรูปแบบ Tracking</span>
              </label>
            )}
          </div>
        </aside>

        <section className={`scan-panel workflow-${activeTab}`}>
          <div className="scan-header">
            <div>
              <p className="eyebrow">{activeTab === 'drive' ? 'รับเข้า Drive →' : 'ขนส่งที่เลือก'}</p>
              <h2>{selectedCourier}</h2>
              {activeTab === 'drive' && (
                <span className="drive-mode-label">📥 รับเข้า Drive ก่อนส่งให้ Packer สแกนแพ็ก</span>
              )}
            </div>
            <div className="date-box">
              <Clock3 size={18} />
              <span>{today.date}</span>
              <strong>{today.time}</strong>
            </div>
          </div>

          {/* Packer-only controls */}
          {activeTab === 'packer' && (
            <div className={`issue-bar ${scanRemark ? 'active' : ''}`}>
                <label className="packer-control">
                  <span>Packer</span>
                  <select value={selectedPacker} onKeyDown={handleBarcodeKeyDown} onChange={(event) => setSelectedPacker(event.target.value)} disabled={!isSignedIn || busy}>
                    {packerOptions.map((packer) => (
                      <option key={packer} value={packer}>
                        {packer}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className={scanRemark === ISSUE_CUSTOMER_CANCELLED ? 'active' : ''}
                  type="button"
                  onClick={() =>
                    setScanRemark((value) => (value === ISSUE_CUSTOMER_CANCELLED ? '' : ISSUE_CUSTOMER_CANCELLED))
                  }
                  disabled={!isSignedIn || busy}
                >
                  {scanRemark === ISSUE_CUSTOMER_CANCELLED ? `✓ ${ISSUE_CUSTOMER_CANCELLED}` : ISSUE_CUSTOMER_CANCELLED}
                </button>
                <button
                  className={scanRemark === ISSUE_RETURNED ? 'active' : ''}
                  type="button"
                  onClick={() => setScanRemark((value) => (value === ISSUE_RETURNED ? '' : ISSUE_RETURNED))}
                  disabled={!isSignedIn || busy}
                >
                  {scanRemark === ISSUE_RETURNED ? `✓ ${ISSUE_RETURNED}` : ISSUE_RETURNED}
                </button>
                <span>
                  {scanRemark
                    ? `รายการถัดไป: ${selectedPacker} / ${scanRemark}`
                    : selectedPacker === PACKER_UNASSIGNED
                      ? 'ต้องเลือก Packer ก่อนสแกน'
                      : `รายการถัดไปบันทึก Packer: ${selectedPacker}`}
                </span>
            </div>
          )}

          {allowAnyTrackingFormat && (
            <div className="any-format-warning">
              <AlertTriangle size={16} />
              <span>⚠️ ข้ามการตรวจรูปแบบ Tracking: เลขอะไรก็สแกนผ่าน</span>
            </div>
          )}

          <div className={`current-courier-badge workflow-${activeTab}`}>
            <Truck size={18} />
            <span>{activeTab === 'drive' ? 'กำลังรับเข้า Drive' : 'กำลังสแกนแพ็ก'}</span>
            <strong>{selectedCourier}</strong>
          </div>

          <div className="operation-context" aria-label="บริบทการทำงานปัจจุบัน">
            <div className="operation-context-item">
              <span>Workflow</span>
              <strong>{activeTab === 'drive' ? 'รับเข้า Drive' : 'แพ็กสินค้า'}</strong>
            </div>
            {activeTab === 'packer' && (
              <div className="operation-context-item">
                <span>Packer</span>
                <strong>{selectedPacker}</strong>
              </div>
            )}
            <div className="operation-context-item">
              <span>โหมดสแกน</span>
              <strong>ต่อเนื่อง</strong>
            </div>
            <div className="operation-context-item">
              <span>ช่องทาง</span>
              <strong>{scanMethod === 'camera' ? 'กล้อง' : 'เครื่องยิง / พิมพ์'}</strong>
            </div>
          </div>

          <details className="sheet-recovery-panel secondary-panel">
            <summary className="secondary-panel-summary">
              <div>
                <p className="eyebrow">Recovery</p>
                <h3>{activeTab === 'packer' ? 'ตรวจและกู้ Packer เข้า Sheet' : 'ตรวจและกู้ Admin เข้า Sheet'}</h3>
              </div>
              <span className="secondary-panel-label">เครื่องมือรอง</span>
            </summary>
            <div className="sheet-recovery-content" aria-label="Recovery Firestore to Sheet">
              <div className="sheet-recovery-controls">
              <div className="range-fields">
                <label className="field-control">
                  <span>Recovery from</span>
                  <input
                    type="date"
                    value={sheetRecoveryStartDate}
                    onChange={(event) => setSheetRecoveryStartDate(event.target.value)}
                  />
                </label>
                <label className="field-control">
                  <span>Recovery to</span>
                  <input
                    type="date"
                    value={sheetRecoveryEndDate}
                    onChange={(event) => setSheetRecoveryEndDate(event.target.value)}
                  />
                </label>
              </div>
              </div>
              <p>อ่านข้อมูลจาก Firestore แล้วตรวจซ้ำกับ Sheet ก่อนยืนยันสถานะ ไม่สร้างแถวซ้ำถ้ามีข้อมูลครบแล้ว</p>
              <button
                className="secondary-button"
                type="button"
                data-testid={`sheet-recovery-${activeTab}`}
                onClick={() => { void recoverSelectedSheetRange(); }}
                disabled={sheetRecoveryBusy || !firebaseUser || !token || !config?.master?.id}
                title="ตรวจข้อมูล Firestore ของช่วงวันที่เลือกและเขียนเฉพาะส่วนที่ขาดลง Google Sheet"
              >
                {sheetRecoveryBusy ? <RefreshCw size={16} className="spin" /> : <RefreshCw size={16} />}
                <span>{sheetRecoveryBusy ? 'กำลัง Recovery...' : 'Recovery Firestore → Sheet'}</span>
              </button>
            </div>
          </details>

          {scanMethod === 'camera' ? (
            <div className={`camera-panel workflow-${activeTab}`}>
              <div className={`camera-stage ${cameraActive ? 'active' : ''}`}>
                <div id={CAMERA_REGION_ID} className="camera-reader" />
                <div className="scan-frame" aria-hidden="true">
                  <span />
                </div>
              </div>
              <div className="camera-footer">
                <p className={`camera-message ${cameraMessageType}`}>{cameraMessage}</p>
                <div className="camera-actions">
                  {cameraActive ? (
                    <button className="ghost-button" type="button" onClick={stopCamera}>
                      <Square size={16} />
                      <span>หยุดกล้อง</span>
                    </button>
                  ) : (
                    <button
                      className="secondary-button"
                      type="button"
                      // ต้องห่อด้วย arrow: startCamera(regionId) รับ id ของกล่องกล้อง ถ้าส่ง
                      // ตรง React จะยัด event เข้าไปเป็น regionId แล้ว Html5Qrcode หา element ไม่เจอ
                      onClick={() => startCamera()}
                      disabled={busy || !isSignedIn}
                    >
                      <Camera size={16} />
                      <span>เปิดกล้อง</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <form className={`scan-form workflow-${activeTab}`} onSubmit={handleScanSubmit}>
              <label htmlFor="scan-input">
                {activeTab === 'drive' ? 'Tracking / Barcode (รับเข้า Drive)' : 'Tracking / Barcode (แพ็กสินค้า)'}
              </label>
              <div className={`scan-input-row ${scanFlash ? 'flash' : ''}`}>
                <ScanLine size={24} />
                <input
                  id="scan-input"
                  ref={inputRef}
                  value={scanValue}
                  onChange={(event) => setScanValue(event.target.value)}
                  onKeyDown={handleBarcodeKeyDown}
                  placeholder={
                    isSignedIn
                      ? activeTab === 'drive'
                        ? 'ยิงบาร์โค้ดหรือ QR แล้วกด Enter เพื่อรับเข้า Drive'
                        : isPackerReady
                          ? 'ยิงบาร์โค้ดหรือ QR แล้วกด Enter'
                          : 'เลือก Packer ก่อนเริ่มสแกน'
                      : 'Login with Google ก่อนเริ่มสแกน'
                  }
                  autoComplete="off"
                    disabled={!isSignedIn}
                />
                <button type="submit" disabled={!isSignedIn}>
                  {scanQueueSnapshot.processing ? <RefreshCw size={18} className="spin" /> : <Play size={18} />}
                  <span>{activeTab === 'drive' ? 'รับเข้า Drive' : 'บันทึกแพ็ก'}</span>
                </button>
              </div>
              <p className="scan-queue-status" role="status" aria-live="polite">
                {scanQueueStatusText}
              </p>
            </form>
          )}

          {/* Packer-only: Search, Status, Metrics, Recent, Reports */}
          {activeTab === 'packer' && (
            <>
              <details className="search-panel secondary-panel">
                <summary className="search-heading">
                  <div>
                    <p className="eyebrow">Lookup</p>
                    <h3>ค้นหาเลขพัสดุ</h3>
                  </div>
                  <span>{searchResults ? `${searchResults.length} รายการ` : 'ยังไม่ได้ค้นหา'}</span>
                </summary>

                <form className="search-form" onSubmit={handleSearchSubmit}>
                  <label className="field-control search-code-field">
                    <span>เลขพัสดุ</span>
                    <div className="search-input-row">
                      <Search size={20} />
                      <input
                        value={searchValue}
                        onChange={(event) => setSearchValue(event.target.value)}
                        placeholder="พิมพ์เลขพัสดุหรือบางส่วนของเลข"
                        autoComplete="off"
                        disabled={searchBusy || !isSignedIn}
                      />
                    </div>
                  </label>

                  <div className="segmented-control search-scope-control">
                    <button className={searchScope === 'selected' ? 'active' : ''} type="button" onClick={() => setSearchScope('selected')}>
                      ขนส่งนี้
                    </button>
                    <button className={searchScope === 'all' ? 'active' : ''} type="button" onClick={() => setSearchScope('all')}>
                      ทุกขนส่ง
                    </button>
                  </div>

                  <div className="segmented-control search-date-control">
                    <button className={searchMode === 'today' ? 'active' : ''} type="button" onClick={() => setSearchMode('today')}>
                      วันนี้
                    </button>
                    <button className={searchMode === 'range' ? 'active' : ''} type="button" onClick={() => setSearchMode('range')}>
                      ช่วงวันที่
                    </button>
                    <button className={searchMode === 'all' ? 'active' : ''} type="button" onClick={() => setSearchMode('all')}>
                      ทุกวัน
                    </button>
                  </div>

                  {searchMode === 'range' && (
                    <div className="range-fields search-range">
                      <label className="field-control">
                        <span>เริ่มต้น</span>
                        <input type="date" value={searchStartDate} onChange={(event) => setSearchStartDate(event.target.value)} />
                      </label>
                      <label className="field-control">
                        <span>สิ้นสุด</span>
                        <input type="date" value={searchEndDate} onChange={(event) => setSearchEndDate(event.target.value)} />
                      </label>
                    </div>
                  )}

                  <button className="secondary-button search-button" type="submit" disabled={searchBusy || !isSignedIn}>
                    {searchBusy ? <RefreshCw size={16} className="spin" /> : <Search size={16} />}
                    <span>ค้นหา</span>
                  </button>
                </form>

                {searchResults && (
                  <div className="search-results">
                    {searchResults.length === 0 ? (
                      <div className="empty-search">ไม่พบเลขพัสดุในเงื่อนไขที่เลือก</div>
                    ) : (
                      <div className="table-wrap search-table">
                        <table>
                          <thead>
                            <tr>
                              <th>ขนส่ง</th>
                              <th>วันที่</th>
                              <th>เวลา</th>
                              <th>Tracking / Barcode</th>
                              <th>Status</th>
                              <th>Remark / Issue</th>
                              <th>ผู้สแกน</th>
                              <th>หมายเหตุ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {searchResults.map((row) => (
                              <tr key={`${row.courier}-${row.date}-${row.no}-${row.code}`}>
                                <td>{row.courier}</td>
                                <td>{row.date}</td>
                                <td>{row.time}</td>
                                <td className="code-cell">{row.code}</td>
                                <td><span className={`status-badge ${(row.status || '').toLowerCase()}`}>{row.status}</span></td>
                                <td>{row.note || '-'}</td>
                                <td>{row.email}</td>
                                <td>
                                  <button
                                    className="table-action-button"
                                    type="button"
                                    onClick={() => markSearchResultDamaged(row)}
                                    disabled={
                                      searchBusy ||
                                      row.note === ISSUE_DAMAGED ||
                                      row.status === 'Damaged' ||
                                      row.note === ISSUE_CUSTOMER_CANCELLED ||
                                      row.status === 'Cancelled'
                                    }
                                  >
                                    {row.note === ISSUE_DAMAGED || row.status === 'Damaged'
                                      ? 'บันทึกแล้ว'
                                      : row.note === ISSUE_CUSTOMER_CANCELLED || row.status === 'Cancelled'
                                        ? 'ยกเลิกแล้ว'
                                        : ISSUE_DAMAGED}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </details>

              {deploymentUpdateAvailable && <DeploymentUpdateBanner />}
              <StatusBanner status={status} />

              <div className="metric-row">
                <div>
                  <span>รวมวันนี้ทั้งหมด</span>
                  <strong>{totalTodayCount}</strong>
                </div>
                <div>
                  <span>{selectedCourier} วันนี้</span>
                  <strong>{selectedCount}</strong>
                </div>
                <div>
                  <span>แผ่นงาน</span>
                  <strong>{today.date}</strong>
                </div>
                <div>
                  <span>สถานะ</span>
                  <strong>{isSignedIn ? (isSheetConnected ? 'Firestore + Sheet Sync' : 'Firestore') : 'รอ Login'}</strong>
                </div>
              </div>

              {isSignedIn && totalTodayCount > 0 && (
                <div className="packer-section">
                  <div className="packer-header">
                    <span className="eyebrow">Packer วันนี้</span>
                    <button
                      className="text-button refresh-button"
                      type="button"
                      onClick={() => refreshAllCounts()}
                      title="รีเฟรชข้อมูลจาก Sheet"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                  <div className="packer-row">
                    {packerCounts.map(({ packer, count }) => (
                      <div key={packer}>
                        <span>{packer}</span>
                        <strong>{count}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="recent-header">
                <h3>รายการล่าสุด</h3>
                <span className="grid-count">
                  แสดง {displayedRecentRows.length} จาก {recentRows.length} แถว
                </span>
                <div className="recent-actions">
                  {recentRows.length > 3 && (
                    <button className="text-button" type="button" onClick={() => setShowAllRecentRows((value) => !value)}>
                      {showAllRecentRows ? 'ย่อกลับ' : `ดูเพิ่มเติม (${recentRows.length})`}
                    </button>
                  )}
                  {sheetUrl && (
                    <a href={sheetUrl} target="_blank" rel="noreferrer">
                      เปิด Sheet <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Courier No.</th>
                      <th>เวลา</th>
                      <th>Tracking / Barcode</th>
                      <th>ผู้สแกน</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRows.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="empty-cell">
                          {isSignedIn ? 'ยังไม่มีรายการของวันนี้ใน Firestore' : 'เข้าสู่ระบบเพื่อโหลดรายการ'}
                        </td>
                      </tr>
                    ) : (
                      displayedRecentRows.map((row) => (
                        <tr key={`${row.no}-${row.courierNo}-${row.code}-${row.time}`}>
                          <td>{row.courierNo}</td>
                          <td>{row.time}</td>
                          <td className="code-cell">{row.code}</td>
                          <td>{row.email}</td>
                          <td>
                            <span className={`status-badge ${(row.status || '').toLowerCase()}`}>{row.status}</span>
                            {row.date && row.adminDate && row.date !== row.adminDate && <span className="status-badge cross-day">ข้ามวัน</span>}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Drive-only: Dashboard + Missing Order Check */}
          {activeTab === 'drive' && (
            <>
              {deploymentUpdateAvailable && <DeploymentUpdateBanner />}
              <StatusBanner status={status} />

              {/* Drive Dashboard */}
              <div className="drive-dashboard">
                <div className="drive-card total">
                  <ArrowRightLeft size={18} />
                  <span>ลง Drive วันนี้</span>
                  <strong>{driveTotalCount}</strong>
                </div>
                {dashboardSummary && (
                  <>
                    <div className="drive-card matched">
                      <CheckCircle2 size={18} />
                      <span>จับคู่แล้ว</span>
                      <strong>{dashboardSummary.matchedCount}</strong>
                    </div>
                    <div className={`drive-card ${dashboardSummary.pendingCount > 0 ? 'danger' : ''}`}>
                      <ShieldAlert size={18} />
                      <span>ตกหล่น</span>
                      <strong>{dashboardSummary.pendingCount}</strong>
                    </div>
                    <div className={`drive-card ${dashboardSummary.pendingOverOneDayCount > 0 ? 'danger' : 'muted'}`}>
                      <ShieldAlert size={18} />
                      <span>รอแพ็คเกิน 1 วัน</span>
                      <strong>{dashboardSummary.pendingOverOneDayCount}</strong>
                    </div>
                    <div className="drive-card muted">
                      <Clock3 size={18} />
                      <span>รอแพ็ค</span>
                      <strong>{dashboardSummary.tooSoonCount}</strong>
                    </div>
                  </>
                )}
              </div>

              {/* Missing Order Check */}
              <section className="missing-check-panel" aria-label="ตรวจสอบออเดอร์ตกหล่น">
                <div className="missing-check-header">
                  <div>
                    <p className="eyebrow">ตรวจสอบออเดอร์</p>
                    <h3>จับคู่ Admin ↔ Packer</h3>
                  </div>
                </div>

                <div className="missing-check-controls">
                  <label className="field-control">
                    <span>เกณฑ์เวลาแจ้งเตือน (นาที)</span>
                    <select
                      value={thresholdMinutes}
                      onChange={(e) => setThresholdMinutes(Number(e.target.value))}
                    >
                      <option value="15">15 นาที</option>
                      <option value="30">30 นาที</option>
                      <option value="60">1 ชั่วโมง</option>
                      <option value="120">2 ชั่วโมง</option>
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={handleCheckMissingOrders}
                    disabled={missingBusy || !isSignedIn}
                  >
                    {missingBusy ? <RefreshCw size={16} className="spin" /> : <MonitorCheck size={16} />}
                    <span>ตรวจสอบออเดอร์ตกหล่น</span>
                  </button>
                </div>

                {missingResults && (
                  <div className="missing-results">
                    <div className="missing-results-actions">
                      <button className="ghost-button" type="button" onClick={copyMissingReport}>
                        <ClipboardCopy size={14} />
                        <span>คัดลอกรายงาน</span>
                      </button>
                      <button className="ghost-button" type="button" onClick={copyCompactSummary}>
                        <ClipboardCopy size={14} />
                        <span>คัดลอกสรุป</span>
                      </button>
                    </div>

                    <div className="missing-summary">
                      ตรวจย้อนหลัง {DEFAULT_LOOKBACK_HOURS} ชม. | เกณฑ์ {thresholdMinutes} นาที
                    </div>

                    {missingUISections.map((section) => (
                      <div key={section.type} className={`missing-result-card ${section.color}`}>
                        <div className="missing-result-card-header">
                          <span>{section.label}</span>
                          <strong>{section.count} รายการ</strong>
                        </div>
                        {section.rows.length > 0 && section.rows.length <= 20 && (
                          <div className="missing-result-list">
                            {section.rows.slice(0, 10).map((row, idx) => (
                              <div key={idx} className="missing-result-item">
                                <span className="code-cell">{row.adminCode}</span>
                                <span className="missing-courier">{row.courier}</span>
                                <span className="missing-time">{row.adminTime || row.time || '--:--'}</span>
                              </div>
                            ))}
                            {section.rows.length > 10 && (
                              <div className="missing-result-more">
                                ...และอีก {section.rows.length - 10} รายการ
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}

                    {missingUISections.length === 0 && (
                      <div className="empty-search">กดตรวจสอบเพื่อเริ่มต้น</div>
                    )}
                  </div>
                )}
              </section>

              {/* Drive Recent Rows */}
              <div className="recent-header">
                <h3>รายการที่ลง Drive</h3>
                <span className="grid-count">
                  แสดง {Math.min(driveRecentRows.length, 10)} จาก {driveRecentRows.length} แถว
                </span>
                <div className="recent-actions">
                  {sheetUrl && (
                    <a href={sheetUrl} target="_blank" rel="noreferrer">
                      เปิด Sheet <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>เวลา</th>
                      <th>Admin Tracking</th>
                      <th>Packer Tracking</th>
                      <th>Status</th>
                      <th>Courier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driveRecentRows.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="empty-cell">
                          {isSignedIn ? 'ยังไม่มีรายการลง Drive ของวันนี้' : 'เข้าสู่ระบบเพื่อโหลดรายการ'}
                        </td>
                      </tr>
                    ) : (
                      driveRecentRows.slice(0, 10).map((row) => (
                        <tr key={`${row.no}-${row.adminCode}-${row.adminTime}`}>
                          <td>{row.adminTime || row.time}</td>
                          <td className="code-cell">{row.adminCode || '-'}</td>
                          <td className="code-cell">{row.code || 'รอแพ็ค'}</td>
                          <td>
                            <span className={`status-badge ${(row.status || '').toLowerCase()}`}>{row.status || 'รอแพ็ค'}</span>
                            {row.date && row.adminDate && row.date !== row.adminDate && <span className="status-badge cross-day">ข้ามวัน</span>}
                          </td>
                          <td>{row.courier}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
          <CourierQrPanel
            couriers={couriers}
            role={activeTab === 'drive' ? 'admin' : 'packer'}
            className="workspace-qr-panel"
            layout={qrLayout}
            layoutLabel="หน้าแรก"
            onLayoutChange={setQrLayout}
            onLayoutReset={resetQrLayout}
          />
      </section>

          <details className="marketplace-upload-panel secondary-panel">
        <summary className="secondary-panel-summary">
          <div>
          <div className="panel-heading" id="marketplace-upload-title">
            <FileSpreadsheet size={18} />
            <span>อัปโหลดออเดอร์ Seller Center</span>
          </div>
          <p>เลือกไฟล์ .xlsx หรือ .csv จาก Shopee, Lazada และ TikTok ได้หลายไฟล์พร้อมกัน</p>
          </div>
          <span className="secondary-panel-label">เครื่องมือรอง</span>
        </summary>
        <div className="marketplace-upload-content">
          <div className="marketplace-upload-controls">
          <label className="field-control marketplace-filter">
            <span>กรองแพลตฟอร์ม</span>
            <select
              value={marketplaceFilterPlatform}
              onChange={(e) => setMarketplaceFilterPlatform(e.target.value)}
              disabled={!firebaseUser || marketplaceUploadBusy}
            >
              <option value="all">ทุกแพลตฟอร์ม</option>
              <option value="shopee">Shopee</option>
              <option value="lazada">Lazada</option>
              <option value="tiktok">TikTok</option>
            </select>
          </label>
          <input
            ref={marketplaceFileRef}
            className="visually-hidden marketplace-file-input"
            type="file"
            accept=".xlsx,.csv"
            multiple
            onChange={uploadMarketplaceFiles}
            aria-label="เลือกไฟล์ออเดอร์ Seller Center"
          />
          <button
            className="secondary-button"
            type="button"
            onClick={() => marketplaceFileRef.current?.click()}
            disabled={!firebaseUser || marketplaceUploadBusy}
          >
            {marketplaceUploadBusy ? <RefreshCw size={16} className="spin" /> : <Upload size={16} />}
            <span>{marketplaceUploadBusy ? 'กำลังอัปโหลด...' : 'เลือกไฟล์ออเดอร์'}</span>
          </button>
          </div>
          {marketplaceUploadResult && (
            <div className={`marketplace-upload-result ${marketplaceUploadResult.type}`} role="status">
              {marketplaceUploadResult.message}
            </div>
          )}
        </div>
          </details>

          <details className="standards-panel secondary-panel">
            <summary className="secondary-panel-summary">
              <div>
                <div className="panel-heading">
                  <CheckCircle2 size={18} />
                  <span>มาตรฐานการปฏิบัติงาน</span>
                </div>
                <p>หลักควบคุมสำหรับความถูกต้อง ตรวจสอบย้อนกลับ และคุณภาพบริการ</p>
              </div>
              <span className="secondary-panel-label">Quality controls</span>
            </summary>
            <div className="standards-grid">
              <div className="standards-item">
                <strong>Traceability</strong>
                <span>Tracking, เวลา ผู้ปฏิบัติงาน ขนส่ง และสถานะต้องตรวจสอบย้อนกลับได้</span>
              </div>
              <div className="standards-item">
                <strong>Quality gate</strong>
                <span>ป้องกันรายการซ้ำ แยกสถานะผิดปกติ และยืนยันผลก่อนบันทึก</span>
              </div>
              <div className="standards-item">
                <strong>Role access</strong>
                <span>แยกขั้นตอน Packer และ Admin พร้อมยืนยันตัวตนก่อนทำรายการ</span>
              </div>
              <div className="standards-item">
                <strong>Audit & recovery</strong>
                <span>รายงาน ประวัติ และ recovery รองรับการตรวจสอบและแก้ไขอย่างมีหลักฐาน</span>
              </div>
            </div>
          </details>
        </>
  );
}

export default WorkflowView;
