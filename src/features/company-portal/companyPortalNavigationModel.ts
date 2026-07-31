import type { ClientPage } from '../../appTypes';
import type { CompanyPortalAccessLevel, CompanyPortalAccessPage } from '../../types';
import { resolveClientNavigation } from '../navigation/clientNavigation';
import { resolveActivePageReadOnly, type CompanySettingsMode } from './companySettingsAccess';

type CompanyPortalNavigationModelInput = {
  clientPage: ClientPage;
  canViewPage: (page: CompanyPortalAccessPage) => boolean;
  canWritePage: (page: CompanyPortalAccessPage) => boolean;
  accessLevelForPage: (page: CompanyPortalAccessPage) => CompanyPortalAccessLevel;
  companySettingsMode: CompanySettingsMode;
};

export function makeCompanyPortalNavigationModel({
  clientPage,
  canViewPage,
  canWritePage,
  accessLevelForPage,
  companySettingsMode,
}: CompanyPortalNavigationModelInput) {
  const {
    visibleClientNavItems,
    renderedClientPage,
    activeClientNavItem,
  } = resolveClientNavigation({
    clientPage,
    canViewPage,
    companySettingsMode,
  });
  const accessPage = renderedClientPage as CompanyPortalAccessPage;
  const activePageAccessLevel = accessLevelForPage(accessPage);
  const activePageReadOnly = resolveActivePageReadOnly({
    renderedClientPage,
    companySettingsMode,
    hasPageWriteAccess: canWritePage(accessPage),
  });

  return {
    activeClientNavItem,
    activePageAccessLevel,
    activePageReadOnly,
    companySettingsMode,
    renderedClientPage,
    visibleClientNavItems,
  };
}
