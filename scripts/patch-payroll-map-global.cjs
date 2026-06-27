const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../src/CompanyPortal.tsx');
let content = fs.readFileSync(filePath, 'utf8');
content = content
  .replaceAll('new Map(payrollItems.map', 'new globalThis.Map(payrollItems.map')
  .replaceAll('new Map(currentRows.map', 'new globalThis.Map(currentRows.map');
fs.writeFileSync(filePath, content);
console.log('Payroll Map global reference patch applied.');
