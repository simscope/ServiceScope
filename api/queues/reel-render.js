import { QueueClient } from '@vercel/queue';
import { reelQueueVisibilitySeconds } from '../../server/reel-render-jobs/contracts.js';
import { createReelQueueConsumer, reelQueueRetry } from '../../server/reel-render-jobs/queueConsumer.js';
import { createRenderRepository } from '../../server/reel-render-jobs/repository.js';
import { createRenderWorker } from '../../server/reel-render-jobs/worker.js';
import { createProductionReelRenderer } from '../../server/reel-sandbox-runtime/config.js';
import { createSupabaseHttpClient } from '../../server/reel-render-jobs/supabaseHttp.js';
import { createRenderTelemetry } from '../../server/reel-render-jobs/telemetry.js';

let worker;
const telemetry = createRenderTelemetry();
const loadWorker = () => {
  worker ??= createRenderWorker({
    repository: createRenderRepository(createSupabaseHttpClient()),
    render: createProductionReelRenderer(process.env, { telemetry }),
    telemetry,
  });
  return worker;
};

const consumer = createReelQueueConsumer({
  enabled: () => process.env.REEL_RENDER_ENABLED === 'true',
  worker: (message) => loadWorker()(message),
});

const queue = new QueueClient();

export default queue.handleNodeCallback(consumer, {
  visibilityTimeoutSeconds: reelQueueVisibilitySeconds,
  retry: reelQueueRetry,
});
