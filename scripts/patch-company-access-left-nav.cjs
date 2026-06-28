const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const appTypesPath = path.join(root, 'src/appTypes.ts');
const accessStorePath = path.join(root, 'src/services/accessStore.ts');
const appPath = path.join(root, 'src/App.tsx');
const cssPath = path.join(root, 'src/styles/responsive.css');
const read = (file) => fs.readFileSync(file, 'utf8');
const write = (file, text) => fs.writeFileSync(file, text);

let appTypes = read(appTypesPath);
appTypes = appTypes.replace("export type AppPage = 'dashboard' | 'companies' | 'monitoring' | 'billing' | 'access' | 'audit' | 'support' | 'companyLogin' | 'portal';", "export type AppPage = 'dashboard' | 'companies' | 'monitoring' | 'billing' | 'companyAccess' | 'access' | 'audit' | 'support' | 'companyLogin' | 'portal';");
write(appTypesPath, appTypes);

let accessStore = read(accessStorePath);
accessStore = accessStore.replace("  billing: 'Billing',\n  access: 'Access',", "  billing: 'Billing',\n  companyAccess: 'Company Access',\n  access: 'Access',");
accessStore = accessStore.replace("owner: ['dashboard', 'companies', 'monitoring', 'billing', 'access', 'audit', 'support']", "owner: ['dashboard', 'companies', 'monitoring', 'billing', 'companyAccess', 'access', 'audit', 'support']");
accessStore = accessStore.replace("admin: ['dashboard', 'companies', 'monitoring', 'billing', 'audit', 'support']", "admin: ['dashboard', 'companies', 'monitoring', 'billing', 'companyAccess', 'audit', 'support']");
accessStore = accessStore.replace("owner: ['All owner pages', 'Billing',", "owner: ['All owner pages', 'Company access control', 'Billing',");
accessStore = accessStore.replace("admin: ['Dashboard', 'Companies', 'Monitoring', 'Billing',", "admin: ['Dashboard', 'Companies', 'Monitoring', 'Billing', 'Company access control',");
write(accessStorePath, accessStore);

let app = read(appPath);
app = app.replace("import { CompanyPortal } from './CompanyPortal';", "import { CompanyPortal } from './CompanyPortal';\nimport { CompanyAccessPage, companyPatchForAccessMode, type CompanyAccessMode } from './components/CompanyAccessPage';");
app = app.replace("  billing: 'Plans & Billing',\n  access: 'Access',", "  billing: 'Plans & Billing',\n  companyAccess: 'Company Access',\n  access: 'Access',");
app = app.replace("    case 'billing': return 'billing';\n    case 'access': return 'access';", "    case 'billing': return 'billing';\n    case 'companyaccess':\n    case 'company-access': return 'companyAccess';\n    case 'access': return 'access';");
app = app.replace("            { page: 'billing' as AppPage, label: 'Billing', icon: <CreditCard size={18} aria-hidden=\"true\" /> },\n            { page: 'access' as AppPage, label: 'Access', icon: <UserPlus size={18} aria-hidden=\"true\" /> },", "            { page: 'billing' as AppPage, label: 'Billing', icon: <CreditCard size={18} aria-hidden=\"true\" /> },\n            { page: 'companyAccess' as AppPage, label: 'Company Access', icon: <ShieldCheck size={18} aria-hidden=\"true\" /> },\n            { page: 'access' as AppPage, label: 'Access', icon: <UserPlus size={18} aria-hidden=\"true\" /> },");
if (!app.includes("page === 'companyAccess' ? (")) {
  const handler = "        ) : page === 'companyAccess' ? (\n          <CompanyAccessPage\n            companies={companies}\n            onChangeCompanyAccess={(companyId, mode: CompanyAccessMode) => {\n              const company = companies.find((candidate) => candidate.id === companyId);\n              updateCompany(companyId, (currentCompany) => ({ ...currentCompany, ...companyPatchForAccessMode(mode) }));\n              recordAudit({ category: 'access', action: 'company.access_changed', actor: 'ServiceScope Owner', resource: company?.name ?? 'Unknown tenant', details: 'Company access changed to ' + mode + '.' });\n            }}\n          />\n";
  app = app.replace("        ) : page === 'access' ? (\n          <AccessPage", handler + "        ) : page === 'access' ? (\n          <AccessPage");
}
write(appPath, app);

let css = read(cssPath);
if (!css.includes('Company access control panel')) {
  css += "\n/* Company access control panel */\n.company-access-toolbar{display:grid;grid-template-columns:minmax(260px,1fr) 220px auto;gap:10px;align-items:end;margin-bottom:14px}.company-access-toolbar label{display:grid;gap:6px;color:#526157;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.company-access-toolbar input,.company-access-toolbar select{width:100%;border:1px solid #d6dfd8;border-radius:10px;background:#f8faf7;padding:10px 12px;font-weight:800}.company-access-list{display:grid;gap:10px}.company-access-row{display:grid;grid-template-columns:minmax(230px,1.1fr) minmax(170px,.8fr) 180px minmax(280px,1.4fr) auto;gap:12px;align-items:start;border:1px solid #dfe7e1;border-radius:14px;background:#fff;padding:12px}.company-access-row.limited{border-color:#fde68a;background:#fffdf4}.company-access-row.locked{border-color:#fecaca;background:#fff7f7}.company-access-status,.company-access-select,.company-access-rules{display:grid;gap:7px}.company-access-status span,.company-access-select,.company-access-rules>span{color:#526157;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.company-access-select select{border:1px solid #d6dfd8;border-radius:10px;background:#fff;padding:9px 10px;font-weight:900}.company-access-pill{display:inline-flex;justify-self:start;border-radius:999px;padding:5px 9px;font-style:normal;font-size:11px;font-weight:900}.company-access-pill.full{background:#ecfdf3;color:#166534}.company-access-pill.limited{background:#fef3c7;color:#92400e}.company-access-pill.locked{background:#fee2e2;color:#991b1b}.company-access-actions{display:grid;gap:7px;min-width:120px}.danger-button{border-color:#fecaca!important;background:#fff7f7!important;color:#991b1b!important}.allowed-list b{background:#ecfdf3;color:#166534}.blocked-list b{background:#fee2e2;color:#991b1b}@media(max-width:1380px){.company-access-row{grid-template-columns:1fr 1fr}.company-access-actions{grid-column:1/-1;grid-template-columns:repeat(3,minmax(0,1fr))}.company-access-rules{grid-column:1/-1}.company-access-toolbar{grid-template-columns:1fr 220px auto}}@media(max-width:760px){.company-access-toolbar,.company-access-row,.company-access-actions{grid-template-columns:1fr}.company-access-rules{grid-column:auto}}\n";
  write(cssPath, css);
}
console.log('Company access left navigation patch applied.');
