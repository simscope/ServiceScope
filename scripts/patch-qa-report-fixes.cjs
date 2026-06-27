const fs = require('fs');
const path = require('path');

function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) {
    console.warn('QA patch skipped: ' + label);
    return content;
  }
  return content.replace(search, replacement);
}

function patchAppLoginAndTenantLoading() {
  const appFile = path.resolve(__dirname, '../src/App.tsx');
  let content = fs.readFileSync(appFile, 'utf8');

  content = replaceOnce(
    content,
    "    const normalizedEmail = email.trim().toLowerCase();\n    if (!normalizedEmail || !password.trim()) {\n      setError('Enter your email and password.');\n      return;\n    }",
    "    const normalizedEmail = email.trim().toLowerCase();\n    if (!normalizedEmail) {\n      setError('Email is required.');\n      return;\n    }\n\n    if (!password.trim()) {\n      setError('Password is required.');\n      return;\n    }",
    'login field validation'
  );

  content = replaceOnce(
    content,
    "  if (authSession.kind === 'company') {\n    return (\n      <main className=\"company-shell\">",
    "  if (authSession.kind === 'company') {\n    if ((backendLoading || !backendLoaded) && !selectedCompany) {\n      return (\n        <main className=\"company-shell\">\n          <div className=\"backend-status\">Loading company workspace...</div>\n        </main>\n      );\n    }\n\n    if (backendError && !selectedCompany) {\n      return (\n        <main className=\"company-shell\">\n          <div className=\"backend-status error\">Could not load company workspace. Please refresh or sign in again.</div>\n        </main>\n      );\n    }\n\n    return (\n      <main className=\"company-shell\">",
    'company portal loading guard'
  );

  fs.writeFileSync(appFile, content);
}

function patchMapPage() {
  const mapFile = path.resolve(__dirname, '../src/components/portal/MapPage.tsx');
  let content = fs.readFileSync(mapFile, 'utf8');

  content = replaceOnce(
    content,
    "function parseCoordinate(value: string) {\n  const coordinate = Number(value.trim());\n  return Number.isFinite(coordinate) ? coordinate : null;\n}",
    "function parseCoordinate(value: string, axis: 'lat' | 'lng') {\n  const trimmed = value.trim();\n  if (!trimmed) return null;\n\n  const coordinate = Number(trimmed);\n  if (!Number.isFinite(coordinate)) return null;\n  if (axis === 'lat' && (coordinate < -90 || coordinate > 90)) return null;\n  if (axis === 'lng' && (coordinate < -180 || coordinate > 180)) return null;\n\n  return coordinate;\n}\n\nfunction hasUsableMapCoordinates(latNumber: number | null, lngNumber: number | null) {\n  if (latNumber === null || lngNumber === null) return false;\n  if (latNumber === 0 && lngNumber === 0) return false;\n  return true;\n}",
    'map coordinate parser'
  );

  content = replaceOnce(
    content,
    "      const latNumber = parseCoordinate(technician.lat);\n      const lngNumber = parseCoordinate(technician.lng);\n\n      if (latNumber === null || lngNumber === null) return [];\n      return [{ ...technician, latNumber, lngNumber }];",
    "      const latNumber = parseCoordinate(technician.lat, 'lat');\n      const lngNumber = parseCoordinate(technician.lng, 'lng');\n\n      if (!hasUsableMapCoordinates(latNumber, lngNumber)) return [];\n      return [{ ...technician, latNumber, lngNumber }];",
    'map point filtering'
  );

  content = replaceOnce(
    content,
    "             <strong>{filteredTechnicianLocations.length}</strong>\n             Visible techs",
    "             <strong>{mapPoints.length}</strong>\n             On map",
    'map counter'
  );

  content = replaceOnce(
    content,
    "               No GPS coordinates yet. The map will show markers as soon as technician GPS data appears.",
    "               No valid GPS coordinates yet. Technicians without GPS stay in the list, but the map stays centered on the service area.",
    'map empty copy'
  );

  fs.writeFileSync(mapFile, content);
}

