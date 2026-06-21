import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type BillingConnectRequest = {
  companyId?: string;
  billingName?: string;
  billingZip?: string;
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

async function assertCanManageBilling(
  supabaseUrl: string,
  supabaseAnonKey: string,
  authorization: string,
  companyId: string,
) {
  const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: sessionRows, error: sessionError } = await callerClient.rpc('app_current_session');
  if (sessionError) {
    throw new Error(sessionError.message);
  }

  const callerSession = Array.isArray(sessionRows) ? sessionRows[0] : null;
  const callerKind = callerSession?.kind;
  const callerRole = String(callerSession?.role ?? '').toLowerCase();
  const callerCompanyId = callerSession?.company_id;
  const canManageBilling =
    callerKind === 'owner' ||
    (callerKind === 'company' && callerCompanyId === companyId && (callerRole === 'admin' || callerRole === 'manager'));
  if (!canManageBilling) {
    throw new Error('Current login cannot manage billing for this company.');
  }
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
  const squareApplicationId = Deno.env.get('SQUARE_APPLICATION_ID');
  const squareLocationId = Deno.env.get('SQUARE_LOCATION_ID');
  const squareEnvironment = (Deno.env.get('SQUARE_ENVIRONMENT') ?? 'sandbox').toLowerCase();

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Billing function is missing Supabase environment.' }, 500);
  }
  if (!squareApplicationId || !squareLocationId) {
    return jsonResponse({ error: 'Square application and location are not configured.' }, 500);
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing authenticated caller.' }, 401);
  }

  const payload = (await request.json().catch(() => ({}))) as BillingConnectRequest;
  const companyId = payload.companyId?.trim();
  if (!companyId) {
    return jsonResponse({ error: 'Company is required.' }, 400);
  }

  try {
    await assertCanManageBilling(supabaseUrl, supabaseAnonKey, authorization, companyId);

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: company, error: companyError } = await adminClient
      .from('companies')
      .select('id, name, owner_email')
      .eq('id', companyId)
      .single();
    if (companyError || !company) {
      return jsonResponse({ error: companyError?.message || 'Company was not found.' }, 400);
    }

    await adminClient.from('subscriptions').upsert({
      company_id: companyId,
      provider: 'square',
      status: 'not_connected',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id' });

    await adminClient.from('subscription_payment_methods').upsert({
      company_id: companyId,
      provider: 'square',
      status: 'pending',
      billing_name: payload.billingName?.trim() || company.name,
      billing_zip: payload.billingZip?.trim() || null,
      is_default: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'company_id,is_default' });

    return jsonResponse({
      ok: true,
      applicationId: squareApplicationId,
      locationId: squareLocationId,
      environment: squareEnvironment === 'production' ? 'production' : 'sandbox',
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Billing setup failed.' }, 400);
  }
});
