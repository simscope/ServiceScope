const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ownerPagesPath = path.join(root, 'src/components/OwnerPages.tsx');
const companyPortalPath = path.join(root, 'src/CompanyPortal.tsx');
const cssPath = path.join(root, 'src/styles/responsive.css');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content);
}

let portalContent = read(companyPortalPath);
portalContent = portalContent
  .split('new Map(payrollItems.map').join('new globalThis.Map(payrollItems.map')
  .split('new Map(currentRows.map').join('new globalThis.Map(currentRows.map');
write(companyPortalPath, portalContent);

let content = read(ownerPagesPath);

if (!content.includes('support-owner-guide')) {
  const formStart = content.indexOf('        <form className="support-form" onSubmit={onSubmit}>');
  const ticketWorkspaceStart = content.indexOf('        <div className="ticket-workspace">', formStart);

  if (formStart !== -1 && ticketWorkspaceStart !== -1) {
    const replacement = `        <aside className="support-owner-guide">
          <div>
            <p className="eyebrow">Owner support</p>
            <h3>Customer requests</h3>
            <p>Bug, change, and question tickets are created from the company portal. The owner/developer answers them from the thread on the right.</p>
          </div>
          <dl>
            <div>
              <dt>Total tickets</dt>
              <dd>{tickets.length}</dd>
            </div>
            <div>
              <dt>Open</dt>
              <dd>{tickets.filter((ticket) => ticket.status !== 'resolved').length}</dd>
            </div>
            <div>
              <dt>Urgent</dt>
              <dd>{tickets.filter((ticket) => ticket.priority === 'urgent').length}</dd>
            </div>
            <div>
              <dt>Selected</dt>
              <dd>{selectedTicket ? ticketStatusLabels[selectedTicket.status] : 'None'}</dd>
            </div>
          </dl>
          <div className="support-owner-note">
            <strong>How it works</strong>
            <span>Client sends request → it appears here → developer replies → client sees the answer in Recent Communication.</span>
          </div>
        </aside>

`;
    content = content.slice(0, formStart) + replacement + content.slice(ticketWorkspaceStart);
  }
}

write(ownerPagesPath, content);

let css = read(cssPath);
if (!css.includes('Owner support inbox QA fixes')) {
  css += `

/* Owner support inbox QA fixes */
.support-owner-guide {
  display: grid;
  align-content: start;
  gap: 14px;
  border: 1px solid #dfe7e1;
  border-radius: 12px;
  background: #fbfdfb;
  padding: 16px;
}

.support-owner-guide h3,
.support-owner-guide p {
  margin: 0;
}

.support-owner-guide p {
  color: #526157;
  font-size: 13px;
  font-weight: 800;
  line-height: 1.45;
}

.support-owner-guide dl {
  display: grid;
  gap: 8px;
  margin: 0;
}

.support-owner-guide dl div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid #e2e8e4;
  border-radius: 9px;
  background: #ffffff;
  padding: 9px 10px;
}

.support-owner-guide dt {
  color: #667269;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.support-owner-guide dd {
  margin: 0;
  color: #17201b;
  font-size: 14px;
  font-weight: 900;
}

.support-owner-note {
  display: grid;
  gap: 4px;
  border-radius: 10px;
  background: #eef6ff;
  color: #1e3a8a;
  padding: 12px;
}

.support-owner-note span {
  color: #475569;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.4;
}
`;
  write(cssPath, css);
}

console.log('Owner support inbox UX patch applied.');
