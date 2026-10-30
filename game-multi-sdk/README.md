# game-multi-sdk

Multiplayer game SDK monorepo supporting two transport modes:

- **SERVER** — Authoritative WebSocket server (strategy / simulation games)
- **RTC_HOST** — WebRTC Full Mesh by default, with optional host-relayed Star mode

## Packages

| Package | Description |
|---------|-------------|
| `@game-multi-sdk/core` | Shared interfaces & types (`IGameTransport`) |
| `@game-multi-sdk/transport-server` | WebSocket authoritative server transport |
| `@game-multi-sdk/transport-rtc-host` | Configurable Full Mesh / Star WebRTC transport |
| `@game-multi-sdk/react` | React Context & Hooks binding |

## Quick Start

```bash
npm install
npm run build
npm test
npm run typecheck
```

See each package's README for usage examples. The RTC host transport requires
an endpoint compatible with the PeerJS signaling protocol; a generic REST
signaling endpoint is not sufficient.

`npm test` runs core RTC configuration and transport MVP tests with Node.js's
built-in test runner. The transport tests use a fake peer, so they do not
require a signaling server or browser. They cover configuration precedence,
TURN credentials, and configuration preservation when reconnecting.
RTC reconnect is enabled by default and retries every five seconds. Use
`reconnect: { enabled: false }` or set `intervalMs` in `TransportOptions` to
customize its behavior.

## Configurable RTC topology

```ts
await transport.connect({
  role: 'client', // The initial 'host' creates the room and coordinates membership.
  roomId: 'room-123',
  userId: 'player-1',
  endpoint: 'https://peerjs.example.com',
  topology: 'full-mesh', // Default when omitted; use 'star' for host forwarding.
});
```

Every participant must choose the same topology. **The default changed from
Star to Full Mesh**; existing applications needing host relay must explicitly
pass `topology: 'star'`. The category and package name remain `RTC_HOST` and
`transport-rtc-host` for compatibility; no server transport is introduced.

Full Mesh discovers members through a coordinator, then connects every pair
directly. `send()` broadcasts over those direct channels; `targetId` addresses
a peer directly, and `getPeers()` lists all locally open, admitted peer routes.
An established room continues exchanging messages after coordinator loss,
even with automatic migration disabled. Auto migration restores the
coordinator needed for new joins. Signaling and STUN/TURN remain necessary.

In mesh, `connect()` resolves once admitted by the coordinator, not once every
pair has finished ICE negotiation. Observe `onPeersChanged` for actual reachable
peers. Failed/missing routes are reported through `onError`; broadcasts send
to reachable members only, without host fallback, queuing, or replay.

## Production WebRTC and topology limits

Supply `rtcConfiguration: RTCConfiguration` on both host and client to configure
your own STUN/TURN service, TURN credentials, and relay-only routing. The legacy
`iceServers` option remains supported. Obtain short-lived TURN credentials from
your backend rather than embedding permanent credentials in a browser bundle.
See the [RTC transport guide](packages/transport-rtc-host/README.md) for examples,
precedence rules, relay testing, and credential renewal limitations.

RTC_HOST targets small, low-traffic casual rooms: start with 4-6 total players
and load-test your application. This is guidance, not a hard cap or guarantee.
Mesh requires `N * (N - 1) / 2` bidirectional pair channels and `N - 1` uploads
per player for each broadcast. Connection count is quadratic, not exponential;
Mesh does not provide unlimited scale or guaranteed latency. Star concentrates
forwarding bandwidth on the host. **Host migration is automatic by default**:
clients use the last host roster to elect a successor after a 5-second
connection-loss deadline. Heartbeats detect silent failures. Use
`hostMigration: { mode: 'manual' }` for host-requested handoffs only, or
`{ mode: 'disabled' }` to opt out; `timeoutMs` customizes the election deadline.
The host can call `transferHost(userId)` in auto or manual mode. Subscribe to
`onHostChanged` and use `getHost().peerId` for updated room discovery.
Migration restores mesh coordination or star routing, without state replication or message replay,
and network partitions can produce competing hosts. See the
[migration guide](packages/transport-rtc-host/README.md#host-migration). Larger,
competitive, or persistent games should use an authoritative backend.
`transport-server` is currently only a scaffold.

React `GameProvider` keeps `useGameRoom().connected`, `peers`, and `isHost`
in sync during migration. Transport and connection failures are exposed as
`useGameRoom().error`; unsubscribe cleanup runs when the provider disconnects.

## Automated tests

Run `npm test` from this SDK directory after installing dependencies. This builds
core and the RTC transport, then runs their Node-native tests. Coverage includes
default automatic failover, the five-second default election delay, repeated
manual handoffs, full-mesh pair counts, direct/private delivery and sender
identity, coordinator-independent traffic, late joins after migration, pair
reconnection, topology mismatch rejection, failed-candidate fallback, silent-host heartbeats, healed
connections, disabled/manual policies, migration cancellation and validation,
reconnection, and ICE/TURN configuration.

This repository uses npm workspaces. PeerJS is an internal dependency of
`@game-multi-sdk/core`; other packages consume the RTC peer API through core.

## Development Order

1. `packages/core` — interface contract
2. `packages/transport-server` — WebSocket mode
3. `packages/transport-rtc-host` — RTC Host mode
4. `packages/react` — React bindings
5. Spring Boot signaling + server backend
