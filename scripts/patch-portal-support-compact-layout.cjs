const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const cssPath = path.join(root, 'src/styles/responsive.css');

let css = fs.readFileSync(cssPath, 'utf8');

if (!css.includes('Portal support compact two-column layout')) {
  css += `

/* Portal support compact two-column layout */
.portal-page{gap:12px}.portal-page .portal-hero{padding:14px 18px}.portal-metrics{gap:10px}.portal-metrics .metric-card{padding:14px;min-height:96px}.portal-grid{grid-template-columns:minmax(280px,360px) minmax(0,1fr);align-items:start;gap:16px}.portal-support-panel{align-self:start}.portal-ticket-panel{grid-column:auto;align-self:start;min-width:0}.portal-ticket-list{gap:8px}.portal-ticket-row{min-height:auto;padding:12px}.portal-ticket-thread{align-items:stretch}.portal-ticket-thread-header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:12px}.portal-ticket-messages{max-height:320px;overflow:auto}.portal-ticket-message{padding:8px 10px}.portal-request-form{gap:10px}.portal-request-form textarea{min-height:96px}.portal-request-form .form-row{gap:10px}.portal-request-form button{min-height:42px}
@media (max-width: 980px){.portal-grid{grid-template-columns:1fr}.portal-ticket-panel{grid-column:auto}.portal-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width: 620px){.portal-metrics{grid-template-columns:1fr}.portal-page .portal-hero{align-items:flex-start;flex-direction:column}.portal-grid{gap:12px}}
`;
  fs.writeFileSync(cssPath, css);
}

console.log('Portal support compact layout patch applied.');
