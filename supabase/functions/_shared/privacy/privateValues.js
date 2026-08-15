const commonPrivateValueTokens = new Set([
  'a',
  'about',
  'air',
  'all',
  'and',
  'appliance',
  'closed',
  'completed',
  'connection',
  'equipment',
  'for',
  'in',
  'job',
  'open',
  'pipe',
  'pending',
  'repair',
  'service',
  'status',
  'system',
  'the',
  'to',
  'unpaid',
  'warranty',
  'with',
]);

export function buildMeaningfulKnownPrivateValues(values) {
  const seen = new Set();
  const cleaned = [];
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!isMeaningfulKnownPrivateValue(text)) continue;
    const normalized = normalizePrivateValue(text);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    cleaned.push(text);
  }
  return cleaned;
}

export function isMeaningfulKnownPrivateValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  const normalized = normalizePrivateValue(text);
  if (!normalized || commonPrivateValueTokens.has(normalized)) return false;
  if (normalized.length < 4) return false;
  if (/^\d+$/.test(normalized) && normalized.length < 6) return false;
  if (/^\d+(?:\.\d{1,2})?$/.test(normalized)) return false;
  return true;
}

export function normalizePrivateValue(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9@.]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function containsNormalizedPrivatePhrase(value, privateValue) {
  const text = normalizePrivateValue(value);
  const phrase = normalizePrivateValue(privateValue);
  if (!text || !phrase) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(phrase)}(?:$|[^a-z0-9])`, 'i').test(text);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
