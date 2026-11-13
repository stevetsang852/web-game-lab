/**
 * Runtime environment for the abstract factories.
 *
 * Realtime is reserved and intentionally absent: this workspace does not open
 * WebSocket or RTC connections. ICE, TURN, and the Game Lab `/turn` credential
 * gate stay in the multiplayer SDK, outside web-lab-sdk.
 */
export const LAB_ENVIRONMENTS = ['mini_app', 'web', 'native'];
//# sourceMappingURL=environment.js.map