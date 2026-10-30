# Game Multi SDK Chat Demo

A standalone React + Vite chat room app that consumes the sibling
`game-multi-sdk` packages through local npm file dependencies. The demo is
intentionally outside the SDK npm workspace.

## Public demo

Primary HTTPS URL (no local Vite):

https://yin-game-lab.grok.me

The live page is the RTC Chat Room. This checkout is demo **0.2.3** / SDK **0.1.3**.
Pushing the repository does not update https://yin-game-lab.grok.me; that host
changes only when it is republished. The page uses PeerJS Cloud at
`https://0.peerjs.com` (secure WebSocket on port 443 because the page is HTTPS).
It is served from the site root. Local and Docker builds also omit
`VITE_BASE_PATH` and stay at `/`.

### Multi-browser test (4-person party)

Acceptance is four real browsers in one Full Mesh room on that URL. PeerJS
Cloud room IDs are global, so choose a unique room ID for the party.

1. Open https://yin-game-lab.grok.me in **4** browser windows or tabs.
2. Keep the same room ID, `https://0.peerjs.com`, and **Full Mesh** in all four.
3. First window: **Create room (host)**, then connect.
4. The other three windows: **Join room (client)** with that room ID, then
   connect. All four must be in the room.
5. Send one chat message from each window. Each message must show up in the
   other three windows.
6. Screenshot all four windows (shared room, peer count, and messages).

### Backup host (GitHub Pages)

Optional, and not the acceptance URL. Run the manual workflow
**Backup: GitHub Pages chat demo** (`.github/workflows/pages.yml`) after
**Settings → Pages → Source** is **GitHub Actions**. That build sets
`VITE_BASE_PATH=/web-game-lab/` and publishes:

https://stevetsang852.github.io/web-game-lab/

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

3. Open the Vite URL in four browser windows. Keep the same signaling endpoint,
   room ID, and **Network topology** in every window. Create the room in one
   window and join it from the other three. Full Mesh is selected by default.
   The 4-person acceptance path is https://yin-game-lab.grok.me.

## Run with Docker

From `game-multi-sdk-chat-demo`, build and start the demo:

```bash
docker compose up --build
```

Open `http://localhost:8080` in four browser windows to test the chat room.
Docker serves plain HTTP on localhost. For a public HTTPS session, use
https://yin-game-lab.grok.me.

The Compose build uses the parent directory as its context so it can include
the sibling `game-multi-sdk` packages. The image build also runs the SDK build,
the SDK MVP tests, and the demo production build. The runtime uses an
unprivileged Nginx image and exposes only the static app port.

The default signaling endpoint is PeerJS Cloud (`https://0.peerjs.com`). You can
replace it with any compatible PeerJS signaling server. The server is used for
connection setup; chat data is exchanged through WebRTC data channels. Browsers
may require HTTPS outside localhost.

## STUN / TURN and restricted networks

Same-LAN and same-machine parties can connect with host candidates. A hosted
room such as https://yin-game-lab.grok.me, or any two browsers on different
networks, needs a working TURN relay. PeerJS signaling is not that relay.

Leave **Advanced WebRTC / TURN settings** empty to use the demo defaults:

- Google STUN (`stun.l.google.com` / `stun1.l.google.com`) for server-reflexive
  candidates.
- A best-effort public TURN relay on `staticauth.openrelay.metered.ca`
  (Open Relay / Metered), on ports 80 and 443, UDP and TCP, including `turns:`.
  The demo mints a short-lived TURN REST username from Open Relay's published
  static-auth secret and also tries the public `openrelayproject` username.
  Open Relay may rate-limit or reject these shared credentials.

That default list is intentional. An empty panel used to pass Google STUN only.
PeerJS replaces its whole `config` with the `iceServers` it is given, so a
STUN-only list removed PeerJS's own TURN entries. Those names
(`eu-0.turn.peerjs.com`, `us-0.turn.peerjs.com`) have no DNS records, so putting
them back does not cross NAT either. Do not rely on PeerJS cloud TURN.

A local broker (`npx peerjs --port 9000`) only replaces signaling. It does not
give two networks a path to each other.

To use your own relay, open **Advanced WebRTC / TURN settings** in every window
before connecting:

- Supply STUN and/or TURN URLs, separated by commas or whitespace.
- Enter your TURN service's temporary username and credential.
- Enable **Relay only** to require TURN and verify a relay route instead of
  relying on direct connectivity.

Custom URLs replace the built-in Open Relay list; they are not merged with it.
If you set TURN and leave STUN blank, Google STUN is still added. If you set
STUN URLs, only those STUN URLs are used, plus your TURN server when you
entered one. TURN URLs accept `turn:` or `turns:` schemes (for example
`turns:turn.example.com:443?transport=tcp`). Relay-only mode requires TURN
URLs; the demo reports missing credentials or invalid URL schemes before
connecting.

The form keeps credentials in memory, not browser storage or URL parameters;
the credential input is masked. For a private relay, use short-lived
credentials from an authenticated backend. The built-in Open Relay values are
published demo defaults, not a secret. Automatic credential refresh is not
provided: disconnect and reconnect with fresh credentials when required.

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

Demo version: **0.2.3**. The header and footer show `SDK_VERSION` from `@game-multi-sdk/core` (currently **0.1.3**) and this demo version (`DEMO_VERSION`).

The four-browser Full Mesh procedure is in [TEST.md](../TEST.md).

**Rule**: When updating the demo or SDK code, also update the versions in `package.json` and the `SDK_VERSION` constant.

## Support the Developer (PayMe)

If you find this useful, please star the repo, try it out, or support development via [PayMe](https://payme.hsbc/d6d295dff7854566b4536a98f0b02ef8). Every bit helps me keep building.
