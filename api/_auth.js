import crypto from 'node:crypto';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const SESSION_COOKIE = 'scan_to_sheet_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function getRedisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

export function getRequiredGoogleEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID/VITE_GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
  }
  return { clientId, clientSecret };
}

export async function redisCommand(command) {
  const { url, token } = getRedisConfig();
  if (!url || !token) {
    throw new Error('Missing Vercel KV REST environment variables');
  }

  const response = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([command]),
  });

  if (!response.ok) {
    throw new Error(`KV error ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const first = data?.[0];
  if (first?.error) {
    throw new Error(`KV error: ${first.error}`);
  }
  return first?.result ?? null;
}

export async function setSession(sessionId, session) {
  await redisCommand(['SET', sessionKey(sessionId), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS]);
}

export async function getSession(req) {
  const sessionId = readCookie(req, SESSION_COOKIE);
  if (!sessionId) {
    return { sessionId: null, session: null };
  }

  const value = await redisCommand(['GET', sessionKey(sessionId)]);
  if (!value) {
    return { sessionId, session: null };
  }

  return { sessionId, session: JSON.parse(value) };
}

export async function deleteSession(sessionId) {
  if (sessionId) {
    await redisCommand(['DEL', sessionKey(sessionId)]);
  }
}

export async function getStoredSheetConfig(email) {
  if (!email) {
    return null;
  }

  const value = await redisCommand(['GET', sheetConfigKey(email)]);
  return value ? JSON.parse(value) : null;
}

export async function setStoredSheetConfig(email, config) {
  if (!email || !config?.master?.id) {
    return;
  }

  await redisCommand(['SET', sheetConfigKey(email), JSON.stringify(config)]);
}

export function createSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

export function setSessionCookie(res, sessionId) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`,
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

export async function exchangeCode({ code, redirectUri }) {
  const { clientId, clientSecret } = getRequiredGoogleEnv();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  return googleTokenRequest(body);
}

export async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret } = getRequiredGoogleEnv();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  return googleTokenRequest(body);
}

export async function fetchProfile(accessToken) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Google profile error ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function sessionKey(sessionId) {
  return `scan-to-sheet:session:${sessionId}`;
}

function sheetConfigKey(email) {
  return `scan-to-sheet:google-config:${String(email).trim().toLowerCase()}`;
}

function readCookie(req, name) {
  const cookie = req.headers.cookie || '';
  return cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? null;
}

async function googleTokenRequest(body) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Google token error ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}
