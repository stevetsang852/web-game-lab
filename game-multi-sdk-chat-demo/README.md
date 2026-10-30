# Game Multi SDK Chat Demo

A standalone React + Vite chat room app that consumes the sibling
`game-multi-sdk` packages through local npm file dependencies. The demo is
intentionally outside the SDK npm workspace.

## Run locally

1. In `game-multi-sdk`, install dependencies and build the SDK packages:

   ```bash
   npm install
   npm run build
   ```

2. In `game-multi-sdk-chat-demo`, install and run the demo:

   ```bash
   npm install
   npm run dev
   ```

3. Open the Vite URL in three browser windows. Keep the same signaling endpoint,
   room ID, and **Network topology** in every window. Create the room in one
   window and join it in the others. Full Mesh is selected by default.

## Run with Docker

From `game-multi-sdk-chat-demo`, build and start the demo:

```bash
docker compose up --build
```

Open `http://localhost:8080` in two browser windows to test the chat room.
The Compose build uses the parent directory as its context so it can include
the sibling `game-multi-sdk` packages. The image build also runs the SDK build,
the SDK MVP tests, and the demo production build. The runtime uses an
unprivileged Nginx image and exposes only the static app port.

The default signaling endpoint is PeerJS Cloud (`https://0.peerjs.com`). You can
replace it with any compatible PeerJS signaling server. The server is used for
connection setup; chat data is exchanged through WebRTC data channels. Browsers
may require HTTPS outside localhost.

## STUN / TURN and restricted networks

Open **Advanced WebRTC / TURN settings** before connecting in each browser:

- Supply STUN and/or TURN URLs, separated by commas or whitespace.
- Enter your TURN service's temporary username and credential.
- Enable **Relay only** to require TURN and verify a relay route instead of
  relying on direct connectivity.

These settings are passed as `RTCConfiguration` to the SDK on both host and
clients. TURN URLs accept `turn:` or `turns:` schemes (for example
`turns:turn.example.com:443?transport=tcp`). Relay-only mode requires TURN URLs;
the demo reports missing credentials or invalid URL schemes before connecting.
When all fields are empty, PeerJS defaults are used. Once custom servers are
specified, only that server list is used; add any STUN servers you also need.

The form keeps credentials in memory, not browser storage or URL parameters;
the credential input is masked. Use short-lived credentials from an
authenticated backend, never permanent shared secrets in a frontend bundle.
Automatic credential refresh is not provided: disconnect and reconnect with
fresh credentials when required.

For manual deployment verification, configure a real TURN service on both
windows, select relay-only mode, connect, and exchange messages in both
directions. Inspect the selected ICE candidate pair in your browser's WebRTC
diagnostics to confirm a relay candidate is used. Unit tests do not validate
a live TURN service, firewall traversal, or its credentials.

## Topology and host availability

This demo targets small, low-traffic rooms (start with 4-6 total players and
load-test). **Network topology** offers **Full Mesh** (default, direct channels
between every pair) and **Star** (all client traffic relayed by the host).
Every window must use the same topology; mismatches are rejected.

To verify mesh behavior, connect three windows, exchange messages, then close
the initial host window. The other two retain their direct channel and can
continue chatting immediately, even before a new coordinator is elected.
The peer counter shows directly connected peers, not just the coordinator.
Each player uploads one copy per recipient; mesh is not a large-room solution.

The **Host migration**
selector defaults to **Automatic**: disconnect the current host and the remaining
clients elect a successor after the default 5-second deadline. Silent failures
are detected by heartbeats before that election deadline starts. The current
host can also choose **Transfer host to ...** for a connected participant;
the original host stays in the room as a client. **Manual handoff only**
disables automatic elections, and **Disabled** opts out of migration.

The UI shows the current topology, coordinator/host, and its PeerJS ID.
In Mesh, chatting stays available over existing routes during coordinator
migration; in Star, sending pauses during host migration.
Existing chat history stays local; migration does not replicate
game state or replay missed messages. Elections are best-effort and network
partitions can create competing hosts. After migration, a new participant
must keep the original Room ID and enter the displayed address in
**Current host PeerJS ID** before joining. That field defaults to the Room ID
when empty. The original host address is not a permanent room directory. See the SDK
[migration guide](../game-multi-sdk/packages/transport-rtc-host/README.md#host-migration)
for discovery and state synchronization requirements. TURN improves network
reachability, not consensus or game-state recovery.

## Publish and install

Before sharing this demo outside this checkout, publish the SDK packages and
replace the `file:` dependencies in `package.json` with the published versions.

## Versioning

Demo version: **0.2.0**. It displays the SDK version (`SDK_VERSION` from `@game-multi-sdk/core`, currently **0.1.0**) in the UI header and footer.

**Rule**: When updating the demo or SDK code, also update the versions in `package.json` and the `SDK_VERSION` constant.

## Support the Developer (PayMe)

Copied from the [Mallow: Ashen Vow](https://github.com/stevetsang852/mallow-ashen-vow) project:

> 謝謝你陪騎士貓走到這裡。  
> 如果牠的戰鬥讓你覺得過瘓，也想看牠繼續打下去，  
> 歡迎用 PayMe 支持我。  
> 你的一份心意，會變成下一場冒險的燃料。

[Pay with PayMe](https://payme.hsbc/d6d295dff7854566b4536a98f0b02ef8)

Your support fuels the next adventure.
