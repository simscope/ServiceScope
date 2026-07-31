import { CompanyVoiceSettingsPanel } from './CompanyVoiceSettingsPanel';

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
    </section>
  );
}
