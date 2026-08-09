import { createArtifactHandler } from '../server/reel-render-jobs/artifacts.js';
import { createSupabaseHttpClient } from '../server/reel-render-jobs/supabaseHttp.js';
import { asNodeHandler } from '../server/reel-render-jobs/nodeAdapter.js';

export default asNodeHandler(() => createArtifactHandler({ client: createSupabaseHttpClient() }));
