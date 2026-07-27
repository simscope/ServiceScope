import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleQaWorkspace } from '../_shared/preview-qa-workspace/service.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const publicErrorCodes = new Set([
  'INVALID_QA_ACTION',
  'OWNER_REQUIRED',
  'QA_COMPANY_REQUIRED',
  'QA_EMAIL_REQUIRED',
  'QA_TEMPORARY_PASSWORD_REQUIRED',
  'QA_USER_EMAIL_ALREADY_EXISTS',
]);

function safeErrorCode(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  return publicErrorCodes.has(code) ? code : 'QA_WORKSPACE_FAILED';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) return jsonResponse({ error: 'QA workspace function is not configured.' }, 500);

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return jsonResponse({ error: 'Missing authenticated caller.' }, 401);

  const callerClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authorization } } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const result = await handleQaWorkspace(
      { callerClient, adminClient },
      await request.json().catch(() => ({})),
    );
    return jsonResponse(result);
  } catch (error) {
    const code = safeErrorCode(error);
    const status = code === 'OWNER_REQUIRED'
      ? 403
      : code === 'QA_USER_EMAIL_ALREADY_EXISTS'
        ? 409
        : code.includes('REQUIRED') || code.includes('INVALID')
          ? 400
          : 500;
    return jsonResponse({ error: code }, status);
  }
});
