export const QR_LAYOUT_STORAGE_KEY = 'scan-to-sheet:qr-layout-preferences:v1';

export const QR_LAYOUT_OPTIONS = Object.freeze([
  { value: 'compact', label: 'กะทัดรัด' },
  { value: 'standard', label: 'มาตรฐาน' },
  { value: 'large', label: 'ใหญ่' },
]);

export const DEFAULT_QR_LAYOUT_PREFERENCES = Object.freeze({
  workspace: 'standard',
  popup: 'standard',
});

const validLayouts = new Set(QR_LAYOUT_OPTIONS.map((option) => option.value));

function getBrowserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function normalizeQrLayoutPreferences(value) {
  return {
    workspace: validLayouts.has(value?.workspace) ? value.workspace : DEFAULT_QR_LAYOUT_PREFERENCES.workspace,
    popup: validLayouts.has(value?.popup) ? value.popup : DEFAULT_QR_LAYOUT_PREFERENCES.popup,
  };
}

export function loadQrLayoutPreferences(storage) {
  try {
    return normalizeQrLayoutPreferences(JSON.parse((storage ?? getBrowserStorage())?.getItem(QR_LAYOUT_STORAGE_KEY)));
  } catch {
    return { ...DEFAULT_QR_LAYOUT_PREFERENCES };
  }
}

export function saveQrLayoutPreferences(preferences, storage) {
  const normalized = normalizeQrLayoutPreferences(preferences);
  try {
    (storage ?? getBrowserStorage())?.setItem(QR_LAYOUT_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Preferences are local convenience only; a blocked storage must not interrupt scanning.
  }
  return normalized;
}
