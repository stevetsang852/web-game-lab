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
