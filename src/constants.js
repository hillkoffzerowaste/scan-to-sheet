// ค่าคงที่ที่ทั้ง App.jsx และ view ที่แยกออกมาใช้ร่วมกัน
// เดิมอยู่ต้น App.jsx ซึ่ง view ใหม่ import ไม่ได้โดยไม่เกิด circular import
export const CAMERA_REGION_ID = 'camera-reader';
export const CAMERA_POPUP_ID = 'camera-reader-popup';

// ค่าเหล่านี้ถูกเขียนลงชีตตรงๆ และถูกใช้ในสูตร COUNTIF / conditional format
// เปลี่ยนคำสะกดไม่ได้โดยไม่ migrate ข้อมูลในชีตก่อน
export const ISSUE_CUSTOMER_CANCELLED = 'ลูกค้ายกเลิก';
export const ISSUE_RETURNED = 'สินค้าตีกลับ';
export const ISSUE_DAMAGED = 'สินค้าเสียหาย';

export const PACKER_UNASSIGNED = 'ยังไม่ระบุ';
export const DEFAULT_LOOKBACK_HOURS = 48;
