import { API_ERRORS, clearSessionCookie, deleteSession, getSession, sendError, sendJson } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendError(res, API_ERRORS.methodNotAllowed);
    return;
  }

  // Always clear cookie first, then try to delete the Firestore server session.
  clearSessionCookie(res);

  try {
    const { sessionId } = await getSession(req);
    if (sessionId) {
      await deleteSession(sessionId);
    }
  } catch {
    // The server store may be unreachable; cookie is already cleared.
  }

  sendJson(res, 200, { ok: true });
}
