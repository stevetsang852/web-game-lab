# game-multi-sdk

Multiplayer game SDK monorepo supporting two transport modes:

- **SERVER** — Authoritative WebSocket server (strategy / simulation games)
- **RTC_HOST** — WebRTC star-topology Host mode (P2P party / 1v1 games)

## Packages

| Package | Description |
|---------|-------------|
| `@game-multi-sdk/core` | Shared interfaces & types (`IGameTransport`) |
| `@game-multi-sdk/transport-server` | WebSocket authoritative server transport |
| `@game-multi-sdk/transport-rtc-host` | WebRTC Host (star topology) transport |
| `@game-multi-sdk/react` | React Context & Hooks binding |

## Quick Start

```bash
npm install
npm run build
```

See each package's README for usage examples. The RTC host transport requires
an endpoint compatible with the PeerJS signaling protocol; a generic REST
signaling endpoint is not sufficient.

This repository uses npm workspaces. PeerJS is an internal dependency of
`@game-multi-sdk/core`; other packages consume the RTC peer API through core.

## Development Order

1. `packages/core` — interface contract
2. `packages/transport-server` — WebSocket mode
3. `packages/transport-rtc-host` — RTC Host mode
4. `packages/react` — React bindings
5. Spring Boot signaling + server backend
