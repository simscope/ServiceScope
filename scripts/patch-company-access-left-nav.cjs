const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appTypesPath = path.join(root, 'src/appTypes.ts');
const accessStorePath = path.join(root, 'src/services/accessStore.ts');
const appPath = path.join(root, 'src/App.tsx');
const ownerPath = path.join(root, 'src/components/OwnerPages.tsx');

const read = (filePath) => fs.readFileSync(filePath, 'utf8');
const write = (filePath, content) => fs.writeFileSync(filePath, content);

let appTypes = read(appTypesPath);
appTypes = appTypes.replace(
  "export type AppPage = 'dashboard' | 'companies' | 'monitoring' | 'billing' | 'access' | 'audit' | 'support' | 'companyLogin' | 'portal';",
  "export type AppPage = 'dashboard' | 'companies' | 'monitoring' | 'billing' | 'companyAccess' | 'access' | 'audit' | 'support' | 'companyLogin' | 'portal';",
);
write(appTypesPath, appTypes);

let accessStore = read(accessStorePath);
if (!accessStore.includes("companyAccess: 'Company Access'")) {
  accessStore = accessStore.replace(
    "  billing: 'Billing',\n  access: 'Access',",
    "  billing: 'Billing',\n  companyAccess: 'Company Access',\n  access: 'Access',",
  );
}
accessStore = accessStore.replace(
  "owner: ['dashboard', 'companies', 'monitoring', 'billing', 'access', 'audit', 'support'],",
  "owner: ['dashboard', 'companies', 'monitoring', 'billing', 'companyAccess', 'access', 'audit', 'support'],",
);
accessStore = accessStore.replace(
  "admin: ['dashboard', 'companies', 'monitoring', 'billing', 'audit', 'support'],",
  "admin: ['dashboard', 'companies', 'monitoring', 'billing', 'companyAccess', 'audit', 'support'],",
);
accessStore = accessStore.replace(
  "owner: ['All owner pages', 'Billing', 'Access management', 'Audit log', 'Support', 'Tenant control'],",
  "owner: ['All owner pages', 'Company access control', 'Billing', 'Access management', 'Audit log', 'Support', 'Tenant control'],",
);
accessStore = accessStore.replace(
  "admin: ['Dashboard', 'Companies', 'Monitoring', 'Billing', 'Audit', 'Support'],",
  "admin: ['Dashboard', 'Companies', 'Monitoring', 'Billing', 'Company access control', 'Audit', 'Support'],",
);
write(accessStorePath, accessStore);

let owner = read(ownerPath);
const companySectionStart = owner.indexOf('      <section className="panel company-access-panel">');
const usersSectionStart = owner.indexOf('      <section className="panel users-panel access-users-panel">', companySectionStart);
if (companySectionStart !== -1 && usersSectionStart !== -1) {
  owner = owner.slice(0, companySectionStart) + owner.slice(usersSectionStart);
}

