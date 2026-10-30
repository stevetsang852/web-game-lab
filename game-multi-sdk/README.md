# game-multi-sdk

Multiplayer game SDK monorepo supporting two transport modes:

- **SERVER** — Authoritative WebSocket server (strategy / simulation games)
- **RTC_HOST** — WebRTC Full Mesh by default, with optional host-relayed Star mode

## Packages

| Package | Description |
|---------|-------------|
| `@game-multi-sdk/core` | Shared interfaces & types (`IGameTransport`) |
| `@game-multi-sdk/transport-server` | WebSocket authoritative server transport |
| `@game-multi-sdk/transport-rtc-host` | Configurable Full Mesh / Star WebRTC transport |
| `@game-multi-sdk/react` | React Context & Hooks binding |

## Quick Start

```bash
npm install
npm run build
npm test
npm run typecheck
```

See each package's README for usage examples. The RTC host transport requires
an endpoint compatible with the PeerJS signaling protocol; a generic REST
signaling endpoint is not sufficient.

`npm test` runs core RTC configuration and transport MVP tests with Node.js's
built-in test runner. The transport tests use a fake peer, so they do not
require a signaling server or browser. They cover configuration precedence,
TURN credentials, and configuration preservation when reconnecting.
RTC reconnect is enabled by default and retries every five seconds. Use
`reconnect: { enabled: false }` or set `intervalMs` in `TransportOptions` to
customize its behavior.

## Configurable RTC topology

```ts
await transport.connect({
  role: 'client', // The initial 'host' creates the room and coordinates membership.
  roomId: 'room-123',
  userId: 'player-1',
  endpoint: 'https://peerjs.example.com',
  topology: 'full-mesh', // Default when omitted; use 'star' for host forwarding.
});
```

Every participant must choose the same topology. **The default changed from
Star to Full Mesh**; existing applications needing host relay must explicitly
pass `topology: 'star'`. The category and package name remain `RTC_HOST` and
`transport-rtc-host` for compatibility; no server transport is introduced.

Full Mesh discovers members through a coordinator, then connects every pair
directly. `send()` broadcasts over those direct channels; `targetId` addresses
a peer directly, and `getPeers()` lists all locally open, admitted peer routes.
An established room continues exchanging messages after coordinator loss,
even with automatic migration disabled. Auto migration restores the
coordinator needed for new joins. Signaling and STUN/TURN remain necessary.

In mesh, `connect()` resolves once admitted by the coordinator, not once every
pair has finished ICE negotiation. Observe `onPeersChanged` for actual reachable
peers. Failed/missing routes are reported through `onError`; broadcasts send
to reachable members only, without host fallback, queuing, or replay.

## Production WebRTC and topology limits

Supply `rtcConfiguration: RTCConfiguration` on both host and client to configure
your own STUN/TURN service, TURN credentials, and relay-only routing. The legacy
`iceServers` option remains supported. Obtain short-lived TURN credentials from
your backend rather than embedding permanent credentials in a browser bundle.
See the [RTC transport guide](packages/transport-rtc-host/README.md) for examples,
precedence rules, relay testing, and credential renewal limitations.

