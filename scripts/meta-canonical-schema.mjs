export const META_FOUNDATION_MARKERS = Object.freeze({
  begin: '-- META_SOCIAL_CONNECTION_SCHEMA_BEGIN',
  end: '-- META_SOCIAL_CONNECTION_SCHEMA_END',
  label: 'Meta foundation',
});

export const META_LIFECYCLE_MARKERS = Object.freeze({
  begin: '-- META_SOCIAL_LIFECYCLE_AUDIT_SCHEMA_BEGIN',
  end: '-- META_SOCIAL_LIFECYCLE_AUDIT_SCHEMA_END',
  label: 'Meta lifecycle audit',
});

const ALL_MARKERS = [
  META_FOUNDATION_MARKERS.begin,
  META_FOUNDATION_MARKERS.end,
  META_LIFECYCLE_MARKERS.begin,
  META_LIFECYCLE_MARKERS.end,
];

const PATCH_ARTIFACT_PATTERNS = [
  /^\+--/,
  /^- --/,
  /^--- a\//,
  /^\+\+\+ b\//,
  /^diff --git\b/,
  /^index [0-9a-f]+\.\.[0-9a-f]+(?:\s+\d+)?$/i,
  /^@@.*@@(?:\s.*)?$/,
  /^\+\s*(?:create|alter|grant|revoke|comment|insert|update|delete|do|begin)\b/i,
];

export function assertNoCanonicalPatchArtifacts(source) {
  const lines = splitLines(source);
  const artifactIndex = lines.findIndex((line) => PATCH_ARTIFACT_PATTERNS.some((pattern) => pattern.test(line)));
  if (artifactIndex !== -1) {
    fail(`patch artifact found on physical line ${artifactIndex + 1}`);
  }
}

export function extractExactMarkedBlock(source, markers) {
  const lines = splitLines(source);
  validateMarkerLines(lines);
  const beginIndex = uniqueMarkerIndex(lines, markers.begin, `${markers.label} BEGIN`);
  const endIndex = uniqueMarkerIndex(lines, markers.end, `${markers.label} END`);
  if (beginIndex >= endIndex) {
    fail(`${markers.label} BEGIN must precede END`);
  }
  return lines.slice(beginIndex, endIndex + 1).join('\n');
}

export function extractMetaCanonicalBlocks(source) {
  assertNoCanonicalPatchArtifacts(source);
  const lines = splitLines(source);
  validateMarkerLines(lines);

  const foundationBegin = uniqueMarkerIndex(lines, META_FOUNDATION_MARKERS.begin, 'Meta foundation BEGIN');
  const foundationEnd = uniqueMarkerIndex(lines, META_FOUNDATION_MARKERS.end, 'Meta foundation END');
  const lifecycleBegin = uniqueMarkerIndex(lines, META_LIFECYCLE_MARKERS.begin, 'Meta lifecycle audit BEGIN');
  const lifecycleEnd = uniqueMarkerIndex(lines, META_LIFECYCLE_MARKERS.end, 'Meta lifecycle audit END');

  if (!(foundationBegin < foundationEnd && foundationEnd < lifecycleBegin && lifecycleBegin < lifecycleEnd)) {
    fail('canonical Meta blocks must be ordered and non-overlapping');
  }

  const betweenBlocks = lines.slice(foundationEnd + 1, lifecycleBegin).join('\n');
  if (!containsOnlyWhitespaceAndComments(betweenBlocks)) {
    fail('only whitespace or comments may appear between canonical Meta blocks');
  }

  return {
    foundation: lines.slice(foundationBegin, foundationEnd + 1).join('\n'),
    lifecycle: lines.slice(lifecycleBegin, lifecycleEnd + 1).join('\n'),
  };
}

export function normalizeSqlForParity(value) {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n+$/g, '');
}

function splitLines(source) {
  return source.replace(/\r\n?/g, '\n').split('\n');
}

function validateMarkerLines(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const marker of ALL_MARKERS) {
      if (line.includes(marker) && line !== marker) {
        fail(`marker must occupy its exact physical line at ${index + 1}`);
      }
    }
  }
}

function uniqueMarkerIndex(lines, marker, label) {
  const indexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === marker) indexes.push(index);
  }
  if (indexes.length !== 1) {
    fail(`${label} marker count must be exactly one; received ${indexes.length}`);
  }
  return indexes[0];
}

function containsOnlyWhitespaceAndComments(value) {
  let index = 0;
  while (index < value.length) {
    if (/\s/.test(value[index])) {
      index += 1;
      continue;
    }
    if (value.startsWith('--', index)) {
      const newline = value.indexOf('\n', index + 2);
      index = newline === -1 ? value.length : newline + 1;
      continue;
    }
    if (value.startsWith('/*', index)) {
      const close = value.indexOf('*/', index + 2);
      if (close === -1) return false;
      index = close + 2;
      continue;
    }
    return false;
  }
  return true;
}

function fail(message) {
  const error = new Error(`CANONICAL_SCHEMA_MARKER_INVALID: ${message}`);
  error.code = 'CANONICAL_SCHEMA_MARKER_INVALID';
  throw error;
}
