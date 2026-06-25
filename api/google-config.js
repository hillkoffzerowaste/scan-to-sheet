import { getSession, getStoredSheetConfig, sendJson, setSession, setStoredSheetConfig } from './_auth.js';

export default async function handler(req, res) {
  try {
    const { sessionId, session } = await getSession(req);
    if (!session?.email) {
      sendJson(res, 401, { error: 'No active Google session' });
      return;
    }

    if (req.method === 'GET') {
      const config = session.sheetConfig ?? (await getStoredSheetConfig(session.email));
      sendJson(res, 200, { config });
      return;
    }

    if (req.method === 'POST') {
      const { config } = req.body ?? {};
      if (!config?.master?.id) {
        sendJson(res, 400, { error: 'Missing Google Sheet config' });
        return;
      }

      await setStoredSheetConfig(session.email, config);
      await setSession(sessionId, {
        ...session,
        sheetConfig: config,
        updatedAt: new Date().toISOString(),
      });
      sendJson(res, 200, { config });
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}
