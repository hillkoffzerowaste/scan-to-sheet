import React from 'react';
import { RefreshCw, ScanSearch, Search, Upload } from 'lucide-react';

/*
 * แถบคำสั่งของหน้าที่กำลังเปิดอยู่
 *
 * ทุกปุ่มต้องผูกกับคำสั่งที่มีอยู่จริงในแอปแล้ว — แอปนี้ไม่มีคำสั่งเพิ่ม/แก้ไข/ลบแถว
 * (แถวเกิดจากการสแกน ไม่ใช่จากปุ่ม) จึงไม่มีปุ่มเหล่านั้นในแถบนี้
 */
function Toolbar({
  activeTab,
  isSignedIn,
  busy,
  refreshAllCounts,
  openMarketplaceFile,
  canImportMarketplace,
  searchFromToolbar,
  searchValue,
  setSearchValue,
  searchBusy,
  handleCheckMissingOrders,
  missingBusy,
  today,
}) {
  if (!['packer', 'drive'].includes(activeTab)) return null;

  return (
    <div className="win-toolbar">
      <button
        className="win-tool-btn"
        type="button"
        onClick={() => { void refreshAllCounts(); }}
        disabled={!isSignedIn || busy}
        title="อ่านยอดวันนี้จาก Google Sheet ใหม่"
      >
        <RefreshCw size={14} />
        <span>รีเฟรช</span>
      </button>

      <button
        className="win-tool-btn"
        type="button"
        onClick={openMarketplaceFile}
        disabled={!canImportMarketplace}
        title="เลือกไฟล์ออเดอร์จาก Shopee / Lazada / TikTok"
      >
        <Upload size={14} />
        <span>นำเข้าไฟล์ออเดอร์</span>
      </button>

      {activeTab === 'drive' && (
        <button
          className="win-tool-btn"
          type="button"
          onClick={() => { void handleCheckMissingOrders(); }}
          disabled={!isSignedIn || missingBusy}
          title="เทียบออเดอร์ในชีตกับที่สแกนแล้ว"
        >
          <ScanSearch size={14} />
          <span>ตรวจออเดอร์ที่หาย</span>
        </button>
      )}

      {activeTab === 'packer' && (
        <form className="win-tool-search" onSubmit={searchFromToolbar} role="search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="ค้นหาเลขพัสดุ แล้วกด Enter"
            aria-label="ค้นหาเลขพัสดุ"
            disabled={!isSignedIn || searchBusy}
          />
        </form>
      )}

      <span className="win-toolbar-right">ชีตวันที่ {today?.date}</span>
    </div>
  );
}

export default Toolbar;
