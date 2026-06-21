import { getSupabaseAccessToken, isSupabaseConfigured } from './supabaseRest';

type ViteEnv = {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
};

const viteEnv = ((import.meta as unknown as { env?: ViteEnv }).env ?? {}) as ViteEnv;
const supabaseUrl = viteEnv.VITE_SUPABASE_URL?.replace(/\/$/, '') ?? '';
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY ?? '';

function getAccessToken() {
  const accessToken = getSupabaseAccessToken();
  if (!accessToken) {
    throw new Error('Sign in again before connecting billing.');
  }
  return accessToken;
}

export async function startSubscriptionBillingSetup(input: {
  companyId: string;
  billingName: string;
  billingZip: string;
  email: string;
}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/billing-connect`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Billing setup failed with ${response.status}`);
  }

  return result as {
    ok: true;
    applicationId: string;
    locationId: string;
    environment: 'sandbox' | 'production';
  };
}

export async function confirmSubscriptionBillingSetup(input: {
  companyId: string;
  sourceId: string;
  billingName: string;
  billingZip: string;
  email: string;
}) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured.');
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/billing-confirm`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Billing confirmation failed with ${response.status}`);
  }

  return result as {
    ok: true;
    brand: string;
    last4: string;
    expMonth: string;
    expYear: string;
    billingName: string;
    billingZip: string;
  };
}
