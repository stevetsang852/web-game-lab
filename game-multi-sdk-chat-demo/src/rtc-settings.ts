export interface RtcSettings {
  stunUrls: string;
  turnUrls: string;
  turnUsername: string;
  turnCredential: string;
  relayOnly: boolean;
}

const DEFAULT_STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
];

/**
 * Open Relay / Metered static-auth TURN. PeerJS cloud TURN
 * (`*.turn.peerjs.com`) has no DNS records, and passing a STUN-only
 * `iceServers` list replaces PeerJS defaults instead of merging with them.
 * These public values are best-effort demo defaults, not a private relay.
 */
const OPEN_RELAY_HOST = 'staticauth.openrelay.metered.ca';
const OPEN_RELAY_SECRET = 'openrelayprojectsecret';
const OPEN_RELAY_TURN_URLS = [
  `turn:${OPEN_RELAY_HOST}:80`,
  `turn:${OPEN_RELAY_HOST}:80?transport=tcp`,
  `turn:${OPEN_RELAY_HOST}:443`,
  `turns:${OPEN_RELAY_HOST}:443?transport=tcp`,
];
const OPEN_RELAY_STATIC_USER = 'openrelayproject';
const OPEN_RELAY_STATIC_CREDENTIAL = 'openrelayproject';
const OPEN_RELAY_TTL_SECONDS = 6 * 60 * 60;

const DATA_CHANNEL_TIMEOUT =
  /timed out before the data channel opened|data channel timed out before it opened/i;

export interface IceLookup {
  fetchImpl?: typeof fetch;
  /** Absolute credential URL. Defaults to same-origin `/turn` in the browser. */
  turnEndpoint?: string;
}

/**
 * Credential URL. `configuredBase` is an origin or an absolute `/turn` URL.
 * An empty base uses `origin` + `pageBase` (Vite `BASE_URL`).
 */
export function resolveTurnEndpoint(options: {
  configuredBase?: string;
  pageBase?: string;
  origin?: string;
}): string | undefined {
  const configured = options.configuredBase?.trim();
  if (configured) {
    if (/\/turn\/?$/i.test(configured)) return configured.replace(/\/$/, '');
    const withSlash = configured.endsWith('/') ? configured : `${configured}/`;
    return new URL('turn', withSlash).href;
  }
  if (!options.origin) return undefined;
  const pageBase = options.pageBase?.trim() || '/';
  const absoluteBase = new URL(pageBase, options.origin.endsWith('/') ? options.origin : `${options.origin}/`);
  const baseHref = absoluteBase.href.endsWith('/') ? absoluteBase.href : `${absoluteBase.href}/`;
  return new URL('turn', baseHref).href;
}

export async function createRtcConfiguration(
  settings: RtcSettings,
  nowMs = Date.now(),
  lookup?: IceLookup,
): Promise<RTCConfiguration> {
  const stunUrls = parseUrls(settings.stunUrls, /^stuns?:\S+$/i, 'STUN');
  const turnUrls = parseUrls(settings.turnUrls, /^turns?:\S+$/i, 'TURN');
  if (turnUrls.length === 0 && (settings.turnUsername || settings.turnCredential)) {
    throw new Error('TURN credentials require a TURN server URL.');
  }
  if (turnUrls.length > 0 && (!settings.turnUsername.trim() || !settings.turnCredential)) {
    throw new Error('Enter the TURN username and credential provided by your TURN service.');
  }

  // Empty Advanced ICE must not install Google STUN alone: PeerJS replaces its
  // whole config with that list. Ask the same-origin (or VITE_TURN_BASE_URL)
  // credential endpoint for standard iceServers first. If that host is down,
  // keep the public relay so a static republish still has a best-effort path.
  if (stunUrls.length === 0 && turnUrls.length === 0) {
    const hosted = await loadHostedIceServers(lookup);
    if (hosted && hosted.length > 0) {
      if (settings.relayOnly && !iceServersIncludeTurn(hosted)) {
        throw new Error('Relay-only mode requires a TURN server.');
      }
      return {
        iceServers: hosted,
        iceTransportPolicy: settings.relayOnly ? 'relay' : 'all',
      };
    }
    if (settings.relayOnly) {
      throw new Error('Relay-only mode requires a TURN server.');
    }
    return {
      iceServers: await defaultIceServers(nowMs),
      iceTransportPolicy: 'all',
    };
  }

  if (settings.relayOnly && turnUrls.length === 0) {
    throw new Error('Relay-only mode requires a TURN server.');
  }

  const iceServers: RTCIceServer[] = [];
  const effectiveStun = stunUrls.length > 0 ? stunUrls : DEFAULT_STUN_URLS;
  iceServers.push({ urls: effectiveStun });

  if (turnUrls.length > 0) {
    iceServers.push({
      urls: turnUrls,
      username: settings.turnUsername.trim(),
      credential: settings.turnCredential,
    });
  }

  return {
    iceServers,
    iceTransportPolicy: settings.relayOnly ? 'relay' : 'all',
  };
}

