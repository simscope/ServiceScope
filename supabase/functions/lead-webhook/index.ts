import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type LeadPayload = {
  token?: string;
  provider?: string;
  source?: string;
  externalId?: string;
  id?: string;
  leadId?: string;
  clientName?: string;
  name?: string;
  clientPhone?: string;
  phone?: string;
  clientEmail?: string;
  email?: string;
  address?: string;
  message?: string;
  service?: string;
  metadata?: Record<string, unknown>;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-servicescope-lead-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function clean(value: unknown, maxLength: number) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function getServiceRoleKey() {
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) return response({ error: 'Lead webhook is missing Supabase environment.' }, 500);

  const payload = (await request.json().catch(() => ({}))) as LeadPayload;
  const token = clean(request.headers.get('x-servicescope-lead-token') || payload.token, 160);
  const provider = clean(request.headers.get('x-lead-provider') || payload.provider || payload.source || 'partner', 80).toLowerCase();
  const externalId = clean(payload.externalId || payload.leadId || payload.id, 180);
  const clientName = clean(payload.clientName || payload.name, 160);
  const clientPhone = clean(payload.clientPhone || payload.phone, 80);
  const clientEmail = clean(payload.clientEmail || payload.email, 160).toLowerCase();
  const address = clean(payload.address, 240);
  const message = clean([payload.service, payload.message].filter(Boolean).join(': '), 5000);

  if (!token) return response({ error: 'Lead webhook token is required.' }, 401);
  if (!clientName && !clientPhone && !clientEmail && !message) return response({ error: 'A lead must include contact or request details.' }, 400);

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: profiles, error: profileError } = await adminClient
    .from('company_profiles')
    .select('company_id,lead_api_enabled')
    .eq('lead_api_token', token)
    .limit(1);
  if (profileError) return response({ error: profileError.message }, 500);

  const profile = profiles?.[0];
  if (!profile || !profile.lead_api_enabled) return response({ error: 'Lead integration is not enabled.' }, 403);

  if (externalId) {
    const { data: existing, error: existingError } = await adminClient
      .from('job_inbox')
      .select('id')
      .eq('company_id', profile.company_id)
      .eq('external_source', provider)
      .eq('external_id', externalId)
      .maybeSingle();
    if (existingError) return response({ error: existingError.message }, 500);
    if (existing) return response({ ok: true, duplicate: true, id: existing.id });
  }

  const { data: rows, error: insertError } = await adminClient
    .from('job_inbox')
    .insert([{
      company_id: profile.company_id,
      source: 'partner',
      client_name: clientName,
      client_phone: clientPhone,
      client_email: clientEmail || null,
      address,
      message,
      status: 'new',
      external_source: provider,
      external_id: externalId || null,
      metadata: { provider, ...(payload.metadata ?? {}) },
    }])
    .select('id')
    .limit(1);

  if (insertError) return response({ error: insertError.message }, 500);
  return response({ ok: true, duplicate: false, id: rows?.[0]?.id ?? null });
});
