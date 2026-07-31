import type { AssistantChannel } from '../ai-assistant/assistantModel';
import { ASSISTANT_TONES, type AssistantTone } from '../content-engine/contracts';

export const COMPANY_VOICE_CHANNELS: AssistantChannel[] = [
  'Instagram',
  'Facebook',
  'LinkedIn',
  'Google Business',
  'Blog / Case Study',
  'Short Video',
];

export type CompanyVoiceChannelDefaults = {
  enabled: boolean;
  defaultTone: AssistantTone;
  defaultLocale: string;
  callToActionGuidance: string;
  hashtagGuidance: string[];
};

export type CompanyVoiceSettings = {
  enabled: boolean;
  publicDisplayName: string;
  defaultTone: AssistantTone;
  customVoiceGuidance: string;
  serviceAreas: string[];
  publicLocationWording: string;
  callToActionGuidance: string;
  hashtagGuidance: string[];
  channelDefaults: Record<AssistantChannel, CompanyVoiceChannelDefaults>;
};

export type CompanyVoiceSummary = {
  enabled: boolean;
  defaultTone: AssistantTone;
  channelDefaults: Partial<Record<AssistantChannel, Pick<CompanyVoiceChannelDefaults, 'enabled' | 'defaultTone' | 'defaultLocale'>>>;
};

export type ChannelGenerationPreference = {
  tone: AssistantTone;
  locale: string;
};

export type GenerationPreferencesByChannel = Record<AssistantChannel, ChannelGenerationPreference>;

export function createDefaultCompanyVoiceSettings(publicDisplayName = ''): CompanyVoiceSettings {
  return {
    enabled: false,
    publicDisplayName,
    defaultTone: 'Professional',
    customVoiceGuidance: '',
    serviceAreas: [],
    publicLocationWording: '',
    callToActionGuidance: '',
    hashtagGuidance: [],
    channelDefaults: Object.fromEntries(COMPANY_VOICE_CHANNELS.map((channel) => [channel, {
      enabled: true,
      defaultTone: 'Professional',
      defaultLocale: 'en-US',
      callToActionGuidance: '',
      hashtagGuidance: [],
    }])) as Record<AssistantChannel, CompanyVoiceChannelDefaults>,
  };
}

export function validateCompanyVoiceSettings(value: CompanyVoiceSettings): CompanyVoiceSettings {
  const defaultTone = validateTone(value.defaultTone);
  const channelDefaults = Object.fromEntries(COMPANY_VOICE_CHANNELS.map((channel) => {
    const defaults = value.channelDefaults[channel];
    if (!defaults) throw new Error(`Missing defaults for ${channel}.`);
    return [channel, {
      enabled: Boolean(defaults.enabled),
      defaultTone: validateTone(defaults.defaultTone),
      defaultLocale: normalizeLocale(defaults.defaultLocale),
      callToActionGuidance: validateCta(defaults.callToActionGuidance, `${channel} CTA`),
      hashtagGuidance: normalizeGuidanceList(defaults.hashtagGuidance, 20, 40, `${channel} hashtag guidance`),
    }];
  })) as Record<AssistantChannel, CompanyVoiceChannelDefaults>;

  return {
    enabled: Boolean(value.enabled),
    publicDisplayName: validateContactFreeText(value.publicDisplayName, 80, 'Public display name'),
    defaultTone,
    customVoiceGuidance: validateContactFreeText(value.customVoiceGuidance, 1000, 'Custom voice guidance'),
    serviceAreas: normalizeGuidanceList(value.serviceAreas, 20, 80, 'Service areas'),
    publicLocationWording: validateContactFreeText(value.publicLocationWording, 160, 'Public location wording'),
    callToActionGuidance: validateCta(value.callToActionGuidance, 'Standard CTA guidance'),
    hashtagGuidance: normalizeGuidanceList(value.hashtagGuidance, 20, 40, 'Hashtag guidance'),
    channelDefaults,
  };
}

