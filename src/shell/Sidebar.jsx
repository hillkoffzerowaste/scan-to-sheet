import React from 'react';
import { BarChart3, ChevronsLeft, ChevronsRight, Coffee, ExternalLink, LayoutDashboard, MonitorCheck, PackageCheck, Printer, Truck, Upload, Users, Wrench } from 'lucide-react';
import { EXTERNAL_TOOL_TEST_IDS } from '../features/externalTools/externalToolsConfig.js';

// เมนูซ้ายแบบ Explorer: งานภายในเป็นปุ่มสลับหน้า ส่วนเครื่องมือภายนอกเป็นลิงก์ที่มีไอคอนกำกับชัด
// จัดกลุ่มเพื่อให้เห็นทันทีว่าอันไหนคือหน้าที่อยู่ในโปรแกรม อันไหนคือของนอกโปรแกรม
const EXTERNAL_TOOL_ICONS = {
  'delivery-system': Truck,
  'wrong-delivery': MonitorCheck,
  'label-checker': Printer,
  'coffee-stock': Coffee,
  'coffee-shop-grinder': Coffee,
  'coffee-stock-count': Coffee,
};

function NavItem({ active, icon: Icon, label, badge, testId, onClick, collapsed }) {
  return (
    <button
      className={`win-nav-item ${active ? 'active' : ''}`}
      type="button"
      data-testid={testId}
      aria-current={active ? 'page' : undefined}
      aria-label={collapsed ? label : undefined}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      <Icon size={16} className="win-nav-icon" />
      <span className="win-nav-label">{label}</span>
      {badge > 0 && <span className="win-nav-badge">{badge}</span>}
    </button>
  );
}

function Sidebar({ activeTab, switchTab, missingAlertBadge, collapsed, setCollapsed, externalToolsGroups = [], canManageExternalTools = false }) {
  return (
    <nav className="win-sidebar" aria-label="เมนูหลัก">
      <div className="win-nav-group">
        <h2 className="win-nav-heading">ภาพรวม</h2>
        <NavItem
          active={activeTab === 'dashboard'}
          icon={LayoutDashboard}
          label="ศูนย์ควบคุมงาน"
          testId="dashboard-tab"
          onClick={() => switchTab('dashboard')}
          collapsed={collapsed}
        />
      </div>

      <div className="win-nav-group">
        <h2 className="win-nav-heading">งานหน้างาน</h2>
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

      {canManageExternalTools && (
        <div className="win-nav-group">
          <h2 className="win-nav-heading">จัดการ</h2>
          <NavItem
            active={activeTab === 'external-tools-settings'}
            icon={Wrench}
            label="ตั้งค่าเครื่องมือภายนอก"
            testId="external-tools-settings-tab"
            onClick={() => switchTab('external-tools-settings')}
            collapsed={collapsed}
          />
        </div>
      )}

      <div className="win-nav-group">
        <h2 className="win-nav-heading">ระบบที่เกี่ยวข้อง</h2>
        {externalToolsGroups.map((group) => (
          <div className="win-nav-subgroup" key={group.id}>
            <h3 className="win-nav-subheading">{group.name}</h3>
            {group.links.map((link) => {
              const Icon = EXTERNAL_TOOL_ICONS[link.id] ?? ExternalLink;
              return (
                <a
                  key={link.id}
                  className="win-nav-item external"
                  data-testid={EXTERNAL_TOOL_TEST_IDS[link.id]}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={collapsed ? link.label : undefined}
                  title={collapsed ? link.label : undefined}
                >
                  <Icon size={16} className="win-nav-icon" />
                  <span className="win-nav-label">{link.label}</span>
                  <ExternalLink size={12} className="win-nav-external" aria-hidden="true" />
                </a>
              );
            })}
          </div>
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
