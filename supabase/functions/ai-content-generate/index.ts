import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleContentGeneration, HttpError } from '../_shared/content-engine/applicationService.js';
import { createMemoryGuards } from '../_shared/content-engine/rateLimit.js';
import { createPreflightFromEnv, createProviderFromEnv } from '../_shared/content-engine/providers/openai.js';
import { handleReelGeneration, ReelHttpError } from '../_shared/reel-engine/director.js';
import { attachmentSha256, sha256DigestsEqual } from '../_shared/media-analysis/checksum.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const guards = createMemoryGuards();

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed', code: 'INVALID_REQUEST' }, 405);
  try {
    const rawBody = await request.text();
    const parsedBody = safeJson(rawBody);
    if (parsedBody?.schemaVersion === 'content-engine-provider-preflight-v1') {
      return jsonResponse(await handleProviderPreflight(request.headers.get('Authorization') ?? ''));
    }
    const dependencies = makeDependencies();
    const handler = parsedBody?.schemaVersion === 'reel-creative-request-v1'
      ? handleReelGeneration
      : handleContentGeneration;
    const result = await handler({
      rawBody,
      authorization: request.headers.get('Authorization') ?? '',
      ...dependencies,
    });
    return jsonResponse(result);
  } catch (error) {
    const knownError = error instanceof HttpError || error instanceof ReelHttpError;
    const code = knownError ? error.code : error instanceof Error ? error.message : 'INVALID_REQUEST';
    const status = knownError ? error.status : statusForCode(code);
    return jsonResponse({ error: 'Content generation request was rejected.', code }, status);
  }
});

