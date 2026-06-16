import type { NewPlatformUserForm, PlatformUser, PlatformUserRole, PlatformUserStatus } from '../types';

const STORAGE_KEY = 'servicescope.v2.platformUsers';
export const SYSTEM_OWNER_ID = 'usr-owner';

const platformUsersSeed: PlatformUser[] = [
  {
    id: 'usr-owner',
    name: 'ServiceScope Owner',
    email: 'owner@servicescope.app',
    role: 'owner',
    status: 'active',
    lastActive: 'Now',
  },
];

export const rolePermissions: Record<PlatformUserRole, string[]> = {
  owner: ['All platform settings', 'Billing', 'Access management', 'Support', 'Tenant provisioning'],
  admin: ['Tenant provisioning', 'Support', 'Billing status', 'Company setup'],
  support: ['Support inbox', 'Read tenant health', 'Reply to companies'],
  viewer: ['Read dashboard', 'Read companies', 'Read support'],
};

function normalizeUser(user: Partial<PlatformUser>): PlatformUser {
  const isSystemOwner = user.id === SYSTEM_OWNER_ID;

  return {
    id: user.id ?? crypto.randomUUID(),
    name: user.name ?? 'Platform user',
    email: user.email ?? '',
    role: isSystemOwner ? 'owner' : user.role === 'owner' ? 'admin' : user.role ?? 'viewer',
    status: isSystemOwner ? 'active' : user.status ?? 'invited',
    lastActive: user.lastActive ?? 'Invite sent',
  };
}

export function listPlatformUsers() {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return platformUsersSeed;

  try {
    return (JSON.parse(saved) as Partial<PlatformUser>[]).map(normalizeUser);
  } catch {
    return platformUsersSeed;
  }
}

export function savePlatformUsers(users: PlatformUser[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
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
