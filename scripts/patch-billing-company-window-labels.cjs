const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ownerFile = path.join(root, 'src/components/OwnerPages.tsx');
const cssFile = path.join(root, 'src/styles/responsive.css');

let owner = fs.readFileSync(ownerFile, 'utf8');
owner = owner.replace("{isExpanded ? 'Hide details' : 'View details'}", "{isExpanded ? 'Close company window' : 'Open company window'}");
fs.writeFileSync(ownerFile, owner);

let css = fs.readFileSync(cssFile, 'utf8');
if (!css.includes('Billing company rows with opening window')) {
  css += `

/* Billing company rows with opening window */
.billing-company-card {
  position: relative;
}

.billing-company-card.expanded {
  border-color: #60a5fa;
  background: #f8fbff;
}

.billing-company-card.expanded .billing-company-details {
  border: 1px solid #bfdbfe;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 14px 30px rgba(37, 99, 235, 0.12);
  margin-top: 12px;
  padding: 44px 14px 14px;
  position: relative;
}

.billing-company-card.expanded .billing-company-details::before {
  content: 'Company billing window';
  position: absolute;
  left: 14px;
  top: 12px;
  color: #1e3a8a;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.billing-company-card:not(.expanded) {
  box-shadow: none;
}

.billing-company-card:not(.expanded):hover {
  border-color: #93c5fd;
  background: #fbfdff;
}
`;
  fs.writeFileSync(cssFile, css);
}

console.log('Billing company window labels patch applied.');
