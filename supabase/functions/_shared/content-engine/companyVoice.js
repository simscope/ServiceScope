import { brandPromptVersionByChannel, channels, tones } from './contracts.js';
import { normalizeLocale } from './schemas.js';

const channelHashtagLimits = {
  Instagram: 6,
  Facebook: 3,
  LinkedIn: 3,
  'Google Business': 0,
  'Blog / Case Study': 0,
  'Short Video': 4,
};
const channelDefaultFields = new Set(['enabled', 'defaultTone', 'defaultLocale', 'callToActionGuidance', 'hashtagGuidance']);
const unsafeMarkupPattern = /[<>]/;
const secretPattern = /\b(api[_ -]?key|authorization|bearer|oauth|password|refresh[_ -]?token|secret|session[_ -]?token)\b/i;
const providerConfigurationPattern = /\b(provider|model|temperature|top[_ -]?p|max[_ -]?tokens?|response[_ -]?format|tool[_ -]?choice)\s*[:=]/i;
const urlPattern = /\b(?:https?:\/\/|www\.)\S+/i;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const phonePattern = /(?:\+?\d[\d\s().-]{7,}\d)/;
const streetAddressPattern = /\b\d{1,6}\s+[A-Za-z0-9.' -]{2,}\s(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\b/i;

export function emptyCompanyVoiceContext(channel) {
  return {
    enabled: false,
    publicDisplayName: '',
    defaultTone: 'Professional',
    voiceGuidance: '',
    serviceAreas: [],
    publicLocationLanguage: '',
    callToActionGuidance: '',
    hashtagGuidance: [],
    resolvedChannelDefaults: {
      channel,
      enabled: false,
      defaultTone: 'Professional',
      defaultLocale: 'en-US',
      callToActionGuidance: '',
      hashtagGuidance: [],
    },
  };
}

export function resolveCompanyVoiceContext(rawSettings, channel) {
  if (!channels.includes(channel)) throw new Error('INVALID_COMPANY_VOICE_SETTINGS');
  const disabled = emptyCompanyVoiceContext(channel);
  if (!rawSettings || rawSettings.ai_voice_enabled !== true) return disabled;

  const publicDisplayName = safeText(rawSettings.ai_public_display_name, 80, 'publicDisplayName');
  const defaultTone = safeTone(rawSettings.ai_default_tone ?? 'Professional');
  const voiceGuidance = safeText(rawSettings.ai_custom_voice_guidance, 1000, 'voiceGuidance');
  const serviceAreas = safeTextArray(rawSettings.ai_service_areas, 20, 80, 'serviceAreas');
  const publicLocationLanguage = safeText(rawSettings.ai_public_location_wording, 160, 'publicLocationLanguage');
  const callToActionGuidance = safeCta(rawSettings.ai_cta_guidance, 'callToActionGuidance');
  const hashtagGuidance = normalizeHashtagGuidance(rawSettings.ai_hashtag_guidance, 20);
  const channelDefaults = parseChannelDefaults(rawSettings.ai_channel_defaults);
  const channelSettings = channelDefaults[channel] ?? {};
  if (channelSettings.enabled === false) return disabled;

  const resolvedTone = channelSettings.defaultTone ?? defaultTone;
  const resolvedLocale = channelSettings.defaultLocale ?? 'en-US';
  const resolvedCta = Object.prototype.hasOwnProperty.call(channelSettings, 'callToActionGuidance')
    ? channelSettings.callToActionGuidance
    : callToActionGuidance;
  const resolvedHashtags = Object.prototype.hasOwnProperty.call(channelSettings, 'hashtagGuidance')
    ? channelSettings.hashtagGuidance
    : hashtagGuidance;

  return {
    enabled: true,
    publicDisplayName,
    defaultTone,
    voiceGuidance,
    serviceAreas,
    publicLocationLanguage,
    callToActionGuidance,
    hashtagGuidance,
    resolvedChannelDefaults: {
      channel,
      enabled: true,
      defaultTone: resolvedTone,
      defaultLocale: resolvedLocale,
      callToActionGuidance: resolvedCta,
      hashtagGuidance: resolvedHashtags.slice(0, channelHashtagLimits[channel]),
    },
  };
}

export function applyCompanyVoiceToRequest(request, companyVoice) {
  if (!companyVoice?.enabled) return request;
  return {
    ...request,
    promptVersion: brandPromptVersionByChannel[request.channel],
  };
}

export function normalizeHashtagGuidance(value, maxItems = 20) {
  if (!Array.isArray(value)) throw new Error('INVALID_COMPANY_VOICE_SETTINGS');
  const normalized = value.map((item) => {
    const text = safeText(item, 40, 'hashtagGuidance');
    if (hasContactDetails(text)) throw new Error('INVALID_COMPANY_VOICE_SETTINGS');
    return text.replace(/^#+/, '').replace(/[^\p{L}\p{N}_-]/gu, '');
  }).filter(Boolean);
  return Array.from(new Set(normalized.map((item) => item.toLocaleLowerCase())))
    .map((key) => normalized.find((item) => item.toLocaleLowerCase() === key))
    .filter(Boolean)
    .slice(0, maxItems);
}

function parseChannelDefaults(value) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw new Error('INVALID_COMPANY_VOICE_SETTINGS');
  const result = {};
  for (const [channel, raw] of Object.entries(value)) {
    if (!channels.includes(channel) || !isPlainObject(raw)) throw new Error('INVALID_COMPANY_VOICE_SETTINGS');
    for (const key of Object.keys(raw)) {
      if (!channelDefaultFields.has(key)) throw new Error('INVALID_COMPANY_VOICE_SETTINGS');
    }
    const entry = {};
    if (Object.prototype.hasOwnProperty.call(raw, 'enabled')) {
      if (typeof raw.enabled !== 'boolean') throw new Error('INVALID_COMPANY_VOICE_SETTINGS');
      entry.enabled = raw.enabled;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'defaultTone')) entry.defaultTone = safeTone(raw.defaultTone);
    if (Object.prototype.hasOwnProperty.call(raw, 'defaultLocale')) entry.defaultLocale = normalizeLocale(String(raw.defaultLocale));
    if (Object.prototype.hasOwnProperty.call(raw, 'callToActionGuidance')) entry.callToActionGuidance = safeCta(raw.callToActionGuidance, 'channelCta');
    if (Object.prototype.hasOwnProperty.call(raw, 'hashtagGuidance')) entry.hashtagGuidance = normalizeHashtagGuidance(raw.hashtagGuidance, 20);
    result[channel] = entry;
  }
  return result;
}

