import { PACKER_UNASSIGNED } from '../constants.js';

// One document per workspace is the whole channel between a scanning desktop and the phone
// remote. Both sides sign in with the same Google account, so the uid cannot tell them apart —
// the origin field is what makes an echo distinguishable from a real command.
//
// Packer and Drive get separate boards because the two share one selectedCourier state: a
// single board would have let the packing room retarget the courier under an Admin who was
// receiving parcels into Drive at that moment, and the next parcel would land on the wrong one.
export const REMOTE_CONTROL_COLLECTION = 'scanRemoteControl';
export const REMOTE_CONTROL_TABS = ['packer', 'drive'];
// Drive never records a packer (requiresPacker is packer-mode only), but the rules require a
// non-empty string, so its board carries the unassigned marker.
export const REMOTE_CONTROL_TAB_USES_PACKER = { packer: true, drive: false };

export function remoteControlDocId(tab) {
  return REMOTE_CONTROL_TABS.includes(tab) ? tab : null;
}
export const REMOTE_ORIGIN_DESKTOP = 'desktop';
export const REMOTE_ORIGIN_REMOTE = 'remote';

const FIELD_MAX_LENGTH = 80;
// The courier length is prefixed so no pair of names can produce the same signature
// by containing the separator itself.

export function remoteControlSignature({ courier, packer } = {}) {
  const nextCourier = String(courier ?? '');
  return `${nextCourier.length}:${nextCourier}|${String(packer ?? '')}`;
}

export function normalizeRemoteControlPayload({ courier, packer, tab = 'packer' } = {}) {
  const nextCourier = String(courier ?? '').trim().slice(0, FIELD_MAX_LENGTH);
  if (!nextCourier) {
    const error = new Error('ยังไม่ได้เลือกขนส่ง');
    error.code = 'REMOTE_CONTROL_COURIER_REQUIRED';
    throw error;
  }
  if (!REMOTE_CONTROL_TAB_USES_PACKER[tab]) return { courier: nextCourier, packer: PACKER_UNASSIGNED };
  const trimmedPacker = String(packer ?? '').trim().slice(0, FIELD_MAX_LENGTH);
  return { courier: nextCourier, packer: trimmedPacker || PACKER_UNASSIGNED };
}

// Returns what the receiving side should actually apply, or null when the snapshot must be
// ignored. Kept pure so the loop-prevention rules are testable without Firestore.
export function shouldApplyRemoteControlDoc({
  data,
  myOrigin,
  knownCouriers = [],
  knownPackers = [],
  lastAppliedSignature = null,
  tab = 'packer',
} = {}) {
  if (!data || typeof data !== 'object') return null;
  const origin = typeof data.origin === 'string' ? data.origin : '';
  if (!origin || origin === myOrigin) return null;

  const courier = typeof data.courier === 'string' ? data.courier.trim() : '';
  if (!courier || !knownCouriers.includes(courier)) return null;

  // The packer list changes during the day. A name this side has not seen yet must not throw
  // away the courier half of the command. Drive has no packer at all.
  const rawPacker = typeof data.packer === 'string' ? data.packer.trim() : '';
  const packer = REMOTE_CONTROL_TAB_USES_PACKER[tab] && rawPacker && knownPackers.includes(rawPacker)
    ? rawPacker
    : null;

  const signature = remoteControlSignature({ courier, packer: packer ?? '' });
  if (lastAppliedSignature && signature === lastAppliedSignature) return null;

  return { courier, packer, origin, signature };
}

// The desktop mirrors local selections back so the phone shows the truth. It must not mirror
// back what it just received, or the two sides write to each other forever.
export function shouldWriteRemoteControl({ next, lastAppliedSignature = null } = {}) {
  if (!next?.courier) return false;
  const signature = remoteControlSignature(next);
  if (lastAppliedSignature && signature === lastAppliedSignature) return false;
  return true;
}
