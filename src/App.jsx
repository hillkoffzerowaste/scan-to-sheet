import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Camera,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Coffee,
  ExternalLink,
  FileSpreadsheet,
  LogIn,
  LogOut,
  Mail,
  Moon,
  PackageCheck,
  ClipboardCopy,
  Play,
  Printer,
  RefreshCw,
  ScanLine,
  Search,
  Square,
  Sun,
  Truck,
  Volume2,
  Upload,
  MonitorCheck,
  ShieldAlert,
  ArrowRightLeft,
  Plus,
  Users,
} from 'lucide-react';
import StaffDirectory from './features/staff/StaffDirectory.jsx';
import ReportsView from './views/ReportsView.jsx';
import { buildPackerOptions } from './features/staff/staffDirectory.js';
import { subscribeStaffMembers } from './features/staff/staffService.js';
import {
  COURIERS,
  appendScanGoogle,
  appendAdminScanGoogle,
  batchAppendScanGoogle,
  backfillMarketplaceOrdersGoogle,
  colorAllHistoricalSheetsGoogle,
  ensureGoogleSheetOrganization,
  checkMissingOrders,
  fetchGoogleProfile,
  fetchTodayPackerCounts,
  fetchTodaySummary,
  getBangkokParts,
  getDriveRowsGoogle,
  getRowsForFirestoreBackfillGoogle,
  getScanReportGoogle,
  getTodayRowsGoogle,
  findMarketplaceOrderGoogle,
  listDatesBetween,
  listDatesInMonth,
  loadGoogleConfig,
  prepareGoogleSheets,
  searchScansGoogle,
  syncLateOrdersGoogle,
  upsertMarketplaceOrdersGoogle,
  updateScanIssueGoogle,
  validateScanCode,
} from './services/googleSheets.js';
import {
  buildMissingAlertMessage,
  buildCompactSummary,
  formatMissingResultsForUI,
  buildDashboardSummary,
} from './services/missingOrderCheck.js';
import {
  createGoogleProvider,
  firebaseAuth,
  getRedirectResult,
  GoogleAuthProvider,
  isFirebaseConfigured,
  onAuthStateChanged,
  signInWithCredential,
  signInWithRedirect,
  signOutFirebase,
} from './services/firebase.js';
import {
  backfillOrdersFromSheetRows,
  canUseFirestorePrimary,
  checkMissingOrdersFirestore,
  fetchTodaySummaryFirestore,
  getDriveRowsFirestore,
  getScanReportFirestore,
  getTodayRowsFirestore,
  markSheetSyncWriting,
  markSheetSyncResult,
  mirrorScanToFirestore,
  recordAdminScanPrimary,
  recordPackerScanPrimary,
  searchScansFirestore,
  upsertFirebaseUser,
  addCourier,
  claimRecoverableSheetSyncs,
  subscribeCouriers,
} from './services/firebaseScans.js';
import {
  groupMarketplaceRows,
  parseCsvText,
  parseMarketplaceRows,
} from './services/marketplaceImport.js';
import { parseXlsxArrayBuffer } from './services/xlsxImport.js';
import { loadHtml5Qrcode } from './services/cameraLoader.js';
import { commitFallbackScan } from './services/scanCommit.js';
import { createScanQueue } from './services/scanQueue.js';
import { hasDeploymentUpdate } from './services/deploymentUpdate.js';
import { getScanPopupCourierOptions, getScanPopupStatusMeta } from './services/scanPopup.js';
import { DEFAULT_SCAN_METHOD } from './services/scanPreferences.js';
import { barcodeCharacterFromKeyEvent } from './services/barcodeKeyboard.js';
import {
  apiResponseErrorMessage,
  createFirebaseAuthRequiredError,
  oauthCallbackErrorMessage,
  scanErrorMessage,
  userErrorMessage,
} from './services/authErrors.js';
import { shouldPollMissingOrders } from './services/missingCheckPolicy.js';
import { getSheetRecoveryDates } from './services/sheetRecoveryDates.js';
import { buildSheetSyncFailureUpdates, isSheetSyncVerified } from './services/sheetSync.js';
import {
  getAdminScanTiming,
  getPackerDuplicateMessage,
  getScanIssueMeta,
  isSheetSyncResultConfirmed,
  shouldBlockPackerScan,
} from './services/sheetSyncReconciliation.js';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets',
];
const SCOPES = GOOGLE_SCOPES.join(' ');
const MARKETPLACE_IMPORT_MAX_ORDERS = 100;
const SHEET_RECOVERY_BATCH_SIZE = 20;
const SHEET_RECOVERY_COOLDOWN_MS = 5 * 1000;
const SHEET_INTEGRITY_INTERVAL_MS = 10 * 60 * 1000;
const COUNT_REFRESH_DELAY_MS = 1000;
const DEPLOYMENT_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

const EMPTY_USER = {
  email: 'ยังไม่ได้เข้าสู่ระบบ',
  name: '',
};
const THEME_KEY = 'scan-to-sheet-theme';
const GOOGLE_SESSION_KEY = 'scan-to-sheet-google-session-v1';
const LOGGED_OUT_FLAG = 'scan-to-sheet-logged-out-v1';
const CAMERA_REGION_ID = 'camera-reader';
const CAMERA_POPUP_ID = 'camera-reader-popup';
const CAMERA_COOLDOWN_MS = 5000;
const CAMERA_SCAN_FPS = 18;
const ISSUE_CUSTOMER_CANCELLED = 'ลูกค้ายกเลิก';
const ISSUE_RETURNED = 'สินค้าตีกลับ';
const ISSUE_DAMAGED = 'สินค้าเสียหาย';
const PACKER_UNASSIGNED = 'ยังไม่ระบุ';
const DEFAULT_PACKERS = [PACKER_UNASSIGNED, 'กิต', 'มาย', 'ยุทธ', 'หล้า', 'มุก', 'เบ้น', 'คะนิ้ง'];
const DEFAULT_THRESHOLD_MINUTES = 30;
const DEFAULT_LOOKBACK_HOURS = 48;
const AUTO_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MISSING_CHECK_CACHE_KEY = 'missing-order-check-cache';
const MISSING_CHECK_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function loadStoredGoogleSession() {
  try {
    return JSON.parse(localStorage.getItem(GOOGLE_SESSION_KEY)) ?? null;
  } catch {
    return null;
  }
}

function saveStoredGoogleSession(session) {
  localStorage.setItem(GOOGLE_SESSION_KEY, JSON.stringify(session));
}

function clearStoredGoogleSession() {
  localStorage.removeItem(GOOGLE_SESSION_KEY);
}

async function apiJson(url, options = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
    clearTimeout(t);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(apiResponseErrorMessage(data, response.status));
    }
    return data;
  } catch (error) {
    clearTimeout(t);
    if (error.name === 'AbortError') throw new Error('เชื่อมต่อนานเกินไป กรุณาลองใหม่');
    throw error;
  }
}

async function acquireSheetWriteLock(resource) {
  const lockId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await apiJson('/api/sheet-lock', {
      method: 'POST',
      body: JSON.stringify({ action: 'acquire', resource, lockId }),
    });
    if (result.acquired) return async () => {
      await apiJson('/api/sheet-lock', {
        method: 'POST',
        body: JSON.stringify({ action: 'release', resource, lockId }),
      }).catch(() => {});
    };
    await new Promise((resolve) => setTimeout(resolve, result.retryAfterMs ?? 250));
  }
  throw new Error('Google Sheet กำลังถูกใช้งานอยู่ กรุณาลองอีกครั้ง');
}

async function loadServerGoogleConfig() {
  const data = await apiJson('/api/google-config');
  return data.config ?? null;
}

async function saveServerGoogleConfig(config) {
  if (!config?.master?.id) {
    return;
  }

  await apiJson('/api/google-config', {
    method: 'POST',
    body: JSON.stringify({ config }),
  });
}

function getMissingCheckCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(MISSING_CHECK_CACHE_KEY));
    if (cached && cached.time && Date.now() - cached.time < MISSING_CHECK_CACHE_TTL_MS) {
      return cached.data;
    }
  } catch {
    // ignore
  }
  return null;
}

function setMissingCheckCache(data) {
  try {
    localStorage.setItem(MISSING_CHECK_CACHE_KEY, JSON.stringify({ time: Date.now(), data }));
  } catch {
    // ignore
  }
}

