import { expect } from '@playwright/test';

// Run the real App and QR components with external services replaced at their module
// boundaries. No production session or operational data is needed for click/scan parity.
async function mockModule(page, path, exports) {
  await page.route(`**${path}*`, async (route) => {
    if (new URL(route.request().url()).searchParams.has('qr-original')) return route.continue();
    await route.fulfill({ contentType: 'text/javascript', body: `export * from '${path}?qr-original';\n${exports}` });
  });
}

export async function openSignedInApp(page, {
  staffAdmin = true,
  startTab = 'packer',
  externalToolsConfig = null,
  externalToolsReadError = false,
} = {}) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return route.abort();
    return route.continue();
  });
  await page.addInitScript(({ config, readError }) => {
    window.qrTestWrites = [];
    window.externalToolsConfig = config;
    window.externalToolsReadError = readError;
    window.externalToolsWrites = [];
  }, { config: externalToolsConfig, readError: externalToolsReadError });
  await mockModule(page, '/src/services/firebase.js', `
    export const isFirebaseConfigured = true;
    const user = { uid: 'qr-test-user', email: 'qr-test@example.invalid', getIdToken: async () => 'test-id-token' };
    export const firebaseAuth = { currentUser: user };
    export const onAuthStateChanged = (_auth, callback) => { callback(user); return () => {}; };
    export const getRedirectResult = async () => null;
  `);
  await mockModule(page, '/src/features/staff/staffService.js', `
    const members = [
      { id: 'qr-a', employeeId: 'A01', fullName: 'พนักงานทดสอบ A', nickname: 'คนแพ็ค A', position: 'packer', active: true, sortOrder: 1 },
      { id: 'qr-b', employeeId: 'B02', fullName: 'พนักงานทดสอบ B', nickname: 'คนแพ็ค B', position: 'packer', active: true, sortOrder: 2 }
    ];
    export const getStaffAdminStatus = async () => ${staffAdmin};
    export const listStaffMembers = async () => members;
    export const listDutyTypes = async () => [{ id: 'packing', name: 'แพ็คสินค้า', active: true }];
    export const listWeeklyDuties = async () => [];
    export const listStaffPrivateNotes = async () => new Map();
    export const listStaffPrivateContacts = async () => new Map();
    export const getPackingRoomNotice = async () => 'ข้อมูลจำลองสำหรับตรวจหน้าจอ';
    export const listDailyAssignments = async () => [];
    export const listDutyOverrides = async () => [];
    export const listDailyStatuses = async () => [];
    export const getDailyLead = async () => null;
    export const subscribeStaffMembers = ({ onChange }) => {
      onChange([
        { id: 'qr-a', nickname: 'คนแพ็ค A', position: 'packer', active: true, sortOrder: 1 },
        { id: 'qr-b', nickname: 'คนแพ็ค B', position: 'packer', active: true, sortOrder: 2 }
      ]);
      return () => {};
    };
  `);
  await mockModule(page, '/src/features/staff/workPlanningService.js', `
    window.staffSops = window.staffSops ?? [];
    window.staffWorkPlanTasks = window.staffWorkPlanTasks ?? [];
    export const WORK_PLANNING_QUERY_LIMITS = { sops: 100, tasks: 200 };
    export const listStaffSops = async () => window.staffSops;
    export const listWorkPlanTasks = async (date) => window.staffWorkPlanTasks.filter(item => item.date === date);
    export const getStaffSopVersion = async (sopId, version) => {
      const item = window.staffSops.find(sop => sop.id === sopId);
      return item && Number(item.latestVersion) === Number(version)
          ? { sopId, version, title: item.title, description: item.description, ownerStaffId: item.ownerStaffId, effectiveDate: item.effectiveDate, reviewDueDate: item.reviewDueDate, steps: item.draftSteps }
        : null;
    };
    export const saveStaffSopDraft = async (sop, user) => {
      const id = sop.id ?? 'sop-' + (window.staffSops.length + 1);
      const record = { ...sop, id, draftSteps: sop.steps };
      window.staffSops = [...window.staffSops.filter(item => item.id !== id), record];
      return id;
    };
    export const publishStaffSop = async (sop) => {
      const id = sop.id ?? 'sop-' + (window.staffSops.length + 1);
      const version = Number(sop.latestVersion ?? 0) + 1;
      window.staffSops = [...window.staffSops.filter(item => item.id !== id), { ...sop, id, latestVersion: version, draftSteps: sop.steps, active: true }];
      return { id, version };
    };
    export const setStaffSopActive = async (id, active) => {
      window.staffSops = window.staffSops.map(item => item.id === id ? { ...item, active } : item);
    };
    export const createWorkPlanTask = async (task) => {
      const id = 'task-' + (window.staffWorkPlanTasks.length + 1);
      window.staffWorkPlanTasks.push({ ...task, id, stepProgress: Object.fromEntries(task.sopSnapshot.steps.map(step => [step.id, false])), status: 'planned' });
      return id;
    };
    export const updateWorkPlanTask = async (task, changes) => {
      window.staffWorkPlanTasks = window.staffWorkPlanTasks.map(item => item.id === task.id ? { ...item, ...changes } : item);
    };
    export const deleteWorkPlanTask = async (task) => { window.staffWorkPlanTasks = window.staffWorkPlanTasks.filter(item => item.id !== task.id); };
    export const saveWorkPlanOrder = async (tasks) => {
      const sequence = new Map(tasks.map((item, index) => [item.id, index + 1]));
      window.staffWorkPlanTasks = window.staffWorkPlanTasks.map(item => sequence.has(item.id) ? { ...item, sequence: sequence.get(item.id) } : item);
    };
  `);
  await mockModule(page, '/src/features/externalTools/externalToolsService.js', `
    import { DEFAULT_EXTERNAL_TOOLS_CONFIG } from '/src/features/externalTools/externalToolsConfig.js';
    const subscribers = [];
    export const subscribeExternalTools = ({ onChange, onError }) => {
      if (window.externalToolsReadError) {
        onError?.({ code: 'EXTERNAL_TOOLS_READ_FAILED', message: 'อ่านการตั้งค่าไม่สำเร็จ' });
      } else {
        const config = window.externalToolsConfig ?? DEFAULT_EXTERNAL_TOOLS_CONFIG;
        const version = { exists: Boolean(window.externalToolsConfig), revision: window.externalToolsRevision ?? null };
        onChange(config, { source: window.externalToolsConfig ? 'firestore' : 'default', ready: true, version });
        subscribers.push(onChange);
      }
      return () => {};
    };
    export const saveExternalToolsConfig = async (config, user, expectedVersion) => {
      const currentVersion = { exists: Boolean(window.externalToolsConfig), revision: window.externalToolsRevision ?? null };
      if (currentVersion.exists !== expectedVersion?.exists || currentVersion.revision !== expectedVersion?.revision) {
        throw { code: 'EXTERNAL_TOOLS_CONFLICT', message: 'มี Admin อีกเครื่องบันทึกการตั้งค่าใหม่แล้ว' };
      }
      window.externalToolsWrites.push(config);
      window.externalToolsConfig = config;
      const version = { exists: true, revision: 'revision-' + window.externalToolsWrites.length };
      window.externalToolsRevision = version.revision;
      subscribers.forEach((subscriber) => subscriber(config, { source: 'firestore', ready: true, version }));
      return { config, version };
    };
  `);
  await mockModule(page, '/src/services/firebaseScans.js', `
    export const getScanReportFirestore = async ({ couriers, dates }) => {
      window.reportTestDates = dates;
      return { total: dates.length, cancelledTotal: 0, returnedTotal: 0, damagedTotal: 0,
        couriers: couriers.map(courier => ({ courier, count: courier === 'Flash' ? dates.length : 0 })),
        days: dates.map(date => ({ date, total: 1, couriers: couriers.map(courier => ({ courier, count: courier === 'Flash' ? 1 : 0 })) })),
        returnedRows: [], damagedRows: [], cancelledRows: [] };
    };
    export const canUseFirestorePrimary = () => true;
    export const upsertFirebaseUser = async () => {};
    export const subscribeCouriers = ({ defaultCouriers, onChange }) => { onChange(defaultCouriers); return () => {}; };
    export const fetchTodaySummaryFirestore = async ({ couriers }) => ({ courierCounts: couriers.map(courier => ({ courier, count: 0 })), packerCounts: [] });
    export const getTodayRowsFirestore = async () => [];
    export const getDriveRowsFirestore = async () => [];
    export const getSheetRecoveryCandidates = async () => ({ candidates: [], limited: false });
    export const checkMissingOrdersFirestore = async () => null;
    export const recordPackerScanPrimary = async (data) => { window.qrTestWrites.push(data); throw new Error('Unexpected scan write'); };
    export const recordAdminScanPrimary = async (data) => { window.qrTestWrites.push(data); throw new Error('Unexpected scan write'); };
  `);
  await mockModule(page, '/src/services/googleSheets.js', `
    export const fetchGoogleProfile = async () => ({ email: 'qr-test@example.invalid' });
    export const ensureGoogleSheetOrganization = async () => {};
    export const colorAllHistoricalSheetsGoogle = async () => {};
  `);
  await page.route('**/api/**', (route) => route.fulfill({ json: {
    accessToken: 'test-access-token', expiresIn: 3600,
    profile: { email: 'qr-test@example.invalid' }, config: { master: { id: 'qr-test-sheet' } },
  } }));
  await page.goto('/');
  await expect(page.getByTestId('dashboard-tab')).toHaveCount(1);
  if (startTab !== 'dashboard') {
    await page.getByTestId(`${startTab}-tab`).click();
    await expect(page.locator('#scan-input')).toBeEnabled();
    await expect(page.locator('.workspace-qr-panel .scan-qr-card').first()).toBeEnabled();
  }
}

