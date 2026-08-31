import React from 'react';

// แถบสถานะล่างจอ: ตัวเลขที่ต้องเห็นตลอดเวลาโดยไม่ต้องเลื่อนหา
function StatusBar({ activeTab, isSignedIn, totalTodayCount, scanQueueSnapshot, selectedPacker, today }) {
  // pending เป็น array ของงานที่รอ ส่วน processing เป็นงานที่กำลังเขียนอยู่ (หรือ null)
  const pending = (scanQueueSnapshot?.pending?.length ?? 0) + (scanQueueSnapshot?.processing ? 1 : 0);
  const failed = scanQueueSnapshot?.failed ?? 0;
  const modeLabel = activeTab === 'drive' ? 'รับเข้า Drive' : activeTab === 'reports' ? 'รายงาน' : activeTab === 'staff' ? 'พนักงาน' : 'แพ็กสินค้า';

  return (
    <div className="win-statusbar">
      <span>โหมด <b>{modeLabel}</b></span>
      <span>สแกนวันนี้ <b>{totalTodayCount}</b></span>
      <span>คิวรอเขียนชีต <b>{pending}</b></span>
      {failed > 0 && <span className="win-statusbar-alert">เขียนไม่สำเร็จ <b>{failed}</b></span>}
      <span className="win-statusbar-right">
        <span>Packer: <b>{selectedPacker}</b></span>
        <span>Google Sheet: <b>{isSignedIn ? 'เชื่อมต่อแล้ว' : 'ยังไม่เชื่อม'}</b></span>
        <span>{today?.date}</span>
      </span>
    </div>
  );
}

export default StatusBar;