function patchPortalCountersAndMailbox() {
  const portalFile = path.resolve(__dirname, '../src/CompanyPortal.tsx');
  let content = fs.readFileSync(portalFile, 'utf8');

  content = replaceOnce(
    content,
    '<MetricCard icon={<ClipboardList size={20} />} label="Jobs" value={selectedCompany.usage.jobsThisMonth.toString()} detail="This month" />',
    '<MetricCard icon={<ClipboardList size={20} />} label="Active jobs" value={activeJobsRows.length.toString()} detail="Unpaid / open board" />',
    'portal jobs KPI'
  );

  content = replaceOnce(
    content,
    "  const [emailConnection, setEmailConnection] = useState<EmailConnection | null>(null);\n  const [mailboxConnectStatus, setMailboxConnectStatus] = useState('');",
    "  const [emailConnection, setEmailConnection] = useState<EmailConnection | null>(null);\n  const [mailboxLoading, setMailboxLoading] = useState(false);\n  const [mailboxConnectStatus, setMailboxConnectStatus] = useState('');",
    'mailbox loading state'
  );

  content = replaceOnce(
    content,
    "    if (!selectedCompany) {\n      setEmailConnection(null);\n      setMailboxOAuthSecretDraft('');\n      setMailboxOAuthStatus('');\n      return undefined;\n    }",
    "    if (!selectedCompany) {\n      setEmailConnection(null);\n      setMailboxLoading(false);\n      setMailboxOAuthSecretDraft('');\n      setMailboxOAuthStatus('');\n      return undefined;\n    }",
    'mailbox no tenant loading reset'
  );

  content = replaceOnce(
    content,
    "    const company = selectedCompany;\n    const currentProfile = onboardingProfile ?? createDefaultCompanyOnboardingProfile(company);",
    "    const company = selectedCompany;\n    const currentProfile = onboardingProfile ?? createDefaultCompanyOnboardingProfile(company);\n    setMailboxLoading(true);",
    'mailbox loading start'
  );

  content = replaceOnce(
    content,
    "          setMailboxConnectStatus('');\n          return;",
    "          setMailboxConnectStatus('');\n          setMailboxLoading(false);\n          return;",
    'mailbox loading false empty'
  );

  content = replaceOnce(
    content,
    "        setMailboxConnectStatus(nextConnection.status === 'connected' ? '' : '');\n      } catch (error) {",
    "        setMailboxConnectStatus(nextConnection.status === 'connected' ? '' : '');\n        setMailboxLoading(false);\n      } catch (error) {",
    'mailbox loading false success'
  );

  content = replaceOnce(
    content,
    "        console.error('Failed to load mailbox settings', error);\n        setMailboxOAuthStatus(error instanceof Error ? error.message : 'Mailbox settings could not be loaded.');",
    "        console.error('Failed to load mailbox settings', error);\n        setMailboxLoading(false);\n        setMailboxOAuthStatus('Mailbox settings could not be loaded. Please retry.');",
    'mailbox loading false error'
  );

  content = replaceOnce(
    content,
    "        setMailboxConnectStatus(error instanceof Error ? error.message : 'Mailbox sync failed.');",
    "        console.error('Mailbox sync failed', error);\n        setMailboxConnectStatus(\"Couldn't load emails. Please retry.\");",
    'mailbox sync generic error'
  );

  content = replaceOnce(
    content,
    "      setMailboxConnectStatus(error instanceof Error ? error.message : 'Email send failed.');\n      throw error;",
    "      console.error('Email send failed', error);\n      setMailboxConnectStatus('Email could not be sent. Please check the fields and retry.');\n      throw error;",
    'mailbox send generic error'
  );

  content = replaceOnce(
    content,
    "      setMailboxConnectStatus(error instanceof Error ? error.message : 'Mailbox sync failed.');",
    "      console.error('Mailbox sync failed', error);\n      setMailboxConnectStatus(\"Couldn't load emails. Please retry.\");",
    'load more mailbox generic error'
  );

  content = replaceOnce(
    content,
    "      setMailboxConnectStatus(error instanceof Error ? error.message : 'Mailbox connector failed.');",
    "      console.error('Mailbox connector failed', error);\n      setMailboxConnectStatus('Mailbox connector failed. Please retry.');",
    'mailbox connector generic error'
  );

  content = replaceOnce(
    content,
    "                  <button className=\"primary-button\" type=\"submit\">\n                    <MailPlus size={18} aria-hidden=\"true\" />\n                    Send request\n                  </button>",
    "                  <button className=\"primary-button\" type=\"submit\" disabled={!request.subject.trim() || !request.message.trim()}>\n                    <MailPlus size={18} aria-hidden=\"true\" />\n                    Send request\n                  </button>",
    'portal request disabled'
  );

  content = replaceOnce(
    content,
    "            <EmailPage\n              emailConnection={emailConnection}",
    "            <EmailPage\n              emailConnection={emailConnection}\n              mailboxLoading={mailboxLoading}",
    'email mailbox loading prop'
  );

  fs.writeFileSync(portalFile, content);
}

