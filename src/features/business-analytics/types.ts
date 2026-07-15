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
  recall_rate: number;
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
  total_amount: number;
  jobs_count: number;
  older_than_30_days_amount: number;
  older_than_30_days_count: number;
  job_ids: string[];
};

export type RecallAnalytics = {
  current_count: number;
  previous_count: number;
  change_percent: number | null;
  job_ids: string[];
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
  recall_rate: number;
};

export type CustomerOpportunity = {
  customer_id: string;
  name: string;
  jobs_count?: number;
  revenue?: number;
  last_job_date: string;
  lifetime_jobs?: number;
  lifetime_revenue?: number;
  inactive_days?: number;
};

export type DataQualitySummary = {
  missing_completed_at: number;
  missing_technician: number;
  missing_material_cost: number;
  missing_equipment_type: number;
  missing_lead_source: number | null;
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
    href: string;
  };
};
