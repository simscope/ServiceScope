import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type WebsiteIntakeRequest = {
  token?: string;
  source?: string;
  clientName?: string;
  name?: string;
  clientPhone?: string;
  phone?: string;
  clientEmail?: string;
  email?: string;
  address?: string;
  message?: string;
  honeypot?: string;
  website?: string;
};

type CompanyProfileRow = {
  company_id: string;
  website_intake_enabled: boolean | null;
  website_intake_allowed_origins: string | null;
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

function clean(value: unknown, maxLength: number) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return value.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  }
}

function originIsAllowed(requestOrigin: string | null, allowedOrigins: string | null) {
  const allowed = clean(allowedOrigins, 2000);
  if (!allowed) return true;
  if (!requestOrigin) return false;

  const originHost = normalizeHost(requestOrigin);
  return allowed
    .split(/[\n,]+/)
    .map((origin) => normalizeHost(origin.trim()))
    .filter(Boolean)
    .some((allowedHost) => allowedHost === originHost);
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
    return jsonResponse({ error: 'Website intake is missing Supabase environment.' }, 500);
  }

  const payload = (await request.json().catch(() => ({}))) as WebsiteIntakeRequest;
  if (clean(payload.honeypot ?? payload.website, 200)) {
    return jsonResponse({ ok: true });
  }

  const token = clean(payload.token, 120);
  const clientName = clean(payload.clientName ?? payload.name, 160);
  const clientPhone = clean(payload.clientPhone ?? payload.phone, 80);
  const clientEmail = clean(payload.clientEmail ?? payload.email, 160).toLowerCase();
  const address = clean(payload.address, 240);
  const message = clean(payload.message, 2000);
  const source = payload.source === 'online_booking' ? 'online_booking' : 'website';

  if (!token) return jsonResponse({ error: 'Website intake token is required.' }, 400);
  if (!clientName && !clientPhone && !clientEmail && !message) {
    return jsonResponse({ error: 'Name, phone, email, or message is required.' }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: profiles, error: profileError } = await adminClient
    .from('company_profiles')
    .select('company_id,website_intake_enabled,website_intake_allowed_origins')
    .eq('website_intake_token', token)
    .limit(1);

  if (profileError) return jsonResponse({ error: profileError.message }, 500);

  const profile = (profiles?.[0] ?? null) as CompanyProfileRow | null;
  if (!profile || !profile.website_intake_enabled) {
    return jsonResponse({ error: 'Website intake is not enabled.' }, 404);
  }

  const requestOrigin = request.headers.get('Origin');
  if (!originIsAllowed(requestOrigin, profile.website_intake_allowed_origins)) {
    return jsonResponse({ error: 'This website is not allowed to submit requests.' }, 403);
  }

  const { data: rows, error: insertError } = await adminClient
    .from('job_inbox')
    .insert([{
      company_id: profile.company_id,
      source,
      client_name: clientName,
      client_phone: clientPhone,
      client_email: clientEmail || null,
      address,
      message,
      status: 'new',
    }])
    .select('id')
    .limit(1);

  if (insertError) return jsonResponse({ error: insertError.message }, 500);

  return jsonResponse({ ok: true, id: rows?.[0]?.id ?? null });
});
