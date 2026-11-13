# web-lab-sdk

Design and TypeScript skeleton for account, payment, and wallet facades.
This workspace is not wired to MeowKingdom or travianz-web3-remake. It does
not open Telegram Stars invoices, store charges, Stripe charges, wallet
popups, or NFT mints. It also does not contain ICE, TURN, PeerJS, or the
Game Lab `/turn` gate. Those stay in `game-multi-sdk`.

Phase 0 can run offline. Production sessions, charges, and wallet links stay
on a server that is not part of this package.

## Packages

| Package | Role |
| --- | --- |
| `@web-lab-sdk/auth` | `AuthClient` facade, identity adapters, `createAuthorizedFetch` |
| `@web-lab-sdk/payments` | `PaymentsClient` facade and invoice state machine |
| `@web-lab-sdk/web3` | `Web3Client` facade for wallet links |
| `@web-lab-sdk/core` | Private. `Result`, error codes, `ProviderRegistry`, and `Observer` only. Not a fourth game SDK. |

Games depend on the three public entry points. They do not import a provider
SDK. Auth does not import payments or wallets, and payments does not sell
through a wallet.

## Patterns

- **Strategy + Adapter.** `IdentityPort`, `PaymentPort`, and `WalletPort` are the ports. Telegram, Google, Apple, Stars, IAP, Stripe, TON Connect, and WalletConnect are adapters behind those ports.
- **Facade.** Call `AuthClient`, `PaymentsClient`, or `Web3Client`. Each package has its own client.
- **Abstract factory.** `MiniAppFactory`, `WebFactory`, and `NativeFactory` live in each package and name that environment's default providers.
- **Registry.** `client.register(provider)` at bootstrap. Adding an adapter does not require a change to `@web-lab-sdk/core`.
- **Observer.** `onSessionChange`, `onPayment`, and `onWalletChange`. Callers do not poll.
- **Null object.** `OfflineAuth`, `NoopPayments`, and `NoopWallet` are opt-in with `phase0Demo: true`.

## Default combinations

| Environment | Primary login | Digital goods | Wallet |
| --- | --- | --- | --- |
| Mini App | Telegram `initData`, verified by the server | Stars (`XTR`) | TON Connect is named, disabled, and unregistered |
| Web | Google and Sign in with Apple | Stripe (`USD`) | WalletConnect placeholder, unregistered |
| Native | Google and Sign in with Apple | Apple IAP and Google Play Billing | WalletConnect placeholder, unregistered |

Login does not open a wallet. Gmail and Apple are not on the Mini App login
gate. They can be registered later as link-only adapters after Telegram
verification. Mini App payments reject every provider except Stars and the
Phase 0 noop stub. TON is not a digital-goods currency in any environment.

Live Stars, IAP, and Stripe classes are scaffolds. Factories do not register
them. `checkout` throws `NOT_IMPLEMENTED` and does not return `PAID` or
`APPLIED`. Register one only when a server checkout exists.

## Phase 0 stubs

```ts
import { MiniAppFactory, createAuthorizedFetch } from '@web-lab-sdk/auth';
import { MiniAppFactory as MiniAppPayments } from '@web-lab-sdk/payments';
import { MiniAppFactory as MiniAppWallets } from '@web-lab-sdk/web3';

const auth = new MiniAppFactory().create({ phase0Demo: true });
const session = await auth.authenticate('offline', {});
auth.getAccessToken(); // offline-demo.<id>
auth.getAuthorization(); // null
createAuthorizedFetch(session); // does not set Authorization

const payments = new MiniAppPayments().create({ phase0Demo: true });
const invoice = await payments.checkout('potion', 'idem-12345678');
// invoice.state === 'INVOICE_OPEN', entitlementGranted === false

const wallets = new MiniAppWallets().create({ phase0Demo: true });
wallets.isConnected(); // false
```

`OfflineAuth` mints a local session whose `origin` is `offline-demo`. The
token is prefixed `offline-demo.` and the account id is prefixed
`offline-demo:`. It is not a JWT and `getAuthorization()` will not wrap it as
a bearer. `NoopPayments` never reports `PAID` or `APPLIED`. `NoopWallet`
never returns an address.

## Server-backed login

Telegram, Google, and Apple adapters POST the provider payload to
`authEndpoint`. The server checks Telegram `initData` or the IdP assertion
and returns the session. The browser package does not verify HMAC and has
nowhere to put a bot token or client secret.

```ts
const auth = new MiniAppFactory().create({
  authEndpoint: 'https://game.example/auth/session',
});
const session = await auth.authenticate('telegram', { initData });
auth.getAuthorization(); // "Bearer <server token>"
const callApi = createAuthorizedFetch(session);
```

`POST` body for login is `{ provider, initData }` or `{ provider, assertion }`.
A link posts `{ mode: 'link', provider, assertion, accountId }` with
`Authorization` set from the current server session, or
`{ mode: 'link', provider, assertion, existingIdentityProof }` when both
sides were verified. Email is not a field in either body.

`createAuthorizedFetch(session)` only sets `Authorization` for a server
session. It is not a game API client and it does not know about payments or
wallets.

The client stores a session only after `parse` of that response (or after
`OfflineAuth`). A hand-built `{ accountId, token }` object is rejected.

## Linking

`link` binds a second identity onto the current `accountId`. It does not open
a new account. It rejects:

- `{ email }`
- `{ provider, email }` or `{ provider, email, accountId }`
- a raw Google or Apple assertion with no server session and no dual proof
- an assertion or proof that is only an email address
- a server response whose `accountId` changed

A signed-in caller passes `{ provider, assertion }`. Dual proof is
`{ provider, assertion, existingIdentityProof }`. Do not pass `email`.

## Invoices

States are `INVOICE_OPEN → PAID → APPLIED | REFUNDED`. `checkout(sku, idempotencyKey)`
requires an idempotency key of at least 8 characters and replays the same
attempt. `entitlementGranted` is allowed only when the state is `APPLIED`.
This skeleton never moves a stub to `PAID`.

## Wallets

`connect(providerId, userGesture())` requires an explicit gesture. Factory
`create()` does not connect and does not construct a wallet UI. TON Connect
has no `checkout`, `mint`, or `transfer`. `walletLink(accountId, account)`
rejects using the address as `accountId`. Village and hero ownership stay on
the auth `accountId`.

Realtime (WebSocket / RTC) is not implemented here.

## Scripts

From this directory, with Node 18+ and npm 9+:

```bash
npm install
npm run build
npm run typecheck
npm test
```

`npm test` builds every package, runs each package's `node:test` suite, then
runs `test/environments.test.mjs` for the cross-package defaults.

## Non-goals

- Live Telegram Stars, Apple IAP, Google Play, or Stripe charges
- WalletConnect or TON Connect UI, NFT mint, or transfer
- Provider secrets, bot tokens, or HMAC verification in the client
- A combined server client that checks out and connects a wallet in one call
- Wiring this SDK into MeowKingdom, travianz-web3-remake, or `game-multi-sdk`
