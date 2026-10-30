/**
 * Static demo host plus `GET /turn`.
 * Used by Docker and `node server/static-server.mjs`. Vite dev/preview attach
 * the same `/turn` handler without replacing the static file server.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { handleTurnRequest, isTurnPathname } from './turn-credentials.mjs';

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
  ['.ico', 'image/x-icon'],
  ['.png', 'image/png'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.woff2', 'font/woff2'],
]);

/**
 * @param {import('node:http').IncomingMessage} nodeReq
 * @param {import('node:http').ServerResponse} nodeRes
 * @param {Record<string, string | undefined>} env
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 */
export async function delegateTurn(nodeReq, nodeRes, env, deps) {
  const host = nodeReq.headers.host || '127.0.0.1';
  const requestUrl = new URL(nodeReq.url || '/', `http://${host}`);
  if (!isTurnPathname(requestUrl.pathname)) return false;
  const response = await handleTurnRequest(
    new Request(requestUrl, { method: nodeReq.method || 'GET' }),
    env,
    deps,
  );
  if (!response) return false;
  await writeFetchResponse(nodeRes, response);
  return true;
}

/**
 * @param {{
 *   port?: number,
 *   host?: string,
 *   staticRoot: string,
 *   env?: Record<string, string | undefined>,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export function startStaticServer(options) {
  const staticRoot = path.resolve(options.staticRoot);
  const env = options.env ?? process.env;
  const server = createServer(async (req, res) => {
    try {
      if (await delegateTurn(req, res, env, { fetchImpl: options.fetchImpl })) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' });
        res.end();
        return;
      }
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const filePath = resolveStaticFile(staticRoot, requestUrl.pathname);
      if (!filePath) {
        res.writeHead(404, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        res.end(req.method === 'HEAD' ? undefined : 'Not found');
        return;
      }
      const body = readFileSync(filePath);
      res.writeHead(200, {
        'content-type': contentType(filePath),
        'content-length': body.length,
        'cache-control': filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        res.end('Server error');
      }
    }
  });

  const host = options.host ?? '0.0.0.0';
  const port = options.port ?? Number(process.env.PORT || 8080);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        server,
        port: typeof address === 'object' && address ? address.port : port,
        close() {
          return new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          });
        },
      });
    });
  });
}

/**
 * @param {string} root
 * @param {string} pathname
 */
function resolveStaticFile(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, '');
  if (relative.split(/[\\/]/).includes('..')) return null;
  const candidates = relative === '' || relative.endsWith('/')
    ? [path.join(relative, 'index.html')]
    : [relative, path.join(relative, 'index.html')];
  for (const candidate of candidates) {
    const absolute = path.resolve(root, candidate);
    if (!isInside(root, absolute)) return null;
    if (existsSync(absolute) && statSync(absolute).isFile()) return absolute;
  }
  if (!path.extname(decoded)) {
    const indexFile = path.resolve(root, 'index.html');
    if (isInside(root, indexFile) && existsSync(indexFile)) return indexFile;
  }
  return null;
}

/**
 * @param {string} root
 * @param {string} absolute
 */
function isInside(root, absolute) {
  const resolvedRoot = path.resolve(root);
  return absolute === resolvedRoot || absolute.startsWith(`${resolvedRoot}${path.sep}`);
}

/**
 * @param {string} filePath
 */
function contentType(filePath) {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
}

/**
 * @param {import('node:http').ServerResponse} nodeRes
 * @param {Response} response
 */
async function writeFetchResponse(nodeRes, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const body = Buffer.from(await response.arrayBuffer());
  nodeRes.writeHead(response.status, headers);
  nodeRes.end(body);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const staticRoot = path.resolve(process.env.STATIC_ROOT || 'dist');
  if (!existsSync(staticRoot)) {
    console.error('Static root is missing');
    process.exit(1);
  }
  startStaticServer({ staticRoot })
    .then(({ port }) => {
      console.log(`chat demo listening on ${port}`);
    })
    .catch(() => {
      console.error('Failed to start');
      process.exit(1);
    });
}
