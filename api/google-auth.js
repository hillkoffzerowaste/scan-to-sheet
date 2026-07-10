import {
  createSessionId,
  exchangeCode,
  fetchProfile,
  getStoredSheetConfig,
  sendJson,
  setSession,
  setSessionCookie,
} from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const { code, redirectUri } = req.body ?? {};
    if (!code || !redirectUri) {
      sendJson(res, 400, { error: 'Missing code or redirectUri' });
      return;
    }

    let tokenData;
    let profile;
    try {
      tokenData = await exchangeCode({ code, redirectUri });
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
      expiresIn: tokenData.expires_in,
      profile,
      config: sheetConfig,
      serverSession,
      warning: serverSession ? null : 'Google login succeeded, but server session storage failed.',
    });
  } catch (error) {
    sendJson(res, 500, {
      error: 'Google auth failed',
      step: 'unexpected',
      detail: error.message,
    });
  }
}
