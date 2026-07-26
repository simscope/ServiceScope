import { readFile } from 'node:fs/promises';

const assert = {
  match(value, pattern, message = `Expected value to match ${pattern}`) {
    if (!pattern.test(value)) throw new Error(message);
  },
  doesNotMatch(value, pattern, message = `Expected value not to match ${pattern}`) {
    if (pattern.test(value)) throw new Error(message);
  },
};

const [jobDetailPanel, jobActions, jobsStore] = await Promise.all([
  readFile('src/components/JobDetailPanel.tsx', 'utf8'),
  readFile('src/features/jobs/jobActions.ts', 'utf8'),
  readFile('src/services/jobsStore.ts', 'utf8'),
]);
const saveDraftBody = jobDetailPanel.match(/async function saveDraft\(\) \{[\s\S]*?\n  \}/)?.[0] ?? '';

assert.match(jobDetailPanel, /onSave: \(job: JobCardData\) => void \| Promise<JobCardData \| void>/);
assert.match(jobDetailPanel, /async function saveDraft\(\)/);
assert.match(jobDetailPanel, /const savedJob = await Promise\.resolve\(onSave\(nextJob\)\)/);
assert.match(jobDetailPanel, /setSaved\(true\)/);
assert.match(jobDetailPanel, /catch \(error\)[^]*setSaveError/);
assert.match(jobDetailPanel, /serviceCallFee: normalizeMoneyDraft\(draft\.serviceCallFee\)/);
assert.match(jobDetailPanel, /labor: normalizeMoneyDraft\(draft\.labor\)/);
assert.match(jobDetailPanel, /value\.replace\(\/\[\$,\\s\]\/g, ''\)/);
assert.match(jobDetailPanel, /disabled=\{savingJob\}/);
assert.match(jobDetailPanel, /saveError \|\| \(saved \? 'Saved'/);
assert.doesNotMatch(saveDraftBody, /onSave\(nextJob\);\s*setDraft\(nextJob\);\s*setSaved\(true\);/);

assert.match(jobActions, /async function handleSaveJob/);
assert.match(jobActions, /const savedJob = await saveServiceJob\(companyId, updatedJob\)/);
assert.match(jobActions, /return savedJob/);
assert.match(jobActions, /catch \(error\)[^]*throw error/s);

assert.match(jobsStore, /service_call_fee_cents: dollarsToCents\(job\.serviceCallFee\)/);
assert.match(jobsStore, /labor_cents: dollarsToCents\(job\.labor\)/);

console.log('job financial save regression checks passed');
