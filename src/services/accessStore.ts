import type { AppPage } from '../appTypes';
import type { NewPlatformUserForm, PlatformUser, PlatformUserRole, PlatformUserStatus } from '../types';
import { isSupabaseConfigured, supabaseRequest } from './supabaseRest';

export const SYSTEM_OWNER_ID = 'usr-owner';
export const SYSTEM_OWNER_EMAIL = 'simscopeinc@gmail.com';
const PLATFORM_USERS_STORAGE_KEY = 'servicescope.platformUsers';
const PLATFORM_USERS_LIMIT = 200;

type PlatformUserRow = {
  id: string;
  name: string;
  email: string;
  role: PlatformUserRole;
  status: PlatformUserStatus;
  last_active_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type OwnerPagePermission = Exclude<AppPage, 'companyLogin' | 'portal'>;

export const ownerPageLabels: Record<OwnerPagePermission, string> = {
  dashboard: 'Dashboard',
  companies: 'Companies',
  monitoring: 'Monitoring',
  billing: 'Billing',
  companyAccess: 'Company Access',
  access: 'Access',
  audit: 'Audit',
  support: 'Support',
};

export const ownerPagePermissions: Record<PlatformUserRole, OwnerPagePermission[]> = {
  owner: ['dashboard', 'companies', 'monitoring', 'billing', 'companyAccess', 'access', 'audit', 'support'],
  admin: ['dashboard', 'companies', 'monitoring', 'billing', 'companyAccess', 'audit', 'support'],
  support: ['dashboard', 'monitoring', 'audit', 'support'],
  viewer: ['dashboard', 'companies', 'monitoring', 'audit'],
};

const platformUsersSeed: PlatformUser[] = [
  {
    id: SYSTEM_OWNER_ID,
    name: 'ServiceScope Owner',
    email: SYSTEM_OWNER_EMAIL,
    role: 'owner',
    status: 'active',
    lastActive: 'Now',
  },
];

export const rolePermissions: Record<PlatformUserRole, string[]> = {
  owner: ['All owner pages', 'Company access control', 'Billing', 'Access management', 'Audit log', 'Support', 'Tenant control'],
  admin: ['Dashboard', 'Companies', 'Monitoring', 'Billing', 'Company access control', 'Audit', 'Support'],
  support: ['Dashboard', 'Monitoring', 'Audit', 'Support inbox'],
  viewer: ['Dashboard', 'Companies', 'Monitoring', 'Audit read-only'],
};

function normalizePlatformUsers(users: PlatformUser[]) {
  const withoutDuplicateOwner = users.filter((user) => user.id !== SYSTEM_OWNER_ID && user.email.toLowerCase() !== SYSTEM_OWNER_EMAIL);
  return [platformUsersSeed[0], ...withoutDuplicateOwner];
}

function clearStoredPlatformUsers() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(PLATFORM_USERS_STORAGE_KEY);
}

function formatLastActive(value: string | null | undefined) {
  if (!value) return 'Never';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function platformUserFromRow(row: PlatformUserRow): PlatformUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    lastActive: formatLastActive(row.last_active_at ?? row.updated_at ?? row.created_at),
  };
}

function platformUserToRow(user: PlatformUser) {
  return {
    id: user.id,
    name: user.name.trim(),
    email: user.email.trim().toLowerCase(),
    role: user.role,
    status: user.status,
  };
}

async function persistPlatformUsersToBackend(users: PlatformUser[]) {
  const rows = normalizePlatformUsers(users)
    .filter((user) => user.id !== SYSTEM_OWNER_ID && user.email.toLowerCase() !== SYSTEM_OWNER_EMAIL)
    .map(platformUserToRow);

  if (!rows.length) return;

  await supabaseRequest('platform_users?on_conflict=id', {
    method: 'POST',
    body: rows,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

export function canAccessOwnerPage(role: PlatformUserRole, page: AppPage) {
  if (page === 'companyLogin' || page === 'portal') return false;
  return ownerPagePermissions[role].includes(page);
}

export function firstAllowedOwnerPage(role: PlatformUserRole): OwnerPagePermission {
  return ownerPagePermissions[role][0] ?? 'dashboard';
}

export function listPlatformUsers() {
  if (isSupabaseConfigured()) {
    clearStoredPlatformUsers();
    return platformUsersSeed;
  }

  if (typeof window === 'undefined') return platformUsersSeed;
  const saved = window.localStorage.getItem(PLATFORM_USERS_STORAGE_KEY);
  if (!saved) return platformUsersSeed;

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? normalizePlatformUsers(parsed as PlatformUser[]) : platformUsersSeed;
  } catch {
    return platformUsersSeed;
  }
}

export function savePlatformUsers(users: PlatformUser[]) {
  if (isSupabaseConfigured()) {
    clearStoredPlatformUsers();
    void persistPlatformUsersToBackend(users).catch((error) => {
      console.error('Failed to save platform users to Supabase', error);
    });
    return;
  }

  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PLATFORM_USERS_STORAGE_KEY, JSON.stringify(normalizePlatformUsers(users)));
}

export async function loadPlatformUsersFromBackend() {
  if (!isSupabaseConfigured()) return listPlatformUsers();

  const rows = await supabaseRequest<PlatformUserRow[]>(
    `platform_users?select=id,name,email,role,status,last_active_at,created_at,updated_at&order=created_at.desc&limit=${PLATFORM_USERS_LIMIT}`,
  );

  clearStoredPlatformUsers();
  return normalizePlatformUsers(rows.map(platformUserFromRow));
}

export function createPlatformUser(form: NewPlatformUserForm): PlatformUser {
  return {
    id: crypto.randomUUID(),
    ...form,
    role: form.role === 'owner' ? 'admin' : form.role,
    status: 'invited',
    lastActive: 'Invite sent',
  };
}

export function updatePlatformUserRole(user: PlatformUser, role: PlatformUserRole): PlatformUser {
  if (user.id === SYSTEM_OWNER_ID) return user;

  return {
    ...user,
    role: role === 'owner' ? 'admin' : role,
  };
}

export function updatePlatformUserStatus(user: PlatformUser, status: PlatformUserStatus): PlatformUser {
  if (user.id === SYSTEM_OWNER_ID) return user;

  return {
    ...user,
    status,
    lastActive: status === 'disabled' ? 'Disabled' : user.lastActive,
  };
}