function patchJobsPage() {
  const jobsFile = path.resolve(__dirname, '../src/components/portal/JobsPages.tsx');
  let content = fs.readFileSync(jobsFile, 'utf8');

  content = replaceOnce(content, '          <input name="organization" placeholder="Organization / Company" />', '          <input name="organization" placeholder="Organization / Company" required />', 'job org required');
  content = replaceOnce(content, '          <input name="issue" placeholder="Describe the issue" />', '          <input name="issue" placeholder="Describe the issue" required />', 'job issue required');
  content = replaceOnce(content, '          <input name="clientName" placeholder="Client name" />', '          <input name="clientName" placeholder="Client name" required />', 'job client required');
  content = replaceOnce(content, '          <input name="phone" placeholder="Phone" />', '          <input name="phone" placeholder="Phone" required />', 'job phone required');
  content = replaceOnce(content, '          <input name="address" placeholder="Address" />', '          <input name="address" placeholder="Address" required />', 'job address required');

  fs.writeFileSync(jobsFile, content);
}

function patchTasksPage() {
  const tasksFile = path.resolve(__dirname, '../src/components/portal/TasksPage.tsx');
  let content = fs.readFileSync(tasksFile, 'utf8');

  content = replaceOnce(
    content,
    '          <input value={taskForm.title} onChange={(event) => onTaskFormChange({ ...taskForm, title: event.target.value })} placeholder="Call customer, order part, send estimate" />',
    '          <input value={taskForm.title} onChange={(event) => onTaskFormChange({ ...taskForm, title: event.target.value })} placeholder="Call customer, order part, send estimate" required />',
    'task title required'
  );

  content = replaceOnce(
    content,
    '        <button className="primary-button" type="submit">\n          <Plus size={16} aria-hidden="true" />\n          Add task\n        </button>',
    '        <button className="primary-button" type="submit" disabled={!taskForm.title.trim()}>\n          <Plus size={16} aria-hidden="true" />\n          Add task\n        </button>',
    'task submit disabled'
  );

  fs.writeFileSync(tasksFile, content);
}

function patchKnowledgePage() {
  const file = path.resolve(__dirname, '../src/components/portal/KnowledgePage.tsx');
  let content = fs.readFileSync(file, 'utf8');

  content = replaceOnce(content, '             <input value={libraryDraft.title} onChange={(event) => onLibraryDraftChange({ ...libraryDraft, title: event.target.value })} placeholder="Service manual, wiring diagram..." />', '             <input value={libraryDraft.title} onChange={(event) => onLibraryDraftChange({ ...libraryDraft, title: event.target.value })} placeholder="Service manual, wiring diagram..." required />', 'library title required');
  content = replaceOnce(content, '               <input value={libraryDraft.system} onChange={(event) => onLibraryDraftChange({ ...libraryDraft, system: event.target.value })} placeholder="HVAC, Appliance..." />', '               <input value={libraryDraft.system} onChange={(event) => onLibraryDraftChange({ ...libraryDraft, system: event.target.value })} placeholder="HVAC, Appliance..." required />', 'library system required');

  content = replaceOnce(
    content,
    '          <button className="primary-button" type="submit">\n            <Plus size={18} aria-hidden="true" />\n            Add to library\n          </button>',
    '          <button className="primary-button" type="submit" disabled={!libraryDraft.title.trim() || !libraryDraft.system.trim()}>\n            <Plus size={18} aria-hidden="true" />\n            Add to library\n          </button>',
    'library button disabled'
  );

  fs.writeFileSync(file, content);
}

