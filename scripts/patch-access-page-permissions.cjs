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

app = app.replace(
  /  createPlatformUser,\n  listPlatformUsers,\n  rolePermissions,\n  savePlatformUsers,\n  updatePlatformUserRole,\n  updatePlatformUserStatus,\n\} from '\.\/services\/accessStore';/,
  `  canAccessOwnerPage,
  createPlatformUser,
  firstAllowedOwnerPage,
  listPlatformUsers,
  rolePermissions,
  savePlatformUsers,
  SYSTEM_OWNER_EMAIL,
  updatePlatformUserRole,
  updatePlatformUserStatus,
} from './services/accessStore';`,
);

if (!app.includes('const currentOwnerRole: PlatformUserRole')) {
  app = app.replace(
    "  const openSupportCount = supportTickets.filter((ticket) => ticket.status !== 'resolved').length;",
    `  const openSupportCount = supportTickets.filter((ticket) => ticket.status !== 'resolved').length;
  const currentOwnerUser = authSession?.kind === 'owner'
    ? platformUsers.find((user) => user.email.toLowerCase() === authSession.email.toLowerCase())
    : undefined;
  const currentOwnerRole: PlatformUserRole = authSession?.kind === 'owner'
    ? authSession.email.toLowerCase() === SYSTEM_OWNER_EMAIL
      ? 'owner'
      : currentOwnerUser?.status === 'active'
        ? currentOwnerUser.role
        : 'viewer'
    : 'viewer';
  const ownerCanAccess = (candidate: AppPage) => canAccessOwnerPage(currentOwnerRole, candidate);`,
  );
}

app = app.replace(
  /  function navigate\(nextPage: AppPage\) \{\n    setPage\(nextPage\);\n    window\.history\.replaceState\(null, '', `#\$\{nextPage === 'companyLogin' \? 'company-login' : nextPage\}`\);\n  \}/,
  `  function navigate(nextPage: AppPage) {
    const resolvedPage = authSession?.kind === 'owner' && !canAccessOwnerPage(currentOwnerRole, nextPage)
      ? firstAllowedOwnerPage(currentOwnerRole)
      : nextPage;
    setPage(resolvedPage);
    window.history.replaceState(null, '', \`#\${resolvedPage === 'companyLogin' ? 'company-login' : resolvedPage}\`);
  }`,
);

if (!app.includes('Redirect owner users away from blocked pages')) {
  app = app.replace(
    "  useEffect(() => {\n    if (!authSession) return;\n\n    if (authSession.kind === 'company') {",
    `  useEffect(() => {
    if (authSession?.kind !== 'owner') return;
    if (!ownerCanAccess(page)) {
      navigate(firstAllowedOwnerPage(currentOwnerRole));
    }
  }, [authSession, currentOwnerRole, page]);

  // Redirect owner users away from blocked pages.
  useEffect(() => {
    if (!authSession) return;

    if (authSession.kind === 'company') {`,
  );
}

