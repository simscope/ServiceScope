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

fs.writeFileSync(portalPath, portal);
console.log('Company onboarding page restored.');

require('./patch-audit-backend.cjs');
require('./patch-access-page-permissions.cjs');
require('./patch-company-access-control.cjs');
require('./patch-company-access-left-nav.cjs');
