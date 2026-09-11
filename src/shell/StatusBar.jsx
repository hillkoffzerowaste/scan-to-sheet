import React from 'react';

// แถบสถานะล่างจอ: ตัวเลขที่ต้องเห็นตลอดเวลาโดยไม่ต้องเลื่อนหา
function StatusBar({ activeTab, isSignedIn, totalTodayCount, scanQueueSnapshot, selectedPacker, today, remoteControlHint }) {
  // pending เป็น array ของงานที่รอ ส่วน processing เป็นงานที่กำลังเขียนอยู่ (หรือ null)
  const pending = (scanQueueSnapshot?.pending?.length ?? 0) + (scanQueueSnapshot?.processing ? 1 : 0);
  const failed = scanQueueSnapshot?.failed ?? 0;
  // การเปลี่ยนที่สั่งมาจากรีโมทบนมือถือบอกที่นี่เท่านั้น เพื่อไม่ให้ไปขัดจังหวะคนที่กำลังสแกน
  const remoteAt = remoteControlHint
    ? new Date(remoteControlHint.at).toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Bangkok',
    })
    : null;
  const modeLabel = activeTab === 'drive' ? 'รับเข้า Drive' : activeTab === 'reports' ? 'รายงาน' : activeTab === 'staff' ? 'พนักงาน' : 'แพ็กสินค้า';

  return (
    <div className="win-statusbar">
      <span>โหมด <b>{modeLabel}</b></span>
      <span>สแกนวันนี้ <b>{totalTodayCount}</b></span>
      <span>คิวรอเขียนชีต <b>{pending}</b></span>
      {failed > 0 && <span className="win-statusbar-alert">เขียนไม่สำเร็จ <b>{failed}</b></span>}
      {remoteControlHint && (
        <span>จากมือถือ <b>{remoteControlHint.courier}</b> {remoteAt}</span>
      )}
      <span className="win-statusbar-right">
        <span>Packer: <b>{selectedPacker}</b></span>
        <span>Google Sheet: <b>{isSignedIn ? 'เชื่อมต่อแล้ว' : 'ยังไม่เชื่อม'}</b></span>
        <span>{today?.date}</span>
      </span>
    </div>
  );
}

export default StatusBar;
