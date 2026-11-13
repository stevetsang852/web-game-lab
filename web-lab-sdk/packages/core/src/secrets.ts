import { ErrorCodes, SdkError } from './errors.js';

const SECRET_KEYS = [
  'botToken',
  'bot_token',
  'secret',
  'secretKey',
  'apiKey',
  'api_key',
  'privateKey',
  'clientSecret',
  'client_secret',
  'hmacKey',
  'password',
] as const;

/**
 * Client packages must not accept provider secrets. Verification stays on the server.
 */
export function rejectClientSecrets(options: unknown): void {
  if (!options || typeof options !== 'object') return;
  const record = options as Record<string, unknown>;
  for (const key of SECRET_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      throw new SdkError(
        ErrorCodes.ClientSecretForbidden,
        `Refusing provider secret "${key}" in a client SDK. Keep it on the server.`,
      );
    }
  }
}