function patchEmailPage() {
  const file = path.resolve(__dirname, '../src/components/portal/EmailPage.tsx');
  let content = fs.readFileSync(file, 'utf8');

  content = replaceOnce(content, '  mailboxConnectStatus,\n  emailFolder,', '  mailboxConnectStatus,\n  mailboxLoading,\n  emailFolder,', 'email prop destructure');
  content = replaceOnce(content, '  mailboxConnectStatus: string;\n  emailFolder: EmailFolder;', '  mailboxConnectStatus: string;\n  mailboxLoading: boolean;\n  emailFolder: EmailFolder;', 'email prop type');

  content = replaceOnce(
    content,
    "  const connectionLabel = emailConnection?.status === 'connected' ? 'On' : mailboxReadyToConnect ? 'Ready' : emailConnection ? 'Setup' : 'Off';\n  const connectionDescription = emailConnection\n    ? emailConnection.status === 'connected'\n      ? `${emailProviderLabels[emailConnection.provider]} connected. Last sync: ${emailConnection.lastSync}.`\n      : mailboxReadyToConnect\n        ? `${emailProviderLabels[emailConnection.provider]} credentials are saved. Connect this mailbox to enable sync and sending.`\n        : `${emailProviderLabels[emailConnection.provider]} needs a mailbox email and saved credentials before connection.`\n    : 'Connect the company mailbox in Company onboarding before sending emails.';",
    "  const connectionLabel = mailboxLoading ? 'Loading' : emailConnection?.status === 'connected' ? 'On' : mailboxReadyToConnect ? 'Ready' : emailConnection ? 'Setup' : 'Off';\n  const connectionDescription = mailboxLoading\n    ? 'Checking mailbox connection...'\n    : emailConnection\n      ? emailConnection.status === 'connected'\n        ? `${emailProviderLabels[emailConnection.provider]} connected. Last sync: ${emailConnection.lastSync}.`\n        : mailboxReadyToConnect\n          ? `${emailProviderLabels[emailConnection.provider]} credentials are saved. Connect this mailbox to enable sync and sending.`\n          : `${emailProviderLabels[emailConnection.provider]} needs a mailbox email and saved credentials before connection.`\n      : 'Connect the company mailbox in Company onboarding before sending emails.';\n  const canSendEmail = Boolean(emailConnection?.status === 'connected' && emailCompose.to.trim() && emailCompose.subject.trim() && emailCompose.body.trim());",
    'email loading and can send'
  );

  content = replaceOnce(content, "          <h2>{emailConnection ? emailConnection.address : 'No mailbox connected'}</h2>", "          <h2>{mailboxLoading ? 'Loading mailbox...' : emailConnection ? emailConnection.address : 'No mailbox connected'}</h2>", 'email loading heading');
  content = replaceOnce(content, '              <input value={emailCompose.to} onChange={(event) => onEmailComposeChange({ ...emailCompose, to: event.target.value })} placeholder="client@example.com" />', '              <input type="email" multiple required value={emailCompose.to} onChange={(event) => onEmailComposeChange({ ...emailCompose, to: event.target.value })} placeholder="client@example.com" />', 'email to validation');
  content = replaceOnce(content, '              <input value={emailCompose.subject} onChange={(event) => onEmailComposeChange({ ...emailCompose, subject: event.target.value })} placeholder="Subject" />', '              <input required value={emailCompose.subject} onChange={(event) => onEmailComposeChange({ ...emailCompose, subject: event.target.value })} placeholder="Subject" />', 'email subject required');
  content = replaceOnce(content, '              <textarea value={emailCompose.body} onChange={(event) => onEmailComposeChange({ ...emailCompose, body: event.target.value })} placeholder="Write a message to the client." />', '              <textarea required value={emailCompose.body} onChange={(event) => onEmailComposeChange({ ...emailCompose, body: event.target.value })} placeholder="Write a message to the client." />', 'email body required');
  content = replaceOnce(content, '              <button className="primary-button" type="submit" disabled={emailConnection?.status !== \'connected\' || sending}>', '              <button className="primary-button" type="submit" disabled={!canSendEmail || sending}>', 'email send disabled');

  fs.writeFileSync(file, content);
}

function patchOnboardingPasswords() {
  const file = path.resolve(__dirname, '../src/components/portal/OnboardingPage.tsx');
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/type="text"\n                       value={ownerAccessPassword}/g, 'type="password"\n                       value={ownerAccessPassword}');
  content = content.replace(/type="text"\n                       value={ownerAccessPasswordConfirm}/g, 'type="password"\n                       value={ownerAccessPasswordConfirm}');
  fs.writeFileSync(file, content);
}

patchAppLoginAndTenantLoading();
patchMapPage();
patchPortalCountersAndMailbox();
patchJobsPage();
patchTasksPage();
patchKnowledgePage();
patchEmailPage();
patchOnboardingPasswords();
console.log('QA report fixes patch applied.');
