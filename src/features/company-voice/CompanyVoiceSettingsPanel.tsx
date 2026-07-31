import { Palette, RotateCcw, Save } from 'lucide-react';
import type { CompanyVoiceSettings } from './contracts';
import { COMPANY_VOICE_CHANNELS, splitGuidanceLines } from './contracts';
import { useCompanyVoiceSettings } from './useCompanyVoiceSettings';
import { ASSISTANT_TONES } from '../content-engine/contracts';

type CompanyVoiceSettingsPanelProps = {
  companyId: string;
  fallbackDisplayName: string;
  logoUrl: string;
  readOnly: boolean;
};

export function CompanyVoiceSettingsPanel({
  companyId,
  fallbackDisplayName,
  logoUrl,
  readOnly,
}: CompanyVoiceSettingsPanelProps) {
  const settings = useCompanyVoiceSettings(companyId, fallbackDisplayName);
  const draft = settings.draft;
  const disabled = readOnly || settings.status === 'loading' || settings.status === 'saving';

  function updateChannel(channel: keyof CompanyVoiceSettings['channelDefaults'], patch: Partial<CompanyVoiceSettings['channelDefaults'][typeof channel]>) {
    settings.setDraft((current) => ({
      ...current,
      channelDefaults: {
        ...current.channelDefaults,
        [channel]: { ...current.channelDefaults[channel], ...patch },
      },
    }));
  }

  return (
    <section className="panel company-voice-panel" aria-labelledby="company-voice-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">AI Brand Voice</p>
          <h2 id="company-voice-title">Company voice</h2>
        </div>
        <Palette size={20} aria-hidden="true" />
      </div>

      {logoUrl ? (
        <div className="company-voice-logo">
          <img src={logoUrl} alt={`${fallbackDisplayName} logo`} />
          <span>Existing company logo</span>
        </div>
      ) : null}

      <fieldset disabled={disabled} className="company-voice-fieldset">
        <label className="company-voice-toggle">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => settings.update({ enabled: event.target.checked })} />
          Enable company voice
        </label>

        <div className="company-voice-fields">
          <label>
            Public display name
            <input maxLength={80} value={draft.publicDisplayName} onChange={(event) => settings.update({ publicDisplayName: event.target.value })} />
          </label>
          <label>
            Default tone
            <select value={draft.defaultTone} onChange={(event) => settings.update({ defaultTone: event.target.value as CompanyVoiceSettings['defaultTone'] })}>
              {ASSISTANT_TONES.map((tone) => <option key={tone}>{tone}</option>)}
            </select>
          </label>
          <label className="company-voice-wide">
            Custom voice guidance
            <textarea maxLength={1000} value={draft.customVoiceGuidance} onChange={(event) => settings.update({ customVoiceGuidance: event.target.value })} />
          </label>
          <label>
            Approved service areas
            <textarea value={draft.serviceAreas.join('\n')} onChange={(event) => settings.update({ serviceAreas: splitGuidanceLines(event.target.value) })} />
          </label>
          <label>
            Public location wording
            <textarea maxLength={160} value={draft.publicLocationWording} onChange={(event) => settings.update({ publicLocationWording: event.target.value })} />
          </label>
          <label>
            Standard CTA guidance
            <textarea maxLength={160} value={draft.callToActionGuidance} onChange={(event) => settings.update({ callToActionGuidance: event.target.value })} />
          </label>
          <label>
            Hashtag / keyword guidance
            <textarea value={draft.hashtagGuidance.join('\n')} onChange={(event) => settings.update({ hashtagGuidance: splitGuidanceLines(event.target.value) })} />
          </label>
        </div>

        <div className="company-voice-channels">
          {COMPANY_VOICE_CHANNELS.map((channel) => {
            const channelDefaults = draft.channelDefaults[channel];
            return (
              <div className="company-voice-channel" key={channel}>
                <div className="company-voice-channel-heading">
                  <strong>{channel}</strong>
                  <label>
                    <input type="checkbox" checked={channelDefaults.enabled} onChange={(event) => updateChannel(channel, { enabled: event.target.checked })} />
                    Enabled
                  </label>
                </div>
                <div className="company-voice-channel-fields">
                  <label>
                    Default tone
                    <select value={channelDefaults.defaultTone} onChange={(event) => updateChannel(channel, { defaultTone: event.target.value as CompanyVoiceSettings['defaultTone'] })}>
                      {ASSISTANT_TONES.map((tone) => <option key={tone}>{tone}</option>)}
                    </select>
                  </label>
                  <label>
                    Default locale
                    <input maxLength={35} value={channelDefaults.defaultLocale} onChange={(event) => updateChannel(channel, { defaultLocale: event.target.value })} />
                  </label>
                  <label>
                    CTA override
                    <input maxLength={160} value={channelDefaults.callToActionGuidance} onChange={(event) => updateChannel(channel, { callToActionGuidance: event.target.value })} />
                  </label>
                  <label>
                    Hashtag / keyword guidance
                    <input value={channelDefaults.hashtagGuidance.join(', ')} onChange={(event) => updateChannel(channel, { hashtagGuidance: splitGuidanceLines(event.target.value) })} />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </fieldset>

      <div className="company-voice-actions">
        <button className="primary-button" type="button" onClick={settings.save} disabled={disabled || !settings.dirty}>
          <Save size={16} aria-hidden="true" />
          {settings.status === 'saving' ? 'Saving...' : 'Save company voice'}
        </button>
        <button className="secondary-button" type="button" onClick={settings.reset} disabled={disabled || !settings.dirty}>
          <RotateCcw size={16} aria-hidden="true" />
          Reset
        </button>
        {settings.dirty ? <span className="company-voice-unsaved">Unsaved changes</span> : null}
        {settings.message ? <span className={settings.status === 'error' ? 'company-voice-error' : 'company-voice-status'}>{settings.message}</span> : null}
        {readOnly ? <span className="company-voice-error">Company settings access is read-only.</span> : null}
      </div>
    </section>
  );
}
