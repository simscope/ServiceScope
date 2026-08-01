import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  META_PROVIDER,
  MetaConnectionError,
  runtimeConfigFromEnv,
} from '../_shared/meta-connection/contracts.js';
import { createMetaProvider } from '../_shared/meta-connection/provider.js';
import { createMetaRateLimiter } from '../_shared/meta-connection/rateLimit.js';
import {
  createTimeoutController,
  handleMetaConnection,
  normalizeError,
} from '../_shared/meta-connection/service.js';

const rateLimiter = createMetaRateLimiter();

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (!cors) return jsonResponse({ error: 'Request origin is not allowed.', code: 'FORBIDDEN' }, 403, baseHeaders());
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return jsonResponse({ error: 'Meta connection request was rejected.', code: 'INVALID_REQUEST' }, 405, cors);

  try {
    const rawBody = await request.text();
    const deps = makeDependencies();
    const result = await handleMetaConnection({
      rawBody,
      authorization: request.headers.get('Authorization') ?? '',
      deps,
    });
    return jsonResponse(result, 200, cors);
  } catch (error) {
    const normalized = normalizeError(error);
    return jsonResponse(
      { error: 'Meta connection request was rejected.', code: normalized.code },
      normalized.status,
      cors,
    );
  }
});

function makeDependencies() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !anonKey || !serviceRoleKey) throw new MetaConnectionError('META_NOT_CONFIGURED');
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const config = runtimeConfigFromEnv((key) => Deno.env.get(key));
  return {
    auth: createAuthRepository(supabaseUrl, anonKey),
    repository: createRepository(adminClient),
    provider: createMetaProvider({ config }),
    config,
    rateLimiter,
    cryptoApi: globalThis.crypto,
    maxBodyBytes: 32_768,
    stateTtlMs: 10 * 60_000,
    retentionCleanupLimit: 50,
    newUuid: () => crypto.randomUUID(),
    timeoutController: createTimeoutController,
    now: () => Date.now(),
    telemetry: { record: (event: unknown) => console.info('meta-social-connection', event) },
  };
}

function createAuthRepository(supabaseUrl: string, anonKey: string) {
  return {
    async resolveSession(authorization: string) {
      const callerClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: authorization } },
      });
      const { data, error } = await callerClient.rpc('app_current_session');
      const session = Array.isArray(data) ? data[0] : null;
      if (error || !session?.user_id || session.status !== 'active') throw new MetaConnectionError('AUTH_REQUIRED');
      return { ...session, callerClient };
    },

    async assertCompanyAccess(session: Record<string, unknown>, companyId: string) {
      const kind = String(session.kind ?? '');
      const sessionCompanyId = String(session.company_id ?? '');
      if (kind === 'company' && sessionCompanyId !== companyId) throw new MetaConnectionError('FORBIDDEN');
      if (kind !== 'company' && kind !== 'owner') throw new MetaConnectionError('FORBIDDEN');
      const callerClient = session.callerClient as ReturnType<typeof createClient>;
      const { data, error } = await callerClient.rpc('can_manage_company', { target_company_id: companyId });
      if (error || data !== true) throw new MetaConnectionError('FORBIDDEN');
      return {
        actorId: String(session.user_id),
        actorName: safeAuditText(session.name, 'Authenticated user'),
        actorRole: safeAuditText(session.role, kind),
        companyId,
      };
    },
  };
}