async function handleProviderPreflight(authorization: string) {
  if (!authorization?.startsWith('Bearer ')) throw new HttpError('AUTH_REQUIRED', 401);
  const dependencies = makeDependencies();
  await dependencies.auth.resolveSession(authorization);
  if (dependencies.config.providerId !== 'openai') {
    return { ok: false, provider: dependencies.config.providerId, model: dependencies.config.model, code: 'ENGINE_NOT_CONFIGURED' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), dependencies.config.timeoutMs);
  try {
    const result = await dependencies.preflight({ signal: controller.signal });
    dependencies.telemetry.record({
      correlationId: 'provider-preflight',
      provider: 'openai',
      model: dependencies.config.model,
      channel: 'preflight',
      promptVersion: 'provider-preflight-v1',
      success: result.ok,
      code: result.code,
      latencyMs: 0,
      attempts: 1,
      httpStatus: 'httpStatus' in result ? result.httpStatus : undefined,
      providerRequestId: 'providerRequestId' in result ? result.providerRequestId : undefined,
      providerErrorType: 'providerErrorType' in result ? result.providerErrorType : undefined,
      providerErrorCode: 'providerErrorCode' in result ? result.providerErrorCode : undefined,
    });
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function makeDependencies() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new HttpError('ENGINE_NOT_CONFIGURED', 500);
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { provider, providerId, model } = createProviderFromEnv((key: string) => Deno.env.get(key));
  const preflight = createPreflightFromEnv((key: string) => Deno.env.get(key));
  return {
    auth: createAuthRepository(supabaseUrl, anonKey),
    repository: createContextRepository(adminClient),
    provider,
    preflight,
    guards,
    config: {
      providerId,
      model,
      timeoutMs: Math.min(20_000, Math.max(3000, Number(Deno.env.get('AI_CONTENT_TIMEOUT_MS')) || 12_000)),
      maxAttempts: Math.min(3, Math.max(1, Number(Deno.env.get('AI_CONTENT_MAX_ATTEMPTS')) || 2)),
      maxOutputBytes: 16_000,
    },
    telemetry: { record: (event: unknown) => console.info('ai-content-engine', event) },
  };
}

function createAuthRepository(supabaseUrl: string, anonKey: string) {
  return {
    async resolveSession(authorization: string) {
      const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
      const { data: authData, error: authError } = await callerClient.auth.getUser();
      if (authError || !authData.user?.id) throw new HttpError('AUTH_REQUIRED', 401);
      const { data, error } = await callerClient.rpc('app_current_session');
      if (error) throw new HttpError('AUTH_REQUIRED', 401);
      const session = Array.isArray(data) ? data[0] : null;
      if (!session) throw new HttpError('AUTH_REQUIRED', 401);
      return { ...session, auth_user_id: authData.user.id };
    },
  };
}

function createContextRepository(adminClient: ReturnType<typeof createClient<any>>) {
  return {
    async getJob(jobId: string) {
      const { data } = await adminClient
        .from('jobs')
        .select('id,company_id,job_number,status,system,issue,notes,service_call_fee_cents,labor_cents,customer_id,customer_location_id')
        .eq('id', jobId)
        .maybeSingle();
      return data;
    },
    async getCompany(companyId: string) {
      const { data } = await adminClient
        .from('companies')
        .select('id,owner_email')
        .eq('id', companyId)
        .maybeSingle();
      const { data: profile } = await adminClient
        .from('company_profiles')
        .select('access_rules')
        .eq('company_id', companyId)
        .maybeSingle();
      return data ? { ...data, access_rules: profile?.access_rules ?? {} } : null;
    },
    async getCompanyUser(session: Record<string, unknown>, companyId: string) {
      const userId = String(session.user_id ?? '');
      const email = String(session.email ?? '').trim();
      let query = adminClient
        .from('company_users')
        .select('id,company_id,email,role,status,portal_access_rules')
        .eq('company_id', companyId)
        .eq('status', 'active')
        .limit(1);
      if (userId) query = query.eq('id', userId);
      else if (email) query = query.ilike('email', email);
      else return null;
      const { data } = await query.maybeSingle();
      return data;
    },
    async getCompanyVoiceSettings(companyId: string) {
      const { data, error } = await adminClient
        .from('company_profiles')
        .select('ai_voice_enabled,ai_public_display_name,ai_default_tone,ai_custom_voice_guidance,ai_service_areas,ai_public_location_wording,ai_cta_guidance,ai_hashtag_guidance,ai_channel_defaults')
        .eq('company_id', companyId)
        .maybeSingle();
      if (error) throw new Error('COMPANY_VOICE_UNAVAILABLE');
      return data;
    },
    async getCustomer(customerId: string | null) {
      if (!customerId) return null;
      const { data } = await adminClient
        .from('customers')
        .select('organization,primary_name,primary_email,primary_phone,notes')
        .eq('id', customerId)
        .maybeSingle();
      return data;
    },
    async getLocation(locationId: string | null) {
      if (!locationId) return null;
      const { data } = await adminClient
        .from('customer_locations')
        .select('address')
        .eq('id', locationId)
        .maybeSingle();
      return data;
    },
    async listMaterials(companyId: string, jobId: string) {
      const { data } = await adminClient
        .from('job_materials')
        .select('id,company_id,job_id,name,status')
        .eq('company_id', companyId)
        .eq('job_id', jobId)
        .limit(200);
      return data ?? [];
    },
    async listAttachments(companyId: string, jobId: string) {
      const { data } = await adminClient
        .from('job_attachments')
        .select('id,company_id,job_id,name,mime_type,kind,created_at')
        .eq('company_id', companyId)
        .eq('job_id', jobId)
        .limit(200);
      return data ?? [];
    },
    async listInvoices(companyId: string, jobId: string) {
      const { data } = await adminClient
        .from('job_invoices')
        .select('invoice_number,amount_cents,status')
        .eq('company_id', companyId)
        .eq('job_id', jobId)
        .limit(50);
      return data ?? [];
    },
    async listComments(companyId: string, jobId: string) {
      const { data } = await adminClient
        .from('job_comments')
        .select('message')
        .eq('company_id', companyId)
        .eq('job_id', jobId)
        .limit(200);
      return data ?? [];
    },
    async listReelMediaCandidates(companyId: string, jobId: string, attachmentIds: string[]) {
      const { data, error } = await adminClient.rpc('list_company_reel_media_analysis_candidates', {
        p_company_id: companyId,
        p_job_id: jobId,
        p_attachment_ids: attachmentIds,
      });
      if (error) throw new ReelHttpError('REEL_MEDIA_UNAVAILABLE', 409);
      const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
      const currentHashByAttachment = new Map<string, string | null>();
      for (const row of rows) {
        const attachmentId = String(row.attachment_id ?? '');
        if (!attachmentId || currentHashByAttachment.has(attachmentId)) continue;
        currentHashByAttachment.set(attachmentId, await attachmentSha256(adminClient, row));
      }
      return rows.map((row) => {
        const currentHash = currentHashByAttachment.get(String(row.attachment_id ?? ''));
        return {
          ...row,
          storage_bucket: undefined,
          storage_path: undefined,
          current_checksum_matches: sha256DigestsEqual(currentHash, row.attachment_sha256),
        };
      });
    },
    async persistReelCreativePlan(input: Record<string, unknown>) {
      const { data, error } = await adminClient.rpc('persist_company_reel_creative_plan', {
        p_company_id: input.companyId,
        p_job_id: input.jobId,
        p_created_by: input.createdBy,
        p_schema_version: input.schemaVersion,
        p_plan_revision: input.planRevision,
        p_locale: input.locale,
        p_planning_revision: input.planningRevision,
        p_local_facts: input.localFacts,
        p_media_plan: input.mediaPlan,
        p_plan_json: input.plan,
      });
      if (error || typeof data !== 'string') throw new ReelHttpError('REEL_GENERATION_FAILED', 503);
      return data;
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function statusForCode(code: string) {
  if (code === 'AUTH_REQUIRED') return 401;
  if (code === 'FORBIDDEN' || code === 'JOB_NOT_FOUND') return 404;
  if (code === 'ENGINE_NOT_CONFIGURED') return 500;
  return 400;
}

function safeJson(rawBody: string) {
  try {
    const value = JSON.parse(rawBody || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
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
    if (typeof item === 'string' && (normalizedKey.includes('service') || normalizedKey.includes('secret')) && item.startsWith('eyJ')) return item;
    const nested = findServiceKey(item);
    if (nested) return nested;
  }
  return null;
}
