import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, RefreshCw } from 'lucide-react';
import { getBusinessAnalytics } from '../../features/business-analytics/api';
import { buildBusinessInsights } from '../../features/business-analytics/insights';
import type { BusinessAnalyticsComparison, BusinessAnalyticsResponse, BusinessAnalyticsSummary, BusinessInsight, CustomerOpportunity, DataQualitySummary, TechnicianAnalytics } from '../../features/business-analytics/types';
import { money } from '../../utils/format';

type BusinessAnalyticsPageProps = {
  selectedCompanyId: string;
  currentPortalUser: { name: string; role: 'Admin' | 'Manager' | 'Technician' };
};

type PeriodPreset = 'last7' | 'last30' | 'last90' | 'thisMonth' | 'lastMonth' | 'custom';

type DateRange = {
  from: string;
  to: string;
};

type KpiConfig = {
  key: keyof BusinessAnalyticsSummary;
  comparisonKey: keyof BusinessAnalyticsComparison;
  label: string;
  format: 'money' | 'number' | 'percent';
  trend: 'higher-good' | 'lower-good' | 'neutral';
};

const kpis: KpiConfig[] = [
  { key: 'revenue', comparisonKey: 'revenue_percent', label: 'Revenue', format: 'money', trend: 'higher-good' },
  { key: 'collected', comparisonKey: 'collected_percent', label: 'Collected', format: 'money', trend: 'higher-good' },
  { key: 'unpaid', comparisonKey: 'unpaid_percent', label: 'Unpaid', format: 'money', trend: 'lower-good' },
  { key: 'materials', comparisonKey: 'materials_percent', label: 'Materials', format: 'money', trend: 'neutral' },
  { key: 'technician_payroll', comparisonKey: 'technician_payroll_percent', label: 'Technician Payroll', format: 'money', trend: 'neutral' },
  { key: 'estimated_gross_profit', comparisonKey: 'estimated_gross_profit_percent', label: 'Estimated Gross Profit', format: 'money', trend: 'higher-good' },
  { key: 'completed_jobs', comparisonKey: 'completed_jobs_percent', label: 'Completed Jobs', format: 'number', trend: 'higher-good' },
  { key: 'recall_rate', comparisonKey: 'recall_rate_percent', label: 'Recall Rate', format: 'percent', trend: 'lower-good' },
  { key: 'average_ticket', comparisonKey: 'average_ticket_percent', label: 'Average Ticket', format: 'money', trend: 'higher-good' },
];

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function rangeForPreset(preset: PeriodPreset): DateRange {
  const today = new Date();
  if (preset === 'last7') {
    const from = new Date(today);
    from.setDate(today.getDate() - 6);
    return { from: isoDate(from), to: isoDate(today) };
  }
  if (preset === 'last90') {
    const from = new Date(today);
    from.setDate(today.getDate() - 89);
    return { from: isoDate(from), to: isoDate(today) };
  }
  if (preset === 'thisMonth') {
    return { from: isoDate(startOfMonth(today)), to: isoDate(today) };
  }
  if (preset === 'lastMonth') {
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return { from: isoDate(startOfMonth(lastMonth)), to: isoDate(endOfMonth(lastMonth)) };
  }
  const from = new Date(today);
  from.setDate(today.getDate() - 29);
  return { from: isoDate(from), to: isoDate(today) };
}

function formatDate(value: string) {
  if (!value) return '';
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US');
}

function formatValue(value: number, format: KpiConfig['format']) {
  if (format === 'money') return money(value);
  if (format === 'percent') return `${(value * 100).toFixed(1)}%`;
  return new Intl.NumberFormat('en-US').format(value);
}

