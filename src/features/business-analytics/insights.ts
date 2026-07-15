import type { BusinessAnalyticsResponse, BusinessInsight } from './types';

export const BUSINESS_ANALYTICS_THRESHOLDS = {
  recallRateAbsolute: 0.08,
  recallRateIncreasePercent: 20,
  serviceContractCandidateLimit: 5,
  serviceContractRevenueThreshold: 2500,
  inactiveCustomerLimit: 3,
  inactiveDays: 180,
};

export function buildBusinessInsights(analytics: BusinessAnalyticsResponse): BusinessInsight[] {
  const insights: BusinessInsight[] = [];

  if (analytics.unpaid.period_jobs_count > 0) {
    insights.push({
      id: 'unpaid-completed-jobs',
      type: 'unpaid',
      severity: analytics.unpaid.older_than_30_days_count > 0 ? 'high' : 'medium',
      title: 'Completed jobs still have unpaid balances',
      description: `${analytics.unpaid.period_jobs_count} completed job${analytics.unpaid.period_jobs_count === 1 ? '' : 's'} in this period have unpaid SCF or Labor.`,
      value: analytics.unpaid.period_total_amount,
      action: { label: 'Open Debtors', target: 'debtors' },
    });
  }

  if (analytics.unpaid.older_than_30_days_count > 0) {
    insights.push({
      id: 'unpaid-over-30-days',
      type: 'aged-debt',
      severity: 'high',
      title: 'Debt older than 30 days needs follow-up',
      description: `${analytics.unpaid.older_than_30_days_count} outstanding job${analytics.unpaid.older_than_30_days_count === 1 ? '' : 's'} are older than 30 days by completed-age.`,
      value: analytics.unpaid.older_than_30_days_amount,
      action: { label: 'Review Debtors', target: 'debtors' },
    });
  }

  const contractCandidates = analytics.customer_opportunities.service_contract_candidates;
  if (contractCandidates.length > 0) {
    const topCandidate = contractCandidates[0];
    insights.push({
      id: 'service-contract-candidates',
      type: 'customer-opportunity',
      severity: 'low',
      title: 'Service contract candidates found',
      description: `${contractCandidates.length} customer${contractCandidates.length === 1 ? '' : 's'} meet repeat-service or revenue thresholds. Top candidate: ${topCandidate.name}.`,
      value: topCandidate.revenue,
      action: { label: 'Review Customers', target: 'opportunities' },
    });
  }

  const inactiveCustomers = analytics.customer_opportunities.inactive_customers;
  if (inactiveCustomers.length > 0) {
    const topCustomer = inactiveCustomers[0];
    insights.push({
      id: 'inactive-repeat-customers',
      type: 'reactivation',
      severity: 'medium',
      title: 'Repeat customers are inactive',
      description: `${inactiveCustomers.length} repeat customer${inactiveCustomers.length === 1 ? '' : 's'} have been inactive for more than ${BUSINESS_ANALYTICS_THRESHOLDS.inactiveDays} days. Longest inactive: ${topCustomer.name}.`,
      value: topCustomer.lifetime_revenue,
      action: { label: 'Review Opportunities', target: 'opportunities' },
    });
  }

  return insights;
}
