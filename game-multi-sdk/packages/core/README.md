# @game-multi-sdk/core

Shared TypeScript interfaces and types for all game-multi-sdk transports.

## Core Contract

```ts
import type { IGameTransport, TransportOptions } from '@game-multi-sdk/core';
```

All transport implementations must satisfy `IGameTransport`.

The shared contract uses `unknown` for received and sent payloads so applications
can validate or narrow data at their own boundary. Message, peer-list, and error
subscriptions return unsubscribe functions.

The PeerJS integration is encapsulated and exported by `@game-multi-sdk/core`.
Other workspace packages should import the RTC peer API and its types from
`@game-multi-sdk/core`; they should not depend on or import `peerjs` directly.

## WebRTC configuration

`TransportOptions` and `RtcPeerOptions` accept a full
`rtcConfiguration?: RTCConfiguration`. The adapter passes it to PeerJS's
`config`, including TURN URLs, usernames, credentials, relay-only policy, and
other browser-supported WebRTC settings. Apply your settings to both host and
client transports.

The existing `iceServers?: RTCIceServer[]` shorthand remains supported.
`rtcConfiguration.iceServers` takes precedence (even when it is an empty
array); if omitted, the shorthand fills that field. If neither option is
provided, PeerJS defaults remain unchanged. `resolveRtcConfiguration` exports
the same merge behavior for integrations.

Use short-lived TURN credentials issued by your authenticated backend, never
permanent secrets bundled into frontend code. PeerJS signaling is not a TURN
relay. See the [RTC host transport guide](../transport-rtc-host/README.md)
for configuration examples and topology limitations.

## Host migration contract

`TransportOptions.topology?: RtcTopology` accepts `'full-mesh'` (the default)
or `'star'`. `RTC_HOST` remains the category for both; the initial host is the
membership coordinator in mesh mode, not a game-message relay. All members
must use the same topology. Existing host-relayed applications should
explicitly select `'star'` now that the default is Full Mesh.

`TransportOptions.hostMigration` configures RTC host migration. The default is
`{ mode: 'auto', timeoutMs: 5000 }`; `manual` permits host-requested handoffs only,
and `disabled` opts out. These options are independent of the reconnect policy.

Migration-aware transports expose optional `transferHost(userId)`, `getHost()`,
`onHostChanged(callback)`, and `isConnected()` methods. `HostChangedEvent`
includes the new `userId` / `peerId`, `previousHostId`, `reason`, and `migrating`.
In Star, pause sending when migration begins. In Full Mesh, existing direct
routes remain usable during coordinator migration: check `isConnected()` and
`getPeers()` instead of treating `migrating` as a room-wide outage. Synchronize
game state separately if your application uses host authority; a completed
event does not mean every pair has connected or every player's state is
current. New joiners keep the same logical `roomId` and pass the new coordinator
address as `hostPeerId`.
