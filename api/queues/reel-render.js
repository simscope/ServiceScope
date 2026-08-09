import { QueueClient } from '@vercel/queue';
import { createRenderRepository } from '../../server/reel-render-jobs/repository.js';
import { createRenderWorker } from '../../server/reel-render-jobs/worker.js';
import { createSupabaseHttpClient } from '../../server/reel-render-jobs/supabaseHttp.js';

const worker = process.env.REEL_RENDER_ENABLED === 'true'
  ? createRenderWorker({ repository: createRenderRepository(createSupabaseHttpClient()) })
  : async () => ({ status: 'disabled', rendered: false });

const queue = new QueueClient();

export default queue.handleNodeCallback(worker, {
  visibilityTimeoutSeconds: 900,
  retry: (_error, metadata) => metadata.deliveryCount > 5 ? { acknowledge: true } : { afterSeconds: 60 },
});
