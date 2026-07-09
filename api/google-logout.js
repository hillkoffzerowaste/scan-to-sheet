import { clearSessionCookie, deleteSession, getSession, sendJson } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  // Always clear cookie first, then try to delete KV session.
  clearSessionCookie(res);

  try {
    const { sessionId } = await getSession(req);
    if (sessionId) {
      await deleteSession(sessionId);
    }
  } catch {
    // KV may be unreachable; cookie is already cleared.
  }

  sendJson(res, 200, { ok: true });
}