function formatPercent(value: number | null) {
  if (value === null) return 'No comparison';
  if (value === 0) return '0%';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function trendClass(change: number | null, trend: KpiConfig['trend']) {
  if (change === null || change === 0 || trend === 'neutral') return 'neutral';
  if (trend === 'higher-good') return change > 0 ? 'good' : 'bad';
  return change > 0 ? 'bad' : 'good';
}

function TrendIcon({ change }: { change: number | null }) {
  if (change === null || change === 0) return <ArrowRight size={16} aria-hidden="true" />;
  return change > 0 ? <ArrowUpRight size={16} aria-hidden="true" /> : <ArrowDownRight size={16} aria-hidden="true" />;
}

function KpiCard({ analytics, config }: { analytics: BusinessAnalyticsResponse; config: KpiConfig }) {
  const change = analytics.comparison[config.comparisonKey];
  const state = trendClass(change, config.trend);

  return (
    <article className={'business-kpi-card ' + state}>
      <span>{config.label}</span>
      <strong>{formatValue(analytics.summary[config.key], config.format)}</strong>
      <small>
        <TrendIcon change={change} />
        {formatPercent(change)}
      </small>
    </article>
  );
}

function InsightCard({ insight }: { insight: BusinessInsight }) {
  return (
    <article className={'business-insight-card ' + insight.severity}>
      <div>
        <span>{insight.severity}</span>
        <h3>{insight.title}</h3>
        <p>{insight.description}</p>
      </div>
      {typeof insight.value === 'number' ? <strong>{insight.type === 'recall' ? `${(insight.value * 100).toFixed(1)}%` : money(insight.value)}</strong> : null}
      {insight.action ? <a className="secondary-button compact" href={insight.action.href}>{insight.action.label}</a> : null}
    </article>
  );
}

function TechnicianTable({ technicians }: { technicians: TechnicianAnalytics[] }) {
  return (
    <div className="business-table-wrap">
      <table className="business-table">
        <thead>
          <tr>
            <th>Technician</th>
            <th>Completed Jobs</th>
            <th>Revenue</th>
            <th>Collected</th>
            <th>Average Ticket</th>
            <th>Materials</th>
            <th>Payroll</th>
            <th>Estimated Gross Profit</th>
            <th>Recall Count</th>
            <th>Recall Rate</th>
          </tr>
        </thead>
        <tbody>
          {technicians.map((technician) => (
            <tr key={technician.technician_id ?? technician.technician}>
              <td>{technician.technician}</td>
              <td>{technician.completed_jobs}</td>
              <td>{money(technician.revenue)}</td>
              <td>{money(technician.collected)}</td>
              <td>{money(technician.average_ticket)}</td>
              <td>{money(technician.materials)}</td>
              <td>{money(technician.payroll)}</td>
              <td>{money(technician.estimated_gross_profit)}</td>
              <td>{technician.recall_count}</td>
              <td>{(technician.recall_rate * 100).toFixed(1)}%</td>
            </tr>
          ))}
          {!technicians.length ? (
            <tr>
              <td colSpan={10}><div className="empty-inline">No technician performance data for this period.</div></td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function OpportunityList({ title, customers }: { title: string; customers: CustomerOpportunity[] }) {
  return (
    <section className="business-opportunity-list">
      <h3>{title}</h3>
      {customers.map((customer) => (
        <a className="business-opportunity-row" href={`#allJobs?customer=${encodeURIComponent(customer.customer_id)}`} key={customer.customer_id}>
          <span>
            <strong>{customer.name}</strong>
            <small>Last job {formatDate(customer.last_job_date)}</small>
          </span>
          <span>{customer.jobs_count ?? customer.lifetime_jobs ?? 0} jobs</span>
          <span>{money(customer.revenue ?? customer.lifetime_revenue ?? 0)}</span>
          {customer.inactive_days ? <span>{customer.inactive_days} days inactive</span> : null}
        </a>
      ))}
      {!customers.length ? <div className="empty-inline">No customers match this opportunity rule yet.</div> : null}
    </section>
  );
}

function DataQuality({ dataQuality }: { dataQuality: DataQualitySummary }) {
  const rows = [
    ['Completed jobs without completed_at', dataQuality.missing_completed_at],
    ['Jobs without technician', dataQuality.missing_technician],
    ['Materials without cost', dataQuality.missing_material_cost],
    ['Jobs without equipment type', dataQuality.missing_equipment_type],
  ] as const;

  return (
    <section className="business-data-quality">
      {rows.map(([label, value]) => (
        <article key={label}>
          <strong>{value}</strong>
          <span>{label}</span>
        </article>
      ))}
      <article>
        <strong>{dataQuality.missing_lead_source ?? '-'}</strong>
        <span>{dataQuality.missing_lead_source === null ? 'Lead source tracking is not configured yet.' : 'Jobs without lead source'}</span>
      </article>
    </section>
  );
}

export function BusinessAnalyticsPage({ selectedCompanyId, currentPortalUser }: BusinessAnalyticsPageProps) {
  const [preset, setPreset] = useState<PeriodPreset>('last30');
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('last30'));
  const [analytics, setAnalytics] = useState<BusinessAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const insights = useMemo(() => analytics ? buildBusinessInsights(analytics) : [], [analytics]);
  const hasFinancialAccess = currentPortalUser.role === 'Admin' || currentPortalUser.role === 'Manager';

  useEffect(() => {
    if (preset === 'custom') return;
    setRange(rangeForPreset(preset));
  }, [preset]);

  const loadAnalytics = async () => {
    if (!selectedCompanyId || !hasFinancialAccess) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await getBusinessAnalytics({
        companyId: selectedCompanyId,
        dateFrom: range.from,
        dateTo: range.to,
      });
      setAnalytics(result);
      setLastUpdated(new Date().toLocaleString('en-US'));
    } catch (loadError) {
      const devMode = Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
      if (devMode) console.error('Business analytics failed', loadError);
      setError('Business analytics could not be loaded. Check access and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAnalytics();
  }, [selectedCompanyId, range.from, range.to, hasFinancialAccess]);

  if (!hasFinancialAccess) {
    return (
      <section className="business-analytics-page">
        <div className="business-access-state">
          <AlertTriangle size={24} aria-hidden="true" />
          <h1>Business Analyst</h1>
          <p>This page requires financial access. Technicians cannot view company revenue, payroll, debt, or team comparisons.</p>
        </div>
      </section>
    );
  }

  const noCurrentData = analytics && analytics.summary.completed_jobs === 0 && analytics.summary.revenue === 0 && analytics.summary.collected === 0;
  const noPreviousData = analytics && Object.values(analytics.comparison).every((value) => value === null || value === 0);

  return (
    <section className="business-analytics-page">
      <div className="business-analytics-header">
        <div>
          <p className="eyebrow">Analytics MVP</p>
          <h1>AI Business Analyst</h1>
          {analytics ? (
            <p>{formatDate(analytics.period.date_from)} - {formatDate(analytics.period.date_to)} compared with {formatDate(analytics.previous_period.date_from)} - {formatDate(analytics.previous_period.date_to)}</p>
          ) : (
            <p>{formatDate(range.from)} - {formatDate(range.to)}</p>
          )}
        </div>
        <div className="business-refresh">
          <span>{lastUpdated ? `Updated ${lastUpdated}` : 'Not updated yet'}</span>
          <button className="secondary-button compact" type="button" onClick={loadAnalytics} disabled={loading}>
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      <div className="business-period-toolbar">
        <label>
          Period
          <select value={preset} onChange={(event) => setPreset(event.target.value as PeriodPreset)}>
            <option value="last7">Last 7 Days</option>
            <option value="last30">Last 30 Days</option>
            <option value="last90">Last 90 Days</option>
            <option value="thisMonth">This Month</option>
            <option value="lastMonth">Last Month</option>
            <option value="custom">Custom Range</option>
          </select>
        </label>
        {preset === 'custom' ? (
          <>
            <label>
              From
              <input type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} />
            </label>
            <label>
              To
              <input type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} />
            </label>
          </>
        ) : null}
      </div>

      {loading ? (
        <div className="business-status-card">
          <BarChart3 size={24} aria-hidden="true" />
          <h2>Loading analytics...</h2>
          <p>Calculating business metrics from Supabase.</p>
        </div>
      ) : error ? (
        <div className="business-status-card error">
          <AlertTriangle size={24} aria-hidden="true" />
          <h2>Analytics unavailable</h2>
          <p>{error}</p>
          <button className="primary-button compact" type="button" onClick={loadAnalytics}>Retry</button>
        </div>
      ) : analytics ? (
        <>
          {noCurrentData ? <div className="business-note">No completed financial data was found for this period.</div> : null}
          {noPreviousData ? <div className="business-note">Previous period has no comparable data yet.</div> : null}

          <section className="business-kpi-grid">
            {kpis.map((config) => <KpiCard analytics={analytics} config={config} key={config.key} />)}
          </section>

          <section className="business-section">
            <div className="business-section-heading">
              <h2>Requires Attention</h2>
              <span>{insights.length} insight{insights.length === 1 ? '' : 's'}</span>
            </div>
            <div className="business-insight-grid">
              {insights.map((insight) => <InsightCard insight={insight} key={insight.id} />)}
              {!insights.length ? <div className="empty-inline">No automatic warnings for this period.</div> : null}
            </div>
          </section>

          <section className="business-section">
            <div className="business-section-heading">
              <h2>Technician Performance</h2>
              <span>Financial access required</span>
            </div>
            <TechnicianTable technicians={analytics.technicians} />
          </section>

          <section className="business-section" id="aiBusiness-opportunities">
            <div className="business-section-heading">
              <h2>Customer Opportunities</h2>
              <span>Rules-based</span>
            </div>
            <div className="business-opportunities-grid">
              <OpportunityList title="Service Contract Candidates" customers={analytics.customer_opportunities.service_contract_candidates} />
              <OpportunityList title="Inactive Customers" customers={analytics.customer_opportunities.inactive_customers} />
            </div>
          </section>

          <section className="business-section">
            <div className="business-section-heading">
              <h2>Data Quality</h2>
              <span>Source readiness</span>
            </div>
            <DataQuality dataQuality={analytics.data_quality} />
          </section>
        </>
      ) : (
        <div className="business-status-card">
          <BarChart3 size={24} aria-hidden="true" />
          <h2>No analytics data</h2>
          <p>Choose a period and refresh the report.</p>
        </div>
      )}
    </section>
  );
}
