const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { finalStateMarkers, patchPayrollPaymentHistory } = require('./patch-payroll-payment-history.cjs');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src/components/portal/EmployeeFinancePage.tsx');
const scriptPath = path.join(root, 'scripts/patch-payroll-payment-history.cjs');
const currentFixture = readCleanEmployeeFinanceFixture().replace(/\r\n/g, '\n');

assertPatchedFixture('LF fixture', currentFixture, '\n');
assertPatchedFixture('CRLF fixture', currentFixture.replace(/\n/g, '\r\n'), '\r\n');

const firstPatch = patchPayrollPaymentHistory(currentFixture);
assertFinalMarkers(firstPatch.source);
const secondPatch = patchPayrollPaymentHistory(firstPatch.source);
assert.equal(secondPatch.changed, false);
assert.equal(secondPatch.source, firstPatch.source);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payroll-patch-'));
try {
  const target = path.join(tmpDir, 'EmployeeFinancePage.tsx');
  fs.writeFileSync(target, currentFixture.replace(/\n/g, '\r\n'));
  const firstRun = runPatchTarget(target);
  assert.equal(firstRun.status, 0, firstRun.stderr);
  assert.match(firstRun.stdout, /applied/);
  const once = fs.readFileSync(target, 'utf8');
  assertFinalMarkers(once);
  assert.ok(once.includes('\r\n'), 'CRLF fixture should remain CRLF after patch');

  const secondRun = runPatchTarget(target);
  assert.equal(secondRun.status, 0, secondRun.stderr);
  assert.match(secondRun.stdout, /already applied/);
  assert.equal(fs.readFileSync(target, 'utf8'), once);

  const brokenTarget = path.join(tmpDir, 'BrokenEmployeeFinancePage.tsx');
  fs.writeFileSync(brokenTarget, currentFixture.replace('const unpaidJobs = selectedSummary.jobs.filter((job) => !job.paid);', 'const unpaidJobs = [];'));
  const brokenRun = runPatchTarget(brokenTarget);
  assert.notEqual(brokenRun.status, 0, 'broken fixture should fail');
  assert.match(`${brokenRun.stderr}\n${brokenRun.stdout}`, /selected employee totals block/);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('payroll payment history patch regression checks passed');

function assertPatchedFixture(label, fixture, expectedEol) {
  const result = patchPayrollPaymentHistory(fixture);
  assertFinalMarkers(result.source);
  const secondResult = patchPayrollPaymentHistory(result.source);
  assert.equal(secondResult.changed, false, `${label} should be idempotent after patch`);
  assert.equal(secondResult.source, result.source, `${label} should not change once final markers are present`);
  if (expectedEol === '\r\n') assert.ok(result.source.includes('\r\n'), `${label} should preserve CRLF`);
}

function assertFinalMarkers(source) {
  for (const marker of finalStateMarkers) {
    assert.ok(source.includes(marker), `Expected patched source to include marker: ${marker}`);
  }
}

function runPatchTarget(target) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    env: { ...process.env, PAYROLL_PATCH_TARGET: target },
    encoding: 'utf8',
  });
}

function readCleanEmployeeFinanceFixture() {
  const fromGit = spawnSync('git', ['-c', `safe.directory=${root}`, 'show', 'HEAD:src/components/portal/EmployeeFinancePage.tsx'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (fromGit.status === 0 && fromGit.stdout) return fromGit.stdout;
  return fs.readFileSync(sourcePath, 'utf8');
}
