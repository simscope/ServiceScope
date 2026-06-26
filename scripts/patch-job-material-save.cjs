const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function replaceOnce(relativePath, before, after, alreadyPatchedMarker) {
  const filePath = path.join(root, relativePath);
  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes(alreadyPatchedMarker)) return;
  if (!content.includes(before)) return;

  content = content.replace(before, after);
  fs.writeFileSync(filePath, content);
}

function replaceAll(relativePath, before, after) {
  const filePath = path.join(root, relativePath);
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes(before)) return;
  fs.writeFileSync(filePath, content.split(before).join(after));
}

replaceOnce(
  'src/components/JobDetailPanel.tsx',
  "  onSaveMaterials: (jobNumber: string, rows: MaterialRow[]) => void | Promise<void>;",
  "  onSaveMaterials: (jobOrJobNumber: JobCardData | string, rows: MaterialRow[]) => void | Promise<void>;",
  "onSaveMaterials: (jobOrJobNumber: JobCardData | string, rows: MaterialRow[]) => void | Promise<void>;",
);

replaceOnce(
  'src/components/JobDetailPanel.tsx',
  `  function saveDraft() {
    const assignee = draft.technician || 'No technician';
    const nextJob = {
      ...draft,
      technician: assignee,
      assignee,
      attachments: draft.attachments ?? [],
    };

    onSave(nextJob);
    setDraft(nextJob);
    setSaved(true);
  }
`,
  `  function normalizeMaterialDraftRows(jobNumberValue: string) {
    return materialDrafts
      .filter((row) => row.name.trim() || row.supplier.trim())
      .map((row) => ({
        ...row,
        jobNumber: jobNumberValue,
        name: row.name.trim(),
        supplier: row.supplier.trim(),
        quantity: Math.max(1, Number(row.quantity) || 1),
        price: Math.max(0, Number(row.price) || 0),
      }));
  }

  function saveDraft() {
    const assignee = draft.technician || 'No technician';
    const nextJob = {
      ...draft,
      technician: assignee,
      assignee,
      attachments: draft.attachments ?? [],
    };
    const cleanMaterials = normalizeMaterialDraftRows(nextJob.jobNumber);

    onSave(nextJob);
    Promise.resolve(onSaveMaterials(nextJob, cleanMaterials))
      .then(() => {
        setMaterialsSaved(true);
      })
      .catch(() => {
        setMaterialsSaved(false);
      });
    setMaterialDrafts(cleanMaterials.length ? cleanMaterials : [emptyMaterialRow(nextJob.jobNumber)]);
    setDraft(nextJob);
    setSaved(true);
  }
`,
  'function normalizeMaterialDraftRows(jobNumberValue: string)',
);

replaceOnce(
  'src/components/JobDetailPanel.tsx',
  `  function saveMaterials() {
    Promise.resolve(onSaveMaterials(draft.jobNumber, materialDrafts))
      .then(() => {
        setMaterialsSaved(true);
      })
      .catch(() => {
        setMaterialsSaved(false);
      });
  }
`,
  `  function saveMaterials() {
    const cleanMaterials = normalizeMaterialDraftRows(draft.jobNumber);

    Promise.resolve(onSaveMaterials(draft, cleanMaterials))
      .then(() => {
        setMaterialsSaved(true);
      })
      .catch(() => {
        setMaterialsSaved(false);
      });
    setMaterialDrafts(cleanMaterials.length ? cleanMaterials : [emptyMaterialRow(draft.jobNumber)]);
  }
`,
  'Promise.resolve(onSaveMaterials(draft, cleanMaterials))',
);

replaceOnce(
  'src/CompanyPortal.tsx',
  `  listCompanyJobMaterials,
  listCompanyJobs,`,
  `  listCompanyJobMaterials,
  listCompanyJobs,
  listCompanyCustomers,`,
  'listCompanyCustomers,',
);

replaceOnce(
  'src/CompanyPortal.tsx',
  `  CompanyPaymentMethod,
  CompanyTechnicianRole,
  JobDocumentType,`,
  `  CompanyPaymentMethod,
  CompanyTechnicianRole,
  Customer,
  JobDocumentType,`,
  `Customer,
  JobDocumentType`,
);

