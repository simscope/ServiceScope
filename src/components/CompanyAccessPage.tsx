import { AlertTriangle, Building2, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import type { Company, CompanyAccessRules, CompanyPortalAccessLevel, CompanyPortalAccessPage } from '../types';
import { billingLabels, statusLabels } from '../appLabels';
import { MetricCard } from './OwnerPages';

export type CompanyAccessMode = 'full' | 'limited' | 'locked';

type AccessPageDefinition = {
  page: CompanyPortalAccessPage;
  label: string;
  detail: string;
};

export const companyPortalAccessPages: AccessPageDefinition[] = [
  { page: 'jobs', label: 'Jobs', detail: 'Create and edit service jobs' },
  { page: 'allJobs', label: 'All Jobs', detail: 'View full job list and job details' },
  { page: 'debtors', label: 'Debtors', detail: 'Track unpaid completed jobs and payment gaps' },
  { page: 'calendar', label: 'Calendar', detail: 'Schedule and move appointments' },
  { page: 'materials', label: 'Materials', detail: 'Edit material rows and parts' },
  { page: 'tasks', label: 'Tasks', detail: 'Create and complete tasks' },
  { page: 'map', label: 'Map', detail: 'Technician location view' },
  { page: 'email', label: 'Email', detail: 'Mailbox, compose, and send' },
  { page: 'finances', label: 'Finance', detail: 'Invoices, payroll, and money reports' },
  { page: 'knowledge', label: 'Library', detail: 'Manuals and uploaded documents' },
  { page: 'portal', label: 'Portal', detail: 'Support requests and account page' },
  { page: 'onboarding', label: 'Onboarding', detail: 'Company setup, billing, and mailbox settings' },
];

export const accessLevelLabels: Record<CompanyPortalAccessLevel, string> = {
  full: 'Full',
  readonly: 'Read-only',
  off: 'Off',
};

const modeLabels: Record<CompanyAccessMode, string> = {
  full: 'Full access',
  limited: 'Read-only work',
  locked: 'Locked',
};

export function defaultCompanyAccessRules(mode: CompanyAccessMode): Required<CompanyAccessRules> {
  if (mode === 'full') {
    return Object.fromEntries(companyPortalAccessPages.map(({ page }) => [page, 'full'])) as Required<CompanyAccessRules>;
  }

  if (mode === 'limited') {
    return {
      jobs: 'readonly',
      allJobs: 'readonly',
      debtors: 'readonly',
      calendar: 'readonly',
      materials: 'readonly',
      tasks: 'readonly',
      map: 'full',
      email: 'readonly',
      finances: 'readonly',
      knowledge: 'readonly',
      portal: 'full',
      onboarding: 'full',
    };
  }

  return {
    jobs: 'readonly',
    allJobs: 'readonly',
    debtors: 'readonly',
    calendar: 'off',
    materials: 'off',
    tasks: 'off',
    map: 'off',
    email: 'off',
    finances: 'readonly',
    knowledge: 'readonly',
    portal: 'full',
    onboarding: 'full',
  };
}

function fallbackAccessMode(company: Company): CompanyAccessMode {
  if (company.status === 'paused' || company.billingStatus === 'overdue') return 'locked';
  if (company.status === 'setup' || company.billingStatus === 'not_started') return 'limited';
  return 'full';
}

export function resolveCompanyAccessRules(company: Company): Required<CompanyAccessRules> {
  return {
    ...defaultCompanyAccessRules(fallbackAccessMode(company)),
    ...company.accessRules,
    onboarding: company.accessRules?.onboarding ?? defaultCompanyAccessRules(fallbackAccessMode(company)).onboarding,
  };
}

export function companyAccessMode(company: Company): CompanyAccessMode {
  const rules = resolveCompanyAccessRules(company);
  const levels = companyPortalAccessPages.map(({ page }) => rules[page]);

  if (levels.every((level) => level === 'full')) return 'full';
  if (levels.filter((level) => level === 'off').length >= 4) return 'locked';
  return 'limited';
}

export function companyPatchForAccessMode(mode: CompanyAccessMode): Partial<Pick<Company, 'accessRules' | 'lastSync'>> {
  return {
    accessRules: defaultCompanyAccessRules(mode),
    lastSync: mode === 'full' ? 'Access restored' : mode === 'limited' ? 'Access limited' : 'Access locked',
  };
}

function summarizeRules(company: Company) {
  const rules = resolveCompanyAccessRules(company);
  return companyPortalAccessPages.reduce(
    (summary, { page }) => {
      summary[rules[page]] += 1;
      return summary;
    },
    { full: 0, readonly: 0, off: 0 } as Record<CompanyPortalAccessLevel, number>,
  );
}

export function CompanyAccessPage({
  companies,
  onChangeCompanyAccess,
  onChangeCompanyPageAccess,
}: {
  companies: Company[];
  onChangeCompanyAccess: (companyId: string, mode: CompanyAccessMode) => void;
  onChangeCompanyPageAccess: (companyId: string, page: CompanyPortalAccessPage, level: CompanyPortalAccessLevel) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | CompanyAccessMode>('all');
  const rows = companies.map((company) => ({ company, mode: companyAccessMode(company), summary: summarizeRules(company) }));
  const visibleRows = rows.filter(({ company, mode }) => {
    const query = search.trim().toLowerCase();
    const haystack = [
      company.name,
      company.ownerName,
      company.ownerEmail,
      company.market,
      statusLabels[company.status],
      billingLabels[company.billingStatus],
      modeLabels[mode],
      ...companyPortalAccessPages.map((page) => page.label),
      ...Object.values(accessLevelLabels),
    ].join(' ').toLowerCase();

    return (filter === 'all' || filter === mode) && (!query || haystack.includes(query));
  });

  return (
    <div className="access-command-center company-access-page">
      <section className="access-summary">
        <MetricCard icon={<Building2 size={20} />} label="Companies" value={companies.length.toString()} detail="Tenant workspaces" />
        <MetricCard icon={<CheckCircle2 size={20} />} label="Full access" value={rows.filter((row) => row.mode === 'full').length.toString()} detail="All portal tools on" />
        <MetricCard icon={<ShieldCheck size={20} />} label="Limited" value={rows.filter((row) => row.mode === 'limited').length.toString()} detail="Some pages read-only/off" />
        <MetricCard icon={<AlertTriangle size={20} />} label="Locked" value={rows.filter((row) => row.mode === 'locked').length.toString()} detail="Most work tools off" />
      </section>

      <section className="panel company-access-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Owner controls</p>
            <h2>Company access</h2>
          </div>
          <ShieldCheck size={20} aria-hidden="true" />
        </div>
        <div className="company-access-toolbar">
          <label>
            Search company
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Company, owner, page, access level" />
          </label>
          <label>
            Access
            <select value={filter} onChange={(event) => setFilter(event.target.value as 'all' | CompanyAccessMode)}>
              <option value="all">All</option>
              <option value="full">Full</option>
              <option value="limited">Limited</option>
              <option value="locked">Locked</option>
            </select>
          </label>
          <button className="secondary-button compact" type="button" onClick={() => { setSearch(''); setFilter('all'); }}>Reset</button>
        </div>
        <div className="company-access-list">
          {visibleRows.map(({ company, mode, summary }) => {
            const rules = resolveCompanyAccessRules(company);

            return (
              <article className={'company-access-row ' + mode} key={company.id}>
                <div className="company-main">
                  <div className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <h3>{company.name}</h3>
                    <p>{company.ownerEmail} - {company.market}</p>
                  </div>
                </div>
                <div className="company-access-status">
                  <span>Status</span>
                  <strong>{statusLabels[company.status]} - {billingLabels[company.billingStatus]}</strong>
                  <em className={'company-access-pill ' + mode}>{modeLabels[mode]}</em>
                  <small>{summary.full} full / {summary.readonly} read-only / {summary.off} off</small>
                </div>
                <label className="company-access-select">
                  Preset
                  <select value={mode} onChange={(event) => onChangeCompanyAccess(company.id, event.target.value as CompanyAccessMode)}>
                    <option value="full">Full access</option>
                    <option value="limited">Read-only work</option>
                    <option value="locked">Locked</option>
                  </select>
                </label>
                <div className="company-access-rules">
                  <span>Company portal pages</span>
                  <div className="company-access-page-grid">
                    {companyPortalAccessPages.map((pageDefinition) => (
                      <label className={'company-access-page-control ' + rules[pageDefinition.page]} key={pageDefinition.page}>
                        <strong>{pageDefinition.label}</strong>
                        <small>{pageDefinition.detail}</small>
                        <select
                          value={rules[pageDefinition.page]}
                          onChange={(event) => onChangeCompanyPageAccess(company.id, pageDefinition.page, event.target.value as CompanyPortalAccessLevel)}
                        >
                          <option value="full">Full</option>
                          <option value="readonly">Read-only</option>
                          <option value="off">Off</option>
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="company-access-actions">
                  <button className="secondary-button compact" type="button" onClick={() => onChangeCompanyAccess(company.id, 'limited')}>Limit</button>
                  <button className="secondary-button compact danger-button" type="button" onClick={() => onChangeCompanyAccess(company.id, 'locked')}>Lock</button>
                  <button className="primary-button compact" type="button" onClick={() => onChangeCompanyAccess(company.id, 'full')}>Restore</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
