/**
 * Short-lived WebRTC ICE credentials.
 *
 * The browser only ever receives standard `iceServers` (`RTCIceServer[]`).
 * Provider secrets stay in this process. `TURN_PROVIDER` selects the backend:
 *   - cloudflare (implemented): Cloudflare Realtime TURN
 *   - metered, coturn (reserved): same response shape, not implemented yet
 *
 * WS rooms and SFU are out of scope. This module does not speak PeerJS.
 */

const CLOUDFLARE_ICE_URL = 'https://rtc.live.cloudflare.com/v1/turn/keys';
const DEFAULT_TTL_SECONDS = 3600;
const MIN_TTL_SECONDS = 1;
const MAX_TTL_SECONDS = 172800;

/** Public STUN kept beside the provider list so the client is not CF-only. */
const PUBLIC_STUN_URLS = [
  'stun:stun.cloudflare.com:3478',
  'stun:stun.l.google.com:19302',
];

export class TurnRequestError extends Error {
  /**
   * @param {string} message Safe to return to the browser. Never include secrets.
   * @param {number} status
   */
  constructor(message, status) {
    super(message);
    this.name = 'TurnRequestError';
    this.status = status;
  }
}

/**
 * @param {string} pathname
 */
export function isTurnPathname(pathname) {
  const trimmed = pathname.replace(/\/+$/, '') || '/';
  return trimmed === '/turn' || trimmed.endsWith('/turn');
}

/**
 * Browsers block WebRTC on port 53 (Chrome's restricted-port list).
 * @param {string} url
 */
export function usesBlockedBrowserPort(url) {
  const schemeSep = url.indexOf(':');
  if (schemeSep <= 0) return false;
  const rest = url.slice(schemeSep + 1);
  const queryAt = rest.search(/[?#]/);
  const authority = queryAt === -1 ? rest : rest.slice(0, queryAt);
  const colon = authority.lastIndexOf(':');
  if (colon === -1) return false;
  return authority.slice(colon + 1) === '53';
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 * @returns {Promise<RTCIceServerLike[]>}
 */
export async function generateIceServers(env = {}, deps = {}) {
  const provider = (envString(env, 'TURN_PROVIDER') || 'cloudflare').toLowerCase();
  if (provider === 'cloudflare') return generateCloudflareIceServers(env, deps);
  if (provider === 'metered') return generateMeteredIceServers();
  if (provider === 'coturn') return generateCoturnIceServers();
  throw new TurnRequestError('TURN_PROVIDER is not supported', 400);
}

/**
 * @param {Request} request
 * @param {Record<string, string | undefined>} [env]
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 * @returns {Promise<Response | null>} Null when the path is not `/turn`.
 */
export async function handleTurnRequest(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  if (!isTurnPathname(url.pathname)) return null;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: baseHeaders() });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse({ error: 'Method not allowed' }, 405, request.method === 'HEAD');
  }

  try {
    const iceServers = await generateIceServers(env, deps);
    return jsonResponse({ iceServers }, 200, request.method === 'HEAD');
  } catch (error) {
    const status = error instanceof TurnRequestError ? error.status : 500;
    const message = error instanceof TurnRequestError ? error.message : 'TURN credential endpoint failed';
    return jsonResponse({ error: message }, status, request.method === 'HEAD');
  }
}