const navStart = app.indexOf('        <nav className="nav-list">');
const navEnd = app.indexOf('\n        </nav>', navStart);
if (navStart !== -1 && navEnd !== -1 && !app.includes('ownerNavigationItems')) {
  const newNav = `        <nav className="nav-list">
          {([
            { page: 'dashboard' as AppPage, label: 'Dashboard', icon: <LayoutDashboard size={18} aria-hidden="true" /> },
            { page: 'companies' as AppPage, label: 'Companies', icon: <Building2 size={18} aria-hidden="true" /> },
            { page: 'monitoring' as AppPage, label: 'Monitoring', icon: <Activity size={18} aria-hidden="true" /> },
            { page: 'billing' as AppPage, label: 'Billing', icon: <CreditCard size={18} aria-hidden="true" /> },
            { page: 'access' as AppPage, label: 'Access', icon: <UserPlus size={18} aria-hidden="true" /> },
            { page: 'audit' as AppPage, label: 'Audit', icon: <FileClock size={18} aria-hidden="true" /> },
            { page: 'support' as AppPage, label: 'Support', icon: <Inbox size={18} aria-hidden="true" /> },
          ]).filter((item) => ownerCanAccess(item.page)).map((item) => (
            <button className={\`nav-item \${page === item.page ? 'active' : ''}\`} type="button" onClick={() => navigate(item.page)} key={item.page}>
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>`;
  app = app.slice(0, navStart) + newNav + app.slice(navEnd + '\n        </nav>'.length);
}

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
  users,
  form,
  onFormChange,
  onInvite,
  onRoleChange,
  onStatusChange,
}: {
  users: PlatformUser[];
  form: NewPlatformUserForm;
  onFormChange: (form: NewPlatformUserForm) => void;
  onInvite: (event: FormEvent<HTMLFormElement>) => void;
  onRoleChange: (userId: string, role: PlatformUserRole) => void;
  onStatusChange: (userId: string, status: PlatformUserStatus) => void;
}) {
  const [accessSearch, setAccessSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | PlatformUserRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | PlatformUserStatus>('all');
  const roleOrder: PlatformUserRole[] = ['owner', 'admin', 'support', 'viewer'];
  const pageKeys = Object.keys(ownerPageLabels) as Array<keyof typeof ownerPageLabels>;
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

  return (
    <div className="access-command-center">
      <section className="access-summary">
        <MetricCard icon={<Users size={20} />} label="Team users" value={users.length.toString()} detail="Owner console accounts" />
        <MetricCard icon={<CheckCircle2 size={20} />} label="Active" value={activeUsers.toString()} detail="Can sign in" />
        <MetricCard icon={<ShieldCheck size={20} />} label="Admins" value={ownersAndAdmins.toString()} detail="Owner/Admin access" />
        <MetricCard icon={<UserPlus size={20} />} label="Invited" value={invitedUsers.toString()} detail={disabledUsers + ' disabled'} />
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
              <article className={\`user-row access-user-row \${lockedOwner ? 'locked-owner' : ''}\`} key={user.id}>
                <div className="company-main">
                  <div className="company-avatar">{user.name.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <h3>{user.name}</h3>
                    <p>{lockedOwner ? \`${user.email} - locked owner\` : user.email}</p>
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
                <span className={\`user-status \${user.status}\`}>{platformStatusLabels[user.status]}</span>
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
if (!css.includes('Access command center page')) {
  css += `

/* Access command center page */
.access-command-center{display:grid;gap:16px}.access-main-grid{display:grid;grid-template-columns:minmax(300px,.7fr) minmax(0,1.3fr);gap:16px;align-items:start}.access-invite-card,.access-matrix-panel,.access-users-panel{min-width:0}.role-preview-box{display:grid;gap:8px;border:1px solid #dfe7e1;border-radius:12px;background:#f8fbf6;padding:10px}.role-preview-box>span,.access-page-cell>span{color:#526157;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.page-chip-list{display:flex;flex-wrap:wrap;gap:6px}.page-chip-list b{display:inline-flex;align-items:center;border-radius:999px;background:#eef4ea;color:#17201b;padding:5px 9px;font-size:11px;font-weight:900}.page-chip-list.compact b{padding:4px 8px;font-size:10px}.access-role-matrix{display:grid;border:1px solid #dfe7e1;border-radius:14px;overflow:hidden}.access-role-row{display:grid;grid-template-columns:120px repeat(7,minmax(74px,1fr));gap:0;align-items:center;border-top:1px solid #edf2ee;background:#fff}.access-role-row:first-child{border-top:0}.access-role-row>span,.access-role-row>strong{padding:12px 10px;border-left:1px solid #edf2ee;min-height:44px;display:flex;align-items:center;justify-content:center;text-align:center}.access-role-row>strong{justify-content:flex-start;border-left:0}.access-role-head{background:#f4f7f4;color:#526157;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.permission-dot.allowed{color:#166534;background:#ecfdf3;font-weight:900}.permission-dot.denied{color:#9ca3af;background:#fafafa}.access-note{margin:12px 0 0;color:#526157;font-weight:800}.access-user-row{grid-template-columns:minmax(210px,1.25fr) .65fr .65fr minmax(240px,1.5fr) .7fr auto}.access-page-cell{display:grid;gap:6px}.access-user-list .user-row{align-items:start}
@media (max-width:1200px){.access-main-grid{grid-template-columns:1fr}.access-role-row{grid-template-columns:110px repeat(7,minmax(64px,1fr));font-size:12px}.access-user-row{grid-template-columns:1fr 1fr}.access-user-row>.user-status{justify-self:start}}
@media (max-width:720px){.access-role-matrix{overflow:auto}.access-role-row{min-width:760px}.access-user-row{grid-template-columns:1fr}.access-filter-grid{grid-template-columns:1fr}.access-summary{grid-template-columns:1fr}}
`;
  write(cssPath, css);
}

console.log('Access page permissions patch applied.');
