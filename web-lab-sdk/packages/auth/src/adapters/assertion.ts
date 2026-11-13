import { ErrorCodes, SdkError } from '@web-lab-sdk/core';
import { isBareEmail, readAssertion } from '../input.js';
import {
  exchangeWithServer,
  linkWithServer,
  readServerOptions,
  type FetchLike,
  type ServerBackedAdapterOptions,
} from '../server.js';
import type { IdentityPort, Session } from '../types.js';

interface EndpointBinding {
  readonly authEndpoint?: string;
  readonly fetchImpl?: FetchLike;
}

/**
 * Google and Sign in with Apple both delegate to this exchange.
 * The classes below compose it; they do not share a base adapter type.
 */
function bindEndpoint(options?: ServerBackedAdapterOptions): EndpointBinding {
  return readServerOptions(options);
}

function authenticateAssertion(
  provider: 'google' | 'apple',
  endpoint: EndpointBinding,
  input: unknown,
): Promise<Session> {
  const assertion = readLoginAssertion(input);
  return exchangeWithServer({
    provider,
    endpoint: endpoint.authEndpoint,
    fetchImpl: endpoint.fetchImpl,
    body: { provider, assertion },
    requiredProvider: provider,
  });
}

function readLoginAssertion(input: unknown): string {
  if (!input || typeof input !== 'object') {
    throw new SdkError(ErrorCodes.InvalidArgument, 'Authenticate requires an identity assertion.');
  }
  const record = input as Record<string, unknown>;
  if ('accountId' in record && 'token' in record) {
    throw new SdkError(ErrorCodes.InvalidSession, 'Pass an identity assertion, not a client-built session.');
  }
  const assertion = readAssertion(record);
  if (!assertion) {
    throw new SdkError(ErrorCodes.InvalidArgument, 'Authenticate requires an identity assertion.');
  }
  if (isBareEmail(assertion)) {
    throw new SdkError(ErrorCodes.EmailOnlyLinkForbidden, 'An email address is not an identity assertion.');
  }
  return assertion;
}

/** Posts a Google IdP assertion to the server. Does not mint a session. */
export class GoogleIdentityAdapter implements IdentityPort {
  readonly id = 'google' as const;
  private readonly endpoint: EndpointBinding;

  constructor(options?: ServerBackedAdapterOptions) {
    this.endpoint = bindEndpoint(options);
  }

  authenticate(input: unknown): Promise<Session> {
    return authenticateAssertion(this.id, this.endpoint, input);
  }

  link(input: unknown): Promise<Session> {
    return linkWithServer(this.id, this.endpoint.authEndpoint, this.endpoint.fetchImpl, input);
  }
}

/** Posts a Sign in with Apple assertion to the server. Does not mint a session. */
export class AppleIdentityAdapter implements IdentityPort {
  readonly id = 'apple' as const;
  private readonly endpoint: EndpointBinding;

  constructor(options?: ServerBackedAdapterOptions) {
    this.endpoint = bindEndpoint(options);
  }

  authenticate(input: unknown): Promise<Session> {
    return authenticateAssertion(this.id, this.endpoint, input);
  }

  link(input: unknown): Promise<Session> {
    return linkWithServer(this.id, this.endpoint.authEndpoint, this.endpoint.fetchImpl, input);
  }
}
