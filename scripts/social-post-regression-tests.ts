import { formatSocialPostForCopy, generateSocialPostDraft, scrubPrivateJobValues, type SocialPostJobInput } from '../src/utils/socialPost.js';

function fail(message: string): never {
  throw new Error(message);
}

const assert = {
  equal(actual: unknown, expected: unknown, message = `Expected ${String(actual)} to equal ${String(expected)}`) {
    if (actual !== expected) fail(message);
  },
  match(actual: string, pattern: RegExp) {
    if (!pattern.test(actual)) fail(`Expected "${actual}" to match ${String(pattern)}`);
  },
  doesNotMatch(actual: string, pattern: RegExp) {
    if (pattern.test(actual)) fail(`Expected "${actual}" not to match ${String(pattern)}`);
  },
  ok(value: unknown, message = 'Expected value to be truthy') {
    if (!value) fail(message);
  },
  deepEqual(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('Expected values to be deeply equal');
  },
};

const completedHvacJob: SocialPostJobInput = {
  system: 'Rooftop HVAC',
  issue: 'weak cooling in dining area',
  notes: 'Filters checked and unit operation reviewed',
  attachments: [
    { kind: 'photo' },
    { kind: 'photo' },
    { kind: 'file' },
  ],
  clientName: 'Jane Customer',
  organization: 'Sample Bistro',
  phone: '555-0100',
  email: 'jane@example.com',
  address: '123 Market Street',
  jobNumber: 'JOB-67',
};

function assertNoPrivateValues(text: string, job: SocialPostJobInput) {
  [
    job.clientName,
    job.organization,
    job.phone,
    job.email,
    job.address,
    job.jobNumber,
  ].filter(Boolean).forEach((value) => {
    assert.equal(text.toLowerCase().includes(String(value).toLowerCase()), false, `${value} should be excluded`);
  });
}

{
  const draft = generateSocialPostDraft(completedHvacJob);
  assert.match(draft.headline, /Rooftop HVAC service/i);
  assert.match(draft.caption, /weak cooling in dining area/i);
  assert.match(draft.caption, /2 job photos attached/i);
  assert.ok(draft.hashtags.length >= 5 && draft.hashtags.length <= 10);
}

{
  const draft = generateSocialPostDraft({ system: 'HVAC', attachments: [{ kind: 'photo' }] });
  assert.match(draft.headline, /HVAC service visit/i);
  assert.match(draft.caption, /completed a hvac service visit/i);
  assert.doesNotMatch(draft.caption, /Job notes:/);
}

{
  const draft = generateSocialPostDraft({ system: 'Walk-in cooler', issue: 'temperature concern', attachments: [] });
  assert.doesNotMatch(draft.caption, /job photos attached/i);
}

{
  const unsafeDraft = {
    ...generateSocialPostDraft(completedHvacJob),
    caption: `Completed for Jane Customer at Sample Bistro, 123 Market Street. Call 555-0100 or jane@example.com. Job JOB-67.`,
  };
  assertNoPrivateValues(formatSocialPostForCopy(unsafeDraft, completedHvacJob), completedHvacJob);
  assertNoPrivateValues(scrubPrivateJobValues(unsafeDraft.caption, completedHvacJob), completedHvacJob);
}

{
  const draft = generateSocialPostDraft({ system: 'HVAC', issue: 'unit not cooling', notes: '' });
  assert.doesNotMatch(draft.caption, /\breplaced\b|\brepaired\b|\bfixed\b|\bcharged\b|\bleak\b|\bcompressor\b/i);
}

{
  const first = generateSocialPostDraft(completedHvacJob);
  const second = generateSocialPostDraft(completedHvacJob);
  assert.deepEqual(second, first);
}

console.log('social post regression tests passed');
