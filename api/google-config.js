import {
  API_ERRORS,
  getSession,
  getStoredSheetConfig,
  sendError,
  sendJson,
  setSession,
  setStoredSheetConfig,
} from './_auth.js';

export default async function handler(req, res) {
  try {
    const { sessionId, session } = await getSession(req);
    if (!session?.email) {
      sendError(res, API_ERRORS.noSession);
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
        sendError(res, {
          status: 400,
          code: 'SHEET_CONFIG_INVALID',
          message: 'ไม่พบข้อมูล Google Sheet Master ในคำขอ',
        });
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

    sendError(res, API_ERRORS.methodNotAllowed);
  } catch (error) {
    sendError(res, {
      status: 500,
      code: 'SHEET_CONFIG_FAILED',
      message: 'อ่านหรือบันทึกการตั้งค่า Google Sheet ไม่สำเร็จ กรุณาลองอีกครั้ง',
      error,
    });
  }
}
