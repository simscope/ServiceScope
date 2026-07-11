import type { Dispatch, SetStateAction } from 'react';
import type { ClientPage, EmailCompose, EmailComposeAttachment, EmailConnection, EmailFolder, EmailMessage, FinancePeriod, PayrollRules } from '../../appTypes';
import type { Company, CompanyOnboardingProfile, CompanyPortalAccessPage, MaterialRow, ServiceJob } from '../../types';
import type { PayrollItemRow } from '../../services/payrollStore';
import { makeEmailActions } from '../email/emailActions';
import { makeEmailModel } from '../email/emailModel';
import { makeFinanceWorkflow } from '../finance/financeWorkflow';

type CompanyPortalBusinessModelInput = {
  activeCompany: Company;
  allJobsRows: ServiceJob[];
  companyEmailSignature: string;
  companyPaymentBlock: string;
  connectMailboxInFeature: (nextConnection: EmailConnection, persistConnection: (connection: EmailConnection) => void) => void;
  copyMailboxRedirectUrlInFeature: (redirectUrl: string) => Promise<void>;
  emailConnection: EmailConnection | null;
  emailFolder: EmailFolder;
  emailMessages: EmailMessage[];
  emailSearch: string;
  financePeriod: FinancePeriod;
  financeTechFilter: string;
  mailboxOAuthRedirectUrl: string;
  mailboxOAuthSecretDraft: string;
  materials: MaterialRow[];
  openEmailComposeDraft: (
    compose: EmailCompose,
    attachments: EmailComposeAttachment[],
    signatureText: string,
    paymentBlockText: string,
  ) => void;
  payrollItems: PayrollItemRow[];
  payrollRules: PayrollRules;
  persistOnboardingToBackend: (nextProfile: CompanyOnboardingProfile, nextEmailConnection?: EmailConnection | null) => void;
  profile: CompanyOnboardingProfile;
  salaryPaidJobs: Record<string, string>;
  selectedCompanyId: string;
  sendEmailDraftFromFeature: (request: {
    companyId: string;
    signatureText: string;
    paymentBlockText: string;
    attachments: EmailComposeAttachment[];
  }) => Promise<void>;
  setClientPage: Dispatch<SetStateAction<ClientPage>>;
  setEmailConnection: (connection: EmailConnection | null) => void;
  setMailboxConnectStatus: (status: string) => void;
  setMailboxOAuthSecretDraft: (value: string) => void;
  setMailboxOAuthStatus: (status: string) => void;
  setSalaryPaidJobs: Dispatch<SetStateAction<Record<string, string>>>;
  stopCompanyWrite: (page: CompanyPortalAccessPage, action: string) => boolean;
  updateMailboxInFeature: (patch: Partial<EmailConnection>, persistConnection: (connection: EmailConnection) => void) => void;
};

export function makeCompanyPortalBusinessModel({
  activeCompany,
  allJobsRows,
  companyEmailSignature,
  companyPaymentBlock,
  connectMailboxInFeature,
  copyMailboxRedirectUrlInFeature,
  emailConnection,
  emailFolder,
  emailMessages,
  emailSearch,
  financePeriod,
  financeTechFilter,
  mailboxOAuthRedirectUrl,
  mailboxOAuthSecretDraft,
  materials,
  openEmailComposeDraft,
  payrollItems,
  payrollRules,
  persistOnboardingToBackend,
  profile,
  salaryPaidJobs,
  selectedCompanyId,
  sendEmailDraftFromFeature,
  setClientPage,
  setEmailConnection,
  setMailboxConnectStatus,
  setMailboxOAuthSecretDraft,
  setMailboxOAuthStatus,
  setSalaryPaidJobs,
  stopCompanyWrite,
  updateMailboxInFeature,
}: CompanyPortalBusinessModelInput) {
  const emailModel = makeEmailModel({
    emailMessages,
    emailFolder,
    emailSearch,
    jobs: allJobsRows,
  });
  const emailActions = makeEmailActions({
    activeCompany,
    profile,
    emailConnection,
    mailboxOAuthSecretDraft,
    companyEmailSignature,
    companyPaymentBlock,
    mailboxOAuthRedirectUrl,
    selectedCompanyId,
    setClientPage,
    setEmailConnection,
    setMailboxOAuthSecretDraft,
    setMailboxOAuthStatus,
    setMailboxConnectStatus,
    connectMailboxInFeature,
    updateMailboxInFeature,
    copyMailboxRedirectUrlInFeature,
    openEmailComposeDraft,
    sendEmailDraftFromFeature,
    persistOnboardingToBackend,
    stopEmailWrite: (action) => stopCompanyWrite('email', action),
  });
  const financeWorkflow = makeFinanceWorkflow({
    profile,
    jobs: allJobsRows,
    materials,
    payrollRules,
    payrollItems,
    salaryPaidJobs,
    financeTechFilter,
    financePeriod,
    setSalaryPaidJobs,
    stopFinanceWrite: (action) => stopCompanyWrite('finances', action),
  });

  return {
    emailActions,
    emailModel,
    financeWorkflow,
  };
}
