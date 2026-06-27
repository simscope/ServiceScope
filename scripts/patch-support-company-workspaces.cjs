const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'src/App.tsx');
const ownerPath = path.join(root, 'src/components/OwnerPages.tsx');
const cssPath = path.join(root, 'src/styles/responsive.css');
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, c) => fs.writeFileSync(p, c);

let app = read(appPath);
if (!app.includes('const newSupportCount = supportTickets.filter')) {
  app = app.replace(
    "  const openSupportCount = supportTickets.filter((ticket) => ticket.status !== 'resolved').length;",
    "  const openSupportCount = supportTickets.filter((ticket) => ticket.status !== 'resolved').length;\n  const newSupportCount = supportTickets.filter((ticket) => ticket.status === 'new').length;",
  );
}
if (!app.includes('className=\"nav-badge\"')) {
  app = app.replace(
    '            Support\n          </button>',
    '            Support\n            {newSupportCount ? <span className="nav-badge">{newSupportCount}</span> : null}\n          </button>',
  );
}
write(appPath, app);

let owner = read(ownerPath);
owner = owner.replace('ticket.id === selectedTicket?.id', 'ticket.id === activeSupportTicket?.id');
owner = owner.replace('{selectedTicket ? (', '{activeSupportTicket ? (');
owner = owner.replace(/selectedTicket\./g, 'activeSupportTicket.');
if (!owner.includes('const supportCompanyRows = companies.map')) {
  owner = owner.replace(
    "  const selectedCompany = companies.find((company) => company.id === form.companyId);",
    `  const selectedCompany = companies.find((company) => company.id === form.companyId);
  const [selectedSupportCompanyId, setSelectedSupportCompanyId] = useState(() => selectedTicket?.companyId ?? form.companyId ?? companies[0]?.id ?? '');
  const supportCompanyRows = companies.map((company) => {
    const rows = tickets.filter((ticket) => ticket.companyId === company.id);
    return {
      company,
      tickets: rows,
      openCount: rows.filter((ticket) => ticket.status !== 'resolved').length,
      newCount: rows.filter((ticket) => ticket.status === 'new').length,
      urgentCount: rows.filter((ticket) => ticket.priority === 'urgent' && ticket.status !== 'resolved').length,
      lastUpdate: rows[0]?.lastUpdate ?? 'No requests',
    };
  });
  const selectedSupportCompany = supportCompanyRows.find((row) => row.company.id === selectedSupportCompanyId) ?? supportCompanyRows[0];
  const selectedCompanyTickets = selectedSupportCompany?.tickets ?? [];
  const activeSupportTicket = selectedTicket && selectedTicket['companyId'] === selectedSupportCompany?.company.id ? selectedTicket : selectedCompanyTickets[0];
  function openSupportCompany(companyId: string) {
    setSelectedSupportCompanyId(companyId);
    const firstTicket = tickets.find((ticket) => ticket.companyId === companyId);
    if (firstTicket) onSelectTicket(firstTicket.id);
  }`,
  );
}
const guideStart = owner.indexOf('        <aside className="support-owner-guide">');
const guideEnd = owner.indexOf('\n\n        <div className="ticket-workspace">', guideStart);
if (guideStart !== -1 && guideEnd !== -1 && !owner.includes('support-company-sidebar')) {
  const sidebar = `        <aside className="support-company-sidebar">
          <div className="support-company-heading">
            <div>
              <p className="eyebrow">Support by company</p>
              <h3>Company windows</h3>
              <p>Each company has its own support window. New requests show a red badge.</p>
            </div>
            <span className="support-total-badge">{tickets.filter((ticket) => ticket.status === 'new').length}</span>
          </div>
          <div className="support-company-list">
            {supportCompanyRows.map((row) => (
              <button className={\`support-company-card \${row.company.id === selectedSupportCompany?.company.id ? 'active' : ''}\`} type="button" key={row.company.id} onClick={() => openSupportCompany(row.company.id)}>
                <span className="company-avatar small-avatar">{row.company.name.slice(0, 2).toUpperCase()}</span>
                <span><strong>{row.company.name}</strong><small>{row.openCount} open · {row.lastUpdate}</small></span>
                {row.newCount ? <b>{row.newCount}</b> : null}
                {row.urgentCount ? <em>{row.urgentCount} urgent</em> : null}
              </button>
            ))}
          </div>
        </aside>`;
  owner = owner.slice(0, guideStart) + sidebar + owner.slice(guideEnd);
}
owner = owner.replace('            {tickets.map((ticket) => (', '            {selectedCompanyTickets.map((ticket) => (');
write(ownerPath, owner);

let css = read(cssPath);
if (!css.includes('Company support workspaces and badges')) {
  css += `

/* Company support workspaces and badges */
.nav-badge,.support-total-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;border-radius:999px;background:#ef4444;color:#fff;padding:0 6px;font-size:11px;font-weight:900;line-height:1}.nav-badge{margin-left:auto}.support-total-badge{min-width:26px;height:26px;font-size:12px}.support-company-sidebar{display:grid;align-content:start;gap:12px;border:1px solid #dfe7e1;border-radius:12px;background:#fbfdfb;padding:16px}.support-company-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.support-company-heading h3,.support-company-heading p{margin:0}.support-company-heading p{color:#526157;font-size:13px;font-weight:800;line-height:1.4}.support-company-list{display:grid;gap:8px}.support-company-card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;width:100%;border:1px solid #dfe7e1;border-radius:10px;background:#fff;padding:10px;color:#17201b;text-align:left;cursor:pointer}.support-company-card.active{border-color:#9ac06f;background:#f7fbec;box-shadow:0 10px 22px rgba(35,74,35,.08)}.support-company-card span:not(.company-avatar){display:grid;min-width:0}.support-company-card small{color:#647067;font-size:11px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.support-company-card b{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:999px;background:#ef4444;color:#fff;padding:0 7px;font-size:11px;font-weight:900}.support-company-card em{grid-column:2/-1;justify-self:start;border-radius:999px;background:#fff1f2;color:#b91c1c;padding:3px 8px;font-size:11px;font-style:normal;font-weight:900}.small-avatar{width:38px;height:38px}
`;
  write(cssPath, css);
}
console.log('Company support workspaces and badges patch applied.');
