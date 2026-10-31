# Web Game Lab

Web Game Lab contains a TypeScript multiplayer game SDK and a small React chat
demo that exercises its WebRTC host transport.

## Repository layout

- `game-multi-sdk/` — npm workspace containing the SDK packages:
  - `@game-multi-sdk/core` — shared transport contracts and PeerJS adapter.
  - `@game-multi-sdk/transport-rtc-host` — configurable WebRTC transport:
    Full Mesh by default, with optional host-relayed Star topology.
  - `@game-multi-sdk/transport-server` — server transport package scaffold.
  - `@game-multi-sdk/react` — React context and hooks for game transports.
- `game-multi-sdk-chat-demo/` — standalone Vite and React chat application
  consuming the local SDK packages.

## Requirements

- Node.js 18 or later
- npm 9 or later
- Docker Compose (optional, for the containerized demo)

## Build and type-check the SDK

```bash
cd game-multi-sdk
npm install
npm run build
npm test
npm run typecheck
```

## Public chat demo

The primary HTTPS demo is already deployed. No local Vite server is required.

**URL:** https://yin-game-lab.grok.me

That host serves the RTC Chat Room at the site root over HTTPS. The page
defaults to PeerJS Cloud at `https://0.peerjs.com`. On an HTTPS page the SDK
opens a secure PeerJS connection (WSS on port 443). Chat payloads still travel
over WebRTC between browsers, and cross-network rooms need TURN. With Advanced
ICE left empty, the demo requests standard `iceServers` from `GET /turn` and
falls back to a public relay if that endpoint is not configured. Republishing
that host is what updates the live copy; this repository’s version numbers do
not change it by themselves. This checkout is demo **0.2.4** / SDK **0.1.3**.

### Multi-browser test (4-person party)

Acceptance is a real **4-browser** Full Mesh chat on the public URL, not a
pair of windows and not localhost. PeerJS Cloud IDs are global. Pick a unique
room ID for the party instead of the shared default `game-room`.

1. Open https://yin-game-lab.grok.me in **4** browser windows or tabs
   (separate browsers are fine).
2. In all four windows, keep the same room ID, the signaling endpoint
   `https://0.peerjs.com`, and **Full Mesh**.
3. In the first window, choose **Create room (host)** and connect.
4. In the other three windows, choose **Join room (client)**, enter that same
   room ID, and connect. All four must show the room as connected.
5. Send a chat message from each of the four windows. Confirm every message
   appears in the other three windows.
6. Capture a screenshot of each of the four windows showing the shared room,
   the peer count, and the messages.

### Backup host (GitHub Pages)

GitHub Pages is optional and is not a second acceptance URL. Use it only if
the Grok host is unavailable. `.github/workflows/pages.yml` is manual
(`workflow_dispatch`). It builds `game-multi-sdk-chat-demo` with
`VITE_BASE_PATH=/web-game-lab/` and can publish:

https://stevetsang852.github.io/web-game-lab/

One-time setting, only for this backup: **Settings → Pages → Build and
deployment → Source: GitHub Actions**, then run **Backup: GitHub Pages chat
demo** from `main` after `npm run build` succeeds locally. Local `npm run dev`,
Docker, and https://yin-game-lab.grok.me do not set `VITE_BASE_PATH`, so they
stay at `/`.

## Run the chat demo locally

Build the SDK first, then install and start the demo:

```bash
cd game-multi-sdk-chat-demo
npm install
npm run dev
```

Open the Vite URL in four browser windows. Use the same room ID, signaling
endpoint, and topology in all windows. Create the room in one window and join
it from the other three. **Full Mesh** is selected by default; choose **Star** to
use host-relayed routing. The 4-person party acceptance path is
https://yin-game-lab.grok.me, not this local server.

The demo defaults to the PeerJS Cloud signaling endpoint at
`https://0.peerjs.com`. The endpoint must support the PeerJS signaling protocol;
chat data travels between browsers over WebRTC, optionally via TURN relays.
Browsers generally require HTTPS outside localhost. Open **Advanced WebRTC /
TURN settings** in the demo to paste STUN/TURN URLs, temporary TURN
credentials, and relay-only mode on both host and clients. Leave that panel
empty to use `iceServers` from `GET /turn` (see below).

SDK consumers can inject a full `rtcConfiguration: RTCConfiguration`;
the existing `iceServers` shorthand remains supported. See the
[RTC transport guide](game-multi-sdk/packages/transport-rtc-host/README.md)
for configuration precedence and production deployment advice.

To run the demo with Docker Compose instead:

```bash
cd game-multi-sdk-chat-demo
docker compose up --build
```

Then open `http://localhost:8080` in four browser windows. Docker is HTTP on
localhost only. The image serves the static demo and `GET /turn` on port 8080.
Copy `game-multi-sdk-chat-demo/.env.example` to `.env` and set the server
variables before `docker compose up` if that container should mint credentials.
The 4-person party acceptance test uses https://yin-game-lab.grok.me.

