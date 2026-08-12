const OAUTH_CALLBACK_PARAMS = [
  'code',
  'error',
  'error_description',
  'scope',
  'authuser',
  'prompt',
];

function isFirebaseHosting(hostname) {
  const normalized = String(hostname ?? '').trim().toLowerCase();
  return normalized.endsWith('.firebaseapp.com') || normalized.endsWith('.web.app');
}

export function getCanonicalAppRedirect(locationLike, primaryAppUrl) {
  if (!isFirebaseHosting(locationLike?.hostname)) return null;

  let target;
  try {
    target = new URL(primaryAppUrl);
  } catch {
    return null;
  }
  if (target.protocol !== 'https:') return null;

  target.pathname = locationLike?.pathname || '/';
  target.search = locationLike?.search || '';
  OAUTH_CALLBACK_PARAMS.forEach((name) => target.searchParams.delete(name));
  target.hash = locationLike?.hash || '';
  return target.toString();
}
