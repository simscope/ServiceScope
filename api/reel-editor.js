import { createEditorHandler } from '../server/reel-editor/service.js';
import { asNodeHandler } from '../server/reel-render-jobs/nodeAdapter.js';
import { createSupabaseHttpClient } from '../server/reel-render-jobs/supabaseHttp.js';
export default asNodeHandler(() => createEditorHandler({ client: createSupabaseHttpClient() }));