replaceOnce(
  'src/CompanyPortal.tsx',
  `  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [jobsStatus, setJobsStatus] = useState('');`,
  `  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [jobsStatus, setJobsStatus] = useState('');`,
  'const [customers, setCustomers] = useState<Customer[]>([]);',
);

replaceOnce(
  'src/CompanyPortal.tsx',
  `      setJobs([]);
      setMaterials([]);
      setJobsStatus('');`,
  `      setJobs([]);
      setCustomers([]);
      setMaterials([]);
      setJobsStatus('');`,
  'setCustomers([]);',
);

replaceOnce(
  'src/CompanyPortal.tsx',
  `        const [savedJobs, savedMaterials] = await Promise.all([
          listCompanyJobs(company.id),
          listCompanyJobMaterials(company.id),
        ]);`,
  `        const [savedJobs, savedMaterials, savedCustomers] = await Promise.all([
          listCompanyJobs(company.id),
          listCompanyJobMaterials(company.id),
          listCompanyCustomers(company.id),
        ]);`,
  'savedCustomers',
);

replaceOnce(
  'src/CompanyPortal.tsx',
  `        setJobs(savedJobs);
        setMaterials(savedMaterials);`,
  `        setJobs(savedJobs);
        setCustomers(savedCustomers);
        setMaterials(savedMaterials);`,
  'setCustomers(savedCustomers);',
);

replaceOnce(
  'src/CompanyPortal.tsx',
  `        setJobs([]);
        setMaterials([]);
        setJobsStatus(error instanceof Error ? error.message : 'Jobs could not be loaded.');`,
  `        setJobs([]);
        setCustomers([]);
        setMaterials([]);
        setJobsStatus(error instanceof Error ? error.message : 'Jobs could not be loaded.');`,
  `setCustomers([]);
        setMaterials([]);`,
);

replaceOnce(
  'src/CompanyPortal.tsx',
  `            materials={materials}
            currentPortalUser={currentPortalUser}`, 
  `            materials={materials}
            customers={customers}
            currentPortalUser={currentPortalUser}`,
  'customers={customers}',
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  `  JobInvoice,
  MaterialRow,`,
  `  JobInvoice,
  Customer,
  MaterialRow,`,
  `Customer,
  MaterialRow`,
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  `  materials,
  currentPortalUser,`,
  `  materials,
  customers,
  currentPortalUser,`,
  'customers,\n  currentPortalUser,',
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  `  materials: MaterialRow[];
  currentPortalUser: { name: string; role: 'Manager' | 'Admin' | 'Technician' };`,
  `  materials: MaterialRow[];
  customers: Customer[];
  currentPortalUser: { name: string; role: 'Manager' | 'Admin' | 'Technician' };`,
  'customers: Customer[];',
);

const pageCallbackBefore = "onSaveMaterials: (jobNumber: string, rows: MaterialRow[]) => void;";
const pageCallbackAfter = "onSaveMaterials: (jobOrJobNumber: JobCardData | string, rows: MaterialRow[]) => void | Promise<void>;";
replaceAll('src/components/portal/JobsPages.tsx', pageCallbackBefore, pageCallbackAfter);
replaceAll('src/components/portal/CalendarPage.tsx', pageCallbackBefore, pageCallbackAfter);
replaceAll('src/components/portal/TasksPage.tsx', pageCallbackBefore, pageCallbackAfter);

