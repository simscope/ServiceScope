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

console.log('Job material save patch applied.');
