# @game-multi-sdk/transport-rtc-host

PeerJS-based WebRTC transport with configurable **Full Mesh** (default) or
**Star** topology. The initial host owns the room PeerJS ID and coordinates
membership. In Mesh, every pair exchanges game messages directly; in Star,
the host relays client traffic. A migrated coordinator/host retains its own
existing PeerJS ID. The PeerJS
signaling server is only used to establish connections; game messages travel
over WebRTC data channels.

The PeerJS integration lives in `@game-multi-sdk/core`; this package depends on
core and does not import or depend on PeerJS directly.

`endpoint` must point to a compatible PeerJS signaling server, not a generic
HTTP API endpoint. Host and clients must use the same signaling server.

```ts
import { RtcHostTransport } from '@game-multi-sdk/transport-rtc-host';

const host = new RtcHostTransport();
await host.connect({
  role: 'host',
  roomId: 'room-123',
  userId: 'player-host',
  endpoint: 'https://peerjs.example.com',
  topology: 'full-mesh', // Default; use 'star' on every participant for host relay.
  // Configure STUN/TURN on BOTH host and clients; see the production example below.
});

host.onMessage((event, payload, senderId) => {
  console.log({ event, payload, senderId });
});
host.onPeersChanged((peerIds) => console.log('Peers:', peerIds));

// A client uses roomId as the host PeerJS ID unless hostPeerId is provided.
const client = new RtcHostTransport();
await client.connect({
  role: 'client',
  roomId: 'room-123',
  userId: 'player-1',
  endpoint: 'https://peerjs.example.com',
  topology: 'full-mesh',
  // Enabled by default; retries every 5 seconds.
  reconnect: { enabled: true, intervalMs: 5000 },
});

client.send('player-move', { x: 10, y: 20 });
```

`roomId` is the host's PeerJS ID when acting as host. A client creates its own
PeerJS ID and first connects to `hostPeerId ?? roomId` for discovery. All
participants must use the same logical `roomId`, signaling endpoint, and
topology. After migration, keep `roomId` unchanged and pass the new address as
`hostPeerId` when joining.

## Choosing a topology

`TransportOptions.topology` accepts `'full-mesh'` or `'star'`, with
**`'full-mesh'` as the default**. This changes previous behavior: applications
that require host relay must now set `topology: 'star'` on every participant.
Unknown values and mixed-topology admissions are rejected. The package name,
`RTC_HOST` category, factory injection, ICE configuration, and transport
interface are unchanged; `transport-server` is not involved.

| Behavior | Full Mesh (default) | Star |
|----------|---------------------|------|
| Game data | One direct bidirectional channel per pair; no host forwarding | Clients send through the host |
| Broadcast | One copy to each locally connected peer | Host fans out client messages |
| `targetId` | Direct peer user ID (or PeerJS ID) | Host can address clients; clients can address the host |
| `getPeers()` | Direct peers with open channels and mutual roster readiness | Host lists clients; client lists its host |
| Coordinator/host loss | Existing direct routes remain usable immediately | Traffic waits for recovery/migration |
| New joins | Require a reachable membership coordinator | Require a reachable host |

The mesh coordinator distributes membership addresses, not game messages.
It is **still a discovery dependency**, not a data-plane single point of
failure. `transferHost`, `getHost`, and `onHostChanged` refer to that coordinator
in mesh mode. The same links carry coordinator control packets and direct
messages: no extra relay-only or duplicate channel is created for each pair.
One deterministic dialer per pair prevents simultaneous duplicate connections.

Mesh `connect()` resolves after the coordinator admits the participant and
sends a valid roster. Other direct links may still be negotiating ICE.
Observe `onPeersChanged` / `getPeers()` before relying on a particular route.
Each pair confirms roster admission before it appears ready; an early direct
connection cannot bypass membership validation or accept premature sends.
`send(event, payload, { targetId })` throws for an unavailable target.
Broadcasts deliver to locally reachable peers; missing roster members are
reported through `onError`, with no relay fallback, queue, or replay.
The sender ID comes from the admitted direct channel, not the coordinator.

