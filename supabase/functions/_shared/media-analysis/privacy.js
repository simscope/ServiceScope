import { MediaAnalysisError } from './errors.js';
import { buildMeaningfulKnownPrivateValues, normalizePrivateValue } from '../privacy/privateValues.js';

const allowedSubreasons = new Set([
  'KNOWN_PRIVATE_VALUE_MATCH',
  'EMAIL_PATTERN',
  'PHONE_PATTERN',
  'ADDRESS_PATTERN',
  'LONG_DIGIT_SEQUENCE',
  'OCR_LIKE_TRANSCRIPTION',
  'FORBIDDEN_DIAGNOSTIC_CLAIM',
  'FORBIDDEN_CONFIRMED_IDENTITY',
  'UNKNOWN_PRIVACY_REASON',
]);

export function buildKnownPrivateValues(values) {
  return buildMeaningfulKnownPrivateValues(values);
}

export function assertNoPrivateValues(value, privateValues, options = {}) {
  const diagnostics = collectPrivacyDiagnostics(value, privateValues, options);
  if (diagnostics.length) throw privacyError(diagnostics);
}

export function assertSafeFindingText(value, privateValues, options = {}) {
  assertNoPrivateValues(String(value ?? ''), privateValues, options);
}

export function collectPrivacyDiagnostics(value, privateValues = [], options = {}) {
  const strings = collectStrings(value, options.path ?? '$');
  const privateMatchers = buildKnownPrivateValues(privateValues).map((privateValue) => ({
    raw: privateValue,
    normalized: normalizePrivateValue(privateValue),
  }));
  const diagnostics = [];
  for (const item of strings) {
    diagnostics.push(...detectUnsafeText(item, privateMatchers, options));
  }
  return diagnostics.map(sanitizePrivacyDiagnostic).filter(Boolean);
}

export function assertNoUnsafeClientMediaInput(request) {
  const text = JSON.stringify(request);
  if (/https?:\/\/|data:|base64|signedUrl|storagePath|storageBucket|providerPrompt|prompt/i.test(text)) {
    throw new Error('INVALID_REQUEST');
  }
}

export function sanitizePrivacyDiagnostic(diagnostic) {
  const subreason = allowedSubreasons.has(diagnostic?.subreason) ? diagnostic.subreason : 'UNKNOWN_PRIVACY_REASON';
  return {
    subreason,
    path: typeof diagnostic?.path === 'string' ? diagnostic.path : '$',
    detector: typeof diagnostic?.detector === 'string' ? diagnostic.detector : 'unknown',
    patternClass: typeof diagnostic?.patternClass === 'string' ? diagnostic.patternClass : subreason,
    stringLengthBucket: bucketStringLength(diagnostic?.stringLength),
    attachmentId: typeof diagnostic?.attachmentId === 'string' ? diagnostic.attachmentId : undefined,
    findingCategory: typeof diagnostic?.findingCategory === 'string' ? diagnostic.findingCategory : undefined,
  };
}

function detectUnsafeText(item, privateMatchers, options) {
  const text = item.text;
  const normalizedText = normalizePrivateValue(text);
  const base = {
    path: item.path,
    stringLength: text.length,
    attachmentId: options.attachmentId,
    findingCategory: options.findingCategory,
  };
  const diagnostics = [
    ...matchPattern(text, likelyEmailPattern, { ...base, subreason: 'EMAIL_PATTERN', detector: 'email-pattern', patternClass: 'email' }),
    ...matchPattern(text, likelyAddressPattern, { ...base, subreason: 'ADDRESS_PATTERN', detector: 'address-pattern', patternClass: 'street-address' }),
    ...matchPattern(text, likelyOcrTranscriptionPattern, { ...base, subreason: 'OCR_LIKE_TRANSCRIPTION', detector: 'ocr-transcription', patternClass: 'ocr-like-text' }),
    ...matchPattern(text, forbiddenDiagnosticClaimPattern, { ...base, subreason: 'FORBIDDEN_DIAGNOSTIC_CLAIM', detector: 'diagnostic-claim', patternClass: 'diagnosis-or-repair-success' }),
    ...matchPattern(text, forbiddenConfirmedIdentityPattern, { ...base, subreason: 'FORBIDDEN_CONFIRMED_IDENTITY', detector: 'confirmed-identity', patternClass: 'confirmed-brand-model-serial' }),
    ...matchPattern(text, likelyLongDigitPattern, { ...base, subreason: 'LONG_DIGIT_SEQUENCE', detector: 'long-digit-sequence', patternClass: 'serial-or-barcode-digits' }),
    ...matchPattern(text, likelyPhonePattern, { ...base, subreason: 'PHONE_PATTERN', detector: 'phone-pattern', patternClass: 'phone' }),
  ];
  for (const matcher of privateMatchers) {
    if (matcher.normalized && normalizedText.includes(matcher.normalized)) {
      diagnostics.push({ ...base, subreason: 'KNOWN_PRIVATE_VALUE_MATCH', detector: 'known-private-value', patternClass: 'known-private-value' });
      break;
    }
  }
  return diagnostics;
}

function matchPattern(text, pattern, diagnostic) {
  return pattern.test(text) ? [diagnostic] : [];
}

function collectStrings(value, path) {
  if (typeof value === 'string') return [{ path, text: value }];
  if (value == null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => collectStrings(item, `${path}[${index}]`));
  return Object.entries(value).flatMap(([key, item]) => collectStrings(item, `${path}.${key}`));
}

function bucketStringLength(length) {
  const value = Math.max(0, Number(length) || 0);
  if (value === 0) return '0';
  if (value <= 20) return '<=20';
  if (value <= 80) return '<=80';
  if (value <= 180) return '<=180';
  return '>180';
}

function privacyError(diagnostics) {
  return new MediaAnalysisError('MEDIA_PRIVACY_VALIDATION_FAILED', {
    retryable: false,
    details: { privacyDiagnostics: diagnostics.map(sanitizePrivacyDiagnostic) },
  });
}

const likelyEmailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const likelyPhonePattern = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/;
const likelyAddressPattern = /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|place|pl|way|trail|trl)\b/i;
const likelyLongDigitPattern = /\b(?:[A-Z]{1,6}[- ]?)?\d{6,}(?:[- ]?[A-Z0-9]{2,})?\b/i;
const likelyOcrTranscriptionPattern = /\b(?:text|label|screen|plate|sticker|document|barcode)\s+(?:reads|says|shows|states|lists)\b|(?:visible|detected|transcribed)\s+text\b/i;
const forbiddenDiagnosticClaimPattern = /\b(?:diagnosed|diagnosis|confirmed\s+(?:failure|fault|leak|problem)|repair\s+(?:successful|complete|completed)|successfully\s+repaired|fixed\s+the|resolved\s+the|verified\s+(?:operation|repair|result))\b/i;
const forbiddenConfirmedIdentityPattern = /\b(?:(?:serial|model|brand)(?:\s+number)?\s*(?:is|:)|confirmed\s+(?:serial|model|brand)|identified\s+as\s+(?:model|brand|serial))\b/i;
