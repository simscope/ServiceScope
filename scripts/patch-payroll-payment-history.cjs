const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const filePath = path.join(root, 'src/components/portal/EmployeeFinancePage.tsx');
let source = fs.readFileSync(filePath, 'utf8');

if (source.includes('const selectedCommissionAmount = selectedCommissionJobs')) {
  console.log('Payroll payment totals/history patch already applied.');
  process.exit(0);
}

function replaceRequired(from, to, label) {
  if (!source.includes(from)) {
    throw new Error(`Payroll payment history patch could not find: ${label}`);
  }
  source = source.replace(from, to);
}

replaceRequired(
`  if (selectedSummary && settingDraft) {
    const unpaidJobs = selectedSummary.jobs.filter((job) => !job.paid);
    const paidJobs = selectedSummary.jobs.filter((job) => job.paid);
    const allUnpaidSelected = unpaidJobs.length > 0 && unpaidJobs.every((job) => selectedCommissionJobs.includes(job.jobNumber));`,
`  if (selectedSummary && settingDraft) {
    const unpaidJobs = selectedSummary.jobs.filter((job) => !job.paid);
    const paidJobs = selectedSummary.jobs.filter((job) => job.paid);
    const allUnpaidSelected = unpaidJobs.length > 0 && unpaidJobs.every((job) => selectedCommissionJobs.includes(job.jobNumber));
    const selectedCommissionAmount = selectedCommissionJobs.reduce((sum, jobNumber) => {
      const job = unpaidJobs.find((candidate) => candidate.jobNumber === jobNumber);
      return sum + (job?.payrollAmount ?? 0);
    }, 0);
    const allTimeCommissionJobs = jobs
      .filter((job) => job.assignee === selectedSummary.employee.name)
      .map((job) => commissionJob(job, selectedSummary.employee, selectedSummary.setting, materials, payrollItems));
    const employeePayrollItems = payrollItems.filter((item) => item.technicianId === selectedSummary.employee.id);
    const paidEmployeeItems = employeePayrollItems.filter((item) => Boolean(item.paidAt));
    const employeePeriodRowsAllTime = periodRows.filter((row) => row.technicianId === selectedSummary.employee.id);
    const commissionEarnedAllTime = allTimeCommissionJobs.reduce((sum, job) => sum + job.payrollAmount, 0);
    const commissionPaidAllTime = paidEmployeeItems.reduce((sum, item) => sum + item.salaryCents / 100, 0);
    const periodEarnedAllTime = employeePeriodRowsAllTime.reduce((sum, row) => sum + row.grossAmount, 0);
    const periodPaidAllTime = employeePeriodRowsAllTime.reduce((sum, row) => sum + (row.paidAt ? row.grossAmount : 0), 0);
    const lifetimeEarned = settingDraft.payType === 'commission'
      ? commissionEarnedAllTime
      : settingDraft.payType === 'none' ? 0 : periodEarnedAllTime;
    const lifetimePaid = settingDraft.payType === 'commission'
      ? commissionPaidAllTime
      : settingDraft.payType === 'none' ? 0 : periodPaidAllTime;
    const lifetimeUnpaid = Math.max(0, lifetimeEarned - lifetimePaid);
    const jobNumberById = new Map(jobs.map((job) => [job.id, job.jobNumber]));
    const commissionPaymentGroups = new Map<string, PayrollItemRow[]>();
    paidEmployeeItems.forEach((item) => {
      const group = commissionPaymentGroups.get(item.paidAt) ?? [];
      group.push(item);
      commissionPaymentGroups.set(item.paidAt, group);
    });
    const paymentHistory = settingDraft.payType === 'commission'
      ? Array.from(commissionPaymentGroups.entries()).map(([paidAt, items]) => ({
        key: paidAt,
        paidAt,
        amount: items.reduce((sum, item) => sum + item.salaryCents / 100, 0),
        count: items.length,
        details: items
          .map((item) => jobNumberById.get(item.jobId))
          .filter((value): value is string => Boolean(value))
          .map((jobNumber) => \`#\${jobNumber}\`)
          .join(', '),
      }))
      : employeePeriodRowsAllTime.filter((row) => Boolean(row.paidAt)).map((row) => ({
        key: row.id,
        paidAt: row.paidAt,
        amount: row.grossAmount,
        count: 1,
        details: \`\${row.periodStart} - \${row.periodEnd}\`,
      }));
    paymentHistory.sort((left, right) => new Date(right.paidAt).getTime() - new Date(left.paidAt).getTime());
    const lastPaymentAt = paymentHistory[0]?.paidAt ?? '';`,
  'selected employee totals block',
);

