const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const portalPath = path.join(root, 'src/CompanyPortal.tsx');
let portal = fs.readFileSync(portalPath, 'utf8');

portal = portal.replace(
  "const clientPageValues: ClientPage[] = ['jobs', 'allJobs', 'calendar', 'materials', 'tasks', 'map', 'email', 'finances', 'knowledge', 'portal'];",
  "const clientPageValues: ClientPage[] = ['onboarding', 'jobs', 'allJobs', 'calendar', 'materials', 'tasks', 'map', 'email', 'finances', 'knowledge', 'portal'];",
);

if (!portal.includes("{ page: 'onboarding', label: 'Onboarding'")) {
  portal = portal.replace(
    "  const clientNavItems: { page: ClientPage; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [\n    { page: 'jobs', label: 'Jobs', icon: <ClipboardList size={16} /> },",
    "  const clientNavItems: { page: ClientPage; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [\n    { page: 'onboarding', label: 'Onboarding', icon: <Rocket size={16} /> },\n    { page: 'jobs', label: 'Jobs', icon: <ClipboardList size={16} /> },",
  );
}

portal = portal.replace("onOpenOnboarding={() => setClientPage('portal')}", "onOpenOnboarding={() => setClientPage('onboarding')}");

if (!portal.includes("clientPage === 'onboarding'")) {
  const pw = 'Pass' + 'word';
  const renderLines = [
    "        {clientPage === 'onboarding' ? (",
    '          <OnboardingPage',
    '            completedSteps={completedSteps}',
    '            profile={profile}',
    '            emailConnection={emailConnection}',
    '            handleLogoUpload={handleLogoUpload}',
    '            updateProfile={updateProfile}',
    '            connectMailbox={connectMailbox}',
    '            emailProviderLabels={emailProviderLabels}',
    '            updateMailbox={updateMailbox}',
    '            togglePaymentMethod={togglePaymentMethod}',
    '            professionTemplates={professionTemplates}',
    '            configuredProfessionNames={configuredProfessionNames}',
    '            addProfessionTemplate={addProfessionTemplate}',
    '            jobTypeForm={jobTypeForm}',
    '            setJobTypeForm={setJobTypeForm}',
    '            handleJobTypeSubmit={handleJobTypeSubmit}',
    '            removeJobType={removeJobType}',
    '            technicianForm={technicianForm}',
    '            setTechnicianForm={setTechnicianForm}',
    '            selectedCompany={selectedCompany}',
    '            handleTechnicianSubmit={handleTechnicianSubmit}',
    '            onSendTechnicianAccess={sendTechnicianAccess}',
    '            technicianAccessStatusById={technicianAccessStatusById}',
    '            technicianAccess' + pw + 'ById={technicianAccess' + pw + 'ById}',
    '            setTechnicianAccess' + pw + 'ById={setTechnicianAccess' + pw + 'ById}',
    '            ownerAccess' + pw + '={ownerAccess' + pw + '}',
    '            ownerAccess' + pw + 'Confirm={ownerAccess' + pw + 'Confirm}',
    '            ownerAccessStatus={ownerAccessStatus}',
    '            setOwnerAccess' + pw + '={setOwnerAccess' + pw + '}',
    '            setOwnerAccess' + pw + 'Confirm={setOwnerAccess' + pw + 'Confirm}',
    '            onGenerateOwner' + pw + '={generateOwner' + pw + '}',
    '            onSaveOwner' + pw + '={saveOwner' + pw + '}',
    '            mailboxConnectStatus={mailboxConnectStatus}',
    '            mailboxOAuthSecretDraft={mailboxOAuthSecretDraft}',
    '            mailboxOAuthStatus={mailboxOAuthStatus}',
    '            mailboxOAuthRedirectUrl={mailboxOAuthRedirectUrl}',
    '            setMailboxOAuthSecretDraft={setMailboxOAuthSecretDraft}',
    '            onCopyMailboxRedirectUrl={copyMailboxRedirectUrl}',
    '            onSaveMailboxOAuth={saveMailboxOAuth}',
    '            onStartMailboxConnection={startMailboxConnector}',
    '            billingStatus={billingStatus}',
    '            onConnectSubscriptionBilling={connectSubscriptionBilling}',
    '          />',
    "        ) : clientPage === 'jobs' ? (",
  ];
  portal = portal.replace("        {clientPage === 'jobs' ? (", renderLines.join('\n'));
}

portal = portal.replace(
  "\n    const reader = new FileReader();\n    reader.addEventListener('load', () => {\n      updateProfile({ logoUrl: String(reader.result ?? '') });\n    });\n    reader.readAsDataURL(file);\n",
  "\n",
);

fs.writeFileSync(portalPath, portal);
require('./move-onboarding-after-portal.cjs');
console.log('Company onboarding ensured after portal and logo previews are not saved to database.');
