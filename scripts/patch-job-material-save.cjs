const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content);
}

function replaceOnce(relativePath, before, after, alreadyPatchedMarker) {
  const filePath = path.join(root, relativePath);
  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes(alreadyPatchedMarker)) return;
  if (!content.includes(before)) {
    throw new Error(`Patch target not found in ${relativePath}`);
  }

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

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  `}) {
  if (openedJob) {
`,
  `}) {
  const createAttentionFields = ['organization', 'issue', 'clientName', 'phone', 'address', 'technician'];
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
  'const createAttentionFields = [',
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  '<form className="job-form" onSubmit={onCreateJob}>',
  '<form className="job-form" onSubmit={handleCreateSubmit}>',
  'onSubmit={handleCreateSubmit}',
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  '<input name="organization" placeholder="Organization / Company" />',
  `<div className="create-field-control">
            <input name="organization" placeholder="Organization / Company" className={createFieldClass('organization')} onChange={(event) => updateCreateField('organization', event.target.value)} onBlur={(event) => touchCreateField('organization', event.target.value)} />
            {createFieldHint('organization', 'Company')}
          </div>`,
  "createFieldClass('organization')",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  '<input name="issue" placeholder="Describe the issue" />',
  `<div className="create-field-control">
            <input name="issue" placeholder="Describe the issue" className={createFieldClass('issue')} onChange={(event) => updateCreateField('issue', event.target.value)} onBlur={(event) => touchCreateField('issue', event.target.value)} />
            {createFieldHint('issue', 'Issue description')}
          </div>`,
  "createFieldClass('issue')",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  '<input name="clientName" placeholder="Client name" />',
  `<div className="create-field-control">
            <input name="clientName" placeholder="Client name" className={createFieldClass('clientName')} onChange={(event) => updateCreateField('clientName', event.target.value)} onBlur={(event) => touchCreateField('clientName', event.target.value)} />
            {createFieldHint('clientName', 'Client name')}
          </div>`,
  "createFieldClass('clientName')",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  '<input name="phone" placeholder="Phone" />',
  `<div className="create-field-control">
            <input name="phone" placeholder="Phone" className={createFieldClass('phone')} onChange={(event) => updateCreateField('phone', event.target.value)} onBlur={(event) => touchCreateField('phone', event.target.value)} />
            {createFieldHint('phone', 'Phone')}
          </div>`,
  "createFieldClass('phone')",
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
  "createFieldClass('technician')",
);

replaceOnce(
  'src/components/portal/JobsPages.tsx',
  '<input name="address" placeholder="Address" />',
  `<div className="create-field-control">
            <input name="address" placeholder="Address" className={createFieldClass('address')} onChange={(event) => updateCreateField('address', event.target.value)} onBlur={(event) => touchCreateField('address', event.target.value)} />
            {createFieldHint('address', 'Address')}
          </div>`,
  "createFieldClass('address')",
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
`;

const baseCssPath = path.join(root, 'src/styles/base.css');
const baseCss = fs.readFileSync(baseCssPath, 'utf8');
if (!baseCss.includes('.create-field-control')) {
  fs.writeFileSync(baseCssPath, `${baseCss}${createJobAttentionCss}`);
}

console.log('Job material save and create form attention patches applied.');
