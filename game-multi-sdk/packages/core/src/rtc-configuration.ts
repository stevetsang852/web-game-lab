export interface RtcConfigurationOptions {
  /** Full configuration forwarded to RTCPeerConnection through PeerJS. */
  rtcConfiguration?: RTCConfiguration;
  /** Backwards-compatible shorthand used only if rtcConfiguration omits iceServers. */
  iceServers?: RTCIceServer[];
}

export function resolveRtcConfiguration(options: RtcConfigurationOptions): RTCConfiguration | undefined {
  const { rtcConfiguration, iceServers } = options;
  if (rtcConfiguration === undefined && iceServers === undefined) return undefined;

  const servers = rtcConfiguration?.iceServers ?? iceServers;
  return {
    ...rtcConfiguration,
    ...(servers === undefined ? {} : { iceServers: servers }),
  };
}
