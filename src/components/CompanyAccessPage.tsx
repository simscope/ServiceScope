import { AlertTriangle, Building2, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { BillingStatus, Company, CompanyStatus } from '../types';
import { billingLabels, statusLabels } from '../appLabels';
import { MetricCard } from './OwnerPages';

export type CompanyAccessMode = 'full' | 'limited' | 'locked';

export function companyAccessMode(company: Company): CompanyAccessMode {
  if (company.status === 'paused' || company.billingStatus === 'overdue') return 'locked';
  if (company.status === 'setup' || company.billingStatus === 'not_started') return 'limited';
  return 'full';
}

export function companyPatchForAccessMode(mode: CompanyAccessMode): Partial<Pick<Company, 'status' | 'billingStatus' | 'lastSync'>> {
  if (mode === 'full') return { status: 'active' as CompanyStatus, billingStatus: 'paid' as BillingStatus, lastSync: 'Access restored' };
  if (mode === 'limited') return { status: 'setup' as CompanyStatus, billingStatus: 'not_started' as BillingStatus, lastSync: 'Access limited' };
  return { status: 'paused' as CompanyStatus, billingStatus: 'overdue' as BillingStatus, lastSync: 'Access locked' };
}

const rules: Record<CompanyAccessMode, { label: string; allowed: string[]; blocked: string[] }> = {
  full: { label: 'Full access', allowed: ['Jobs', 'Calendar', 'Materials', 'Email', 'Invoices', 'Uploads', 'Library', 'Finance'], blocked: [] },
  limited: { label: 'Limited access', allowed: ['Dashboard', 'Billing', 'Support', 'Read-only data'], blocked: ['Create jobs', 'Edit jobs', 'Send email', 'Invoices', 'Uploads', 'Materials save'] },
  locked: { label: 'Locked', allowed: ['Billing', 'Support', 'Read-only data'], blocked: ['Create/edit jobs', 'Send email', 'Invoices', 'Uploads', 'Library changes', 'Technician access'] },
};

export function CompanyAccessPage({ companies, onChangeCompanyAccess }: { companies: Company[]; onChangeCompanyAccess: (companyId: string, mode: CompanyAccessMode) => void }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | CompanyAccessMode>('all');
  const rows = companies.map((company) => ({ company, mode: companyAccessMode(company) }));
  const visibleRows = rows.filter(({ company, mode }) => {
    const query = search.trim().toLowerCase();
    const haystack = [company.name, company.ownerName, company.ownerEmail, company.market, statusLabels[company.status], billingLabels[company.billingStatus], rules[mode].label].join(' ').toLowerCase();
    return (filter === 'all' || filter === mode) && (!query || haystack.includes(query));
  });

  return (
    <div className="access-command-center company-access-page">
      <section className="access-summary">
        <MetricCard icon={<Building2 size={20} />} label="Companies" value={companies.length.toString()} detail="Tenant workspaces" />
        <MetricCard icon={<CheckCircle2 size={20} />} label="Full access" value={rows.filter((row) => row.mode === 'full').length.toString()} detail="Working normally" />
        <MetricCard icon={<ShieldCheck size={20} />} label="Limited" value={rows.filter((row) => row.mode === 'limited').length.toString()} detail="Owner restrictions" />
        <MetricCard icon={<AlertTriangle size={20} />} label="Locked" value={rows.filter((row) => row.mode === 'locked').length.toString()} detail="Work tools off" />
      </section>

      <section className="panel company-access-panel">
        <div className="panel-heading"><div><p className="eyebrow">Owner controls</p><h2>Company access</h2></div><ShieldCheck size={20} aria-hidden="true" /></div>
        <div className="company-access-toolbar">
          <label>Search company<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Company, owner, billing status" /></label>
          <label>Access<select value={filter} onChange={(event) => setFilter(event.target.value as 'all' | CompanyAccessMode)}><option value="all">All</option><option value="full">Full</option><option value="limited">Limited</option><option value="locked">Locked</option></select></label>
          <button className="secondary-button compact" type="button" onClick={() => { setSearch(''); setFilter('all'); }}>Reset</button>
        </div>
        <div className="company-access-list">
          {visibleRows.map(({ company, mode }) => {
            const rule = rules[mode];
            return (
              <article className={'company-access-row ' + mode} key={company.id}>
                <div className="company-main"><div className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</div><div><h3>{company.name}</h3><p>{company.ownerEmail} · {company.market}</p></div></div>
                <div className="company-access-status"><span>Status</span><strong>{statusLabels[company.status]} · {billingLabels[company.billingStatus]}</strong><em className={'company-access-pill ' + mode}>{rule.label}</em></div>
                <label className="company-access-select">Owner access<select value={mode} onChange={(event) => onChangeCompanyAccess(company.id, event.target.value as CompanyAccessMode)}><option value="full">Full access</option><option value="limited">Limited access</option><option value="locked">Locked</option></select></label>
                <div className="company-access-rules"><span>Allowed</span><div className="page-chip-list compact allowed-list">{rule.allowed.map((item) => <b key={item}>{item}</b>)}</div>{rule.blocked.length ? <><span>Blocked</span><div className="page-chip-list compact blocked-list">{rule.blocked.map((item) => <b key={item}>{item}</b>)}</div></> : null}</div>
                <div className="company-access-actions"><button className="secondary-button compact" type="button" onClick={() => onChangeCompanyAccess(company.id, 'limited')}>Limit</button><button className="secondary-button compact danger-button" type="button" onClick={() => onChangeCompanyAccess(company.id, 'locked')}>Lock</button><button className="primary-button compact" type="button" onClick={() => onChangeCompanyAccess(company.id, 'full')}>Restore</button></div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
