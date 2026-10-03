import { createReelPlanStatusHandler } from '../server/reel-render-jobs/planStatus.js';
import { asNodeHandler } from '../server/reel-render-jobs/nodeAdapter.js';
import { createSupabaseHttpClient } from '../server/reel-render-jobs/supabaseHttp.js';

export default asNodeHandler(() => createReelPlanStatusHandler({ client: createSupabaseHttpClient() }));
