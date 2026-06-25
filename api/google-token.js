import { fetchProfile, getSession, getStoredSheetConfig, refreshAccessToken, sendJson, setSession } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const { sessionId, session } = await getSession(req);
    if (!session?.refreshToken) {
      sendJson(res, 401, { error: 'No active Google session' });
      return;
    }

    const tokenData = await refreshAccessToken(session.refreshToken);
    const profile = await fetchProfile(tokenData.access_token);
    const sheetConfig = session.sheetConfig ?? (await getStoredSheetConfig(profile.email));
    await setSession(sessionId, {
      ...session,
      email: profile.email,
      name: profile.name,
      sheetConfig,
      updatedAt: new Date().toISOString(),
    });

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
