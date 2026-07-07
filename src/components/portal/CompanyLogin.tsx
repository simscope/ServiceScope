import { Building2, ShieldCheck } from 'lucide-react';
import { StatusPill } from '../OwnerPages';
import type { Company } from '../../types';

export function CompanyLogin({
  companies,
  email,
  onEmailChange,
  onSelectCompany,
}: {
  companies: Company[];
  email: string;
  onEmailChange: (email: string) => void;
  onSelectCompany: (companyId: string) => void;
}) {
  const matchingCompanies = companies.filter((company) =>
    !email.trim() || company.ownerEmail.toLowerCase().includes(email.trim().toLowerCase()),
  );

  return (
    <div className="company-login">
      <section className="company-login-card">
        <div className="brand-lockup company-brand">
          <div className="brand-mark">
            <ShieldCheck size={22} aria-hidden="true" />
          </div>
          <div>
            <strong>ServiceScope</strong>
            <span>Company Access</span>
          </div>
        </div>

        <div className="login-heading">
          <p className="eyebrow">Company login</p>
          <h1>Enter your workspace</h1>
          <p>Companies use this separate entrance to send requests, check launch status, and track support replies.</p>
        </div>

        <label>
          Owner email
          <input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="Owner email" />
        </label>

        <div className="login-company-list">
          {matchingCompanies.map((company) => (
            <button className="login-company-row" type="button" key={company.id} onClick={() => onSelectCompany(company.id)}>
              <div className="company-main">
                <div className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</div>
                <div>
                  <h3>{company.name}</h3>
                  <p>{company.ownerEmail}</p>
                </div>
              </div>
              <StatusPill status={company.status} />
            </button>
          ))}
          {!matchingCompanies.length ? (
            <div className="empty-state compact-empty">
              <Building2 size={24} aria-hidden="true" />
              <h3>No company found</h3>
              <p>Check the owner email or ask ServiceScope support to verify access.</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
