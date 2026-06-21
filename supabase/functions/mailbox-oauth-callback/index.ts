import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type OAuthState = {
  companyId: string;
  provider: 'google' | 'microsoft';
  mailboxAddress: string;
  createdAt: number;
};

const htmlHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
};

function getReturnUrl(status: 'connected' | 'failed') {
  const appUrl = Deno.env.get('APP_URL') ?? Deno.env.get('SITE_URL') ?? 'http://127.0.0.1:5173/#portal';
  const [baseUrl, hash = ''] = appUrl.split('#');
  const url = new URL(baseUrl);
  url.searchParams.set('mailbox', status);

  return `${url.toString()}${hash ? `#${hash}` : ''}`;
}

function redirectResponse(status: 'connected' | 'failed') {
  return new Response(null, {
    status: 303,
    headers: {
      Location: getReturnUrl(status),
    },
  });
}

function htmlResponse(title: string, message: string, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:Arial,sans-serif;padding:40px;background:#f4f7f3;color:#07130f}.card{max-width:680px;margin:auto;background:#fff;border:1px solid #d8e0d7;border-radius:10px;padding:28px}a{color:#0b57d0}</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p><p><a href="${getReturnUrl('failed')}">Return to ServiceScope</a></p></div></body></html>`,
    { status, headers: htmlHeaders },
  );
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

function parseState(value: string | null): OAuthState | null {
  if (!value) return null;
  try {
    return JSON.parse(atob(value)) as OAuthState;
  } catch {
    return null;
  }
}

function toByteaHex(value: unknown) {
  const text = JSON.stringify(value);
  const bytes = new TextEncoder().encode(text);
  return `\\x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function exchangeGoogleCode(code: string, clientId: string, clientSecret: string, redirectUrl: string) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUrl,
      grant_type: 'authorization_code',
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error_description || result.error || 'Google token exchange failed.');
  }
  return result;
}

async function exchangeMicrosoftCode(code: string, clientId: string, clientSecret: string, redirectUrl: string) {
  const tenant = Deno.env.get('MICROSOFT_TENANT_ID') || 'common';
  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUrl,
      grant_type: 'authorization_code',
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error_description || result.error || 'Microsoft token exchange failed.');
  }
  return result;
}

Deno.serve(async (request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error_description') || url.searchParams.get('error');
  const state = parseState(url.searchParams.get('state'));
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = getServiceRoleKey();

  if (error) {
    return htmlResponse('Mailbox connection failed', error, 400);
  }

  if (!code || !state?.companyId || !state.provider || !state.mailboxAddress) {
    return htmlResponse('Mailbox connection failed', 'The provider did not return a valid authorization code.', 400);
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return htmlResponse('Mailbox connection failed', 'ServiceScope mailbox backend is missing Supabase service settings.', 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: settings, error: settingsError } = await adminClient
    .from('mailbox_oauth_settings')
    .select('client_id, client_secret, redirect_url')
    .eq('company_id', state.companyId)
    .eq('provider', state.provider)
    .maybeSingle();

  if (settingsError || !settings?.client_id || !settings.client_secret || !settings.redirect_url) {
    return htmlResponse('Mailbox connection failed', settingsError?.message || 'OAuth settings were not found for this company.', 400);
  }

  try {
    const token =
      state.provider === 'google'
        ? await exchangeGoogleCode(code, settings.client_id, settings.client_secret, settings.redirect_url)
        : await exchangeMicrosoftCode(code, settings.client_id, settings.client_secret, settings.redirect_url);

    const { error: upsertError } = await adminClient
      .from('email_connections')
      .upsert(
        {
          company_id: state.companyId,
          provider: state.provider,
          address: state.mailboxAddress,
          status: 'connected',
          last_sync_at: new Date().toISOString(),
          token_encrypted: toByteaHex(token),
          refresh_token_encrypted: token.refresh_token ? toByteaHex({ refresh_token: token.refresh_token }) : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'company_id' },
      );

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    return redirectResponse('connected');
  } catch (exchangeError) {
    return htmlResponse(
      'Mailbox connection failed',
      exchangeError instanceof Error ? exchangeError.message : 'Token exchange failed.',
      400,
    );
  }
});
