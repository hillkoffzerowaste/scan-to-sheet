export const REMOTE_ROUTE_PATH = '/remote';

// The remote screen is its own React tree, picked before the app boots. An exact match matters:
// startsWith('/remote') would also swallow a future /remotely or /remote-setup path.
export function isRemoteRoute(locationLike) {
  const pathname = String(locationLike?.pathname ?? '');
  return pathname === REMOTE_ROUTE_PATH || pathname === `${REMOTE_ROUTE_PATH}/`;
}
