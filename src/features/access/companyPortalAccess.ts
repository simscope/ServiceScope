import type { Dispatch, SetStateAction } from 'react';
import type { CompanyAccessRules, CompanyPortalAccessLevel, CompanyPortalAccessPage } from '../../types';

type CompanyPortalAccessInput = {
  rules: CompanyAccessRules;
  accessLevelLabels: Record<CompanyPortalAccessLevel, string>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export function makeCompanyPortalAccess({ rules, accessLevelLabels, setStatus }: CompanyPortalAccessInput) {
  const accessLevelForPage = (page: CompanyPortalAccessPage): CompanyPortalAccessLevel => rules[page] ?? 'full';
  const canViewPage = (page: CompanyPortalAccessPage) => accessLevelForPage(page) !== 'off';
  const canWritePage = (page: CompanyPortalAccessPage) => accessLevelForPage(page) === 'full';

  const stopCompanyWrite = (page: CompanyPortalAccessPage, action: string) => {
    const level = accessLevelForPage(page);
    if (level === 'full') return false;

    setStatus(`Owner access for ${page} is ${accessLevelLabels[level].toLowerCase()}. Restore full access before ${action}.`);
    return true;
  };

  return {
    accessLevelForPage,
    canViewPage,
    canWritePage,
    stopCompanyWrite,
  };
}
