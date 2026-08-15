import { containsNormalizedPrivatePhrase, isMeaningfulKnownPrivateValue, normalizePrivateValue } from '../privacy/privateValues.js';

export function scrubText(text, privateValues) {
  return privateValues.reduce((current, value) => {
    const clean = String(value ?? '').trim();
    return clean.length > 1 ? current.replace(new RegExp(escapeRegExp(clean), 'gi'), '[private]') : current;
  }, String(text ?? ''));
}

export function assertNoPrivateValues(value, privateValues) {
  if (!Array.isArray(privateValues)) throw new Error('PRIVACY_FAILED');
  for (const text of collectStrings(value)) {
    if (structuredPrivatePatterns.some((pattern) => pattern.test(text))) throw new Error('PRIVACY_FAILED');
    for (const entry of privateValues ?? []) {
      if (matchesPrivateEntry(text, entry)) throw new Error('PRIVACY_FAILED');
    }
  }
}

export function safeTelemetryPayload(event) {
  const {
    correlationId,
    provider,
    model,
    channel,
    promptVersion,
    success,
    code,
    latencyMs,
    attempts,
    httpStatus,
    providerRequestId,
    providerErrorType,
    providerErrorCode,
    providerOutputSubreason,
    missingFields,
    unexpectedFields,
    invalidTypePaths,
    parsedJsonBytes,
    responseStatus,
    incompleteReason,
  } = event;
  return {
    correlationId,
    provider,
    model,
    channel,
    promptVersion,
    success,
    code,
    latencyMs,
    attempts,
    httpStatus,
    providerRequestId,
    providerErrorType,
    providerErrorCode,
    providerOutputSubreason,
    missingFields,
    unexpectedFields,
    invalidTypePaths,
    parsedJsonBytes,
    responseStatus,
    incompleteReason,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesPrivateEntry(text, entry) {
  if (typeof entry !== 'object' || entry === null) {
    const clean = String(entry ?? '').trim();
    return clean.length > 1 && new RegExp(escapeRegExp(clean), 'i').test(text);
  }
  const clean = String(entry.value ?? '').trim();
  if (!clean) return false;
  switch (entry.classification) {
    case 'MONEY_NUMERIC':
    case 'ENUM_OR_STATUS':
      return false;
    case 'PERSON_OR_ORGANIZATION':
      return normalizePrivateValue(clean).length >= 3 && containsNormalizedPrivatePhrase(text, clean);
    case 'JOB_IDENTIFIER':
      return matchesIdentifier(text, clean, 'job');
    case 'INVOICE_IDENTIFIER':
      return matchesIdentifier(text, clean, 'invoice');
    case 'FREE_TEXT_NOTE':
    case 'FREE_TEXT_COMMENT':
      return isMeaningfulKnownPrivateValue(clean) && containsNormalizedPrivatePhrase(text, clean);
    case 'STRUCTURED_EMAIL':
    case 'STRUCTURED_PHONE':
    case 'STRUCTURED_ADDRESS':
      return containsNormalizedPrivatePhrase(text, clean);
    default:
      return false;
  }
}

function matchesIdentifier(text, identifier, kind) {
  const normalized = normalizePrivateValue(identifier);
  if (!normalized) return false;
  if (!/^\d+$/.test(normalized) || normalized.length >= 6) {
    return isMeaningfulKnownPrivateValue(identifier) && containsNormalizedPrivatePhrase(text, identifier);
  }
  const marker = kind === 'job' ? '(?:job|work order)' : '(?:invoice|inv)';
  return new RegExp(`\\b${marker}\\s*(?:#|number|no\\.?)?\\s*${escapeRegExp(normalized)}\\b`, 'i').test(text);
}

function collectStrings(value) {
  if (typeof value === 'string') return [value];
  if (value == null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  return Object.values(value).flatMap(collectStrings);
}

const structuredPrivatePatterns = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/,
  /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|place|pl|way|trail|trl)\b/i,
];
