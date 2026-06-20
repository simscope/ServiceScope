import type { NewPlatformUserForm, PlatformUser, PlatformUserRole, PlatformUserStatus } from '../types';

export const SYSTEM_OWNER_ID = 'usr-owner';
export const SYSTEM_OWNER_EMAIL = 'simscopeinc@gmail.com';

const platformUsersSeed: PlatformUser[] = [
  {
    id: 'usr-owner',
    name: 'ServiceScope Owner',
    email: SYSTEM_OWNER_EMAIL,
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

export function listPlatformUsers() {
  return platformUsersSeed;
}

export function savePlatformUsers(users: PlatformUser[]) {
  void users;
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
