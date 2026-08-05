import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleMediaAnalysis, HttpError, statusForCode } from '../_shared/media-analysis/applicationService.js';
import { createMemoryGuards } from '../_shared/content-engine/rateLimit.js';
import { createMediaProviderFromEnv } from '../_shared/media-analysis/providers/openai.js';
import { signedUrlTtlSeconds } from '../_shared/media-analysis/contracts.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const guards = createMemoryGuards();

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed', code: 'INVALID_REQUEST' }, 405);
  const start = Date.now();
  let rawBody = '';
  try {
    rawBody = await request.text();
    const dependencies = makeDependencies();
    const result = await handleMediaAnalysis({
      rawBody,
      authorization: request.headers.get('Authorization') ?? '',
      ...dependencies,
    });
    return jsonResponse(result);
  } catch (error) {
    const code = error instanceof HttpError ? error.code : error instanceof Error ? error.message : 'INVALID_REQUEST';
    const status = error instanceof HttpError ? error.status : statusForCode(code);
    console.info('ai-media-analysis', safeTopLevelFailureEvent({ rawBody, code, status, start }));
    return jsonResponse({ error: 'Media analysis request was rejected.', code }, status);
  }
});

function makeDependencies() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new HttpError('MEDIA_PROVIDER_NOT_CONFIGURED', 503);
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const repository = createContextRepository(adminClient);
  const { provider, providerId, model } = createMediaProviderFromEnv((key: string) => Deno.env.get(key));
  return {
    auth: createAuthRepository(supabaseUrl, anonKey),
    repository,
    provider,
    guards,
    config: {
      providerId,
      model,
      timeoutMs: Math.min(30_000, Math.max(3000, Number(Deno.env.get('AI_MEDIA_TIMEOUT_MS')) || 12_000)),
      maxAttempts: Math.min(3, Math.max(1, Number(Deno.env.get('AI_MEDIA_MAX_ATTEMPTS')) || 2)),
      maxOutputTokens: Math.min(1400, Math.max(300, Number(Deno.env.get('AI_MEDIA_MAX_OUTPUT_TOKENS')) || 900)),
      repository,
    },
    telemetry: { record: (event: unknown) => console.info('ai-media-analysis', event) },
  };
}

function createAuthRepository(supabaseUrl: string, anonKey: string) {
  return {
    async resolveSession(authorization: string) {
      const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
      const { data, error } = await callerClient.rpc('app_current_session');
      if (error) throw new HttpError('AUTH_REQUIRED', 401);
      const session = Array.isArray(data) ? data[0] : null;
      if (!session) throw new HttpError('AUTH_REQUIRED', 401);
      return session;
    },
  };
}

