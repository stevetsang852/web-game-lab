# Web Game Lab

Web Game Lab contains a TypeScript multiplayer game SDK and a small React chat
demo that exercises its WebRTC host transport.

## Repository layout

- `game-multi-sdk/` — npm workspace containing the SDK packages:
  - `@game-multi-sdk/core` — shared transport contracts and PeerJS adapter.
  - `@game-multi-sdk/transport-rtc-host` — host/client WebRTC transport using a
    star topology.
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
npm run typecheck
```

## Run the chat demo

Build the SDK first, then install and start the demo:

```bash
cd game-multi-sdk-chat-demo
npm install
npm run dev
```

Open the Vite URL in two browser windows. Use the same room ID and signaling
endpoint in both. Create the room in one window and join it from the other.

The demo defaults to the PeerJS Cloud signaling endpoint at
`https://0.peerjs.com`. The endpoint must support the PeerJS signaling protocol;
chat data is sent directly between browsers over WebRTC. Browsers generally
require HTTPS outside localhost, and some networks need STUN/TURN configuration.
The demo currently does not expose ICE server settings.

To run the demo with Docker Compose instead:

```bash
cd game-multi-sdk-chat-demo
docker compose up --build
```

Then open `http://localhost:8080` in two browser windows.

## Current development status

The core contracts, PeerJS adapter, RTC host transport, React bindings, and
chat demo are included. The authoritative WebSocket server transport is still
a scaffold and does not yet establish server connections.
