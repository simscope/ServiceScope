import type { Dispatch, SetStateAction } from 'react';
import type { CompanyAccessRules, CompanyPortalAccessLevel, CompanyPortalAccessPage } from '../../types';
import { combineAccessLevels } from './companyUserAccess';

type CompanyPortalAccessInput = {
  rules: CompanyAccessRules;
  userRules?: CompanyAccessRules;
  isCompanyOwner?: boolean;
  accessLevelLabels: Record<CompanyPortalAccessLevel, string>;
  setStatus: Dispatch<SetStateAction<string>>;
};

export function makeCompanyPortalAccess({ rules, userRules, isCompanyOwner = false, accessLevelLabels, setStatus }: CompanyPortalAccessInput) {
  const accessLevelForPage = (page: CompanyPortalAccessPage): CompanyPortalAccessLevel => {
    if (isCompanyOwner) return 'full';
    const companyLevel = rules[page] ?? 'full';
    const userLevel = userRules?.[page] ?? (page === 'onboarding' ? 'off' : 'full');
    return combineAccessLevels(companyLevel, userLevel);
  };
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
