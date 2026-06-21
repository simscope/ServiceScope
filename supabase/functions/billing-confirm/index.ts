import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type BillingConfirmRequest = {
  companyId?: string;
  sourceId?: string;
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

function getSquareBaseUrl() {
  return (Deno.env.get('SQUARE_ENVIRONMENT') ?? 'sandbox').toLowerCase() === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

async function squareRequest(path: string, body: unknown) {
  const squareAccessToken = Deno.env.get('SQUARE_ACCESS_TOKEN');
  if (!squareAccessToken) {
    throw new Error('SQUARE_ACCESS_TOKEN is not configured.');
  }

  const response = await fetch(`${getSquareBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${squareAccessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': '2026-05-21',
    },
    body: JSON.stringify(body),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(result.errors) && result.errors[0]?.detail
      ? result.errors[0].detail
      : `Square request failed with ${response.status}`;
    throw new Error(message);
  }
  return result;
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
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Billing function is missing Supabase environment.' }, 500);
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing authenticated caller.' }, 401);
  }

  const payload = (await request.json().catch(() => ({}))) as BillingConfirmRequest;
  const companyId = payload.companyId?.trim();
  const sourceId = payload.sourceId?.trim();
  if (!companyId || !sourceId) {
    return jsonResponse({ error: 'Company and Square card token are required.' }, 400);
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

    const { data: existingSubscription } = await adminClient
      .from('subscriptions')
      .select('id, provider_customer_id')
      .eq('company_id', companyId)
      .maybeSingle();

    let customerId = existingSubscription?.provider_customer_id ?? '';
    if (!customerId) {
      const customerResult = await squareRequest('/v2/customers', {
        idempotency_key: crypto.randomUUID(),
        company_name: company.name,
        email_address: payload.email?.trim() || company.owner_email,
        reference_id: companyId,
      });
      customerId = customerResult.customer?.id ?? '';
    }

    if (!customerId) {
      throw new Error('Square customer was not created.');
    }

    const cardResult = await squareRequest('/v2/cards', {
      idempotency_key: crypto.randomUUID(),
      source_id: sourceId,
      card: {
        customer_id: customerId,
        cardholder_name: payload.billingName?.trim() || company.name,
        billing_address: {
          postal_code: payload.billingZip?.trim() || undefined,
        },
      },
    });

    const card = cardResult.card ?? {};
    const now = new Date().toISOString();

    await adminClient.from('subscriptions').upsert({
      company_id: companyId,
      provider: 'square',
      provider_customer_id: customerId,
      status: 'active',
      updated_at: now,
    }, { onConflict: 'company_id' });

    const { data: subscription } = await adminClient
      .from('subscriptions')
      .select('id')
      .eq('company_id', companyId)
      .maybeSingle();

    await adminClient.from('subscription_payment_methods').upsert({
      company_id: companyId,
      subscription_id: subscription?.id ?? existingSubscription?.id ?? null,
      provider: 'square',
      provider_payment_method_id: card.id ?? '',
      status: 'active',
      brand: card.card_brand ?? '',
      last4: card.last_4 ?? '',
      exp_month: card.exp_month ?? null,
      exp_year: card.exp_year ?? null,
      billing_name: payload.billingName?.trim() || company.name,
      billing_zip: payload.billingZip?.trim() || null,
      autopay_enabled: true,
      is_default: true,
      updated_at: now,
    }, { onConflict: 'company_id,is_default' });

    return jsonResponse({
      ok: true,
      brand: card.card_brand ?? '',
      last4: card.last_4 ?? '',
      expMonth: card.exp_month ? String(card.exp_month).padStart(2, '0') : '',
      expYear: card.exp_year ? String(card.exp_year) : '',
      billingName: payload.billingName?.trim() || company.name,
      billingZip: payload.billingZip?.trim() || '',
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Billing confirmation failed.' }, 400);
  }
});
