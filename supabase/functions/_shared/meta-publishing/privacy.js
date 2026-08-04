import { assertNoPrivateValues } from '../content-engine/privacy.js';
import { MetaPublishingError } from './contracts.js';

const GENERIC_PRIVATE_PATTERNS = Object.freeze([
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/,
  /\b\d{1,6}\s+[A-Za-z0-9.' -]{2,60}\s(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd|court|ct|way)\b/i,
  /\b(?:access|door|gate|lockbox)\s+(?:code|pin)\s*[:#-]?\s*[A-Za-z0-9-]{3,20}\b/i,
  /\b(?:invoice|inv)\s*(?:number|no\.?|#)\s*[:#-]?\s*[A-Za-z0-9-]{2,30}\b/i,
  /\[private\]/i,
  /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/,
]);

export function assertPublicationPrivacy(message, privateValues) {
  try {
    assertNoPrivateValues(message, privateValues);
  } catch {
    throw new MetaPublishingError('META_PUBLICATION_PRIVACY_REVIEW_REQUIRED');
  }
  if (GENERIC_PRIVATE_PATTERNS.some((pattern) => pattern.test(message))) {
    throw new MetaPublishingError('META_PUBLICATION_PRIVACY_REVIEW_REQUIRED');
  }
}
