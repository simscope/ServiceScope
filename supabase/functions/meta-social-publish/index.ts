import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  MetaConnectionError,
  assertMetaAccessRole,
  requireActiveDomainSession,
  requireBearerJwt,
  requireVerifiedAuthUserId,
} from '../_shared/meta-connection/contracts.js';
import {
  MetaPublishingError,
  runtimePublishingConfig,
} from '../_shared/meta-publishing/contracts.js';
import { createFacebookPublishingProvider } from '../_shared/meta-publishing/provider.js';
import { createImageScriptProcessor } from '../_shared/meta-publishing/imageProcessor.js';
import {
  createTimeoutController,
  handleMetaPublishing,
  normalizePublishingError,
} from '../_shared/meta-publishing/service.js';

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (!cors) return jsonResponse({ error: 'Meta publishing request was rejected.', code: 'FORBIDDEN' }, 403, baseHeaders());
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return jsonResponse({ error: 'Meta publishing request was rejected.', code: 'INVALID_REQUEST' }, 405, cors);

  try {
    const result = await handleMetaPublishing({
      rawBody: await request.text(),
      authorization: request.headers.get('Authorization') ?? '',
      deps: makeDependencies(),
    });
    return jsonResponse(result, 200, cors);
  } catch (error) {
    const normalized = normalizePublishingError(error);
    return jsonResponse(
      { error: 'Meta publishing request was rejected.', code: normalized.code },
      normalized.status,
      cors,
    );
  }
});

function makeDependencies() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new MetaPublishingError('META_PUBLISH_NOT_CONFIGURED');
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const config = runtimePublishingConfig((key) => Deno.env.get(key));
  return {
    auth: createAuthRepository(supabaseUrl, anonKey),
    repository: createRepository(adminClient),
    provider: createFacebookPublishingProvider({ config }),
    imageProcessor: createImageScriptProcessor(),
    config,
    cryptoApi: globalThis.crypto,
    maxBodyBytes: 24_000,
    newUuid: () => crypto.randomUUID(),
    timeoutController: createTimeoutController,
    now: () => Date.now(),
    telemetry: { record: (event: unknown) => console.info('meta-social-publish', event) },
  };
}

function createAuthRepository(supabaseUrl: string, anonKey: string) {
  return {
    async resolveSession(authorization: string) {
      const jwt = requireBearerJwt(authorization);
      const callerClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: authorization } },
      });
      let authResult;
      try {
        authResult = await callerClient.auth.getUser(jwt);
      } catch {
        throw new MetaPublishingError('AUTH_REQUIRED');
      }
      const authUserId = requireVerifiedAuthUserId(authResult);
      const { data, error } = await callerClient.rpc('app_current_session');
      const session = requireActiveDomainSession(Array.isArray(data) ? data[0] : null, error);
      return { ...session, authUserId, callerClient };
    },

    async assertCompanyAccess(session: Record<string, unknown>, companyId: string) {
      try {
        assertMetaAccessRole(session, companyId);
      } catch (error) {
        if (error instanceof MetaConnectionError) throw new MetaPublishingError(error.code);
        throw error;
      }
      const callerClient = session.callerClient as ReturnType<typeof createClient>;
      const { data, error } = await callerClient.rpc('can_manage_company', { target_company_id: companyId });
      if (error || data !== true) throw new MetaPublishingError('FORBIDDEN');
      return {
        actorAuthUserId: String(session.authUserId),
        actorName: safeAuditText(session.name, 'Authenticated user'),
        actorRole: safeAuditText(session.role, String(session.kind ?? 'publisher')),
      };
    },
  };
}

