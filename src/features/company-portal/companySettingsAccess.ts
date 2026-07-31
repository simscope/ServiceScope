import type { ClientPage } from '../../appTypes';
import type {
  CompanyPortalAccessPage,
  CompanyTechnicianRole,
  CompanyTechnicianStatus,
  PlatformUserRole,
} from '../../types';

export type CompanySettingsMode = 'full' | 'companyVoiceOnly' | 'hidden';
export type CompanySettingsRenderTarget = 'fullOnboarding' | 'companyVoiceOnly' | null;

type CompanyVoiceManagementCapabilityInput = {
  selectedCompanyId: string;
  sessionKind?: 'owner' | 'company';
  platformRole?: PlatformUserRole;
  sessionCompanyId?: string;
  sessionActive: boolean;
  sessionRole?: 'Manager' | 'Admin' | 'Technician';
  staffRole?: CompanyTechnicianRole;
  staffStatus?: CompanyTechnicianStatus;
};

export function canManageCompanyVoiceSettings({
  selectedCompanyId,
  sessionKind,
  platformRole,
  sessionCompanyId,
  sessionActive,
  sessionRole,
  staffRole,
  staffStatus,
}: CompanyVoiceManagementCapabilityInput) {
  if (!selectedCompanyId || !sessionActive) return false;
  if (sessionKind === 'owner') return platformRole === 'owner';
  if (sessionKind !== 'company' || sessionCompanyId !== selectedCompanyId) return false;
  if (sessionRole === 'Admin') return true;
  return sessionRole === 'Manager' && staffRole === 'manager' && staffStatus === 'active';
}

export function resolveCompanySettingsMode({
  hasFullOnboardingAccess,
  canManageCompanyVoice,
}: {
  hasFullOnboardingAccess: boolean;
  canManageCompanyVoice: boolean;
}): CompanySettingsMode {
  if (hasFullOnboardingAccess) return 'full';
  if (canManageCompanyVoice) return 'companyVoiceOnly';
  return 'hidden';
}

export function resolveCompanySettingsRenderTarget(mode: CompanySettingsMode): CompanySettingsRenderTarget {
  if (mode === 'full') return 'fullOnboarding';
  if (mode === 'companyVoiceOnly') return 'companyVoiceOnly';
  return null;
}

export function resolveClientNavigationPages({
  clientPage,
  navPages,
  canViewPage,
  companySettingsMode,
}: {
  clientPage: ClientPage;
  navPages: ClientPage[];
  canViewPage: (page: CompanyPortalAccessPage) => boolean;
  companySettingsMode: CompanySettingsMode;
}) {
  const canOpenPage = (page: ClientPage) => page === 'onboarding'
    ? companySettingsMode !== 'hidden'
    : canViewPage(page as CompanyPortalAccessPage);
  const visiblePages = navPages.filter(canOpenPage);
  const renderedClientPage = canOpenPage(clientPage)
    ? clientPage
    : visiblePages[0] ?? 'portal';

  return { renderedClientPage, visiblePages };
}

export function resolveActivePageReadOnly({
  renderedClientPage,
  companySettingsMode,
  hasPageWriteAccess,
}: {
  renderedClientPage: ClientPage;
  companySettingsMode: CompanySettingsMode;
  hasPageWriteAccess: boolean;
}) {
  if (renderedClientPage === 'onboarding' && companySettingsMode === 'companyVoiceOnly') return false;
  return !hasPageWriteAccess;
}
