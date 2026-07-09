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

    const tokenData = await exchangeCode({ code, redirectUri });
    const profile = await fetchProfile(tokenData.access_token);
    const sessionId = createSessionId();
    const sheetConfig = await getStoredSheetConfig(profile.email);

    await setSession(sessionId, {
      email: profile.email,
      name: profile.name,
      refreshToken: tokenData.refresh_token,
      sheetConfig,
      createdAt: new Date().toISOString(),
    });
    setSessionCookie(res, sessionId);

    sendJson(res, 200, {
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
      profile,
      config: sheetConfig,
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}