Pair failures are isolated from healthy links and retried at
`reconnect.intervalMs` (default 5000) when reconnect is enabled.
`reconnect.enabled: false` disables pair retries but does not prevent initial
mesh establishment or coordinator election. Heartbeats detect silent links,
including in manual/disabled migration mode. `disconnect()` clears pending
admissions, pair retry timers, heartbeats, and all channels.

An admitted direct route is not torn down just because a coordinator roster
temporarily omits it; the direct channel's close/heartbeat determines its
local availability. Room membership and election remain best-effort, not a
partition-safe consensus protocol.

PeerJS reliability is negotiated for the connection, so per-message
`SendOptions.reliable: false` is unsupported and throws. The default reliable
data channel is used. Configure TURN servers through `rtcConfiguration` (or
the backwards-compatible `iceServers` shorthand) when direct ICE connectivity
is not available; PeerJS signaling does not relay game data.

Automatic reconnect is enabled by default. RTC clients retry a lost host data
connection, and both roles recreate the PeerJS signaling peer if it closes.
Configure it with `reconnect: { enabled: false }` to disable retries or set a
custom positive `intervalMs` (default: `5000`). Calling `disconnect()` always
cancels pending retries.

## Host migration

Host migration is **automatic by default**, independently of reconnect:

```ts
await transport.connect({
  role: 'client',
  roomId: 'room-123',
  userId: 'player-1',
  endpoint: 'https://peerjs.example.com',
  hostMigration: { mode: 'auto', timeoutMs: 5000 },
});

const unsubscribe = transport.onHostChanged((event) => {
  console.log(event.userId, event.peerId, event.reason, event.migrating);
  // Pause gameplay on migrating=true and resynchronize your application state.
  // Publish event.peerId in your room directory after migration completes.
});

// Only the connected current host may request a handoff, in auto or manual mode.
transport.transferHost('player-2');
const currentHost = transport.getHost(); // { userId, peerId }, or null after disconnect()
const ready = transport.isConnected(); // Mesh session readiness; Star host-route readiness.
// Call unsubscribe() when the listener is no longer needed.
```

In Mesh, `isConnected()` instead indicates an admitted local session with a
live signaling peer; it remains true while the coordinator changes. Actual
reachability is given by `getPeers()`, and an isolated admitted participant
can have zero peers. Existing direct messages continue during migration.
Applications that depend on a single authoritative game host may still need
to pause game simulation and resynchronize their own state.

`mode: 'manual'` supports explicit handoff but never automatically promotes a
client when its host disappears. `mode: 'disabled'` rejects handoffs, ignores
migration instructions, and excludes that participant from host candidates.
Use the **same mode and timeout on all participants**; mixed migration policies
or older clients are not guaranteed to stay in the same room.

The host distributes a roster of user IDs and stable PeerJS IDs. After a
connection closes, clients allow `timeoutMs` (default `5000`) for recovery, then
choose the eligible surviving user ID in ascending string order. Each failed
candidate gets another `timeoutMs` connection deadline before clients advance
to the next candidate. `timeoutMs` must be positive and finite. User IDs must
be unique within the room.

Host heartbeats run at most every two seconds (more frequently for shorter
timeouts). Missing activity for `timeoutMs` closes a silent host connection
and starts the election delay; silent-host failover can therefore take roughly
two timeouts plus scheduling and connection overhead. A recovered host that
confirms its identity before election cancels failover.

Manual handoff announces a successor from the last roster. The successor
becomes host; in Star the original host and other clients reconnect as clients,
while Mesh keeps the existing pairwise channels and changes coordinator roles.
All participants keep their own PeerJS IDs and reuse their supplied ICE/TURN
configuration. Each transition emits `HostChangedEvent` with
`previousHostId` (a user ID), `reason: 'manual' | 'automatic'`, and
`migrating: true`, followed by `migrating: false` when local coordination
(Mesh) or the new host route (Star) is ready.
This does not mean every participant has already rejoined. Failures are
reported through `onError`; `disconnect()` cancels election, heartbeat, and
reconnect timers.

**Application responsibilities and limits:**

