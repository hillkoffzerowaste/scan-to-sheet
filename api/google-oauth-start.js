import {
  API_ERRORS,
  createOAuthTransaction,
  getRequiredGoogleEnv,
  sendError,
  sendJson,
  setOAuthTransactionCookie,
} from './_auth.js';

function trustedRedirectUri(req, value) {
  const candidate = new URL(String(value ?? ''));
  const configured = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (configured) return candidate.href === configured ? candidate.href : null;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const origin = `${protocol}://${host}`;
  return candidate.origin === origin && !candidate.search && !candidate.hash ? candidate.href : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendError(res, API_ERRORS.methodNotAllowed);
    return;
  }
  try {
    const redirectUri = trustedRedirectUri(req, req.body?.redirectUri);
    if (!redirectUri) {
      sendError(res, { status: 400, code: 'OAUTH_REDIRECT_INVALID', message: 'ปลายทางการเข้าสู่ระบบไม่ถูกต้อง' });
      return;
    }
    const { clientId } = getRequiredGoogleEnv();
    const transaction = createOAuthTransaction({ redirectUri });
    setOAuthTransactionCookie(res, transaction);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets',
      include_granted_scopes: 'true',
      access_type: 'offline',
      prompt: 'consent',
      state: transaction.state,
      code_challenge: transaction.codeChallenge,
      code_challenge_method: 'S256',
    });
    sendJson(res, 200, { authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  } catch (error) {
    sendError(res, { status: 500, code: 'OAUTH_START_FAILED', message: 'เริ่มการเข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่', error });
  }
}
