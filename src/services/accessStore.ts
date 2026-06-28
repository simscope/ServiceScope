import type { AppPage } from '../appTypes';
import type { NewPlatformUserForm, PlatformUser, PlatformUserRole, PlatformUserStatus } from '../types';

export const SYSTEM_OWNER_ID = 'usr-owner';
export const SYSTEM_OWNER_EMAIL = 'simscopeinc@gmail.com';
const PLATFORM_USERS_STORAGE_KEY = 'servicescope.platformUsers';

export type OwnerPagePermission = Exclude<AppPage, 'companyLogin' | 'portal'>;

export const ownerPageLabels: Record<OwnerPagePermission, string> = {
  dashboard: 'Dashboard',
  companies: 'Companies',
  monitoring: 'Monitoring',
  billing: 'Billing',
  access: 'Access',
  audit: 'Audit',
  support: 'Support',
};

export const ownerPagePermissions: Record<PlatformUserRole, OwnerPagePermission[]> = {
  owner: ['dashboard', 'companies', 'monitoring', 'billing', 'access', 'audit', 'support'],
  admin: ['dashboard', 'companies', 'monitoring', 'billing', 'audit', 'support'],
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
  owner: ['All owner pages', 'Billing', 'Access management', 'Audit log', 'Support', 'Tenant control'],
  admin: ['Dashboard', 'Companies', 'Monitoring', 'Billing', 'Audit', 'Support'],
  support: ['Dashboard', 'Monitoring', 'Audit', 'Support inbox'],
  viewer: ['Dashboard', 'Companies', 'Monitoring', 'Audit read-only'],
};

function normalizePlatformUsers(users: PlatformUser[]) {
  const withoutDuplicateOwner = users.filter((user) => user.id !== SYSTEM_OWNER_ID && user.email.toLowerCase() !== SYSTEM_OWNER_EMAIL);
  return [platformUsersSeed[0], ...withoutDuplicateOwner];
}

export function canAccessOwnerPage(role: PlatformUserRole, page: AppPage) {
  if (page === 'companyLogin' || page === 'portal') return false;
  return ownerPagePermissions[role].includes(page);
}

export function firstAllowedOwnerPage(role: PlatformUserRole): OwnerPagePermission {
  return ownerPagePermissions[role][0] ?? 'dashboard';
}

export function listPlatformUsers() {
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
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PLATFORM_USERS_STORAGE_KEY, JSON.stringify(normalizePlatformUsers(users)));
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
