# @game-multi-sdk/transport-rtc-host

PeerJS-based WebRTC transport with a star topology. The host owns the room PeerJS
ID and relays each client message to the other connected clients. The PeerJS
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
  // Optional STUN/TURN configuration:
  // iceServers: [{ urls: 'turn:turn.example.com', username: '...', credential: '...' }],
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
});

client.send('player-move', { x: 10, y: 20 });
```

`roomId` is the host's PeerJS ID when acting as host. A client creates its own
PeerJS ID and connects to `hostPeerId ?? roomId`. Host messages are relayed to
all other clients; `targetId` can target a connected peer by `userId`. Clients
can target the host by its PeerJS ID.

PeerJS reliability is negotiated for the connection, so per-message
`SendOptions.reliable: false` is unsupported and throws. The default reliable
data channel is used. Configure TURN servers through `iceServers` when direct
ICE connectivity is not available; PeerJS signaling does not relay game data.
