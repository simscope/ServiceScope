const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ownerPath = path.join(root, 'src/components/OwnerPages.tsx');
const cssPath = path.join(root, 'src/styles/responsive.css');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content);
}

let owner = read(ownerPath);
const start = owner.indexOf('export function DashboardOverview({');
const auditPageMatch = start === -1 ? null : owner.slice(start + 1).match(/\r?\n\r?\nexport function AuditPage/);
const end = auditPageMatch ? start + 1 + auditPageMatch.index : -1;

if (start === -1 || end === -1) {
  throw new Error('DashboardOverview patch target not found.');
}

const newDashboard = `export function DashboardOverview({
  companies,
  supportTickets,
  onOpenCompanies,
  onOpenSupport,
}: {
  companies: Company[];
  supportTickets: SupportTicket[];
  onOpenCompanies: () => void;
  onOpenSupport: () => void;
}) {
  const openTickets = supportTickets.filter((ticket) => ticket.status !== 'resolved');
  const newTickets = supportTickets.filter((ticket) => ticket.status === 'new');
  const urgentTickets = openTickets.filter((ticket) => ticket.priority === 'urgent');
  const overdueCompanies = companies.filter((company) => company.billingStatus === 'overdue');
  const trialCompanies = companies.filter((company) => company.status === 'trial' || company.billingStatus === 'trialing');
  const activeCompanies = companies.filter((company) => company.status === 'active');
  const setupCompanies = companies.filter((company) => company.status === 'setup');
  const monthlyRevenue = companies.reduce((total, company) => total + (plans.find((plan) => plan.name === company.plan)?.price ?? 0), 0);
  const storageUsed = companies.reduce((total, company) => total + company.usage.storageGb, 0);
  const averageHealth = companies.length ? Math.round(companies.reduce((total, company) => total + company.health, 0) / companies.length) : 0;
  const lowHealthCompanies = companies.filter((company) => company.health < 70);
  const companyRows = [...companies].sort((left, right) => {
    const leftRisk = (left.billingStatus === 'overdue' ? 3 : 0) + (left.health < 70 ? 2 : 0) + (left.status === 'setup' ? 1 : 0);
    const rightRisk = (right.billingStatus === 'overdue' ? 3 : 0) + (right.health < 70 ? 2 : 0) + (right.status === 'setup' ? 1 : 0);
    return rightRisk - leftRisk || left.name.localeCompare(right.name);
  });
  const recentTickets = supportTickets.slice(0, 5);
  const actionItems = [
    ...overdueCompanies.map((company) => ({
      key: 'billing-' + company.id,
      tone: 'danger',
      title: company.name + ' payment overdue',
      detail: billingLabels[company.billingStatus] + ' · ' + company.plan + ' plan · restore access after payment.',
      meta: 'Billing',
      action: onOpenCompanies,
      actionLabel: 'Open company',
    })),
    ...newTickets.slice(0, 4).map((ticket) => ({
      key: 'support-' + ticket.id,
      tone: ticket.priority === 'urgent' ? 'danger' : 'warning',
      title: ticket.companyName + ' — ' + ticket.subject,
      detail: ticket.kind + ' · ' + ticket.priority + ' · ' + ticket.lastUpdate,
      meta: 'New support',
      action: onOpenSupport,
      actionLabel: 'Open support',
    })),
    ...lowHealthCompanies.slice(0, 4).map((company) => ({
      key: 'health-' + company.id,
      tone: 'warning',
      title: company.name + ' health is low',
      detail: company.health + '% health · last sync ' + company.lastSync + '.',
      meta: 'Monitoring',
      action: onOpenCompanies,
      actionLabel: 'Open company',
    })),
    ...setupCompanies.slice(0, 3).map((company) => ({
      key: 'setup-' + company.id,
      tone: 'neutral',
      title: company.name + ' is still in setup',
      detail: 'Owner access, billing, or first data may still need attention.',
      meta: 'Setup',
      action: onOpenCompanies,
      actionLabel: 'Open company',
    })),
  ];

  return (
    <div className="owner-command-center">
      <section className="owner-kpi-grid" aria-label="Owner dashboard summary">
        <MetricCard icon={<Building2 size={20} />} label="Companies" value={companies.length.toString()} detail={activeCompanies.length + ' active · ' + trialCompanies.length + ' trial'} />
        <MetricCard icon={<CircleDollarSign size={20} />} label="MRR" value={money(monthlyRevenue) + '/mo'} detail={overdueCompanies.length ? overdueCompanies.length + ' payment risk' : 'No payment risk'} />
        <MetricCard icon={<CreditCard size={20} />} label="Billing risk" value={overdueCompanies.length.toString()} detail={overdueCompanies.length ? 'Overdue tenants' : 'All accounts current'} />
        <MetricCard icon={<Inbox size={20} />} label="New support" value={newTickets.length.toString()} detail={openTickets.length + ' open · ' + urgentTickets.length + ' urgent'} />
        <MetricCard icon={<CheckCircle2 size={20} />} label="Health" value={averageHealth + '%'} detail={lowHealthCompanies.length ? lowHealthCompanies.length + ' tenant needs review' : 'Portfolio stable'} />
        <MetricCard icon={<Database size={20} />} label="Storage" value={storageUsed.toFixed(1) + ' GB'} detail="Tenant document usage" />
      </section>

      <div className="owner-dashboard-main">
        <section className="panel owner-actions-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Action required</p>
              <h2>What needs attention</h2>
            </div>
            <span className={actionItems.length ? 'owner-action-count hot' : 'owner-action-count'}>{actionItems.length}</span>
          </div>

          {actionItems.length ? (
            <div className="owner-action-list">
              {actionItems.slice(0, 8).map((action) => (
                <article className={'owner-action-card ' + action.tone} key={action.key}>
                  <div className="owner-action-icon">
                    {action.tone === 'danger' ? <AlertTriangle size={18} aria-hidden="true" /> : <ClipboardList size={18} aria-hidden="true" />}
                  </div>
                  <div>
                    <span>{action.meta}</span>
                    <h3>{action.title}</h3>
                    <p>{action.detail}</p>
                  </div>
                  <button className="secondary-button compact" type="button" onClick={action.action}>
                    {action.actionLabel}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state compact-empty owner-clear-state">
              <CheckCircle2 size={24} aria-hidden="true" />
              <h3>No urgent actions</h3>
              <p>Billing, support, and tenant health are clean right now.</p>
            </div>
          )}
        </section>

        <section className="panel owner-recent-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Recent activity</p>
              <h2>Support stream</h2>
            </div>
            <button className="secondary-button compact" type="button" onClick={onOpenSupport}>Open support</button>
          </div>
          <div className="owner-recent-list">
            {recentTickets.length ? (
              recentTickets.map((ticket) => (
                <button className="owner-recent-row" type="button" onClick={onOpenSupport} key={ticket.id}>
                  <span className={'ticket-kind ' + ticket.kind}>{ticketKindLabels[ticket.kind]}</span>
                  <div>
                    <strong>{ticket.subject}</strong>
                    <small>{ticket.companyName} · {ticketStatusLabels[ticket.status]} · {ticket.lastUpdate}</small>
                  </div>
                </button>
              ))
            ) : (
              <p className="quiet-line">No support activity yet.</p>
            )}
          </div>
        </section>
      </div>

      <section className="panel owner-companies-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Tenant control</p>
            <h2>Companies at a glance</h2>
          </div>
          <button className="secondary-button compact" type="button" onClick={onOpenCompanies}>Open companies</button>
        </div>

        <div className="owner-company-table" role="table" aria-label="Company health and billing overview">
          <div className="owner-company-row owner-company-head" role="row">
            <span>Company</span>
            <span>Plan</span>
            <span>Billing</span>
            <span>Support</span>
            <span>Jobs</span>
            <span>Health</span>
            <span>Sync</span>
            <span>Action</span>
          </div>
          {companyRows.length ? (
            companyRows.map((company) => {
              const companyOpenTickets = openTickets.filter((ticket) => ticket.companyId === company.id);
              const companyNewTickets = companyOpenTickets.filter((ticket) => ticket.status === 'new');
              return (
                <div className="owner-company-row" role="row" key={company.id}>
                  <div className="company-main">
                    <div className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</div>
                    <div>
                      <h3>{company.name}</h3>
                      <p>{company.ownerName} · {company.market}</p>
                    </div>
                  </div>
                  <strong>{company.plan}</strong>
                  <span className={'billing-pill ' + company.billingStatus}>{billingLabels[company.billingStatus]}</span>
                  <button className={companyNewTickets.length ? 'owner-support-count hot' : 'owner-support-count'} type="button" onClick={onOpenSupport}>
                    {companyNewTickets.length ? companyNewTickets.length + ' new' : companyOpenTickets.length + ' open'}
                  </button>
                  <strong>{company.openJobs}</strong>
                  <div className="owner-health-cell">
                    <strong>{company.health}%</strong>
                    <div className="health-track"><span style={{ width: company.health + '%' }} /></div>
                  </div>
                  <span className="owner-sync-cell">{company.lastSync}</span>
                  <button className="secondary-button compact" type="button" onClick={onOpenCompanies}>Open</button>
                </div>
              );
            })
          ) : (
            <div className="empty-state compact-empty owner-table-empty">
              <Building2 size={24} aria-hidden="true" />
              <h3>No companies yet</h3>
              <p>Add the first tenant from the Companies page.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}`;

