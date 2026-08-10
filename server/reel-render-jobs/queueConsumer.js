import { parseRenderMessage, reelQueueDisabledRetryDelaySeconds, reelQueueRetryDelaySeconds, RenderJobError } from './contracts.js';

export function createReelQueueConsumer({ enabled, worker }) {
  return async (message) => {
    let parsed;
    try {
      parsed = parseRenderMessage(message);
    } catch (error) {
      if (error instanceof RenderJobError && error.code === 'INVALID_REQUEST') {
        return { status: 'ignored', rendered: false };
      }
      throw error;
    }
    if (!enabled()) throw new RenderJobError('REEL_RENDER_NOT_CONFIGURED', 503);
    return worker(parsed);
  };
}

export function reelQueueRetry(error) {
  return {
    afterSeconds: error instanceof RenderJobError && error.code === 'REEL_RENDER_NOT_CONFIGURED'
      ? reelQueueDisabledRetryDelaySeconds
      : reelQueueRetryDelaySeconds,
  };
}