## TURN credentials

`GET /turn` returns WebRTC `iceServers` (`RTCIceServer[]` inside
`{ "iceServers": [...] }`). PeerJS signaling is unchanged. The browser does not
embed a TURN provider SDK, Cloudflare key, or API token. Manual Advanced URLs
still replace the fetched list.

Vite dev, Vite preview, and the Docker image serve `/turn` on the same origin.
A static host cannot mint credentials. Set `VITE_TURN_BASE_URL` at **build**
time to the credential origin (no path), or to a full URL that already ends in
`/turn`. If `/turn` is missing, the demo falls back to Google STUN plus the
public Open Relay.

Server environment (names only; set them on the credential process, never as
`VITE_` variables):

| Name | Role |
| --- | --- |
| `TURN_PROVIDER` | `cloudflare` (default). `metered` and `coturn` are reserved and not implemented. |
| `CF_TURN_KEY_ID` | Cloudflare Realtime TURN key id. |
| `CF_TURN_KEY_API_TOKEN` | Bearer token for that key. Server-side only. |
| `TURN_TTL_SECONDS` | Optional TTL in seconds. Default 3600. Allowed range 1–172800. |

The handler calls Cloudflare’s generate-ice-servers API, drops ICE URLs on
port 53, and adds any missing public STUN URL
(`stun.cloudflare.com:3478`, `stun.l.google.com:19302`). Response
`cache-control` is `no-store`. Provider API reference:
https://developers.cloudflare.com/realtime/turn/generate-credentials/

https://yin-game-lab.grok.me is a static Grok/Vercel republish of the Vite
bundle. It does not run this Node process. After merge, YIN republishes the
demo. For Cloudflare TURN on that host, deploy
`game-multi-sdk-chat-demo/server/worker.mjs` (`npx wrangler deploy` from
`game-multi-sdk-chat-demo`, secrets via `wrangler secret put` using the names
above) and rebuild with `VITE_TURN_BASE_URL` set to the worker origin. The
GitHub Pages backup reads the repository variable `VITE_TURN_BASE_URL` (a URL,
not a secret) when it is set. Docker and `npm run dev` do not need that
variable when `/turn` is on the same origin.

## Current development status

The core contracts, PeerJS adapter, RTC host transport (with design-pattern foundations for State and Observer), React bindings, and
chat demo are included. The authoritative WebSocket server transport is still
a scaffold and does not yet establish server connections.

See `game-multi-sdk/README.md` for the updated P2P-only Full Mesh development planning, design pattern matrix (https://refactoring.guru/design-patterns), and Auth layer roadmap.

RTC_HOST defaults to **Full Mesh**: each pair of participants has a direct
bidirectional WebRTC channel, and broadcasts are sent once to each connected
peer without host forwarding. Set `topology: 'star'` in `TransportOptions` for
the previous host-relayed behavior. This is a changed default; existing star
applications must opt in explicitly on every participant.

Start with 4-6 total players and load-test; this is not a guaranteed capacity or
enforced limit. Mesh uses `N * (N - 1) / 2` pairwise channels, with `N - 1`
connections per player: connection count grows quadratically, not exponentially.
It removes the browser host from the data path, not the need for signaling or
TURN when direct network routes fail.

**Host migration defaults to automatic**, with a 5-second election delay after
a lost connection; heartbeats also detect silent hosts. Manual handoff is
available through `transferHost(userId)`. Set `hostMigration.mode` to `manual`
for explicit handoff only, or `disabled` to opt out. In Mesh, the host is a
membership/discovery coordinator: established peer routes remain usable while
it is absent or migrating. New joins still need a reachable coordinator and
its current PeerJS ID. Migration restores coordination (and routing in Star),
not application state or lost messages. Browser elections are best-effort and
can split during network partitions; TURN does not provide consensus or state
recovery. See the [migration guide](game-multi-sdk/packages/transport-rtc-host/README.md#host-migration).

## Versioning

Current SDK version: **0.1.3** (exported as `SDK_VERSION` from `@game-multi-sdk/core`).  
Chat demo version: **0.2.4**.

A four-browser Full Mesh party check, including the v0.1.1 DataChannel timeout repro, is in [TEST.md](TEST.md).

**Rule**: Whenever you update code (features, fixes, refactors, or consumer-facing docs), also bump the version:
- Update `SDK_VERSION` in `game-multi-sdk/packages/core/src/version.ts`
- Update the `version` field in all relevant `package.json` files (root, packages/*, and chat-demo)

The chat demo displays the SDK version in the header and footer.

## Support the Developer (PayMe)

If you find this useful, please star the repo, try it out, or support development via [PayMe](https://payme.hsbc/d6d295dff7854566b4536a98f0b02ef8). Every bit helps me keep building.
