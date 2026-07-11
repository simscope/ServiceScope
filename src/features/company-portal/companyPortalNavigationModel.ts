import type { ClientPage } from '../../appTypes';
import type { CompanyPortalAccessLevel, CompanyPortalAccessPage } from '../../types';
import { resolveClientNavigation } from '../navigation/clientNavigation';

type CompanyPortalNavigationModelInput = {
  clientPage: ClientPage;
  canViewPage: (page: CompanyPortalAccessPage) => boolean;
  canWritePage: (page: CompanyPortalAccessPage) => boolean;
  accessLevelForPage: (page: CompanyPortalAccessPage) => CompanyPortalAccessLevel;
};

export function makeCompanyPortalNavigationModel({
  clientPage,
  canViewPage,
  canWritePage,
  accessLevelForPage,
}: CompanyPortalNavigationModelInput) {
  const {
    visibleClientNavItems,
    renderedClientPage,
    activeClientNavItem,
  } = resolveClientNavigation({
    clientPage,
    canViewPage,
  });
  const accessPage = renderedClientPage as CompanyPortalAccessPage;
  const activePageAccessLevel = accessLevelForPage(accessPage);
  const activePageReadOnly = !canWritePage(accessPage);

  return {
    activeClientNavItem,
    activePageAccessLevel,
    activePageReadOnly,
    renderedClientPage,
    visibleClientNavItems,
  };
}