function createContextRepository(adminClient: ReturnType<typeof createClient>) {
  return {
    async getJob(jobId: string) {
      const { data } = await adminClient
        .from('jobs')
        .select('id,company_id,job_number,status,notes,service_call_fee_cents,labor_cents,customer_id,customer_location_id')
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
    async listAttachmentsByIds(attachmentIds: string[]) {
      const { data } = await adminClient
        .from('job_attachments')
        .select('id,company_id,job_id,name,mime_type,size_bytes,kind,storage_bucket,storage_path,created_at')
        .in('id', attachmentIds)
        .limit(50);
      return data ?? [];
    },
    async createSignedMediaUrl(attachment: { storageBucket: string; storagePath: string }) {
      const { data, error } = await adminClient.storage
        .from(attachment.storageBucket)
        .createSignedUrl(attachment.storagePath, signedUrlTtlSeconds);
      if (error || !data?.signedUrl) return null;
      return data.signedUrl;
    },
    async recordMediaAnalysisResult(input: Record<string, unknown>) {
      const request = input.request as Record<string, unknown>;
      const context = input.context as Record<string, unknown>;
      const result = input.result as Record<string, unknown>;
      const runId = crypto.randomUUID();
      const companyId = String(context.companyId ?? '');
      const jobId = String(context.jobId ?? request.jobId ?? '');
      const completedAt = String(input.completedAt ?? new Date().toISOString());
      const { error: runError } = await adminClient.from('company_media_analysis_runs').insert({
        id: runId,
        company_id: companyId,
        job_id: jobId,
        correlation_id: String(request.idempotencyKey ?? runId),
        status: result?.safety?.ok === false ? 'failed' : 'completed',
        provider: safeBoundedText(result.provider, 'unknown'),
        model: typeof result.model === 'string' ? safeBoundedText(result.model, 'unknown') : null,
        analysis_version: 'media-analysis-v1',
        completed_at: completedAt,
        created_at: completedAt,
        updated_at: completedAt,
      });
      if (runError) return;
      const attachmentById = new Map((context.attachments as Array<Record<string, unknown>> ?? []).map((attachment) => [String(attachment.id), attachment]));
      for (const item of (result.attachments as Array<Record<string, unknown>> ?? [])) {
        const attachment = attachmentById.get(String(item.id));
        if (!attachment || item.kind !== 'photo') continue;
        const checksum = await attachmentSha256(adminClient, attachment);
        if (!checksum) continue;
        const privacyFindings = (item.findings as Array<Record<string, unknown>> ?? []).filter((finding) => String(finding.category ?? '').startsWith('possible_') || String(finding.category ?? '') === 'unknown_privacy_risk');
        const resultId = crypto.randomUUID();
        const reviewState = privacyFindings.length ? 'blocked' : 'passed';
        const { error: attachmentError } = await adminClient.from('company_media_analysis_attachment_results').insert({
          id: resultId,
          analysis_run_id: runId,
          company_id: companyId,
          job_id: jobId,
          attachment_id: String(item.id),
          attachment_sha256: checksum,
          detected_mime_type: String(item.mimeType ?? attachment.mimeType ?? '').toLowerCase(),
          analysis_status: ['analyzed', 'metadata_only', 'manual_review'].includes(String(item.status)) ? item.status : 'manual_review',
          privacy_review_status: reviewState,
          excluded: false,
          created_at: completedAt,
        });
        if (attachmentError) continue;
        for (const finding of privacyFindings) {
          await adminClient.from('company_media_analysis_privacy_findings').insert({
            id: crypto.randomUUID(),
            analysis_run_id: runId,
            attachment_result_id: resultId,
            company_id: companyId,
            job_id: jobId,
            attachment_id: String(item.id),
            finding_id: safeBoundedText(finding.findingId, crypto.randomUUID()),
            finding_category: safeFindingCategory(finding.category),
            risk_level: ['low', 'medium', 'high'].includes(String(finding.riskLevel)) ? finding.riskLevel : 'high',
            resolved_as_false_positive: false,
            created_at: completedAt,
          });
        }
      }
    },
  };
}

async function attachmentSha256(adminClient: ReturnType<typeof createClient>, attachment: Record<string, unknown>) {
  const bucket = String(attachment.storageBucket ?? attachment.storage_bucket ?? '');
  const path = String(attachment.storagePath ?? attachment.storage_path ?? '');
  if (!bucket || !path) return null;
  const { data, error } = await adminClient.storage.from(bucket).download(path);
  if (error || !data || data.size > 12_000_000) return null;
  const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
  return `\\x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function safeBoundedText(value: unknown, fallback: string) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return clean && clean.length <= 120 && !/[<>\u0000-\u001f]/.test(clean) ? clean : fallback;
}

function safeFindingCategory(value: unknown) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return /^[a-z0-9_]{2,80}$/.test(clean) ? clean : 'unknown_privacy_risk';
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function safeTopLevelFailureEvent({ rawBody, code, status, start }: { rawBody: string; code: string; status: number; start: number }) {
  const body = safeRequestShape(rawBody);
  return {
    correlationId: body.idempotencyKey,
    stage: 'edge-rejection',
    code,
    httpStatus: status,
    providerCallStarted: false,
    attachmentCount: body.attachmentCount,
    latencyMs: Math.max(0, Date.now() - start),
  };
}

function safeRequestShape(rawBody: string) {
  try {
    const parsed = JSON.parse(rawBody || '{}');
    const idempotencyKey = typeof parsed.idempotencyKey === 'string' && /^[A-Za-z0-9:_-]{8,160}$/.test(parsed.idempotencyKey)
      ? parsed.idempotencyKey
      : undefined;
    const attachmentCount = Array.isArray(parsed.attachmentIds) ? parsed.attachmentIds.length : 0;
    return { idempotencyKey, attachmentCount };
  } catch {
    return { idempotencyKey: undefined, attachmentCount: 0 };
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
