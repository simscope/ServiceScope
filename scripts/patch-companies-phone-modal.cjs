const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = {
  types: path.join(root, 'src/types.ts'),
  seeds: path.join(root, 'src/appSeeds.ts'),
  store: path.join(root, 'src/services/companyOnboardingStore.ts'),
  backend: path.join(root, 'src/services/backendData.ts'),
  app: path.join(root, 'src/App.tsx'),
  owner: path.join(root, 'src/components/OwnerPages.tsx'),
  css: path.join(root, 'src/styles/responsive.css'),
};
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, c) => fs.writeFileSync(p, c);

let types = read(files.types);
if (!types.includes('  phone?: string;\n  ownerEmail: string;')) {
  types = types.replace('  phone: string;\n  ownerEmail: string;', '  phone?: string;\n  ownerEmail: string;');
  types = types.replace('  ownerName: string;\n  ownerEmail: string;', '  ownerName: string;\n  phone?: string;\n  ownerEmail: string;');
}
types = types.replace("'name' | 'ownerName' | 'ownerEmail' | 'temporaryPassword'", "'name' | 'ownerName' | 'phone' | 'ownerEmail' | 'temporaryPassword'");
write(files.types, types);

let seeds = read(files.seeds);
if (!seeds.includes("  phone: '',")) {
  seeds = seeds.replace("  ownerName: '',\n  ownerEmail: '',", "  ownerName: '',\n  phone: '',\n  ownerEmail: '',");
}
write(files.seeds, seeds);

let store = read(files.store);
store = store.replace("    phone: '',\n    billingEmail: company.ownerEmail,", "    phone: company.phone ?? '',\n    billingEmail: company.ownerEmail,");
write(files.store, store);

let backend = read(files.backend);
backend = backend.replace('  owner_email: string;\n  phone: string | null;\n  temporary_password?: string;', '  owner_email: string;\n  temporary_password?: string;');
backend = backend.replace("    ownerName: row.owner_name,\n    phone: row.phone ?? '',\n    ownerEmail: row.owner_email,", "    ownerName: row.owner_name,\n    phone: '',\n    ownerEmail: row.owner_email,");
backend = backend.replace(
  '  const companies = companyRows.map((company) => companyFromDb(company, onboardingSteps, alerts));',
  `  const companies = companyRows.map((companyRow) => {
    const company = companyFromDb(companyRow, onboardingSteps, alerts);
    const profileRow = profileRows.find((profile) => profile.company_id === company.id);

    return { ...company, phone: profileRow?.phone ?? company.phone ?? '' };
  });`,
);
write(files.backend, backend);

let app = read(files.app);
app = app.replace("  const [selectedCompanyId, setSelectedCompanyId] = useState(() => initialCompanies[0]?.id ?? '');", "  const [selectedCompanyId, setSelectedCompanyId] = useState('');");
if (!app.includes("company.phone")) {
  app = app.replace('[company.name, company.ownerName, company.ownerEmail, company.market, company.domain]', '[company.name, company.ownerName, company.phone, company.ownerEmail, company.market, company.domain]');
}
if (!app.includes('Company phone')) {
  app = app.replace(
    `              <label>
                Owner name
                <input value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} placeholder="Owner full name" />
              </label>
              <label>
                Owner email`,
    `              <label>
                Owner name
                <input value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} placeholder="Owner full name" />
              </label>
              <label>
                Company phone
                <input value={form.phone ?? ''} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Company phone" />
              </label>
              <label>
                Owner email`,
  );
}
app = app.replace('    const nextProfile = createDefaultCompanyOnboardingProfile(nextCompany);', "    const nextProfile = { ...createDefaultCompanyOnboardingProfile(nextCompany), phone: form.phone ?? '' };");
app = app.replace('        <div className="content-grid">', '        <>\n        <div className="content-grid companies-list-only">');
const detailBlock = `
          {selectedCompany ? (
            <CompanyDetail
              company={selectedCompany}
              onPrepareNext={() => prepareNextStep(selectedCompany.id)}
              onCompleteStep={(step) => updateCompany(selectedCompany.id, (company) => completeOnboardingStep(company, step))}
              onSaveOwnerAccess={(mode, password) => sendCompanyOwnerAccess(selectedCompany, mode, password)}
              ownerInviteStatus={ownerAccessStatusByCompany[selectedCompany.id] ?? ''}
            />
          ) : null}
        </div>
`;
const modalBlock = `
        </div>
        {selectedCompanyId && selectedCompany ? (
          <div className="company-detail-modal-backdrop" role="presentation" onClick={() => setSelectedCompanyId('')}>
            <div className="company-detail-modal" role="dialog" aria-modal="true" aria-label={selectedCompany.name + ' company details'} onClick={(event) => event.stopPropagation()}>
              <button className="modal-close-button" type="button" onClick={() => setSelectedCompanyId('')} aria-label="Close company details">×</button>
              <CompanyDetail
                company={selectedCompany}
                onPrepareNext={() => prepareNextStep(selectedCompany.id)}
                onCompleteStep={(step) => updateCompany(selectedCompany.id, (company) => completeOnboardingStep(company, step))}
                onSaveOwnerAccess={(mode, password) => sendCompanyOwnerAccess(selectedCompany, mode, password)}
                ownerInviteStatus={ownerAccessStatusByCompany[selectedCompany.id] ?? ''}
              />
            </div>
          </div>
        ) : null}
        </>
`;
if (app.includes(detailBlock)) app = app.replace(detailBlock, modalBlock);
write(files.app, app);

let owner = read(files.owner);
owner = owner.replace('<p>{company.ownerName} - {company.market}</p>', "<p>{[company.ownerName, company.phone, company.market].filter(Boolean).join(' - ')}</p>");
if (!owner.includes('<span>Company phone</span>')) {
  owner = owner.replace(
    `          <div>
            <span>Company owner email</span>
            <strong>{company.ownerEmail}</strong>
          </div>`,
    `          <div>
            <span>Company owner email</span>
            <strong>{company.ownerEmail}</strong>
          </div>
          <div>
            <span>Company phone</span>
            <strong>{company.phone || 'Not set'}</strong>
          </div>`,
  );
}
write(files.owner, owner);

let css = read(files.css);
if (!css.includes('Companies page modal details')) {
  css += `

/* Companies page modal details */
.companies-list-only {
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
}

.company-detail-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.52);
  padding: 28px;
}

.company-detail-modal {
  position: relative;
  width: min(980px, 96vw);
  max-height: 92vh;
  overflow: auto;
  border-radius: 18px;
  background: #f8fbf8;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35);
}

.company-detail-modal .detail-panel {
  position: static !important;
  width: 100%;
  max-width: none;
  border: 0;
  box-shadow: none;
}

.modal-close-button {
  position: sticky;
  top: 12px;
  left: calc(100% - 54px);
  z-index: 2;
  width: 38px;
  height: 38px;
  border: 1px solid #d5ded7;
  border-radius: 999px;
  background: #ffffff;
  color: #17201b;
  font-size: 24px;
  font-weight: 900;
  line-height: 1;
  cursor: pointer;
}

.company-row {
  cursor: pointer;
}

@media (max-width: 920px) {
  .companies-list-only {
    grid-template-columns: 1fr;
  }

  .company-detail-modal-backdrop {
    padding: 12px;
  }
}
`;
  write(files.css, css);
}

console.log('Companies phone and modal details patch applied.');