- Replicate authoritative game state ahead of failure and implement resync
  after promotion. The SDK migrates coordination/routing only: no state transfer, history,
  delivery replay, or exactly-once guarantee is provided.
- Update room discovery with `getHost().peerId` or the completed event's
  `peerId`. New clients must pass that value as `hostPeerId`; the original
  `roomId` no longer identifies the current host. There is no built-in directory.
- Treat election and manual handoff as **best-effort**, not quorum consensus
  or a transactional handoff. Network partitions, stale/different rosters,
  background-tab throttling, or lost handoff instructions can leave competing
  hosts or disconnected participants. A returning former host is not
  automatically reconciled. Use a backend for authoritative leadership.
- Membership and control messages are not an authentication layer. Authenticate
  participants and authorize room access in your signaling/application layer.
  Signaling availability and working ICE/TURN connectivity are still required.

## Production ICE / TURN configuration

STUN alone cannot establish connections across every NAT or firewall. Provide
your own TURN service for restricted networks. Signaling and TURN are different
services: PeerJS signaling discovers peers, while TURN relays WebRTC traffic
when a direct route is unavailable.

```ts
const transport = new RtcHostTransport();
// Fetch short-lived credentials from your authenticated backend before connecting.
// Never embed a TURN shared secret or permanent service credential in client code.
// temporaryUsername and temporaryCredential below are the backend-issued values.
const rtcConfiguration: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.example.com:3478' },
    {
      urls: [
        'turn:turn.example.com:3478?transport=udp',
        'turns:turn.example.com:443?transport=tcp',
      ],
      username: temporaryUsername,
      credential: temporaryCredential,
    },
  ],
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
};

await transport.connect({
  role: 'client', // Supply equivalent TURN configuration when creating the host.
  roomId: 'room-123',
  userId: 'player-1',
  endpoint: 'https://peerjs.example.com',
  rtcConfiguration,
});
```

The full `RTCConfiguration` is forwarded to PeerJS, including
`iceTransportPolicy`, `iceCandidatePoolSize`, and TURN `username` / `credential`.
Set `iceTransportPolicy: 'relay'` to require TURN (useful for testing a relay
deployment); this fails to connect if no usable TURN relay is available.
Leaving both options unset preserves PeerJS defaults.

For backwards compatibility, `iceServers` still works. If both options are
provided, `rtcConfiguration.iceServers` wins, including an explicit empty
array; otherwise the legacy `iceServers` array fills that field. Other
`rtcConfiguration` fields are preserved.

Reconnects reuse the supplied configuration. Credential renewal is not
automatic: retrieve fresh credentials before expiry and explicitly disconnect
and connect again with the new configuration. Configure TURN on both sides,
test UDP and TLS/TCP routes across your target networks, and budget for TURN
bandwidth. A TURN deployment improves reachability, not guaranteed connectivity.

## Topology limits and host availability

These are small-room browser-hosted topologies, not a highly available
multiplayer backend. Start with **4-6 total players** for low-traffic casual,
party, turn-based games, or prototypes, and load-test actual payload sizes,
message frequency, devices, and host uplink. This is sizing guidance, not an
enforced cap or a performance guarantee.

Full Mesh requires `N * (N - 1) / 2` pairwise bidirectional channels and `N - 1`
connections per player. Connection count grows **quadratically**, not
exponentially. Each broadcaster uploads a copy per recipient; bandwidth, CPU,
ICE negotiation, TURN bandwidth cost, and background-tab throttling still
limit scale. No fixed latency or large-room capacity is guaranteed.

In Star, every client-to-client message traverses the host browser. Host
upload, latency, CPU, and network quality affect the entire room. TURN relays
do not remove this application-level host bottleneck.

Automatic migration reduces the impact of a lost host by restoring routes
through a surviving browser. It does not remove host bottlenecks, provide
partition-safe consensus, or recover game state. Applications should pause
gameplay during migration and handle state synchronization or end the session
if recovery is impossible.

For larger rooms, competitive games, persistent state, or availability
requirements, use a real authoritative backend or another topology. The
`transport-server` package here remains a scaffold, not a production fallback.
Production availability requires authoritative leadership, split-brain
prevention, and application state replication beyond browser-only migration.
