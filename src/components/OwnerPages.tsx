import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  Database,
  FileClock,
  Inbox,
  MailPlus,
  PackageCheck,
  Rocket,
  ServerCog,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  auditCategoryLabels,
  billingLabels,
  platformRoleLabels,
  platformStatusLabels,
  statusLabels,
  ticketKindLabels,
  ticketPriorityLabels,
  ticketStatusLabels,
} from '../appLabels';
import { plans } from '../services/billingCatalog';
import { ownerPageLabels, ownerPagePermissions, SYSTEM_OWNER_ID } from '../services/accessStore';
import { filterAuditEvents } from '../services/auditStore';
import { onboardingStepOrder } from '../services/tenantStore';
import { money } from '../utils/format';
import type {
  AuditEvent,
  AuditEventCategory,
  BillingStatus,
  Company,
  CompanyOnboardingProfile,
  CompanyPlan,
  CompanyStatus,
  NewPlatformUserForm,
  NewSupportTicketForm,
  PlatformUser,
  PlatformUserRole,
  PlatformUserStatus,
  SupportTicket,
  SupportTicketKind,
  SupportTicketPriority,
  SupportTicketStatus,
} from '../types';

export function DashboardOverview({
  companies,
  supportTickets,
  onOpenCompanies,
  onOpenSupport,
}: {
  companies: Company[];
  supportTickets: SupportTicket[];
  onOpenCompanies: () => void;
  onOpenSupport: () => void;
}) {
  const openTickets = supportTickets.filter((ticket) => ticket.status !== 'resolved');
  const newTickets = supportTickets.filter((ticket) => ticket.status === 'new');
  const urgentTickets = openTickets.filter((ticket) => ticket.priority === 'urgent');
  const overdueCompanies = companies.filter((company) => company.billingStatus === 'overdue');
  const trialCompanies = companies.filter((company) => company.status === 'trial' || company.billingStatus === 'trialing');
  const activeCompanies = companies.filter((company) => company.status === 'active');
  const setupCompanies = companies.filter((company) => company.status === 'setup');
  const monthlyRevenue = companies.reduce((total, company) => total + (plans.find((plan) => plan.name === company.plan)?.price ?? 0), 0);
  const storageUsed = companies.reduce((total, company) => total + company.usage.storageGb, 0);
  const averageHealth = companies.length ? Math.round(companies.reduce((total, company) => total + company.health, 0) / companies.length) : 0;
  const lowHealthCompanies = companies.filter((company) => company.health < 70);
  const companyRows = [...companies].sort((left, right) => {
    const leftRisk = (left.billingStatus === 'overdue' ? 3 : 0) + (left.health < 70 ? 2 : 0) + (left.status === 'setup' ? 1 : 0);
    const rightRisk = (right.billingStatus === 'overdue' ? 3 : 0) + (right.health < 70 ? 2 : 0) + (right.status === 'setup' ? 1 : 0);
    return rightRisk - leftRisk || left.name.localeCompare(right.name);
  });
  const recentTickets = supportTickets.slice(0, 5);
  const actionItems = [
    ...overdueCompanies.map((company) => ({
      key: 'billing-' + company.id,
      tone: 'danger',
      title: company.name + ' payment overdue',
      detail: billingLabels[company.billingStatus] + ' · ' + company.plan + ' plan · restore access after payment.',
      meta: 'Billing',
      action: onOpenCompanies,
      actionLabel: 'Open company',
    })),
    ...newTickets.slice(0, 4).map((ticket) => ({
      key: 'support-' + ticket.id,
      tone: ticket.priority === 'urgent' ? 'danger' : 'warning',
      title: ticket.companyName + ' — ' + ticket.subject,
      detail: ticket.kind + ' · ' + ticket.priority + ' · ' + ticket.lastUpdate,
      meta: 'New support',
      action: onOpenSupport,
      actionLabel: 'Open support',
    })),
    ...lowHealthCompanies.slice(0, 4).map((company) => ({
      key: 'health-' + company.id,
      tone: 'warning',
      title: company.name + ' health is low',
      detail: company.health + '% health · last sync ' + company.lastSync + '.',
      meta: 'Monitoring',
      action: onOpenCompanies,
      actionLabel: 'Open company',
    })),
    ...setupCompanies.slice(0, 3).map((company) => ({
      key: 'setup-' + company.id,
      tone: 'neutral',
      title: company.name + ' is still in setup',
      detail: 'Owner access, billing, or first data may still need attention.',
      meta: 'Setup',
      action: onOpenCompanies,
      actionLabel: 'Open company',
    })),
  ];

  return (
    <div className="owner-command-center">
      <section className="owner-kpi-grid" aria-label="Owner dashboard summary">
        <MetricCard icon={<Building2 size={20} />} label="Companies" value={companies.length.toString()} detail={activeCompanies.length + ' active · ' + trialCompanies.length + ' trial'} />
        <MetricCard icon={<CircleDollarSign size={20} />} label="MRR" value={money(monthlyRevenue) + '/mo'} detail={overdueCompanies.length ? overdueCompanies.length + ' payment risk' : 'No payment risk'} />
        <MetricCard icon={<CreditCard size={20} />} label="Billing risk" value={overdueCompanies.length.toString()} detail={overdueCompanies.length ? 'Overdue tenants' : 'All accounts current'} />
        <MetricCard icon={<Inbox size={20} />} label="New support" value={newTickets.length.toString()} detail={openTickets.length + ' open · ' + urgentTickets.length + ' urgent'} />
        <MetricCard icon={<CheckCircle2 size={20} />} label="Health" value={averageHealth + '%'} detail={lowHealthCompanies.length ? lowHealthCompanies.length + ' tenant needs review' : 'Portfolio stable'} />
        <MetricCard icon={<Database size={20} />} label="Storage" value={storageUsed.toFixed(1) + ' GB'} detail="Tenant document usage" />
      </section>

      <div className="owner-dashboard-main">
        <section className="panel owner-actions-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Action required</p>
              <h2>What needs attention</h2>
            </div>
            <span className={actionItems.length ? 'owner-action-count hot' : 'owner-action-count'}>{actionItems.length}</span>
          </div>

          {actionItems.length ? (
            <div className="owner-action-list">
              {actionItems.slice(0, 8).map((action) => (
                <article className={'owner-action-card ' + action.tone} key={action.key}>
                  <div className="owner-action-icon">
                    {action.tone === 'danger' ? <AlertTriangle size={18} aria-hidden="true" /> : <ClipboardList size={18} aria-hidden="true" />}
                  </div>
                  <div>
                    <span>{action.meta}</span>
                    <h3>{action.title}</h3>
                    <p>{action.detail}</p>
                  </div>
                  <button className="secondary-button compact" type="button" onClick={action.action}>
                    {action.actionLabel}
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state compact-empty owner-clear-state">
              <CheckCircle2 size={24} aria-hidden="true" />
              <h3>No urgent actions</h3>
              <p>Billing, support, and tenant health are clean right now.</p>
            </div>
          )}
        </section>

        <section className="panel owner-recent-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Recent activity</p>
              <h2>Support stream</h2>
            </div>
            <button className="secondary-button compact" type="button" onClick={onOpenSupport}>Open support</button>
          </div>
          <div className="owner-recent-list">
            {recentTickets.length ? (
              recentTickets.map((ticket) => (
                <button className="owner-recent-row" type="button" onClick={onOpenSupport} key={ticket.id}>
                  <span className={'ticket-kind ' + ticket.kind}>{ticketKindLabels[ticket.kind]}</span>
                  <div>
                    <strong>{ticket.subject}</strong>
                    <small>{ticket.companyName} · {ticketStatusLabels[ticket.status]} · {ticket.lastUpdate}</small>
                  </div>
                </button>
              ))
            ) : (
              <p className="quiet-line">No support activity yet.</p>
            )}
          </div>
        </section>
      </div>

      <section className="panel owner-companies-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Tenant control</p>
            <h2>Companies at a glance</h2>
          </div>
          <button className="secondary-button compact" type="button" onClick={onOpenCompanies}>Open companies</button>
        </div>

        <div className="owner-company-table" role="table" aria-label="Company health and billing overview">
          <div className="owner-company-row owner-company-head" role="row">
            <span>Company</span>
            <span>Plan</span>
            <span>Billing</span>
            <span>Support</span>
            <span>Jobs</span>
            <span>Health</span>
            <span>Sync</span>
            <span>Action</span>
          </div>
          {companyRows.length ? (
            companyRows.map((company) => {
              const companyOpenTickets = openTickets.filter((ticket) => ticket.companyId === company.id);
              const companyNewTickets = companyOpenTickets.filter((ticket) => ticket.status === 'new');
              return (
                <div className="owner-company-row" role="row" key={company.id}>
                  <div className="company-main">
                    <div className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</div>
                    <div>
                      <h3>{company.name}</h3>
                      <p>{company.ownerName} · {company.market}</p>
                    </div>
                  </div>
                  <strong>{company.plan}</strong>
                  <span className={'billing-pill ' + company.billingStatus}>{billingLabels[company.billingStatus]}</span>
                  <button className={companyNewTickets.length ? 'owner-support-count hot' : 'owner-support-count'} type="button" onClick={onOpenSupport}>
                    {companyNewTickets.length ? companyNewTickets.length + ' new' : companyOpenTickets.length + ' open'}
                  </button>
                  <strong>{company.openJobs}</strong>
                  <div className="owner-health-cell">
                    <strong>{company.health}%</strong>
                    <div className="health-track"><span style={{ width: company.health + '%' }} /></div>
                  </div>
                  <span className="owner-sync-cell">{company.lastSync}</span>
                  <button className="secondary-button compact" type="button" onClick={onOpenCompanies}>Open</button>
                </div>
              );
            })
          ) : (
            <div className="empty-state compact-empty owner-table-empty">
              <Building2 size={24} aria-hidden="true" />
              <h3>No companies yet</h3>
              <p>Add the first tenant from the Companies page.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export function AuditPage({
  events,
  filter,
  onFilterChange,
}: {
  events: AuditEvent[];
  filter: 'all' | AuditEventCategory;
  onFilterChange: (filter: 'all' | AuditEventCategory) => void;
}) {
  const [auditSearch, setAuditSearch] = useState('');
  const [resourceFilter, setResourceFilter] = useState('all');
  const [actorFilter, setActorFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | 'yesterday'>('all');
  const filteredByCategory = filterAuditEvents(events, filter);
  const resources = useMemo(() => Array.from(new Set(events.map((event) => event.resource))).sort(), [events]);
  const actors = useMemo(() => Array.from(new Set(events.map((event) => event.actor))).sort(), [events]);
  const filteredEvents = filteredByCategory.filter((event) => {
    const normalizedSearch = auditSearch.trim().toLowerCase();
    const haystack = [event.action, event.actor, event.resource, event.details, auditCategoryLabels[event.category]]
      .join(' ')
      .toLowerCase();
    const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);
    const matchesResource = resourceFilter === 'all' || event.resource === resourceFilter;
    const matchesActor = actorFilter === 'all' || event.actor === actorFilter;
    const normalizedDate = event.createdAt.toLowerCase();
    const matchesPeriod =
      periodFilter === 'all' ||
      (periodFilter === 'today' ? normalizedDate === 'just now' || normalizedDate === 'today' : normalizedDate === 'yesterday');

    return matchesSearch && matchesResource && matchesActor && matchesPeriod;
  });
  const groupedEvents = filteredEvents.reduce<Array<{ event: AuditEvent; count: number; ids: string[] }>>((groups, event) => {
    const previous = groups[groups.length - 1];
    const key = `${event.category}|${event.action}|${event.actor}|${event.resource}|${event.details}|${event.createdAt}`;
    const previousKey = previous ? `${previous.event.category}|${previous.event.action}|${previous.event.actor}|${previous.event.resource}|${previous.event.details}|${previous.event.createdAt}` : '';

    if (previous && previousKey === key) {
      previous.count += 1;
      previous.ids.push(event.id);
      return groups;
    }

    return [...groups, { event, count: 1, ids: [event.id] }];
  }, []);
  const categoryCounts = events.reduce(
    (counts, event) => ({
      ...counts,
      [event.category]: counts[event.category] + 1,
    }),
    { access: 0, billing: 0, support: 0, tenant: 0 } as Record<AuditEventCategory, number>,
  );

  return (
    <div className="audit-page">
      <section className="audit-summary">
        <MetricCard icon={<FileClock size={20} />} label="Events" value={events.length.toString()} detail="Owner activity history" />
        <MetricCard icon={<Building2 size={20} />} label="Tenants" value={categoryCounts.tenant.toString()} detail="Company changes" />
        <MetricCard icon={<CreditCard size={20} />} label="Billing" value={categoryCounts.billing.toString()} detail="Plan and payment changes" />
        <MetricCard icon={<Inbox size={20} />} label="Support" value={categoryCounts.support.toString()} detail="Tickets and replies" />
      </section>

      <section className="panel audit-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">System record</p>
            <h2>Activity log</h2>
          </div>
          <select value={filter} onChange={(event) => onFilterChange(event.target.value as 'all' | AuditEventCategory)} aria-label="Filter audit events">
            <option value="all">All events</option>
            <option value="tenant">Tenants</option>
            <option value="billing">Billing</option>
            <option value="access">Access</option>
            <option value="support">Support</option>
          </select>
        </div>

        <div className="audit-filter-grid">
          <label>
            Search
            <input value={auditSearch} onChange={(event) => setAuditSearch(event.target.value)} placeholder="Action, company, actor, details" />
          </label>
          <label>
            Company / resource
            <select value={resourceFilter} onChange={(event) => setResourceFilter(event.target.value)}>
              <option value="all">All resources</option>
              {resources.map((resource) => (
                <option value={resource} key={resource}>
                  {resource}
                </option>
              ))}
            </select>
          </label>
          <label>
            Actor
            <select value={actorFilter} onChange={(event) => setActorFilter(event.target.value)}>
              <option value="all">All actors</option>
              {actors.map((actor) => (
                <option value={actor} key={actor}>
                  {actor}
                </option>
              ))}
            </select>
          </label>
          <label>
            Period
            <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value as 'all' | 'today' | 'yesterday')}>
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
            </select>
          </label>
          <button
            className="secondary-button compact"
            type="button"
            onClick={() => {
              setAuditSearch('');
              setResourceFilter('all');
              setActorFilter('all');
              setPeriodFilter('all');
              onFilterChange('all');
            }}
          >
            Reset
          </button>
        </div>

        <div className="audit-result-summary">
          Showing <strong>{groupedEvents.length}</strong> rows from <strong>{filteredEvents.length}</strong> events
        </div>

        <div className="audit-list">
          {groupedEvents.length ? (
            groupedEvents.map(({ event, count, ids }) => (
              <article className={`audit-row ${event.category}`} key={ids.join('-')}>
                <div className="audit-icon">
                  <FileClock size={18} aria-hidden="true" />
                </div>
                <div className="audit-main">
                  <div className="audit-topline">
                    <span className={`audit-category ${event.category}`}>{auditCategoryLabels[event.category]}</span>
                    <strong>{event.action}</strong>
                    {count > 1 ? <em>{count} repeated</em> : null}
                    <small>{event.createdAt}</small>
                  </div>
                  <h3>{event.resource}</h3>
                  <p>{event.details}</p>
                  <details className="audit-details">
                    <summary>Event details</summary>
                    <dl>
                      <div>
                        <dt>Category</dt>
                        <dd>{auditCategoryLabels[event.category]}</dd>
                      </div>
                      <div>
                        <dt>Action</dt>
                        <dd>{event.action}</dd>
                      </div>
                      <div>
                        <dt>Event IDs</dt>
                        <dd>{ids.join(', ')}</dd>
                      </div>
                    </dl>
                  </details>
                </div>
                <div className="audit-actor">
                  <span>Actor</span>
                  <strong>{event.actor}</strong>
                </div>
              </article>
            ))
          ) : (
            <div className="empty-state compact-empty">
              <FileClock size={24} aria-hidden="true" />
              <h3>No audit events</h3>
              <p>Choose another filter or make a platform change.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export function BillingPage({
  companies,
  onboardingProfiles,
  onChangePlan,
  onChangeBillingStatus,
}: {
  companies: Company[];
  onboardingProfiles: CompanyOnboardingProfile[];
  onChangePlan: (companyId: string, plan: CompanyPlan) => void;
  onChangeBillingStatus: (companyId: string, status: BillingStatus) => void;
}) {
  const getCompanyPlan = (company: Company) => plans.find((candidate) => candidate.name === company.plan) ?? plans[0];
  const getPaymentProfile = (company: Company) => onboardingProfiles.find((profile) => profile.companyId === company.id);
  const hasAutopay = (company: Company) => {
    const profile = getPaymentProfile(company);

    return Boolean(profile?.autoPayEnabled && profile.subscriptionPaymentStatus === 'active' && profile.subscriptionCardLast4);
  };
  const monthlyRevenue = companies.reduce((total, company) => {
    const plan = getCompanyPlan(company);
    return company.billingStatus === 'paid' || company.billingStatus === 'trialing'
      ? total + (plan?.price ?? 0)
      : total;
  }, 0);
  const blockedStatuses: BillingStatus[] = ['overdue', 'not_started'];
  const billingRiskCompanies = companies.filter((company) => blockedStatuses.includes(company.billingStatus) || !hasAutopay(company));
  const revenueAtRisk = billingRiskCompanies.reduce((total, company) => total + getCompanyPlan(company).price, 0);
  const [expandedBillingCompanyId, setExpandedBillingCompanyId] = useState(() => companies[0]?.id ?? '');
  const getAccessProfile = (company: Company, autopayReady: boolean) => {
    if (company.billingStatus === 'overdue') return { mode: 'stop' as const, label: 'Limited', note: 'Invoice, email, reports, dispatch changes and new job creation should stay limited until payment is current.', items: ['New jobs', 'Invoices', 'Email', 'Reports', 'Dispatch changes'], action: 'Collect payment and mark paid to restore access.' };
    if (company.billingStatus === 'not_started') return { mode: 'setup' as const, label: 'Setup', note: 'Subscription is not started. Keep live customer functions limited before go-live.', items: ['Live jobs', 'Customer invoices', 'Email', 'Portal payments'], action: 'Start billing or move tenant to trialing/paid.' };
    if (!autopayReady) return { mode: 'warn' as const, label: 'Autopay missing', note: 'A card is needed for automatic monthly billing.', items: ['Auto billing', 'Auto renewal', 'Go-live approval'], action: 'Ask admin to connect a subscription card.' };
    return { mode: 'ok' as const, label: 'Full', note: 'Billing is healthy. No billing limits recommended.', items: ['No billing limits'], action: 'Monitor usage and health.' };
  };
  const getOnboardingProgress = (company: Company) => {
    const steps = Object.values(company.onboarding);
    return Math.round((steps.filter((step) => step === 'done').length / (steps.length || 1)) * 100);
  };

  return (
    <div className="billing-page">
      <section className="billing-summary">
        <MetricCard icon={<CircleDollarSign size={20} />} label="Estimated MRR" value={money(monthlyRevenue)} detail="Paid and trialing tenants" />
        <MetricCard icon={<PackageCheck size={20} />} label="Plans" value={plans.length.toString()} detail="Launch, Growth, Scale" />
        <MetricCard icon={<CreditCard size={20} />} label="Paid tenants" value={companies.filter((company) => company.billingStatus === 'paid').length.toString()} detail="Current billing status" />
        <MetricCard icon={<AlertTriangle size={20} />} label="Payment alerts" value={billingRiskCompanies.length.toString()} detail={`${money(revenueAtRisk)} needs attention`} />
      </section>

      <section className="plan-grid" aria-label="Plan catalog">
        {plans.map((plan) => (
          <article className="plan-card" key={plan.name}>
            <div>
              <p className="eyebrow">{plan.support} support</p>
              <h2>{plan.name}</h2>
              <strong>{money(plan.price)}<span>/mo</span></strong>
            </div>
            <div className="plan-limits">
              <span>{plan.seats} seats</span>
              <span>{plan.technicians} techs</span>
              <span>{plan.storageGb} GB storage</span>
            </div>
            <ul>
              {plan.entitlements.map((entitlement) => (
                <li key={entitlement}>{entitlement}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className={`panel billing-alert-panel ${billingRiskCompanies.length ? 'has-alerts' : ''}`}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Payment monitoring</p>
            <h2>Collection alerts</h2>
          </div>
          <AlertTriangle size={20} aria-hidden="true" />
        </div>

        {billingRiskCompanies.length ? (
          <div className="billing-alert-list">
            {billingRiskCompanies.map((company) => {
              const plan = getCompanyPlan(company);
              const paymentProfile = getPaymentProfile(company);
              const isOverdue = company.billingStatus === 'overdue';
              const autopayReady = hasAutopay(company);

              return (
                <article className="billing-alert-row" key={company.id}>
                  <div>
                    <strong>{company.name}</strong>
                    <p>
                      {billingLabels[company.billingStatus]} - {company.plan} {money(plan.price)}/mo
                    </p>
                  </div>
                  <span className={`access-mode ${isOverdue ? 'blocked' : 'limited'}`}>{isOverdue ? 'Functions blocked' : autopayReady ? 'Monitor' : 'Autopay missing'}</span>
                  <p className="billing-alert-detail">
                    {isOverdue
                      ? 'Invoices, email sending, reports, and new job creation should be limited until payment is restored.'
                      : autopayReady
                        ? `Card ${paymentProfile?.subscriptionCardBrand} **** ${paymentProfile?.subscriptionCardLast4} is ready for automatic billing.`
                        : 'Company admin must connect a subscription card before go-live. Charges should run automatically each month.'}
                  </p>
                  <div className="billing-alert-actions">
                    <button className="secondary-button compact" type="button" onClick={() => onChangeBillingStatus(company.id, 'overdue')}>
                      Flag overdue
                    </button>
                    <button className="primary-button compact" type="button" onClick={() => onChangeBillingStatus(company.id, 'paid')}>
                      Mark paid
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state compact-empty">
            <CreditCard size={24} aria-hidden="true" />
            <h3>No billing alerts</h3>
            <p>All active companies are paid or still inside trial.</p>
          </div>
        )}
      </section>

      <section className="panel subscription-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Tenant billing</p>
            <h2>Subscriptions</h2>
          </div>
          <CreditCard size={20} aria-hidden="true" />
        </div>

        <div className="subscription-list">
          {companies.map((company) => (
            <article className="subscription-row" key={company.id}>
              {(() => {
                const paymentProfile = getPaymentProfile(company);
                const autopayReady = hasAutopay(company);

                return (
                  <>
                    <div className="company-main">
                      <div className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</div>
                      <div>
                        <h3>{company.name}</h3>
                        <p>{company.ownerEmail}</p>
                      </div>
                    </div>
                    <div className="billing-cell">
                      <span>Plan</span>
                      <select value={company.plan} onChange={(event) => onChangePlan(company.id, event.target.value as CompanyPlan)}>
                        {plans.map((plan) => (
                          <option value={plan.name} key={plan.name}>
                            {plan.name}
                          </option>
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
                    <div className="billing-cell">
                      <span>Autopay</span>
                      <strong>{autopayReady ? 'On' : 'Off'}</strong>
                    </div>
                    <div className="billing-cell billing-card-cell">
                      <span>Card</span>
                      <strong>{paymentProfile?.subscriptionCardLast4 ? `${paymentProfile.subscriptionCardBrand} ${paymentProfile.subscriptionCardLast4}` : 'Missing'}</strong>
                    </div>
                    <div className="billing-cell billing-access-cell">
                      <span>Access</span>
                      <strong>{blockedStatuses.includes(company.billingStatus) ? 'Limited' : 'Full'}</strong>
                    </div>
                    <span className={`billing-pill ${company.billingStatus}`}>{billingLabels[company.billingStatus]}</span>
                  </>
                );
              })()}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

type MonitoringSignal = {
  id: string;
  company: Company;
  severity: 'critical' | 'warning' | 'info';
  category: 'Billing' | 'Onboarding' | 'Support' | 'Usage' | 'Health' | 'Operations';
  title: string;
  detail: string;
  action: 'billing' | 'company' | 'support';
};

export function MonitoringPage({
  companies,
  onboardingProfiles,
  supportTickets,
  onOpenCompany,
  onOpenBilling,
  onOpenSupport,
}: {
  companies: Company[];
  onboardingProfiles: CompanyOnboardingProfile[];
  supportTickets: SupportTicket[];
  onOpenCompany: (companyId: string) => void;
  onOpenBilling: () => void;
  onOpenSupport: () => void;
}) {
  const [severityFilter, setSeverityFilter] = useState<'all' | MonitoringSignal['severity']>('all');
  const getCompanyPlan = (company: Company) => plans.find((candidate) => candidate.name === company.plan) ?? plans[0];
  const getPaymentProfile = (company: Company) => onboardingProfiles.find((profile) => profile.companyId === company.id);
  const openTickets = supportTickets.filter((ticket) => ticket.status !== 'resolved');
  const signals = companies.flatMap((company): MonitoringSignal[] => {
    const plan = getCompanyPlan(company);
    const paymentProfile = getPaymentProfile(company);
    const autopayReady = Boolean(paymentProfile?.autoPayEnabled && paymentProfile.subscriptionPaymentStatus === 'active' && paymentProfile.subscriptionCardLast4);
    const completedSteps = Object.values(company.onboarding).filter((step) => step === 'done').length;
    const companyTickets = openTickets.filter((ticket) => ticket.companyId === company.id);
    const urgentTickets = companyTickets.filter((ticket) => ticket.priority === 'urgent');
    const storageRatio = plan.storageGb ? company.usage.storageGb / plan.storageGb : 0;
    const jobsPerTech = company.technicians ? company.openJobs / company.technicians : company.openJobs;
    const nextSignals: MonitoringSignal[] = [];

    if (company.billingStatus === 'overdue') {
      nextSignals.push({
        id: `${company.id}-billing-overdue`,
        company,
        severity: 'critical',
        category: 'Billing',
        title: 'Subscription payment overdue',
        detail: `${company.plan} ${money(plan.price)}/mo is overdue. Limit invoices, email sending, reports, and new job creation.`,
        action: 'billing',
      });
    } else if (company.billingStatus === 'not_started' || !autopayReady) {
      nextSignals.push({
        id: `${company.id}-autopay-missing`,
        company,
        severity: company.status === 'active' ? 'critical' : 'warning',
        category: 'Billing',
        title: 'Autopay is not connected',
        detail: 'Company admin must connect a card before automatic monthly billing can run.',
        action: 'billing',
      });
    }

    if (company.health < 65) {
      nextSignals.push({
        id: `${company.id}-health-critical`,
        company,
        severity: 'critical',
        category: 'Health',
        title: 'Tenant health is critical',
        detail: `Health is ${company.health}%. Review onboarding, billing, support, and recent activity.`,
        action: 'company',
      });
    } else if (company.health < 80) {
      nextSignals.push({
        id: `${company.id}-health-warning`,
        company,
        severity: 'warning',
        category: 'Health',
        title: 'Tenant health needs attention',
        detail: `Health is ${company.health}%. Watch this account before it becomes a support issue.`,
        action: 'company',
      });
    }

    if (completedSteps < onboardingStepOrder.length) {
      nextSignals.push({
        id: `${company.id}-onboarding`,
        company,
        severity: company.status === 'active' ? 'critical' : 'warning',
        category: 'Onboarding',
        title: 'Onboarding is incomplete',
        detail: `${completedSteps}/${onboardingStepOrder.length} steps complete. Workspace may not be ready for daily operations.`,
        action: 'company',
      });
    }

    if (urgentTickets.length) {
      nextSignals.push({
        id: `${company.id}-urgent-support`,
        company,
        severity: 'critical',
        category: 'Support',
        title: 'Urgent support waiting',
        detail: `${urgentTickets.length} urgent support request${urgentTickets.length > 1 ? 's' : ''} open.`,
        action: 'support',
      });
    } else if (companyTickets.length) {
      nextSignals.push({
        id: `${company.id}-support`,
        company,
        severity: 'warning',
        category: 'Support',
        title: 'Open support requests',
        detail: `${companyTickets.length} open support request${companyTickets.length > 1 ? 's' : ''}.`,
        action: 'support',
      });
    }

    if (storageRatio >= 0.8) {
      nextSignals.push({
        id: `${company.id}-storage`,
        company,
        severity: storageRatio >= 1 ? 'critical' : 'warning',
        category: 'Usage',
        title: storageRatio >= 1 ? 'Storage limit exceeded' : 'Storage near plan limit',
        detail: `${company.usage.storageGb.toFixed(1)} GB used of ${plan.storageGb} GB on ${company.plan}.`,
        action: 'billing',
      });
    }

    if (jobsPerTech >= 4) {
      nextSignals.push({
        id: `${company.id}-workload`,
        company,
        severity: jobsPerTech >= 6 ? 'critical' : 'warning',
        category: 'Operations',
        title: 'Technician workload is high',
        detail: `${company.openJobs} open jobs across ${company.technicians} technicians.`,
        action: 'company',
      });
    }

    company.alerts.forEach((alert, index) => {
      nextSignals.push({
        id: `${company.id}-owner-alert-${index}`,
        company,
        severity: 'info',
        category: 'Operations',
        title: alert,
        detail: `Owner signal from ${company.name}.`,
        action: 'company',
      });
    });

    return nextSignals;
  });
  const filteredSignals = signals.filter((signal) => severityFilter === 'all' || signal.severity === severityFilter);
  const criticalCount = signals.filter((signal) => signal.severity === 'critical').length;
  const warningCount = signals.filter((signal) => signal.severity === 'warning').length;
  const billingRisk = signals.filter((signal) => signal.category === 'Billing').length;
  const avgHealth = companies.length ? Math.round(companies.reduce((sum, company) => sum + company.health, 0) / companies.length) : 0;
  const healthyCompanies = companies.filter((company) => company.health >= 80 && !signals.some((signal) => signal.company.id === company.id && signal.severity === 'critical'));

  const runAction = (signal: MonitoringSignal) => {
    if (signal.action === 'billing') onOpenBilling();
    if (signal.action === 'support') onOpenSupport();
    if (signal.action === 'company') onOpenCompany(signal.company.id);
  };

  return (
    <div className="monitoring-page">
      <section className="monitoring-summary">
        <MetricCard icon={<AlertTriangle size={20} />} label="Critical" value={criticalCount.toString()} detail="Needs owner action" />
        <MetricCard icon={<ServerCog size={20} />} label="Warnings" value={warningCount.toString()} detail="Watch closely" />
        <MetricCard icon={<CreditCard size={20} />} label="Billing risk" value={billingRisk.toString()} detail="Autopay or overdue issues" />
        <MetricCard icon={<CheckCircle2 size={20} />} label="Avg health" value={`${avgHealth}%`} detail={`${healthyCompanies.length} healthy tenants`} />
      </section>

      <section className="panel monitoring-command-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Platform command center</p>
            <h2>Action queue</h2>
          </div>
          <div className="monitoring-filter">
            <button className={severityFilter === 'all' ? 'active' : ''} type="button" onClick={() => setSeverityFilter('all')}>All</button>
            <button className={severityFilter === 'critical' ? 'active' : ''} type="button" onClick={() => setSeverityFilter('critical')}>Critical</button>
            <button className={severityFilter === 'warning' ? 'active' : ''} type="button" onClick={() => setSeverityFilter('warning')}>Warning</button>
            <button className={severityFilter === 'info' ? 'active' : ''} type="button" onClick={() => setSeverityFilter('info')}>Info</button>
          </div>
        </div>

        <div className="monitoring-signal-list">
          {filteredSignals.length ? (
            filteredSignals.map((signal) => (
              <article className={`monitoring-signal ${signal.severity}`} key={signal.id}>
                <div>
                  <span className={`monitoring-severity ${signal.severity}`}>{signal.severity}</span>
                  <span className="monitoring-category">{signal.category}</span>
                </div>
                <div>
                  <h3>{signal.title}</h3>
                  <p>{signal.company.name} - {signal.detail}</p>
                </div>
                <button className="secondary-button compact" type="button" onClick={() => runAction(signal)}>
                  Open
                </button>
              </article>
            ))
          ) : (
            <div className="empty-state compact-empty">
              <CheckCircle2 size={24} aria-hidden="true" />
              <h3>No signals in this filter</h3>
              <p>Switch filters or keep monitoring from the summary above.</p>
            </div>
          )}
        </div>
      </section>

      <section className="monitoring-grid">
        {companies.map((company) => {
          const plan = getCompanyPlan(company);
          const paymentProfile = getPaymentProfile(company);
          const companySignals = signals.filter((signal) => signal.company.id === company.id);
          const critical = companySignals.some((signal) => signal.severity === 'critical');
          const warning = companySignals.some((signal) => signal.severity === 'warning');
          const completedSteps = Object.values(company.onboarding).filter((step) => step === 'done').length;
          const storagePercent = Math.min(100, Math.round((company.usage.storageGb / plan.storageGb) * 100));
          const autopayReady = Boolean(paymentProfile?.autoPayEnabled && paymentProfile.subscriptionPaymentStatus === 'active' && paymentProfile.subscriptionCardLast4);

          return (
            <article className={`monitoring-tenant-card ${critical ? 'critical' : warning ? 'warning' : 'healthy'}`} key={company.id}>
              <div className="monitoring-card-header">
                <div className="company-main">
                  <div className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <h3>{company.name}</h3>
                    <p>{company.plan} - {company.market}</p>
                  </div>
                </div>
                <span className={`monitoring-severity ${critical ? 'critical' : warning ? 'warning' : 'info'}`}>
                  {critical ? 'critical' : warning ? 'watch' : 'healthy'}
                </span>
              </div>
              <div className="monitoring-health-row">
                <span>Health</span>
                <strong>{company.health}%</strong>
                <div className="health-track">
                  <span style={{ width: `${company.health}%` }} />
                </div>
              </div>
              <div className="monitoring-check-grid">
                <span className={company.billingStatus === 'paid' ? 'ok' : 'bad'}>Billing: {billingLabels[company.billingStatus]}</span>
                <span className={autopayReady ? 'ok' : 'bad'}>Autopay: {autopayReady ? 'On' : 'Missing'}</span>
                <span className={storagePercent < 80 ? 'ok' : 'bad'}>Storage: {storagePercent}%</span>
              </div>
              <button className="secondary-button compact" type="button" onClick={() => onOpenCompany(company.id)}>
                Open company
              </button>
            </article>
          );
        })}
      </section>
    </div>
  );
}

export function AccessPage({
  users,
  form,
  onFormChange,
  onInvite,
  onRoleChange,
  onStatusChange,
}: {
  users: PlatformUser[];
  form: NewPlatformUserForm;
  onFormChange: (form: NewPlatformUserForm) => void;
  onInvite: (event: FormEvent<HTMLFormElement>) => void;
  onRoleChange: (userId: string, role: PlatformUserRole) => void;
  onStatusChange: (userId: string, status: PlatformUserStatus) => void;
}) {
  const [accessSearch, setAccessSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | PlatformUserRole>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | PlatformUserStatus>('all');
  const roleOrder: PlatformUserRole[] = ['owner', 'admin', 'support', 'viewer'];
  const pageKeys = Object.keys(ownerPageLabels) as Array<keyof typeof ownerPageLabels>;
  const filteredUsers = users.filter((user) => {
    const normalizedSearch = accessSearch.trim().toLowerCase();
    const haystack = [user.name, user.email, platformRoleLabels[user.role], platformStatusLabels[user.status], ownerPagePermissions[user.role].map((page) => ownerPageLabels[page]).join(' ')]
      .join(' ')
      .toLowerCase();
    const matchesSearch = !normalizedSearch || haystack.includes(normalizedSearch);
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    const matchesStatus = statusFilter === 'all' || user.status === statusFilter;

    return matchesSearch && matchesRole && matchesStatus;
  });
  const activeUsers = users.filter((user) => user.status === 'active').length;
  const invitedUsers = users.filter((user) => user.status === 'invited').length;
  const disabledUsers = users.filter((user) => user.status === 'disabled').length;
  const ownersAndAdmins = users.filter((user) => user.status === 'active' && (user.role === 'owner' || user.role === 'admin')).length;

  return (
    <div className="access-command-center">
      <section className="access-summary">
        <MetricCard icon={<Users size={20} />} label="Team users" value={users.length.toString()} detail="Owner console accounts" />
        <MetricCard icon={<CheckCircle2 size={20} />} label="Active" value={activeUsers.toString()} detail="Can sign in" />
        <MetricCard icon={<ShieldCheck size={20} />} label="Admins" value={ownersAndAdmins.toString()} detail="Owner/Admin access" />
        <MetricCard icon={<UserPlus size={20} />} label="Invited" value={invitedUsers.toString()} detail={disabledUsers + ' disabled'} />
      </section>

      <div className="access-main-grid">
        <section className="panel invite-panel access-invite-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Platform team</p>
              <h2>Add user</h2>
            </div>
            <UserPlus size={20} aria-hidden="true" />
          </div>
          <form className="access-form" onSubmit={onInvite}>
            <label>
              Name
              <input value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} placeholder="Taylor Smith" />
            </label>
            <label>
              Email
              <input type="email" value={form.email} onChange={(event) => onFormChange({ ...form, email: event.target.value })} placeholder="taylor@servicescope.app" />
            </label>
            <label>
              Role
              <select value={form.role} onChange={(event) => onFormChange({ ...form, role: event.target.value as PlatformUserRole })}>
                <option value="support">Support</option>
                <option value="admin">Admin</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            <div className="role-preview-box">
              <span>Page access for {platformRoleLabels[form.role]}</span>
              <div className="page-chip-list">
                {ownerPagePermissions[form.role].map((page) => <b key={page}>{ownerPageLabels[page]}</b>)}
              </div>
            </div>
            <button className="primary-button" type="submit">
              <UserPlus size={18} aria-hidden="true" />
              Add user
            </button>
          </form>
        </section>

        <section className="panel access-matrix-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Page permissions</p>
              <h2>Access by role</h2>
            </div>
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="access-role-matrix">
            <div className="access-role-row access-role-head">
              <span>Role</span>
              {pageKeys.map((page) => <span key={page}>{ownerPageLabels[page]}</span>)}
            </div>
            {roleOrder.map((role) => (
              <div className="access-role-row" key={role}>
                <strong>{platformRoleLabels[role]}</strong>
                {pageKeys.map((page) => {
                  const allowed = ownerPagePermissions[role].includes(page);
                  return <span className={allowed ? 'permission-dot allowed' : 'permission-dot denied'} key={page}>{allowed ? '✓' : '—'}</span>;
                })}
              </div>
            ))}
          </div>
          <p className="access-note">Role controls which owner pages appear in the sidebar and which hash routes can be opened.</p>
        </section>
      </div>

      <section className="panel users-panel access-users-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">RBAC</p>
            <h2>Users and page access</h2>
          </div>
          <Users size={20} aria-hidden="true" />
        </div>

        <div className="access-filter-grid">
          <label>
            Search
            <input value={accessSearch} onChange={(event) => setAccessSearch(event.target.value)} placeholder="Name, email, role, page" />
          </label>
          <label>
            Role
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'all' | PlatformUserRole)}>
              <option value="all">All roles</option>
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="support">Support</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <label>
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | PlatformUserStatus)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="invited">Invited</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <button
            className="secondary-button compact"
            type="button"
            onClick={() => {
              setAccessSearch('');
              setRoleFilter('all');
              setStatusFilter('all');
            }}
          >
            Reset
          </button>
        </div>

        <div className="user-list access-user-list">
          {filteredUsers.map((user) => {
            const lockedOwner = user.id === SYSTEM_OWNER_ID;
            const pages = ownerPagePermissions[user.role];

            return (
              <article className={`user-row access-user-row ${lockedOwner ? 'locked-owner' : ''}`} key={user.id}>
                <div className="company-main">
                  <div className="company-avatar">{user.name.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <h3>{user.name}</h3>
                    <p>{lockedOwner ? `${user.email} - locked owner` : user.email}</p>
                  </div>
                </div>
                <div className="billing-cell">
                  <span>Role</span>
                  {lockedOwner ? (
                    <strong>Owner</strong>
                  ) : (
                    <select value={user.role} onChange={(event) => onRoleChange(user.id, event.target.value as PlatformUserRole)}>
                      <option value="admin">Admin</option>
                      <option value="support">Support</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  )}
                </div>
                <div className="billing-cell">
                  <span>Status</span>
                  {lockedOwner ? (
                    <strong>Active</strong>
                  ) : (
                    <select value={user.status} onChange={(event) => onStatusChange(user.id, event.target.value as PlatformUserStatus)}>
                      <option value="active">Active</option>
                      <option value="invited">Invited</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  )}
                </div>
                <div className="access-page-cell">
                  <span>Pages</span>
                  <div className="page-chip-list compact">
                    {pages.map((page) => <b key={page}>{ownerPageLabels[page]}</b>)}
                  </div>
                </div>
                <div className="billing-cell">
                  <span>Last active</span>
                  <strong>{user.lastActive}</strong>
                </div>
                <span className={`user-status ${user.status}`}>{platformStatusLabels[user.status]}</span>
              </article>
            );
          })}
          {!filteredUsers.length ? (
            <div className="empty-state compact-empty">
              <Users size={24} aria-hidden="true" />
              <h3>No users match</h3>
              <p>Clear filters or invite a new team member.</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function SupportPanel({
  companies,
  tickets,
  form,
  onFormChange,
  onSubmit,
  onStatusChange,
  selectedTicket,
  onSelectTicket,
  replyText,
  onReplyTextChange,
  onSendReply,
}: {
  companies: Company[];
  tickets: SupportTicket[];
  form: NewSupportTicketForm;
  onFormChange: (form: NewSupportTicketForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStatusChange: (ticketId: string, status: SupportTicketStatus) => void;
  selectedTicket?: SupportTicket;
  onSelectTicket: (ticketId: string) => void;
  replyText: string;
  onReplyTextChange: (value: string) => void;
  onSendReply: (ticketId: string) => void;
}) {
  const selectedCompany = companies.find((company) => company.id === form.companyId);
  const [selectedSupportCompanyId, setSelectedSupportCompanyId] = useState(() => selectedTicket?.companyId ?? form.companyId ?? companies[0]?.id ?? '');
  const supportCompanyRows = companies.map((company) => {
    const rows = tickets.filter((ticket) => ticket.companyId === company.id);
    return {
      company,
      tickets: rows,
      openCount: rows.filter((ticket) => ticket.status !== 'resolved').length,
      newCount: rows.filter((ticket) => ticket.status === 'new').length,
      urgentCount: rows.filter((ticket) => ticket.priority === 'urgent' && ticket.status !== 'resolved').length,
      lastUpdate: rows[0]?.lastUpdate ?? 'No requests',
    };
  });
  const selectedSupportCompany = supportCompanyRows.find((row) => row.company.id === selectedSupportCompanyId) ?? supportCompanyRows[0];
  const selectedCompanyTickets = selectedSupportCompany?.tickets ?? [];
  const activeSupportTicket = selectedTicket && selectedTicket['companyId'] === selectedSupportCompany?.company.id ? selectedTicket : selectedCompanyTickets[0];
  function openSupportCompany(companyId: string) {
    setSelectedSupportCompanyId(companyId);
    const firstTicket = tickets.find((ticket) => ticket.companyId === companyId);
    if (firstTicket) onSelectTicket(firstTicket.id);
  }

  function selectCompany(companyId: string) {
    const company = companies.find((candidate) => candidate.id === companyId);
    onFormChange({
      ...form,
      companyId,
      authorName: company?.ownerName ?? '',
      authorEmail: company?.ownerEmail ?? '',
    });
  }

  return (
    <section className="panel support-panel" id="support">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Company support</p>
          <h2>Inbox</h2>
        </div>
        <MailPlus size={20} aria-hidden="true" />
      </div>

      <div className="support-layout">
        <aside className="support-company-sidebar">
          <div className="support-company-heading">
            <div>
              <p className="eyebrow">Support by company</p>
              <h3>Company windows</h3>
              <p>Each company has its own support window. New requests show a red badge.</p>
            </div>
            <span className="support-total-badge">{tickets.filter((ticket) => ticket.status === 'new').length}</span>
          </div>
          <div className="support-company-list">
            {supportCompanyRows.map((row) => (
              <button className={`support-company-card ${row.company.id === selectedSupportCompany?.company.id ? 'active' : ''}`} type="button" key={row.company.id} onClick={() => openSupportCompany(row.company.id)}>
                <span className="company-avatar small-avatar">{row.company.name.slice(0, 2).toUpperCase()}</span>
                <span><strong>{row.company.name}</strong><small>{row.openCount} open · {row.lastUpdate}</small></span>
                {row.newCount ? <b>{row.newCount}</b> : null}
                {row.urgentCount ? <em>{row.urgentCount} urgent</em> : null}
              </button>
            ))}
          </div>
        </aside>

        <div className="ticket-workspace">
          <div className="ticket-list">
            {selectedCompanyTickets.map((ticket) => (
              <button
                className={`ticket-card ${ticket.priority} ${ticket.id === activeSupportTicket?.id ? 'selected' : ''}`}
                key={ticket.id}
                type="button"
                onClick={() => onSelectTicket(ticket.id)}
              >
                <div className="ticket-topline">
                  <span className={`ticket-kind ${ticket.kind}`}>{ticketKindLabels[ticket.kind]}</span>
                  <span className={`ticket-priority ${ticket.priority}`}>{ticketPriorityLabels[ticket.priority]}</span>
                </div>
                <h3>{ticket.subject}</h3>
                <p>{ticket.message}</p>
                <div className="ticket-meta">
                  <span>{ticket.companyName}</span>
                  <span>{ticket.lastUpdate}</span>
                </div>
                <div className="ticket-footer">
                  <span>{ticket.authorName}</span>
                  <strong>{ticketStatusLabels[ticket.status]}</strong>
                </div>
              </button>
            ))}
          </div>

          {activeSupportTicket ? (
            <article className="thread-panel">
              <div className="thread-header">
                <div>
                  <p className="eyebrow">{activeSupportTicket.companyName}</p>
                  <h3>{activeSupportTicket.subject}</h3>
                </div>
                <select value={activeSupportTicket.status} onChange={(event) => onStatusChange(activeSupportTicket.id, event.target.value as SupportTicketStatus)} aria-label={`Status for ${activeSupportTicket.subject}`}>
                  <option value="new">New</option>
                  <option value="reviewing">Reviewing</option>
                  <option value="planned">Planned</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>

              <div className="message-list">
                {activeSupportTicket.messages.map((message) => (
                  <div className={`support-message ${message.author}`} key={message.id}>
                    <div>
                      <strong>{message.authorName}</strong>
                      <span>{message.createdAt}</span>
                    </div>
                    <p>{message.body}</p>
                  </div>
                ))}
              </div>

              <div className="reply-box">
                <label>
                  Owner reply
                  <textarea value={replyText} onChange={(event) => onReplyTextChange(event.target.value)} placeholder="Write an answer or next step for the company." />
                </label>
                <button className="secondary-button" type="button" onClick={() => onSendReply(activeSupportTicket.id)}>
                  Send reply
                </button>
              </div>
            </article>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function MetricCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export function CompanyRow({
  company,
  selected,
  onSelect,
}: {
  company: Company;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button className={`company-row ${selected ? 'selected' : ''}`} type="button" onClick={onSelect}>
      <div className="company-main">
        <div className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</div>
        <div>
          <h3>{company.name}</h3>
          <p>{[company.ownerName, company.phone, company.market].filter(Boolean).join(' - ')}</p>
        </div>
      </div>
      <StatusPill status={company.status} />
      <div className="company-stat">
        <span>Plan</span>
        <strong>{company.plan}</strong>
      </div>
      <div className="company-stat">
        <span>Jobs</span>
        <strong>{company.openJobs}</strong>
      </div>
      <div className="health-cell">
        <div className="health-label">
          <span>Health</span>
          <strong>{company.health}%</strong>
        </div>
        <div className="health-track">
          <span style={{ width: `${company.health}%` }} />
        </div>
      </div>
      <div className="sync-cell">
        <CheckCircle2 size={16} aria-hidden="true" />
        {company.lastSync}
      </div>
    </button>
  );
}

export function CompanyDetail({
  company,
  onSaveOwnerAccess,
  ownerInviteStatus,
}: {
  company: Company;
  onSaveOwnerAccess: (mode: 'create' | 'reset', password: string) => void;
  ownerInviteStatus: string;
}) {
  const completedSteps = Object.values(company.onboarding).filter((step) => step === 'done').length;
  const readyToLaunch = completedSteps === onboardingStepOrder.length;
  const [ownerPassword, setOwnerPassword] = useState('');

  function generatePassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%';
    const values = new Uint32Array(12);
    crypto.getRandomValues(values);
    setOwnerPassword(Array.from(values, (value) => alphabet[value % alphabet.length]).join(''));
  }

  return (
    <aside className="panel detail-panel" aria-label={`${company.name} details`}>
      <div className="detail-header">
        <div className="company-avatar large">{company.name.slice(0, 2).toUpperCase()}</div>
        <div>
          <p className="eyebrow">Selected tenant</p>
          <h2>{company.name}</h2>
          <p>{company.domain}</p>
        </div>
      </div>

      <div className="detail-pills">
        <StatusPill status={company.status} />
        <span className={`billing-pill ${company.billingStatus}`}>{billingLabels[company.billingStatus]}</span>
      </div>

      <div className={`launch-readiness ${readyToLaunch ? 'ready' : ''}`}>
        <Rocket size={18} aria-hidden="true" />
        <div>
          <strong>{readyToLaunch ? 'Ready to launch' : 'Launch readiness'}</strong>
          <span>{readyToLaunch ? 'Tenant can be handed to the company owner.' : `${completedSteps} of ${onboardingStepOrder.length} provisioning steps complete.`}</span>
        </div>
      </div>

      <div className="detail-grid">
        <MiniStat icon={<Users size={17} />} label="Seats" value={company.seats.toString()} />
        <MiniStat icon={<ServerCog size={17} />} label="Techs" value={company.technicians.toString()} />
        <MiniStat icon={<ClipboardList size={17} />} label="Jobs" value={company.usage.jobsThisMonth.toString()} />
        <MiniStat icon={<CreditCard size={17} />} label="Invoices" value={company.usage.invoicesThisMonth.toString()} />
      </div>

      <section className="detail-section company-access-panel">
        <div className="section-title">
          <ShieldCheck size={18} aria-hidden="true" />
          <h3>Company access</h3>
        </div>
        <div className="access-credential-list">
          <div>
            <span>Company owner email</span>
            <strong>{company.ownerEmail}</strong>
          </div>
        </div>
        <label className="password-reset-field">
          Owner password
          <input
            type="text"
            value={ownerPassword}
            onChange={(event) => setOwnerPassword(event.target.value)}
            placeholder="Set or generate password"
            autoComplete="off"
          />
        </label>
        <div className="access-actions">
          <button className="secondary-button compact" type="button" onClick={generatePassword}>
            Generate
          </button>
          <button className="secondary-button compact" type="button" onClick={() => onSaveOwnerAccess('create', ownerPassword)}>
            Create access
          </button>
          <button className="secondary-button compact" type="button" onClick={() => onSaveOwnerAccess('reset', ownerPassword)}>
            Reset password
          </button>
        </div>
        {ownerInviteStatus ? <p className="access-status">{ownerInviteStatus}</p> : null}
        <p className="access-note">
          Share this email and password with the company owner. Supabase stores the auth account; ServiceScope does not send Supabase invite emails.
        </p>
      </section>


    </aside>
  );
}

export function MiniStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="mini-stat">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function StatusPill({ status }: { status: CompanyStatus }) {
  return <span className={`status-pill ${status}`}>{statusLabels[status]}</span>;
}

