-- Business Analytics reconciliation helper.
-- Replace the values in params and run after migration 20260714180000.
-- This diagnostic output is intentionally separate from the production UI.

with params as (
  select
    '00000000-0000-0000-0000-000000000000'::uuid as company_id,
    '2026-06-15'::date as date_from,
    '2026-07-14'::date as date_to,
    null::uuid as technician_id
),
boundaries as (
  select
    params.*,
    public.business_analytics_company_timezone(params.company_id) as timezone
  from params
),
facts as (
  select
    facts.*,
    boundaries.timezone
  from boundaries
  cross join lateral public.business_analytics_job_facts(
    boundaries.company_id,
    boundaries.date_from::timestamp at time zone boundaries.timezone,
    (boundaries.date_to + 1)::timestamp at time zone boundaries.timezone,
    boundaries.technician_id
  ) facts
)
select jsonb_agg(
  jsonb_build_object(
    'job_id', job_id,
    'analytics_date', (analytics_at at time zone timezone)::date,
    'status', status,
    'scf', scf_cents::numeric / 100,
    'labor', labor_cents::numeric / 100,
    'scf_paid', scf_paid,
    'labor_paid', labor_paid,
    'materials', materials_cents::numeric / 100,
    'payroll', payroll_cents::numeric / 100,
    'unpaid', unpaid_cents::numeric / 100
  )
  order by analytics_at, job_id
) as reconciliation_jobs
from facts;
