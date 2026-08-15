/**
 * Arbitrates the one camera between the barcode scanner and the packing recorder.
 *
 * html5-qrcode calls getUserMedia internally, and on Android the camera is usually exclusive:
 * opening it twice yields NotReadableError. Rather than let whichever module runs second fail,
 * ownership is explicit — and a recording in progress simply cannot be evicted, because losing
 * the camera mid-clip loses the evidence.
 */

let owner = null;
let locked = false;
let evict = null;

export function getCameraOwner() {
  return owner;
}

export function isCameraLocked() {
  return locked;
}

/**
 * Claims the camera, evicting the previous owner if there is one.
 *
 * `lock: true` marks the claim as un-evictable — used while recording.
 */
export async function acquireCamera(ownerId, { onEvict, lock = false } = {}) {
  if (!ownerId) throw new TypeError('acquireCamera requires an owner id');

  if (owner === ownerId) {
    locked = lock || locked;
    if (typeof onEvict === 'function') evict = onEvict;
    return { evicted: null };
  }

  if (owner && locked) {
    throw Object.assign(
      new Error('กล้องกำลังใช้บันทึกวิดีโอแพ็คอยู่ กรุณากด "แพ็คเสร็จ" ก่อน'),
      { code: 'PACKING_VIDEO_CAMERA_BUSY', owner },
    );
  }

  const previousOwner = owner;
  const previousEvict = evict;
  owner = ownerId;
  evict = typeof onEvict === 'function' ? onEvict : null;
  locked = lock;

  if (previousEvict) {
    try {
      await previousEvict();
    } catch {
      // The outgoing owner failing to clean up must not block the incoming one.
    }
  }

  return { evicted: previousOwner };
}

/** Marks the current claim as un-evictable for the duration of a recording. */
export function lockCamera(ownerId) {
  if (owner !== ownerId) return false;
  locked = true;
  return true;
}

export function unlockCamera(ownerId) {
  if (owner !== ownerId) return false;
  locked = false;
  return true;
}

/** A no-op unless the caller actually holds the camera, so a late release cannot steal it. */
export function releaseCamera(ownerId) {
  if (owner !== ownerId) return false;
  owner = null;
  evict = null;
  locked = false;
  return true;
}

/** Test-only reset; production code releases by owner id. */
export function resetCameraOwner() {
  owner = null;
  evict = null;
  locked = false;
}