export function explainConnectionError(message: string): string {
  if (!DATA_CHANNEL_TIMEOUT.test(message)) return message;
  return `${message} ICE could not open the data channel across NAT. An empty Advanced panel requests short-lived iceServers from /turn and otherwise uses the public relay. Set a TURN server under Advanced WebRTC / TURN settings on every window (PeerJS cloud TURN is unreliable; a local PeerJS broker only replaces signaling and does not fix cross-network ICE).`;
}

async function loadHostedIceServers(lookup?: IceLookup): Promise<RTCIceServer[] | undefined> {
  const endpoint = lookup?.turnEndpoint ?? browserTurnEndpoint();
  if (!endpoint) return undefined;
  const fetchImpl = lookup?.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) return undefined;
  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return undefined;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) return undefined;
    return parseHostedIceServers(await response.json());
  } catch {
    return undefined;
  }
}

function browserTurnEndpoint(): string | undefined {
  const origin = typeof location === 'undefined' ? undefined : location.origin;
  return resolveTurnEndpoint({
    configuredBase: readViteEnv('VITE_TURN_BASE_URL'),
    pageBase: readViteEnv('BASE_URL') ?? '/',
    origin,
  });
}

function readViteEnv(name: string): string | undefined {
  const meta = import.meta as ImportMeta & { env?: Record<string, unknown> };
  const value = meta.env?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseHostedIceServers(body: unknown): RTCIceServer[] | undefined {
  const list = Array.isArray(body)
    ? body
    : (isRecord(body) && 'iceServers' in body ? body.iceServers : undefined);
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const servers: RTCIceServer[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) return undefined;
    const rawUrls: unknown[] = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    if (!rawUrls.every((url): url is string => typeof url === 'string' && /^(stuns?|turns?):/i.test(url))) return undefined;
    const urls = rawUrls.filter((url) => !usesBlockedBrowserPort(url));
    if (urls.length === 0) continue;
    const server: RTCIceServer = { urls: urls.length === 1 ? urls[0] : urls };
    const hasUsername = typeof entry.username === 'string' && entry.username.length > 0;
    const hasCredential = typeof entry.credential === 'string' && entry.credential.length > 0;
    if (hasUsername !== hasCredential) return undefined;
    if (hasUsername && hasCredential) {
      server.username = entry.username as string;
      server.credential = entry.credential as string;
    }
    servers.push(server);
  }
  return servers.length > 0 ? servers : undefined;
}

function usesBlockedBrowserPort(url: string): boolean {
  const schemeSep = url.indexOf(':');
  if (schemeSep <= 0) return false;
  const rest = url.slice(schemeSep + 1);
  const queryAt = rest.search(/[?#]/);
  const authority = queryAt === -1 ? rest : rest.slice(0, queryAt);
  const colon = authority.lastIndexOf(':');
  if (colon === -1) return false;
  return authority.slice(colon + 1) === '53';
}

function iceServersIncludeTurn(servers: RTCIceServer[]): boolean {
  return servers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => /^turns?:/i.test(url));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function defaultIceServers(nowMs: number): Promise<RTCIceServer[]> {
  const expiry = Math.floor(nowMs / 1000) + OPEN_RELAY_TTL_SECONDS;
  const restUsername = `${expiry}:gmsdk`;
  const servers: RTCIceServer[] = [
    { urls: DEFAULT_STUN_URLS },
    {
      urls: OPEN_RELAY_TURN_URLS,
      username: OPEN_RELAY_STATIC_USER,
      credential: OPEN_RELAY_STATIC_CREDENTIAL,
    },
  ];
  const restCredential = await mintOpenRelayCredential(restUsername);
  if (restCredential) {
    servers.push({
      urls: OPEN_RELAY_TURN_URLS,
      username: restUsername,
      credential: restCredential,
    });
  }
  return servers;
}

/** TURN REST password: base64(HMAC-SHA1(secret, username)). */
async function mintOpenRelayCredential(username: string): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  try {
    const key = await subtle.importKey(
      'raw',
      new TextEncoder().encode(OPEN_RELAY_SECRET),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const signature = await subtle.sign('HMAC', key, new TextEncoder().encode(username));
    return bytesToBase64(new Uint8Array(signature));
  } catch {
    return undefined;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function parseUrls(value: string, pattern: RegExp, label: string): string[] {
  const urls = value.split(/[,\s]+/).filter(Boolean);
  if (urls.some((url) => !pattern.test(url))) {
    throw new Error(`Use ${label.toLowerCase()}: or ${label.toLowerCase()}s: URLs for ${label} servers.`);
  }
  return urls;
}
