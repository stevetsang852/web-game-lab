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

export async function createRtcConfiguration(
  settings: RtcSettings,
  nowMs = Date.now(),
): Promise<RTCConfiguration> {
  const stunUrls = parseUrls(settings.stunUrls, /^stuns?:\S+$/i, 'STUN');
  const turnUrls = parseUrls(settings.turnUrls, /^turns?:\S+$/i, 'TURN');
  if (settings.relayOnly && turnUrls.length === 0) {
    throw new Error('Relay-only mode requires a TURN server.');
  }
  if (turnUrls.length === 0 && (settings.turnUsername || settings.turnCredential)) {
    throw new Error('TURN credentials require a TURN server URL.');
  }
  if (turnUrls.length > 0 && (!settings.turnUsername.trim() || !settings.turnCredential)) {
    throw new Error('Enter the TURN username and credential provided by your TURN service.');
  }

  // Empty Advanced ICE must not install Google STUN alone: PeerJS replaces its
  // whole config with that list. Omit is not enough either — PeerJS cloud TURN
  // is unreachable, and the adapter still fills a STUN-only config when no
  // servers are passed. Ship a public TURN relay instead.
  if (stunUrls.length === 0 && turnUrls.length === 0) {
    return {
      iceServers: await defaultIceServers(nowMs),
      iceTransportPolicy: 'all',
    };
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
  return `${message} ICE could not open the data channel across NAT. Set a TURN server under Advanced WebRTC / TURN settings on every window (PeerJS cloud TURN is unreliable; a local PeerJS broker only replaces signaling and does not fix cross-network ICE).`;
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
