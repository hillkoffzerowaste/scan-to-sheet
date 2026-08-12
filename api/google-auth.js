import {
  createSessionId,
  exchangeCode,
  fetchProfile,
  getStoredSheetConfig,
  sendJson,
  setSession,
  setSessionCookie,
} from './_auth.js';

export function canPersistGoogleSession(tokenData) {
  return Boolean(tokenData?.refresh_token);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const { code, redirectUri, clientId } = req.body ?? {};
    if (!code || !redirectUri || !clientId) {
      sendJson(res, 400, { error: 'Missing code, redirectUri, or clientId' });
      return;
    }

    let tokenData;
    let profile;
    try {
      tokenData = await exchangeCode({ code, redirectUri, clientId });
      profile = await fetchProfile(tokenData.access_token);
    } catch (error) {
      sendJson(res, 500, {
        error: 'Google OAuth failed',
        step: 'google_oauth',
        detail: error.message,
      });
      return;
    }

    const sessionId = createSessionId();
    let sheetConfig = null;
    let serverSession = false;

    try {
      if (!canPersistGoogleSession(tokenData)) {
        const persistenceError = new Error('Google OAuth did not return a refresh token');
        persistenceError.code = 'GOOGLE_REFRESH_TOKEN_MISSING';
        throw persistenceError;
      }
      sheetConfig = await getStoredSheetConfig(profile.email);
      await setSession(sessionId, {
        email: profile.email,
        name: profile.name,
        refreshToken: tokenData.refresh_token,
        sheetConfig,
        createdAt: new Date().toISOString(),
      });
      setSessionCookie(res, sessionId);
      serverSession = true;
    } catch (error) {
      console.warn('Google login continuing without KV session:', error.message);
    }

    sendJson(res, 200, {
      accessToken: tokenData.access_token,
      idToken: tokenData.id_token ?? null,
      expiresIn: tokenData.expires_in,
      profile,
      config: sheetConfig,
      serverSession,
      warning: serverSession ? null : 'เข้าสู่ระบบสำเร็จ แต่ระบบยังจำการเข้าสู่ระบบระยะยาวไม่ได้',
    });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Google auth failed',
      step: 'unexpected',
      detail: error.message,
    });
  }
}