function createRepository(adminClient: ReturnType<typeof createClient>) {
  return {
    async getStatus(companyId: string, jobId?: string) {
      if (jobId) {
        const { data: job, error: jobError } = await adminClient
          .from('jobs')
          .select('id')
          .eq('id', jobId)
          .eq('company_id', companyId)
          .maybeSingle();
        if (jobError) throw new MetaPublishingError('INTERNAL_ERROR');
        if (!job) throw new MetaPublishingError('FORBIDDEN');
      }
      const { data: connection, error: connectionError } = await adminClient
        .from('company_social_connections')
        .select('status,facebook_page_name,granted_scopes')
        .eq('company_id', companyId)
        .eq('provider', 'meta-facebook-login')
        .neq('status', 'revoked')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (connectionError) throw new MetaPublishingError('INTERNAL_ERROR');
      let publicationQuery = adminClient
        .from('company_social_publications')
        .select('status,approved_at,published_at,last_error_code')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (jobId) publicationQuery = publicationQuery.eq('job_id', jobId);
      const { data: lastPublication, error: publicationError } = await publicationQuery.maybeSingle();
      if (publicationError) throw new MetaPublishingError('INTERNAL_ERROR');
      return { connection, lastPublication };
    },

    async getPublicationContext(companyId: string, jobId: string) {
      const { data: job, error: jobError } = await adminClient
        .from('jobs')
        .select('id,company_id,job_number,status,notes,service_call_fee_cents,labor_cents,customer_id,customer_location_id')
        .eq('id', jobId)
        .eq('company_id', companyId)
        .maybeSingle();
      if (jobError) throw new MetaPublishingError('INTERNAL_ERROR');
      if (!job) return null;
      const [connectionResult, customerResult, locationResult, invoiceResult, commentResult] = await Promise.all([
        adminClient.from('company_social_connections')
          .select('id,company_id,status,facebook_page_id,facebook_page_name,granted_scopes,token_envelope')
          .eq('company_id', companyId).eq('provider', 'meta-facebook-login').neq('status', 'revoked')
          .order('updated_at', { ascending: false }).limit(1).maybeSingle(),
        job.customer_id
          ? adminClient.from('customers').select('organization,primary_name,primary_email,primary_phone,notes').eq('id', job.customer_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        job.customer_location_id
          ? adminClient.from('customer_locations').select('address').eq('id', job.customer_location_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        adminClient.from('job_invoices').select('invoice_number,amount_cents,status').eq('company_id', companyId).eq('job_id', jobId).limit(50),
        adminClient.from('job_comments').select('message').eq('company_id', companyId).eq('job_id', jobId).limit(200),
      ]);
      if ([connectionResult, customerResult, locationResult, invoiceResult, commentResult].some((result) => result.error)) {
        throw new MetaPublishingError('INTERNAL_ERROR');
      }
      return {
        job,
        connection: connectionResult.data,
        customer: customerResult.data,
        location: locationResult.data,
        invoices: invoiceResult.data ?? [],
        comments: commentResult.data ?? [],
      };
    },

    async getPublicationAttachment(companyId: string, jobId: string, attachmentId: string) {
      const { data, error } = await adminClient
        .from('job_attachments')
        .select('id,company_id,job_id,name,mime_type,size_bytes,kind,storage_bucket,storage_path,created_at')
        .eq('id', attachmentId)
        .eq('company_id', companyId)
        .eq('job_id', jobId)
        .maybeSingle();
      if (error) throw new MetaPublishingError('INTERNAL_ERROR');
      return data;
    },

    async downloadAttachmentBytes(input: Record<string, unknown>) {
      const bucket = String(input.storageBucket ?? '');
      const path = String(input.storagePath ?? '');
      const maxBytes = Number(input.maxBytes) || 0;
      if (!bucket || !path || maxBytes < 1) throw new MetaPublishingError('META_PUBLICATION_MEDIA_REQUIRED');
      const { data, error } = await adminClient.storage.from(bucket).download(path);
      if (error || !data) throw new MetaPublishingError('META_PUBLICATION_MEDIA_REQUIRED');
      if (data.size < 1 || data.size > maxBytes) throw new MetaPublishingError('META_PUBLICATION_MEDIA_TOO_LARGE');
      return new Uint8Array(await data.arrayBuffer());
    },

    async approvePublicationPhoto(input: Record<string, unknown>) {
      return oneRpcRow(adminClient, 'approve_company_facebook_publication_photo', {
        p_approval_id: input.approvalId,
        p_company_id: input.companyId,
        p_job_id: input.jobId,
        p_attachment_id: input.attachmentId,
        p_attachment_sha256: input.attachmentSha256,
        p_attachment_mime_type: input.attachmentMimeType,
        p_actor_id: input.actorAuthUserId,
        p_actor_name: input.actorName,
        p_actor_role: input.actorRole,
        p_approval_reason: input.approvalReason,
        p_timestamp: input.timestamp,
      });
    },

    async getPublicationPhotoApproval(companyId: string, jobId: string, attachmentId: string, attachmentSha256: string) {
      const { data, error } = await adminClient
        .from('company_social_publication_media_approvals')
        .select('id,attachment_id,approval_status,approved_at,revoked_at')
        .eq('company_id', companyId)
        .eq('job_id', jobId)
        .eq('attachment_id', attachmentId)
        .eq('attachment_sha256', attachmentSha256)
        .eq('approval_status', 'approved')
        .is('revoked_at', null)
        .order('approved_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new MetaPublishingError('INTERNAL_ERROR');
      return data;
    },

    async beginPublication(input: Record<string, unknown>) {
      return oneRpcRow(adminClient, 'begin_company_facebook_publication', {
        p_publication_id: input.publicationId,
        p_company_id: input.companyId,
        p_connection_id: input.connectionId,
        p_job_id: input.jobId,
        p_idempotency_key: input.idempotencyKey,
        p_approved_message: input.message,
        p_message_sha256: input.messageSha256,
        p_publication_intent_sha256: input.publicationIntentSha256,
        p_publication_kind: input.publicationKind,
        p_attachment_id: input.attachmentId,
        p_safe_mime_type: input.safeMimeType,
        p_media_count: input.mediaCount,
        p_actor_id: input.actorAuthUserId,
        p_actor_name: input.actorName,
        p_actor_role: input.actorRole,
        p_timestamp: input.timestamp,
      });
    },

    async completePublication(input: Record<string, unknown>) {
      return oneRpcRow(adminClient, 'complete_company_facebook_publication', {
        p_publication_id: input.publicationId,
        p_company_id: input.companyId,
        p_actor_id: input.actorAuthUserId,
        p_actor_name: input.actorName,
        p_actor_role: input.actorRole,
        p_provider_post_id: input.providerPostId,
        p_provider_media_id: input.providerMediaId,
        p_timestamp: input.timestamp,
      });
    },

    async failPublication(input: Record<string, unknown>) {
      const diagnostic = input.diagnostic as Record<string, unknown>;
      return oneRpcRow(adminClient, 'fail_company_facebook_publication', {
        p_publication_id: input.publicationId,
        p_company_id: input.companyId,
        p_actor_id: input.actorAuthUserId,
        p_actor_name: input.actorName,
        p_actor_role: input.actorRole,
        p_provider_http_status: diagnostic.providerHttpStatus ?? null,
        p_provider_error_code: diagnostic.providerCode ?? null,
        p_provider_error_subcode: diagnostic.providerSubcode ?? null,
        p_provider_error_category: diagnostic.providerCategory ?? 'PROVIDER_REJECTED',
        p_provider_is_transient: diagnostic.providerIsTransient ?? null,
        p_last_error_code: input.lastErrorCode,
        p_timestamp: input.timestamp,
      });
    },

    async markUnknown(input: Record<string, unknown>) {
      return oneRpcRow(adminClient, 'mark_company_facebook_publication_unknown', {
        p_publication_id: input.publicationId,
        p_company_id: input.companyId,
        p_actor_id: input.actorAuthUserId,
        p_actor_name: input.actorName,
        p_actor_role: input.actorRole,
        p_timestamp: input.timestamp,
      });
    },
  };
}

async function oneRpcRow(client: ReturnType<typeof createClient>, name: string, params: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, params);
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) throw new MetaPublishingError('INTERNAL_ERROR');
  return row;
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin');
  const allowed = allowedOrigins();
  if (origin && !allowed.has(origin)) return null;
  return {
    ...baseHeaders(),
    'Access-Control-Allow-Origin': origin ?? 'https://servicescope-inky.vercel.app',
    Vary: 'Origin',
  };
}

function baseHeaders() {
  return {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  };
}

function allowedOrigins() {
  const values = [Deno.env.get('APP_URL'), Deno.env.get('SITE_URL'), ...(Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',')];
  const origins = new Set<string>(['https://servicescope-inky.vercel.app', 'http://127.0.0.1:5173', 'http://localhost:5173']);
  for (const value of values) {
    try {
      const url = new URL(value?.trim() ?? '');
      if (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) origins.add(url.origin);
    } catch {}
  }
  return origins;
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

function safeAuditText(value: unknown, fallback: string) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return clean && clean.length <= 120 && !/[<>\u0000-\u001f]/.test(clean) ? clean : fallback;
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