function createRepository(adminClient: ReturnType<typeof createClient>) {
  return {
    async getOAuthStateScope(stateHash: string) {
      const { data, error } = await adminClient
        .from('company_social_oauth_states')
        .select('company_id')
        .eq('state_hash', stateHash)
        .maybeSingle();
      if (error) throw new MetaConnectionError('INTERNAL_ERROR');
      return data;
    },

    async createOAuthState(input: Record<string, unknown>) {
      const { data, error } = await adminClient.from('company_social_oauth_states')
        .insert({
          company_id: input.companyId,
          actor_auth_user_id: input.actorId,
          provider: input.provider,
          state_hash: input.stateHash,
          redirect_uri: input.redirectUri,
          return_path: input.returnPath,
          expires_at: input.expiresAt,
        })
        .select('id')
        .single();
      if (error || !data?.id) throw new MetaConnectionError('INTERNAL_ERROR');
      return data;
    },

    async consumeOAuthState(input: Record<string, unknown>) {
      const { data, error } = await adminClient.rpc('consume_company_social_oauth_state', {
        p_state_hash: input.stateHash,
        p_company_id: input.companyId,
        p_actor_auth_user_id: input.actorId,
        p_provider: input.provider,
        p_redirect_uri: input.redirectUri,
      });
      if (error) throw new MetaConnectionError('INTERNAL_ERROR');
      return Array.isArray(data) ? data[0] ?? null : null;
    },

    async classifyOAuthState(stateHash: string, companyId: string, actorId: string) {
      const { data, error } = await adminClient
        .from('company_social_oauth_states')
        .select('company_id,actor_auth_user_id,provider,expires_at,consumed_at')
        .eq('state_hash', stateHash)
        .maybeSingle();
      if (error) throw new MetaConnectionError('INTERNAL_ERROR');
      if (!data || data.company_id !== companyId || data.actor_auth_user_id !== actorId || data.provider !== META_PROVIDER) {
        return 'OAUTH_STATE_INVALID';
      }
      if (data.consumed_at) return 'OAUTH_STATE_REPLAYED';
      if (Date.parse(data.expires_at) <= Date.now()) return 'OAUTH_STATE_EXPIRED';
      return 'OAUTH_STATE_INVALID';
    },

    async saveOAuthDiscovery(id: string, companyId: string, actorId: string, envelope: unknown, assets: unknown) {
      const { data, error } = await adminClient
        .from('company_social_oauth_states')
        .update({ encrypted_pending_token_bundle: envelope, discovered_assets: assets, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('company_id', companyId)
        .eq('actor_auth_user_id', actorId)
        .not('consumed_at', 'is', null)
        .select('id')
        .single();
      if (error || data?.id !== id) throw new MetaConnectionError('INTERNAL_ERROR');
    },

    async cleanupOAuthStates(input: Record<string, unknown>) {
      const { data, error } = await adminClient.rpc('cleanup_company_social_oauth_states', {
        p_company_id: input.companyId,
        p_provider: input.provider,
        p_now: input.now,
        p_limit: input.limit,
      });
      if (error || !Number.isInteger(Number(data)) || Number(data) < 0) throw new MetaConnectionError('INTERNAL_ERROR');
      return Number(data);
    },

    async getStatus(companyId: string, actorId: string) {
      const [connectionResult, pendingResult] = await Promise.all([
        adminClient
          .from('company_social_connections')
          .select('id,provider,status,facebook_page_id,facebook_page_name,instagram_account_id,instagram_username,instagram_account_type,granted_scopes,connected_at,last_checked_at,last_error_code,token_expires_at')
          .eq('company_id', companyId)
          .neq('status', 'revoked')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        adminClient
          .from('company_social_oauth_states')
          .select('id,expires_at,discovered_assets')
          .eq('company_id', companyId)
          .eq('actor_auth_user_id', actorId)
          .not('consumed_at', 'is', null)
          .not('encrypted_pending_token_bundle', 'is', null)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (connectionResult.error || pendingResult.error) throw new MetaConnectionError('INTERNAL_ERROR');
      return { connection: connectionResult.data ?? null, pending: pendingResult.data ?? null };
    },

    async getPendingOAuthSession(id: string, companyId: string, actorId: string) {
      const { data, error } = await adminClient
        .from('company_social_oauth_states')
        .select('id,company_id,actor_auth_user_id,redirect_uri,expires_at,discovered_assets,encrypted_pending_token_bundle')
        .eq('id', id)
        .eq('company_id', companyId)
        .eq('actor_auth_user_id', actorId)
        .not('consumed_at', 'is', null)
        .maybeSingle();
      if (error) throw new MetaConnectionError('INTERNAL_ERROR');
      return data;
    },

    async replaceConnection(input: Record<string, any>) {
      const asset = input.asset;
      const { data, error } = await adminClient.rpc('replace_company_social_connection', {
        p_connection_id: input.connectionId,
        p_company_id: input.companyId,
        p_provider: input.provider,
        p_facebook_page_id: asset.pageId,
        p_facebook_page_name: asset.pageName,
        p_instagram_account_id: asset.instagram?.accountId ?? null,
        p_instagram_username: asset.instagram?.username ?? null,
        p_instagram_account_type: asset.instagram?.accountType ?? null,
        p_granted_scopes: input.grantedScopes,
        p_token_envelope: input.tokenEnvelope,
        p_token_expires_at: input.tokenExpiresAt,
        p_actor_id: input.actorId,
        p_actor_name: input.actorName,
        p_actor_role: input.actorRole,
        p_timestamp: input.timestamp,
      });
      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row?.id || row.id !== input.connectionId) throw new MetaConnectionError('INTERNAL_ERROR');
      return row;
    },

    async deleteOAuthSession(id: string, companyId: string, actorId: string) {
      const { data, error } = await adminClient.from('company_social_oauth_states')
        .delete()
        .eq('id', id)
        .eq('company_id', companyId)
        .eq('actor_auth_user_id', actorId)
        .select('id');
      if (error || !Array.isArray(data) || data.length !== 1 || data[0]?.id !== id) throw new MetaConnectionError('INTERNAL_ERROR');
    },

    async getConnection(id: string, companyId: string) {
      const { data, error } = await adminClient.from('company_social_connections').select('*').eq('id', id).eq('company_id', companyId).maybeSingle();
      if (error) throw new MetaConnectionError('INTERNAL_ERROR');
      return data;
    },

    async updateHealth(id: string, input: Record<string, unknown>) {
      const { data, error } = await adminClient
        .from('company_social_connections')
        .update({
          status: input.status,
          last_checked_at: input.checkedAt,
          last_error_code: input.lastErrorCode,
          granted_scopes: input.grantedScopes,
          updated_at: input.checkedAt,
        })
        .eq('id', id)
        .select('*')
        .single();
      if (error || !data) throw new MetaConnectionError('INTERNAL_ERROR');
      return data;
    },

    async disconnectConnection(input: Record<string, unknown>) {
      const { data, error } = await adminClient.rpc('disconnect_company_social_connection', {
        p_connection_id: input.connectionId,
        p_company_id: input.companyId,
        p_provider: input.provider,
        p_actor_id: input.actorId,
        p_actor_name: input.actorName,
        p_actor_role: input.actorRole,
        p_timestamp: input.timestamp,
      });
      const row = Array.isArray(data) ? data[0] ?? null : null;
      if (error) throw new MetaConnectionError('INTERNAL_ERROR');
      return row;
    },

    async recordAudit(input: Record<string, unknown>) {
      const { error } = await adminClient.from('audit_events').insert({
        company_id: input.companyId,
        actor_user_id: input.actorId,
        actor_name: input.actorName,
        actor_role: input.actorRole,
        category: 'access',
        action: input.event,
        resource: 'Meta social connection',
        resource_id: input.connectionId,
        details: 'Meta connection lifecycle action completed.',
      });
      if (error) throw new MetaConnectionError('INTERNAL_ERROR');
    },
  };
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin');
  const allowed = allowedOrigins();
  if (origin && !allowed.has(origin)) return null;
  return {
    ...baseHeaders(),
    'Access-Control-Allow-Origin': origin ?? [...allowed][0] ?? 'http://127.0.0.1:5173',
    Vary: 'Origin',
  };
}

function baseHeaders() {
  return {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
  };
}

function allowedOrigins() {
  const values = [Deno.env.get('APP_URL'), Deno.env.get('SITE_URL'), ...(Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',')];
  const origins = new Set<string>(['http://127.0.0.1:5173', 'http://localhost:5173']);
  for (const value of values) {
    try {
      if (value?.trim()) origins.add(new URL(value.trim()).origin);
    } catch {
      // Invalid configured origins are ignored and never reflected.
    }
  }
  return origins;
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

function safeAuditText(value: unknown, fallback: string) {
  const clean = typeof value === 'string' ? value.trim() : '';
  return clean && clean.length <= 120 && !/[<>\u0000-\u001f]/.test(clean) ? clean : fallback;
}

function getServiceRoleKey() {
  const directKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
  if (directKey) return directKey;
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!secretKeys) return '';
  try {
    return findServiceKey(JSON.parse(secretKeys)) ?? '';
  } catch {
    return '';
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
