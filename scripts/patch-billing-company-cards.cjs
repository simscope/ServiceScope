const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src/components/OwnerPages.tsx');
const cssFile = path.join(root, 'src/styles/responsive.css');

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, v) { fs.writeFileSync(p, v); }

let s = read(file);

if (!s.includes('expandedBillingCompanyId')) {
  s = s.replace(
    "  const revenueAtRisk = billingRiskCompanies.reduce((total, company) => total + getCompanyPlan(company).price, 0);",
    "  const revenueAtRisk = billingRiskCompanies.reduce((total, company) => total + getCompanyPlan(company).price, 0);\n  const [expandedBillingCompanyId, setExpandedBillingCompanyId] = useState(() => companies[0]?.id ?? '');\n  const getAccessProfile = (company: Company, autopayReady: boolean) => {\n    if (company.billingStatus === 'overdue') return { mode: 'stop' as const, label: 'Limited', note: 'Invoice, email, reports, dispatch changes and new job creation should stay limited until payment is current.', items: ['New jobs', 'Invoices', 'Email', 'Reports', 'Dispatch changes'], action: 'Collect payment and mark paid to restore access.' };\n    if (company.billingStatus === 'not_started') return { mode: 'setup' as const, label: 'Setup', note: 'Subscription is not started. Keep live customer functions limited before go-live.', items: ['Live jobs', 'Customer invoices', 'Email', 'Portal payments'], action: 'Start billing or move tenant to trialing/paid.' };\n    if (!autopayReady) return { mode: 'warn' as const, label: 'Autopay missing', note: 'A card is needed for automatic monthly billing.', items: ['Auto billing', 'Auto renewal', 'Go-live approval'], action: 'Ask admin to connect a subscription card.' };\n    return { mode: 'ok' as const, label: 'Full', note: 'Billing is healthy. No billing limits recommended.', items: ['No billing limits'], action: 'Monitor usage and health.' };\n  };\n  const getOnboardingProgress = (company: Company) => {\n    const steps = Object.values(company.onboarding);\n    return Math.round((steps.filter((step) => step === 'done').length / (steps.length || 1)) * 100);\n  };",
  );
}

const start = s.indexOf('        <div className="subscription-list">');
const end = s.indexOf('        </div>\n      </section>\n    </div>\n  );\n}\n\ntype MonitoringSignal', start);

if (start !== -1 && end !== -1 && !s.includes('billing-company-card')) {
  const replacement = `        <div className="subscription-list">
          {companies.map((company) => {
            const plan = getCompanyPlan(company);
            const paymentProfile = getPaymentProfile(company);
            const autopayReady = hasAutopay(company);
            const accessProfile = getAccessProfile(company, autopayReady);
            const onboardingProgress = getOnboardingProgress(company);
            const isExpanded = expandedBillingCompanyId === company.id;
            const storagePercent = Math.min(100, Math.round((company.usage.storageGb / (plan.storageGb || 1)) * 100));

            return (
              <article className={\`subscription-row billing-company-card \${isExpanded ? 'expanded' : ''}\`} key={company.id}>
                <div className="company-main billing-company-main">
                  <button className="company-avatar billing-company-toggle" type="button" onClick={() => setExpandedBillingCompanyId(isExpanded ? '' : company.id)}>
                    {company.name.slice(0, 2).toUpperCase()}
                  </button>
                  <div>
                    <h3>{company.name}</h3>
                    <p>{company.ownerEmail}</p>
                    <div className="billing-company-tags">
                      <span>{company.market || 'No market'}</span>
                      <span>{company.domain || 'No domain'}</span>
                    </div>
                  </div>
                </div>
                <div className="billing-cell">
                  <span>Plan</span>
                  <select value={company.plan} onChange={(event) => onChangePlan(company.id, event.target.value as CompanyPlan)}>
                    {plans.map((candidatePlan) => (
                      <option value={candidatePlan.name} key={candidatePlan.name}>{candidatePlan.name}</option>
                    ))}
                  </select>
                </div>
                <div className="billing-cell">
                  <span>Status</span>
                  <select value={company.billingStatus} onChange={(event) => onChangeBillingStatus(company.id, event.target.value as BillingStatus)}>
                    <option value="paid">Paid</option>
                    <option value="trialing">Trialing</option>
                    <option value="overdue">Overdue</option>
                    <option value="not_started">Not started</option>
                  </select>
                </div>
                <div className="billing-cell"><span>Autopay</span><strong>{autopayReady ? 'On' : 'Off'}</strong></div>
                <div className="billing-cell billing-card-cell"><span>Card</span><strong>{paymentProfile?.subscriptionCardLast4 ? \`\${paymentProfile.subscriptionCardBrand} \${paymentProfile.subscriptionCardLast4}\` : 'Missing'}</strong></div>
                <div className="billing-cell billing-access-cell"><span>Access</span><strong>{accessProfile.label}</strong></div>
                <button className="secondary-button compact billing-open-card-button" type="button" onClick={() => setExpandedBillingCompanyId(isExpanded ? '' : company.id)}>{isExpanded ? 'Hide details' : 'View details'}</button>
                <span className={\`billing-pill \${company.billingStatus}\`}>{billingLabels[company.billingStatus]}</span>

                {isExpanded ? (
                  <div className="billing-company-details">
                    <div className={\`billing-access-card \${accessProfile.mode}\`}>
                      <div>
                        <span className={\`access-mode \${accessProfile.mode === 'stop' ? 'blocked' : accessProfile.mode === 'warn' || accessProfile.mode === 'setup' ? 'limited' : 'full'}\`}>{accessProfile.label}</span>
                        <h3>{accessProfile.note}</h3>
                        <p>{accessProfile.action}</p>
                      </div>
                      <div className="billing-access-list">
                        {accessProfile.items.map((item) => <span key={item}>{item}</span>)}
                      </div>
                    </div>

                    <dl className="billing-company-facts">
                      <div><dt>Owner</dt><dd>{company.ownerName || 'Not set'}</dd></div>
                      <div><dt>Tenant status</dt><dd>{statusLabels[company.status]}</dd></div>
                      <div><dt>MRR</dt><dd>{money(plan.price)}/mo</dd></div>
                      <div><dt>Health</dt><dd>{company.health}%</dd></div>
                      <div><dt>Open jobs</dt><dd>{company.openJobs}</dd></div>
                      <div><dt>Technicians</dt><dd>{company.technicians} / {plan.technicians}</dd></div>
                      <div><dt>Seats</dt><dd>{company.seats} / {plan.seats}</dd></div>
                      <div><dt>Storage</dt><dd>{company.usage.storageGb.toFixed(1)} / {plan.storageGb} GB</dd></div>
                    </dl>

                    <div className="billing-company-progress">
                      <div><span>Onboarding</span><strong>{onboardingProgress}%</strong></div>
                      <div className="health-track"><span style={{ width: \`\${onboardingProgress}%\` }} /></div>
                      <div><span>Storage usage</span><strong>{storagePercent}%</strong></div>
                      <div className="health-track"><span style={{ width: \`\${storagePercent}%\` }} /></div>
                    </div>

                    <div className="billing-company-actions">
                      <button className="secondary-button compact" type="button" onClick={() => onChangeBillingStatus(company.id, 'overdue')}>Flag overdue</button>
                      <button className="secondary-button compact" type="button" onClick={() => onChangeBillingStatus(company.id, 'trialing')}>Move to trial</button>
                      <button className="primary-button compact" type="button" onClick={() => onChangeBillingStatus(company.id, 'paid')}>Mark paid / restore</button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>`;
  s = s.slice(0, start) + replacement + s.slice(end, end + '        </div>'.length) + s.slice(end + '        </div>'.length);
}

