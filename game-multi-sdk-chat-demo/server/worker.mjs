/**
 * Cloudflare Worker entry for static hosts that cannot run Node.
 * Set TURN_PROVIDER, CF_TURN_KEY_ID, and CF_TURN_KEY_API_TOKEN with
 * `wrangler secret put`. Do not put those values in wrangler.toml.
 */
import { handleTurnRequest } from './turn-credentials.mjs';

export default {
  /**
   * @param {Request} request
   * @param {Record<string, string | undefined>} env
   */
  async fetch(request, env) {
    const response = await handleTurnRequest(request, env);
    if (!response) {
      return new Response('Not found', {
        status: 404,
        headers: { 'cache-control': 'no-store' },
      });
    }
    return response;
  },
};
