import React from 'react';
import { BarChart3, ChevronsLeft, ChevronsRight, Coffee, ExternalLink, MonitorCheck, PackageCheck, Printer, Truck, Upload, Users } from 'lucide-react';

// เมนูซ้ายแบบ Explorer: งานภายในเป็นปุ่มสลับหน้า ส่วนเครื่องมือภายนอกเป็นลิงก์ที่มีไอคอนกำกับชัด
// จัดกลุ่มเพื่อให้เห็นทันทีว่าอันไหนคือหน้าที่อยู่ในโปรแกรม อันไหนคือของนอกโปรแกรม
const EXTERNAL_TOOLS = [
  { label: 'ระบบส่งของ', icon: Truck, testId: 'delivery-system-link', href: 'https://repo-rho-livid.vercel.app/' },
  { label: 'จัดการส่งของผิด', icon: MonitorCheck, testId: 'wrong-delivery-link', href: 'https://script.google.com/a/macros/hillkoff.com/s/AKfycbxQENSgzP-0IzDX0J_pY2g9HoMlCKMaNQYJlnxPbudqELr79oKdwYpoNflqrSAfsgw2/exec' },
  { label: 'พิมพ์ใบเช็ค ใบปะหน้า', icon: Printer, testId: 'label-checker-link', href: 'https://barcode-checker-ashy.vercel.app/' },
  { label: 'เบิกออก/รับเข้ากาแฟถัง', icon: Coffee, testId: 'coffee-stock-link', href: 'https://script.google.com/a/macros/hillkoff.com/s/AKfycbxETrRx_gJBuVTdl2MUaumr5Pem4LzahebQ6HZzrknPOr-PPCPmJHQ0I9f-p-kYJB-J/exec' },
];

function NavItem({ active, icon: Icon, label, badge, testId, onClick, collapsed }) {
  return (
    <button
      className={`win-nav-item ${active ? 'active' : ''}`}
      type="button"
      data-testid={testId}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      <Icon size={16} className="win-nav-icon" />
      <span className="win-nav-label">{label}</span>
      {badge > 0 && <span className="win-nav-badge">{badge}</span>}
    </button>
  );
}

function Sidebar({ activeTab, switchTab, missingAlertBadge, collapsed, setCollapsed }) {
  return (
    <nav className="win-sidebar" aria-label="เมนูหลัก">
      <div className="win-nav-group">
        <h2 className="win-nav-heading">งานประจำวัน</h2>
        <NavItem
          active={activeTab === 'packer'}
          icon={PackageCheck}
          label="แพ็กสินค้า (Packer)"
          testId="packer-tab"
          onClick={() => switchTab('packer')}
          collapsed={collapsed}
        />
        <NavItem
          active={activeTab === 'drive'}
          icon={Upload}
          label="รับเข้า Drive (Admin)"
          badge={missingAlertBadge}
          testId="drive-tab"
          onClick={() => switchTab('drive')}
          collapsed={collapsed}
        />
      </div>

      <div className="win-nav-group">
        <h2 className="win-nav-heading">ข้อมูล</h2>
        <NavItem
          active={activeTab === 'reports'}
          icon={BarChart3}
          label="รายงาน"
          testId="reports-tab"
          onClick={() => switchTab('reports')}
          collapsed={collapsed}
        />
        <NavItem
          active={activeTab === 'staff'}
          icon={Users}
          label="แผนผังพนักงานห้องแพ็ค"
          testId="staff-tab"
          onClick={() => switchTab('staff')}
          collapsed={collapsed}
        />
      </div>

      <div className="win-nav-group">
        <h2 className="win-nav-heading">เครื่องมือภายนอก</h2>
        {EXTERNAL_TOOLS.map(({ label, icon: Icon, href, testId }) => (
          <a
            key={href}
            className="win-nav-item external"
            data-testid={testId}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={collapsed ? label : undefined}
          >
            <Icon size={16} className="win-nav-icon" />
            <span className="win-nav-label">{label}</span>
            <ExternalLink size={12} className="win-nav-external" aria-hidden="true" />
          </a>
        ))}
      </div>

      <button
        className="win-sidebar-toggle"
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={collapsed ? 'ขยายเมนู' : 'ยุบเมนู'}
      >
        {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
        <span className="win-nav-label">ยุบเมนู</span>
      </button>
    </nav>
  );
}

export default Sidebar;
