const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const portalPath = path.join(root, 'src/CompanyPortal.tsx');
const ownerPath = path.join(root, 'src/components/OwnerPages.tsx');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content);
}

let portal = read(portalPath);

portal = portal.replace(
  "const clientPageValues: ClientPage[] = ['onboarding', 'jobs', 'allJobs', 'calendar', 'materials', 'tasks', 'map', 'email', 'finances', 'knowledge', 'portal'];",
  "const clientPageValues: ClientPage[] = ['jobs', 'allJobs', 'calendar', 'materials', 'tasks', 'map', 'email', 'finances', 'knowledge', 'portal'];",
);

portal = portal.replace(/\n\s*\{ page: 'onboarding', label: 'Onboarding', icon: <Rocket size=\{16\} \/> \},/g, '');

portal = portal.replace(/\n\s*\{isBillingOverdue \|\| selectedCompany\.billingStatus === 'not_started' \? \([\s\S]*?\) : null}\n\n\s*<section className="portal-metrics">/g, '\n\n              <section className="portal-metrics">');

portal = portal.replace(/<button className="secondary-button compact" type="button" onClick=\{\(\) => setClientPage\('onboarding'\)\}>/g, '<button className="secondary-button compact" type="button" onClick={() => setClientPage(\'portal\')}>');

portal = portal.replace(
  '<MetricCard icon={<Rocket size={20} />} label="Launch" value={`${completedSteps}/4`} detail="Provisioning steps complete" />',
  '<MetricCard icon={<Building2 size={20} />} label="Account" value={selectedCompany.status} detail="Company portal" />',
);

portal = portal.replace(
  '<MetricCard icon={<Rocket size={20} />} label="Launch" value={`${completedSteps}/4`} detail="Provisioning steps complete" />',
  '<MetricCard icon={<Building2 size={20} />} label="Account" value={selectedCompany.status} detail="Company portal" />',
);

portal = portal.replace(
  /\n\s*\{clientPage === 'onboarding' \? \([\s\S]*?\n\s*\) : clientPage === 'jobs' \? \(/,
  "\n        {clientPage === 'jobs' ? (",
);

portal = portal.replace(
  /onOpenOnboarding=\{\(\) => setClientPage\('onboarding'\)\}/g,
  "onOpenOnboarding={() => setClientPage('portal')}",
);

write(portalPath, portal);

let owner = read(ownerPath);

owner = owner.replace(/\n\s*<div className=\{`launch-readiness[\s\S]*?\n\s*<\/div>\n\n\s*<div className="detail-grid">/, '\n\n      <div className="detail-grid">');

owner = owner.replace(/\n\s*<section className="detail-section">\n\s*<div className="section-title">\n\s*<Database size=\{18\} aria-hidden="true" \/>\n\s*<h3>Provisioning<\/h3>[\s\S]*?\n\s*<\/section>\n\n\s*<section className="detail-section">\n\s*<div className="section-title">\n\s*<AlertTriangle size=\{18\} aria-hidden="true" \/>\n\s*<h3>Owner signals<\/h3>[\s\S]*?\n\s*<\/section>\n\n\s*<button className="secondary-button" type="button" onClick=\{onPrepareNext\} disabled=\{readyToLaunch\}>[\s\S]*?\n\s*<\/button>/g, '');

owner = owner.replace(/\n\s*<section className="detail-section">\n\s*<div className="section-title">\n\s*<Database size=\{18\} aria-hidden="true" \/>\n\s*<h3>Provisioning<\/h3>[\s\S]*?\n\s*<\/section>/g, '');

owner = owner.replace(/\n\s*<section className="detail-section">\n\s*<div className="section-title">\n\s*<AlertTriangle size=\{18\} aria-hidden="true" \/>\n\s*<h3>Owner signals<\/h3>[\s\S]*?\n\s*<\/section>/g, '');

owner = owner.replace(/\n\s*<button className="secondary-button" type="button" onClick=\{onPrepareNext\} disabled=\{readyToLaunch\}>[\s\S]*?\n\s*<\/button>/g, '');

owner = owner.replace(/\n\s*<span className=\{completedSteps === onboardingStepOrder\.length \? 'ok' : 'bad'\}>Onboarding: \{completedSteps\}\/4<\/span>/g, '');

write(ownerPath, owner);

console.log('Provisioning and onboarding UI removed.');
require('./patch-audit-backend.cjs');
global.user = { email: '${user.email}' };
require('./patch-access-page-permissions.cjs');
delete global.user;
const companyAccessPatchPath = path.join(__dirname, 'patch-company-access-control.cjs');
let companyAccessPatch = fs.readFileSync(companyAccessPatchPath, 'utf8');
companyAccessPatch = companyAccessPatch.replace(
  `accessRender = accessRender.replace(/\\n\\s*\\/>\n?$/, '\\n' + companyAccessHandler + '          />');`,
  `accessRender = accessRender.replace(/\\n\\s*\\/>(?:\\n)?\\s*$/, '\\n' + companyAccessHandler + '          />');`,
);
fs.writeFileSync(companyAccessPatchPath, companyAccessPatch);
require('./patch-company-access-control.cjs');
