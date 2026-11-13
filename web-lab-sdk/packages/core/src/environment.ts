/**
 * Runtime environment for the abstract factories.
 *
 * Realtime is reserved and intentionally absent: this workspace does not open
 * WebSocket or RTC connections. ICE, TURN, and the Game Lab `/turn` credential
 * gate stay in the multiplayer SDK, outside web-lab-sdk.
 */
export const LAB_ENVIRONMENTS = ['mini_app', 'web', 'native'] as const;

export type LabEnvironment = (typeof LAB_ENVIRONMENTS)[number];

/** Abstract factory implemented separately by auth, payments, and web3. */
export interface EnvironmentFactory<TClient, TOptions = void> {
  readonly environment: LabEnvironment;
  create(options?: TOptions): TClient;
}
