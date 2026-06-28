const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const supportStorePath = path.join(root, 'src/services/supportStore.ts');
const portalPath = path.join(root, 'src/CompanyPortal.tsx');
const appPath = path.join(root, 'src/App.tsx');
const cssPath = path.join(root, 'src/styles/responsive.css');

function read(filePath) { return fs.readFileSync(filePath, 'utf8'); }
function write(filePath, content) { fs.writeFileSync(filePath, content); }

let store = read(supportStorePath);
if (!store.includes('function supportTimestamp')) {
  store = store.replace(
    "const SUPPORT_STORAGE_KEY = 'servicescope.supportTickets';",
    `const SUPPORT_STORAGE_KEY = 'servicescope.supportTickets';

function supportTimestamp(date = new Date()) {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}`,
  );
  store = store.replace("createdAt: ticket.createdAt ?? new Date().toLocaleDateString('en-US')", "createdAt: ticket.createdAt ?? supportTimestamp()");
  store = store.replace("lastUpdate: ticket.lastUpdate ?? 'Just now'", "lastUpdate: ticket.lastUpdate ?? ticket.createdAt ?? supportTimestamp()");
  store = store.replace("createdAt: ticket.createdAt ?? 'Just now'", "createdAt: ticket.createdAt ?? supportTimestamp()");
  store = store.replace("const createdAt = new Date().toLocaleDateString('en-US');", "const createdAt = supportTimestamp();");
  store = store.replace("createdAt: 'Just now'", "createdAt");
  store = store.replace("lastUpdate: 'Just now'", "lastUpdate: supportTimestamp()");
  store = store.replace(
    "export function addOwnerReply(ticket: SupportTicket, body: string): SupportTicket {\n  return {",
    "export function addOwnerReply(ticket: SupportTicket, body: string): SupportTicket {\n  const createdAt = supportTimestamp();\n\n  return {",
  );
  store = store.replace("lastUpdate: supportTimestamp()", "lastUpdate: createdAt");
  store = store.replace("createdAt: 'Just now'", "createdAt");
  write(supportStorePath, store);
}

let app = read(appPath);
if (!app.includes('syncSupportTicketsFromStorage')) {
  app = app.replace(
    "  useEffect(() => {\n    if (!authSession) return;",
    `  useEffect(() => {
    function syncSupportTicketsFromStorage() {
      setSupportTickets(listSupportTickets(companies));
    }

    window.addEventListener('storage', syncSupportTicketsFromStorage);
    window.addEventListener('focus', syncSupportTicketsFromStorage);

    return () => {
      window.removeEventListener('storage', syncSupportTicketsFromStorage);
      window.removeEventListener('focus', syncSupportTicketsFromStorage);
    };
  }, [companies]);

  useEffect(() => {
    if (!authSession) return;`,
  );
  write(appPath, app);
}

let portal = read(portalPath);
const oldBlock = `                  {tickets.slice(0, 4).map((ticket) => (
                    <article className="portal-ticket-row" key={ticket.id}>
                      <div>
                        <span className={\`ticket-kind \${ticket.kind}\`}>{ticketKindLabels[ticket.kind]}</span>
                        <h3>{ticket.subject}</h3>
                        <p>{ticket.lastUpdate}</p>
                      </div>
                      <strong>{ticketStatusLabels[ticket.status]}</strong>
                    </article>
                  ))}`;
const newBlock = `                  {tickets.slice(0, 4).map((ticket) => (
                    <article className="portal-ticket-row portal-ticket-thread" key={ticket.id}>
                      <div className="portal-ticket-thread-header">
                        <div>
                          <span className={\`ticket-kind \${ticket.kind}\`}>{ticketKindLabels[ticket.kind]}</span>
                          <h3>{ticket.subject}</h3>
                          <p>Last update: {ticket.lastUpdate}</p>
                        </div>
                        <strong>{ticketStatusLabels[ticket.status]}</strong>
                      </div>
                      <div className="portal-ticket-messages">
                        {ticket.messages.map((message) => (
                          <div className={\`portal-ticket-message \${message.author}\`} key={message.id}>
                            <div>
                              <strong>{message.author === 'owner' ? 'ServiceScope support' : message.authorName}</strong>
                              <span>{message.createdAt}</span>
                            </div>
                            <p>{message.body}</p>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}`;
if (portal.includes(oldBlock)) {
  portal = portal.replace(oldBlock, newBlock);
  write(portalPath, portal);
}

let css = read(cssPath);
if (!css.includes('Portal support thread history')) {
  css += `

/* Portal support thread history */
.portal-ticket-thread{display:grid;gap:12px}.portal-ticket-thread-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.portal-ticket-messages{display:grid;gap:8px;border-top:1px solid #e5ece7;padding-top:10px}.portal-ticket-message{border:1px solid #dfe7e1;border-radius:10px;background:#fff;padding:10px}.portal-ticket-message.owner{background:#eef4ff;border-color:#cfe0ff}.portal-ticket-message>div{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}.portal-ticket-message span{color:#647067;font-size:12px;font-weight:800}.portal-ticket-message p{margin:0;color:#17201b;white-space:pre-wrap}
`;
  write(cssPath, css);
}

console.log('Support history replies and timestamps patch applied.');
