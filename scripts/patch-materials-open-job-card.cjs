const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const portalFile = path.join(root, 'src/CompanyPortal.tsx');
const materialsFile = path.join(root, 'src/components/portal/MaterialsPage.tsx');
const cssFile = path.join(root, 'src/styles/responsive.css');

let portal = fs.readFileSync(portalFile, 'utf8');
portal = portal.replace(
  '            onOpenJob={setOpenedJob}\n            filteredMaterialRows={filteredMaterialRows}',
  "            onOpenJob={(job) => {\n              setOpenedJob(job);\n              setClientPage('jobs');\n            }}\n            filteredMaterialRows={filteredMaterialRows}",
);
fs.writeFileSync(portalFile, portal);

let materials = fs.readFileSync(materialsFile, 'utf8');
materials = materials.replace(
  '                <tr key={material.id}>',
  '                <tr key={material.id} className="materials-clickable-row" onClick={() => onOpenJob(job)}>',
);
materials = materials.replace(
  '<select\n                      className={`material-status-select ${statusClassName(currentStatus)}`}',
  '<select\n                      onClick={(event) => event.stopPropagation()}\n                      className={`material-status-select ${statusClassName(currentStatus)}`}',
);
materials = materials.replace(
  '<button className="secondary-button compact" type="button" onClick={() => onOpenMaterialEditor(job.jobNumber)}>',
  '<button className="secondary-button compact" type="button" onClick={(event) => { event.stopPropagation(); onOpenMaterialEditor(job.jobNumber); }}>',
);
fs.writeFileSync(materialsFile, materials);

let css = fs.readFileSync(cssFile, 'utf8');
if (!css.includes('Materials job card open fixes')) {
  css += `

/* Materials job card open fixes */
.materials-clickable-row {
  cursor: pointer;
}

.materials-clickable-row:hover {
  background: #f8fbff;
}

.materials-clickable-row .job-number-link {
  position: relative;
  z-index: 1;
}
`;
  fs.writeFileSync(cssFile, css);
}

console.log('Materials open job card patch applied.');
