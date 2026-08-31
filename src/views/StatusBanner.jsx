import React from 'react';
import { AlertTriangle, CheckCircle2, PackageCheck, RefreshCw } from 'lucide-react';

// ย้ายมาจาก App.jsx โดยไม่แก้ JSX — แบนเนอร์สองตัวนี้ถูกเรียกจากหลาย view จึงต้องอยู่นอก App
function StatusBanner({ status }) {
  const Icon = status.type === 'success' ? CheckCircle2 : status.type === 'duplicate' || status.type === 'warning' ? AlertTriangle : PackageCheck;
  return (
    <div className={`status-banner ${status.type}`} role="status" aria-live="polite" aria-atomic="true">
      <Icon size={22} />
      <div>
        <strong>{status.title}</strong>
        <span>{status.message}</span>
      </div>
    </div>
  );
}

function DeploymentUpdateBanner() {
  return (
    <div className="status-banner warning" role="status" aria-live="polite" aria-atomic="true">
      <RefreshCw size={22} />
      <div>
        <strong>มีเวอร์ชันใหม่พร้อมใช้งาน</strong>
        <span>รีเฟรชก่อนสแกนต่อ เพื่อใช้รูปแบบการบันทึกล่าสุด</span>
      </div>
      <button className="secondary-button" type="button" onClick={() => window.location.reload()}>
        รีเฟรชตอนนี้
      </button>
    </div>
  );
}

export { DeploymentUpdateBanner, StatusBanner };
export default StatusBanner;
