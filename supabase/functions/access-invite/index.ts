import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type AccessMode = 'create' | 'reset';

type AccessRequest = {
  email?: string;
  password?: string;
  name?: string;
  companyId?: string;
  role?: string;
  mode?: AccessMode;
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

async function findAuthUserByEmail(adminClient: ReturnType<typeof createClient>, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;

    const user = data.users.find((candidate: AuthUser) => candidate.email?.toLowerCase() === email);
    if (user) return user as AuthUser;
    if (data.users.length < 1000) return null;
  }

  return null;
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
    return jsonResponse({ error: `Access function is missing: ${missingEnv.join(', ')}.` }, 500);
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing authenticated caller.' }, 401);
  }

  const payload = (await request.json().catch(() => ({}))) as AccessRequest;
  const email = payload.email?.trim().toLowerCase();
  const password = payload.password?.trim();
  const mode = payload.mode ?? 'create';

  if (!email) {
    return jsonResponse({ error: 'Email is required.' }, 400);
  }

  if (!password || password.length < 6) {
    return jsonResponse({ error: 'Password must be at least 6 characters.' }, 400);
  }

  if (mode !== 'create' && mode !== 'reset') {
    return jsonResponse({ error: 'Invalid access action.' }, 400);
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
  const targetCompanyId = payload.companyId ?? null;
  const callerCanManageAccess =
    callerKind === 'owner' ||
    (callerKind === 'company' &&
      targetCompanyId &&
      callerCompanyId === targetCompanyId &&
      (callerRole === 'admin' || callerRole === 'manager'));

  if (!callerCanManageAccess) {
    return jsonResponse(
      {
        error: 'Current login cannot manage this user access.',
        caller: callerSession
          ? {
              kind: callerKind,
              role: callerRole,
              companyId: callerCompanyId,
              targetCompanyId,
            }
          : null,
      },
      403,
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  let authUser = await findAuthUserByEmail(adminClient, email);
  let action: 'access_created' | 'access_updated' | 'password_reset' = mode === 'reset' ? 'password_reset' : 'access_created';

  if (authUser) {
    const { error } = await adminClient.auth.admin.updateUserById(authUser.id, {
      password,
      email_confirm: true,
      user_metadata: {
        name: payload.name ?? '',
        companyId: targetCompanyId,
        role: payload.role ?? '',
      },
    });
    if (error) {
      return jsonResponse({ error: error.message }, 400);
    }
    action = mode === 'reset' ? 'password_reset' : 'access_updated';
  } else {
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: payload.name ?? '',
        companyId: targetCompanyId,
        role: payload.role ?? '',
      },
    });
    if (error) {
      return jsonResponse({ error: error.message }, 400);
    }
    authUser = data.user as AuthUser;
  }

  if (targetCompanyId && authUser?.id) {
    const { error } = await adminClient
      .from('company_users')
      .upsert({
        company_id: targetCompanyId,
        auth_user_id: authUser.id,
        name: payload.name || email,
        email,
        role: payload.role || 'technician',
        status: 'active',
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'company_id,email',
      });

    if (error) {
      return jsonResponse({ error: error.message }, 400);
    }
  }

  return jsonResponse({ ok: true, action, email });
});
