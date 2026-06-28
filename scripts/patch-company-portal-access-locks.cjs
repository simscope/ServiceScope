const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const portalPath = path.join(root, 'src/CompanyPortal.tsx');
const cssPath = path.join(root, 'src/styles/responsive.css');
const read = (file) => fs.readFileSync(file, 'utf8');
const write = (file, text) => fs.writeFileSync(file, text);
let portal = read(portalPath);

if (!portal.includes('const companyAccessMode = selectedCompany.status')) {
  portal = portal.replace(
    "  const currentPortalUser = {\n    name: signedInUser?.name ?? selectedCompany.ownerName,\n    role: signedInUser?.role ?? 'Admin' as const,\n  };",
    "  const currentPortalUser = {\n    name: signedInUser?.name ?? selectedCompany.ownerName,\n    role: signedInUser?.role ?? 'Admin' as const,\n  };\n  const companyAccessMode = selectedCompany.status === 'paused' || selectedCompany.billingStatus === 'overdue'\n    ? 'locked'\n    : selectedCompany.status === 'setup' || selectedCompany.billingStatus === 'not_started'\n      ? 'limited'\n      : 'full';\n  const companyAccessReadOnly = companyAccessMode !== 'full';\n  const companyAccessMessage = companyAccessMode === 'locked'\n    ? 'Company access is locked by ServiceScope owner. Billing and support stay available.'\n    : companyAccessMode === 'limited'\n      ? 'Company access is limited by ServiceScope owner. Billing and support stay available.'\n      : '';\n  function stopCompanyWrite(action: string) {\n    if (!companyAccessReadOnly) return false;\n    setJobsStatus(companyAccessMessage + ' Restore access before ' + action + '.');\n    return true;\n  }",
  );
}

portal = portal.replace("  const handleSaveJob = (updatedJob: JobCardData, openJobAfterSave = true) => {\n    setJobs((currentJobs) => {", "  const handleSaveJob = (updatedJob: JobCardData, openJobAfterSave = true) => {\n    if (stopCompanyWrite('saving jobs')) return;\n    setJobs((currentJobs) => {");
portal = portal.replace("  const handleCreateJob = (event: FormEvent<HTMLFormElement>) => {\n    event.preventDefault();", "  const handleCreateJob = (event: FormEvent<HTMLFormElement>) => {\n    event.preventDefault();\n    if (stopCompanyWrite('creating jobs')) return;");
portal = portal.replace("  const handleCreateInvoice = async (job: JobCardData, invoiceMaterials: MaterialRow[], amount: number, documentType: JobDocumentType) => {\n    const invoice = await createJobInvoice", "  const handleCreateInvoice = async (job: JobCardData, invoiceMaterials: MaterialRow[], amount: number, documentType: JobDocumentType) => {\n    if (companyAccessReadOnly) throw new Error(companyAccessMessage + ' Restore access before creating invoices.');\n    const invoice = await createJobInvoice");
portal = portal.replace("  const handleDeleteInvoice = async (job: JobCardData, invoiceId: string) => {\n    await deleteJobInvoice", "  const handleDeleteInvoice = async (job: JobCardData, invoiceId: string) => {\n    if (companyAccessReadOnly) throw new Error(companyAccessMessage + ' Restore access before deleting invoices.');\n    await deleteJobInvoice");
portal = portal.replace("  const addLibraryDocument = (event: FormEvent<HTMLFormElement>) => {\n    event.preventDefault();", "  const addLibraryDocument = (event: FormEvent<HTMLFormElement>) => {\n    event.preventDefault();\n    if (stopCompanyWrite('adding library files')) return;");
portal = portal.replace("  const createManualTask = (event: FormEvent<HTMLFormElement>) => {\n    event.preventDefault();", "  const createManualTask = (event: FormEvent<HTMLFormElement>) => {\n    event.preventDefault();\n    if (stopCompanyWrite('creating tasks')) return;");
portal = portal.replace("  function handleCalendarDrop(event: DragEvent<HTMLDivElement>, dayKey: string, slotKey: string) {\n    event.preventDefault();", "  function handleCalendarDrop(event: DragEvent<HTMLDivElement>, dayKey: string, slotKey: string) {\n    event.preventDefault();\n    if (stopCompanyWrite('moving calendar jobs')) return;");
portal = portal.replace("  function handleCalendarMonthDrop(event: DragEvent<HTMLDivElement>, dayKey: string) {\n    event.preventDefault();", "  function handleCalendarMonthDrop(event: DragEvent<HTMLDivElement>, dayKey: string) {\n    event.preventDefault();\n    if (stopCompanyWrite('moving calendar jobs')) return;");
portal = portal.replace("  function confirmCalendarMonthDrop() {\n    if (!monthDropRequest) return;", "  function confirmCalendarMonthDrop() {\n    if (stopCompanyWrite('moving calendar jobs')) return;\n    if (!monthDropRequest) return;");

if (!portal.includes('company-access-banner')) {
  portal = portal.replace("        <div className=\"portal-page\">", "        <div className=\"portal-page\">\n          {companyAccessReadOnly ? (\n            <div className={'company-access-banner ' + companyAccessMode}>\n              <strong>{companyAccessMode === 'locked' ? 'Company access locked' : 'Company access limited'}</strong>\n              <span>{companyAccessMessage}</span>\n            </div>\n          ) : null}");
}
write(portalPath, portal);

let css = read(cssPath);
if (!css.includes('company-access-banner')) {
  css += "\n.company-access-banner{display:grid;gap:4px;border:1px solid #fde68a;border-radius:14px;background:#fffdf4;color:#17201b;padding:12px 14px;margin-bottom:14px}.company-access-banner.locked{border-color:#fecaca;background:#fff7f7}.company-access-banner strong{font-weight:900}.company-access-banner span{font-weight:800;color:#526157}\n";
  write(cssPath, css);
}
console.log('Company portal access locks patch applied.');