function App() {
  const signingOutRef = useRef(false);
  const organizationSyncAtRef = useRef(0);
  const ORGANIZATION_SYNC_THROTTLE_MS = 5 * 60 * 1000;
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(EMPTY_USER);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [config, setConfig] = useState(() => loadGoogleConfig());
  const [selectedCourier, setSelectedCourier] = useState(COURIERS[0]);
  const [couriers, setCouriers] = useState(COURIERS);
  const [newCourierName, setNewCourierName] = useState('');
  const [addingCourier, setAddingCourier] = useState(false);
  const [courierSelectValue, setCourierSelectValue] = useState('');
  const [scanValue, setScanValue] = useState('');
  const [scannerWindowFocused, setScannerWindowFocused] = useState(true);
  const [selectedPacker, setSelectedPacker] = useState(PACKER_UNASSIGNED);
  const [packerOptions, setPackerOptions] = useState(DEFAULT_PACKERS);
  const [scanRemark, setScanRemark] = useState('');
  const [status, setStatus] = useState(() => ({
    type: GOOGLE_CLIENT_ID ? 'idle' : 'warning',
    title: GOOGLE_CLIENT_ID ? 'พร้อมเชื่อม Google' : 'ต้องใส่ OAuth Client ID',
    message: GOOGLE_CLIENT_ID
      ? 'เข้าสู่ระบบด้วย Google ก่อนเริ่มสแกนจริง'
      : 'เพิ่ม VITE_GOOGLE_CLIENT_ID ใน Vercel Environment Variables แล้ว deploy ใหม่',
  }));
  const [deploymentUpdateAvailable, setDeploymentUpdateAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanQueueSnapshot, setScanQueueSnapshot] = useState({
    pending: [],
    processing: null,
    completed: 0,
    failed: 0,
    lastResult: null,
    results: [],
  });
  const [today, setToday] = useState(() => getBangkokParts());
  const [summary, setSummary] = useState(() => COURIERS.map((courier) => ({ courier, count: 0 })));
  const [recentRows, setRecentRows] = useState([]);
  const [showAllRecentRows, setShowAllRecentRows] = useState(false);
  const [packerCounts, setPackerCounts] = useState(() =>
    DEFAULT_PACKERS.filter((p) => p !== PACKER_UNASSIGNED).map((p) => ({ packer: p, count: 0 })),
  );
  const [scanFlash, setScanFlash] = useState(false);
  const [scanPopupOpen, setScanPopupOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [theme, setTheme] = useState(() => (
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  ));
  const [scanMethod, setScanMethod] = useState(DEFAULT_SCAN_METHOD);
  const [allowAnyTrackingFormat, setAllowAnyTrackingFormat] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraMessage, setCameraMessage] = useState('เปิดกล้อง แล้วเล็งบาร์โค้ดหลักให้อยู่ในกรอบ');
  const [cameraMessageType, setCameraMessageType] = useState('idle');
  const [searchValue, setSearchValue] = useState('');
  const [searchScope, setSearchScope] = useState('selected');
  const [searchMode, setSearchMode] = useState('today');
  const [searchStartDate, setSearchStartDate] = useState(() => getBangkokParts().date);
  const [searchEndDate, setSearchEndDate] = useState(() => getBangkokParts().date);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [reportMode, setReportMode] = useState('daily');
  const [reportDate, setReportDate] = useState(() => getBangkokParts().date);
  const [reportStartDate, setReportStartDate] = useState(() => getBangkokParts().date);
  const [reportEndDate, setReportEndDate] = useState(() => getBangkokParts().date);
  const [reportMonth, setReportMonth] = useState(() => getBangkokParts().date.slice(0, 7));
  const [reportBusy, setReportBusy] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [activeTab, setActiveTab] = useState('packer');
  const [driveRecentRows, setDriveRecentRows] = useState([]);
  const [driveTotalCount, setDriveTotalCount] = useState(0);
  const [driveSyncBusy, setDriveSyncBusy] = useState(false);
  const [sheetRecoveryBusy, setSheetRecoveryBusy] = useState(false);
  const [sheetRecoveryStartDate, setSheetRecoveryStartDate] = useState(() => getBangkokParts().date);
  const [sheetRecoveryEndDate, setSheetRecoveryEndDate] = useState(() => getBangkokParts().date);
  const [missingResults, setMissingResults] = useState(null);
  const [missingBusy, setMissingBusy] = useState(false);
  const [missingAlertBadge, setMissingAlertBadge] = useState(0);
  const [thresholdMinutes, setThresholdMinutes] = useState(DEFAULT_THRESHOLD_MINUTES);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [marketplaceUploadBusy, setMarketplaceUploadBusy] = useState(false);
  const [marketplaceUploadResult, setMarketplaceUploadResult] = useState(null);
  const [marketplaceFilterPlatform, setMarketplaceFilterPlatform] = useState('all');
  const marketplaceFileRef = useRef(null);
  const inputRef = useRef(null);
  const audioContextRef = useRef(null);
  const cameraRef = useRef(null);
  const scanProcessorRef = useRef(null);
  const scanQueueRef = useRef(null);
  const lastCameraScanRef = useRef({ code: '', time: 0 });
  const cameraSavingRef = useRef(false);
  const refreshTimerRef = useRef(null);
  const autoCheckTimerRef = useRef(null);
  const lastAutoCheckRef = useRef(0);
  const sheetRecoveryRunningRef = useRef(false);
  const sheetRecoveryNextAllowedAtRef = useRef(0);

  const isGoogleReady = isFirebaseConfigured || Boolean(GOOGLE_CLIENT_ID);
  const isSheetConnected = Boolean(token && config);
  // Firestore is the write authority whenever Firebase is configured. A Google Sheet token on
  // its own must not unlock the scanner, because its next Firestore write would be rejected.
  const isSignedIn = isFirebaseConfigured ? Boolean(firebaseUser) : isSheetConnected;
  useEffect(() => {
    if (!firebaseUser) return;
    return subscribeStaffMembers({
      onChange: (members) => {
        if (members.length === 0) return;
        try {
          const next = [PACKER_UNASSIGNED, ...buildPackerOptions(members)];
          setPackerOptions(next);
          setSelectedPacker((current) => next.includes(current) ? current : PACKER_UNASSIGNED);
        } catch {
          // Invalid duplicate names must not replace the last valid scan options.
        }
      },
      onError: () => {
        // Keep the last known Packer list; the directory page shows the detailed load error.
      },
    });
  }, [firebaseUser?.uid]);
  const selectedCount = useMemo(
    () => summary.find((item) => item.courier === selectedCourier)?.count ?? 0,
    [selectedCourier, summary],
  );
  const scanPopupCourierOptions = useMemo(
    () => getScanPopupCourierOptions(couriers, selectedCourier),
    [couriers, selectedCourier],
  );
  const displayedCourierCounts = useMemo(() => {
    if (activeTab !== 'drive') {
      return summary;
    }

    return couriers.map((courier) => ({
      courier,
      count: driveRecentRows.filter((row) => row.courier === courier).length,
    }));
  }, [activeTab, couriers, driveRecentRows, summary]);
  const totalTodayCount = useMemo(() => summary.reduce((sum, item) => sum + item.count, 0), [summary]);
  const displayedRecentRows = showAllRecentRows ? recentRows : recentRows.slice(0, 3);
  const sheetUrl = config?.master?.webViewLink;
  const requiresPacker = !getScanIssueMeta(scanRemark).isIssue && activeTab === 'packer';
  const isPackerReady = !requiresPacker || selectedPacker !== PACKER_UNASSIGNED;
  const isDriveReady = isSignedIn && scanMethod === 'manual' ? true : isSignedIn;
  const queuedScanCount = scanQueueSnapshot.pending.length;
  const scanQueueStatusText = isSignedIn && scanMethod === 'manual' && !scannerWindowFocused
    ? 'หยุดสแกนชั่วคราว: หน้าระบบไม่ได้ active — กลับมาที่ระบบก่อนยิงบาร์โค้ด'
    : scanQueueSnapshot.processing
    ? `กำลังบันทึก ${scanQueueSnapshot.processing.code}${queuedScanCount ? ` • รอคิว ${queuedScanCount} รายการ` : ''}`
    : scanQueueSnapshot.lastResult?.status === 'error'
      ? `${scanQueueSnapshot.lastResult.job.code} บันทึกไม่สำเร็จ — ยิงเลขเดิมอีกครั้งได้`
      : 'พร้อมยิงบาร์โค้ดต่อเนื่อง — ระบบจะแยกและบันทึกทีละเลข';
  const scanPopupStatusMeta = getScanPopupStatusMeta(status.type);
  const ScanPopupStatusIcon = scanPopupStatusMeta.icon === 'check'
    ? CheckCircle2
    : scanPopupStatusMeta.icon === 'alert'
      ? AlertTriangle
      : ScanLine;

  scanProcessorRef.current = async (job) => {
    const result = job.context.activeTab === 'drive'
      ? await saveAdminScannedCode(job.code, 'queue', job.context)
      : await saveScannedCode(job.code, 'queue', job.context);
    if (result?.status === 'error') {
      throw new Error(result.message || 'บันทึกรายการในคิวไม่สำเร็จ');
    }
    return result;
  };

  async function uploadMarketplaceFiles(event) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (!files.length || !firebaseUser) return;
    setMarketplaceUploadBusy(true);
    setMarketplaceUploadResult(null);
    try {
      const parsedRows = [];
      for (const file of files) {
        let rows;
        if (file.name.toLowerCase().endsWith('.csv')) {
          rows = parseCsvText(await file.text());
        } else {
          rows = await parseXlsxArrayBuffer(await file.arrayBuffer());
        }
        parsedRows.push(...parseMarketplaceRows(rows));
      }
      const allGroups = groupMarketplaceRows(parsedRows);
      if (!allGroups.length) throw new Error('ไม่พบออเดอร์ที่มีเลขพัสดุในไฟล์');
      const groups = marketplaceFilterPlatform === 'all'
        ? allGroups
        : allGroups.filter((g) => g.platform.toLowerCase() === marketplaceFilterPlatform.toLowerCase());
      if (!groups.length) throw new Error(`ไม่พบออเดอร์จาก ${marketplaceFilterPlatform} ในไฟล์`);
      const trackableGroups = groups.filter((group) => group.normalizedTrackingNo);
      const untrackedCount = groups.length - trackableGroups.length;
      if (!trackableGroups.length) {
        throw new Error(`ไฟล์นี้มี ${groups.length} ออเดอร์ แต่ยังไม่มีเลขพัสดุสักรายการ กรุณาดาวน์โหลดไฟล์ใหม่หลังออกเลขพัสดุแล้ว`);
      }
      const result = await runWithGoogleRetry((accessToken, googleConfig) => (
        upsertMarketplaceOrdersGoogle({
          token: accessToken,
          config: googleConfig,
          groups: trackableGroups,
          max: MARKETPLACE_IMPORT_MAX_ORDERS,
        })
      ), { sheetWrite: true });
      const limitedGroups = result.groups;
      const skippedCount = result.skipped;
      const missingOrderDateCount = limitedGroups.filter((group) => !group.orderedAt).length;
      const untrackedNote = untrackedCount > 0
        ? ` (ข้าม ${untrackedCount} ออเดอร์ที่ยังไม่มีเลขพัสดุ)`
        : '';
      const skippedNote = skippedCount > 0
        ? ` (นำเข้า ${MARKETPLACE_IMPORT_MAX_ORDERS} ออเดอร์ในรอบนี้ โดยให้ออเดอร์ใหม่ก่อน ข้าม ${skippedCount} ออเดอร์ที่เหลือ กรุณานำเข้าไฟล์นี้ซ้ำเพื่อทำรอบถัดไป)`
        : '';
      const missingDateNote = missingOrderDateCount > 0
        ? ` (พบ ${missingOrderDateCount} ออเดอร์ที่ไม่พบวันที่สั่งซื้อในไฟล์ อาจเรียงลำดับผิดพลาด กรุณาตรวจสอบภาษา/รูปแบบไฟล์ export)`
        : '';
      const collisionNote = result.collisions > 0
        ? ` (ข้าม ${result.collisions} ออเดอร์ที่มีเลขพัสดุซ้อนกันในเลขคำสั่งซื้อเดียว)`
        : '';
      try {
        const sheetResult = await runWithGoogleRetry((accessToken, googleConfig) => (
          backfillMarketplaceOrdersGoogle({ token: accessToken, config: googleConfig, groups: limitedGroups })
        ), { sheetWrite: true });
        const lateResult = await runWithGoogleRetry((accessToken, googleConfig) => (
          syncLateOrdersGoogle({
            token: accessToken,
            config: googleConfig,
            orders: limitedGroups.map((group) => ({
              ...group,
              scanned: sheetResult.scannedTrackingNos.includes(group.normalizedTrackingNo),
            })),
          })
        ), { sheetWrite: true });
        setMarketplaceUploadResult({
          type: (skippedCount > 0 || untrackedCount > 0 || missingOrderDateCount > 0 || result.collisions > 0) ? 'warning' : 'success',
          message: `บันทึกใหม่ ${result.imported} ออเดอร์ ไม่มีการเปลี่ยนแปลง ${result.unchanged} ออเดอร์ อัปเดตข้อมูลเดิม ${result.updated} ออเดอร์ ใน Marketplace Orders, อัปเดต Google Sheet ${sheetResult.matchedRows} แถว และ Late Orders ${lateResult.rows} ออเดอร์ (ล่าช้า ${lateResult.counts.overdue ?? 0})${skippedNote}${untrackedNote}${missingDateNote}${collisionNote}`,
        });
      } catch (sheetError) {
        setMarketplaceUploadResult({
          type: 'warning',
          message: `บันทึก Marketplace Orders ใหม่ ${result.imported} ออเดอร์ อัปเดตข้อมูลเดิม ${result.updated} ออเดอร์แล้ว แต่การ backfill Google Sheet ยังไม่สำเร็จ: ${userErrorMessage(sheetError)}${skippedNote}${untrackedNote}${missingDateNote}${collisionNote}`,
        });
      }
    } catch (error) {
      setMarketplaceUploadResult({ type: 'error', message: userErrorMessage(error, 'นำเข้าไฟล์ไม่สำเร็จ กรุณาตรวจสอบไฟล์แล้วลองใหม่') });
    } finally {
      setMarketplaceUploadBusy(false);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_KEY, theme);

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.setAttribute('content', theme === 'dark' ? '#04120f' : '#eaf4f3');
    }
  }, [theme]);

  useEffect(() => {
    let unsubscribed = false;
    let unsubscribeAuth = null;

    if (firebaseAuth) {
      unsubscribeAuth = onAuthStateChanged(firebaseAuth, (authUser) => {
        if (unsubscribed) {
          return;
        }
        setFirebaseUser(authUser);
        if (authUser) {
          setUser((current) => (
            current.email === EMPTY_USER.email
              ? {
                  email: authUser.email ?? 'firebase-user',
                  name: authUser.displayName ?? 'Firebase User',
                }
              : current
          ));
          void upsertFirebaseUser(authUser).catch(() => {});
        }
      });
    }

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const oauthState = params.get('state');
    const error = params.get('error');

    if (!code && !error) {
      handleFirebaseRedirectOrRestore();
      return () => {
        unsubscribed = true;
        unsubscribeAuth?.();
      };
    }

    window.history.replaceState(null, '', window.location.pathname);

    if (error) {
      setStatus({
        type: 'error',
        title: 'เข้าสู่ระบบไม่สำเร็จ',
        message: oauthCallbackErrorMessage(error),
      });
      setBusy(false);
    } else {
      completeGoogleSignIn(code, oauthState);
    }

    return () => {
      unsubscribed = true;
      unsubscribeAuth?.();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setToday(getBangkokParts());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD) return undefined;

    let disposed = false;

    const checkForDeploymentUpdate = async () => {
      try {
        const response = await fetch(new URL('/', window.location.origin), {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!response.ok) return;
        const html = await response.text();
        if (!disposed && hasDeploymentUpdate({
          html,
          documentUrl: response.url,
          currentEntrypointUrl: import.meta.url,
        })) {
          setDeploymentUpdateAvailable(true);
        }
      } catch {
        // A temporary network failure must not interrupt warehouse scanning.
      }
    };

    const checkWhenReturningToApp = () => {
      if (document.visibilityState === 'visible') void checkForDeploymentUpdate();
    };

    void checkForDeploymentUpdate();
    const timer = window.setInterval(checkForDeploymentUpdate, DEPLOYMENT_UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', checkWhenReturningToApp);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', checkWhenReturningToApp);
    };
  }, []);

  useEffect(() => {
    if (!firebaseUser) {
      setCouriers(COURIERS);
      return () => {};
    }
    return subscribeCouriers({
      defaultCouriers: COURIERS,
      onChange: (nextCouriers) => {
        setCouriers(nextCouriers);
        setSelectedCourier((current) => (nextCouriers.includes(current) ? current : nextCouriers[0] ?? COURIERS[0]));
        setSummary((current) => nextCouriers.map((courier) => (
          current.find((item) => item.courier === courier) ?? { courier, count: 0 }
        )));
        scheduleCountRefresh();
      },
      onError: (error) => console.warn('Courier list sync failed:', error),
    });
  }, [firebaseUser]);

  useEffect(() => {
    const queue = createScanQueue({
      process: (job) => scanProcessorRef.current(job),
      onStateChange: setScanQueueSnapshot,
      maxSize: 100,
    });
    scanQueueRef.current = queue;
    return () => {
      queue.dispose();
      scanQueueRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isSignedIn && scanMethod === 'manual') {
      window.setTimeout(() => focusScanInput({ force: true }), 0);
    }
  }, [isSignedIn, selectedCourier, activeTab, scanMethod, scanPopupOpen, selectedPacker]);

  useEffect(() => {
    if (!isSignedIn || scanMethod !== 'manual') {
      setScannerWindowFocused(true);
      return () => {};
    }
    const regainScannerFocus = () => {
      if (document.visibilityState === 'hidden') return;
      setScannerWindowFocused(true);
      window.setTimeout(() => focusScanInput({ force: true }), 0);
    };
    const loseScannerFocus = () => setScannerWindowFocused(false);
    window.addEventListener('focus', regainScannerFocus);
    window.addEventListener('blur', loseScannerFocus);
    document.addEventListener('visibilitychange', regainScannerFocus);
    regainScannerFocus();
    return () => {
      window.removeEventListener('focus', regainScannerFocus);
      window.removeEventListener('blur', loseScannerFocus);
      document.removeEventListener('visibilitychange', regainScannerFocus);
    };
  }, [isSignedIn, scanMethod, activeTab, scanPopupOpen]);

  useEffect(() => {
    if (!isSignedIn || scanMethod !== 'camera') {
      void stopCamera();
    }
  }, [isSignedIn, scanMethod]);

  useEffect(() => {
    if (!scanPopupOpen) return () => {};
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setScanPopupOpen(false);
      void stopCamera();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [scanPopupOpen]);

  useEffect(() => {
    if (!scanQueueSnapshot.processing && scanQueueSnapshot.pending.length === 0) return () => {};
    const warnBeforeLeaving = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [scanQueueSnapshot.processing, scanQueueSnapshot.pending.length]);

  useEffect(() => {
    return () => {
      void stopCamera();
    };
  }, []);

  useEffect(() => {
    if (!isSignedIn) {
      setRecentRows([]);
      setDriveRecentRows([]);
      return;
    }

    if (activeTab === 'packer') {
      refreshSelectedCourierRows();
    } else if (activeTab === 'drive') {
      refreshDriveRows();
    }
  }, [selectedCourier, today.date, isSignedIn, activeTab]);

  useEffect(() => {
    if (!firebaseUser || !token || !config?.master?.id || sheetRecoveryRunningRef.current) return;
    void recoverPendingSheetSyncs();
  }, [firebaseUser, token, config]);

  useEffect(() => {
    setShowAllRecentRows(false);
  }, [selectedCourier, today.date, activeTab]);

  useEffect(() => {
    if (isSignedIn) {
      generateReport();
    }
  }, [isSignedIn]);

  // Auto-retry sheet sync every 5 minutes (reduces Firestore reads)
  useEffect(() => {
    if (!firebaseUser || !token || !config?.master?.id) return;
    const interval = setInterval(() => {
      void recoverPendingSheetSyncs();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [firebaseUser, token, config]);

  // A synced marker only proves the last write completed. Re-read a bounded part of today's
  // ledger every 10 minutes so direct Sheet edits (including a keyboard-wedge scanner) are
  // detected and repaired from Firestore without waiting for someone to press Recovery.
  useEffect(() => {
    if (!firebaseUser || !token || !config?.master?.id) return;
    const verifyToday = () => {
      void recoverPendingSheetSyncs({
        includeSynced: true,
        dates: [getBangkokParts().date],
        routineVerification: true,
      });
    };
    const interval = setInterval(verifyToday, SHEET_INTEGRITY_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [firebaseUser, token, config]);

  // Auto-check for missing orders
  useEffect(() => {
    if (!shouldPollMissingOrders({ isSignedIn, activeTab })) {
      setMissingAlertBadge(0);
      return;
    }

    runAutoCheck();

    autoCheckTimerRef.current = setInterval(() => {
      runAutoCheck(false);
    }, AUTO_CHECK_INTERVAL_MS);

    return () => {
      if (autoCheckTimerRef.current) {
        clearInterval(autoCheckTimerRef.current);
      }
    };
  }, [isSignedIn, activeTab]);

  async function runAutoCheck(showStatus = false) {
    if (!isSignedIn) return;

    // Don't run more than once per 5 minutes
    const now = Date.now();
    if (now - lastAutoCheckRef.current < MISSING_CHECK_CACHE_TTL_MS) {
      return;
    }
    lastAutoCheckRef.current = now;

    // Check cache first
    const cached = getMissingCheckCache();
    if (cached) {
      setMissingAlertBadge(cached.pending?.length ?? 0);
      return;
    }

    try {
      const results = canUseFirestorePrimary()
        ? await checkMissingOrdersFirestore({
          courier: null,
          hoursLookback: DEFAULT_LOOKBACK_HOURS,
          thresholdMinutes,
          summaryOnly: true,
        })
        : await runWithGoogleRetry((accessToken, googleConfig) =>
            checkMissingOrders({
              token: accessToken,
              config: googleConfig,
              courier: null,
              hoursLookback: DEFAULT_LOOKBACK_HOURS,
              thresholdMinutes,
            }),
          );

      setMissingCheckCache(results);
      const pendingCount = results.pending?.length ?? 0;
      setMissingAlertBadge(pendingCount);

      if (showStatus && pendingCount > 0) {
        setStatus({
          type: 'warning',
          title: 'พบออเดอร์ตกหล่น',
          message: `มี ${pendingCount} รายการที่ยังไม่ได้สแกนส่ง`,
        });
      }
    } catch {
      // Silent fail for auto-check
    }
  }

  async function playTone(type) {
    if (!soundEnabled) {
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return;
    }

    const context = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = context;
    if (context.state === 'suspended') {
      await context.resume();
    }
    const now = context.currentTime;
    const patterns = {
      success: [
        { frequency: 1320, duration: 0.22, offset: 0, peak: 0.82, wave: 'square' },
        { frequency: 1760, duration: 0.28, offset: 0.24, peak: 0.86, wave: 'square' },
      ],
      duplicate: [
        { frequency: 220, duration: 0.38, offset: 0, peak: 0.9, wave: 'sawtooth' },
        { frequency: 150, duration: 0.38, offset: 0.4, peak: 0.9, wave: 'sawtooth' },
        { frequency: 220, duration: 0.42, offset: 0.82, peak: 0.9, wave: 'sawtooth' },
      ],
      ignored: [
        { frequency: 420, duration: 0.28, offset: 0, peak: 0.78, wave: 'square' },
        { frequency: 300, duration: 0.32, offset: 0.3, peak: 0.82, wave: 'square' },
      ],
      error: [
        { frequency: 180, duration: 0.46, offset: 0, peak: 0.92, wave: 'sawtooth' },
        { frequency: 120, duration: 0.52, offset: 0.48, peak: 0.92, wave: 'sawtooth' },
      ],
      alert: [
        { frequency: 880, duration: 0.25, offset: 0, peak: 0.9, wave: 'square' },
        { frequency: 660, duration: 0.25, offset: 0.3, peak: 0.9, wave: 'square' },
        { frequency: 880, duration: 0.25, offset: 0.6, peak: 0.9, wave: 'square' },
      ],
    };
    const pattern = patterns[type] ?? patterns.error;

    pattern.forEach((tone) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startsAt = now + tone.offset;
      const endsAt = startsAt + tone.duration;

      oscillator.type = tone.wave;
      oscillator.frequency.setValueAtTime(tone.frequency, startsAt);
      gain.gain.setValueAtTime(0.0001, startsAt);
      gain.gain.exponentialRampToValueAtTime(tone.peak, startsAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, endsAt - 0.02);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startsAt);
      oscillator.stop(endsAt);
    });
  }

  function showCameraMessage(message, type = 'idle') {
    setCameraMessage(message);
    setCameraMessageType(type);
  }

  const isFirebaseHosting = typeof window !== 'undefined' && (
    window.location.hostname.endsWith('.firebaseapp.com') ||
    window.location.hostname.endsWith('.web.app')
  );

  async function signInWithGoogle() {
    // Only use Firebase signInWithRedirect on Firebase Hosting
    if (firebaseAuth && isFirebaseHosting) {
      const provider = createGoogleProvider(GOOGLE_SCOPES);
      localStorage.removeItem(LOGGED_OUT_FLAG);
      setBusy(true);
      await signInWithRedirect(firebaseAuth, provider);
      return;
    }

    // Server-side OAuth flow (works on Vercel and any custom domain)
    if (!GOOGLE_CLIENT_ID) {
      setStatus({
        type: 'warning',
        title: 'ยังไม่ได้ใส่ OAuth Client ID',
        message: 'ตั้งค่า VITE_GOOGLE_CLIENT_ID บน Vercel แล้ว deploy ใหม่ก่อนใช้งานจริง',
      });
      return;
    }

    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    localStorage.removeItem(LOGGED_OUT_FLAG);
    setBusy(true);
    try {
      const data = await apiJson('/api/google-oauth-start', {
        method: 'POST',
        body: JSON.stringify({ redirectUri }),
      });
      window.location.assign(data.authorizationUrl);
    } catch (error) {
      setStatus({ type: 'error', title: 'เริ่มเข้าสู่ระบบไม่สำเร็จ', message: userErrorMessage(error, 'เริ่มเชื่อมต่อ Google ไม่สำเร็จ กรุณาลองใหม่') });
      setBusy(false);
    }
  }

  async function handleFirebaseRedirectOrRestore() {
    if (!firebaseAuth) {
      await restoreGoogleSession();
      return;
    }

    try {
      setBusy(true);
      const result = await getRedirectResult(firebaseAuth);
      const credential = result ? GoogleAuthProvider.credentialFromResult(result) : null;
      const accessToken = credential?.accessToken;

      if (result?.user && accessToken) {
        await activateGoogleSession({
          accessToken,
          profile: {
            email: result.user.email,
            name: result.user.displayName,
          },
          expiresIn: 3600,
          config: null,
          firebaseUser: result.user,
        });
        setStatus({
          type: 'success',
          title: 'Firebase Login พร้อมใช้งาน',
          message: 'Firebase Auth เป็น login หลัก และ Google Sheet ยังบันทึกได้ตาม flow เดิม',
        });
        return;
      }
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'Firebase Login ไม่สำเร็จ',
        message: userErrorMessage(error, 'Firebase ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่หรือแจ้งผู้ดูแลระบบ'),
      });
      setBusy(false);
      return;
    }

    await restoreGoogleSession();
  }

  async function completeGoogleSignIn(code, state) {
    try {
      setBusy(true);
      const redirectUri = `${window.location.origin}${window.location.pathname}`;
      const data = await apiJson('/api/google-auth', {
        method: 'POST',
        body: JSON.stringify({ code, state }),
      });
      const session = await activateGoogleSession(data);
      setStatus(session.firebaseSignInFailed
        ? {
            type: 'warning',
            title: 'เข้าสู่ระบบ Firebase ไม่สำเร็จ',
            message: 'เชื่อม Google Sheet แล้ว แต่ Firebase ยังยืนยันตัวตนไม่สำเร็จ จึงยังลง Drive ไม่ได้ กรุณาแจ้งผู้ดูแลระบบ',
          }
        : data.serverSession === false
        ? {
            type: 'warning',
            title: 'เชื่อม Google แล้ว แต่ยังจำ Login ไม่ได้',
            message: 'ระบบใช้งานได้ชั่วคราว แต่ session ระยะยาวไม่พร้อม กรุณาแจ้งผู้ดูแลระบบ',
          }
        : {
            type: 'success',
            title: 'เชื่อม Google Sheet แล้ว',
            message: 'ระบบเตรียม Google Sheet Master และ session ระยะยาวเรียบร้อย',
          });
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'เชื่อม Google ไม่สำเร็จ',
        message: userErrorMessage(error, 'เชื่อมต่อ Google ไม่สำเร็จ กรุณาลองใหม่'),
      });
    } finally {
      setBusy(false);
    }
  }

  async function restoreGoogleSession() {
    if (localStorage.getItem(LOGGED_OUT_FLAG) === '1') {
      localStorage.removeItem(LOGGED_OUT_FLAG);
      return;
    }

    const stored = loadStoredGoogleSession();
    if (stored?.accessToken && stored.expiresAt > Date.now() + 60_000) {
      try {
        setBusy(true);
        await activateGoogleSession({
          accessToken: stored.accessToken,
          profile: stored.user ?? EMPTY_USER,
          expiresIn: Math.floor((stored.expiresAt - Date.now()) / 1000),
          config: stored.config ?? null,
        });
        setStatus({
          type: 'success',
          title: 'กลับมาใช้งานต่อได้',
          message: 'ใช้ session เดิมจาก browser',
        });
        return;
      } catch {
        clearStoredGoogleSession();
        setToken(null);
        setUser(EMPTY_USER);
        setConfig(null);
      } finally {
        setBusy(false);
      }
    }

    await refreshGoogleSessionFromServer();
  }

  async function refreshGoogleSessionFromServer({ silent = false } = {}) {
    try {
      setBusy(true);
      const data = await apiJson('/api/google-token');
      const session = await activateGoogleSession(data);
      if (!silent) {
        setStatus({
          type: 'success',
          title: 'ต่ออายุ Login แล้ว',
          message: 'ดึง session จาก Vercel KV สำเร็จ',
        });
      }
      return session;
    } catch {
      if (!silent) {
        clearStoredGoogleSession();
        setToken(null);
        setUser(EMPTY_USER);
        setConfig(null);
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function activateGoogleSession(data) {
    signingOutRef.current = false;
    const accessToken = data.accessToken;
    const idToken = data.idToken;
    const profile = data.profile ?? (await fetchGoogleProfile(accessToken));
    const serverConfig = data.config ?? (await loadServerGoogleConfig().catch(() => null));
    const prepared = serverConfig ?? (await prepareGoogleSheets(accessToken));
    const nextUser = {
      email: profile.email ?? 'google-user',
      name: profile.name ?? 'Google User',
    };
    saveStoredGoogleSession({
      accessToken,
      expiresAt: Date.now() + Math.max((data.expiresIn ?? 3600) - 60, 60) * 1000,
      user: nextUser,
      config: prepared,
    });
    await saveServerGoogleConfig(prepared).catch(() => {});

    setToken(accessToken);
    setUser(nextUser);
    await ensureGoogleSheetOrganization({ token: accessToken, config: prepared }).catch((error) => {
      console.warn('Google Sheet organization failed:', error);
    });
    organizationSyncAtRef.current = Date.now();
    const marketplaceColorBackfillKey = `scan-to-sheet:marketplace-colors:${prepared.master?.id}:v2`;
    if (prepared.master?.id && localStorage.getItem(marketplaceColorBackfillKey) !== '1') {
      try {
        await colorAllHistoricalSheetsGoogle({ token: accessToken, config: prepared });
        localStorage.setItem(marketplaceColorBackfillKey, '1');
      } catch (error) {
        console.warn('Historical Marketplace colors failed:', error);
      }
    }

    let firebaseSignInFailed = false;
    if (firebaseAuth && idToken) {
      try {
        const credential = GoogleAuthProvider.credential(idToken, accessToken);
        const result = await signInWithCredential(firebaseAuth, credential);
        setFirebaseUser(result.user);
        await upsertFirebaseUser(result.user).catch(() => {});
      } catch (error) {
        const existingFirebaseUser = firebaseAuth.currentUser;
        firebaseSignInFailed = !existingFirebaseUser;
        setFirebaseUser(existingFirebaseUser);
        console.warn('Firebase Auth sign-in failed after Google OAuth:', error);
      }
    } else if (data.firebaseUser) {
      setFirebaseUser(data.firebaseUser);
      await upsertFirebaseUser(data.firebaseUser).catch(() => {});
    }

    await refreshAllCounts(accessToken, prepared);
    setConfig(prepared);
    return { accessToken, config: prepared, user: nextUser, firebaseSignInFailed };
  }

  async function getFirebaseUserForPrimary() {
    if (!isFirebaseConfigured) return null;

    const authUser = firebaseAuth?.currentUser;
    if (!authUser) throw createFirebaseAuthRequiredError();

    try {
      // Ask the SDK for the current ID token before a Firestore transaction. It refreshes an
      // expiring token without forcing the operator through another Google login.
      await authUser.getIdToken();
    } catch {
      throw createFirebaseAuthRequiredError();
    }
    return authUser;
  }

  async function runWithGoogleRetry(action, { sheetWrite = false } = {}) {
    if (signingOutRef.current) {
      throw new Error('Google session is signing out');
    }
    let releaseLock = null;
    try {
      if (sheetWrite) {
        releaseLock = await acquireSheetWriteLock(config?.master?.id || 'master');
      }
      return await action(token, config);
    } catch (error) {
      if (signingOutRef.current || !isGoogleAuthError(error)) {
        throw error;
      }

      const session = await refreshGoogleSessionFromServer({ silent: true });
      if (!session?.accessToken || !session?.config) {
        throw error;
      }

      return action(session.accessToken, session.config);
    } finally {
      await releaseLock?.();
    }
  }

  function findMarketplaceOrderForScan(trackingNo) {
    return runWithGoogleRetry((accessToken, googleConfig) => (
      findMarketplaceOrderGoogle({ token: accessToken, config: googleConfig, trackingNo })
    ));
  }

  function isGoogleAuthError(error) {
    const message = String(error?.message ?? '').toLowerCase();
    return (
      message.includes('401') ||
      message.includes('invalid authentication') ||
      message.includes('invalid credentials') ||
      message.includes('unauthorized') ||
      (message.includes('google api error 403') && message.includes('permission_denied'))
    );
  }

  async function signOut() {
    signingOutRef.current = true;
    localStorage.setItem(LOGGED_OUT_FLAG, '1');

    if (firebaseAuth) {
      await signOutFirebase(firebaseAuth).catch(() => {});
    }

    try {
      await fetch('/api/google-logout', { method: 'POST' });
    } catch {
    }
    clearStoredGoogleSession();
    setToken(null);
    setUser(EMPTY_USER);
    setFirebaseUser(null);
    setSummary(couriers.map((courier) => ({ courier, count: 0 })));
    setPackerCounts(packerOptions.filter((p) => p !== PACKER_UNASSIGNED).map((p) => ({ packer: p, count: 0 })));
    setRecentRows([]);
    setDriveRecentRows([]);
    setReportData(null);
    setSearchResults(null);
    setMissingResults(null);
    setMissingAlertBadge(0);
    setDriveTotalCount(0);
    setStatus({
      type: 'idle',
      title: 'ออกจากระบบแล้ว',
      message: 'เข้าสู่ระบบด้วย Google อีกครั้งเมื่อต้องการสแกน',
    });
  }

  async function refreshAllCounts(accessToken = token, googleConfig = config) {
    if (signingOutRef.current) {
      return;
    }
    if (accessToken && googleConfig && Date.now() - organizationSyncAtRef.current >= ORGANIZATION_SYNC_THROTTLE_MS) {
      await ensureGoogleSheetOrganization({ token: accessToken, config: googleConfig }).catch((error) => {
        console.warn('Google Sheet organization refresh failed:', error);
      });
      organizationSyncAtRef.current = Date.now();
    }
    if (!isSignedIn) {
      return;
    }

    const data = canUseFirestorePrimary()
      ? await fetchTodaySummaryFirestore({ couriers, date: getBangkokParts().date })
      : await runWithGoogleRetry((t, c) => fetchTodaySummary({ token: t, config: c, couriers }));
    if (data) {
      setSummary(data.courierCounts);
      setPackerCounts(data.packerCounts);
    }

    if (activeTab === 'packer') {
      const courierRows = canUseFirestorePrimary()
        ? await getTodayRowsFirestore({ courier: selectedCourier, date: getBangkokParts().date }).catch(() => [])
        : await runWithGoogleRetry((t, c) =>
            getTodayRowsGoogle({ token: t, config: c, courier: selectedCourier, date: getBangkokParts().date }),
          ).catch(() => []);
      setRecentRows(courierRows);
    } else {
      const driveRows = canUseFirestorePrimary()
        ? await getDriveRowsFirestore({ date: getBangkokParts().date }).catch(() => [])
        : await runWithGoogleRetry((t, c) =>
            getDriveRowsGoogle({ token: t, config: c, date: getBangkokParts().date }),
          ).catch(() => []);
      setDriveRecentRows(driveRows);
      setDriveTotalCount(driveRows.length);
    }
  }

  function scheduleCountRefresh() {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      if (isSignedIn) {
        const summaryPromise = canUseFirestorePrimary()
          ? fetchTodaySummaryFirestore({ couriers, date: getBangkokParts().date })
          : fetchTodaySummary({ token, config, couriers });
        summaryPromise.then((data) => {
          if (data) {
            setSummary(data.courierCounts);
            setPackerCounts(data.packerCounts);
          }
        }).catch(() => {});
      }
    }, COUNT_REFRESH_DELAY_MS);
  }

  function runAfterScanCommit(task) {
    window.setTimeout(() => {
      Promise.resolve()
        .then(task)
        .catch((error) => console.warn('Background scan sync failed:', error));
    }, 0);
  }

  async function refreshSelectedCourierRows() {
    if (!isSignedIn) {
      return;
    }

    try {
      const rows = canUseFirestorePrimary()
        ? await getTodayRowsFirestore({ courier: selectedCourier, date: today.date })
        : await runWithGoogleRetry((accessToken, googleConfig) =>
            getTodayRowsGoogle({
              token: accessToken,
              config: googleConfig,
              courier: selectedCourier,
              date: today.date,
            }),
          );
      setRecentRows(rows);
      scheduleCountRefresh();
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'โหลดรายการไม่สำเร็จ',
        message: userErrorMessage(error, 'โหลดรายการไม่สำเร็จ กรุณาลองใหม่'),
      });
    }
  }

  async function refreshDriveRows() {
    if (!isSignedIn) {
      return;
    }

    try {
      const rows = canUseFirestorePrimary()
        ? await getDriveRowsFirestore({ date: today.date })
        : await runWithGoogleRetry((accessToken, googleConfig) =>
            getDriveRowsGoogle({
              token: accessToken,
              config: googleConfig,
              date: today.date,
            }),
          );
      setDriveRecentRows(rows);
      setDriveTotalCount(rows.length);
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'โหลดรายการลง Drive ไม่สำเร็จ',
        message: userErrorMessage(error, 'โหลดรายการลง Drive ไม่สำเร็จ กรุณาลองใหม่'),
      });
    }
  }

  async function recoverPendingSheetSyncs({
    showStatus = false,
    includeSynced = false,
    role = 'both',
    dates = [],
    routineVerification = false,
  } = {}) {
    if (sheetRecoveryRunningRef.current) {
      if (showStatus) {
        setStatus({ type: 'warning', title: 'กำลังอัปเดตอยู่', message: 'ระบบกำลังซิงก์ออเดอร์ค้างชุดก่อนหน้า' });
      }
      return { busy: true, claimed: 0, synced: 0, failed: 0 };
    }
    if (!firebaseUser || !token || !config?.master?.id) {
      if (showStatus) {
        setStatus({ type: 'warning', title: 'ยังอัปเดต Sheet ไม่ได้', message: 'กรุณาเข้าสู่ระบบ Google และเชื่อม Master Sheet ก่อน' });
      }
      return { busy: false, claimed: 0, synced: 0, failed: 0 };
    }
    // `showStatus` decides whether the packer sees a banner, never whether the quota gate
    // applies. It used to guard the check itself, so all three background callers — the
    // sign-in sweep, the 5-minute retry and the 10-minute integrity pass — ran with no
    // cooldown at all, which is exactly the traffic this exists to space out.
    const waitMs = sheetRecoveryNextAllowedAtRef.current - Date.now();
    if (waitMs > 0) {
      if (showStatus) {
        setStatus({
          type: 'warning',
          title: 'รอ Google Sheets quota',
          message: `กรุณารออีกประมาณ ${Math.ceil(waitMs / 1000)} วินาทีก่อนอัปเดตรอบถัดไป`,
        });
      }
      return { busy: false, claimed: 0, synced: 0, failed: 0 };
    }
    sheetRecoveryRunningRef.current = true;
    setSheetRecoveryBusy(true);
    if (showStatus) setDriveSyncBusy(true);
    let synced = 0;
    let failed = 0;
    let claimedCount = 0;
    let claimedOrders = [];
    try {
      const orders = await claimRecoverableSheetSyncs({
        maxRows: SHEET_RECOVERY_BATCH_SIZE,
        includeSynced,
        role,
        dates,
        recordAudit: !routineVerification,
      });
      claimedOrders = orders;
      claimedCount = orders.length;
      if (orders.length) {
        sheetRecoveryNextAllowedAtRef.current = Date.now() + SHEET_RECOVERY_COOLDOWN_MS;
      }
      if (orders.length === 0) {
        if (showStatus) {
          setStatus({ type: 'success', title: 'ไม่มีรายการค้าง', message: 'ข้อมูลใน Sheet ครบแล้ว ไม่มีออเดอร์ที่ต้องอัปเดต' });
        }
        return { busy: false, claimed: 0, synced: 0, failed: 0 };
      }

      // Build batch order list
      const batchOrders = orders.map((order) => {
        const isPacker = Boolean(order.packerScan?.scannedAt);
        const timing = getAdminScanTiming(order, {
          fallbackDate: getBangkokParts().date,
          fallbackTime: getBangkokParts().time,
        });
        const hasAdmin = Boolean(order.admin?.scannedAt);
        return {
          id: order.id,
          code: order.code || order.normalizedCode,
          courier: order.courier,
          date: timing.sheetDate,
          time: timing.sheetTime,
          email: order.packerScan?.scannedBy?.email || order.admin?.scannedBy?.email || order.user?.email || user.email,
          packer: order.packerScan?.packer ?? order.packer ?? '',
          note: order.packerScan?.note ?? order.note ?? '',
          isPacker,
          adminDate: hasAdmin ? timing.adminDate : '',
          adminTime: hasAdmin ? timing.adminTime : '',
          adminCode: hasAdmin ? (order.code || order.normalizedCode) : '',
          marketplaceOrder: null, // Will be overridden below if found
        };
      });

      // Pre-fetch marketplace metadata if possible (best effort, non-blocking)
      const marketplaceResults = await Promise.all(
        batchOrders.map((bo) => findMarketplaceOrderForScan(bo.code).catch(() => null)),
      );
      batchOrders.forEach((bo, i) => {
        if (marketplaceResults[i]) bo.marketplaceOrder = marketplaceResults[i];
      });

      // Move claimed outbox entries to `writing` before the Google request. A stale writing
      // entry remains claimable, so a browser close cannot strand an order permanently.
      await Promise.all(orders.map((order) => (
        markSheetSyncWriting({
          orderId: order.id,
          attemptId: order.sheetSyncAttemptId,
          recordAudit: !routineVerification,
        }).catch(() => false)
      )));

      // Execute one batch call
      const results = await runWithGoogleRetry((accessToken, googleConfig) =>
        batchAppendScanGoogle({ token: accessToken, config: googleConfig, orders: batchOrders, repairExisting: true }),
        { sheetWrite: true },
      );

      // Mark individual results
      const markOperations = [];
      for (let i = 0; i < results.length; i++) {
        const { order: batchOrder, result, error } = results[i];
        const firestoreOrder = orders.find((order) => order.id === batchOrder?.id) ?? orders[i];
        if (result && isSheetSyncResultConfirmed(result)) {
          synced += 1;
          markOperations.push(markSheetSyncResult({
            orderId: firestoreOrder.id,
            attemptId: firestoreOrder.sheetSyncAttemptId,
            ok: true,
            result,
            recordAudit: !routineVerification || Boolean(result.repaired),
          }).catch(() => {}));
        } else {
          failed += 1;
          markOperations.push(markSheetSyncResult({
            orderId: firestoreOrder.id,
            attemptId: firestoreOrder.sheetSyncAttemptId,
            ok: false,
            // Name the role from the order itself: `role` may be 'both' for a mixed batch,
            // and result.isPacker reflects what was actually attempted for this row.
            error: error || new Error(`ซิงก์เป็นชุดแล้วแต่ยืนยันแถว ${(result?.isPacker ?? batchOrder?.isPacker) ? 'Packer' : 'Admin'} ใน Google Sheet ไม่ได้`),
            recordAudit: !routineVerification,
          }).catch(() => {}));
        }
      }
      await Promise.all(markOperations);

      scheduleCountRefresh();
      if (showStatus) {
        if (role === 'packer') {
          await refreshSelectedCourierRows().catch(() => {});
        } else {
          await refreshDriveRows().catch(() => {});
        }
        setStatus(
          failed > 0
            ? { type: 'warning', title: 'อัปเดต Sheet ยังไม่ครบ', message: `ซิงก์สำเร็จ ${synced} รายการ, ยังไม่สำเร็จ ${failed} รายการ` }
            : {
                type: 'success',
                title: 'อัปเดต Sheet แล้ว',
                message: `ซิงก์ออเดอร์ค้างสำเร็จ ${synced} รายการ${orders.length === SHEET_RECOVERY_BATCH_SIZE ? ' หากยังมีรายการค้าง ให้กดอีกครั้ง' : ''}`,
              },
        );
      }
      return { busy: false, claimed: orders.length, synced, failed };
    } catch (error) {
      const failureUpdates = buildSheetSyncFailureUpdates(claimedOrders, error);
      await Promise.all(failureUpdates.map(({ orderId, attemptId, error: syncError }) => (
        markSheetSyncResult({
          orderId,
          attemptId,
          ok: false,
          error: syncError,
          recordAudit: !routineVerification,
        }).catch(() => {})
      )));
      failed = Math.max(failed, failureUpdates.length);
      if (showStatus) {
        setStatus({ type: 'error', title: 'อัปเดต Sheet ไม่สำเร็จ', message: userErrorMessage(error, 'อัปเดต Google Sheet ไม่สำเร็จ กรุณาลองใหม่') });
      }
      return {
        busy: false,
        claimed: claimedCount,
        synced,
        failed: Math.max(failed, claimedCount - synced),
      };
    } finally {
      sheetRecoveryRunningRef.current = false;
      setSheetRecoveryBusy(false);
      if (showStatus) setDriveSyncBusy(false);
    }
  }

  async function recoverSelectedSheetRange() {
    const dates = getSheetRecoveryDates({
      startDate: sheetRecoveryStartDate,
      endDate: sheetRecoveryEndDate,
    });
    if (dates.length === 0) {
      setStatus({
        type: 'warning',
        title: 'ช่วงวันที่ไม่ถูกต้อง',
        message: 'เลือกวันที่เริ่มต้นและสิ้นสุดให้ถูกต้องก่อนกู้ข้อมูลเข้า Sheet',
      });
      return;
    }

    await recoverPendingSheetSyncs({
      showStatus: true,
      includeSynced: true,
      role: activeTab === 'packer' ? 'packer' : 'admin',
      dates,
    });
  }

  async function handleAddCourier() {
    if (!firebaseUser) {
      setStatus({ type: 'warning', title: 'ต้องเข้าสู่ระบบก่อน', message: 'เข้าสู่ระบบ Firebase ก่อนเพิ่มขนส่งใหม่' });
      return;
    }
    setAddingCourier(true);
    try {
      const courier = await addCourier({ name: newCourierName, user: firebaseUser });
      setSelectedCourier(courier);
      setNewCourierName('');
      setStatus({ type: 'success', title: 'เพิ่มขนส่งแล้ว', message: `${courier} ใช้ได้ทั้งหน้าแพ็กและรับเข้า Drive` });
    } catch (error) {
      setStatus({ type: 'error', title: 'เพิ่มขนส่งไม่สำเร็จ', message: userErrorMessage(error, 'เพิ่มขนส่งไม่สำเร็จ กรุณาลองใหม่') });
    } finally {
      setAddingCourier(false);
    }
  }

  async function saveScannedCode(rawCode, source = 'manual', context = null) {
    const scanCourier = context?.courier ?? selectedCourier;
    const scanPacker = context?.packer ?? selectedPacker;
    const scanNote = context?.remark ?? scanRemark;
    const scanAllowsAnyFormat = context?.allowAnyTrackingFormat ?? allowAnyTrackingFormat;
    const managesBusy = source !== 'queue';
    if (!isSignedIn) {
      setStatus({
        type: 'warning',
        title: 'ต้องเข้าสู่ระบบก่อน',
        message: 'กด Login with Google เพื่อบันทึกเข้า Google Sheet จริง',
      });
      playTone('error');
      return { status: 'error' };
    }

    if (!getScanIssueMeta(scanNote).isIssue && scanPacker === PACKER_UNASSIGNED) {
      setStatus({
        type: 'warning',
        title: 'เลือก Packer ก่อนสแกน',
        message: 'ต้องเลือกชื่อผู้แพ็คก่อนบันทึกออเดอร์ปกติ',
      });
      showCameraMessage('เลือก Packer ก่อนสแกน', 'error');
      playTone('error');
      return { status: 'error' };
    }

    const validation = validateScanCode(scanCourier, rawCode, {
      allowAnyFormat: (source === 'manual' || source === 'queue') && scanAllowsAnyFormat,
    });
    if (!validation.ok) {
      const isEmpty = !validation.code;
      setStatus({
        type: isEmpty ? 'warning' : 'ignored',
        title: isEmpty ? 'ยังไม่มีเลขสแกน' : 'ไม่ใช่บาร์โค้ดหลัก',
        message: validation.reason,
      });
      showCameraMessage(validation.reason, isEmpty ? 'error' : 'ignored');
      playTone(isEmpty ? 'error' : 'ignored');
      return { status: isEmpty ? 'error' : 'ignored', code: validation.code };
    }

    if (source === 'manual') {
      setScanValue('');
    }

    // Prevent only a true duplicate Packer scan. An Admin-only row must still
    // reach the backend so the Packer fields can be merged into that row.
    if (!getScanIssueMeta(scanNote).isIssue) {
      const alreadyInPacker = shouldBlockPackerScan(recentRows, validation.code);
      if (alreadyInPacker) {
        setStatus({
          type: 'duplicate',
          title: 'เลขซ้ำ — ลงแล้ว',
          message: getPackerDuplicateMessage(validation.code),
        });
        showCameraMessage(`ลงแล้ว: ${validation.code}`, 'duplicate');
        playTone('duplicate');
        return { status: 'duplicate', code: validation.code };
      }
    }

    if (managesBusy) setBusy(true);
    try {
      const nowParts = getBangkokParts();
      const firestoreUser = canUseFirestorePrimary() ? await getFirebaseUserForPrimary() : null;
      const firestorePrimary = firestoreUser
        ? await recordPackerScanPrimary({
            code: validation.code,
            courier: scanCourier,
            date: nowParts.date,
            time: nowParts.time,
            user: firestoreUser,
            packer: scanPacker === PACKER_UNASSIGNED ? '' : scanPacker,
            note: scanNote,
          })
        : null;

      if (firestorePrimary?.status === 'duplicate') {
        const syncPending = firestorePrimary.sheetSyncStatus === 'pending';
        const duplicateResult = {
          status: 'duplicate',
          courier: scanCourier,
          date: nowParts.date,
          time: nowParts.time,
          code: validation.code,
          count: selectedCount,
          rows: recentRows,
          sheetUrl,
        };
        setStatus({
          type: 'duplicate',
          title: syncPending ? 'กำลังซิงก์ Google Sheet' : 'เลขซ้ำ',
          message: syncPending
            ? `${validation.code} บันทึกใน Firebase แล้ว และกำลังซิงก์ Google Sheet อยู่`
            : `${validation.code} มีอยู่แล้วใน Firebase สำหรับ ${scanCourier}`,
        });
        showCameraMessage(syncPending ? `${validation.code} กำลังซิงก์ Sheet` : `เลขซ้ำ: ${validation.code}`, 'duplicate');
        playTone('duplicate');
        if (source !== 'queue') setScanRemark('');
        return duplicateResult;
      }

      const packerName = scanPacker === PACKER_UNASSIGNED ? '' : scanPacker;
      const scanUser = firebaseUser ?? user;
      const scanEmail = user.email;
      // Sheet owns Marketplace metadata. Keep this network lookup off the Firestore-first
      // confirmation path so a cold Sheet cache cannot delay scanner feedback.
      const marketplaceOrderPromise = findMarketplaceOrderForScan(validation.code).catch(() => null);
      let result;

      if (firestorePrimary?.id) {
        const issueMeta = getScanIssueMeta(scanNote);
        const rowStatus = issueMeta.isIssue
          ? issueMeta.sheetStatus
          : scanNote === ISSUE_DAMAGED
            ? 'Damaged'
            : 'Success';
        const optimisticRow = {
          no: firestorePrimary.id,
          courierNo: '',
          date: nowParts.date,
          time: nowParts.time,
          courier: scanCourier,
          code: validation.code,
          email: scanEmail,
          packer: packerName,
          status: rowStatus,
          note: scanNote,
          sheetSyncStatus: 'pending',
        };
        result = {
          status: issueMeta.resultStatus,
          courier: scanCourier,
          date: nowParts.date,
          time: nowParts.time,
          code: validation.code,
          count: selectedCount + 1,
          rows: [optimisticRow, ...recentRows].slice(0, 50),
          sheetUrl,
          sheetSyncStatus: 'pending',
        };

        runAfterScanCommit(async () => {
          let backgroundResult = result;
          try {
            await markSheetSyncWriting({
              orderId: firestorePrimary.id,
              attemptId: firestorePrimary.sheetSyncAttemptId,
            }).catch(() => false);
            const marketplaceOrder = await marketplaceOrderPromise;
            // If admin scanned first, include admin K-M data so Sheet row gets admin columns
            const adminData = firestorePrimary?.admin?.scannedAt
              ? {
                  adminDate: firestorePrimary.adminDate || firestorePrimary.admin.scannedAt?.split('T')?.[0] || nowParts.date,
                  adminTime: firestorePrimary.adminTime || firestorePrimary.admin.scannedAt?.split('T')?.[1]?.substring?.(0, 8) || nowParts.time,
                  adminCode: firestorePrimary.adminCode || firestorePrimary.code || validation.code,
                }
              : {};
            const sheetResult = await runWithGoogleRetry((accessToken, googleConfig) =>
              appendScanGoogle({
                token: accessToken,
                config: googleConfig,
                courier: scanCourier,
                code: validation.code,
                email: scanEmail,
                packer: packerName,
                note: scanNote,
                marketplaceOrder,
                ...adminData,
              }),
            { sheetWrite: true });
            if (!isSheetSyncResultConfirmed(sheetResult)) {
              // This is the Packer commit path; the guard used to name the Admin row.
              throw new Error('Google Sheet แจ้งว่าซ้ำ แต่ยืนยันแถว Packer ไม่ได้');
            }
            await markSheetSyncResult({ orderId: firestorePrimary.id, attemptId: firestorePrimary.sheetSyncAttemptId, ok: true, result: sheetResult }).catch(() => {});
            backgroundResult = { ...result, ...sheetResult, sheetSyncStatus: 'verified' };
          } catch (sheetError) {
            await markSheetSyncResult({ orderId: firestorePrimary.id, attemptId: firestorePrimary.sheetSyncAttemptId, ok: false, error: sheetError }).catch(() => {});
            setStatus({
              type: 'warning',
              title: 'บันทึก Firestore แล้ว แต่ Sheet ยังไม่สำเร็จ',
              message: `${validation.code} ถูกเก็บไว้ในคิวกู้คืนอัตโนมัติ: ${userErrorMessage(sheetError, 'ซิงก์ Google Sheet ไม่สำเร็จ กรุณารอระบบลองใหม่')}`,
            });
            showCameraMessage(`${validation.code} รอซิงก์ Sheet`, 'warning');
            backgroundResult = {
              ...result,
              sheetSyncStatus: 'failed',
              sheetSyncError: userErrorMessage(sheetError, 'ซิงก์ Google Sheet ไม่สำเร็จ'),
            };
          }

          await mirrorScanToFirestore({
            type: 'packer',
            result: backgroundResult,
            courier: scanCourier,
            user: scanUser,
            packer: packerName,
            note: scanNote,
          }).catch(() => {});
          scheduleCountRefresh();
        });
      } else {
        try {
          const marketplaceOrder = await marketplaceOrderPromise;
          result = await commitFallbackScan({
            appendToSheet: () => runWithGoogleRetry((accessToken, googleConfig) =>
              appendScanGoogle({
                token: accessToken,
                config: googleConfig,
                courier: scanCourier,
                code: validation.code,
                email: scanEmail,
                packer: packerName,
                note: scanNote,
                marketplaceOrder,
              }),
            { sheetWrite: true }),
            mirrorToFirestore: (sheetResult) => mirrorScanToFirestore({
              type: 'packer',
              result: sheetResult,
              courier: scanCourier,
              user: scanUser,
              packer: packerName,
              note: scanNote,
            }),
          });
        } catch (sheetError) {
          throw sheetError;
        }
      }

      if (source === 'camera') {
        setScanValue(result.code);
      }
      setToday({ date: result.date, time: result.time });
      setRecentRows(result.rows ?? []);

      if (result.status === 'success' && isSignedIn) {
        setScanFlash(true);
        setTimeout(() => setScanFlash(false), 600);
        setSummary((current) =>
          current.map((item) =>
            item.courier === scanCourier ? { ...item, count: item.count + 1 } : item,
          ),
        );
        if (packerName) {
          setPackerCounts((current) => {
            const existing = current.find((item) => item.packer === packerName);
            return existing
              ? current.map((item) => (item.packer === packerName ? { ...item, count: item.count + 1 } : item))
              : [...current, { packer: packerName, count: 1 }];
          });
        }
        scheduleCountRefresh();
      }

      if (result.status === 'firestore_unconfirmed') {
        setStatus({
          type: 'error',
          title: 'ยังยืนยัน Firestore ไม่สำเร็จ',
          message: result.message,
        });
        showCameraMessage(result.message, 'error');
        playTone('error');
      } else if (result.status === 'cancelled') {
        setStatus({
          type: 'success',
          title: 'บันทึกยกเลิกแล้ว',
          message: `${result.code} ถูกทำเครื่องหมาย ${ISSUE_CUSTOMER_CANCELLED} ใน ${scanCourier}`,
        });
        showCameraMessage(`${result.code} ยกเลิกแล้ว`, 'success');
        playTone('success');
        if (source !== 'queue') setScanRemark('');
      } else if (result.status === 'returned') {
        setStatus({
          type: 'success',
          title: 'บันทึกสินค้าตีกลับแล้ว',
          message: `${result.code} ถูกทำเครื่องหมาย ${ISSUE_RETURNED} ใน ${scanCourier}`,
        });
        showCameraMessage(`${result.code} ตีกลับแล้ว`, 'success');
        playTone('success');
        if (source !== 'queue') setScanRemark('');
      } else if (result.status === 'duplicate') {
        setStatus({
          type: 'duplicate',
          title: 'เลขซ้ำ',
          message: `${result.code} มีอยู่แล้วใน ${scanCourier} วันที่ ${result.date}`,
        });
        showCameraMessage(`เลขซ้ำ: ${result.code}`, 'duplicate');
        playTone('duplicate');
        if (source !== 'queue') setScanRemark('');
      } else {
        const mergedNote = result.merged ? ' (จับคู่กับ Admin ที่ลง Drive ไว้)' : '';
        setStatus({
          type: 'success',
          title: 'สแกนสำเร็จ' + mergedNote,
          message: `${result.code} ถูกบันทึกเข้า ${scanCourier} โดย ${scanPacker} วันที่ ${result.date}${scanNote ? ` (${scanNote})` : ''}`,
        });
        showCameraMessage(`${result.code} บันทึกสำเร็จ`, 'success');
        playTone('success');
        if (source !== 'queue') setScanRemark('');
      }
      if (!firestorePrimary?.id) {
        await refreshSelectedCourierRows().catch(() => {});
      }
      return { ...result, status: result.status };
    } catch (error) {
      const message = scanErrorMessage(error);
      setStatus({
        type: 'error',
        title: 'บันทึกไม่สำเร็จ',
        message,
      });
      showCameraMessage(message, 'error');
      playTone('error');
      return { status: 'error', message };
    } finally {
      if (managesBusy) setBusy(false);
      if (source === 'camera') cameraSavingRef.current = false;
      if (source !== 'queue') window.setTimeout(() => focusScanInput(), 30);
    }
  }

  async function saveAdminScannedCode(rawCode, source = 'manual', context = null) {
    const scanCourier = context?.courier ?? selectedCourier;
    const scanAllowsAnyFormat = context?.allowAnyTrackingFormat ?? allowAnyTrackingFormat;
    const managesBusy = source !== 'queue';
    if (!isSignedIn) {
      setStatus({
        type: 'warning',
        title: 'ต้องเข้าสู่ระบบก่อน',
        message: 'กด Login with Google เพื่อบันทึกเข้า Google Sheet จริง',
      });
      playTone('error');
      return { status: 'error' };
    }

    const validation = validateScanCode(scanCourier, rawCode, {
      allowAnyFormat: (source === 'manual' || source === 'queue') && scanAllowsAnyFormat,
    });
    if (!validation.ok) {
      const isEmpty = !validation.code;
      setStatus({
        type: isEmpty ? 'warning' : 'ignored',
        title: isEmpty ? 'ยังไม่มีเลขสแกน' : 'ไม่ใช่บาร์โค้ดหลัก',
        message: validation.reason,
      });
      showCameraMessage(validation.reason, isEmpty ? 'error' : 'ignored');
      playTone(isEmpty ? 'error' : 'ignored');
      return { status: isEmpty ? 'error' : 'ignored', code: validation.code };
    }

    if (source === 'manual') {
      setScanValue('');
    }

    if (managesBusy) setBusy(true);
    try {
      const nowParts = getBangkokParts();
      const firestoreUser = canUseFirestorePrimary() ? await getFirebaseUserForPrimary() : null;
      const firestorePrimary = firestoreUser
        ? await recordAdminScanPrimary({
            code: validation.code,
            courier: scanCourier,
            date: nowParts.date,
            time: nowParts.time,
            user: firestoreUser,
          })
        : null;

      if (firestorePrimary?.status === 'duplicate') {
        const order = firestorePrimary;
        
        // If already synced to Sheet → genuine duplicate
        if (isSheetSyncVerified(order)) {
          setStatus({
            type: 'duplicate',
            title: 'เลขซ้ำใน Firebase',
            message: `${validation.code} เคยลง Drive สำหรับ ${scanCourier} แล้ว`,
          });
          showCameraMessage(`ลงแล้ว: ${validation.code}`, 'duplicate');
          playTone('duplicate');
          return {
            status: 'duplicate',
            courier: scanCourier,
            date: nowParts.date,
            time: nowParts.time,
            code: validation.code,
            rows: driveRecentRows,
            sheetUrl,
          };
        }
        
        // Still syncing → prevent double-scan
        if (order.sheetSyncStatus === 'pending') {
          setStatus({
            type: 'duplicate',
            title: 'กำลังซิงก์ Google Sheet',
            message: `${validation.code} บันทึกใน Firebase แล้ว และกำลังซิงก์ Google Sheet อยู่`,
          });
          showCameraMessage(`${validation.code} กำลังซิงก์ Sheet`, 'duplicate');
          playTone('duplicate');
          return {
            status: 'duplicate',
            courier: scanCourier,
            date: nowParts.date,
            time: nowParts.time,
            code: validation.code,
            rows: driveRecentRows,
            sheetUrl,
          };
        }
        
        // Failed → reclaim: write to Sheet with admin data from Firestore
        const adminReclaim = {
          adminDate: order.admin?.date || order.date || nowParts.date,
          adminTime: order.admin?.time || nowParts.time,
          adminCode: order.adminCode || order.code || validation.code,
        };
        
        // Build rows and continue below (fall through to normal admin scan flow)
        const reclaimRow = {
          no: order.id,
          date: nowParts.date,
          time: nowParts.time,
          courier: scanCourier,
          code: '',
          adminCode: adminReclaim.adminCode,
          adminDate: adminReclaim.adminDate,
          adminTime: adminReclaim.adminTime,
          email: user.email,
          status: order.status === 'matched' ? 'Success' : 'Pending',
          sheetSyncStatus: 'pending',
        };
        
        setScanFlash(true);
        setTimeout(() => setScanFlash(false), 600);
        setStatus({
          type: 'success',
          title: 'ลง Drive สำเร็จ (กู้คืน)',
          message: `${validation.code} เคยลง Drive แล้ว แต่ Sheet ยังไม่สมบูรณ์ กำลังเขียน Sheet ใหม่`,
        });
        showCameraMessage(`${validation.code} ลง Drive สำเร็จ`, 'success');
        playTone('success');
        setDriveRecentRows([reclaimRow, ...driveRecentRows].slice(0, 50));
        setDriveTotalCount((prev) => prev + 1);
        setToday({ date: nowParts.date, time: nowParts.time });
        if (source === 'camera') setScanValue(validation.code);
        
        // Background: re-sync to Sheet via appendAdminScanGoogle
        runAfterScanCommit(async () => {
          try {
            await markSheetSyncWriting({
              orderId: order.id,
              attemptId: order.sheetSyncAttemptId || '',
            }).catch(() => false);
            const marketplaceOrder = await findMarketplaceOrderForScan(validation.code).catch(() => null);
            const sheetResult = await runWithGoogleRetry((accessToken, googleConfig) =>
              appendAdminScanGoogle({
                token: accessToken,
                config: googleConfig,
                courier: scanCourier,
                code: adminReclaim.adminCode,
                email: user.email,
                marketplaceOrder,
              }),
            { sheetWrite: true });
            // This branch runs precisely because the Sheet row was incomplete, and
            // appendAdminScanGoogle can return 'duplicate' without writing anything. Marking
            // it synced unconditionally would drop the order from the recovery queue while
            // the row stayed broken, so require the same confirmation every other site does.
            if (!isSheetSyncResultConfirmed(sheetResult)) {
              throw new Error('Google Sheet แจ้งว่าซ้ำ แต่ยืนยันแถว Admin ไม่ได้');
            }
            await markSheetSyncResult({
              orderId: order.id,
              // A fabricated attempt id can never equal the stored one, and
              // markSheetSyncResult silently no-ops on a mismatch. Empty skips the check.
              attemptId: order.sheetSyncAttemptId || '',
              ok: true,
              result: sheetResult,
            }).catch(() => {});
          } catch (sheetError) {
            await markSheetSyncResult({
              orderId: order.id,
              attemptId: order.sheetSyncAttemptId || '',
              ok: false,
              error: sheetError,
            }).catch(() => {});
            setStatus({
              type: 'warning',
              title: 'บันทึก Firestore แล้ว แต่ Sheet ยังไม่สำเร็จ',
              message: `${validation.code} ถูกเก็บไว้ในคิวกู้คืนอัตโนมัติ: ${userErrorMessage(sheetError, 'ซิงก์ Google Sheet ไม่สำเร็จ กรุณารอระบบลองใหม่')}`,
            });
            showCameraMessage(`${validation.code} รอซิงก์ Sheet`, 'warning');
          }
          scheduleCountRefresh();
        });
        
        return {
          status: 'admin_scan',
          courier: scanCourier,
          date: nowParts.date,
          time: nowParts.time,
          code: validation.code,
          rows: [reclaimRow, ...driveRecentRows].slice(0, 50),
          sheetUrl,
        };
      }

      const scanUser = firebaseUser ?? user;
      const scanEmail = user.email;
      // See Packer flow: the Marketplace lookup is only needed by the background Sheet write.
      const marketplaceOrderPromise = findMarketplaceOrderForScan(validation.code).catch(() => null);
      let result;

      if (firestorePrimary?.id) {
        const optimisticRow = {
          no: firestorePrimary.id,
          date: nowParts.date,
          time: nowParts.time,
          courier: scanCourier,
          code: '',
          adminCode: validation.code,
          adminDate: nowParts.date,
          adminTime: nowParts.time,
          email: scanEmail,
          status: firestorePrimary.status === 'matched' ? 'Success' : 'Pending',
          sheetSyncStatus: 'pending',
        };
        result = {
          status: firestorePrimary.status === 'matched' ? 'admin_matched' : 'admin_scan',
          courier: scanCourier,
          date: nowParts.date,
          time: nowParts.time,
          code: validation.code,
          rows: [optimisticRow, ...driveRecentRows].slice(0, 50),
          sheetUrl,
          sheetSyncStatus: 'pending',
        };

        runAfterScanCommit(async () => {
          let backgroundResult = result;
          try {
            await markSheetSyncWriting({
              orderId: firestorePrimary.id,
              attemptId: firestorePrimary.sheetSyncAttemptId,
            }).catch(() => false);
            const marketplaceOrder = await marketplaceOrderPromise;
            const adminScanTiming = getAdminScanTiming(
              firestorePrimary?.existing ?? firestorePrimary,
              { fallbackDate: nowParts.date, fallbackTime: nowParts.time },
            );
            const existingPackerScan = firestorePrimary?.existing?.packerScan;
            const hasPackerScan = Boolean(existingPackerScan?.scannedAt);
            const sheetResult = await runWithGoogleRetry((accessToken, googleConfig) =>
              hasPackerScan
                ? appendScanGoogle({
                    token: accessToken,
                    config: googleConfig,
                    courier: scanCourier,
                    code: validation.code,
                    email: existingPackerScan.scannedBy?.email || scanEmail,
                    packer: existingPackerScan.packer || firestorePrimary?.existing?.packer || '',
                    note: existingPackerScan.note || firestorePrimary?.existing?.note || '',
                    marketplaceOrder,
                    scanDate: adminScanTiming.sheetDate,
                    scanTime: adminScanTiming.sheetTime,
                    adminDate: adminScanTiming.adminDate,
                    adminTime: adminScanTiming.adminTime,
                    adminCode: firestorePrimary?.existing?.code || validation.code,
                  })
                : appendAdminScanGoogle({
                    token: accessToken,
                    config: googleConfig,
                    courier: scanCourier,
                    code: validation.code,
                    email: scanEmail,
                    marketplaceOrder,
                    scanDate: adminScanTiming.sheetDate,
                    scanTime: adminScanTiming.sheetTime,
                    adminDate: adminScanTiming.adminDate,
                    adminTime: adminScanTiming.adminTime,
                    adminCode: firestorePrimary?.existing?.code || validation.code,
                  }),
            { sheetWrite: true });
            if (!isSheetSyncResultConfirmed(sheetResult)) {
              // Name the row that was actually attempted: this path writes the Packer row
              // only when a Packer scan already exists, otherwise it writes the Admin row.
              throw new Error(`Google Sheet แจ้งว่าซ้ำ แต่ยืนยันแถว ${hasPackerScan ? 'Packer' : 'Admin'} ไม่ได้`);
            }
            await markSheetSyncResult({ orderId: firestorePrimary.id, attemptId: firestorePrimary.sheetSyncAttemptId, ok: true, result: sheetResult }).catch(() => {});
            backgroundResult = { ...result, ...sheetResult, sheetSyncStatus: 'verified' };
          } catch (sheetError) {
            await markSheetSyncResult({ orderId: firestorePrimary.id, attemptId: firestorePrimary.sheetSyncAttemptId, ok: false, error: sheetError }).catch(() => {});
            backgroundResult = {
              ...result,
              sheetSyncStatus: 'failed',
              sheetSyncError: userErrorMessage(sheetError, 'ซิงก์ Google Sheet ไม่สำเร็จ'),
            };
          }

          await mirrorScanToFirestore({
            type: 'admin',
            result: backgroundResult,
            courier: scanCourier,
            user: scanUser,
          }).catch(() => {});
          scheduleCountRefresh();
        });
      } else {
        try {
          const marketplaceOrder = await marketplaceOrderPromise;
          result = await commitFallbackScan({
            appendToSheet: () => runWithGoogleRetry((accessToken, googleConfig) =>
              appendAdminScanGoogle({
                token: accessToken,
                config: googleConfig,
                courier: scanCourier,
                code: validation.code,
                email: scanEmail,
                marketplaceOrder,
              }),
            { sheetWrite: true }),
            mirrorToFirestore: (sheetResult) => mirrorScanToFirestore({
              type: 'admin',
              result: sheetResult,
              courier: scanCourier,
              user: scanUser,
            }),
          });
        } catch (sheetError) {
          throw sheetError;
        }
      }

      if (source === 'camera') {
        setScanValue(result.code);
      }
      setToday({ date: result.date, time: result.time });
      setDriveRecentRows(result.rows ?? []);
      // `result.rows` is a display window capped at 50, not the day's total. Adopting its
      // length made the counter fall back to 50 on the 51st scan of the day. Count the new
      // row instead; the fallback path below re-reads the authoritative total anyway.
      if (result.status === 'admin_scan' || result.status === 'admin_matched') {
        setDriveTotalCount((previous) => previous + 1);
      }

      if (result.status === 'firestore_unconfirmed') {
        setStatus({
          type: 'error',
          title: 'ยังยืนยัน Firestore ไม่สำเร็จ',
          message: result.message,
        });
        showCameraMessage(result.message, 'error');
        playTone('error');
      } else if (result.status === 'admin_scan' && result.sheetSyncStatus === 'pending') {
        setStatus({
          type: 'success',
          title: 'บันทึก Firebase แล้ว กำลังลง Sheet',
          message: `${result.code} บันทึกแล้ว กรุณารอการซิงก์ Google Sheet`,
        });
        showCameraMessage(`${result.code} กำลังลง Sheet`, 'success');
        playTone('success');
      } else if (result.status === 'admin_scan') {
        setScanFlash(true);
        setTimeout(() => setScanFlash(false), 600);
        setStatus({
          type: 'success',
          title: 'ลง Drive สำเร็จ',
          message: `${result.code} ลง Drive ใน ${scanCourier} วันที่ ${result.date} รอ Packer สแกนส่ง`,
        });
        showCameraMessage(`${result.code} ลง Drive สำเร็จ`, 'success');
        playTone('success');
      } else if (result.status === 'admin_matched') {
        setScanFlash(true);
        setTimeout(() => setScanFlash(false), 600);
        setStatus({
          type: 'success',
          title: 'ลง Drive สำเร็จ (Packer สแกนแล้ว)',
          message: `${result.code} ถูกลง Drive และมี Packer สแกนส่งแล้ว`,
        });
        showCameraMessage(`${result.code} Packer สแกนแล้ว`, 'success');
        playTone('success');
      } else if (result.status === 'duplicate') {
        setStatus({
          type: 'duplicate',
          title: 'เลขซ้ำใน Drive',
          message: `${result.code} เคยลง Drive สำหรับ ${scanCourier} วันที่ ${result.date} แล้ว`,
        });
        showCameraMessage(`ลงแล้ว: ${result.code}`, 'duplicate');
        playTone('duplicate');
      }

      // Trigger auto-check after admin scan
      setTimeout(() => runAutoCheck(), 2000);

      if (!firestorePrimary?.id) {
        await refreshDriveRows().catch(() => {});
      }

      return { ...result, status: result.status };
    } catch (error) {
      const message = scanErrorMessage(error);
      setStatus({
        type: 'error',
        title: 'ลง Drive ไม่สำเร็จ',
        message,
      });
      showCameraMessage(message, 'error');
      playTone('error');
      return { status: 'error', message };
    } finally {
      if (managesBusy) setBusy(false);
      if (source === 'camera') cameraSavingRef.current = false;
      if (source !== 'queue') window.setTimeout(() => focusScanInput(), 30);
    }
  }

  function focusScanInput({ force = false } = {}) {
    const input = inputRef.current;
    if (!input || input.disabled || scanMethod !== 'manual') return;
    const activeElement = document.activeElement;
    const canFocus = force
      || !activeElement
      || activeElement === document.body
      || activeElement === input
      || activeElement?.type === 'submit';
    if (canFocus) input.focus({ preventScroll: true });
  }

  function switchTab(nextTab) {
    setActiveTab(nextTab);
    setScanPopupOpen(false);
    void stopCamera();
  }

  function handleScanSubmit(event) {
    event.preventDefault();
    const code = String(scanValue ?? '').trim();
    if (inputRef.current) inputRef.current.value = '';
    setScanValue('');
    window.requestAnimationFrame(() => focusScanInput({ force: true }));

    if (!code) {
      setStatus({ type: 'warning', title: 'ยังไม่มีเลขสแกน', message: 'ยิงบาร์โค้ดแล้วกด Enter อีกครั้ง' });
      playTone('error');
      return;
    }

    const context = {
      activeTab,
      courier: selectedCourier,
      packer: selectedPacker,
      remark: scanRemark,
      allowAnyTrackingFormat,
    };
    const queued = scanQueueRef.current?.enqueue({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      code,
      context,
    });

    if (!queued?.accepted) {
      const isFull = queued?.reason === 'queue_full';
      setStatus({
        type: isFull ? 'warning' : 'duplicate',
        title: isFull ? 'คิวสแกนเต็ม' : 'เลขนี้อยู่ในคิวแล้ว',
        message: isFull
          ? 'มีรายการรอบันทึกครบ 100 รายการ กรุณารอให้คิวลดลงก่อนยิงต่อ'
          : `${code} กำลังรอบันทึกหรือกำลังบันทึกอยู่`,
      });
      playTone(isFull ? 'error' : 'duplicate');
      return;
    }

    if (scanRemark) setScanRemark('');
  }

  function handleBarcodeKeyDown(event) {
    const character = barcodeCharacterFromKeyEvent(event);
    if (character === null) return;

    // Keyboard-wedge scanners emit the active OS layout in `key` (Thai characters when
    // Windows is set to Thai), while `code` keeps the physical US-key position.
    event.preventDefault();
    setScanValue((current) => `${current}${character}`);
  }

  async function stopCamera() {
    const scanner = cameraRef.current;
    cameraRef.current = null;
    cameraSavingRef.current = false;
    lastCameraScanRef.current = { code: '', time: 0 };

    if (scanner) {
      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
        await scanner.clear();
      } catch {
      }
    }

    setCameraActive(false);
  }

  async function handleCameraDetected(decodedText) {
    const code = String(decodedText ?? '').trim();
    if (!code || cameraSavingRef.current) {
      return;
    }

    const now = Date.now();
    const lastScan = lastCameraScanRef.current;
    if (lastScan.code === code && now - lastScan.time < CAMERA_COOLDOWN_MS) {
      return;
    }

    lastCameraScanRef.current = { code, time: now };
    cameraSavingRef.current = true;
    showCameraMessage(`อ่านได้: ${code}`, 'idle');

    if (activeTab === 'drive') {
      await saveAdminScannedCode(code, 'camera');
    } else {
      await saveScannedCode(code, 'camera');
    }
  }

  function startCameraPopup() {
    return startCamera(CAMERA_POPUP_ID);
  }

  async function startCamera(regionId = CAMERA_REGION_ID) {
    if (!isSignedIn) {
      setStatus({
        type: 'warning',
        title: 'ต้องเข้าสู่ระบบก่อน',
        message: 'Login with Google ก่อนเปิดกล้องสแกน',
      });
      playTone('error');
      return;
    }

    if (cameraActive || cameraRef.current) {
      return;
    }

    try {
      showCameraMessage('กำลังเปิดกล้อง...', 'idle');
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await loadHtml5Qrcode();
      const scanner = new Html5Qrcode(regionId, {
        useBarCodeDetectorIfSupported: true,
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.CODE_93,
          Html5QrcodeSupportedFormats.ITF,
        ],
        verbose: false,
      });
      cameraRef.current = scanner;

      const scanConfig = {
        fps: CAMERA_SCAN_FPS,
        qrbox: (viewfinderWidth, viewfinderHeight) => ({
          width: Math.floor(Math.min(viewfinderWidth * 0.92, 680)),
          height: Math.floor(Math.min(viewfinderHeight * 0.72, 360)),
        }),
        disableFlip: true,
      };

      await scanner.start({ facingMode: 'environment' }, scanConfig, handleCameraDetected, () => {});

      await improveCameraFocus(scanner);
      setCameraActive(true);
      showCameraMessage('เล็ง QR หรือบาร์โค้ดหลักให้อยู่ในกรอบใหญ่ ถอยห่างเล็กน้อยให้เห็นโค้ดครบทั้งแถบ', 'idle');
    } catch (error) {
      cameraRef.current = null;
      setCameraActive(false);
      const message = userErrorMessage(error, 'เปิดกล้องไม่สำเร็จ กรุณาตรวจสอบสิทธิ์กล้อง');
      showCameraMessage(message, 'error');
      setStatus({
        type: 'error',
        title: 'เปิดกล้องไม่สำเร็จ',
        message,
      });
      playTone('error');
    }
  }

  async function improveCameraFocus(scanner) {
    try {
      const capabilities = scanner.getRunningTrackCapabilities?.() ?? {};
      const constraints = {};

      if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
        constraints.focusMode = 'continuous';
      }

      if (Object.keys(constraints).length > 0) {
        await scanner.applyVideoConstraints(constraints);
      }
    } catch {
    }
  }

  async function handleCheckMissingOrders() {
    if (!isSignedIn) {
      setStatus({
        type: 'warning',
        title: 'ต้องเข้าสู่ระบบก่อน',
        message: 'Login with Google ก่อนตรวจสอบออเดอร์ตกหล่น',
      });
      return;
    }

    setMissingBusy(true);
    try {
      const results = canUseFirestorePrimary()
        ? await checkMissingOrdersFirestore({
            courier: null,
            hoursLookback: DEFAULT_LOOKBACK_HOURS,
            thresholdMinutes,
          })
        : await runWithGoogleRetry((accessToken, googleConfig) =>
            checkMissingOrders({
              token: accessToken,
              config: googleConfig,
              courier: null,
              hoursLookback: DEFAULT_LOOKBACK_HOURS,
              thresholdMinutes,
            }),
          );

      setMissingResults(results);
      setMissingAlertBadge(results.pending?.length ?? 0);
      setMissingCheckCache(results);

      const pendingCount = results.pending?.length ?? 0;
      if (pendingCount > 0) {
        setStatus({
          type: 'warning',
          title: 'ตรวจสอบเสร็จสิ้น',
          message: `พบ ${pendingCount} ออเดอร์เสี่ยงตกหล่น จากทั้งหมด ${results.totalAdminScans} รายการที่ลง Drive`,
        });
        playTone('alert');
      } else {
        setStatus({
          type: 'success',
          title: 'ตรวจสอบเสร็จสิ้น',
          message: `ไม่พบออเดอร์ตกหล่น จากทั้งหมด ${results.totalAdminScans} รายการที่ลง Drive`,
        });
      }
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'ตรวจสอบไม่สำเร็จ',
        message: userErrorMessage(error, 'ตรวจสอบออเดอร์ตกหล่นไม่สำเร็จ กรุณาลองใหม่'),
      });
    } finally {
      setMissingBusy(false);
    }
  }

  async function copyMissingReport() {
    if (!missingResults) {
      return;
    }

    const text = buildMissingAlertMessage(missingResults);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        setStatus({
          type: 'error',
          title: 'คัดลอกไม่สำเร็จ',
          message: 'เบราว์เซอร์ไม่อนุญาตให้เข้าถึง Clipboard ลองกดคัดลอกใหม่อีกครั้ง',
        });
        playTone('error');
        return;
      }
    }
    setStatus({
      type: 'success',
      title: 'คัดลอกรายงานแล้ว',
      message: 'นำไปวางใน Gmail, LINE หรือช่องทางที่ต้องการได้เลย',
    });
    playTone('success');
  }

  async function copyCompactSummary() {
    if (!missingResults) {
      return;
    }

    const text = buildCompactSummary(missingResults);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        return;
      }
    }
    setStatus({
      type: 'success',
      title: 'คัดลอกสรุปแล้ว',
      message: 'นำไปวางใน Gmail, LINE หรือช่องทางที่ต้องการได้เลย',
    });
    playTone('success');
  }

  async function handleSearchSubmit(event) {
    event.preventDefault();

    if (!isSignedIn) {
      setStatus({
        type: 'warning',
        title: 'ต้องเข้าสู่ระบบก่อน',
        message: 'Login with Google ก่อนค้นหาเลขพัสดุจาก Google Sheet',
      });
      return;
    }

    const query = searchValue.trim();
    if (!query) {
      setStatus({
        type: 'warning',
        title: 'กรอกเลขที่ต้องการค้นหา',
        message: 'พิมพ์เลขพัสดุหรือบางส่วนของเลขก่อนกดค้นหา',
      });
      return;
    }

    const dates = getSearchDates();
    if (searchMode !== 'all' && dates.length === 0) {
      setStatus({
        type: 'warning',
        title: 'ช่วงวันที่ไม่ถูกต้อง',
        message: 'เลือกวันที่เริ่มต้นและสิ้นสุดให้ถูกต้องก่อนค้นหา',
      });
      return;
    }

    setSearchBusy(true);
    try {
      const usesFirestore = canUseFirestorePrimary();
      const results = usesFirestore
        ? await searchScansFirestore({
            query,
            couriers: searchScope === 'all' ? couriers : [selectedCourier],
            dates: searchMode === 'all' ? null : dates,
          })
        : await runWithGoogleRetry((accessToken, googleConfig) =>
            searchScansGoogle({
              token: accessToken,
              config: googleConfig,
              query,
              couriers: searchScope === 'all' ? couriers : [selectedCourier],
              dates: searchMode === 'all' ? null : dates,
            }),
          );
      setSearchResults(results);
      setStatus({
        type: results.length > 0 ? 'success' : 'warning',
        title: results.length > 0 ? 'พบเลขพัสดุ' : 'ไม่พบเลขพัสดุ',
        message:
          results.length > 0
            // Name the source that was actually read: this said Google Sheet even when the
            // Firestore path served the search.
            ? `พบ ${results.length} รายการจาก ${usesFirestore ? 'Firebase' : 'Google Sheet'}`
            : `${query} ยังไม่พบในเงื่อนไขที่เลือก`,
      });
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'ค้นหาไม่สำเร็จ',
        message: userErrorMessage(error, 'ค้นหารายการไม่สำเร็จ กรุณาลองใหม่'),
      });
    } finally {
      setSearchBusy(false);
    }
  }

  async function markSearchResultDamaged(row) {
    if (!isSignedIn || !row) {
      return;
    }

    if (!window.confirm(`ยืนยันทำเครื่องหมาย "สินค้าเสียหาย" สำหรับ ${row.code}?`)) {
      return;
    }

    setSearchBusy(true);
    try {
      const updatedRow = await runWithGoogleRetry((accessToken, googleConfig) =>
        updateScanIssueGoogle({
          token: accessToken,
          config: googleConfig,
          row,
          issue: ISSUE_DAMAGED,
        }),
        { sheetWrite: true },
      );
      setSearchResults((current) =>
        current?.map((item) =>
          item.date === row.date && item.no === row.no && item.code === row.code ? { ...item, ...updatedRow } : item,
        ) ?? null,
      );
      if (updatedRow.date === today.date && updatedRow.courier === selectedCourier) {
        await refreshSelectedCourierRows();
      }
      setStatus({
        type: 'success',
        title: 'บันทึกสินค้าเสียหายแล้ว',
        message: `${updatedRow.code} ถูกบันทึกใน Remark / Issue`,
      });
      playTone('success');
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'บันทึกสินค้าเสียหายไม่สำเร็จ',
        message: userErrorMessage(error, 'บันทึกสินค้าเสียหายไม่สำเร็จ กรุณาลองใหม่'),
      });
      playTone('error');
    } finally {
      setSearchBusy(false);
    }
  }

  function getSearchDates() {
    if (searchMode === 'today') {
      return [today.date];
    }

    if (searchMode === 'range') {
      return listDatesBetween(searchStartDate, searchEndDate);
    }

    return [];
  }

  async function generateReport() {
    if (!isSignedIn) {
      setStatus({
        type: 'warning',
        title: 'ต้องเข้าสู่ระบบก่อน',
        message: 'Login with Google ก่อนดูรายงานจาก Google Sheet',
      });
      return;
    }

    const dates = getReportDates();
    if (dates.length === 0) {
      setStatus({
        type: 'warning',
        title: 'ช่วงวันที่ไม่ถูกต้อง',
        message: 'เลือกวันที่เริ่มต้นและสิ้นสุดให้ถูกต้องก่อนสร้างรายงาน',
      });
      return;
    }

    setReportBusy(true);
    try {
      const data = canUseFirestorePrimary()
        ? await getScanReportFirestore({ couriers, dates })
        : await runWithGoogleRetry((accessToken, googleConfig) =>
          getScanReportGoogle({ token: accessToken, config: googleConfig, dates, couriers }),
          );
      setReportData({
        ...data,
        mode: reportMode,
        label: getReportLabel(dates),
      });
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'สร้างรายงานไม่สำเร็จ',
        message: userErrorMessage(error, 'สร้างรายงานไม่สำเร็จ กรุณาลองใหม่'),
      });
    } finally {
      setReportBusy(false);
    }
  }

  async function backfillSelectedReportRange() {
    if (!isSignedIn || !token || !config) {
      setStatus({
        type: 'warning',
        title: 'ต้อง Login ก่อน',
        message: 'Login ให้ระบบเชื่อม Google Sheet ก่อนดึงข้อมูลย้อนหลังเข้า Firestore',
      });
      return;
    }

    const dates = getReportDates();
    if (dates.length === 0) {
      setStatus({
        type: 'warning',
        title: 'ช่วงวันที่ไม่ถูกต้อง',
        message: 'เลือกวันที่/เดือนที่ต้องการดึงข้อมูลย้อนหลังก่อน',
      });
      return;
    }

    setBackfillBusy(true);
    try {
      const rows = await runWithGoogleRetry((accessToken, googleConfig) =>
        getRowsForFirestoreBackfillGoogle({ token: accessToken, config: googleConfig, dates }),
      );
      const result = await backfillOrdersFromSheetRows({ rows, user: firebaseUser ?? user });
      await refreshAllCounts();
      if (activeTab === 'packer') {
        await refreshSelectedCourierRows();
      } else {
        await refreshDriveRows();
      }
      await generateReport();
      setStatus({
        type: result.failed > 0 ? 'warning' : 'success',
        title: 'ดึงข้อมูลย้อนหลังเข้า Firestore แล้ว',
        message: `นำเข้า ${result.imported} รายการ, ข้าม ${result.skipped}, ไม่สำเร็จ ${result.failed}`,
      });
    } catch (error) {
      setStatus({
        type: 'error',
        title: 'ดึงข้อมูลย้อนหลังไม่สำเร็จ',
        message: userErrorMessage(error, 'ดึงข้อมูลย้อนหลังไม่สำเร็จ กรุณาลองใหม่'),
      });
    } finally {
      setBackfillBusy(false);
    }
  }

  function getReportDates() {
    if (reportMode === 'daily') {
      return reportDate ? [reportDate] : [];
    }

    if (reportMode === 'range') {
      return listDatesBetween(reportStartDate, reportEndDate);
    }

    return listDatesInMonth(reportMonth);
  }

  function getReportLabel(dates) {
    if (reportMode === 'daily') {
      return reportDate;
    }

    if (reportMode === 'range') {
      return `${dates[0]} ถึง ${dates[dates.length - 1]}`;
    }

    return reportMonth;
  }

  function buildReportText(data = reportData) {
    if (!data) {
      return '';
    }

    const generatedAt = getBangkokParts();
    const modeLabel = data.mode === 'daily' ? 'รายวัน' : data.mode === 'range' ? 'ช่วงวันที่' : 'รายเดือน';
    const lines = [
      `รายงานสแกนพัสดุ (${modeLabel})`,
      `ช่วงรายงาน: ${data.label}`,
      `ยอดส่งจริง: ${data.total} รายการ`,
      `ยกเลิก: ${data.cancelledTotal ?? 0} รายการ`,
      `สินค้าตีกลับ: ${data.returnedTotal ?? 0} รายการ`,
      `สินค้าเสียหาย: ${data.damagedTotal ?? 0} รายการ`,
      '',
      'ยอดแยกตามขนส่ง',
      ...couriers.map((courier) => {
        const count = data.couriers?.find((item) => item.courier === courier)?.count ?? 0;
        return `${courier}: ${count} รายการ`;
      }),
    ];

    if (data.days?.length > 1) {
      lines.push('', 'สรุปตามวันที่');
      data.days.forEach((day) => {
        lines.push(`${day.date}: ${day.total} รายการ`);
      });
    }

    if (data.cancelledRows?.length > 0) {
      lines.push('', 'รายการยกเลิก');
      data.cancelledRows.forEach((row) => {
        lines.push(`${row.date} ${row.time} | ${row.courier} | ${row.code}`);
      });
    }

    if (data.returnedRows?.length > 0) {
      lines.push('', 'รายการสินค้าตีกลับ');
      data.returnedRows.forEach((row) => {
        lines.push(`${row.date} ${row.time} | ${row.courier} | ${row.code}`);
      });
    }

    if (data.damagedRows?.length > 0) {
      lines.push('', 'รายการสินค้าเสียหาย');
      data.damagedRows.forEach((row) => {
        lines.push(`${row.date} ${row.time} | ${row.courier} | ${row.code}`);
      });
    }

    lines.push('', `สร้างจากระบบ Scan to Sheet เวลา ${generatedAt.date} ${generatedAt.time}`);
    return lines.join('\n');
  }

  async function copyReport() {
    if (!reportData) {
      return;
    }

    const text = buildReportText(reportData);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } catch {
        setStatus({
          type: 'error',
          title: 'คัดลอกไม่สำเร็จ',
          message: 'เบราว์เซอร์ไม่อนุญาตให้เข้าถึง Clipboard ลองกดคัดลอกใหม่อีกครั้ง',
        });
        playTone('error');
        return;
      }
    }
    setStatus({
      type: 'success',
      title: 'คัดลอกรายงานแล้ว',
      message: 'นำไปวางใน Gmail, LINE หรือช่องทางที่ต้องการได้เลย',
    });
    playTone('success');
  }

  // --- Missing order check results UI ---
  const missingUISections = missingResults ? formatMissingResultsForUI(missingResults) : [];
  const dashboardSummary = missingResults ? buildDashboardSummary(missingResults) : null;

  return (
    <>
    <a className="skip-link" href="#main">ข้ามไปยังเนื้อหาหลัก</a>
    <main id="main" tabIndex={-1} className="app-shell enterprise-shell">
      <section className="topbar">
        <div className="app-title">
          <span className="title-badge">
            <ScanLine size={22} />
            <span className="brand-wordmark">HILLKOFF</span>
            <span className="title-product">Scan to Sheet</span>
          </span>
          <h1>สแกนใบปะหน้าเข้า Google Sheet</h1>
          <span className="title-accent" />
        </div>
        <div className="account-strip">
          <div className="account-pill">
            <Mail size={16} />
            <span>{user.email}</span>
          </div>
          <div className="top-connect-box">
            <div className="connect-title">
              <FileSpreadsheet size={18} />
              <span>{isSignedIn ? 'Firestore พร้อมใช้งาน' : 'Firebase ยังไม่เชื่อม'}</span>
            </div>
            {isSignedIn ? (
              <button className="ghost-button" type="button" onClick={signOut}>
                <LogOut size={16} />
                <span>ออกจากระบบ</span>
              </button>
            ) : (
              <button className="secondary-button" type="button" onClick={signInWithGoogle} disabled={busy || !isGoogleReady}>
                {busy ? <RefreshCw size={16} className="spin" /> : <LogIn size={16} />}
                <span>{isGoogleReady ? 'Login with Google' : 'รอใส่ OAuth Client ID'}</span>
              </button>
            )}
          </div>
          {sheetUrl && (
            <a className="ghost-button master-sheet-link" href={sheetUrl} target="_blank" rel="noreferrer">
              <FileSpreadsheet size={16} />
              <span>Master Sheet</span>
            </a>
          )}
          <div className="theme-toggle" aria-label="เลือกโหมดสี">
            <button
              className={theme === 'light' ? 'active' : ''}
              type="button"
              onClick={() => setTheme('light')}
              title="Light mode"
            >
              <Sun size={16} />
              <span>Light</span>
            </button>
            <button
              className={theme === 'dark' ? 'active' : ''}
              type="button"
              onClick={() => setTheme('dark')}
              title="Dark mode"
            >
              <Moon size={16} />
              <span>Dark</span>
            </button>
          </div>
          <button className="icon-button" type="button" onClick={() => setSoundEnabled((value) => !value)} title="เปิด/ปิดเสียง">
            <Volume2 size={18} />
          </button>
        </div>
      </section>

      {/* Tab Bar */}
      <nav className="tab-bar" aria-label="เลือกโหมดการทำงาน">
        <button
          data-testid="packer-tab"
          className={`tab-button ${activeTab === 'packer' ? 'active' : ''}`}
          type="button"
          aria-current={activeTab === 'packer' ? 'page' : undefined}
          onClick={() => switchTab('packer')}
        >
          <PackageCheck size={18} />
          <span>📦 แพ็กสินค้า (Packer)</span>
        </button>
        <button
          data-testid="drive-tab"
          className={`tab-button ${activeTab === 'drive' ? 'active' : ''}`}
          type="button"
          aria-current={activeTab === 'drive' ? 'page' : undefined}
          onClick={() => switchTab('drive')}
        >
          <Upload size={18} />
          <span>📥 รับเข้า Drive (Admin)</span>
          {missingAlertBadge > 0 && (
            <span className="tab-badge">{missingAlertBadge}</span>
          )}
        </button>
        <button
          data-testid="reports-tab"
          className={`tab-button ${activeTab === 'reports' ? 'active' : ''}`}
          type="button"
          aria-current={activeTab === 'reports' ? 'page' : undefined}
          onClick={() => switchTab('reports')}
        >
          <BarChart3 size={18} />
          <span>รายงาน</span>
        </button>
        <a
          data-testid="delivery-system-link"
          className="tab-button"
          href="https://repo-rho-livid.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Truck size={18} />
          <span>ระบบส่งของ</span>
        </a>
        <a
          data-testid="misdelivery-management-link"
          className="tab-button"
          href="https://script.google.com/a/macros/hillkoff.com/s/AKfycbxQENSgzP-0IzDX0J_pY2g9HoMlCKMaNQYJlnxPbudqELr79oKdwYpoNflqrSAfsgw2/exec"
          target="_blank"
          rel="noopener noreferrer"
        >
          <AlertTriangle size={18} />
          <span>จัดการส่งของผิด</span>
        </a>
        <button
          data-testid="staff-directory-tab"
          className={`tab-button ${activeTab === 'staff' ? 'active' : ''}`}
          type="button"
          aria-current={activeTab === 'staff' ? 'page' : undefined}
          onClick={() => switchTab('staff')}
        >
          <Users size={18} />
          <span>แผนผังพนักงานห้องแพ็ค</span>
        </button>
        <a
          className="tab-button"
          href="https://barcode-checker-ashy.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Printer size={18} />
          <span>พิมพ์ใบเช็ค ใบปะหน้า</span>
        </a>
        <a
          data-testid="coffee-drum-tab"
          className="tab-button"
          href="https://script.google.com/a/macros/hillkoff.com/s/AKfycbxETrRx_gJBuVTdl2MUaumr5Pem4LzahebQ6HZzrknPOr-PPCPmJHQ0I9f-p-kYJB-J/exec"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Coffee size={18} />
          <span>เบิกออก/รับเข้ากาแฟถัง</span>
        </a>
      </nav>

      {['packer', 'drive'].includes(activeTab) && (
        <>
          <section className={`workflow-guide ${activeTab === 'drive' ? 'drive-workflow-guide' : 'packer-workflow-guide'}`}>
            {activeTab === 'drive' ? <Upload size={24} /> : <PackageCheck size={24} />}
            <div>
              <strong>{activeTab === 'drive' ? 'รับเข้า Drive' : 'แพ็กสินค้า'}</strong>
              <p>{activeTab === 'drive' ? 'สแกนรับพัสดุเข้าระบบก่อนส่งให้ Packer แพ็กสินค้า' : 'สแกนพัสดุหลังแพ็กเสร็จ เพื่อบันทึกผู้แพ็กและสถานะ'}</p>
            </div>
          </section>

          <details className="marketplace-upload-panel secondary-panel">
        <summary className="secondary-panel-summary">
          <div>
          <div className="panel-heading" id="marketplace-upload-title">
            <FileSpreadsheet size={18} />
            <span>อัปโหลดออเดอร์ Seller Center</span>
          </div>
          <p>เลือกไฟล์ .xlsx หรือ .csv จาก Shopee, Lazada และ TikTok ได้หลายไฟล์พร้อมกัน</p>
          </div>
          <span className="secondary-panel-label">เครื่องมือรอง</span>
        </summary>
        <div className="marketplace-upload-content">
          <div className="marketplace-upload-controls">
          <label className="field-control marketplace-filter">
            <span>กรองแพลตฟอร์ม</span>
            <select
              value={marketplaceFilterPlatform}
              onChange={(e) => setMarketplaceFilterPlatform(e.target.value)}
              disabled={!firebaseUser || marketplaceUploadBusy}
            >
              <option value="all">ทุกแพลตฟอร์ม</option>
              <option value="shopee">Shopee</option>
              <option value="lazada">Lazada</option>
              <option value="tiktok">TikTok</option>
            </select>
          </label>
          <input
            ref={marketplaceFileRef}
            className="visually-hidden marketplace-file-input"
            type="file"
            accept=".xlsx,.csv"
            multiple
            onChange={uploadMarketplaceFiles}
            aria-label="เลือกไฟล์ออเดอร์ Seller Center"
          />
          <button
            className="secondary-button"
            type="button"
            onClick={() => marketplaceFileRef.current?.click()}
            disabled={!firebaseUser || marketplaceUploadBusy}
          >
            {marketplaceUploadBusy ? <RefreshCw size={16} className="spin" /> : <Upload size={16} />}
            <span>{marketplaceUploadBusy ? 'กำลังอัปโหลด...' : 'เลือกไฟล์ออเดอร์'}</span>
          </button>
          </div>
          {marketplaceUploadResult && (
            <div className={`marketplace-upload-result ${marketplaceUploadResult.type}`} role="status">
              {marketplaceUploadResult.message}
            </div>
          )}
        </div>
          </details>

          <details className="standards-panel secondary-panel">
            <summary className="secondary-panel-summary">
              <div>
                <div className="panel-heading">
                  <CheckCircle2 size={18} />
                  <span>มาตรฐานการปฏิบัติงาน</span>
                </div>
                <p>หลักควบคุมสำหรับความถูกต้อง ตรวจสอบย้อนกลับ และคุณภาพบริการ</p>
              </div>
              <span className="secondary-panel-label">Quality controls</span>
            </summary>
            <div className="standards-grid">
              <div className="standards-item">
                <strong>Traceability</strong>
                <span>Tracking, เวลา ผู้ปฏิบัติงาน ขนส่ง และสถานะต้องตรวจสอบย้อนกลับได้</span>
              </div>
              <div className="standards-item">
                <strong>Quality gate</strong>
                <span>ป้องกันรายการซ้ำ แยกสถานะผิดปกติ และยืนยันผลก่อนบันทึก</span>
              </div>
              <div className="standards-item">
                <strong>Role access</strong>
                <span>แยกขั้นตอน Packer และ Admin พร้อมยืนยันตัวตนก่อนทำรายการ</span>
              </div>
              <div className="standards-item">
                <strong>Audit & recovery</strong>
                <span>รายงาน ประวัติ และ recovery รองรับการตรวจสอบและแก้ไขอย่างมีหลักฐาน</span>
              </div>
            </div>
          </details>

          <section className="workspace-grid">
        <aside className={`side-panel workflow-${activeTab}`}>
          <div className="panel-heading">
            <Truck size={18} />
            <span>เลือกขนส่ง</span>
          </div>

          <div className="courier-list">
            {couriers.map((courier) => (
              <button
                className={`courier-button ${courier === selectedCourier ? 'active' : ''}`}
                key={courier}
                type="button"
                onClick={() => {
                  setSelectedCourier(courier);
                  setScanPopupOpen(true);
                  setScanRemark('');
                }}
                disabled={!isSignedIn || cameraActive}
              >
                <span>{courier}</span>
                <strong>{displayedCourierCounts.find((item) => item.courier === courier)?.count ?? 0}</strong>
              </button>
            ))}
          </div>

          <form className="courier-add-form" onSubmit={(event) => { event.preventDefault(); void handleAddCourier(); }}>
            <label htmlFor="courier-select">เพิ่มขนส่งเอง</label>
            <div className="courier-add-row">
              <select
                id="courier-select"
                value={courierSelectValue}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value) {
                    setSelectedCourier(value);
                    setAllowAnyTrackingFormat(true);
                    setScanPopupOpen(true);
                    setScanRemark('');
                    setCourierSelectValue('');
                  }
                }}
                disabled={!firebaseUser || addingCourier}
              >
                <option value="">เลือกจากขนส่งที่มี...</option>
                {couriers.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="courier-add-divider">
              <span>หรือพิมพ์ชื่อขนส่งใหม่</span>
            </div>
            <div>
              <input
                id="new-courier-name"
                value={newCourierName}
                onChange={(event) => setNewCourierName(event.target.value)}
                placeholder="เช่น DHL"
                maxLength={80}
                disabled={!firebaseUser || addingCourier}
              />
              <button type="submit" disabled={!firebaseUser || addingCourier || !newCourierName.trim()} title="เพิ่มขนส่ง">
                <Plus size={16} />
              </button>
            </div>
            <small>ผู้ใช้ที่ลงชื่อเข้าใช้เพิ่มได้ และจะแสดงทั้งหน้าแพ็ก/Drive</small>
          </form>

          <div className="scan-tool-panel" aria-label="เลือกวิธีสแกน">
            <div className="segmented-control">
              <button
                className={scanMethod === 'manual' ? 'active' : ''}
                type="button"
                onClick={() => setScanMethod('manual')}
              >
                <ScanLine size={16} />
                <span>เครื่องยิง/พิมพ์</span>
              </button>
              <button
                className={scanMethod === 'camera' ? 'active' : ''}
                type="button"
                onClick={() => setScanMethod('camera')}
              >
                <Camera size={16} />
                <span>กล้องมือถือ</span>
              </button>
            </div>
            {scanMethod === 'manual' && (
              <label className="manual-format-option">
                <input
                  type="checkbox"
                  checked={allowAnyTrackingFormat}
                  onChange={(event) => setAllowAnyTrackingFormat(event.target.checked)}
                  disabled={!isSignedIn || busy}
                />
                <span>เลขพิเศษ: ไม่ตรวจรูปแบบ Tracking</span>
              </label>
            )}
          </div>
        </aside>

        <section className={`scan-panel workflow-${activeTab}`}>
          <div className="scan-header">
            <div>
              <p className="eyebrow">{activeTab === 'drive' ? 'รับเข้า Drive →' : 'ขนส่งที่เลือก'}</p>
              <h2>{selectedCourier}</h2>
              {activeTab === 'drive' && (
                <span className="drive-mode-label">📥 รับเข้า Drive ก่อนส่งให้ Packer สแกนแพ็ก</span>
              )}
            </div>
            <div className="date-box">
              <Clock3 size={18} />
              <span>{today.date}</span>
              <strong>{today.time}</strong>
            </div>
          </div>

          {/* Packer-only controls */}
          {activeTab === 'packer' && (
            <div className={`issue-bar ${scanRemark ? 'active' : ''}`}>
                <label className="packer-control">
                  <span>Packer</span>
                  <select value={selectedPacker} onChange={(event) => setSelectedPacker(event.target.value)} disabled={!isSignedIn || busy}>
                    {packerOptions.map((packer) => (
                      <option key={packer} value={packer}>
                        {packer}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className={scanRemark === ISSUE_CUSTOMER_CANCELLED ? 'active' : ''}
                  type="button"
                  onClick={() =>
                    setScanRemark((value) => (value === ISSUE_CUSTOMER_CANCELLED ? '' : ISSUE_CUSTOMER_CANCELLED))
                  }
                  disabled={!isSignedIn || busy}
                >
                  {scanRemark === ISSUE_CUSTOMER_CANCELLED ? `✓ ${ISSUE_CUSTOMER_CANCELLED}` : ISSUE_CUSTOMER_CANCELLED}
                </button>
                <button
                  className={scanRemark === ISSUE_RETURNED ? 'active' : ''}
                  type="button"
                  onClick={() => setScanRemark((value) => (value === ISSUE_RETURNED ? '' : ISSUE_RETURNED))}
                  disabled={!isSignedIn || busy}
                >
                  {scanRemark === ISSUE_RETURNED ? `✓ ${ISSUE_RETURNED}` : ISSUE_RETURNED}
                </button>
                <span>
                  {scanRemark
                    ? `รายการถัดไป: ${selectedPacker} / ${scanRemark}`
                    : selectedPacker === PACKER_UNASSIGNED
                      ? 'ต้องเลือก Packer ก่อนสแกน'
                      : `รายการถัดไปบันทึก Packer: ${selectedPacker}`}
                </span>
            </div>
          )}

          {allowAnyTrackingFormat && (
            <div className="any-format-warning">
              <AlertTriangle size={16} />
              <span>⚠️ ข้ามการตรวจรูปแบบ Tracking: เลขอะไรก็สแกนผ่าน</span>
            </div>
          )}

          <div className={`current-courier-badge workflow-${activeTab}`}>
            <Truck size={18} />
            <span>{activeTab === 'drive' ? 'กำลังรับเข้า Drive' : 'กำลังสแกนแพ็ก'}</span>
            <strong>{selectedCourier}</strong>
          </div>

          <div className="operation-context" aria-label="บริบทการทำงานปัจจุบัน">
            <div className="operation-context-item">
              <span>Workflow</span>
              <strong>{activeTab === 'drive' ? 'รับเข้า Drive' : 'แพ็กสินค้า'}</strong>
            </div>
            {activeTab === 'packer' && (
              <div className="operation-context-item">
                <span>Packer</span>
                <strong>{selectedPacker}</strong>
              </div>
            )}
            <div className="operation-context-item">
              <span>โหมดสแกน</span>
              <strong>ต่อเนื่อง</strong>
            </div>
            <div className="operation-context-item">
              <span>ช่องทาง</span>
              <strong>{scanMethod === 'camera' ? 'กล้อง' : 'เครื่องยิง / พิมพ์'}</strong>
            </div>
          </div>

          <details className="sheet-recovery-panel secondary-panel">
            <summary className="secondary-panel-summary">
              <div>
                <p className="eyebrow">Recovery</p>
                <h3>{activeTab === 'packer' ? 'ตรวจและกู้ Packer เข้า Sheet' : 'ตรวจและกู้ Admin เข้า Sheet'}</h3>
              </div>
              <span className="secondary-panel-label">เครื่องมือรอง</span>
            </summary>
            <div className="sheet-recovery-content" aria-label="Recovery Firestore to Sheet">
              <div className="sheet-recovery-controls">
              <div className="range-fields">
                <label className="field-control">
                  <span>Recovery from</span>
                  <input
                    type="date"
                    value={sheetRecoveryStartDate}
                    onChange={(event) => setSheetRecoveryStartDate(event.target.value)}
                  />
                </label>
                <label className="field-control">
                  <span>Recovery to</span>
                  <input
                    type="date"
                    value={sheetRecoveryEndDate}
                    onChange={(event) => setSheetRecoveryEndDate(event.target.value)}
                  />
                </label>
              </div>
              </div>
              <p>อ่านข้อมูลจาก Firestore แล้วตรวจซ้ำกับ Sheet ก่อนยืนยันสถานะ ไม่สร้างแถวซ้ำถ้ามีข้อมูลครบแล้ว</p>
              <button
                className="secondary-button"
                type="button"
                data-testid={`sheet-recovery-${activeTab}`}
                onClick={() => { void recoverSelectedSheetRange(); }}
                disabled={sheetRecoveryBusy || !firebaseUser || !token || !config?.master?.id}
                title="ตรวจข้อมูล Firestore ของช่วงวันที่เลือกและเขียนเฉพาะส่วนที่ขาดลง Google Sheet"
              >
                {sheetRecoveryBusy ? <RefreshCw size={16} className="spin" /> : <RefreshCw size={16} />}
                <span>{sheetRecoveryBusy ? 'กำลัง Recovery...' : 'Recovery Firestore → Sheet'}</span>
              </button>
            </div>
          </details>

          {scanMethod === 'camera' ? (
            <div className={`camera-panel workflow-${activeTab}`}>
              <div className={`camera-stage ${cameraActive ? 'active' : ''}`}>
                <div id={CAMERA_REGION_ID} className="camera-reader" />
                <div className="scan-frame" aria-hidden="true">
                  <span />
                </div>
              </div>
              <div className="camera-footer">
                <p className={`camera-message ${cameraMessageType}`}>{cameraMessage}</p>
                <div className="camera-actions">
                  {cameraActive ? (
                    <button className="ghost-button" type="button" onClick={stopCamera}>
                      <Square size={16} />
                      <span>หยุดกล้อง</span>
                    </button>
                  ) : (
                    <button className="secondary-button" type="button" onClick={startCamera} disabled={busy || !isSignedIn}>
                      <Camera size={16} />
                      <span>เปิดกล้อง</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <form className={`scan-form workflow-${activeTab}`} onSubmit={handleScanSubmit}>
              <label htmlFor="scan-input">
                {activeTab === 'drive' ? 'Tracking / Barcode (รับเข้า Drive)' : 'Tracking / Barcode (แพ็กสินค้า)'}
              </label>
              <div className={`scan-input-row ${scanFlash ? 'flash' : ''}`}>
                <ScanLine size={24} />
                <input
                  id="scan-input"
                  ref={inputRef}
                  value={scanValue}
                  onChange={(event) => setScanValue(event.target.value)}
                  onKeyDown={handleBarcodeKeyDown}
                  placeholder={
                    isSignedIn
                      ? activeTab === 'drive'
                        ? 'ยิงบาร์โค้ดหรือ QR แล้วกด Enter เพื่อรับเข้า Drive'
                        : isPackerReady
                          ? 'ยิงบาร์โค้ดหรือ QR แล้วกด Enter'
                          : 'เลือก Packer ก่อนเริ่มสแกน'
                      : 'Login with Google ก่อนเริ่มสแกน'
                  }
                  autoComplete="off"
                  disabled={!isSignedIn || (activeTab === 'packer' && !isPackerReady)}
                />
                <button type="submit" disabled={!isSignedIn || (activeTab === 'packer' && !isPackerReady)}>
                  {scanQueueSnapshot.processing ? <RefreshCw size={18} className="spin" /> : <Play size={18} />}
                  <span>{activeTab === 'drive' ? 'รับเข้า Drive' : 'บันทึกแพ็ก'}</span>
                </button>
              </div>
              <p className="scan-queue-status" role="status" aria-live="polite">
                {scanQueueStatusText}
              </p>
            </form>
          )}

          {/* Packer-only: Search, Status, Metrics, Recent, Reports */}
          {activeTab === 'packer' && (
            <>
              <details className="search-panel secondary-panel">
                <summary className="search-heading">
                  <div>
                    <p className="eyebrow">Lookup</p>
                    <h3>ค้นหาเลขพัสดุ</h3>
                  </div>
                  <span>{searchResults ? `${searchResults.length} รายการ` : 'ยังไม่ได้ค้นหา'}</span>
                </summary>

                <form className="search-form" onSubmit={handleSearchSubmit}>
                  <label className="field-control search-code-field">
                    <span>เลขพัสดุ</span>
                    <div className="search-input-row">
                      <Search size={20} />
                      <input
                        value={searchValue}
                        onChange={(event) => setSearchValue(event.target.value)}
                        placeholder="พิมพ์เลขพัสดุหรือบางส่วนของเลข"
                        autoComplete="off"
                        disabled={searchBusy || !isSignedIn}
                      />
                    </div>
                  </label>

                  <div className="segmented-control search-scope-control">
                    <button className={searchScope === 'selected' ? 'active' : ''} type="button" onClick={() => setSearchScope('selected')}>
                      ขนส่งนี้
                    </button>
                    <button className={searchScope === 'all' ? 'active' : ''} type="button" onClick={() => setSearchScope('all')}>
                      ทุกขนส่ง
                    </button>
                  </div>

                  <div className="segmented-control search-date-control">
                    <button className={searchMode === 'today' ? 'active' : ''} type="button" onClick={() => setSearchMode('today')}>
                      วันนี้
                    </button>
                    <button className={searchMode === 'range' ? 'active' : ''} type="button" onClick={() => setSearchMode('range')}>
                      ช่วงวันที่
                    </button>
                    <button className={searchMode === 'all' ? 'active' : ''} type="button" onClick={() => setSearchMode('all')}>
                      ทุกวัน
                    </button>
                  </div>

                  {searchMode === 'range' && (
                    <div className="range-fields search-range">
                      <label className="field-control">
                        <span>เริ่มต้น</span>
                        <input type="date" value={searchStartDate} onChange={(event) => setSearchStartDate(event.target.value)} />
                      </label>
                      <label className="field-control">
                        <span>สิ้นสุด</span>
                        <input type="date" value={searchEndDate} onChange={(event) => setSearchEndDate(event.target.value)} />
                      </label>
                    </div>
                  )}

                  <button className="secondary-button search-button" type="submit" disabled={searchBusy || !isSignedIn}>
                    {searchBusy ? <RefreshCw size={16} className="spin" /> : <Search size={16} />}
                    <span>ค้นหา</span>
                  </button>
                </form>

                {searchResults && (
                  <div className="search-results">
                    {searchResults.length === 0 ? (
                      <div className="empty-search">ไม่พบเลขพัสดุในเงื่อนไขที่เลือก</div>
                    ) : (
                      <div className="table-wrap search-table">
                        <table>
                          <thead>
                            <tr>
                              <th>ขนส่ง</th>
                              <th>วันที่</th>
                              <th>เวลา</th>
                              <th>Tracking / Barcode</th>
                              <th>Status</th>
                              <th>Remark / Issue</th>
                              <th>ผู้สแกน</th>
                              <th>หมายเหตุ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {searchResults.map((row) => (
                              <tr key={`${row.courier}-${row.date}-${row.no}-${row.code}`}>
                                <td>{row.courier}</td>
                                <td>{row.date}</td>
                                <td>{row.time}</td>
                                <td className="code-cell">{row.code}</td>
                                <td><span className={`status-badge ${(row.status || '').toLowerCase()}`}>{row.status}</span></td>
                                <td>{row.note || '-'}</td>
                                <td>{row.email}</td>
                                <td>
                                  <button
                                    className="table-action-button"
                                    type="button"
                                    onClick={() => markSearchResultDamaged(row)}
                                    disabled={
                                      searchBusy ||
                                      row.note === ISSUE_DAMAGED ||
                                      row.status === 'Damaged' ||
                                      row.note === ISSUE_CUSTOMER_CANCELLED ||
                                      row.status === 'Cancelled'
                                    }
                                  >
                                    {row.note === ISSUE_DAMAGED || row.status === 'Damaged'
                                      ? 'บันทึกแล้ว'
                                      : row.note === ISSUE_CUSTOMER_CANCELLED || row.status === 'Cancelled'
                                        ? 'ยกเลิกแล้ว'
                                        : ISSUE_DAMAGED}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </details>

              {deploymentUpdateAvailable && <DeploymentUpdateBanner />}
              <StatusBanner status={status} />

              <div className="metric-row">
                <div>
                  <span>รวมวันนี้ทั้งหมด</span>
                  <strong>{totalTodayCount}</strong>
                </div>
                <div>
                  <span>{selectedCourier} วันนี้</span>
                  <strong>{selectedCount}</strong>
                </div>
                <div>
                  <span>แผ่นงาน</span>
                  <strong>{today.date}</strong>
                </div>
                <div>
                  <span>สถานะ</span>
                  <strong>{isSignedIn ? (isSheetConnected ? 'Firestore + Sheet Sync' : 'Firestore') : 'รอ Login'}</strong>
                </div>
              </div>

              {isSignedIn && totalTodayCount > 0 && (
                <div className="packer-section">
                  <div className="packer-header">
                    <span className="eyebrow">Packer วันนี้</span>
                    <button
                      className="text-button refresh-button"
                      type="button"
                      onClick={() => refreshAllCounts()}
                      title="รีเฟรชข้อมูลจาก Sheet"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                  <div className="packer-row">
                    {packerCounts.map(({ packer, count }) => (
                      <div key={packer}>
                        <span>{packer}</span>
                        <strong>{count}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="recent-header">
                <h3>รายการล่าสุด</h3>
                <div className="recent-actions">
                  {recentRows.length > 3 && (
                    <button className="text-button" type="button" onClick={() => setShowAllRecentRows((value) => !value)}>
                      {showAllRecentRows ? 'ย่อกลับ' : `ดูเพิ่มเติม (${recentRows.length})`}
                    </button>
                  )}
                  {sheetUrl && (
                    <a href={sheetUrl} target="_blank" rel="noreferrer">
                      เปิด Sheet <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Courier No.</th>
                      <th>เวลา</th>
                      <th>Tracking / Barcode</th>
                      <th>ผู้สแกน</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRows.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="empty-cell">
                          {isSignedIn ? 'ยังไม่มีรายการของวันนี้ใน Firestore' : 'เข้าสู่ระบบเพื่อโหลดรายการ'}
                        </td>
                      </tr>
                    ) : (
                      displayedRecentRows.map((row) => (
                        <tr key={`${row.no}-${row.courierNo}-${row.code}-${row.time}`}>
                          <td>{row.courierNo}</td>
                          <td>{row.time}</td>
                          <td className="code-cell">{row.code}</td>
                          <td>{row.email}</td>
                          <td>
                            <span className={`status-badge ${(row.status || '').toLowerCase()}`}>{row.status}</span>
                            {row.date && row.adminDate && row.date !== row.adminDate && <span className="status-badge cross-day">ข้ามวัน</span>}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Drive-only: Dashboard + Missing Order Check */}
          {activeTab === 'drive' && (
            <>
              {deploymentUpdateAvailable && <DeploymentUpdateBanner />}
              <StatusBanner status={status} />

              {/* Drive Dashboard */}
              <div className="drive-dashboard">
                <div className="drive-card total">
                  <ArrowRightLeft size={18} />
                  <span>ลง Drive วันนี้</span>
                  <strong>{driveTotalCount}</strong>
                </div>
                {dashboardSummary && (
                  <>
                    <div className="drive-card matched">
                      <CheckCircle2 size={18} />
                      <span>จับคู่แล้ว</span>
                      <strong>{dashboardSummary.matchedCount}</strong>
                    </div>
                    <div className={`drive-card ${dashboardSummary.pendingCount > 0 ? 'danger' : ''}`}>
                      <ShieldAlert size={18} />
                      <span>ตกหล่น</span>
                      <strong>{dashboardSummary.pendingCount}</strong>
                    </div>
                    <div className={`drive-card ${dashboardSummary.pendingOverOneDayCount > 0 ? 'danger' : 'muted'}`}>
                      <ShieldAlert size={18} />
                      <span>รอแพ็คเกิน 1 วัน</span>
                      <strong>{dashboardSummary.pendingOverOneDayCount}</strong>
                    </div>
                    <div className="drive-card muted">
                      <Clock3 size={18} />
                      <span>รอแพ็ค</span>
                      <strong>{dashboardSummary.tooSoonCount}</strong>
                    </div>
                  </>
                )}
              </div>

              {/* Missing Order Check */}
              <section className="missing-check-panel" aria-label="ตรวจสอบออเดอร์ตกหล่น">
                <div className="missing-check-header">
                  <div>
                    <p className="eyebrow">ตรวจสอบออเดอร์</p>
                    <h3>จับคู่ Admin ↔ Packer</h3>
                  </div>
                </div>

                <div className="missing-check-controls">
                  <label className="field-control">
                    <span>เกณฑ์เวลาแจ้งเตือน (นาที)</span>
                    <select
                      value={thresholdMinutes}
                      onChange={(e) => setThresholdMinutes(Number(e.target.value))}
                    >
                      <option value="15">15 นาที</option>
                      <option value="30">30 นาที</option>
                      <option value="60">1 ชั่วโมง</option>
                      <option value="120">2 ชั่วโมง</option>
                    </select>
                  </label>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={handleCheckMissingOrders}
                    disabled={missingBusy || !isSignedIn}
                  >
                    {missingBusy ? <RefreshCw size={16} className="spin" /> : <MonitorCheck size={16} />}
                    <span>ตรวจสอบออเดอร์ตกหล่น</span>
                  </button>
                </div>

                {missingResults && (
                  <div className="missing-results">
                    <div className="missing-results-actions">
                      <button className="ghost-button" type="button" onClick={copyMissingReport}>
                        <ClipboardCopy size={14} />
                        <span>คัดลอกรายงาน</span>
                      </button>
                      <button className="ghost-button" type="button" onClick={copyCompactSummary}>
                        <ClipboardCopy size={14} />
                        <span>คัดลอกสรุป</span>
                      </button>
                    </div>

                    <div className="missing-summary">
                      ตรวจย้อนหลัง {DEFAULT_LOOKBACK_HOURS} ชม. | เกณฑ์ {thresholdMinutes} นาที
                    </div>

                    {missingUISections.map((section) => (
                      <div key={section.type} className={`missing-result-card ${section.color}`}>
                        <div className="missing-result-card-header">
                          <span>{section.label}</span>
                          <strong>{section.count} รายการ</strong>
                        </div>
                        {section.rows.length > 0 && section.rows.length <= 20 && (
                          <div className="missing-result-list">
                            {section.rows.slice(0, 10).map((row, idx) => (
                              <div key={idx} className="missing-result-item">
                                <span className="code-cell">{row.adminCode}</span>
                                <span className="missing-courier">{row.courier}</span>
                                <span className="missing-time">{row.adminTime || row.time || '--:--'}</span>
                              </div>
                            ))}
                            {section.rows.length > 10 && (
                              <div className="missing-result-more">
                                ...และอีก {section.rows.length - 10} รายการ
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}

                    {missingUISections.length === 0 && (
                      <div className="empty-search">กดตรวจสอบเพื่อเริ่มต้น</div>
                    )}
                  </div>
                )}
              </section>

              {/* Drive Recent Rows */}
              <div className="recent-header">
                <h3>รายการที่ลง Drive</h3>
                <div className="recent-actions">
                  {sheetUrl && (
                    <a href={sheetUrl} target="_blank" rel="noreferrer">
                      เปิด Sheet <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>เวลา</th>
                      <th>Admin Tracking</th>
                      <th>Packer Tracking</th>
                      <th>Status</th>
                      <th>Courier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driveRecentRows.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="empty-cell">
                          {isSignedIn ? 'ยังไม่มีรายการลง Drive ของวันนี้' : 'เข้าสู่ระบบเพื่อโหลดรายการ'}
                        </td>
                      </tr>
                    ) : (
                      driveRecentRows.slice(0, 10).map((row) => (
                        <tr key={`${row.no}-${row.adminCode}-${row.adminTime}`}>
                          <td>{row.adminTime || row.time}</td>
                          <td className="code-cell">{row.adminCode || '-'}</td>
                          <td className="code-cell">{row.code || 'รอแพ็ค'}</td>
                          <td>
                            <span className={`status-badge ${(row.status || '').toLowerCase()}`}>{row.status || 'รอแพ็ค'}</span>
                            {row.date && row.adminDate && row.date !== row.adminDate && <span className="status-badge cross-day">ข้ามวัน</span>}
                          </td>
                          <td>{row.courier}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
          </section>
        </>
      )}

      {/* Reports — dedicated primary tab */}
      {activeTab === 'reports' && (
        <ReportsView
          activeTab={activeTab}
          isSignedIn={isSignedIn}
          reportMode={reportMode}
          setReportMode={setReportMode}
          reportDate={reportDate}
          setReportDate={setReportDate}
          reportStartDate={reportStartDate}
          setReportStartDate={setReportStartDate}
          reportEndDate={reportEndDate}
          setReportEndDate={setReportEndDate}
          reportMonth={reportMonth}
          setReportMonth={setReportMonth}
          reportBusy={reportBusy}
          reportData={reportData}
          generateReport={generateReport}
          copyReport={copyReport}
          backfillBusy={backfillBusy}
          backfillSelectedReportRange={backfillSelectedReportRange}
          couriers={couriers}
        />
      )}

      {activeTab === 'staff' && isSignedIn && (
        <StaffDirectory
          firebaseUser={firebaseUser}
          onPackerOptionsChange={(names, memberCount) => {
            if (memberCount === 0) return;
            const next = [PACKER_UNASSIGNED, ...names];
            setPackerOptions(next);
            setSelectedPacker((current) => next.includes(current) ? current : PACKER_UNASSIGNED);
          }}
        />
      )}

      {scanPopupOpen && (
        <div className="scan-popup-overlay" onClick={() => { setScanPopupOpen(false); void stopCamera(); }}>
          <div
            className={`scan-popup-sheet workflow-${activeTab}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="scan-popup-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="scan-popup-header">
              <div>
                <span>{activeTab === 'drive' ? 'รับเข้า Drive' : 'สแกนแพ็กสินค้า'}</span>
                <h2 id="scan-popup-title">{selectedCourier}</h2>
              </div>
              <button
                className="scan-popup-icon-close"
                type="button"
                aria-label="ปิดหน้าต่างสแกน"
                onClick={() => { setScanPopupOpen(false); void stopCamera(); }}
              >
                ×
              </button>
            </div>

            <div
              className={`scan-popup-feedback ${scanPopupStatusMeta.tone}`}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <ScanPopupStatusIcon size={20} aria-hidden="true" />
              <div>
                <strong>{status.title}</strong>
                <span>{status.message}</span>
              </div>
            </div>

            <label className="packer-control popup-courier">
              <span>ขนส่ง — เลือกก่อนสแกน</span>
              <select
                value={selectedCourier}
                onChange={(event) => setSelectedCourier(event.target.value)}
                disabled={!isSignedIn}
              >
                {scanPopupCourierOptions.map((courier) => (
                  <option key={courier} value={courier}>{courier}</option>
                ))}
              </select>
            </label>

            {activeTab === 'packer' && (
              <div className="scan-popup-issue-actions">
              <button
                className={`popup-cancel-btn ${scanRemark === ISSUE_CUSTOMER_CANCELLED ? 'active' : ''}`}
                type="button"
                onClick={() => setScanRemark((v) => (v === ISSUE_CUSTOMER_CANCELLED ? '' : ISSUE_CUSTOMER_CANCELLED))}
                disabled={!isSignedIn || busy}
              >
                {scanRemark === ISSUE_CUSTOMER_CANCELLED ? '✓ ลูกค้ายกเลิก' : 'ลูกค้ายกเลิก'}
              </button>
              <button
                className={`popup-cancel-btn ${scanRemark === ISSUE_RETURNED ? 'active' : ''}`}
                type="button"
                onClick={() => setScanRemark((v) => (v === ISSUE_RETURNED ? '' : ISSUE_RETURNED))}
                disabled={!isSignedIn || busy}
              >
                {scanRemark === ISSUE_RETURNED ? `✓ ${ISSUE_RETURNED}` : ISSUE_RETURNED}
              </button>
              </div>
            )}

            <div className="scan-controls">
              <div className="segmented-control">
                <button className={scanMethod === 'manual' ? 'active' : ''} type="button" onClick={() => setScanMethod('manual')}>
                  <ScanLine size={15} />
                  <span>เครื่องยิง</span>
                </button>
                <button className={scanMethod === 'camera' ? 'active' : ''} type="button" onClick={() => setScanMethod('camera')}>
                  <Camera size={15} />
                  <span>กล้อง</span>
                </button>
              </div>
            </div>

            {activeTab === 'packer' && (
              <label className="packer-control popup-packer">
                <span>Packer — เลือกคนแพ็คก่อนสแกน</span>
                <select value={selectedPacker} onChange={(e) => setSelectedPacker(e.target.value)} disabled={!isSignedIn || busy}>
                  {packerOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            )}

            {scanMethod === 'camera' ? (
              <div className={`camera-panel workflow-${activeTab}`}>
                <div className={`camera-stage ${cameraActive ? 'active' : ''}`}>
                  <div id={CAMERA_POPUP_ID} className="camera-reader" />
                  <div className="scan-frame" aria-hidden="true"><span /></div>
                </div>
                <div className="camera-footer">
                  <p className={`camera-message ${cameraMessageType}`}>{cameraMessage}</p>
                  <div className="camera-actions">
                    {cameraActive ? (
                      <button className="ghost-button" type="button" onClick={stopCamera}>
                        <Square size={16} /><span>หยุดกล้อง</span>
                      </button>
                    ) : (
                      <button className="secondary-button" type="button" onClick={startCameraPopup} disabled={busy || !isSignedIn}>
                        <Camera size={16} /><span>เปิดกล้อง</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <form className={`scan-form workflow-${activeTab}`} onSubmit={handleScanSubmit}>
                <div className={`scan-input-row ${scanFlash ? 'flash' : ''}`}>
                  <ScanLine size={24} />
                  <input
                    id="popup-scan-input"
                    ref={inputRef}
                    value={scanValue}
                    onChange={(e) => setScanValue(e.target.value)}
                    onKeyDown={handleBarcodeKeyDown}
                    placeholder={
                      activeTab === 'drive'
                        ? 'ยิงบาร์โค้ด แล้วกด Enter เพื่อรับเข้า Drive'
                        : isPackerReady
                          ? 'ยิงบาร์โค้ด แล้วกด Enter'
                          : 'เลือก Packer ก่อน'
                    }
                    autoComplete="off"
                    disabled={!isSignedIn || (activeTab === 'packer' && !isPackerReady)}
                  />
                  <button type="submit" disabled={!isSignedIn || (activeTab === 'packer' && !isPackerReady)}>
                    {scanQueueSnapshot.processing ? <RefreshCw size={18} className="spin" /> : <Play size={18} />}
                    <span>{activeTab === 'drive' ? 'รับเข้า Drive' : 'บันทึกแพ็ก'}</span>
                  </button>
                </div>
                <p className="scan-queue-status" role="status" aria-live="polite">
                  {scanQueueStatusText}
                </p>
              </form>
            )}

            <button className="scan-popup-close" type="button" onClick={() => { setScanPopupOpen(false); void stopCamera(); }}>
              ปิด
            </button>
          </div>
        </div>
      )}
    </main>
    </>
  );
}

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

export default App;
