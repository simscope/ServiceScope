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
import type { CompanyOnboardingStepKey } from '../appTypes';
import {
  auditCategoryLabels,
  billingLabels,
  platformRoleLabels,
  platformStatusLabels,
  statusLabels,
  stepLabels,
  ticketKindLabels,
  ticketPriorityLabels,
  ticketStatusLabels,
} from '../appLabels';
import { plans } from '../services/billingCatalog';
import { SYSTEM_OWNER_ID } from '../services/accessStore';
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
  OnboardingStepStatus,
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
  const newestCompanies = companies.slice(0, 4);
  const openTickets = supportTickets.filter((ticket) => ticket.status !== 'resolved').slice(0, 4);

  return (
    <div className="overview-grid">
      <section className="panel overview-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Tenant overview</p>
            <h2>Companies</h2>
          </div>
          <button className="secondary-button compact" type="button" onClick={onOpenCompanies}>
            Open
          </button>
        </div>
        <div className="overview-list">
          {newestCompanies.length ? (
            newestCompanies.map((company) => (
              <div className="overview-row" key={company.id}>
                <div className="company-main">
                  <div className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <h3>{company.name}</h3>
                    <p>{company.plan} - {company.market}</p>
                  </div>
                </div>
                <StatusPill status={company.status} />
              </div>
            ))
          ) : (
            <div className="empty-state compact-empty">
              <Building2 size={24} aria-hidden="true" />
              <h3>No companies yet</h3>
              <p>Add the first tenant from the Companies page.</p>
            </div>
          )}
        </div>
      </section>

      <section className="panel overview-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Customer voice</p>
            <h2>Support</h2>
          </div>
          <button className="secondary-button compact" type="button" onClick={onOpenSupport}>
            Open
          </button>
        </div>
        <div className="overview-list">
          {openTickets.length ? (
            openTickets.map((ticket) => (
              <div className="overview-row support-summary" key={ticket.id}>
                <div>
                  <h3>{ticket.subject}</h3>
                  <p>{ticket.companyName} - {ticketStatusLabels[ticket.status]}</p>
                </div>
                <span className={`ticket-priority ${ticket.priority}`}>{ticketPriorityLabels[ticket.priority]}</span>
              </div>
            ))
          ) : (
            <div className="empty-state compact-empty">
              <CheckCircle2 size={24} aria-hidden="true" />
              <h3>No open support</h3>
              <p>Resolved requests stay out of the owner dashboard.</p>
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
                <span className={completedSteps === onboardingStepOrder.length ? 'ok' : 'bad'}>Onboarding: {completedSteps}/4</span>
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
  const filteredUsers = users.filter((user) => {
    const normalizedSearch = accessSearch.trim().toLowerCase();
    const haystack = [user.name, user.email, platformRoleLabels[user.role], platformStatusLabels[user.status]]
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

  return (
    <div className="access-page">
      <section className="access-summary">
        <MetricCard icon={<Users size={20} />} label="Team users" value={users.length.toString()} detail="Owner console access" />
        <MetricCard icon={<CheckCircle2 size={20} />} label="Active" value={activeUsers.toString()} detail="Can sign in" />
        <MetricCard icon={<UserPlus size={20} />} label="Invited" value={invitedUsers.toString()} detail="Pending setup" />
        <MetricCard icon={<ShieldCheck size={20} />} label="Disabled" value={disabledUsers.toString()} detail="Access blocked" />
      </section>

      <section className="panel invite-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Platform team</p>
            <h2>Invite user</h2>
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
          <button className="primary-button" type="submit">
            <UserPlus size={18} aria-hidden="true" />
            Send invite
          </button>
        </form>
      </section>

      <section className="panel users-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">RBAC</p>
            <h2>Users</h2>
          </div>
          <Users size={20} aria-hidden="true" />
        </div>

        <div className="access-filter-grid">
          <label>
            Search
            <input value={accessSearch} onChange={(event) => setAccessSearch(event.target.value)} placeholder="Name or email" />
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

        <div className="user-list">
          {filteredUsers.map((user) => {
            const lockedOwner = user.id === SYSTEM_OWNER_ID;

            return (
              <article className={`user-row ${lockedOwner ? 'locked-owner' : ''}`} key={user.id}>
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
        <form className="support-form" onSubmit={onSubmit}>
          <label>
            Company
            <select value={form.companyId} onChange={(event) => selectCompany(event.target.value)}>
              {companies.map((company) => (
                <option value={company.id} key={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              Type
              <select value={form.kind} onChange={(event) => onFormChange({ ...form, kind: event.target.value as SupportTicketKind })}>
                <option value="bug">Bug</option>
                <option value="change">Change</option>
                <option value="question">Question</option>
              </select>
            </label>
            <label>
              Priority
              <select value={form.priority} onChange={(event) => onFormChange({ ...form, priority: event.target.value as SupportTicketPriority })}>
                <option value="normal">Normal</option>
                <option value="urgent">Urgent</option>
                <option value="low">Low</option>
              </select>
            </label>
          </div>
          <label>
            From
            <input value={form.authorName} onChange={(event) => onFormChange({ ...form, authorName: event.target.value })} placeholder={selectedCompany?.ownerName ?? 'Company owner'} />
          </label>
          <label>
            Reply email
            <input type="email" value={form.authorEmail} onChange={(event) => onFormChange({ ...form, authorEmail: event.target.value })} placeholder={selectedCompany?.ownerEmail ?? 'owner@company.com'} />
          </label>
          <label>
            Subject
            <input value={form.subject} onChange={(event) => onFormChange({ ...form, subject: event.target.value })} placeholder="What should change?" />
          </label>
          <label>
            Message
            <textarea value={form.message} onChange={(event) => onFormChange({ ...form, message: event.target.value })} placeholder="Describe the bug, missing feature, or request." />
          </label>
          <button className="primary-button" type="submit">
            <MailPlus size={18} aria-hidden="true" />
            Send to owner
          </button>
        </form>

        <div className="ticket-workspace">
          <div className="ticket-list">
            {tickets.map((ticket) => (
              <button
                className={`ticket-card ${ticket.priority} ${ticket.id === selectedTicket?.id ? 'selected' : ''}`}
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

          {selectedTicket ? (
            <article className="thread-panel">
              <div className="thread-header">
                <div>
                  <p className="eyebrow">{selectedTicket.companyName}</p>
                  <h3>{selectedTicket.subject}</h3>
                </div>
                <select value={selectedTicket.status} onChange={(event) => onStatusChange(selectedTicket.id, event.target.value as SupportTicketStatus)} aria-label={`Status for ${selectedTicket.subject}`}>
                  <option value="new">New</option>
                  <option value="reviewing">Reviewing</option>
                  <option value="planned">Planned</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>

              <div className="message-list">
                {selectedTicket.messages.map((message) => (
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
                <button className="secondary-button" type="button" onClick={() => onSendReply(selectedTicket.id)}>
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
          <p>{company.ownerName} - {company.market}</p>
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
  onPrepareNext,
  onCompleteStep,
  onSetTemporaryPassword,
}: {
  company: Company;
  onPrepareNext: () => void;
  onCompleteStep: (step: CompanyOnboardingStepKey) => void;
  onSetTemporaryPassword: (password: string) => void;
}) {
  const completedSteps = Object.values(company.onboarding).filter((step) => step === 'done').length;
  const readyToLaunch = completedSteps === onboardingStepOrder.length;
  const [temporaryPassword, setTemporaryPassword] = useState(company.temporaryPassword);

  useEffect(() => {
    setTemporaryPassword(company.temporaryPassword);
  }, [company.id, company.temporaryPassword]);

  function generatePassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%';
    const values = new Uint32Array(12);
    crypto.getRandomValues(values);

    return Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
  }

  function saveTemporaryPassword(password: string) {
    const nextPassword = password.trim();
    if (!nextPassword) return;
    setTemporaryPassword(nextPassword);
    onSetTemporaryPassword(nextPassword);
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
          <h3>Company invite</h3>
        </div>
        <div className="access-credential-list">
          <div>
            <span>Company owner email</span>
            <strong>{company.ownerEmail}</strong>
          </div>
        </div>
        <label className="password-reset-field">
          Temporary password
          <div className="password-field-row">
            <input
              type="text"
              value={temporaryPassword}
              onChange={(event) => setTemporaryPassword(event.target.value)}
              placeholder="Set new temporary password"
            />
            <button className="secondary-button compact" type="button" onClick={() => saveTemporaryPassword(temporaryPassword)}>
              Save
            </button>
          </div>
        </label>
        <button
          className="secondary-button compact"
          type="button"
          onClick={() => saveTemporaryPassword(generatePassword())}
        >
          Generate new password
        </button>
        <p className="access-note">
          The owner console prepares access only. Company users sign in with their own account.
        </p>
      </section>

      <section className="detail-section">
        <div className="section-title">
          <Database size={18} aria-hidden="true" />
          <h3>Provisioning</h3>
          <span>{completedSteps}/4</span>
        </div>
        <div className="steps-list">
          {Object.entries(company.onboarding).map(([step, stepStatus]) => (
            <div className="step-row" key={step}>
              <span className={`step-dot ${stepStatus}`} />
              <span>{stepLabels[step as keyof Company['onboarding']]}</span>
              {stepStatus === 'done' ? (
                <strong>{formatStepStatus(stepStatus)}</strong>
              ) : (
                <button className="step-action" type="button" onClick={() => onCompleteStep(step as CompanyOnboardingStepKey)}>
                  Complete
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <div className="section-title">
          <AlertTriangle size={18} aria-hidden="true" />
          <h3>Owner signals</h3>
          <span>{company.alerts.length}</span>
        </div>
        {company.alerts.length ? (
          <div className="alerts-list">
            {company.alerts.map((alert) => (
              <p key={alert}>{alert}</p>
            ))}
          </div>
        ) : (
          <p className="quiet-line">No active owner actions.</p>
        )}
      </section>

      <button className="secondary-button" type="button" onClick={onPrepareNext} disabled={readyToLaunch}>
        {readyToLaunch ? <Rocket size={17} aria-hidden="true" /> : <ServerCog size={17} aria-hidden="true" />}
        {readyToLaunch ? 'Workspace ready' : 'Prepare next step'}
      </button>
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

export function formatStepStatus(status: OnboardingStepStatus) {
  return status.replace('_', ' ');
}