function safeTone(value) {
  if (typeof value !== 'string' || !tones.includes(value)) throw new Error('INVALID_COMPANY_VOICE_SETTINGS');
  return value;
}

function safeTextArray(value, maxItems, maxLength, field) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error('INVALID_COMPANY_VOICE_SETTINGS');
  const clean = value.map((item) => safeText(item, maxLength, field)).filter(Boolean);
  return Array.from(new Set(clean.map((item) => item.toLocaleLowerCase())))
    .map((key) => clean.find((item) => item.toLocaleLowerCase() === key))
    .filter(Boolean);
}

function safeText(value, maxLength, field) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error('INVALID_COMPANY_VOICE_SETTINGS');
  const clean = value.trim();
  if (clean.length > maxLength || unsafeMarkupPattern.test(clean) || secretPattern.test(clean) || providerConfigurationPattern.test(clean) || urlPattern.test(clean)) {
    throw new Error('INVALID_COMPANY_VOICE_SETTINGS');
  }
  if ((field === 'publicLocationLanguage' || field === 'voiceGuidance') && hasContactDetails(clean)) {
    throw new Error('INVALID_COMPANY_VOICE_SETTINGS');
  }
  return clean;
}

function safeCta(value, field) {
  const clean = safeText(value, 160, field);
  if (hasContactDetails(clean)) throw new Error('INVALID_COMPANY_VOICE_SETTINGS');
  return clean;
}

function hasContactDetails(value) {
  return emailPattern.test(value) || phonePattern.test(value) || streetAddressPattern.test(value);
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
