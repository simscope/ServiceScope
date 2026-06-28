const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const supportStorePath = path.join(root, 'src/services/supportStore.ts');
const portalPath = path.join(root, 'src/CompanyPortal.tsx');
const appPath = path.join(root, 'src/App.tsx');
const cssPath = path.join(root, 'src/styles/responsive.css');

function read(filePath) { return fs.readFileSync(filePath, 'utf8'); }
function write(filePath, content) { fs.writeFileSync(filePath, content); }

const supportStoreSource = `import type { Company, NewSupportTicketForm, SupportTicket, SupportTicketStatus } from '../types';

const SUPPORT_STORAGE_KEY = 'servicescope.supportTickets';

function supportTimestamp(date = new Date()) {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeTimestamp(value?: string) {
  if (!value || value === 'Just now') return supportTimestamp();
  return value;
}

function readStoredTickets() {
  if (typeof window === 'undefined') return [] as SupportTicket[];

  const saved = window.localStorage.getItem(SUPPORT_STORAGE_KEY);
  if (!saved) return [] as SupportTicket[];

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed as SupportTicket[] : [];
  } catch {
    return [] as SupportTicket[];
  }
}

function normalizeTicket(ticket: Partial<SupportTicket>, companies: Company[]): SupportTicket {
  const company = companies.find((candidate) => candidate.id === ticket.companyId) ?? companies[0];
  const timestamp = normalizeTimestamp(ticket.createdAt);

  return {
    id: ticket.id ?? crypto.randomUUID(),
    companyId: ticket.companyId ?? company?.id ?? '',
    companyName: ticket.companyName ?? company?.name ?? 'Unknown company',
    authorName: ticket.authorName ?? company?.ownerName ?? 'Customer',
    authorEmail: ticket.authorEmail ?? company?.ownerEmail ?? '',
    kind: ticket.kind ?? 'question',
    priority: ticket.priority ?? 'normal',
    status: ticket.status ?? 'new',
    subject: ticket.subject ?? 'Support request',
    message: ticket.message ?? '',
    createdAt: timestamp,
    lastUpdate: normalizeTimestamp(ticket.lastUpdate ?? timestamp),
    messages: ticket.messages?.length ? ticket.messages.map((message) => ({ ...message, createdAt: normalizeTimestamp(message.createdAt) })) : [
      {
        id: crypto.randomUUID(),
        author: 'company',
        authorName: ticket.authorName ?? company?.ownerName ?? 'Customer',
        body: ticket.message ?? '',
        createdAt: timestamp,
      },
    ],
  };
}

export function listSupportTickets(companies: Company[]): SupportTicket[] {
  return readStoredTickets().map((ticket) => normalizeTicket(ticket, companies));
}

export function saveSupportTickets(tickets: SupportTicket[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SUPPORT_STORAGE_KEY, JSON.stringify(tickets));
}

export function createSupportTicket(form: NewSupportTicketForm, companies: Company[]): SupportTicket {
  const company = companies.find((candidate) => candidate.id === form.companyId);
  const createdAt = supportTimestamp();

  return {
    id: crypto.randomUUID(),
    ...form,
    companyName: company?.name ?? 'Unknown company',
    status: 'new',
    createdAt,
    lastUpdate: createdAt,
    messages: [
      {
        id: crypto.randomUUID(),
        author: 'company',
        authorName: form.authorName,
        body: form.message,
        createdAt,
      },
    ],
  };
}

export function updateSupportTicketStatus(ticket: SupportTicket, status: SupportTicketStatus): SupportTicket {
  const updatedAt = supportTimestamp();

  return {
    ...ticket,
    status,
    lastUpdate: updatedAt,
  };
}

export function addOwnerReply(ticket: SupportTicket, body: string): SupportTicket {
  const createdAt = supportTimestamp();

  return {
    ...ticket,
    status: ticket.status === 'new' ? 'reviewing' : ticket.status,
    lastUpdate: createdAt,
    messages: [
      ...ticket.messages,
      {
        id: crypto.randomUUID(),
        author: 'owner',
        authorName: 'ServiceScope Support',
        body,
        createdAt,
      },
    ],
  };
}

export function addCompanyReply(ticket: SupportTicket, body: string, authorName: string): SupportTicket {
  const createdAt = supportTimestamp();

  return {
    ...ticket,
    status: ticket.status === 'resolved' ? 'reviewing' : ticket.status,
    lastUpdate: createdAt,
    messages: [
      ...ticket.messages,
      {
        id: crypto.randomUUID(),
        author: 'company',
        authorName: authorName || ticket.authorName || 'Customer',
        body,
        createdAt,
      },
    ],
  };
}
`;
write(supportStorePath, supportStoreSource);

let app = read(appPath);
if (!app.includes('addCompanyReply')) {
  app = app.replace(
    "  addOwnerReply,\n  createSupportTicket,",
    "  addOwnerReply,\n  addCompanyReply,\n  createSupportTicket,",
  );
}
if (!app.includes('function createPortalReply')) {
  app = app.replace(
    "  if (!authSession) {",
    `  function createPortalReply(ticketId: string, body: string) {
    const text = body.trim();
    if (!text || !selectedCompany) return;

    const nextTickets = supportTickets.map((ticket) =>
      ticket.id === ticketId && ticket.companyId === selectedCompany.id
        ? addCompanyReply(ticket, text, authSession?.name || selectedCompany.ownerName)
        : ticket,
    );
    setSupportTickets(nextTickets);
    saveSupportTickets(nextTickets);
    setSelectedTicketId(ticketId);
    recordAudit({
      category: 'support',
      action: 'support.customer_reply_sent',
      actor: authSession?.name || selectedCompany.ownerName,
      resource: selectedCompany.name,
      details: 'Customer reply sent from company portal.',
    });
  }

  if (!authSession) {`,
  );
}
if (!app.includes('onReplyToTicket={createPortalReply}')) {
  app = app.replace(
    "          onCreateRequest={createPortalRequest}\n        />",
    "          onCreateRequest={createPortalRequest}\n          onReplyToTicket={createPortalReply}\n        />",
  );
}
write(appPath, app);

