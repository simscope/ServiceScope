const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const companyPortalPath = path.join(root, 'src/CompanyPortal.tsx');
const appPath = path.join(root, 'src/App.tsx');
const cssPath = path.join(root, 'src/styles/responsive.css');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content);
}

function replaceOnce(content, before, after, marker) {
  if (content.includes(marker)) return content;
  if (!content.includes(before)) return content;
  return content.replace(before, after);
}

let app = read(appPath);
app = app.replace('        setSupportTickets([]);', '        setSupportTickets(listSupportTickets(backendCompanies));');
write(appPath, app);

let portal = read(companyPortalPath);

portal = replaceOnce(
  portal,
  `  const [request, setRequest] = useState<Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>>({
    kind: 'change',
    priority: 'normal',
    subject: '',
    message: '',
  });`,
  `  const [request, setRequest] = useState<Pick<NewSupportTicketForm, 'kind' | 'priority' | 'subject' | 'message'>>({
    kind: 'change',
    priority: 'normal',
    subject: '',
    message: '',
  });
  const [requestTouched, setRequestTouched] = useState(false);
  const [requestStatus, setRequestStatus] = useState('');`,
  'const [requestStatus, setRequestStatus] = useState',
);

portal = replaceOnce(
  portal,
  `  const currentPortalUser = {
    name: signedInUser?.name ?? selectedCompany.ownerName,
    role: signedInUser?.role ?? 'Admin' as const,
  };`,
  `  const currentPortalUser = {
    name: signedInUser?.name ?? selectedCompany.ownerName,
    email: signedInUser?.email ?? selectedCompany.ownerEmail,
    role: signedInUser?.role ?? 'Admin' as const,
  };
  const isAdminViewingPortal = currentPortalUser.role === 'Admin';
  const isBillingOverdue = selectedCompany.billingStatus === 'overdue';
  const portalRestrictionRows = isBillingOverdue
    ? [
      ['New job creation', 'Limited'],
      ['Invoice / estimate sending', 'Blocked'],
      ['Email sending', 'Blocked'],
      ['Reports / exports', 'Blocked'],
      ['Support requests', 'Available'],
    ]
    : selectedCompany.billingStatus === 'not_started'
      ? [
        ['Live jobs', 'Limited'],
        ['Customer invoices', 'Blocked'],
        ['Email sending', 'Blocked'],
        ['Support requests', 'Available'],
      ]
      : [
        ['Portal access', 'Full'],
        ['Support requests', 'Available'],
      ];`,
  'const portalRestrictionRows = isBillingOverdue',
);

portal = replaceOnce(
  portal,
  `    { page: 'portal', label: 'Portal', icon: <Rocket size={16} /> },
  ];`,
  `    { page: 'portal', label: 'Portal', icon: <Rocket size={16} /> },
  ];
  const visibleClientNavItems = isAdminViewingPortal
    ? clientNavItems
    : clientNavItems.filter((item) => ['portal', 'jobs', 'allJobs', 'calendar', 'map'].includes(item.page));`,
  'const visibleClientNavItems = isAdminViewingPortal',
);

portal = portal.replace('              {clientNavItems.map((item) => (', '              {visibleClientNavItems.map((item) => (');
portal = portal.replace("{clientNavItems.find((item) => item.page === clientPage)?.icon}", "{visibleClientNavItems.find((item) => item.page === clientPage)?.icon}");
portal = portal.replace("{clientNavItems.find((item) => item.page === clientPage)?.label}", "{visibleClientNavItems.find((item) => item.page === clientPage)?.label}");

portal = replaceOnce(
  portal,
  `  function handleRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request.subject.trim() || !request.message.trim()) return;

    onCreateRequest(request);
    setRequest({
      kind: 'change',
      priority: 'normal',
      subject: '',
      message: '',
    });
  }`,
  `  function handleRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestTouched(true);

    if (!request.subject.trim() || !request.message.trim()) {
      setRequestStatus('Subject and message are required.');
      return;
    }

    onCreateRequest({
      ...request,
      subject: request.subject.trim(),
      message: request.message.trim(),
    });
    setRequest({
      kind: 'change',
      priority: 'normal',
      subject: '',
      message: '',
    });
    setRequestTouched(false);
    setRequestStatus('Request sent. It is now visible in Recent Communication and Owner Support.');
  }`,
  "setRequestStatus('Request sent.",
);

portal = replaceOnce(
  portal,
  `        <div className="client-user">
          <span>ADMIN</span>
          <strong>{selectedCompany.ownerName.slice(0, 1).toUpperCase()}</strong>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>`,
  `        <div className="client-user portal-viewer-badge">
          <span>{isAdminViewingPortal ? 'Viewing as Admin' : currentPortalUser.role}</span>
          <strong>{currentPortalUser.name.slice(0, 1).toUpperCase()}</strong>
          <small>{currentPortalUser.name} · {currentPortalUser.email}</small>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>`,
  'portal-viewer-badge',
);

