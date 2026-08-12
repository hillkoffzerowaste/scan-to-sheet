import { API_ERRORS, getSession, sendError, sendJson } from './_auth.js';

const HILLKOFF_ME_URL = 'https://repo-rho-livid.vercel.app/api/v1/me';

function configError() {
  return Object.assign(new Error('Missing HILLKOFF_API_KEY'), {
    code: 'HILLKOFF_NOT_CONFIGURED',
  });
}

export async function fetchHillkoffProfile(apiKey, fetchImpl = fetch) {
  if (!String(apiKey || '').trim()) {
    throw configError();
  }

  const response = await fetchImpl(HILLKOFF_ME_URL, {
    headers: { 'x-api-key': apiKey },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);

  if (!payload) {
    return {
      status: response.status,
      payload: {
        ok: false,
        code: 'HILLKOFF_UPSTREAM_INVALID',
        error: 'ระบบ Hillkoff ตอบกลับไม่สมบูรณ์ กรุณาลองใหม่อีกครั้ง',
      },
    };
  }

  if (!response.ok) {
    return {
      status: response.status,
      payload: {
        ok: false,
        code: 'HILLKOFF_API_REJECTED',
        error: 'เชื่อมต่อระบบ Hillkoff ไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ',
      },
    };
  }

  return { status: response.status, payload };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    sendError(res, API_ERRORS.methodNotAllowed);
    return;
  }

  try {
    const { session } = await getSession(req);
    if (!session?.email) {
      sendError(res, API_ERRORS.noSession);
      return;
    }

    const result = await fetchHillkoffProfile(process.env.HILLKOFF_API_KEY);
    sendJson(res, result.status, result.payload);
  } catch (error) {
    sendError(res, {
      status: 500,
      code: error?.code || 'HILLKOFF_CONNECTION_FAILED',
      message: 'เชื่อมต่อระบบ Hillkoff ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      error,
    });
  }
}
