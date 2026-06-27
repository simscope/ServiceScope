const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const filePath = path.join(root, 'src/CompanyPortal.tsx');
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, c) => fs.writeFileSync(p, c);

let content = read(filePath);

if (!content.includes("from './services/payrollStore'")) {
  content = content.replace(
    "import { deleteJobTypeFromBackend, saveOnboardingProfileToBackend } from './services/onboardingBackend';",
    "import { deleteJobTypeFromBackend, saveOnboardingProfileToBackend } from './services/onboardingBackend';\nimport { dollarsToCents, findTechnicianId, listCompanyPayrollItems, upsertCompanyPayrollItems, type PayrollItemInput, type PayrollItemRow } from './services/payrollStore';",
  );
}

content = content.replace(
  "  const [salaryPaidJobs, setSalaryPaidJobs] = useState<Record<string, string>>(() => readSalaryPaidJobs());",
  "  const [salaryPaidJobs, setSalaryPaidJobs] = useState<Record<string, string>>(() => readSalaryPaidJobs());\n  const [payrollItems, setPayrollItems] = useState<PayrollItemRow[]>([]);",
);

content = content.replace(
  `        const [savedJobs, savedMaterials] = await Promise.all([
          listCompanyJobs(company.id),
          listCompanyJobMaterials(company.id),
        ]);`,
  `        const [savedJobs, savedMaterials, savedPayrollItems] = await Promise.all([
          listCompanyJobs(company.id),
          listCompanyJobMaterials(company.id),
          listCompanyPayrollItems(company.id).catch(() => [] as PayrollItemRow[]),
        ]);`,
);

content = content.replace(
  `        setJobs(savedJobs);
        setMaterials(savedMaterials);
        setJobsStatus('');`,
  `        setJobs(savedJobs);
        setMaterials(savedMaterials);
        setPayrollItems(savedPayrollItems);
        setSalaryPaidJobs(Object.fromEntries(savedPayrollItems.filter((item) => item.paidAt).map((item) => {
          const job = savedJobs.find((candidate) => candidate.id === item.jobId);
          return [job?.jobNumber ?? item.jobId, item.paidAt.slice(0, 10)];
        })));
        setJobsStatus('');`,
);

content = content.replace(
  `        setJobs([]);
        setMaterials([]);
        setJobsStatus(error instanceof Error ? error.message : 'Jobs could not be loaded.');`,
  `        setJobs([]);
        setMaterials([]);
        setPayrollItems([]);
        setJobsStatus(error instanceof Error ? error.message : 'Jobs could not be loaded.');`,
);

if (!content.includes('const payrollItemByJobId = new Map')) {
  content = content.replace(
    "  const financeRows = allJobsRows.map((job) => {",
    "  const payrollItemByJobId = new Map(payrollItems.map((item) => [item.jobId, item]));\n  const makePayrollItemInput = (job: ServiceJob & { paidScf: number; paidLabor: number; materialsCost: number; salaryBase: number; salary: number; warnings: string[]; payrollArchived?: boolean }, paidAt?: string | null): PayrollItemInput | null => {\n    const technicianId = findTechnicianId(profile, job.assignee);\n    if (!job.id || !technicianId) return null;\n\n    return {\n      jobId: job.id,\n      technicianId,\n      collectedCents: dollarsToCents(job.paidScf + job.paidLabor),\n      materialsCents: dollarsToCents(job.materialsCost),\n      payrollBaseCents: dollarsToCents(job.salaryBase),\n      salaryCents: dollarsToCents(job.salary),\n      reviewNote: job.warnings.join(' - '),\n      selectedForPayment: false,\n      paidAt: paidAt ?? payrollItemByJobId.get(job.id)?.paidAt ?? null,\n      archivedAt: job.payrollArchived ? new Date().toISOString() : null,\n    };\n  };\n  const financeRows = allJobsRows.map((job) => {",
  );
}

content = content.replace(
  "    const paidAt = salaryPaidJobs[job.jobNumber] ?? '';",
  "    const paidAt = payrollItemByJobId.get(job.id)?.paidAt?.slice(0, 10) ?? salaryPaidJobs[job.jobNumber] ?? '';",
);

const oldToggle = `  const toggleSalaryPaid = (jobNumber: string) => {
    setSalaryPaidJobs((jobs) => {
      if (jobs[jobNumber]) {
        const nextJobs = { ...jobs };
        delete nextJobs[jobNumber];
        return nextJobs;
      }

      return { ...jobs, [jobNumber]: new Date().toISOString().slice(0, 10) };
    });
  };
  const markSalaryJobsPaid = (jobNumbers: string[]) => {
    if (!jobNumbers.length) return;
    const paidAt = new Date().toISOString().slice(0, 10);
    setSalaryPaidJobs((jobs) => ({
      ...jobs,
      ...Object.fromEntries(jobNumbers.map((jobNumber) => [jobNumber, paidAt])),
    }));
  };`;
const newToggle = `  const savePayrollItemsToBackend = (rows: PayrollItemInput[]) => {
    if (!selectedCompanyId || !rows.length) return;

    upsertCompanyPayrollItems(selectedCompanyId, rows)
      .then((savedRows) => {
        if (!savedRows.length) return;
        setPayrollItems((currentRows) => {
          const rowMap = new Map(currentRows.map((row) => [row.jobId, row]));
          savedRows.forEach((row) => rowMap.set(row.jobId, row));
          return Array.from(rowMap.values());
        });
      })
      .catch((error) => {
        setJobsStatus(error instanceof Error ? error.message : 'Payroll could not be saved.');
      });
  };
  const toggleSalaryPaid = (jobNumber: string) => {
    const financeJob = financeRows.find((job) => job.jobNumber === jobNumber);
    const nextPaidAt = salaryPaidJobs[jobNumber] || payrollItemByJobId.get(financeJob?.id ?? '')?.paidAt ? null : new Date().toISOString();
    const payrollInput = financeJob ? makePayrollItemInput(financeJob, nextPaidAt) : null;

    setSalaryPaidJobs((jobs) => {
      if (nextPaidAt === null) {
        const nextJobs = { ...jobs };
        delete nextJobs[jobNumber];
        return nextJobs;
      }

      return { ...jobs, [jobNumber]: nextPaidAt.slice(0, 10) };
    });

    if (payrollInput) savePayrollItemsToBackend([payrollInput]);
  };
  const markSalaryJobsPaid = (jobNumbers: string[]) => {
    if (!jobNumbers.length) return;
    const paidAt = new Date().toISOString();
    const payrollInputs = jobNumbers
      .map((jobNumber) => financeRows.find((job) => job.jobNumber === jobNumber))
      .map((job) => (job ? makePayrollItemInput(job, paidAt) : null))
      .filter((row): row is PayrollItemInput => Boolean(row));

    setSalaryPaidJobs((jobs) => ({
      ...jobs,
      ...Object.fromEntries(jobNumbers.map((jobNumber) => [jobNumber, paidAt.slice(0, 10)])),
    }));
    savePayrollItemsToBackend(payrollInputs);
  };`;
if (content.includes(oldToggle)) {
  content = content.replace(oldToggle, newToggle);
}

write(filePath, content);
console.log('Payroll backend tables patch applied.');
