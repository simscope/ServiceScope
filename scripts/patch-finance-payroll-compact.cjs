const fs = require('fs');
const path = require('path');

const cssFile = path.resolve(__dirname, '../src/styles/responsive.css');
let css = fs.readFileSync(cssFile, 'utf8');

if (!css.includes('Compact finance payroll formula panel')) {
  css += `

/* Compact finance payroll formula panel */
.payroll-rules-panel {
  display: grid;
  grid-template-columns: minmax(260px, 0.65fr) minmax(0, 1.8fr);
  align-items: center;
  gap: 12px;
  padding: 10px 12px !important;
}

.payroll-rules-panel > div:first-child {
  display: grid;
  gap: 2px;
}

.payroll-rules-panel .eyebrow {
  margin-bottom: 0;
  font-size: 11px;
}

.payroll-rules-panel h2 {
  font-size: 18px;
  line-height: 1.05;
}

.payroll-rules-panel p {
  margin: 0;
  color: #4f5b53;
  font-size: 12px;
  line-height: 1.25;
}

.payroll-rule-controls {
  display: grid;
  grid-template-columns: minmax(120px, 0.75fr) minmax(120px, 0.75fr) minmax(160px, 0.85fr) minmax(160px, 0.85fr) minmax(180px, 1fr);
  align-items: end;
  gap: 8px;
}

.payroll-rule-controls label {
  display: grid;
  gap: 3px;
  color: #4f5b53;
  font-size: 11px;
  font-weight: 900;
}

.payroll-rule-controls input {
  min-height: 30px;
  border-radius: 7px;
  padding: 0 8px;
  font-size: 12px;
}

.payroll-rule-controls .payroll-checkbox {
  display: flex;
  min-height: 30px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid #d4ddd6;
  border-radius: 7px;
  background: #f8faf8;
  padding: 4px 8px;
  color: #17201b;
  font-size: 11px;
  line-height: 1.1;
  text-align: right;
}

.payroll-rule-controls .payroll-checkbox input[type='checkbox'] {
  width: 18px;
  min-width: 18px;
  height: 18px;
  min-height: 18px;
  flex: 0 0 18px;
  margin: 0;
  padding: 0;
}

@media (max-width: 1100px) {
  .payroll-rules-panel {
    grid-template-columns: 1fr;
  }

  .payroll-rule-controls {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
`;
  fs.writeFileSync(cssFile, css);
}

console.log('Finance payroll compact patch applied.');
