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

3. Open the Vite URL in two browser windows. Keep the same signaling endpoint
   and room ID in both windows. Create the room in one window and join it in the
   other.

## Run with Docker

From `game-multi-sdk-chat-demo`, build and start the demo:

```bash
docker compose up --build
```

Open `http://localhost:8080` in two browser windows to test the chat room.
The Compose build uses the parent directory as its context so it can include
the sibling `game-multi-sdk` packages.

The default signaling endpoint is PeerJS Cloud (`https://0.peerjs.com`). You can
replace it with any compatible PeerJS signaling server. The server is used for
connection setup; chat data is exchanged through WebRTC data channels. Browsers
may require HTTPS outside localhost, and some networks require TURN servers,
which this UI currently does not configure.

## Publish and install

Before sharing this demo outside this checkout, publish the SDK packages and
replace the `file:` dependencies in `package.json` with the published versions.
