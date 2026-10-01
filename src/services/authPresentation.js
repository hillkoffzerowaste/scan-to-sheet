export const EMPTY_AUTH_EMAIL = 'ยังไม่ได้เข้าสู่ระบบ';

export function getAuthPresentation({
  isSignedIn = false,
  isSheetConnected = false,
  isGoogleReady = false,
  user = null,
  firebaseUser = null,
} = {}) {
  const displayEmail = user?.email && user.email !== EMPTY_AUTH_EMAIL
    ? user.email
    : firebaseUser?.email || EMPTY_AUTH_EMAIL;
  const firebaseOnlySession = Boolean(isSignedIn && !isSheetConnected);

  return {
    displayEmail,
    showSignIn: !isSignedIn || firebaseOnlySession,
    showSignOut: Boolean(isSignedIn),
    signInLabel: firebaseOnlySession ? 'เชื่อม Google ใหม่' : 'เข้าสู่ระบบด้วย Google',
    signInDisabled: !isGoogleReady,
  };
}
