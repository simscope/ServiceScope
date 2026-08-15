import { createReelApprovalHandler } from '../server/reel-render-jobs/approval.js';
import { asNodeHandler } from '../server/reel-render-jobs/nodeAdapter.js';
import { createSupabaseHttpClient } from '../server/reel-render-jobs/supabaseHttp.js';

export default asNodeHandler(() => createReelApprovalHandler({ client: createSupabaseHttpClient() }));
