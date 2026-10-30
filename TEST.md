# Four-person Full Mesh party test

RTC_HOST **Full Mesh** only. Chat bytes go browser-to-browser over WebRTC data channels.
PeerJS is signaling, not the game server. `transport-server` stays a scaffold.

## Live v0.1.1 repro

Checked from this environment against https://yin-game-lab.grok.me (header `GAME MULTI SDK v0.1.1`, signaling `https://0.peerjs.com`, Full Mesh).

1. Host `ada` creates room `yinbugmvup8d8y` and reaches Connected with **0 connected peers**.
2. Client `bea` joins the same room and the same endpoint.
3. Bea never stays in the room. The form returns to Offline with **Connection lost. Reconnecting or electing a new host...** and **Disconnect / stop reconnecting**. The fields stay disabled while that transport is still held.
4. Ada remains at 0 peers. No chat is possible.

The deployed bundle only calls `strategy.onPeerOpen` for the host, and the mesh deadline is still `migrationTimeoutMs` from the moment `connect()` starts. A redeploy of SDK **0.1.3** clears that path. The same public broker (`https://0.peerjs.com`) with this branch admits two Chrome clients on one machine, shows **Party · 2**, and delivers chat both ways (`pubmeshmvup9zbg`).

## Hosted timeout after SDK 0.1.3 / demo 0.2.2

Checked on https://yin-game-lab.grok.me with Full Mesh, default `https://0.peerjs.com`, and Advanced STUN/TURN left empty.

1. Same-LAN Party · 2 works.
2. Two browsers on different networks: the host stays **Connected** with **0 peers**, the joiner returns **Offline**, and both report `timed out before the data channel opened`.

PeerJS signaling succeeds. The data channel never opens because ICE has no usable relay.

- An empty Advanced panel still installed Google STUN only. PeerJS replaces its whole `config` with that `iceServers` list, so the list removed PeerJS's built-in TURN entries instead of merging with them.
- Those PeerJS TURN hosts (`eu-0.turn.peerjs.com`, `us-0.turn.peerjs.com`) have no DNS records. Restoring the PeerJS defaults does not provide a relay.
- Same-machine host candidates hide the gap. CSP on grok.me is not the cause.
- A local PeerJS broker (`npx peerjs`) only replaces signaling. It is not a cross-network ICE fix.

Demo **0.2.3** does not pass that STUN-only override. When Advanced is empty it sends Google STUN plus a best-effort public TURN relay at `staticauth.openrelay.metered.ca` (Open Relay / Metered static auth, ports 80 and 443). Custom Advanced URLs replace that list. The timeout text names ICE/NAT and Advanced TURN.

Demo **0.2.4** asks `GET /turn` for standard `iceServers` when Advanced is empty, then uses that list in `rtcConfiguration` (PeerJS signaling stays `https://0.peerjs.com`). Port 53 URLs are dropped. If `/turn` is not configured, it still falls back to the 0.2.3 public relay. The static Grok host cannot mint Cloudflare credentials by itself; see the root README.

This repository does not publish https://yin-game-lab.grok.me. After merge, YIN has to republish the demo before the live page changes. Fullstack does not publish it.

Verify on the live site after that republish: two Chrome windows, Full Mesh, empty Advanced, unique room id, **Party · 2**, chat both ways. A same-machine party against `https://0.peerjs.com` should still connect. If the public relay rejects the shared credentials, put your own TURN URL, username, and credential in Advanced on every window.

## What broke on v0.1.1

Reproduced on https://yin-game-lab.grok.me (SDK **v0.1.1**):

1. Host: Create room → Connected, **0 peers**.
2. Second tab: same room, Full Mesh → alert `RTC mesh connection … timed out`.
3. Joiner stays Offline / Connecting. The form stays locked until reload.
4. Star topology: the joiner also stays on Connecting.
5. PeerJS signaling succeeds. The data channel never becomes a usable mesh edge, so the peer list and chat never update.

Causes fixed in SDK **0.1.3**:

- The join handshake waited on `mesh-ready` before the data channel had a roster, then closed the channel on the 5s migration deadline (often before ICE finished). `connect()` never rejected, so the demo left the form disabled.
- Control packets from a neighbor could be treated as coordinator traffic, and mesh sends were attributed to the host.
- Both peers could dial the same edge at once. The two offers cancelled each other.
- Star joins had no data-channel open timeout, so a failed channel left `connect()` pending.

A failed join now rejects `connect()`. The form unlocks and shows the error. Disconnect works while Connecting.

## Run the demo

```bash
cd game-multi-sdk
npm install
npm run build
npm test

cd ../game-multi-sdk-chat-demo
npm install
npm run dev
```

Vite prints a URL such as `http://127.0.0.1:5173`. Use that origin in every window.
Outside localhost, browsers need HTTPS.

Docker (static build on port 8080):

```bash
cd game-multi-sdk-chat-demo
docker compose up --build
```

Open `http://127.0.0.1:8080`.

### Signaling

Default endpoint: `https://0.peerjs.com`.

For a same-machine party, a local PeerJS broker is easier to reproduce:

```bash
npx peerjs --port 9000 --host 127.0.0.1
```

Set **PeerJS signaling endpoint** in every window to `http://127.0.0.1:9000`.
Leave the path at `/`. The PeerJS client appends `peerjs` to that path.

Same-machine Chrome may hide LAN addresses behind mDNS and then fail ICE.
Launch those windows with `--disable-features=WebRtcHideLocalIpsWithMdns` if the data channel stays closed while signaling is up.

Hosted and cross-network parties need TURN. Demo 0.2.4 requests `GET /turn`
when Advanced is empty (`VITE_TURN_BASE_URL` when the credential service is on
another origin). PeerJS cloud TURN is not a reliable substitute. If `/turn` is
down, the demo falls back to the public Open Relay. The local broker above does
not relay ICE between networks. To force your own relay, fill **Advanced WebRTC /
TURN settings** on every window; that list replaces the fetched one.

## Four-client procedure

Use one room id in all four windows, for example `party4-lab`.
Leave **Network topology** on **Full Mesh (default, direct peer-to-peer)**.

| Window | Role | Name |
| --- | --- | --- |
| 1 | Create room (host) | ada |
| 2 | Join room (client) | bea |
| 3 | Join room (client) | cam |
| 4 | Join room (client) | dee |

1. Window 1: Connect to room. Expect **Connected**, room id `party4-lab`, party **1** (`ada (you) · host`).
2. Windows 2–4: same room id, same endpoint, Full Mesh, then Connect.
3. Each window should show **Party · 4** and the chips `ada`, `bea`, `cam`, `dee`.
   The host line shows **3 connected peers**.
4. Send one message from each name, for example `ada here`, `bea here`, `cam here`, `dee here`.
5. Every window shows all four messages. Own messages sit on the right; the other three names are on the left.
   That is direct mesh delivery: the host does not have to relay chat.

If a join fails, the form returns to editable and the red error stays visible. Fix the endpoint or ICE settings and connect again. A reload is not required.

## Expected UI

- Header: `GAME MULTI SDK v0.1.3`, `Demo v0.2.4`, and badge **Connected**.
- Party row lists four names.
- Footer: `SDK v0.1.3 · Demo v0.2.4`.
- Demo package version is 0.2.4 (`package.json` and the `DEMO_VERSION` string).
