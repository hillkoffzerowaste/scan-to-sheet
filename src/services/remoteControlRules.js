import { PACKER_UNASSIGNED } from '../constants.js';

// One shared document is the whole channel between the scanning desktop and the phone remote.
// Both sides sign in with the same Google account, so the uid cannot tell them apart — the
// origin field is what makes an echo distinguishable from a real command.
export const REMOTE_CONTROL_COLLECTION = 'scanRemoteControl';
export const REMOTE_CONTROL_DOC_ID = 'current';
export const REMOTE_ORIGIN_DESKTOP = 'desktop';
export const REMOTE_ORIGIN_REMOTE = 'remote';

const FIELD_MAX_LENGTH = 80;
// The courier length is prefixed so no pair of names can produce the same signature
// by containing the separator itself.

export function remoteControlSignature({ courier, packer } = {}) {
  const nextCourier = String(courier ?? '');
  return `${nextCourier.length}:${nextCourier}|${String(packer ?? '')}`;
}

export function normalizeRemoteControlPayload({ courier, packer } = {}) {
  const nextCourier = String(courier ?? '').trim().slice(0, FIELD_MAX_LENGTH);
  if (!nextCourier) {
    const error = new Error('ยังไม่ได้เลือกขนส่ง');
    error.code = 'REMOTE_CONTROL_COURIER_REQUIRED';
    throw error;
  }
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
} = {}) {
  if (!data || typeof data !== 'object') return null;
  const origin = typeof data.origin === 'string' ? data.origin : '';
  if (!origin || origin === myOrigin) return null;

  const courier = typeof data.courier === 'string' ? data.courier.trim() : '';
  if (!courier || !knownCouriers.includes(courier)) return null;

  // The packer list changes during the day. A name this side has not seen yet must not throw
  // away the courier half of the command.
  const rawPacker = typeof data.packer === 'string' ? data.packer.trim() : '';
  const packer = rawPacker && knownPackers.includes(rawPacker) ? rawPacker : null;

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