owner = owner.slice(0, start) + newDashboard + owner.slice(end);
write(ownerPath, owner);

let css = read(cssPath);
if (!css.includes('Owner command center dashboard')) {
  css += `

/* Owner command center dashboard */
.owner-command-center{display:grid;gap:16px}.owner-kpi-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}.owner-kpi-grid .metric-card{min-height:112px;padding:16px}.owner-dashboard-main{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(320px,.75fr);gap:16px;align-items:start}.owner-actions-panel,.owner-recent-panel,.owner-companies-panel{min-width:0}.owner-action-count{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:30px;border-radius:999px;background:#eef4ea;color:#17201b;font-weight:900}.owner-action-count.hot{background:#fee2e2;color:#991b1b}.owner-action-list{display:grid;gap:10px}.owner-action-card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:center;border:1px solid #dfe7e1;border-radius:14px;background:#fff;padding:12px}.owner-action-card.danger{border-color:#fecaca;background:#fff7f7}.owner-action-card.warning{border-color:#fde68a;background:#fffdf4}.owner-action-card.neutral{border-color:#dbeafe;background:#f8fbff}.owner-action-icon{width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;border-radius:10px;background:#eef4ea;color:#17201b}.owner-action-card.danger .owner-action-icon{background:#fee2e2;color:#991b1b}.owner-action-card.warning .owner-action-icon{background:#fef3c7;color:#92400e}.owner-action-card h3,.owner-action-card p{margin:0}.owner-action-card span{color:#526157;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.owner-action-card p{color:#526157;font-weight:800;line-height:1.35}.owner-recent-list{display:grid;gap:8px}.owner-recent-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:start;width:100%;border:1px solid #dfe7e1;border-radius:12px;background:#fff;padding:10px;text-align:left;cursor:pointer}.owner-recent-row strong,.owner-recent-row small{display:block}.owner-recent-row small{color:#647067;font-weight:800;margin-top:3px}.owner-company-table{display:grid;gap:0;border:1px solid #dfe7e1;border-radius:14px;overflow:hidden}.owner-company-row{display:grid;grid-template-columns:minmax(220px,1.6fr) .65fr .8fr .75fr .45fr 1fr .85fr .55fr;gap:12px;align-items:center;padding:12px 14px;border-top:1px solid #edf2ee;background:#fff}.owner-company-row:first-child{border-top:0}.owner-company-head{background:#f4f7f4;color:#526157;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.owner-company-row h3,.owner-company-row p{margin:0}.owner-company-row p{color:#647067;font-size:12px;font-weight:800}.owner-support-count{justify-self:start;border:1px solid #dfe7e1;border-radius:999px;background:#fff;padding:6px 10px;font-weight:900;cursor:pointer}.owner-support-count.hot{border-color:#fecaca;background:#fee2e2;color:#991b1b}.owner-health-cell{display:grid;gap:5px}.owner-sync-cell{color:#526157;font-size:12px;font-weight:800}.owner-table-empty{border-top:1px solid #edf2ee}.owner-clear-state{min-height:180px}
@media (max-width:1300px){.owner-kpi-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.owner-dashboard-main{grid-template-columns:1fr}.owner-company-row{grid-template-columns:minmax(220px,1.5fr) .7fr .9fr .8fr .5fr 1fr}.owner-company-row>span:nth-child(7),.owner-company-row>.owner-sync-cell,.owner-company-head span:nth-child(7){display:none}.owner-company-row>button.secondary-button,.owner-company-head span:nth-child(8){display:none}}
@media (max-width:820px){.owner-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.owner-action-card{grid-template-columns:auto minmax(0,1fr)}.owner-action-card button{grid-column:2}.owner-company-head{display:none}.owner-company-row{grid-template-columns:1fr;gap:8px}.owner-company-row .billing-pill,.owner-support-count{justify-self:start}}
@media (max-width:560px){.owner-kpi-grid{grid-template-columns:1fr}.owner-kpi-grid .metric-card{min-height:auto}.owner-dashboard-main{gap:12px}}
`;
  write(cssPath, css);
}

console.log('Owner command center dashboard patch applied.');
