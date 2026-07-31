import { useEffect, useMemo, useState } from 'react';
import { loadCompanyVoiceSettings, saveCompanyVoiceSettings } from './clientApi';
import { createDefaultCompanyVoiceSettings, type CompanyVoiceSettings } from './contracts';

export function useCompanyVoiceSettings(companyId: string, fallbackDisplayName: string) {
  const initial = useMemo(() => createDefaultCompanyVoiceSettings(fallbackDisplayName), [companyId, fallbackDisplayName]);
  const [saved, setSaved] = useState<CompanyVoiceSettings>(initial);
  const [draft, setDraft] = useState<CompanyVoiceSettings>(initial);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    setSaved(initial);
    setDraft(initial);
    setStatus('loading');
    setMessage('');
    loadCompanyVoiceSettings(companyId)
      .then((settings) => {
        if (!active) return;
        const next = settings.publicDisplayName ? settings : { ...settings, publicDisplayName: fallbackDisplayName };
        setSaved(next);
        setDraft(next);
        setStatus('ready');
      })
      .catch((error) => {
        if (!active) return;
        setStatus('error');
        setMessage(normalizeSettingsError(error));
      });
    return () => {
      active = false;
    };
  }, [companyId, fallbackDisplayName, initial]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  function update(patch: Partial<CompanyVoiceSettings>) {
    setDraft((current) => ({ ...current, ...patch }));
    setStatus('ready');
    setMessage('');
  }

  async function save() {
    setStatus('saving');
    setMessage('');
    try {
      const next = await saveCompanyVoiceSettings(companyId, draft);
      setSaved(next);
      setDraft(next);
      setStatus('saved');
      setMessage('Company voice saved.');
    } catch (error) {
      setStatus('error');
      setMessage(normalizeSettingsError(error));
    }
  }

  function reset() {
    setDraft(saved);
    setStatus('ready');
    setMessage('Changes reset.');
  }

  return { draft, dirty, message, reset, save, setDraft, status, update };
}

function normalizeSettingsError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/401|403|42501|row-level security|permission|authorized/i.test(message)) {
    return 'You are not authorized to change company voice settings.';
  }
  if (/column .* does not exist|schema cache/i.test(message)) {
    return 'Company voice settings are waiting for the approved database migration.';
  }
  return message || 'Company voice settings could not be saved.';
}
