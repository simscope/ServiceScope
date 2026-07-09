import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { EmailConnection } from '../../appTypes';
import { createDefaultCompanyOnboardingProfile } from '../../services/companyOnboardingStore';
import {
  loadMailboxEmailConnection,
  loadMailboxOAuthSettings,
} from '../../services/mailboxOAuthSettings';
import type { Company, CompanyOnboardingProfile } from '../../types';
import { makeDefaultEmailConnection } from './emailDefaults';

type MailboxSettingsLoaderInput = {
  selectedCompany?: Company;
  selectedCompanyId: string;
  onboardingProfile?: CompanyOnboardingProfile;
  setEmailConnection: Dispatch<SetStateAction<EmailConnection | null>>;
  setMailboxOAuthSecretDraft: Dispatch<SetStateAction<string>>;
  setMailboxOAuthStatus: Dispatch<SetStateAction<string>>;
  setMailboxConnectStatus: Dispatch<SetStateAction<string>>;
};

export function useMailboxSettingsLoader({
  selectedCompany,
  selectedCompanyId,
  onboardingProfile,
  setEmailConnection,
  setMailboxOAuthSecretDraft,
  setMailboxOAuthStatus,
  setMailboxConnectStatus,
}: MailboxSettingsLoaderInput) {
  useEffect(() => {
    if (!selectedCompany) {
      setEmailConnection(null);
      setMailboxOAuthSecretDraft('');
      setMailboxOAuthStatus('');
      return undefined;
    }

    let cancelled = false;
    const company = selectedCompany;
    const currentProfile = onboardingProfile ?? createDefaultCompanyOnboardingProfile(company);

    async function loadMailboxSettings() {
      try {
        const [savedConnection, oauthSettings] = await Promise.all([
          loadMailboxEmailConnection(company.id),
          loadMailboxOAuthSettings(company.id),
        ]);

        if (cancelled) return;

        const savedOAuth = savedConnection
          ? savedConnection.provider !== 'smtp'
            ? oauthSettings.find((settings) => settings.provider === savedConnection.provider)
            : undefined
          : oauthSettings[0];

        if (!savedConnection && !savedOAuth) {
          setEmailConnection(null);
          setMailboxOAuthSecretDraft('');
          setMailboxOAuthStatus('');
          setMailboxConnectStatus('');
          return;
        }

        const baseConnection =
          savedConnection ??
          makeDefaultEmailConnection(company, currentProfile, savedOAuth?.provider ?? 'google');
        const nextConnection: EmailConnection = {
          ...baseConnection,
          oauthClientId: savedOAuth?.clientId ?? baseConnection.oauthClientId,
          oauthClientSecretSaved: savedOAuth?.clientSecretSaved ?? baseConnection.oauthClientSecretSaved,
          oauthRedirectUrl: savedOAuth?.redirectUrl ?? baseConnection.oauthRedirectUrl,
        };

        setEmailConnection(nextConnection);
        setMailboxOAuthSecretDraft('');
        setMailboxOAuthStatus(savedOAuth ? 'OAuth settings loaded.' : '');
        setMailboxConnectStatus(nextConnection.status === 'connected' ? '' : '');
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load mailbox settings', error);
        setMailboxOAuthStatus(error instanceof Error ? error.message : 'Mailbox settings could not be loaded.');
      }
    }

    void loadMailboxSettings();

    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId]);
}
