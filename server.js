import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import googleAuth from './api/google-auth.js';
import googleConfig from './api/google-config.js';
import googleLogout from './api/google-logout.js';
import googleOAuthStart from './api/google-oauth-start.js';
import googleToken from './api/google-token.js';
import sheetLock from './api/sheet-lock.js';

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const API_BODY_LIMIT_BYTES = 1024 * 1024;

const API_HANDLERS = new Map([
  ['/api/google-oauth-start', googleOAuthStart],
  ['/api/google-auth', googleAuth],
  ['/api/google-token', googleToken],
  ['/api/google-logout', googleLogout],
  ['/api/google-config', googleConfig],
  ['/api/sheet-lock', sheetLock],
]);

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.mp4', 'video/mp4'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function jsonResponse(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function bodyError(status, code, error) {
  return Object.assign(new Error(error), { status, code });
}

async function readJsonBody(req, maxBodyBytes = API_BODY_LIMIT_BYTES) {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > maxBodyBytes) {
    throw bodyError(413, 'REQUEST_BODY_TOO_LARGE', 'คำขอมีขนาดใหญ่เกินไป');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // API requests carry small JSON payloads; bound memory use if a client streams an oversized body.
    if (size > maxBodyBytes) {
      throw bodyError(413, 'REQUEST_BODY_TOO_LARGE', 'คำขอมีขนาดใหญ่เกินไป');
    }
    chunks.push(chunk);
  }

  if (size === 0) return {};

  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json' && !contentType.endsWith('+json')) {
    throw bodyError(415, 'UNSUPPORTED_REQUEST_FORMAT', 'รูปแบบคำขอไม่ถูกต้อง');
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw bodyError(400, 'INVALID_JSON_BODY', 'คำขอไม่ถูกต้อง กรุณาลองอีกครั้ง');
  }
}

function resolveStaticPath(root, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname).replaceAll('\\', '/');
  } catch {
    return null;
  }

  const segments = decodedPath.split('/').filter((segment) => segment && segment !== '.');
  const filePath = path.resolve(root, ...segments);
  const relativePath = path.relative(root, filePath);
  if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    return null;
  }
  return filePath;
}

async function serveStatic(req, res, staticDir, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method Not Allowed');
    return;
  }

  const filePath = resolveStaticPath(staticDir, pathname);
  if (!filePath) {
    res.statusCode = 400;
    res.end('Bad Request');
    return;
  }

  let selectedPath = filePath;
  let fileInfo;
  try {
    fileInfo = await stat(selectedPath);
    if (fileInfo.isDirectory()) {
      selectedPath = path.join(selectedPath, 'index.html');
      fileInfo = await stat(selectedPath);
    }
  } catch {
    if (path.extname(pathname)) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    selectedPath = path.join(staticDir, 'index.html');
    try {
      fileInfo = await stat(selectedPath);
    } catch {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
  }

  if (!fileInfo.isFile()) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }

  const extension = path.extname(selectedPath).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', CONTENT_TYPES.get(extension) || 'application/octet-stream');
  res.setHeader('Content-Length', fileInfo.size);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Cache-Control',
    pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  );

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = createReadStream(selectedPath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Internal Server Error');
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

export function createAppServer({
  staticDir = path.join(PROJECT_ROOT, 'dist'),
  apiHandlers = API_HANDLERS,
  maxBodyBytes = API_BODY_LIMIT_BYTES,
} = {}) {
  const root = path.resolve(staticDir);
  const handlers = apiHandlers instanceof Map ? apiHandlers : new Map(Object.entries(apiHandlers));

  return http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const handler = handlers.get(url.pathname);
      if (!handler) {
        jsonResponse(res, 404, { error: 'ไม่พบ API ที่เรียก', code: 'API_ROUTE_NOT_FOUND' });
        return;
      }

      try {
        const contentLength = Number(req.headers['content-length'] || 0);
        const hasBody = contentLength > 0 || Boolean(req.headers['transfer-encoding']);
        req.body = hasBody ? await readJsonBody(req, maxBodyBytes) : {};
        await handler(req, res);
        if (!res.writableEnded) jsonResponse(res, 500, { error: 'ระบบขัดข้อง กรุณาลองอีกครั้ง', code: 'API_RESPONSE_MISSING' });
      } catch (error) {
        if (res.writableEnded) return;
        if (error?.status && error?.code) {
          jsonResponse(res, error.status, { error: error.message, code: error.code });
          return;
        }
        console.error('[API_INTERNAL_ERROR]', error?.message || 'Unknown API error');
        jsonResponse(res, 500, { error: 'ระบบขัดข้อง กรุณาลองอีกครั้ง', code: 'API_INTERNAL_ERROR' });
      }
      return;
    }

    try {
      await serveStatic(req, res, root, url.pathname);
    } catch (error) {
      console.error('[STATIC_RESPONSE_ERROR]', error?.message || 'Unknown static response error');
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal Server Error');
      } else {
        res.destroy();
      }
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  createAppServer().listen(port, '0.0.0.0', () => {
    console.log(`Scan to Sheet server listening on port ${port}`);
  });
}
