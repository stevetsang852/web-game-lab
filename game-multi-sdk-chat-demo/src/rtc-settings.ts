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

export function createRtcConfiguration(settings: RtcSettings): RTCConfiguration | undefined {
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

  const iceServers: RTCIceServer[] = [];
  // Always include reliable public STUN so ICE can gather host/srflx candidates
  // even when the user leaves the Advanced panel empty.
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

function parseUrls(value: string, pattern: RegExp, label: string): string[] {
  const urls = value.split(/[,\s]+/).filter(Boolean);
  if (urls.some((url) => !pattern.test(url))) {
    throw new Error(`Use ${label.toLowerCase()}: or ${label.toLowerCase()}s: URLs for ${label} servers.`);
  }
  return urls;
}
