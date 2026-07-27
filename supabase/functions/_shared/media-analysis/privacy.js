export function assertNoPrivateValues(value, privateValues) {
  const text = JSON.stringify(value);
  for (const privateValue of privateValues) {
    const clean = String(privateValue ?? '').trim();
    if (clean.length > 1 && new RegExp(escapeRegExp(clean), 'i').test(text)) {
      throw new Error('MEDIA_PRIVACY_VALIDATION_FAILED');
    }
  }
}

export function assertSafeFindingText(value, privateValues) {
  assertNoPrivateValues(value, privateValues);
  const text = String(value ?? '');
  if (likelyEmailPattern.test(text)) throw new Error('MEDIA_PRIVACY_VALIDATION_FAILED');
  if (likelyPhonePattern.test(text)) throw new Error('MEDIA_PRIVACY_VALIDATION_FAILED');
  if (likelyAddressPattern.test(text)) throw new Error('MEDIA_PRIVACY_VALIDATION_FAILED');
  if (likelySerialPattern.test(text)) throw new Error('MEDIA_PRIVACY_VALIDATION_FAILED');
}

export function assertNoUnsafeClientMediaInput(request) {
  const text = JSON.stringify(request);
  if (/https?:\/\/|data:|base64|signedUrl|storagePath|storageBucket|providerPrompt|prompt/i.test(text)) {
    throw new Error('INVALID_REQUEST');
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const likelyEmailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const likelyPhonePattern = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/;
const likelyAddressPattern = /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|place|pl|way|trail|trl)\b/i;
const likelySerialPattern = /\b[A-Z0-9-]*\d[A-Z0-9-]*\d[A-Z0-9-]*\d[A-Z0-9-]*\d[A-Z0-9-]*\d[A-Z0-9-]*\b/i;
