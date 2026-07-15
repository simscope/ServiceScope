import type { BusinessAnalyticsResponse, BusinessInsight } from './types';

export const BUSINESS_ANALYTICS_THRESHOLDS = {
  recallRateAbsolute: 0.08,
  recallRateIncreasePercent: 20,
  serviceContractCandidateLimit: 5,
  serviceContractRevenueThreshold: 2500,
  inactiveCustomerLimit: 3,
  inactiveDays: 180,
};

function percentPoint(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function buildBusinessInsights(analytics: BusinessAnalyticsResponse): BusinessInsight[] {
  const insights: BusinessInsight[] = [];

  if (analytics.unpaid.jobs_count > 0) {
    insights.push({
      id: 'unpaid-completed-jobs',
      type: 'unpaid',
      severity: analytics.unpaid.older_than_30_days_count > 0 ? 'high' : 'medium',
      title: 'Completed jobs still have unpaid balances',
      description: `${analytics.unpaid.jobs_count} completed job${analytics.unpaid.jobs_count === 1 ? '' : 's'} have unpaid SCF or Labor.`,
      value: analytics.unpaid.total_amount,
      action: { label: 'Open Debtors', href: '#debtors' },
    });
  }

  if (analytics.unpaid.older_than_30_days_count > 0) {
    insights.push({
      id: 'unpaid-over-30-days',
      type: 'aged-debt',
      severity: 'high',
      title: 'Debt older than 30 days needs follow-up',
      description: `${analytics.unpaid.older_than_30_days_count} unpaid completed job${analytics.unpaid.older_than_30_days_count === 1 ? '' : 's'} are older than 30 days.`,
      value: analytics.unpaid.older_than_30_days_amount,
      action: { label: 'Review Debtors', href: '#debtors?age=30' },
    });
  }

  const recallIncrease = analytics.comparison.recall_rate_percent;
  if (
    analytics.summary.recall_rate >= BUSINESS_ANALYTICS_THRESHOLDS.recallRateAbsolute ||
    (recallIncrease !== null && recallIncrease >= BUSINESS_ANALYTICS_THRESHOLDS.recallRateIncreasePercent)
  ) {
    insights.push({
      id: 'recall-rate-growth',
      type: 'recall',
      severity: analytics.summary.recall_rate >= BUSINESS_ANALYTICS_THRESHOLDS.recallRateAbsolute ? 'high' : 'medium',
      title: 'Recall rate is elevated',
      description: `Current recall rate is ${percentPoint(analytics.summary.recall_rate)} with ${analytics.recalls.current_count} recall job${analytics.recalls.current_count === 1 ? '' : 's'} versus ${analytics.recalls.previous_count} in the previous period.`,
      value: analytics.summary.recall_rate,
      changePercent: recallIncrease,
      action: { label: 'Open Recall Jobs', href: '#allJobs?status=ReCall' },
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
      action: { label: 'Review Customers', href: '#aiBusiness-opportunities' },
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
      action: { label: 'Review Opportunities', href: '#aiBusiness-opportunities' },
    });
  }

  return insights;
}