replaceOnce(
  'src/CompanyPortal.tsx',
  `  const saveJobMaterials = (jobNumber: string, rows: MaterialRow[]) => {
    const cleanRows = normalizeMaterialRows(jobNumber, rows);

    setMaterials((currentRows) => [
      ...currentRows.filter((row) => row.jobNumber !== jobNumber),
      ...cleanRows,
    ]);

    if (!selectedCompanyId) return Promise.resolve();
    setJobsStatus('Saving materials...');
    return saveJobMaterialsToBackend(selectedCompanyId, jobNumber, cleanRows)
      .then((savedMaterials) => {
        setMaterials(savedMaterials);
        setJobsStatus('Materials saved.');
      })
      .catch((error) => {
        setJobsStatus(error instanceof Error ? error.message : 'Materials could not be saved.');
        throw error;
      });
  };
`,
  `  const saveJobMaterials = (jobOrJobNumber: ServiceJob | string, rows: MaterialRow[]) => {
    const jobNumber = typeof jobOrJobNumber === 'string' ? jobOrJobNumber : jobOrJobNumber.jobNumber;
    const cleanRows = normalizeMaterialRows(jobNumber, rows);

    setMaterials((currentRows) => [
      ...currentRows.filter((row) => row.jobNumber !== jobNumber),
      ...cleanRows,
    ]);

    if (!selectedCompanyId) return Promise.resolve();
    setJobsStatus('Saving materials...');
    return saveJobMaterialsToBackend(selectedCompanyId, jobOrJobNumber, cleanRows)
      .then((savedMaterials) => {
        setMaterials(savedMaterials);
        setJobsStatus('Materials saved.');
      })
      .catch((error) => {
        setJobsStatus(error instanceof Error ? error.message : 'Materials could not be saved.');
        throw error;
      });
  };
`,
  'const saveJobMaterials = (jobOrJobNumber: ServiceJob | string, rows: MaterialRow[])',
);

const createFormLogic = `}) {
  const createAttentionFields = ['organization', 'issue', 'clientName', 'phone', 'address', 'technician'];
  const createSearchFields = ['organization', 'clientName', 'phone', 'email', 'address'];
  const [createTouchedFields, setCreateTouchedFields] = useState<Record<string, boolean>>({});
  const [createFieldValues, setCreateFieldValues] = useState<Record<string, string>>({});

  const normalizeCreateText = (value: string) => value.trim().toLowerCase();
  const createDigits = (value: string) => value.replace(/\\D/g, '');
  const updateCreateField = (field: string, value: string) => {
    setCreateFieldValues((values) => ({ ...values, [field]: value }));
  };
  const touchCreateField = (field: string, value: string) => {
    updateCreateField(field, value);
    setCreateTouchedFields((fields) => ({ ...fields, [field]: true }));
  };
  const createFieldNeedsAttention = (field: string) => Boolean(createTouchedFields[field]) && !String(createFieldValues[field] ?? '').trim();
  const createFieldClass = (field: string) => (createFieldNeedsAttention(field) ? 'create-field-missing' : undefined);
  const createFieldHint = (field: string, label: string) => createFieldNeedsAttention(field)
    ? <span className="create-field-warning">{label} is empty. The job can still be created.</span>
    : null;
  const createCustomerMatches = useMemo(() => {
    const tokens = createSearchFields
      .flatMap((field) => normalizeCreateText(createFieldValues[field] ?? '').split(/\\s+/))
      .filter((token) => token.length >= 2);
    const digitTokens = createSearchFields
      .map((field) => createDigits(createFieldValues[field] ?? ''))
      .filter((token) => token.length >= 4);

    if (!tokens.length && !digitTokens.length) return [];

    return customers
      .filter((customer) => {
        const textHaystack = normalizeCreateText([
          customer.organization,
          customer.primaryName,
          customer.primaryEmail,
          customer.primaryPhone,
          customer.address,
        ].join(' '));
        const digitHaystack = createDigits([customer.primaryPhone, customer.address].join(' '));

        return tokens.some((token) => textHaystack.includes(token)) || digitTokens.some((token) => digitHaystack.includes(token));
      })
      .slice(0, 6);
  }, [customers, createFieldValues]);
  const applyCustomerToCreateForm = (customer: Customer) => {
    setCreateFieldValues((values) => ({
      ...values,
      organization: customer.organization,
      clientName: customer.primaryName,
      phone: customer.primaryPhone,
      email: customer.primaryEmail,
      address: customer.address,
    }));
    setCreateTouchedFields((fields) => ({
      ...fields,
      organization: true,
      clientName: true,
      phone: true,
      email: true,
      address: true,
    }));
  };
  const handleCreateSubmit = (event: FormEvent<HTMLFormElement>) => {
    const form = new FormData(event.currentTarget);
    const nextValues = Object.fromEntries([...createAttentionFields, 'email'].map((field) => [field, String(form.get(field) ?? '')]));

    setCreateFieldValues((values) => ({ ...values, ...nextValues }));
    setCreateTouchedFields((fields) => ({
      ...fields,
      ...Object.fromEntries(createAttentionFields.map((field) => [field, true])),
    }));
    onCreateJob(event);
  };

  if (openedJob) {
`;

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  `}) {
  if (openedJob) {
`,
  createFormLogic,
  'const createCustomerMatches = useMemo',
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  `  const createAttentionFields = ['organization', 'issue', 'clientName', 'phone', 'address', 'technician'];
  const [createTouchedFields, setCreateTouchedFields] = useState<Record<string, boolean>>({});
  const [createFieldValues, setCreateFieldValues] = useState<Record<string, string>>({});

  const updateCreateField = (field: string, value: string) => {
    setCreateFieldValues((values) => ({ ...values, [field]: value }));
  };
  const touchCreateField = (field: string, value: string) => {
    updateCreateField(field, value);
    setCreateTouchedFields((fields) => ({ ...fields, [field]: true }));
  };
  const createFieldNeedsAttention = (field: string) => Boolean(createTouchedFields[field]) && !String(createFieldValues[field] ?? '').trim();
  const createFieldClass = (field: string) => (createFieldNeedsAttention(field) ? 'create-field-missing' : undefined);
  const createFieldHint = (field: string, label: string) => createFieldNeedsAttention(field)
    ? <span className="create-field-warning">{label} is empty. The job can still be created.</span>
    : null;
  const handleCreateSubmit = (event: FormEvent<HTMLFormElement>) => {
    const form = new FormData(event.currentTarget);
    const nextValues = Object.fromEntries(createAttentionFields.map((field) => [field, String(form.get(field) ?? '')]));

    setCreateFieldValues((values) => ({ ...values, ...nextValues }));
    setCreateTouchedFields((fields) => ({
      ...fields,
      ...Object.fromEntries(createAttentionFields.map((field) => [field, true])),
    }));
    onCreateJob(event);
  };

  if (openedJob) {
`,
  createFormLogic,
  'const createCustomerMatches = useMemo',
);

