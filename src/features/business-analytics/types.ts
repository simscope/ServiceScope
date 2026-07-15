export type BusinessAnalyticsPeriod = {
  date_from: string;
  date_to: string;
};

export type BusinessAnalyticsSummary = {
  revenue: number;
  collected: number;
  unpaid: number;
  materials: number;
  technician_payroll: number;
  estimated_gross_profit: number;
  completed_jobs: number;
  recall_jobs: number;
  recall_rate: number | null;
  average_ticket: number;
};

export type BusinessAnalyticsComparison = {
  revenue_percent: number | null;
  collected_percent: number | null;
  unpaid_percent: number | null;
  materials_percent: number | null;
  technician_payroll_percent: number | null;
  estimated_gross_profit_percent: number | null;
  completed_jobs_percent: number | null;
  recall_rate_percent: number | null;
  average_ticket_percent: number | null;
};

export type UnpaidAnalytics = {
  period_total_amount: number;
  period_jobs_count: number;
  total_outstanding_amount: number;
  total_outstanding_jobs_count: number;
  older_than_30_days_amount: number;
  older_than_30_days_count: number;
  period_job_ids: string[];
  older_than_30_days_job_ids: string[];
  aging_basis: 'completed-age';
};

export type RecallAnalytics = {
  current_count: number;
  previous_count: number;
  change_percent: number | null;
  job_ids: string[];
  measurement_mode: 'snapshot' | 'period';
  rate_available: boolean;
  notice: string;
};

export type TechnicianAnalytics = {
  technician_id: string | null;
  technician: string;
  completed_jobs: number;
  revenue: number;
  collected: number;
  average_ticket: number;
  materials: number;
  payroll: number;
  estimated_gross_profit: number;
  recall_count: number;
  recall_rate: number | null;
};

export type CustomerOpportunity = {
  customer_id: string;
  name: string;
  job_ids?: string[];
  jobs_count?: number;
  revenue?: number;
  last_job_date: string;
  lifetime_jobs?: number;
  lifetime_revenue?: number;
  inactive_days?: number;
};

export type DataQualitySummary = {
  period: {
    missing_completed_at: number;
    missing_technician: number;
    missing_material_cost: number;
    missing_equipment_type: number;
  };
  company_wide: {
    missing_lead_source: number | null;
  };
};

export type BusinessAnalyticsMetadata = {
  timezone: string;
  timezone_source: 'company_profile' | 'fallback';
  technician_filter_applied: boolean;
  customer_opportunities_scope: 'company-wide';
};

export type BusinessAnalyticsResponse = {
  period: BusinessAnalyticsPeriod;
  previous_period: BusinessAnalyticsPeriod;
  summary: BusinessAnalyticsSummary;
  comparison: BusinessAnalyticsComparison;
  unpaid: UnpaidAnalytics;
  recalls: RecallAnalytics;
  technicians: TechnicianAnalytics[];
  customer_opportunities: {
    service_contract_candidates: CustomerOpportunity[];
    inactive_customers: CustomerOpportunity[];
  };
  data_quality: DataQualitySummary;
  metadata: BusinessAnalyticsMetadata;
};

export type BusinessInsight = {
  id: string;
  type: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  value?: number;
  changePercent?: number | null;
  action?: {
    label: string;
    target: BusinessInsightActionTarget;
  };
};

export type BusinessInsightActionTarget = 'debtors' | 'allJobs' | 'opportunities';
