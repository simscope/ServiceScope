import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type OAuthSettingsRequest = {
  companyId?: string;
  provider?: 'google' | 'microsoft';
  clientId?: string;
  clientSecret?: string;
  redirectUrl?: string;
};

type AuthUser = {
  id: string;
  email?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
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
    if (
      typeof item === 'string' &&
      (normalizedKey.includes('service') || normalizedKey.includes('secret')) &&
      item.startsWith('eyJ')
    ) {
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

function normalizeRedirectUrl(value: string | undefined, supabaseUrl: string) {
  const fallback = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/mailbox-oauth-callback`;
  const trimmed = value?.trim();
  return trimmed || fallback;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = getServiceRoleKey();

  const missingEnv = [
    !supabaseUrl ? 'SUPABASE_URL' : '',
    !supabaseAnonKey ? 'SUPABASE_ANON_KEY' : '',
    !serviceRoleKey ? 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEYS service key' : '',
  ].filter(Boolean);

  if (missingEnv.length) {
    return jsonResponse({ error: `Mailbox settings function is missing: ${missingEnv.join(', ')}.` }, 500);
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing authenticated caller.' }, 401);
  }

  const payload = (await request.json().catch(() => ({}))) as OAuthSettingsRequest;
  const companyId = payload.companyId?.trim();
  const provider = payload.provider;
  const clientId = payload.clientId?.trim();
  const clientSecret = payload.clientSecret?.trim();
  const redirectUrl = normalizeRedirectUrl(payload.redirectUrl, supabaseUrl);

  if (!companyId || !provider || !clientId) {
    return jsonResponse({ error: 'Company, provider, and Client ID are required.' }, 400);
  }

  if (provider !== 'google' && provider !== 'microsoft') {
    return jsonResponse({ error: 'Only Google Workspace and Microsoft 365 OAuth settings can be saved here.' }, 400);
  }

  const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  });

  const { data: sessionRows, error: sessionError } = await callerClient.rpc('app_current_session');
  if (sessionError) {
    return jsonResponse({ error: sessionError.message }, 401);
  }

  const callerSession = Array.isArray(sessionRows) ? sessionRows[0] : null;
  const callerKind = callerSession?.kind;
  const callerRole = String(callerSession?.role ?? '').toLowerCase();
  const callerCompanyId = callerSession?.company_id;
  const canManageMailbox =
    callerKind === 'owner' ||
    (callerKind === 'company' &&
      callerCompanyId === companyId &&
      (callerRole === 'admin' || callerRole === 'manager'));

  if (!canManageMailbox) {
    return jsonResponse({ error: 'Current login cannot manage this mailbox.' }, 403);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const existing = await adminClient
    .from('mailbox_oauth_settings')
    .select('client_secret')
    .eq('company_id', companyId)
    .eq('provider', provider)
    .maybeSingle();

  if (existing.error && existing.error.code !== 'PGRST116') {
    return jsonResponse({ error: existing.error.message }, 400);
  }

  const secretToSave = clientSecret || existing.data?.client_secret;
  if (!secretToSave) {
    return jsonResponse({ error: 'Client secret is required the first time settings are saved.' }, 400);
  }

  const { error } = await adminClient
    .from('mailbox_oauth_settings')
    .upsert(
      {
        company_id: companyId,
        provider,
        client_id: clientId,
        client_secret: secretToSave,
        redirect_url: redirectUrl,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'company_id,provider',
      },
    );

  if (error) {
    return jsonResponse({ error: error.message }, 400);
  }

  return jsonResponse({
    ok: true,
    provider,
    redirectUrl,
  });
});
