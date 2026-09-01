import React from 'react';
import { CAMERA_POPUP_ID, ISSUE_CUSTOMER_CANCELLED, ISSUE_RETURNED } from '../constants.js';
import { Camera, Play, RefreshCw, ScanLine, Square } from 'lucide-react';

// แยกออกมาจาก App.jsx โดยไม่แก้ตัว JSX เลย — เป็นการย้ายโค้ดล้วน
function ScanPopup({
  ScanPopupStatusIcon,
  activeTab,
  busy,
  cameraActive,
  cameraMessage,
  cameraMessageType,
  handleBarcodeKeyDown,
  handleScanSubmit,
  inputRef,
  isPackerReady,
  isSignedIn,
  packerOptions,
  scanFlash,
  scanMethod,
  scanPopupCourierOptions,
  scanPopupStatusMeta,
  scanQueueSnapshot,
  scanQueueStatusText,
  scanRemark,
  scanValue,
  selectedCourier,
  selectedPacker,
  setScanMethod,
  setScanPopupOpen,
  setScanRemark,
  setScanValue,
  setSelectedCourier,
  setSelectedPacker,
  startCameraPopup,
  status,
  stopCamera,
}) {
  return (
        <div className="scan-popup-overlay" onClick={() => { setScanPopupOpen(false); void stopCamera(); }}>
          <div
            className={`scan-popup-sheet workflow-${activeTab}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="scan-popup-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="scan-popup-header">
              <div>
                <span>{activeTab === 'drive' ? 'รับเข้า Drive' : 'สแกนแพ็กสินค้า'}</span>
                <h2 id="scan-popup-title">{selectedCourier}</h2>
              </div>
              <button
                className="scan-popup-icon-close"
                type="button"
                aria-label="ปิดหน้าต่างสแกน"
                onClick={() => { setScanPopupOpen(false); void stopCamera(); }}
              >
                ×
              </button>
            </div>

            <div
              className={`scan-popup-feedback ${scanPopupStatusMeta.tone}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <ScanPopupStatusIcon size={20} aria-hidden="true" />
              <div>
                <strong>{status.title}</strong>
                <span>{status.message}</span>
              </div>
            </div>

            <label className="packer-control popup-courier">
              <span>ขนส่ง — เลือกก่อนสแกน</span>
              <select
                value={selectedCourier}
                onChange={(event) => setSelectedCourier(event.target.value)}
                disabled={!isSignedIn}
              >
                {scanPopupCourierOptions.map((courier) => (
                  <option key={courier} value={courier}>{courier}</option>
                ))}
              </select>
            </label>

            {activeTab === 'packer' && (
              <div className="scan-popup-issue-actions">
              <button
                className={`popup-cancel-btn ${scanRemark === ISSUE_CUSTOMER_CANCELLED ? 'active' : ''}`}
                type="button"
                onClick={() => setScanRemark((v) => (v === ISSUE_CUSTOMER_CANCELLED ? '' : ISSUE_CUSTOMER_CANCELLED))}
                disabled={!isSignedIn || busy}
              >
                {scanRemark === ISSUE_CUSTOMER_CANCELLED ? '✓ ลูกค้ายกเลิก' : 'ลูกค้ายกเลิก'}
              </button>
              <button
                className={`popup-cancel-btn ${scanRemark === ISSUE_RETURNED ? 'active' : ''}`}
                type="button"
                onClick={() => setScanRemark((v) => (v === ISSUE_RETURNED ? '' : ISSUE_RETURNED))}
                disabled={!isSignedIn || busy}
              >
                {scanRemark === ISSUE_RETURNED ? `✓ ${ISSUE_RETURNED}` : ISSUE_RETURNED}
              </button>
              </div>
            )}

            <div className="scan-controls">
              <div className="segmented-control">
                <button className={scanMethod === 'manual' ? 'active' : ''} type="button" onClick={() => setScanMethod('manual')}>
                  <ScanLine size={15} />
                  <span>เครื่องยิง</span>
                </button>
                <button className={scanMethod === 'camera' ? 'active' : ''} type="button" onClick={() => setScanMethod('camera')}>
                  <Camera size={15} />
                  <span>กล้อง</span>
                </button>
              </div>
            </div>

            {activeTab === 'packer' && (
              <label className="packer-control popup-packer">
                <span>Packer — เลือกคนแพ็คก่อนสแกน</span>
                <select value={selectedPacker} onChange={(e) => setSelectedPacker(e.target.value)} disabled={!isSignedIn || busy}>
                  {packerOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            )}

            {scanMethod === 'camera' ? (
              <div className={`camera-panel workflow-${activeTab}`}>
                <div className={`camera-stage ${cameraActive ? 'active' : ''}`}>
                  <div id={CAMERA_POPUP_ID} className="camera-reader" />
                  <div className="scan-frame" aria-hidden="true"><span /></div>
                </div>
                <div className="camera-footer">
                  <p className={`camera-message ${cameraMessageType}`}>{cameraMessage}</p>
                  <div className="camera-actions">
                    {cameraActive ? (
                      <button className="ghost-button" type="button" onClick={stopCamera}>
                        <Square size={16} /><span>หยุดกล้อง</span>
                      </button>
                    ) : (
                      <button className="secondary-button" type="button" onClick={startCameraPopup} disabled={busy || !isSignedIn}>
                        <Camera size={16} /><span>เปิดกล้อง</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <form className={`scan-form workflow-${activeTab}`} onSubmit={handleScanSubmit}>
                <div className={`scan-input-row ${scanFlash ? 'flash' : ''}`}>
                  <ScanLine size={24} />
                  <input
                    id="popup-scan-input"
                    ref={inputRef}
                    value={scanValue}
                    onChange={(e) => setScanValue(e.target.value)}
                    onKeyDown={handleBarcodeKeyDown}
                    placeholder={
                      activeTab === 'drive'
                        ? 'ยิงบาร์โค้ด แล้วกด Enter เพื่อรับเข้า Drive'
                        : isPackerReady
                          ? 'ยิงบาร์โค้ด แล้วกด Enter'
                          : 'เลือก Packer ก่อน'
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

            <button className="scan-popup-close" type="button" onClick={() => { setScanPopupOpen(false); void stopCamera(); }}>
              ปิด
            </button>
          </div>
        </div>
  );
}

export default ScanPopup;
