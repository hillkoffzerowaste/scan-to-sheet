import {
  API_ERRORS,
  fetchProfile,
  getSession,
  getStoredSheetConfig,
  refreshAccessToken,
  sendError,
  sendJson,
  setSession,
} from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendError(res, API_ERRORS.methodNotAllowed);
    return;
  }

  try {
    const { sessionId, session } = await getSession(req);
    if (!session?.refreshToken) {
      sendError(res, API_ERRORS.noSession);
      return;
    }

    const tokenData = await refreshAccessToken(session.refreshToken);
    const profile = await fetchProfile(tokenData.access_token);
    const sheetConfig = session.sheetConfig ?? (await getStoredSheetConfig(profile.email));
    await setSession(sessionId, {
      ...session,
      email: profile.email,
      name: profile.name,
      refreshToken: tokenData.refresh_token ?? session.refreshToken,
      sheetConfig,
      updatedAt: new Date().toISOString(),
    });

    sendJson(res, 200, {
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
      profile,
      config: sheetConfig,
      serverSession: true,
    });
  } catch (error) {
    sendError(res, {
      status: 500,
      code: 'GOOGLE_TOKEN_REFRESH_FAILED',
      message: 'ต่ออายุการเข้าสู่ระบบ Google ไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่',
      error,
    });
  }
}
