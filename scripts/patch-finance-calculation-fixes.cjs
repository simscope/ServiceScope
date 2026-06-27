const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const portalFile = path.join(root, 'src/CompanyPortal.tsx');
const financeFile = path.join(root, 'src/components/portal/FinancePage.tsx');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content);
}

let portal = read(portalFile);

if (!portal.includes('SALARY_PAID_STORAGE_KEY')) {
  portal = portal.replace(
    "const CLIENT_PAGE_STORAGE_KEY = 'servicescope.portal.clientPage';",
    `const CLIENT_PAGE_STORAGE_KEY = 'servicescope.portal.clientPage';
const SALARY_PAID_STORAGE_KEY = 'servicescope.finance.salaryPaidJobs';`,
  );
}

if (!portal.includes('function parseMoneyValue')) {
  portal = portal.replace(
    `function readSavedClientPage(): ClientPage {
  const saved = window.localStorage.getItem(CLIENT_PAGE_STORAGE_KEY);
  return clientPageValues.includes(saved as ClientPage) ? saved as ClientPage : 'jobs';
}
`,
    `function readSavedClientPage(): ClientPage {
  const saved = window.localStorage.getItem(CLIENT_PAGE_STORAGE_KEY);
  return clientPageValues.includes(saved as ClientPage) ? saved as ClientPage : 'jobs';
}

function readSalaryPaidJobs(): Record<string, string> {
  const saved = window.localStorage.getItem(SALARY_PAID_STORAGE_KEY);
  if (!saved) return {};

  try {
    const parsed = JSON.parse(saved);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function parseMoneyValue(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function startOfCurrentWeekIso() {
  const today = new Date();
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(today.getDate() + mondayOffset);
  return monday;
}

function startOfCurrentMonthIso() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), 1);
}

function isJobInFinancePeriod(createdAt: string, period: FinancePeriod) {
  if (period === 'all') return true;
  const jobTime = new Date(createdAt).getTime();
  if (!Number.isFinite(jobTime)) return false;
  const startDate = period === 'this_week' ? startOfCurrentWeekIso() : startOfCurrentMonthIso();
  return jobTime >= startDate.getTime();
}
`,
  );
}

portal = portal.replace(
  "  const [salaryPaidJobs, setSalaryPaidJobs] = useState<Record<string, string>>({ '243': '2026-06-01' });",
  "  const [salaryPaidJobs, setSalaryPaidJobs] = useState<Record<string, string>>(() => readSalaryPaidJobs());",
);

if (!portal.includes('window.localStorage.setItem(SALARY_PAID_STORAGE_KEY')) {
  portal = portal.replace(
    "  const selectedCompanyId = selectedCompany?.id ?? '';\n",
    "  const selectedCompanyId = selectedCompany?.id ?? '';\n\n  useEffect(() => {\n    window.localStorage.setItem(SALARY_PAID_STORAGE_KEY, JSON.stringify(salaryPaidJobs));\n  }, [salaryPaidJobs]);\n",
  );
}

portal = portal.replace(
  "    const scf = Number(job.serviceCallFee || 0);\n    const labor = Number(job.labor || 0);",
  "    const scf = parseMoneyValue(job.serviceCallFee);\n    const labor = parseMoneyValue(job.labor);",
);

portal = portal.replace(
  `    const matchesPeriod =
      financePeriod === 'all' ||
      (financePeriod === 'this_week' ? job.createdAt >= '2026-06-07' : job.createdAt >= '2026-06-01');`,
  `    const matchesPeriod = isJobInFinancePeriod(job.createdAt, financePeriod);`,
);

write(portalFile, portal);

let finance = read(financeFile);
finance = finance.replace(
  `        <button className="secondary-button compact" type="button">
          Export payroll
        </button>`,
  `        <button className="secondary-button compact" type="button" onClick={() => window.print()}>
          Export payroll
        </button>`,
);
write(financeFile, finance);

console.log('Finance calculation fixes patch applied.');
