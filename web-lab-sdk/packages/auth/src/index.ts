export { SdkError, ErrorCodes } from '@web-lab-sdk/core';
export type { ErrorCode, Result, Unsubscribe } from '@web-lab-sdk/core';

export type {
  IdentityProviderId,
  IdentityPort,
  LinkedIdentity,
  Session,
  SessionOrigin,
} from './types.js';

export { OFFLINE_DEMO_ACCOUNT_PREFIX, OFFLINE_DEMO_TOKEN_PREFIX } from './session.js';
export { AuthClient } from './client.js';
export type { AuthClientOptions } from './client.js';
export { MiniAppFactory, WebFactory, NativeFactory } from './factories.js';
export type { AuthFactoryOptions } from './factories.js';
export { TelegramIdentityAdapter } from './adapters/telegram.js';
export { GoogleIdentityAdapter, AppleIdentityAdapter } from './adapters/assertion.js';
export { OfflineAuth } from './adapters/offline.js';
export { createAuthorizedFetch, authorizationHeader } from './authorized-fetch.js';
export type { FetchLike } from './authorized-fetch.js';
