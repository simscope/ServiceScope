const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'src/App.tsx');
const ownerPath = path.join(root, 'src/components/OwnerPages.tsx');
const cssPath = path.join(root, 'src/styles/responsive.css');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content);
}

let app = read(appPath);
const accessRenderStart = app.indexOf("        ) : page === 'access' ? (");
const accessRenderEnd = app.indexOf("        ) : page === 'audit' ? (", accessRenderStart);

if (accessRenderStart === -1 || accessRenderEnd === -1) {
  throw new Error('Access render block not found.');
}

let accessRender = app.slice(accessRenderStart, accessRenderEnd);
if (!accessRender.includes('companies={companies}')) {
  accessRender = accessRender.replace(
    '<AccessPage\n',
    '<AccessPage\n            companies={companies}\n',
  );
}

if (!accessRender.includes('onChangeCompanyAccess=')) {
  const companyAccessHandler = `            onChangeCompanyAccess={(companyId, mode) => {
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
  accessRender = accessRender.replace(/\n\s*\/>
?$/, '\n' + companyAccessHandler + '          />');
}

app = app.slice(0, accessRenderStart) + accessRender + app.slice(accessRenderEnd);
write(appPath, app);

let owner = read(ownerPath);
owner = owner.replace(
  "import { SYSTEM_OWNER_ID } from '../services/accessStore';",
  "import { ownerPageLabels, ownerPagePermissions, SYSTEM_OWNER_ID } from '../services/accessStore';",
);

const accessStart = owner.indexOf('export function AccessPage({');
const accessEnd = owner.indexOf('\n\nexport function SupportPanel', accessStart);
if (accessStart === -1 || accessEnd === -1) {
  throw new Error('AccessPage patch target not found.');
}

const newAccessPage = `export function AccessPage({
  companies,
  users,
  form,
  onFormChange,
  onInvite,
  onRoleChange,
  onStatusChange,
  onChangeCompanyAccess,
}: {
  companies: Company[];
  users: PlatformUser[];
  form: NewPlatformUserForm;
  onFormChange: (form: NewPlatformUserForm) => void;
  onInvite: (event: FormEvent<HTMLFormElement>) => void;
  onRoleChange: (userId: string, role: PlatformUserRole) => void;
  onStatusChange: (userId: string, status: PlatformUserStatus) => void;
  onChangeCompanyAccess: (companyId: string, mode: 'full' | 'setup_only' | 'suspended') => void;
}) {
  type CompanyAccessMode = 'full' | 'setup_only' | 'suspended';
  const [accessSearch, setAccessSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | PlatformUserRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | PlatformUserStatus>('all');
  const [companyAccessSearch, setCompanyAccessSearch] = useState('');
  const [companyAccessFilter, setCompanyAccessFilter] = useState<'all' | CompanyAccessMode>('all');
  const roleOrder: PlatformUserRole[] = ['owner', 'admin', 'support', 'viewer'];
  const pageKeys = Object.keys(ownerPageLabels) as Array<keyof typeof ownerPageLabels>;
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
  const companyAccessRows = companies.map((company) => ({
    company,
    mode: getCompanyAccessMode(company),
  }));
  const filteredCompanyAccessRows = companyAccessRows.filter(({ company, mode }) => {
    const normalizedSearch = companyAccessSearch.trim().toLowerCase();
    const haystack = [company.name, company.ownerName, company.ownerEmail, company.market, statusLabels[company.status], billingLabels[company.billingStatus], companyAccessRules[mode].label]
      .join(' ')
      .toLowerCase();
    return (companyAccessFilter === 'all' || companyAccessFilter === mode) && (!normalizedSearch || haystack.includes(normalizedSearch));
  });
  const filteredUsers = users.filter((user) => {
    const normalizedSearch = accessSearch.trim().toLowerCase();
    const haystack = [user.name, user.email, platformRoleLabels[user.role], platformStatusLabels[user.status], ownerPagePermissions[user.role].map((page) => ownerPageLabels[page]).join(' ')]
      .join(' ')
      .toLowerCase();
    const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    const matchesStatus = statusFilter === 'all' || user.status === statusFilter;

    return matchesSearch && matchesRole && matchesStatus;
  });
  const activeUsers = users.filter((user) => user.status === 'active').length;
  const invitedUsers = users.filter((user) => user.status === 'invited').length;
  const disabledUsers = users.filter((user) => user.status === 'disabled').length;
  const ownersAndAdmins = users.filter((user) => user.status === 'active' && (user.role === 'owner' || user.role === 'admin')).length;
  const fullCompanies = companyAccessRows.filter((row) => row.mode === 'full').length;
  const setupOnlyCompanies = companyAccessRows.filter((row) => row.mode === 'setup_only').length;
  const suspendedCompanies = companyAccessRows.filter((row) => row.mode === 'suspended').length;

  return (
    <div className="access-command-center">
      <section className="access-summary">
        <MetricCard icon={<Users size={20} />} label="Team users" value={users.length.toString()} detail="Owner console accounts" />
        <MetricCard icon={<CheckCircle2 size={20} />} label="Active" value={activeUsers.toString()} detail="Can sign in" />
        <MetricCard icon={<ShieldCheck size={20} />} label="Company full access" value={fullCompanies.toString()} detail={setupOnlyCompanies + ' setup only'} />
        <MetricCard icon={<AlertTriangle size={20} />} label="Suspended" value={suspendedCompanies.toString()} detail="Companies blocked" />
      </section>

      <div className="access-main-grid">
        <section className="panel invite-panel access-invite-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Platform team</p>
              <h2>Add user</h2>
            </div>
            <UserPlus size={20} aria-hidden="true" />
          </div>
          <form className="access-form" onSubmit={onInvite}>
            <label>
              Name
              <input value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} placeholder="Taylor Smith" />
            </label>
            <label>
              Email
              <input type="email" value={form.email} onChange={(event) => onFormChange({ ...form, email: event.target.value })} placeholder="taylor@servicescope.app" />
            </label>
            <label>
              Role
              <select value={form.role} onChange={(event) => onFormChange({ ...form, role: event.target.value as PlatformUserRole })}>
                <option value="support">Support</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            <div className="role-preview-box">
              <span>Page access for {platformRoleLabels[form.role]}</span>
              <div className="page-chip-list">
                {ownerPagePermissions[form.role].map((page) => <b key={page}>{ownerPageLabels[page]}</b>)}
              </div>
            </div>
            <button className="primary-button" type="submit">
              <UserPlus size={18} aria-hidden="true" />
              Add user
            </button>
          </form>
        </section>

        <section className="panel access-matrix-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Page permissions</p>
              <h2>Access by role</h2>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="access-role-matrix">
            <div className="access-role-row access-role-head">
              <span>Role</span>
              {pageKeys.map((page) => <span key={page}>{ownerPageLabels[page]}</span>)}
            </div>
            {roleOrder.map((role) => (
              <div className="access-role-row" key={role}>
                <strong>{platformRoleLabels[role]}</strong>
                {pageKeys.map((page) => {
                  const allowed = ownerPagePermissions[role].includes(page);
                  return <span className={allowed ? 'permission-dot allowed' : 'permission-dot denied'} key={page}>{allowed ? '✓' : '—'}</span>;
                })}
              </div>
            ))}
          </div>
          <p className="access-note">Role controls which owner pages appear in the sidebar and which hash routes can be opened.</p>
        </section>
      </div>

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

      <section className="panel users-panel access-users-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">RBAC</p>
            <h2>Users and page access</h2>
          </div>
          <Users size={20} aria-hidden="true" />
        </div>

        <div className="access-filter-grid">
          <label>
            Search
            <input value={accessSearch} onChange={(event) => setAccessSearch(event.target.value)} placeholder="Name, email, role, page" />
          </label>
          <label>
            Role
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'all' | PlatformUserRole)}>
              <option value="all">All roles</option>
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="support">Support</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | PlatformUserStatus)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="invited">Invited</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <button
            className="secondary-button compact"
            type="button"
            onClick={() => {
              setAccessSearch('');
              setRoleFilter('all');
              setStatusFilter('all');
            }}
          >
            Reset
          </button>
        </div>

        <div className="user-list access-user-list">
          {filteredUsers.map((user) => {
            const lockedOwner = user.id === SYSTEM_OWNER_ID;
            const pages = ownerPagePermissions[user.role];

            return (
              <article className={'user-row access-user-row ' + (lockedOwner ? 'locked-owner' : '')} key={user.id}>
                <div className="company-main">
                  <div className="company-avatar">{user.name.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <h3>{user.name}</h3>
                    <p>{lockedOwner ? user.email + ' - locked owner' : user.email}</p>
                  </div>
                </div>
                <div className="billing-cell">
                  <span>Role</span>
                  {lockedOwner ? (
                    <strong>Owner</strong>
                  ) : (
                    <select value={user.role} onChange={(event) => onRoleChange(user.id, event.target.value as PlatformUserRole)}>
                      <option value="admin">Admin</option>
                      <option value="support">Support</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  )}
                </div>
                <div className="billing-cell">
                  <span>Status</span>
                  {lockedOwner ? (
                    <strong>Active</strong>
                  ) : (
                    <select value={user.status} onChange={(event) => onStatusChange(user.id, event.target.value as PlatformUserStatus)}>
                      <option value="active">Active</option>
                      <option value="invited">Invited</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  )}
                </div>
                <div className="access-page-cell">
                  <span>Pages</span>
                  <div className="page-chip-list compact">
                    {pages.map((page) => <b key={page}>{ownerPageLabels[page]}</b>)}
                  </div>
                </div>
                <div className="billing-cell">
                  <span>Last active</span>
                  <strong>{user.lastActive}</strong>
                </div>
                <span className={'user-status ' + user.status}>{platformStatusLabels[user.status]}</span>
              </article>
            );
          })}
          {!filteredUsers.length ? (
            <div className="empty-state compact-empty">
              <Users size={24} aria-hidden="true" />
              <h3>No users match</h3>
              <p>Clear filters or invite a new team member.</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}`;

owner = owner.slice(0, accessStart) + newAccessPage + owner.slice(accessEnd);
write(ownerPath, owner);

let css = read(cssPath);
if (!css.includes('Company access control panel')) {
  css += `

/* Company access control panel */
.company-access-panel{min-width:0}.company-access-toolbar{display:grid;grid-template-columns:minmax(260px,1fr) 220px auto;gap:10px;align-items:end;margin-bottom:14px}.company-access-toolbar label{display:grid;gap:6px;color:#526157;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.company-access-toolbar input,.company-access-toolbar select{width:100%;border:1px solid #d6dfd8;border-radius:10px;background:#f8faf7;padding:10px 12px;font-weight:800;color:#17201b}.company-access-list{display:grid;gap:10px}.company-access-row{display:grid;grid-template-columns:minmax(230px,1.1fr) minmax(170px,.8fr) 180px minmax(280px,1.4fr) auto;gap:12px;align-items:start;border:1px solid #dfe7e1;border-radius:14px;background:#fff;padding:12px}.company-access-row.full{background:#fbfefb}.company-access-row.setup{border-color:#fde68a;background:#fffdf4}.company-access-row.suspended{border-color:#fecaca;background:#fff7f7}.company-access-status,.company-access-select,.company-access-rules{display:grid;gap:7px}.company-access-status span,.company-access-select,.company-access-rules>span{color:#526157;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.company-access-status strong{font-size:13px}.company-access-select select{border:1px solid #d6dfd8;border-radius:10px;background:#fff;padding:9px 10px;font-weight:900}.company-access-pill{display:inline-flex;justify-self:start;border-radius:999px;padding:5px 9px;font-style:normal;font-size:11px;font-weight:900}.company-access-pill.full{background:#ecfdf3;color:#166534}.company-access-pill.setup{background:#fef3c7;color:#92400e}.company-access-pill.suspended{background:#fee2e2;color:#991b1b}.company-access-actions{display:grid;gap:7px;min-width:120px}.danger-button{border-color:#fecaca!important;background:#fff7f7!important;color:#991b1b!important}.allowed-list b{background:#ecfdf3;color:#166534}.blocked-list b{background:#fee2e2;color:#991b1b}
@media (max-width:1380px){.company-access-row{grid-template-columns:1fr 1fr}.company-access-actions{grid-column:1/-1;grid-template-columns:repeat(3,minmax(0,1fr))}.company-access-rules{grid-column:1/-1}.company-access-toolbar{grid-template-columns:1fr 220px auto}}
@media (max-width:760px){.company-access-toolbar,.company-access-row,.company-access-actions{grid-template-columns:1fr}.company-access-rules{grid-column:auto}}
`;
  write(cssPath, css);
}

console.log('Company access control patch applied.');
