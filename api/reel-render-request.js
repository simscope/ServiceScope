import { send } from '@vercel/queue';
import { createRenderRequestHandler } from '../server/reel-render-jobs/producer.js';
import { reelRenderTopic } from '../server/reel-render-jobs/contracts.js';
import { createSupabaseHttpClient } from '../server/reel-render-jobs/supabaseHttp.js';
import { asNodeHandler } from '../server/reel-render-jobs/nodeAdapter.js';
import { createRenderTelemetry } from '../server/reel-render-jobs/telemetry.js';

export default asNodeHandler(() => {
  const client = createSupabaseHttpClient();
  const telemetry = createRenderTelemetry();
  return createRenderRequestHandler({
    client,
    enabled: () => process.env.REEL_RENDER_ENABLED === 'true',
    publish: (message, renderJobId) => send(reelRenderTopic, message, { idempotencyKey: renderJobId }),
    telemetry,
  });
});