if (!owner.includes('export function CompanyAccessPage({')) {
  const supportStart = owner.indexOf('\n\nexport function SupportPanel');
  if (supportStart === -1) throw new Error('SupportPanel insertion point not found.');
  const component = `

export function CompanyAccessPage({
  companies,
  onChangeCompanyAccess,
}: {
  companies: Company[];
  onChangeCompanyAccess: (companyId: string, mode: 'full' | 'setup_only' | 'suspended') => void;
}) {
  type CompanyAccessMode = 'full' | 'setup_only' | 'suspended';
  const [companyAccessSearch, setCompanyAccessSearch] = useState('');
  const [companyAccessFilter, setCompanyAccessFilter] = useState<'all' | CompanyAccessMode>('all');
  const companyAccessRules: Record<CompanyAccessMode, { label: string; tone: string; detail: string; allowed: string[]; blocked: string[] }> = {
    full: {
      label: 'Full access',
      tone: 'full',
      detail: 'All paid workspace tools are available.',
      allowed: ['Jobs', 'Calendar', 'Materials', 'Email', 'Invoices', 'Uploads', 'Library', 'Finance'],
      blocked: [],
    },
    setup_only: {
      label: 'Setup only',
      tone: 'setup',
      detail: 'Company can finish billing/support setup, but production work is blocked.',
      allowed: ['Dashboard', 'Billing setup', 'Support', 'Read-only data'],
      blocked: ['Create jobs', 'Send email', 'Invoices', 'Uploads', 'Materials save'],
    },
    suspended: {
      label: 'Suspended',
      tone: 'suspended',
      detail: 'Read-only access only until payment or owner unlock.',
      allowed: ['Billing', 'Support', 'Read-only data'],
      blocked: ['Create/edit jobs', 'Send email', 'Invoices', 'Uploads', 'Library changes', 'Technician access'],
    },
  };
  const getCompanyAccessMode = (company: Company): CompanyAccessMode => {
    if (company.status === 'paused' || company.billingStatus === 'overdue') return 'suspended';
    if (company.status === 'setup' || company.billingStatus === 'not_started') return 'setup_only';
    return 'full';
  };
  const companyAccessRows = companies.map((company) => ({ company, mode: getCompanyAccessMode(company) }));
  const filteredCompanyAccessRows = companyAccessRows.filter(({ company, mode }) => {
    const normalizedSearch = companyAccessSearch.trim().toLowerCase();
    const haystack = [company.name, company.ownerName, company.ownerEmail, company.market, statusLabels[company.status], billingLabels[company.billingStatus], companyAccessRules[mode].label]
      .join(' ')
      .toLowerCase();
    return (companyAccessFilter === 'all' || companyAccessFilter === mode) && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const fullCompanies = companyAccessRows.filter((row) => row.mode === 'full').length;
  const setupOnlyCompanies = companyAccessRows.filter((row) => row.mode === 'setup_only').length;
  const suspendedCompanies = companyAccessRows.filter((row) => row.mode === 'suspended').length;

  return (
    <div className="access-command-center company-access-page">
      <section className="access-summary">
        <MetricCard icon={<Building2 size={20} />} label="Companies" value={companies.length.toString()} detail="Tenant workspaces" />
        <MetricCard icon={<CheckCircle2 size={20} />} label="Full access" value={fullCompanies.toString()} detail="Paid / active" />
        <MetricCard icon={<ShieldCheck size={20} />} label="Setup only" value={setupOnlyCompanies.toString()} detail="Billing setup required" />
        <MetricCard icon={<AlertTriangle size={20} />} label="Suspended" value={suspendedCompanies.toString()} detail="Read-only lock" />
      </section>

      <section className="panel company-access-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Company lock / unlock</p>
            <h2>Company access control</h2>
          </div>
          <ShieldCheck size={20} aria-hidden="true" />
        </div>
        <div className="company-access-toolbar">
          <label>
            Search company
            <input value={companyAccessSearch} onChange={(event) => setCompanyAccessSearch(event.target.value)} placeholder="Company, owner, billing status" />
          </label>
          <label>
            Access mode
            <select value={companyAccessFilter} onChange={(event) => setCompanyAccessFilter(event.target.value as 'all' | CompanyAccessMode)}>
              <option value="all">All access modes</option>
              <option value="full">Full access</option>
              <option value="setup_only">Setup only</option>
              <option value="suspended">Suspended</option>
            </select>
          </label>
          <button className="secondary-button compact" type="button" onClick={() => { setCompanyAccessSearch(''); setCompanyAccessFilter('all'); }}>
            Reset
          </button>
        </div>
        <div className="company-access-list">
          {filteredCompanyAccessRows.map(({ company, mode }) => {
            const rule = companyAccessRules[mode];
            return (
              <article className={'company-access-row ' + rule.tone} key={company.id}>
                <div className="company-main">
                  <div className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <h3>{company.name}</h3>
                    <p>{company.ownerEmail} · {company.market}</p>
                  </div>
                </div>
                <div className="company-access-status">
                  <span>Status</span>
                  <strong>{statusLabels[company.status]} · {billingLabels[company.billingStatus]}</strong>
                  <em className={'company-access-pill ' + rule.tone}>{rule.label}</em>
                </div>
                <label className="company-access-select">
                  Access mode
                  <select value={mode} onChange={(event) => onChangeCompanyAccess(company.id, event.target.value as CompanyAccessMode)}>
                    <option value="full">Full access</option>
                    <option value="setup_only">Setup only</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </label>
                <div className="company-access-rules">
                  <span>Allowed</span>
                  <div className="page-chip-list compact allowed-list">
                    {rule.allowed.map((item) => <b key={item}>{item}</b>)}
                  </div>
                  {rule.blocked.length ? (
                    <>
                      <span>Blocked</span>
                      <div className="page-chip-list compact blocked-list">
                        {rule.blocked.map((item) => <b key={item}>{item}</b>)}
                      </div>
                    </>
                  ) : null}
                </div>
                <div className="company-access-actions">
                  <button className="secondary-button compact" type="button" onClick={() => onChangeCompanyAccess(company.id, 'setup_only')}>Setup only</button>
                  <button className="secondary-button compact danger-button" type="button" onClick={() => onChangeCompanyAccess(company.id, 'suspended')}>Suspend</button>
                  <button className="primary-button compact" type="button" onClick={() => onChangeCompanyAccess(company.id, 'full')}>Restore full</button>
                </div>
              </article>
            );
          })}
          {!filteredCompanyAccessRows.length ? (
            <div className="empty-state compact-empty">
              <Building2 size={24} aria-hidden="true" />
              <h3>No companies match</h3>
              <p>Clear filters or add a company first.</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}`;
  owner = owner.slice(0, supportStart) + component + owner.slice(supportStart);
}
write(ownerPath, owner);

