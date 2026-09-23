import React from 'react';
import { BarChart3, ChevronDown, ChevronsLeft, ChevronsRight, Coffee, ExternalLink, LayoutDashboard, MonitorCheck, PackageCheck, Printer, Truck, Upload, Users, Wrench } from 'lucide-react';
import { EXTERNAL_TOOL_TEST_IDS } from '../features/externalTools/externalToolsConfig.js';
import { STAFF_WORKSPACE_MODULE } from '../features/staff/staffModules.js';

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

function Sidebar({ activeTab, switchTab, missingAlertBadge, collapsed, setCollapsed, externalToolsGroups = [], sidebarTextSize = 'normal', canManageExternalTools = false, staffModuleId = 'directory', staffPlanningModuleId = 'plan', onStaffModuleChange = () => {}, onStaffPlanningModuleChange = () => {} }) {
  const [staffExpanded, setStaffExpanded] = React.useState(false);
  const [planningExpanded, setPlanningExpanded] = React.useState(false);

  function openStaffModule(moduleId) {
    onStaffModuleChange(moduleId);
    setStaffExpanded(true);
    switchTab('staff');
  }

  function toggleStaffNavigation() {
    if (collapsed) setCollapsed(false);
    setStaffExpanded((expanded) => activeTab === 'staff' ? !expanded : true);
    switchTab('staff');
  }

  function openStaffPlanningModule(childId) {
    onStaffModuleChange('planning');
    onStaffPlanningModuleChange(childId);
    setStaffExpanded(true);
    setPlanningExpanded(true);
    switchTab('staff');
  }

  return (
    <nav className={`win-sidebar sidebar-text-${sidebarTextSize}`} aria-label="เมนูหลัก">
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
        <button
          className={`win-nav-item ${activeTab === 'staff' ? 'active' : ''}`}
          type="button"
          data-testid="staff-tab"
          aria-current={activeTab === 'staff' ? 'page' : undefined}
          aria-expanded={!collapsed && staffExpanded}
          aria-controls="staff-module-navigation"
          aria-label={collapsed ? 'แผนผังพนักงานห้องแพ็ค' : undefined}
          title={collapsed ? 'แผนผังพนักงานห้องแพ็ค' : undefined}
          onClick={toggleStaffNavigation}
        >
          <Users size={16} className="win-nav-icon" />
          <span className="win-nav-label">แผนผังพนักงานห้องแพ็ค</span>
          <ChevronDown size={14} className={`win-nav-tree-caret ${staffExpanded ? 'expanded' : ''}`} aria-hidden="true" />
        </button>
        {!collapsed && staffExpanded && (
          <div className="win-staff-tree" id="staff-module-navigation">
            {STAFF_WORKSPACE_MODULE.modules.map((module) => {
              const hasChildren = Boolean(module.children?.length);
              const moduleActive = staffModuleId === module.id;
              return (
                <React.Fragment key={module.id}>
                  <button
                    type="button"
                    className={`win-nav-item win-nav-child ${moduleActive ? 'active' : ''}`}
                    data-testid={`staff-module-${module.id}`}
                    aria-current={moduleActive && !hasChildren ? 'page' : undefined}
                    aria-expanded={hasChildren ? planningExpanded : undefined}
                    onClick={() => {
                      openStaffModule(module.id);
                      if (hasChildren) {
                        setPlanningExpanded((expanded) => staffModuleId === module.id ? !expanded : true);
                      }
                    }}
                  >
                    <span className="win-nav-label">{module.label}</span>
                    {hasChildren && <ChevronDown size={13} className={`win-nav-tree-caret ${planningExpanded ? 'expanded' : ''}`} aria-hidden="true" />}
                  </button>
                  {hasChildren && planningExpanded && module.children.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      className={`win-nav-item win-nav-child win-nav-grandchild ${staffModuleId === module.id && staffPlanningModuleId === child.id ? 'active' : ''}`}
                      data-testid={`staff-submodule-${child.id}`}
                      aria-current={staffModuleId === module.id && staffPlanningModuleId === child.id ? 'page' : undefined}
                      onClick={() => openStaffPlanningModule(child.id)}
                    >
                      <span className="win-nav-label">{child.label}</span>
                    </button>
                  ))}
                </React.Fragment>
              );
            })}
          </div>
        )}
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
                  className={`win-nav-item external external-accent-${link.accentColor ?? 'slate'}`}
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
