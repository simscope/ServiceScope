import type { ClientPage } from '../../appTypes';
import type { Company, CompanyOnboardingProfile, CompanyPortalAccessLevel } from '../../types';
import { accessLevelLabels } from '../CompanyAccessPage';
import { ClientPageRenderer } from './ClientPageRenderer';
import { SquareBillingModal } from './SquareBillingModal';
import type { ClientPageRendererContextGroups } from './clientPageRendererTypes';
import type { ClientNavItem } from '../../features/navigation/clientNavigation';

type ClientPortalShellProps = {
  activeClientNavItem?: ClientNavItem;
  activeCompany: Company;
  activePageAccessLevel: CompanyPortalAccessLevel;
  activePageReadOnly: boolean;
  billingModalOpen: boolean;
  clientPageRendererContext: ClientPageRendererContextGroups;
  jobsStatus: string;
  onBillingConnected: (updates: Partial<CompanyOnboardingProfile>, status: string) => void;
  onCloseBillingSetup: () => void;
  onNavigateClientPage: (page: ClientPage) => void;
  onSignOut: () => void;
  profile: CompanyOnboardingProfile;
  renderedClientPage: ClientPage;
  selectedCompany: Company;
  unreadEmailCount: number;
  visibleClientNavItems: ClientNavItem[];
  signedInUser?: { name: string; email: string; role: 'Manager' | 'Admin' | 'Technician' };
};

export function ClientPortalShell({
  activeClientNavItem,
  activeCompany,
  activePageAccessLevel,
  activePageReadOnly,
  billingModalOpen,
  clientPageRendererContext,
  jobsStatus,
  onBillingConnected,
  onCloseBillingSetup,
  onNavigateClientPage,
  onSignOut,
  profile,
  renderedClientPage,
  selectedCompany,
  unreadEmailCount,
  visibleClientNavItems,
  signedInUser,
}: ClientPortalShellProps) {
  return (
    <div className="client-app">
      <header className="client-topbar">
        <div className="client-brand">
          <div className="client-logo">{selectedCompany.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{selectedCompany.name}</strong>
            <span>ServiceScope</span>
          </div>
        </div>

        <nav className="client-nav" aria-label="Company navigation">
          {visibleClientNavItems.map((item) => (
            <button
              className={`client-nav-item ${renderedClientPage === item.page ? 'active' : ''} ${item.adminOnly ? 'admin' : ''}`}
              type="button"
              key={item.page}
              onClick={() => onNavigateClientPage(item.page)}
            >
              {item.icon}
              {item.label}
              {item.page === 'email' && unreadEmailCount > 0 ? (
                <span className="client-nav-badge" aria-label={`${unreadEmailCount} unread emails`}>
                  {unreadEmailCount > 99 ? '99+' : unreadEmailCount}
                </span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="client-user">
          <span>{signedInUser?.role ?? 'Admin'}</span>
          <strong>{(signedInUser?.name ?? selectedCompany.ownerName).slice(0, 1).toUpperCase()}</strong>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="client-workspace">
        {jobsStatus ? <p className="access-status portal-status">{jobsStatus}</p> : null}
        {activePageReadOnly ? (
          <div className={'company-access-banner ' + activePageAccessLevel}>
            <strong>{activeClientNavItem?.label ?? 'This page'} is {accessLevelLabels[activePageAccessLevel].toLowerCase()}</strong>
            <span>Owner access controls are active for this company.</span>
          </div>
        ) : null}
        <ClientPageRenderer
          renderedClientPage={renderedClientPage}
          context={clientPageRendererContext}
        />
      </main>
      {billingModalOpen ? (
        <SquareBillingModal
          activeCompany={activeCompany}
          profile={profile}
          onClose={onCloseBillingSetup}
          onConnected={onBillingConnected}
        />
      ) : null}
    </div>
  );
}