// The remote screen is its own tree with its own service boundaries: Firebase Auth, the courier
// and staff lists, and the shared control document. Writes land in window.remoteTestWrites so a
// test can prove that an echo of its own command produces no second write.
export async function openRemoteApp(page, { boards = {} } = {}) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return route.abort();
    return route.continue();
  });
  await page.addInitScript(() => { window.remoteTestWrites = []; });
  await mockModule(page, '/src/services/firebase.js', `
    export const isFirebaseConfigured = true;
    const user = { uid: 'remote-test-user', email: 'remote-test@example.invalid' };
    export const firebaseAuth = { currentUser: user };
    export const onAuthStateChanged = (_auth, callback) => { callback(user); return () => {}; };
    export const signInWithCredential = async () => ({ user });
    export const GoogleAuthProvider = { credential: () => ({}) };
  `);
  await mockModule(page, '/src/services/firebaseScans.js', `
    export const subscribeCouriers = ({ defaultCouriers, onChange }) => { onChange(defaultCouriers); return () => {}; };
  `);
  await mockModule(page, '/src/features/staff/staffService.js', `
    export const subscribeStaffMembers = ({ onChange }) => {
      onChange([
        { id: 'remote-a', nickname: 'คนแพ็ค A', position: 'packer', active: true, sortOrder: 1 },
        { id: 'remote-b', nickname: 'คนแพ็ค B', position: 'packer', active: true, sortOrder: 2 }
      ]);
      return () => {};
    };
  `);
  await mockModule(page, '/src/services/remoteControl.js', `
    const boards = ${JSON.stringify(boards)};
    export const subscribeRemoteControl = ({ tab, onChange }) => {
      window.remoteSubscribedTab = tab;
      window.remotePushBoard = onChange;
      onChange(boards[tab] ?? null);
      return () => {};
    };
    export const writeRemoteControl = async (payload) => { window.remoteTestWrites.push(payload); };
  `);
  await page.goto('/remote');
  // รอจนผ่านหน้าเข้าสู่ระบบแล้วจริง ๆ ไม่ใช่แค่ .remote-app ปรากฏ ซึ่งเป็นจริงตั้งแต่หน้ายังไม่ล็อกอิน
  await expect(page.locator('.remote-grid .remote-choice').first()).toBeVisible();
}