write(file, s);

let css = read(cssFile);
if (!css.includes('Expandable billing company cards')) {
  css += `

/* Expandable billing company cards */
.billing-company-card { align-items: start; }
.billing-company-card.expanded { border-color: #9fc2ff; box-shadow: 0 12px 28px rgba(45, 89, 160, 0.12); }
.billing-company-main { align-items: flex-start; }
.billing-company-toggle { border: 0; cursor: pointer; }
.billing-company-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.billing-company-tags span { border-radius: 999px; background: #eef4ef; color: #4f5b53; padding: 3px 8px; font-size: 11px; font-weight: 800; }
.billing-open-card-button { align-self: center; }
.billing-company-details { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(260px, 1.1fr) minmax(320px, 1.4fr); gap: 14px; width: 100%; border-top: 1px solid #e3e9e4; margin-top: 8px; padding-top: 14px; }
.billing-access-card { display: grid; gap: 12px; border: 1px solid #dce4dd; border-radius: 10px; background: #fbfdfb; padding: 14px; }
.billing-access-card.stop { border-color: #efb3a8; background: #fff8f6; }
.billing-access-card.warn, .billing-access-card.setup { border-color: #f2c779; background: #fffaf0; }
.billing-access-card.ok { border-color: #b9d7b7; background: #f7fbec; }
.billing-access-card h3 { margin: 8px 0 4px; font-size: 16px; }
.billing-access-card p { margin-bottom: 0; color: #4f5b53; font-size: 13px; line-height: 1.45; }
.billing-access-list { display: flex; flex-wrap: wrap; gap: 7px; }
.billing-access-list span { border-radius: 999px; background: #ffffff; border: 1px solid #e3e9e4; padding: 6px 9px; font-size: 12px; font-weight: 900; }
.billing-company-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 0; }
.billing-company-facts div { border: 1px solid #e3e9e4; border-radius: 9px; background: #ffffff; padding: 10px; }
.billing-company-facts dt, .billing-company-progress span { color: #667269; font-size: 11px; font-weight: 900; text-transform: uppercase; }
.billing-company-facts dd { margin: 4px 0 0; color: #17201b; font-size: 13px; font-weight: 900; }
.billing-company-progress { grid-column: 1 / -1; display: grid; gap: 8px; border: 1px solid #e3e9e4; border-radius: 10px; background: #ffffff; padding: 12px; }
.billing-company-progress > div:not(.health-track) { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.billing-company-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; }
@media (max-width: 1120px) { .billing-company-details, .billing-company-facts { grid-template-columns: 1fr 1fr; } }
@media (max-width: 560px) { .billing-company-details, .billing-company-facts { grid-template-columns: 1fr; } }
`;
  write(cssFile, css);
}

console.log('Expandable billing company card patch applied.');