portal = replaceOnce(
  portal,
  `             </div>

             <section className="portal-metrics">`,
  `             </div>

             {isBillingOverdue || selectedCompany.billingStatus === 'not_started' ? (
               <section className="portal-alert-panel">
                 <div>
                   <p className="eyebrow">Billing access</p>
                   <h2>{isBillingOverdue ? 'Payment overdue' : 'Subscription setup required'}</h2>
                   <p>{isBillingOverdue ? 'Some functions should stay limited until payment is restored.' : 'Finish billing setup before live customer functions are fully available.'}</p>
                 </div>
                 <button className="secondary-button compact" type="button" onClick={() => setClientPage('onboarding')}>
                   Open billing setup
                 </button>
               </section>
             ) : null}

             <section className="portal-metrics">`,
  'portal-alert-panel',
);

portal = replaceOnce(
  portal,
  `             <div className="portal-grid">
               <section className="panel portal-support-panel">`,
  `             <div className="portal-grid">
               <section className="panel portal-restrictions-panel">
                 <div className="panel-heading">
                   <div>
                     <p className="eyebrow">Access limits</p>
                     <h2>Current restrictions</h2>
                   </div>
                   <AlertTriangle size={20} aria-hidden="true" />
                 </div>
                 <div className="portal-restriction-list">
                   {portalRestrictionRows.map(([label, value]) => (
                     <div key={label}>
                       <span>{label}</span>
                       <strong>{value}</strong>
                     </div>
                   ))}
                 </div>
               </section>

               <section className="panel portal-account-panel">
                 <div className="panel-heading">
                   <div>
                     <p className="eyebrow">Account</p>
                     <h2>Company details</h2>
                   </div>
                   <Building2 size={20} aria-hidden="true" />
                 </div>
                 <dl className="portal-account-list">
                   <div><dt>Owner</dt><dd>{selectedCompany.ownerName}</dd></div>
                   <div><dt>Email</dt><dd>{selectedCompany.ownerEmail}</dd></div>
                   <div><dt>Plan</dt><dd>{selectedCompany.plan}</dd></div>
                   <div><dt>Status</dt><dd>{billingLabels[selectedCompany.billingStatus]}</dd></div>
                   <div><dt>Technicians</dt><dd>{selectedCompany.technicians}</dd></div>
                   <div><dt>Storage</dt><dd>{selectedCompany.usage.storageGb} GB</dd></div>
                 </dl>
               </section>

               <section className="panel portal-support-panel">`,
  'portal-restrictions-panel',
);

portal = portal.replace(
  '<input value={request.subject} onChange={(event) => setRequest({ ...request, subject: event.target.value })} placeholder="What should be fixed or changed?" />',
  '<input className={requestTouched && !request.subject.trim() ? \'field-error\' : undefined} value={request.subject} onChange={(event) => setRequest({ ...request, subject: event.target.value })} placeholder="What should be fixed or changed?" />',
);
portal = portal.replace(
  '<textarea value={request.message} onChange={(event) => setRequest({ ...request, message: event.target.value })} placeholder="Describe the issue, request, or missing detail." />',
  '<textarea className={requestTouched && !request.message.trim() ? \'field-error\' : undefined} value={request.message} onChange={(event) => setRequest({ ...request, message: event.target.value })} placeholder="Describe the issue, request, or missing detail." />',
);
portal = portal.replace(
  `                   <button className="primary-button" type="submit">\n                     <MailPlus size={18} aria-hidden="true" />\n                     Send request\n                   </button>`,
  `                   {requestStatus ? <p className="access-status portal-request-status">{requestStatus}</p> : null}\n                   <button className="primary-button" type="submit">\n                     <MailPlus size={18} aria-hidden="true" />\n                     Send request\n                   </button>`,
);

write(companyPortalPath, portal);

let css = read(cssPath);
if (!css.includes('Company portal dashboard QA fixes')) {
  css += `

/* Company portal dashboard QA fixes */
.portal-viewer-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.portal-viewer-badge small {
  color: #dce6ef;
  font-size: 11px;
  font-weight: 800;
}

.portal-alert-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin: 14px 0;
  border: 1px solid #f2c779;
  border-radius: 12px;
  background: #fff7e8;
  padding: 16px;
}

.portal-alert-panel h2,
.portal-alert-panel p {
  margin: 0;
}

.portal-alert-panel p {
  color: #6b5a30;
  font-weight: 800;
}

.portal-restriction-list,
.portal-account-list {
  display: grid;
  gap: 8px;
  margin: 0;
}

.portal-restriction-list div,
.portal-account-list div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid #e2e8e4;
  border-radius: 9px;
  background: #fbfdfb;
  padding: 9px 10px;
}

.portal-account-list dt,
.portal-restriction-list span {
  color: #667269;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
}

.portal-account-list dd,
.portal-restriction-list strong {
  margin: 0;
  color: #17201b;
  font-size: 13px;
  font-weight: 900;
  text-align: right;
}

.portal-request-form .field-error {
  border-color: #dc2626;
  background: #fff1f2;
  box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.13);
}

.portal-request-status {
  margin: 0;
}

@media (max-width: 900px) {
  .portal-alert-panel {
    align-items: flex-start;
    flex-direction: column;
  }

  .portal-viewer-badge small {
    display: none;
  }
}
`;
  write(cssPath, css);
}

console.log('Company portal dashboard UX patch applied.');
