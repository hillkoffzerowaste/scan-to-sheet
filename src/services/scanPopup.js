const STATUS_META = {
  success: { tone: 'success', icon: 'check' },
  duplicate: { tone: 'duplicate', icon: 'alert' },
  warning: { tone: 'warning', icon: 'alert' },
  error: { tone: 'error', icon: 'alert' },
  ignored: { tone: 'ignored', icon: 'scan' },
};

export function getScanPopupStatusMeta(statusType) {
  return STATUS_META[statusType] ?? { tone: 'idle', icon: 'scan' };
}
