export function createCameraScanGate({ rearmAfterMs = 800 } = {}) {
  let code = '';
  let lastSeen = 0;
  return {
    detect(value, now) {
      const next = String(value ?? '').trim().toUpperCase();
      const accepted = next !== code;
      code = next;
      lastSeen = now;
      return Boolean(next) && accepted;
    },
    miss(now) {
      if (now - lastSeen >= rearmAfterMs) code = '';
    },
    reset() { code = ''; },
  };
}