export function splitGuidanceLines(value: string) {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

export function companyVoiceDefaultsForChannel(summary: CompanyVoiceSummary, channel: AssistantChannel) {
  const channelDefaults = summary.channelDefaults[channel];
  if (!summary.enabled || channelDefaults?.enabled === false) {
    return { enabled: false, tone: 'Professional' as AssistantTone, locale: 'en-US' };
  }
  return {
    enabled: true,
    tone: channelDefaults?.defaultTone ?? summary.defaultTone,
    locale: channelDefaults?.defaultLocale ?? 'en-US',
  };
}

export function buildGenerationPreferencesByChannel(summary: CompanyVoiceSummary): GenerationPreferencesByChannel {
  return Object.fromEntries(COMPANY_VOICE_CHANNELS.map((channel) => {
    const defaults = companyVoiceDefaultsForChannel(summary, channel);
    return [channel, { tone: defaults.tone, locale: defaults.locale }];
  })) as GenerationPreferencesByChannel;
}

export function updateChannelGenerationPreference(
  current: GenerationPreferencesByChannel,
  channel: AssistantChannel,
  patch: Partial<ChannelGenerationPreference>,
): GenerationPreferencesByChannel {
  return {
    ...current,
    [channel]: { ...current[channel], ...patch },
  };
}

export function resetChannelGenerationPreference(
  current: GenerationPreferencesByChannel,
  summary: CompanyVoiceSummary,
  channel: AssistantChannel,
): GenerationPreferencesByChannel {
  const defaults = companyVoiceDefaultsForChannel(summary, channel);
  return {
    ...current,
    [channel]: { tone: defaults.tone, locale: defaults.locale },
  };
}

function validateTone(value: string): AssistantTone {
  if (!ASSISTANT_TONES.includes(value as AssistantTone)) throw new Error('Choose an approved tone.');
  return value as AssistantTone;
}

function normalizeLocale(value: string) {
  try {
    const [locale] = Intl.getCanonicalLocales(value.trim());
    if (!locale || locale.length > 35) throw new Error();
    return locale;
  } catch {
    throw new Error('Enter a valid locale such as en-US.');
  }
}

function normalizeGuidanceList(value: string[], maxItems: number, maxLength: number, label: string) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} supports up to ${maxItems} entries.`);
  const normalized = value.map((item) => validateContactFreeText(item.replace(/^#+/, ''), maxLength, label)).filter(Boolean);
  const seen = new Set<string>();
  return normalized.filter((item) => {
    const key = item.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateText(value: string, maxLength: number, label: string) {
  const clean = String(value ?? '').trim();
  if (clean.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  if (/[<>]/.test(clean)) throw new Error(`${label} cannot contain HTML or scripts.`);
  if (/\b(api[_ -]?key|authorization|bearer|oauth|password|refresh[_ -]?token|secret|session[_ -]?token)\b/i.test(clean)) {
    throw new Error(`${label} cannot contain credentials or authorization data.`);
  }
  if (/\b(provider|model|temperature|top[_ -]?p|max[_ -]?tokens?|response[_ -]?format|tool[_ -]?choice)\s*[:=]/i.test(clean)) {
    throw new Error(`${label} cannot configure an AI provider or model.`);
  }
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(clean)) throw new Error(`${label} cannot contain URLs.`);
  return clean;
}

function validateContactFreeText(value: string, maxLength: number, label: string) {
  const clean = validateText(value, maxLength, label);
  if (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(clean)
    || /(?:\+?\d[\d\s().-]{7,}\d)/.test(clean)
    || /\b\d{1,6}\s+[A-Za-z0-9.' -]{2,}\s(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\b/i.test(clean)
  ) {
    throw new Error(`${label} cannot contain contact details.`);
  }
  return clean;
}

function validateCta(value: string, label: string) {
  return validateContactFreeText(value, 160, label);
}