replaceOnce('src/components/portal/JobsPages.tsx', '<form className="job-form" onSubmit={onCreateJob}>', '<form className="job-form" onSubmit={handleCreateSubmit}>', 'onSubmit={handleCreateSubmit}');

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  `      <form className="job-form" onSubmit={handleCreateSubmit}>`,
  `      {createCustomerMatches.length ? (
        <div className="create-customer-matches">
          <strong>Existing client found</strong>
          <span>Click a client to fill company, name, phone, email and address.</span>
          <div>
            {createCustomerMatches.map((customer) => (
              <button type="button" key={customer.id} onClick={() => applyCustomerToCreateForm(customer)}>
                <b>{customer.primaryName || customer.organization || 'Unnamed client'}</b>
                <small>{[customer.organization, customer.primaryPhone, customer.address].filter(Boolean).join(' • ')}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <form className="job-form" onSubmit={handleCreateSubmit}>`,
  'create-customer-matches',
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  '<input name="organization" placeholder="Organization / Company" />',
  `<div className="create-field-control">
            <input name="organization" placeholder="Organization / Company" value={createFieldValues.organization ?? ''} className={createFieldClass('organization')} onChange={(event) => updateCreateField('organization', event.target.value)} onBlur={(event) => touchCreateField('organization', event.target.value)} />
            {createFieldHint('organization', 'Company')}
          </div>`,
  "createFieldValues.organization",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  `<div className="create-field-control">
            <input name="organization" placeholder="Organization / Company" className={createFieldClass('organization')} onChange={(event) => updateCreateField('organization', event.target.value)} onBlur={(event) => touchCreateField('organization', event.target.value)} />
            {createFieldHint('organization', 'Company')}
          </div>`,
  `<div className="create-field-control">
            <input name="organization" placeholder="Organization / Company" value={createFieldValues.organization ?? ''} className={createFieldClass('organization')} onChange={(event) => updateCreateField('organization', event.target.value)} onBlur={(event) => touchCreateField('organization', event.target.value)} />
            {createFieldHint('organization', 'Company')}
          </div>`,
  "createFieldValues.organization",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  '<input name="issue" placeholder="Describe the issue" />',
  `<div className="create-field-control">
            <input name="issue" placeholder="Describe the issue" value={createFieldValues.issue ?? ''} className={createFieldClass('issue')} onChange={(event) => updateCreateField('issue', event.target.value)} onBlur={(event) => touchCreateField('issue', event.target.value)} />
            {createFieldHint('issue', 'Issue description')}
          </div>`,
  "createFieldValues.issue",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  `<div className="create-field-control">
            <input name="issue" placeholder="Describe the issue" className={createFieldClass('issue')} onChange={(event) => updateCreateField('issue', event.target.value)} onBlur={(event) => touchCreateField('issue', event.target.value)} />
            {createFieldHint('issue', 'Issue description')}
          </div>`,
  `<div className="create-field-control">
            <input name="issue" placeholder="Describe the issue" value={createFieldValues.issue ?? ''} className={createFieldClass('issue')} onChange={(event) => updateCreateField('issue', event.target.value)} onBlur={(event) => touchCreateField('issue', event.target.value)} />
            {createFieldHint('issue', 'Issue description')}
          </div>`,
  "createFieldValues.issue",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  '<input name="clientName" placeholder="Client name" />',
  `<div className="create-field-control">
            <input name="clientName" placeholder="Client name" value={createFieldValues.clientName ?? ''} className={createFieldClass('clientName')} onChange={(event) => updateCreateField('clientName', event.target.value)} onBlur={(event) => touchCreateField('clientName', event.target.value)} />
            {createFieldHint('clientName', 'Client name')}
          </div>`,
  "createFieldValues.clientName",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  `<div className="create-field-control">
            <input name="clientName" placeholder="Client name" className={createFieldClass('clientName')} onChange={(event) => updateCreateField('clientName', event.target.value)} onBlur={(event) => touchCreateField('clientName', event.target.value)} />
            {createFieldHint('clientName', 'Client name')}
          </div>`,
  `<div className="create-field-control">
            <input name="clientName" placeholder="Client name" value={createFieldValues.clientName ?? ''} className={createFieldClass('clientName')} onChange={(event) => updateCreateField('clientName', event.target.value)} onBlur={(event) => touchCreateField('clientName', event.target.value)} />
            {createFieldHint('clientName', 'Client name')}
          </div>`,
  "createFieldValues.clientName",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  '<input name="phone" placeholder="Phone" />',
  `<div className="create-field-control">
            <input name="phone" placeholder="Phone" value={createFieldValues.phone ?? ''} className={createFieldClass('phone')} onChange={(event) => updateCreateField('phone', event.target.value)} onBlur={(event) => touchCreateField('phone', event.target.value)} />
            {createFieldHint('phone', 'Phone')}
          </div>`,
  "createFieldValues.phone",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  `<div className="create-field-control">
            <input name="phone" placeholder="Phone" className={createFieldClass('phone')} onChange={(event) => updateCreateField('phone', event.target.value)} onBlur={(event) => touchCreateField('phone', event.target.value)} />
            {createFieldHint('phone', 'Phone')}
          </div>`,
  `<div className="create-field-control">
            <input name="phone" placeholder="Phone" value={createFieldValues.phone ?? ''} className={createFieldClass('phone')} onChange={(event) => updateCreateField('phone', event.target.value)} onBlur={(event) => touchCreateField('phone', event.target.value)} />
            {createFieldHint('phone', 'Phone')}
          </div>`,
  "createFieldValues.phone",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  '<input name="email" type="email" placeholder="Email" />',
  `<input name="email" type="email" placeholder="Email" value={createFieldValues.email ?? ''} onChange={(event) => updateCreateField('email', event.target.value)} onBlur={(event) => touchCreateField('email', event.target.value)} />`,
  "createFieldValues.email",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  `<select name="technician" defaultValue="">
            <option value="">--</option>
            {profile.technicians.map((technician) => (
              <option value={technician.name} key={technician.id}>
                {technician.name}
              </option>
            ))}
          </select>`,
  `<div className="create-field-control">
            <select name="technician" value={createFieldValues.technician ?? ''} className={createFieldClass('technician')} onChange={(event) => updateCreateField('technician', event.target.value)} onBlur={(event) => touchCreateField('technician', event.target.value)}>
              <option value="">--</option>
              {profile.technicians.map((technician) => (
                <option value={technician.name} key={technician.id}>
                  {technician.name}
                </option>
              ))}
            </select>
            {createFieldHint('technician', 'Technician')}
          </div>`,
  "createFieldValues.technician",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  `<div className="create-field-control">
            <select name="technician" defaultValue="" className={createFieldClass('technician')} onChange={(event) => updateCreateField('technician', event.target.value)} onBlur={(event) => touchCreateField('technician', event.target.value)}>
              <option value="">--</option>
              {profile.technicians.map((technician) => (
                <option value={technician.name} key={technician.id}>
                  {technician.name}
                </option>
              ))}
            </select>
            {createFieldHint('technician', 'Technician')}
          </div>`,
  `<div className="create-field-control">
            <select name="technician" value={createFieldValues.technician ?? ''} className={createFieldClass('technician')} onChange={(event) => updateCreateField('technician', event.target.value)} onBlur={(event) => touchCreateField('technician', event.target.value)}>
              <option value="">--</option>
              {profile.technicians.map((technician) => (
                <option value={technician.name} key={technician.id}>
                  {technician.name}
                </option>
              ))}
            </select>
            {createFieldHint('technician', 'Technician')}
          </div>`,
  "createFieldValues.technician",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  '<input name="address" placeholder="Address" />',
  `<div className="create-field-control">
            <input name="address" placeholder="Address" value={createFieldValues.address ?? ''} className={createFieldClass('address')} onChange={(event) => updateCreateField('address', event.target.value)} onBlur={(event) => touchCreateField('address', event.target.value)} />
            {createFieldHint('address', 'Address')}
          </div>`,
  "createFieldValues.address",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  `<div className="create-field-control">
            <input name="address" placeholder="Address" className={createFieldClass('address')} onChange={(event) => updateCreateField('address', event.target.value)} onBlur={(event) => touchCreateField('address', event.target.value)} />
            {createFieldHint('address', 'Address')}
          </div>`,
  `<div className="create-field-control">
            <input name="address" placeholder="Address" value={createFieldValues.address ?? ''} className={createFieldClass('address')} onChange={(event) => updateCreateField('address', event.target.value)} onBlur={(event) => touchCreateField('address', event.target.value)} />
            {createFieldHint('address', 'Address')}
          </div>`,
  "createFieldValues.address",
);

