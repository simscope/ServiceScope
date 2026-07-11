import type { EmailConnection } from '../../appTypes';
import type { Company, CompanyOnboardingProfile, SupportTicket } from '../../types';
import { resolveCompanyAccessRules } from '../../components/CompanyAccessPage';
import { createDefaultCompanyOnboardingProfile, makeJobTypes } from '../../services/companyOnboardingStore';
import { makeCompanyCommunicationModel } from '../onboarding/companyCommunicationModel';

type CompanyPortalModelInput = {
  selectedCompany: Company;
  onboardingProfile?: CompanyOnboardingProfile;
  signedInUser?: { name: string; email: string; role: 'Manager' | 'Admin' | 'Technician' };
  tickets: SupportTicket[];
  emailConnection: EmailConnection | null;
};

export function makeCompanyPortalModel({
  selectedCompany,
  onboardingProfile,
  signedInUser,
  tickets,
  emailConnection,
}: CompanyPortalModelInput) {
  const activeCompany = selectedCompany;
  const completedSteps = Object.values(activeCompany.onboarding).filter((step) => step === 'done').length;
  const openTickets = tickets.filter((ticket) => ticket.status !== 'resolved');
  const profile = onboardingProfile ?? createDefaultCompanyOnboardingProfile(activeCompany);
  const companyAccessRules = resolveCompanyAccessRules(activeCompany);
  const companyCommunication = makeCompanyCommunicationModel({
    company: activeCompany,
    profile,
    emailConnection,
  });
  const professionTemplates = makeJobTypes();
  const configuredProfessionNames = new Set(
    profile.jobTypes
      .map((jobType) => String(jobType.name ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  const currentPortalUser = {
    name: signedInUser?.name ?? selectedCompany.ownerName,
    role: signedInUser?.role ?? 'Admin' as const,
  };

  return {
    activeCompany,
    completedSteps,
    companyAccessRules,
    companyCommunication,
    configuredProfessionNames,
    currentPortalUser,
    openTickets,
    professionTemplates,
    profile,
  };
}
