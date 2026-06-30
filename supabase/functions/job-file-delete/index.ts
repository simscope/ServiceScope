import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type JobFileDeleteRequest = {
  companyId?: string;
  jobId?: string;
  attachmentId?: string;
};

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

function findServiceKey(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findServiceKey(item);
      if (found) return found;
    }
    return null;
  }

  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (typeof item === 'string' && (normalizedKey.includes('service') || normalizedKey.includes('secret')) && item.startsWith('eyJ')) {
      return item;
    }
    const nested = findServiceKey(item);
    if (nested) return nested;
  }

  return null;
}

function getServiceRoleKey() {
  const directKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
  if (directKey) return directKey;

  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!secretKeys) return null;

  try {
    return findServiceKey(JSON.parse(secretKeys));
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Job file delete is missing Supabase environment.' }, 500);
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return jsonResponse({ error: 'Missing authenticated caller.' }, 401);

  const payload = (await request.json().catch(() => ({}))) as JobFileDeleteRequest;
  const companyId = payload.companyId?.trim();
  const jobId = payload.jobId?.trim();
  const attachmentId = payload.attachmentId?.trim();

  if (!companyId || !jobId || !attachmentId) {
    return jsonResponse({ error: 'Company, job, and attachment are required.' }, 400);
  }

  const callerClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authorization } } });
  const { data: sessionRows, error: sessionError } = await callerClient.rpc('app_current_session');
  if (sessionError) return jsonResponse({ error: sessionError.message }, 401);

  const callerSession = Array.isArray(sessionRows) ? sessionRows[0] : null;
  const callerKind = callerSession?.kind;
  const callerRole = String(callerSession?.role ?? '').toLowerCase();
  const callerCompanyId = callerSession?.company_id;
  const canDelete =
    callerKind === 'owner' ||
    (callerKind === 'company' && callerCompanyId === companyId && ['admin', 'manager', 'dispatcher', 'owner'].includes(callerRole));

  if (!canDelete) return jsonResponse({ error: 'Current login cannot delete this file.' }, 403);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: attachment, error: attachmentError } = await adminClient
    .from('job_attachments')
    .select('id, company_id, job_id, storage_bucket, storage_path')
    .eq('id', attachmentId)
    .eq('company_id', companyId)
    .eq('job_id', jobId)
    .maybeSingle();

  if (attachmentError) return jsonResponse({ error: attachmentError.message }, 400);
  if (!attachment) return jsonResponse({ ok: true, alreadyDeleted: true });

  if (attachment.storage_bucket && attachment.storage_path) {
    const { error: storageError } = await adminClient.storage.from(attachment.storage_bucket).remove([attachment.storage_path]);
    if (storageError) return jsonResponse({ error: storageError.message }, 400);
  }

  const { error: deleteError } = await adminClient.from('job_attachments').delete().eq('id', attachmentId).eq('company_id', companyId).eq('job_id', jobId);
  if (deleteError) return jsonResponse({ error: deleteError.message }, 400);

  return jsonResponse({ ok: true });
});