let portal = read(portalPath);
if (!portal.includes('onReplyToTicket,')) {
  portal = portal.replace(
    "  onCreateRequest,\n}: {",
    "  onCreateRequest,\n  onReplyToTicket,\n}: {",
  );
  portal = portal.replace(
    "  onCreateRequest: (request: Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>) => void;\n}) {",
    "  onCreateRequest: (request: Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>) => void;\n  onReplyToTicket?: (ticketId: string, body: string) => void;\n}) {",
  );
}
if (!portal.includes('supportReplyDrafts')) {
  portal = portal.replace(
    "  const [request, setRequest] = useState<Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>>({\n    kind: 'change',\n    priority: 'normal',\n    subject: '',\n    message: '',\n  });",
    "  const [request, setRequest] = useState<Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>>({\n    kind: 'change',\n    priority: 'normal',\n    subject: '',\n    message: '',\n  });\n  const [supportReplyDrafts, setSupportReplyDrafts] = useState<Record<string, string>>({});",
  );
}
if (!portal.includes('function handleSupportReply')) {
  portal = portal.replace(
    "  function updateProfile(updates: Partial<CompanyOnboardingProfile>) {",
    `  function handleSupportReply(event: FormEvent<HTMLFormElement>, ticketId: string) {
    event.preventDefault();
    const body = supportReplyDrafts[ticketId]?.trim() ?? '';
    if (!body || !onReplyToTicket) return;

    onReplyToTicket(ticketId, body);
    setSupportReplyDrafts((drafts) => ({ ...drafts, [ticketId]: '' }));
  }

  function updateProfile(updates: Partial<CompanyOnboardingProfile>) {`,
  );
}
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
                      {onReplyToTicket ? (
                        <form className="portal-ticket-reply-form" onSubmit={(event) => handleSupportReply(event, ticket.id)}>
                          <label>
                            Continue this conversation
                            <textarea
                              value={supportReplyDrafts[ticket.id] ?? ''}
                              onChange={(event) => setSupportReplyDrafts((drafts) => ({ ...drafts, [ticket.id]: event.target.value }))}
                              placeholder="Write a reply for this support request..."
                              rows={3}
                            />
                          </label>
                          <button className="secondary-button compact" type="submit" disabled={!supportReplyDrafts[ticket.id]?.trim()}>
                            Send reply
                          </button>
                        </form>
                      ) : null}
                    </article>
                  ))}`;
if (portal.includes(oldBlock)) {
  portal = portal.replace(oldBlock, newBlock);
} else if (portal.includes('portal-ticket-thread') && !portal.includes('portal-ticket-reply-form')) {
  portal = portal.replace(
    "                      </div>\n                    </article>",
    "                      </div>\n                      {onReplyToTicket ? (\n                        <form className=\"portal-ticket-reply-form\" onSubmit={(event) => handleSupportReply(event, ticket.id)}>\n                          <label>\n                            Continue this conversation\n                            <textarea\n                              value={supportReplyDrafts[ticket.id] ?? ''}\n                              onChange={(event) => setSupportReplyDrafts((drafts) => ({ ...drafts, [ticket.id]: event.target.value }))}\n                              placeholder=\"Write a reply for this support request...\"\n                              rows={3}\n                            />\n                          </label>\n                          <button className=\"secondary-button compact\" type=\"submit\" disabled={!supportReplyDrafts[ticket.id]?.trim()}>\n                            Send reply\n                          </button>\n                        </form>\n                      ) : null}\n                    </article>",
  );
}
write(portalPath, portal);

let css = read(cssPath);
if (!css.includes('Portal support thread history')) {
  css += `

/* Portal support thread history */
.portal-ticket-thread{display:grid;gap:12px}.portal-ticket-thread-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.portal-ticket-messages{display:grid;gap:8px;border-top:1px solid #e5ece7;padding-top:10px}.portal-ticket-message{border:1px solid #dfe7e1;border-radius:10px;background:#fff;padding:10px}.portal-ticket-message.owner{background:#eef4ff;border-color:#cfe0ff}.portal-ticket-message>div{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}.portal-ticket-message span{color:#647067;font-size:12px;font-weight:800}.portal-ticket-message p{margin:0;color:#17201b;white-space:pre-wrap}
`;
}
if (!css.includes('portal-ticket-reply-form')) {
  css += `
.portal-ticket-reply-form{display:grid;gap:8px;border-top:1px solid #e5ece7;padding-top:10px}.portal-ticket-reply-form label{display:grid;gap:6px;font-weight:900}.portal-ticket-reply-form textarea{width:100%;min-height:76px;resize:vertical}.portal-ticket-reply-form button{justify-self:start}
`;
}
write(cssPath, css);

console.log('Support history replies, customer replies, and timestamps patch applied.');
