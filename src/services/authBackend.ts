import type { AuthSession } from '../appTypes';
import { signInWithSupabasePassword, supabaseRequest } from './supabaseRest';

type BackendSessionRow = {
  kind: 'owner' | 'company';
  user_id: string;
  name: string;
  email: string;
  company_id: string | null;
  company_name: string | null;
  role: string;
  status: string;
};

function mapCompanyRole(role: string): 'Manager' | 'Admin' | 'Technician' {
  if (role === 'admin') return 'Admin';
  if (role === 'manager' || role === 'dispatcher') return 'Manager';
  return 'Technician';
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function signInAndResolveSession(email: string, password: string): Promise<AuthSession> {
  await signInWithSupabasePassword(email, password);

  let lastError: unknown;
  for (const delay of [0, 250, 700]) {
    if (delay) await wait(delay);
    try {
      return await resolveCurrentAuthSession();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export async function resolveCurrentAuthSession(): Promise<AuthSession> {
  const rows = await supabaseRequest<BackendSessionRow[]>('rpc/app_current_session', {
    method: 'POST',
    body: {},
    select: true,
  });
  const session = rows[0];

  if (!session || session.status !== 'active') {
    throw new Error('Password was accepted, but this email is not linked to an active ServiceScope workspace. Repair company owner access in Supabase or create access from the owner console.');
  }

  if (session.kind === 'owner') {
    return {
      kind: 'owner',
      userId: session.user_id,
      name: session.name,
      email: session.email,
    };
  }

  if (!session.company_id) {
    throw new Error('Company access is missing a workspace.');
  }

  return {
    kind: 'company',
    companyId: session.company_id,
    name: session.name,
    email: session.email,
    role: mapCompanyRole(session.role),
  };
}
