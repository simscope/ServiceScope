import { sqlEq, supabaseRequest } from '../../services/supabaseRest';
import type { AssistantChannel } from '../ai-assistant/assistantModel';
import type { AssistantTone } from '../content-engine/contracts';
import {
  COMPANY_VOICE_CHANNELS,
  createDefaultCompanyVoiceSettings,
  validateCompanyVoiceSettings,
  type CompanyVoiceChannelDefaults,
  type CompanyVoiceSettings,
  type CompanyVoiceSummary,
} from './contracts';

type DbCompanyVoiceRow = {
  ai_voice_enabled: boolean;
  ai_public_display_name: string;
  ai_default_tone: AssistantTone;
  ai_custom_voice_guidance: string;
  ai_service_areas: string[];
  ai_public_location_wording: string;
  ai_cta_guidance: string;
  ai_hashtag_guidance: string[];
  ai_channel_defaults: Partial<Record<AssistantChannel, Partial<CompanyVoiceChannelDefaults>>>;
};

const fullSelect = [
  'ai_voice_enabled',
  'ai_public_display_name',
  'ai_default_tone',
  'ai_custom_voice_guidance',
  'ai_service_areas',
  'ai_public_location_wording',
  'ai_cta_guidance',
  'ai_hashtag_guidance',
  'ai_channel_defaults',
].join(',');

export async function loadCompanyVoiceSettings(companyId: string) {
  const rows = await supabaseRequest<DbCompanyVoiceRow[]>(`company_profiles?company_id=${sqlEq(companyId)}&select=${fullSelect}&limit=1`);
  return mapCompanyVoiceRow(rows[0]);
}

export async function saveCompanyVoiceSettings(companyId: string, settings: CompanyVoiceSettings) {
  const clean = validateCompanyVoiceSettings(settings);
  const rows = await supabaseRequest<DbCompanyVoiceRow[]>(`company_profiles?on_conflict=company_id&select=${fullSelect}`, {
    method: 'POST',
    body: [{
      company_id: companyId,
      ai_voice_enabled: clean.enabled,
      ai_public_display_name: clean.publicDisplayName,
      ai_default_tone: clean.defaultTone,
      ai_custom_voice_guidance: clean.customVoiceGuidance,
      ai_service_areas: clean.serviceAreas,
      ai_public_location_wording: clean.publicLocationWording,
      ai_cta_guidance: clean.callToActionGuidance,
      ai_hashtag_guidance: clean.hashtagGuidance,
      ai_channel_defaults: clean.channelDefaults,
    }],
    prefer: 'resolution=merge-duplicates,return=representation',
  });
  return mapCompanyVoiceRow(rows[0]);
}

export async function loadCompanyVoiceSummary(companyId: string): Promise<CompanyVoiceSummary> {
  const rows = await supabaseRequest<Array<Pick<DbCompanyVoiceRow, 'ai_voice_enabled' | 'ai_default_tone' | 'ai_channel_defaults'>>>(
    `company_profiles?company_id=${sqlEq(companyId)}&select=ai_voice_enabled,ai_default_tone,ai_channel_defaults&limit=1`,
  );
  const row = rows[0];
  if (!row) return { enabled: false, defaultTone: 'Professional', channelDefaults: {} };
  const defaultTone = isTone(row.ai_default_tone) ? row.ai_default_tone : 'Professional';
  const channelDefaults: CompanyVoiceSummary['channelDefaults'] = {};
  for (const channel of COMPANY_VOICE_CHANNELS) {
    const entry = row.ai_channel_defaults?.[channel];
    if (!entry) continue;
    channelDefaults[channel] = {
      enabled: entry.enabled !== false,
      defaultTone: isTone(entry.defaultTone) ? entry.defaultTone : defaultTone,
      defaultLocale: normalizeLocale(entry.defaultLocale),
    };
  }
  return { enabled: row.ai_voice_enabled === true, defaultTone, channelDefaults };
}

function mapCompanyVoiceRow(row?: DbCompanyVoiceRow) {
  const defaults = createDefaultCompanyVoiceSettings();
  if (!row) return defaults;
  const channelDefaults = Object.fromEntries(COMPANY_VOICE_CHANNELS.map((channel) => {
    const saved = row.ai_channel_defaults?.[channel] ?? {};
    return [channel, {
      ...defaults.channelDefaults[channel],
      ...saved,
      hashtagGuidance: Array.isArray(saved.hashtagGuidance) ? saved.hashtagGuidance : [],
    }];
  })) as Record<AssistantChannel, CompanyVoiceChannelDefaults>;
  return validateCompanyVoiceSettings({
    enabled: row.ai_voice_enabled === true,
    publicDisplayName: row.ai_public_display_name ?? '',
    defaultTone: row.ai_default_tone ?? 'Professional',
    customVoiceGuidance: row.ai_custom_voice_guidance ?? '',
    serviceAreas: row.ai_service_areas ?? [],
    publicLocationWording: row.ai_public_location_wording ?? '',
    callToActionGuidance: row.ai_cta_guidance ?? '',
    hashtagGuidance: row.ai_hashtag_guidance ?? [],
    channelDefaults,
  });
}

function isTone(value: unknown): value is AssistantTone {
  return value === 'Professional' || value === 'Friendly' || value === 'Technical' || value === 'Educational' || value === 'Marketing';
}

function normalizeLocale(value: unknown) {
  try {
    return Intl.getCanonicalLocales(typeof value === 'string' ? value : 'en-US')[0] ?? 'en-US';
  } catch {
    return 'en-US';
  }
}
