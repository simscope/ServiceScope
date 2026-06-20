import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type MailboxConnectRequest = {
  companyId?: string;
  provider?: 'google' | 'microsoft' | 'smtp';
  mailboxAddress?: string;
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

function makeState(companyId: string, provider: string, mailboxAddress: string) {
  return btoa(JSON.stringify({ companyId, provider, mailboxAddress, createdAt: Date.now() }));
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

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Mailbox function is missing Supabase environment.' }, 500);
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing authenticated caller.' }, 401);
  }

  const payload = (await request.json().catch(() => ({}))) as MailboxConnectRequest;
  const companyId = payload.companyId?.trim();
  const provider = payload.provider;
  const mailboxAddress = payload.mailboxAddress?.trim().toLowerCase() ?? '';

  if (!companyId || !provider || !mailboxAddress) {
    return jsonResponse({ error: 'Company, provider, and mailbox address are required.' }, 400);
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

  if (provider === 'smtp') {
    return jsonResponse({
      ok: true,
      message: 'SMTP settings can be saved now. Live SMTP testing requires the SMTP test/send function.',
    });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: oauthSettings, error: oauthSettingsError } = await adminClient
    .from('mailbox_oauth_settings')
    .select('client_id, client_secret, redirect_url')
    .eq('company_id', companyId)
    .eq('provider', provider)
    .maybeSingle();

  if (oauthSettingsError && oauthSettingsError.code !== 'PGRST116') {
    return jsonResponse({ error: oauthSettingsError.message }, 400);
  }

  if (provider === 'google') {
    if (!oauthSettings?.client_id || !oauthSettings?.client_secret || !oauthSettings?.redirect_url) {
      return jsonResponse({ error: 'Google OAuth settings are not saved for this company yet.' }, 400);
    }

    const params = new URLSearchParams({
      client_id: oauthSettings.client_id,
      redirect_uri: oauthSettings.redirect_url,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send',
      access_type: 'offline',
      prompt: 'consent',
      state: makeState(companyId, provider, mailboxAddress),
      login_hint: mailboxAddress,
    });

    return jsonResponse({
      ok: true,
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      message: 'Open Google authorization to connect this mailbox.',
    });
  }

  if (provider === 'microsoft') {
    if (!oauthSettings?.client_id || !oauthSettings?.client_secret || !oauthSettings?.redirect_url) {
      return jsonResponse({ error: 'Microsoft OAuth settings are not saved for this company yet.' }, 400);
    }

    const tenant = Deno.env.get('MICROSOFT_TENANT_ID') || 'common';
    const params = new URLSearchParams({
      client_id: oauthSettings.client_id,
      redirect_uri: oauthSettings.redirect_url,
      response_type: 'code',
      response_mode: 'query',
      scope: 'offline_access Mail.ReadWrite Mail.Send',
      state: makeState(companyId, provider, mailboxAddress),
      login_hint: mailboxAddress,
    });

    return jsonResponse({
      ok: true,
      authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`,
      message: 'Open Microsoft authorization to connect this mailbox.',
    });
  }

  return jsonResponse({ error: 'Unsupported mailbox provider.' }, 400);
});
