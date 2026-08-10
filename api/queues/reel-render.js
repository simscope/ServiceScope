import { QueueClient } from '@vercel/queue';
import { reelQueueRetryDelaySeconds, reelQueueVisibilitySeconds, RenderJobError } from '../../server/reel-render-jobs/contracts.js';
import { createRenderRepository } from '../../server/reel-render-jobs/repository.js';
import { createRenderWorker } from '../../server/reel-render-jobs/worker.js';
import { createSupabaseHttpClient } from '../../server/reel-render-jobs/supabaseHttp.js';

const worker = process.env.REEL_RENDER_ENABLED === 'true'
  ? createRenderWorker({ repository: createRenderRepository(createSupabaseHttpClient()) })
  : async () => ({ status: 'disabled', rendered: false });

const consumer = async (message) => {
  try {
    return await worker(message);
  } catch (error) {
    if (error instanceof RenderJobError && error.code === 'INVALID_REQUEST') {
      return { status: 'ignored', rendered: false };
    }
    throw error;
  }
};

const queue = new QueueClient();

export default queue.handleNodeCallback(consumer, {
  visibilityTimeoutSeconds: reelQueueVisibilitySeconds,
  retry: () => ({ afterSeconds: reelQueueRetryDelaySeconds }),
});
