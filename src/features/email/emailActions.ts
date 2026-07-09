import type {
  ClientPage,
  EmailCompose,
  EmailComposeAttachment,
  EmailConnection,
  EmailProvider,
} from '../../appTypes';
import { saveMailboxOAuthSettings } from '../../services/mailboxOAuthSettings';
import { startMailboxConnection } from '../../services/mailboxConnector';
import type { Company, CompanyOnboardingProfile } from '../../types';
import { makeDefaultEmailConnection } from './emailDefaults';

type EmailActionsInput = {
  activeCompany: Company;
  profile: CompanyOnboardingProfile;
  emailConnection: EmailConnection | null;
  mailboxOAuthSecretDraft: string;
  companyEmailSignature: string;
  companyPaymentBlock: string;
  mailboxOAuthRedirectUrl: string;
  selectedCompanyId: string;
  setClientPage: (page: ClientPage) => void;
  setEmailConnection: (connection: EmailConnection | null) => void;
  setMailboxOAuthSecretDraft: (value: string) => void;
  setMailboxOAuthStatus: (status: string) => void;
  setMailboxConnectStatus: (status: string) => void;
  connectMailboxInFeature: (nextConnection: EmailConnection, persistConnection: (connection: EmailConnection) => void) => void;
  updateMailboxInFeature: (patch: Partial<EmailConnection>, persistConnection: (connection: EmailConnection) => void) => void;
  copyMailboxRedirectUrlInFeature: (redirectUrl: string) => Promise<void>;
  openEmailComposeDraft: (
    compose: EmailCompose,
    attachments: EmailComposeAttachment[],
    signatureText: string,
    paymentBlockText: string,
  ) => void;
  sendEmailDraftFromFeature: (request: {
    companyId: string;
    signatureText: string;
    paymentBlockText: string;
    attachments: EmailComposeAttachment[];
  }) => Promise<void>;
  persistOnboardingToBackend: (nextProfile: CompanyOnboardingProfile, nextEmailConnection?: EmailConnection | null) => void;
  stopEmailWrite: (action: string) => boolean;
};

export function makeEmailActions({
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
  stopEmailWrite,
}: EmailActionsInput) {
  function connectMailbox(provider: EmailProvider) {
    const nextConnection = makeDefaultEmailConnection(activeCompany, profile, provider);

    connectMailboxInFeature(nextConnection, (connection) => persistOnboardingToBackend(profile, connection));
  }

  function updateMailbox(patch: Partial<EmailConnection>) {
    updateMailboxInFeature(patch, (connection) => persistOnboardingToBackend(profile, connection));
  }

  async function copyMailboxRedirectUrl() {
    const redirectUrl = emailConnection?.oauthRedirectUrl || mailboxOAuthRedirectUrl;
    await copyMailboxRedirectUrlInFeature(redirectUrl);
  }

  async function saveMailboxOAuth() {
    if (!emailConnection || emailConnection.provider === 'smtp') {
      setMailboxOAuthStatus('Choose Google Workspace or Microsoft 365 first.');
      return;
    }

    if (!emailConnection.oauthClientId.trim()) {
      setMailboxOAuthStatus('Client ID is required.');
      return;
    }

    if (!mailboxOAuthSecretDraft.trim() && !emailConnection.oauthClientSecretSaved) {
      setMailboxOAuthStatus('Client secret is required.');
      return;
    }

    setMailboxOAuthStatus('Saving OAuth settings...');

    try {
      const result = await saveMailboxOAuthSettings({
        companyId: activeCompany.id,
        provider: emailConnection.provider,
        clientId: emailConnection.oauthClientId.trim(),
        clientSecret: mailboxOAuthSecretDraft.trim(),
        redirectUrl: emailConnection.oauthRedirectUrl || mailboxOAuthRedirectUrl,
      });
      const nextConnection = {
        ...emailConnection,
        oauthRedirectUrl: result.redirectUrl,
        oauthClientSecretSaved: true,
      };
      setEmailConnection(nextConnection);
      persistOnboardingToBackend(profile, nextConnection);
      setMailboxOAuthSecretDraft('');
      setMailboxOAuthStatus('OAuth settings saved. You can connect the mailbox now.');
    } catch (error) {
      setMailboxOAuthStatus(error instanceof Error ? error.message : 'OAuth settings could not be saved.');
    }
  }

  async function startMailboxConnector() {
    if (!emailConnection) {
      setMailboxConnectStatus('Choose a mailbox provider first.');
      return;
    }

    if (!emailConnection.address.trim()) {
      setMailboxConnectStatus('Mailbox address is required.');
      return;
    }

    if (emailConnection.status === 'connected') {
      setMailboxConnectStatus('');
      return;
    }

    setMailboxConnectStatus('Checking mailbox connector...');

    try {
      const result = await startMailboxConnection({
        companyId: activeCompany.id,
        provider: emailConnection.provider,
        mailboxAddress: emailConnection.address,
      });
      setMailboxConnectStatus(result.message);

      if (result.authUrl) {
        window.location.href = result.authUrl;
      }
    } catch (error) {
      setMailboxConnectStatus(error instanceof Error ? error.message : 'Mailbox connector failed.');
    }
  }

  function openEmailCompose(compose: EmailCompose, attachments: EmailComposeAttachment[] = []) {
    if (stopEmailWrite('opening email composer')) return;

    openEmailComposeDraft(compose, attachments, companyEmailSignature, companyPaymentBlock);
    setClientPage('email');
  }

  async function sendEmailDraft(attachments: EmailComposeAttachment[]) {
    if (stopEmailWrite('sending email')) return;

    await sendEmailDraftFromFeature({
      companyId: selectedCompanyId,
      signatureText: companyEmailSignature,
      paymentBlockText: companyPaymentBlock,
      attachments,
    });
  }

  return {
    connectMailbox,
    updateMailbox,
    copyMailboxRedirectUrl,
    saveMailboxOAuth,
    startMailboxConnector,
    openEmailCompose,
    sendEmailDraft,
  };
}
