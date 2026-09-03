export const MIN_TRACKING_CODE_LENGTH = 8;

export function hasMinimumTrackingLength(value) {
  return String(value ?? '').trim().length >= MIN_TRACKING_CODE_LENGTH;
}
