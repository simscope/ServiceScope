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
portal = portal.replace(/Onboarding/g, '');
write(portalPath, portal);

let owner = read(ownerPath);
owner = owner.replace(/Provisioning/g, '');
owner = owner.replace(/Owner signals/g, '');
owner = owner.replace(/Prepare next step/g, '');
write(ownerPath, owner);

console.log('Provisioning and onboarding UI removed.');
require('./patch-audit-backend.cjs');
console.log('Company access owner nav skipped.');
