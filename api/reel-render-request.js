import { send } from '@vercel/queue';
import { createRenderRequestHandler } from '../server/reel-render-jobs/producer.js';
import { normalizeRenderError, reelRenderTopic, RenderJobError } from '../server/reel-render-jobs/contracts.js';
import { createRenderRepository } from '../server/reel-render-jobs/repository.js';
import { authorizeReelForRender } from '../server/reel-renderer/authorization.js';
import { createSupabaseHttpClient } from '../server/reel-render-jobs/supabaseHttp.js';
import { asNodeHandler } from '../server/reel-render-jobs/nodeAdapter.js';
import { createRenderTelemetry } from '../server/reel-render-jobs/telemetry.js';

export default asNodeHandler(() => {
  const client = createSupabaseHttpClient();
  const repository = createRenderRepository(client);
  client.preflightRenderRetry = async (claim) => {
    try {
      authorizeReelForRender(await repository.loadAuthority(claim));
    } catch (error) {
      throw new RenderJobError(normalizeRenderError(error), 409);
    }
  };
  const telemetry = createRenderTelemetry();
  return createRenderRequestHandler({
    client,
    enabled: () => process.env.REEL_RENDER_ENABLED === 'true',
    publish: (message, renderJobId) => send(reelRenderTopic, message, { idempotencyKey: renderJobId }),
    telemetry,
  });
});