const createJobAttentionCss = `

.create-field-control {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.job-form input.create-field-missing,
.job-form select.create-field-missing,
.job-form textarea.create-field-missing {
  border-color: #f59e0b;
  background: #fff7ed;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2);
}

.create-field-warning {
  color: #b45309;
  font-size: 11px;
  font-weight: 900;
  line-height: 1.25;
}

.create-customer-matches {
  display: grid;
  gap: 8px;
  margin: 0 0 16px;
  border: 1px solid #bfdbfe;
  border-radius: 10px;
  background: #eff6ff;
  padding: 12px;
  color: #1e3a8a;
}

.create-customer-matches > span {
  color: #475569;
  font-size: 12px;
  font-weight: 800;
}

.create-customer-matches > div {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}

.create-customer-matches button {
  display: grid;
  gap: 3px;
  border: 1px solid #93c5fd;
  border-radius: 8px;
  background: #ffffff;
  padding: 9px 10px;
  color: #17201b;
  text-align: left;
  cursor: pointer;
}

.create-customer-matches button:hover {
  border-color: #2563eb;
  box-shadow: 0 8px 18px rgba(37, 99, 235, 0.12);
}

.create-customer-matches small {
  color: #64748b;
  font-size: 11px;
  font-weight: 800;
}
`;

const baseCssPath = path.join(root, 'src/styles/base.css');
const baseCss = fs.readFileSync(baseCssPath, 'utf8');
if (!baseCss.includes('.create-customer-matches')) {
  fs.writeFileSync(baseCssPath, `${baseCss}${createJobAttentionCss}`);
}

console.log('Job material save, create form attention, and customer autofill patches applied.');
