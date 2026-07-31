import { CompanyVoiceSettingsPanel } from './CompanyVoiceSettingsPanel';
import { SocialConnectionsPanel } from '../meta-connection/SocialConnectionsPanel';

type CompanyVoiceSettingsPageProps = {
  companyId: string;
  fallbackDisplayName: string;
  logoUrl: string;
};

export function CompanyVoiceSettingsPage({
  companyId,
  fallbackDisplayName,
  logoUrl,
}: CompanyVoiceSettingsPageProps) {
  return (
    <section className="client-onboarding company-voice-only-settings">
      <CompanyVoiceSettingsPanel
        companyId={companyId}
        fallbackDisplayName={fallbackDisplayName}
        logoUrl={logoUrl}
        readOnly={false}
      />
      <SocialConnectionsPanel companyId={companyId} />
    </section>
  );
}