RTC_HOST targets small, low-traffic casual rooms: start with 4-6 total players
and load-test your application. This is guidance, not a hard cap or guarantee.
Mesh requires `N * (N - 1) / 2` bidirectional pair channels and `N - 1` uploads
per player for each broadcast. Connection count is quadratic, not exponential;
Mesh does not provide unlimited scale or guaranteed latency. Star concentrates
forwarding bandwidth on the host. **Host migration is automatic by default**:
clients use the last host roster to elect a successor after a 5-second
connection-loss deadline. Heartbeats detect silent failures. Use
`hostMigration: { mode: 'manual' }` for host-requested handoffs only, or
`{ mode: 'disabled' }` to opt out; `timeoutMs` customizes the election deadline.
The host can call `transferHost(userId)` in auto or manual mode. Subscribe to
`onHostChanged` and use `getHost().peerId` for updated room discovery.
Migration restores mesh coordination or star routing, without state replication or message replay,
and network partitions can produce competing hosts. See the
[migration guide](packages/transport-rtc-host/README.md#host-migration). Larger,
competitive, or persistent games should use an authoritative backend.
`transport-server` is currently only a scaffold.

React `GameProvider` keeps `useGameRoom().connected`, `peers`, and `isHost`
in sync during migration. Transport and connection failures are exposed as
`useGameRoom().error`; unsubscribe cleanup runs when the provider disconnects.

## Automated tests

Run `npm test` from this SDK directory after installing dependencies. This builds
core and the RTC transport, then runs their Node-native tests. Coverage includes
default automatic failover, the five-second default election delay, repeated
manual handoffs, full-mesh pair counts, direct/private delivery and sender
identity, coordinator-independent traffic, late joins after migration, pair
reconnection, topology mismatch rejection, failed-candidate fallback, silent-host heartbeats, healed
connections, disabled/manual policies, migration cancellation and validation,
reconnection, and ICE/TURN configuration.

This repository uses npm workspaces. Internal packages depend on
`@game-multi-sdk/core` with `*`, which npm links to the local workspace.
PeerJS is an internal dependency of `@game-multi-sdk/core`; other packages
consume the RTC peer API through core.

## Development Order

1. `packages/core` — interface contract
2. `packages/transport-server` — WebSocket mode
3. `packages/transport-rtc-host` — RTC Host mode
4. `packages/react` — React bindings
5. Spring Boot signaling + server backend

## P2P-only Development Planning (Full Mesh Focus)

**暂时只做 P2P client ↔ client（全网格）方向**是合理的收敛：先把“无媒体服务器、低延迟、小房间”这条路径做扎实，再考虑 SFU/Server 传输。当前默认 Full Mesh、Host Migration、可配置 ICE。重点是把 Mesh 的连接生命周期、信令/发现、消息层和可观测性做可靠。

### P2P-only 的边界

P2P client-client **不等于 serverless**。数据面去中心化，但仍需要：

| 依赖          | 是否可去掉    | 说明 |
| ----------- | -------- | --- |
| **信令 / 发现** | 否        | 交换 SDP/ICE 候选需要通道；当前依赖 PeerJS Cloud + Host 的 PeerJS ID。 |
| **STUN**    | 否        | 获取公网候选，NAT 穿透的基础。 |
| **TURN**    | 否（严苛网络下） | 对称 NAT / 严格防火墙下必须有中继。 |

目标：**数据面去中心化，信令/穿透依赖最小化且可配置**。

### 优先级

| 优先级 | 事项 | 理由 |
| ------ | ---- | ---- |
| **P0** | PeerConnection 状态机 + 超时 + ICE restart + 指数退避 | Mesh 可靠性的地基 |
| **P0** | 心跳/RTT + 静默故障检测 | 没有它，重连和迁移都是盲目的 |
| **P0** | 发现阶段单点缓解（房间码/邀请 + 成员列表版本） | Host 迁移后仍能加入 |
| **P1** | 可靠/不可靠双通道 + 二进制序列化 + 背压 | 游戏状态同步体验 |
| **P1** | 本地 TURN + 多上下文 E2E + 故障注入 | 可验证地能跑 |
| **P1** | 房间密码/令牌 + 消息限流 | 基础防护 |
| **P2** | 状态同步模式文档 + 插值工具 | 提升接入价值 |

### 设计模式应用（依据 https://refactoring.guru/design-patterns）

| 模式 | 应用位置 | 解决的问题 |
| ---- | -------- | ---------- |
| **State** | PeerConnection 生命周期（idle → signaling → connecting → connected → degraded → reconnecting → failed → closed） | 散落的回调导致状态不一致 |
| **Strategy** | TopologyStrategy (FullMesh / Star) | 拓扑行为可替换 |
| **Observer** | EventBus for messages, peers, errors, host changes | 解耦通知 |
| **Facade** | RtcHostTransport | 统一入口隐藏复杂性 |
| **Factory** | PeerFactory | 隔离 PeerJS 创建 |
| **Decorator** | AuthenticatedTransport (未来) | 不改传输实现加入身份 |
| **Template Method** | BaseConnectionHandler | 共享超时/重试逻辑 |

## Auth & Identity Layer Planning

接口与领域模型放在 `@game-multi-sdk/core`，具体认证实现单独开 `@game-multi-sdk/auth` 包，传输层通过装饰器/中间件消费认证能力。

### 范围

- 身份标识（稳定 playerId，而非仅 PeerJS ID）
- 会话管理
- 房间准入（密码/令牌）
- 消息真实性（可选签名）
- 能力/角色（host / player / spectator）
- 不提供权威反作弊；P2P 下客户端持有完整状态。

### 包结构

```text
@game-multi-sdk/core          # 领域接口、值对象、状态机基类
@game-multi-sdk/auth          # 认证策略、Provider、Session 存储
@game-multi-sdk/transport-rtc-host  # 通过装饰器消费 AuthContext
@game-multi-sdk/react         # useAuth / useSession hooks
```

依赖方向：auth → core，transport → core，react → core + auth + transport。

### 设计模式矩阵

见上方，并额外：

- Strategy: AuthStrategy (Anonymous / Password / Token / ChallengeSignature)
- Factory: AuthStrategyFactory
- Builder: AuthConfigBuilder
- Adapter: SessionStoreAdapter
- Observer: AuthEventBus
- State: SessionStateMachine
- Decorator: AuthenticatedTransport
- Chain of Responsibility: AuthMiddlewareChain
- Facade: AuthClient
- Repository: SessionRepository
- Command: LoginCommand / LogoutCommand
- Template Method: BaseAuthStrategy
- Null Object: AnonymousIdentity
- Value Object: PlayerIdentity / AuthContext (immutable)

详细实现路线图见规划文档。

## Development Order (Updated)

1. Monorepo + core contracts + design pattern foundations (State, Strategy, Observer) — **in progress**
2. transport-rtc-host Mesh reliability (P0: state machine, heartbeat, discovery)
3. auth package (interfaces in core, strategies in auth)
4. react bindings including auth hooks
5. transport-server (deferred)
6. Spring Boot signaling + backend (deferred)

### Current refactoring status

- `ConnectionStateMachine` and `EventBus` are integrated into `RtcHostTransport`.
- **Mesh logic fully moved**: `FullMeshStrategy` owns all mesh connection maps,
  handshake, reconcile, heartbeat, and send/broadcast.
- **Star logic fully moved**: `StarStrategy` owns host connection map, client
  connection, accept/connect, relay send, and peer list.
  `RtcHostTransport` only selects the strategy and delegates.
- Pattern unit tests live in `packages/transport-rtc-host/test/patterns.test.mjs`.