async function generateCloudflareIceServers(env, deps) {
  const keyId = envString(env, 'CF_TURN_KEY_ID');
  const apiToken = envString(env, 'CF_TURN_KEY_API_TOKEN');
  if (!keyId || !apiToken) {
    throw new TurnRequestError('TURN provider is not configured', 503);
  }

  const ttl = resolveTtl(env);
  const endpoint = `${CLOUDFLARE_ICE_URL}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;
  let response;
  try {
    response = await (deps.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ ttl }),
    });
  } catch {
    throw new TurnRequestError('TURN credential provider unreachable', 502);
  }

  if (!response.ok) {
    throw new TurnRequestError('TURN credential provider failed', 502);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new TurnRequestError('TURN credential provider failed', 502);
  }

  const iceServers = adaptIceServers(payload?.iceServers);
  if (!iceServers) {
    throw new TurnRequestError('TURN credential provider failed', 502);
  }
  return iceServers;
}

/**
 * Reserved. A future Metered implementation should return the same `iceServers` shape.
 */
function generateMeteredIceServers() {
  throw new TurnRequestError('TURN_PROVIDER is not implemented', 501);
}

/**
 * Reserved. A future coturn implementation (TURN REST / use-auth-secret)
 * should return the same `iceServers` shape.
 */
function generateCoturnIceServers() {
  throw new TurnRequestError('TURN_PROVIDER is not implemented', 501);
}

/**
 * @param {unknown} list
 * @returns {RTCIceServerLike[] | undefined}
 */
export function adaptIceServers(list) {
  if (!Array.isArray(list)) return undefined;
  /** @type {RTCIceServerLike[]} */
  const servers = [];
  for (const entry of list) {
    const normalized = normalizeIceServer(entry);
    if (normalized) servers.push(normalized);
  }
  if (servers.length === 0) return undefined;

  const seen = new Set(servers.flatMap((server) => asUrls(server.urls)));
  const missingStun = PUBLIC_STUN_URLS.filter((url) => !seen.has(url));
  if (missingStun.length > 0) servers.unshift({ urls: missingStun });
  return servers;
}

/**
 * @param {unknown} entry
 * @returns {RTCIceServerLike | undefined}
 */
function normalizeIceServer(entry) {
  if (!entry || typeof entry !== 'object') return undefined;
  const record = /** @type {{ urls?: unknown, username?: unknown, credential?: unknown }} */ (entry);
  const rawUrls = Array.isArray(record.urls) ? record.urls : [record.urls];
  if (!rawUrls.every((url) => typeof url === 'string' && /^(stuns?|turns?):/i.test(url))) return undefined;
  const urls = rawUrls.filter((url) => !usesBlockedBrowserPort(url));
  if (urls.length === 0) return undefined;

  /** @type {RTCIceServerLike} */
  const server = { urls: urls.length === 1 ? urls[0] : urls };
  const hasUsername = typeof record.username === 'string' && record.username.length > 0;
  const hasCredential = typeof record.credential === 'string' && record.credential.length > 0;
  if (hasUsername && hasCredential) {
    server.username = record.username;
    server.credential = record.credential;
  }
  return server;
}

/**
 * @param {Record<string, string | undefined>} env
 */
function resolveTtl(env) {
  const raw = envString(env, 'TURN_TTL_SECONDS');
  if (!raw) return DEFAULT_TTL_SECONDS;
  if (!/^\d+$/.test(raw)) {
    throw new TurnRequestError('TURN_TTL_SECONDS is invalid', 500);
  }
  const ttl = Number(raw);
  if (ttl < MIN_TTL_SECONDS || ttl > MAX_TTL_SECONDS) {
    throw new TurnRequestError('TURN_TTL_SECONDS is invalid', 500);
  }
  return ttl;
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 */
function envString(env, name) {
  const value = env?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {string | string[]} urls
 */
function asUrls(urls) {
  return Array.isArray(urls) ? urls : [urls];
}

function baseHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'Accept, Content-Type',
    'access-control-max-age': '600',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
}

/**
 * @param {Record<string, unknown>} body
 * @param {number} status
 * @param {boolean} head
 */
function jsonResponse(body, status, head) {
  const encoded = JSON.stringify(body);
  const bytes = new TextEncoder().encode(encoded);
  return new Response(head ? null : bytes, {
    status,
    headers: {
      ...baseHeaders(),
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(bytes.byteLength),
    },
  });
}

/**
 * @typedef {{ urls: string | string[], username?: string, credential?: string }} RTCIceServerLike
 */
