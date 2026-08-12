import {
  API_ERRORS,
  createSessionId,
  exchangeCode,
  fetchProfile,
  getStoredSheetConfig,
  redactSecrets,
  sendError,
  sendJson,
  setSession,
  setSessionCookie,
} from './_auth.js';

export function canPersistGoogleSession(tokenData) {
  return Boolean(tokenData?.refresh_token);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendError(res, API_ERRORS.methodNotAllowed);
    return;
  }

  try {
    const { code, redirectUri, clientId } = req.body ?? {};
    if (!code || !redirectUri || !clientId) {
      sendError(res, {
        status: 400,
        code: 'AUTH_REQUEST_INVALID',
        message: 'คำขอเข้าสู่ระบบไม่ครบถ้วน กรุณาลองเข้าสู่ระบบใหม่',
      });
      return;
    }

    let tokenData;
    let profile;
    try {
      tokenData = await exchangeCode({ code, redirectUri, clientId });
      profile = await fetchProfile(tokenData.access_token);
    } catch (error) {
      // `detail` used to carry error.message here. It never reached the banner, but it did
      // reach anyone calling the endpoint, and it can hold Google's raw token-error body.
      sendError(res, {
        status: 500,
        code: 'GOOGLE_OAUTH_FAILED',
        message: 'เข้าสู่ระบบ Google ไม่สำเร็จ กรุณาลองอีกครั้ง',
        error,
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
      console.warn('Google login continuing without KV session:', redactSecrets(error.message));
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
    sendError(res, {
      status: 500,
      code: 'GOOGLE_AUTH_FAILED',
      message: 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง',
      error,
    });
  }
}
