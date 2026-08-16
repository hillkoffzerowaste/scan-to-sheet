import { AUTH_SESSION_EXPIRED, AUTH_SESSION_EXPIRED_MESSAGE } from '../../../services/authErrors.js';

/**
 * Thai text for every error code this module can surface.
 *
 * A lookup that returns nothing is the failure mode to avoid: the panel used to render an empty
 * banner for any code it did not recognise, so an expired sign-in — or anything else unmapped —
 * looked like an app that had simply stopped responding. `packingVideoErrorText` therefore
 * always returns something.
 */
export const PACKING_VIDEO_MESSAGES = {
  [AUTH_SESSION_EXPIRED]: AUTH_SESSION_EXPIRED_MESSAGE,

  // Lookup
  PACKING_VIDEO_ORDER_NOT_FOUND: 'ไม่พบออเดอร์ของเลขพัสดุนี้ ระบบจะไม่เริ่มบันทึก',
  PACKING_VIDEO_OFFLINE_LOOKUP: 'ตอนนี้ออฟไลน์ จึงค้นหาออเดอร์ไม่ได้ (ไม่ได้แปลว่าไม่มีออเดอร์นี้)',
  PACKING_VIDEO_LOOKUP_FAILED: 'ค้นหาออเดอร์ไม่สำเร็จ กรุณาลองใหม่',
  PACKING_VIDEO_MISSING_TRACKING: 'ยังไม่ได้ใส่เลขพัสดุ',
  PACKING_VIDEO_FIRESTORE_UNAVAILABLE: 'ระบบข้อมูลวิดีโอยังไม่พร้อมใช้งาน กรุณาแจ้ง Admin',

  // Camera
  PACKING_VIDEO_PERMISSION_DENIED: 'ยังไม่ได้อนุญาตให้ใช้กล้อง กรุณากดอนุญาตในเบราว์เซอร์',
  PACKING_VIDEO_NO_CAMERA: 'ไม่พบกล้องบนเครื่องนี้',
  PACKING_VIDEO_CAMERA_BUSY: 'กล้องถูกโปรแกรมอื่นใช้อยู่ กรุณาปิดโปรแกรมนั้นก่อน',
  PACKING_VIDEO_CAMERA_UNSUPPORTED: 'กล้องไม่รองรับความละเอียดที่ตั้งไว้',
  PACKING_VIDEO_CAMERA_UNAVAILABLE: 'เปิดกล้องไม่สำเร็จ กรุณาลองใหม่',
  PACKING_VIDEO_CAMERA_NOT_READY: 'กล้องยังไม่พร้อม กรุณากดเปิดกล้องอีกครั้ง',
  PACKING_VIDEO_CAMERA_LOST: 'กล้องหลุดกลางคัน ระบบเก็บส่วนที่บันทึกไว้แล้ว',
  PACKING_VIDEO_UNSUPPORTED_BROWSER: 'เบราว์เซอร์นี้บันทึกวิดีโอไม่ได้',

  // Recorder
  PACKING_VIDEO_ALREADY_RECORDING: 'กำลังบันทึกอยู่แล้ว',
  PACKING_VIDEO_NOT_RECORDING: 'ตอนนี้ไม่ได้บันทึกอยู่',
  PACKING_VIDEO_RECORDER_ERROR: 'การบันทึกขัดข้อง ระบบเก็บส่วนที่บันทึกไว้แล้ว',
  PACKING_VIDEO_FINALIZE_FAILED: 'ปิดไฟล์วิดีโอไม่สำเร็จ ระบบเก็บส่วนที่บันทึกไว้ให้กู้แล้ว',

  // Storage and queue
  PACKING_VIDEO_DISK_LOW: 'พื้นที่เก็บข้อมูลในเครื่องเหลือน้อย กรุณารอให้อัปโหลดคิวเดิมให้เสร็จก่อน',
  PACKING_VIDEO_QUEUE_FULL: 'คิวรออัปโหลดเต็ม กรุณารอให้อัปโหลดเสร็จก่อนบันทึกเพิ่ม',
  PACKING_VIDEO_DB_UNAVAILABLE: 'เปิดที่เก็บวิดีโอในเครื่องไม่ได้ ยังไม่ควรเริ่มบันทึก',
  PACKING_VIDEO_CHUNK_WRITE_FAILED: 'เขียนวิดีโอลงเครื่องไม่สำเร็จ กรุณาหยุดบันทึกและแจ้ง Admin',
  PACKING_VIDEO_UPLOAD_FAILED: 'อัปโหลดไม่สำเร็จ ระบบจะลองใหม่อัตโนมัติ',

  // Setup and dashboard
  PACKING_VIDEO_SETUP_INCOMPLETE: 'กรุณาเลือกจุดแพ็คและผู้แพ็คก่อนเริ่มงาน',
  PACKING_VIDEO_INVALID_STATION: 'จุดแพ็คไม่ถูกต้อง',
  PACKING_VIDEO_INVALID_DEVICE_SEQ: 'หมายเลขเครื่องไม่ถูกต้อง',
  PACKING_VIDEO_FILTER_TOO_BROAD: 'กรุณาระบุเลขพัสดุ เลขออเดอร์ หรือช่วงวันที่ (ไม่เกิน 31 วัน) ก่อนค้นหา',
  PACKING_VIDEO_MISSING_TODAY: 'ไม่พบวันที่สำหรับค้นหา',
  // A guard against an unbounded read rather than anything the packer did, but it still has to
  // read as Thai if it ever reaches the screen.
  PACKING_VIDEO_UNBOUNDED_QUERY: 'การค้นหาต้องมีขอบเขต กรุณาระบุตัวกรองก่อน',
};

/**
 * Never returns an empty string for a non-empty code: an unmapped code still tells the packer
 * something went wrong and gives Admin the code to report, which beats a blank screen.
 */
export function packingVideoErrorText(code) {
  if (!code) return '';
  return PACKING_VIDEO_MESSAGES[code] ?? `เกิดข้อผิดพลาด กรุณาลองใหม่ หรือแจ้ง Admin พร้อมรหัส ${code}`;
}
