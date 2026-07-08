import type { EmailConnection, EmailProvider } from '../../appTypes';
import { mailboxOAuthRedirectUrl } from '../../services/mailboxOAuthSettings';
import type { Company, CompanyOnboardingProfile } from '../../types';

export function makeCompanyEmailDomain(company: Company) {
  const rawDomain = company.domain?.trim();
  if (rawDomain) {
    try {
      const url = new URL(rawDomain.startsWith('http') ? rawDomain : `https://${rawDomain}`);
      return url.hostname.replace(/^www\./, '');
    } catch {
      return rawDomain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    }
  }

  return `${String(company.name ?? 'company').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^$/, 'company')}.com`;
}

export function makeDefaultEmailConnection(
  company: Company,
  profile: CompanyOnboardingProfile,
  provider: EmailProvider,
): EmailConnection {
  const domain = makeCompanyEmailDomain(company);
  const address = provider === 'smtp' ? `dispatch@${domain}` : '';

  return {
    provider,
    address,
    status: 'backend_required',
    oauthClientId: '',
    oauthClientSecretSaved: false,
    oauthRedirectUrl: mailboxOAuthRedirectUrl,
    lastSync: 'Not synced',
    syncRange: '30',
    autoLinkJobNumber: true,
    autoLinkClientEmail: true,
    createTaskFromUnread: true,
    senderName: profile.displayName || company.name,
    replyTo: address,
    signature: `${profile.displayName || company.name}\n${profile.phone || profile.billingEmail || company.ownerEmail}`,
    imapHost: provider === 'smtp' ? `imap.${domain}` : '',
    imapPort: provider === 'smtp' ? '993' : '',
    smtpHost: provider === 'smtp' ? `smtp.${domain}` : '',
    smtpPort: provider === 'smtp' ? '587' : '',
    security: provider === 'smtp' ? 'tls' : 'ssl',
    username: provider === 'smtp' ? address : '',
  };
}
