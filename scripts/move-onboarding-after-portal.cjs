const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const portalPath = path.join(root, 'src/CompanyPortal.tsx');
let portal = fs.readFileSync(portalPath, 'utf8');

portal = portal.replace(
  /const clientPageValues: ClientPage\[\] = \[[^\]]+\];/,
  "const clientPageValues: ClientPage[] = ['jobs', 'allJobs', 'calendar', 'materials', 'tasks', 'map', 'email', 'finances', 'knowledge', 'portal', 'onboarding'];",
);

portal = portal.replace(/\n\s*\{ page: 'onboarding', label: 'Onboarding', icon: <Rocket size=\{16\} \/> \},/g, '');
portal = portal.replace(
  "    { page: 'portal', label: 'Portal', icon: <Rocket size={16} /> },",
  "    { page: 'portal', label: 'Portal', icon: <Rocket size={16} /> },\n    { page: 'onboarding', label: 'Onboarding', icon: <Rocket size={16} /> },",
);

fs.writeFileSync(portalPath, portal);
console.log('Company onboarding moved after portal.');
