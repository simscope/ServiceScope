import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, ['scripts/patch-payroll-payment-history.cjs'], { cwd: root, stdio: 'pipe' });

const page = readFileSync(path.join(root, 'src/components/portal/EmployeeFinancePage.tsx'), 'utf8');
const styles = readFileSync(path.join(root, 'src/styles/payroll-payment-history.css'), 'utf8');

assert.match(page, /selectedCommissionAmount = selectedCommissionJobs\.reduce/);
assert.match(page, /Pay selected \{money\(selectedCommissionAmount\)\}/);
assert.match(page, /Earned all time/);
assert.match(page, /Paid all time/);
assert.match(page, /Unpaid all time/);
assert.match(page, /commissionPaymentGroups = new Map<string, PayrollItemRow\[]>/);
assert.match(page, /<h2>Payment history<\/h2>/);
assert.match(page, /new Date\(payment\.paidAt\)\.toLocaleString\('en-US'\)/);
assert.match(styles, /\.employee-finance-lifetime/);
assert.match(styles, /\.payroll-batch-selection/);
assert.match(styles, /\.payment-history-table/);

console.log('Payroll payment totals/history regression checks passed.');