replaceRequired(
`            <button className="secondary-button compact" type="button" onClick={() => setSelectedEmployeeId('')}>Back to finance</button>
          </div>

          <section className="employee-pay-plan-panel">`,
`            <button className="secondary-button compact" type="button" onClick={() => setSelectedEmployeeId('')}>Back to finance</button>
          </div>

          <div className="employee-finance-lifetime">
            <span><small>Earned all time</small><strong>{money(lifetimeEarned)}</strong></span>
            <span><small>Paid all time</small><strong>{money(lifetimePaid)}</strong></span>
            <span><small>Unpaid all time</small><strong>{money(lifetimeUnpaid)}</strong></span>
            <span><small>Last payment</small><strong className="payment-date-value">{lastPaymentAt ? new Date(lastPaymentAt).toLocaleString('en-US') : '—'}</strong></span>
          </div>

          <section className="employee-pay-plan-panel">`,
  'lifetime payroll metrics',
);

replaceRequired(
`              <div className="payroll-batch-actions">
                <span><strong>{selectedCommissionJobs.length}</strong> selected</span>
                <button className="primary-button compact" type="button" disabled={!selectedCommissionJobs.length} onClick={() => setCommissionJobsPaid(selectedSummary, selectedCommissionJobs, true)}>Confirm selected paid</button>
              </div>`,
`              <div className="payroll-batch-actions">
                <div className="payroll-batch-selection">
                  <span><strong>{selectedCommissionJobs.length}</strong> jobs selected</span>
                  <span><strong>{money(selectedCommissionAmount)}</strong> payment amount</span>
                </div>
                <button className="primary-button compact" type="button" disabled={!selectedCommissionJobs.length} onClick={() => setCommissionJobsPaid(selectedSummary, selectedCommissionJobs, true)}>Pay selected {money(selectedCommissionAmount)}</button>
              </div>`,
  'selected commission amount',
);

replaceRequired(
`              <details className="employee-finance-section collapsed-payroll"><summary><span>Paid commission</span><strong>{paidJobs.length} jobs</strong></summary><div className="employee-finance-table-wrap"><table className="employee-finance-table"><thead><tr><th>Job</th><th>Client</th><th>Payroll</th><th>Paid</th><th>Action</th></tr></thead><tbody>{paidJobs.map((job) => <tr key={job.id}><td><button className="job-number-link" type="button" onClick={() => onOpenJob(job)}>#{job.jobNumber}</button></td><td>{job.organization}</td><td>{money(job.payrollAmount)}</td><td>{job.paidAt}</td><td><button className="secondary-button compact" type="button" onClick={() => setCommissionJobsPaid(selectedSummary, [job.jobNumber], false)}>Return unpaid</button></td></tr>)}</tbody></table></div></details>`,
`              <details className="employee-finance-section collapsed-payroll"><summary><span>Paid commission</span><strong>{paidJobs.length} jobs</strong></summary><div className="employee-finance-table-wrap"><table className="employee-finance-table"><thead><tr><th>Job</th><th>Client</th><th>Payroll</th><th>Paid</th><th>Action</th></tr></thead><tbody>{paidJobs.map((job) => <tr key={job.id}><td><button className="job-number-link" type="button" onClick={() => onOpenJob(job)}>#{job.jobNumber}</button></td><td>{job.organization}</td><td>{money(job.payrollAmount)}</td><td>{job.paidAt ? new Date(job.paidAt).toLocaleString('en-US') : ''}</td><td><button className="secondary-button compact" type="button" onClick={() => setCommissionJobsPaid(selectedSummary, [job.jobNumber], false)}>Return unpaid</button></td></tr>)}</tbody></table></div></details>
              <section className="employee-finance-section">
                <div className="employee-finance-section-heading"><h2>Payment history</h2><span>{paymentHistory.length} payments</span></div>
                <div className="employee-finance-table-wrap">
                  <table className="employee-finance-table payment-history-table">
                    <thead><tr><th>Paid</th><th>Amount</th><th>Jobs</th><th>Included jobs</th></tr></thead>
                    <tbody>
                      {paymentHistory.map((payment) => <tr key={payment.key}><td>{new Date(payment.paidAt).toLocaleString('en-US')}</td><td><strong>{money(payment.amount)}</strong></td><td>{payment.count}</td><td className="payment-history-details">{payment.details || '—'}</td></tr>)}
                      {!paymentHistory.length ? <tr><td colSpan={4}><div className="empty-inline">No recorded payments yet.</div></td></tr> : null}
                    </tbody>
                  </table>
                </div>
              </section>`,
  'commission payment history',
);

source = source.replace(
  "{row.paidAt ? `Paid ${row.paidAt.slice(0, 10)}` : 'Unpaid'}",
  "{row.paidAt ? `Paid ${new Date(row.paidAt).toLocaleString('en-US')}` : 'Unpaid'}",
);
source = source.replace(
  "{periodDraft.paidAt ? `Paid ${periodDraft.paidAt.slice(0, 10)}` : 'Not paid'}",
  "{periodDraft.paidAt ? `Paid ${new Date(periodDraft.paidAt).toLocaleString('en-US')}` : 'Not paid'}",
);

fs.writeFileSync(filePath, source);
console.log('Payroll payment totals/history patch applied.');