let app = read(appPath);
if (!app.includes('CompanyAccessPage,')) {
  app = app.replace('  CompanyDetail,\n', '  CompanyAccessPage,\n  CompanyDetail,\n');
}
if (!app.includes("page: 'companyAccess' as AppPage")) {
  app = app.replace(
    "            { page: 'billing' as AppPage, label: 'Billing', icon: <CreditCard size={18} aria-hidden=\"true\" /> },\n            { page: 'access' as AppPage, label: 'Access', icon: <UserPlus size={18} aria-hidden=\"true\" /> },",
    "            { page: 'billing' as AppPage, label: 'Billing', icon: <CreditCard size={18} aria-hidden=\"true\" /> },\n            { page: 'companyAccess' as AppPage, label: 'Company Access', icon: <ShieldCheck size={18} aria-hidden=\"true\" /> },\n            { page: 'access' as AppPage, label: 'Access', icon: <UserPlus size={18} aria-hidden=\"true\" /> },",
  );
}
app = app.replace(
  "page === 'billing' ? 'Plans & Billing' : page === 'access' ? 'Access'",
  "page === 'billing' ? 'Plans & Billing' : page === 'companyAccess' ? 'Company Access' : page === 'access' ? 'Access'",
);

const companyHandler = `              onChangeCompanyAccess={(companyId, mode) => {
                const company = companies.find((candidate) => candidate.id === companyId);
                const accessLabels = {
                  full: 'Full access',
                  setup_only: 'Setup only',
                  suspended: 'Suspended',
                } as const;
                updateCompany(companyId, (currentCompany) => {
                  if (mode === 'full') {
                    return { ...currentCompany, status: 'active' as CompanyStatus, billingStatus: 'paid' as BillingStatus, lastSync: 'Access restored' };
                  }
                  if (mode === 'setup_only') {
                    return { ...currentCompany, status: 'setup' as CompanyStatus, billingStatus: 'not_started' as BillingStatus, lastSync: 'Setup-only access' };
                  }
                  return { ...currentCompany, status: 'paused' as CompanyStatus, billingStatus: 'overdue' as BillingStatus, lastSync: 'Access suspended' };
                });
                recordAudit({
                  category: 'access',
                  action: 'company.access_changed',
                  actor: 'ServiceScope Owner',
                  resource: company?.name ?? 'Unknown tenant',
                  details: 'Company access changed to ' + accessLabels[mode] + '.',
                });
              }}
`;
if (!app.includes("page === 'companyAccess' ? (")) {
  app = app.replace(
    "        ) : page === 'access' ? (\n          <AccessPage",
    `        ) : page === 'companyAccess' ? (
          <CompanyAccessPage
            companies={companies}
${companyHandler}          />
        ) : page === 'access' ? (
          <AccessPage`,
  );
}
write(appPath, app);

console.log('Company access left navigation patch applied.');
