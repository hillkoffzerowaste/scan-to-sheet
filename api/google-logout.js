import { clearSessionCookie, deleteSession, getSession, sendJson } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const { sessionId } = await getSession(req);
    await deleteSession(sessionId);
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
  }
}
