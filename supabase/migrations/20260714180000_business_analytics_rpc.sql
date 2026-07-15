create or replace function public.business_analytics_percent_change(p_current numeric, p_previous numeric)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_previous, 0) > 0 then round(((coalesce(p_current, 0) - p_previous) / p_previous) * 100, 2)
    when coalesce(p_previous, 0) = 0 and coalesce(p_current, 0) > 0 then null
    else 0
  end;
$$;

create or replace function public.get_business_analytics(
  p_company_id uuid,
  p_date_from date,
  p_date_to date,
  p_technician_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_previous_from date;
  v_previous_to date;
  v_has_access boolean;
  v_current jsonb;
  v_previous jsonb;
  v_comparison jsonb;
  v_unpaid jsonb;
  v_recalls jsonb;
  v_technicians jsonb;
  v_service_contract_candidates jsonb;
  v_inactive_customers jsonb;
  v_data_quality jsonb;
begin
  if p_company_id is null or p_date_from is null or p_date_to is null or p_date_to < p_date_from then
    raise exception 'Invalid business analytics parameters';
  end if;

  select
    public.is_platform_team()
    or exists (
      select 1
      from public.companies
      where companies.id = p_company_id
        and lower(companies.owner_email::text) = lower(coalesce(auth.email(), ''))
    )
    or exists (
      select 1
      from public.company_users
      where company_users.company_id = p_company_id
        and company_users.status = 'active'
        and (
          company_users.auth_user_id = auth.uid()
          or lower(company_users.email::text) = lower(coalesce(auth.email(), ''))
        )
        and (
          company_users.role = 'admin'
          or (
            company_users.role = 'manager'
            and coalesce(
              company_users.portal_access_rules->>'aiBusiness',
              company_users.portal_access_rules->>'finances',
              'off'
            ) in ('full', 'readonly')
          )
        )
    )
  into v_has_access;

  if not coalesce(v_has_access, false) then
    raise exception 'Business analytics access denied';
  end if;

  v_days := (p_date_to - p_date_from) + 1;
  v_previous_to := p_date_from - 1;
  v_previous_from := v_previous_to - (v_days - 1);

  with
  job_dates as (
    select
      jobs.id,
      jobs.company_id,
      jobs.customer_id,
      jobs.technician_id,
      jobs.job_number,
      jobs.status,
      jobs.system,
      jobs.service_call_fee_cents,
      jobs.labor_cents,
      jobs.completed_at,
      jobs.created_at,
      coalesce(jobs.completed_at, min(appointments.starts_at), jobs.created_at) as analytics_date
    from public.jobs
    left join public.appointments
      on appointments.company_id = jobs.company_id
      and appointments.job_id = jobs.id
    where jobs.company_id = p_company_id
      and (p_technician_id is null or jobs.technician_id = p_technician_id)
      and jobs.status in ('Completed', 'Warranty', 'ReCall')
    group by jobs.id
  ),
  material_totals as (
    select
      job_materials.job_id,
      sum(round(coalesce(job_materials.quantity, 1) * coalesce(job_materials.unit_price_cents, 0)))::bigint as materials_cents,
      count(*) filter (where coalesce(job_materials.unit_price_cents, 0) = 0) as missing_cost_count
    from public.job_materials
    where job_materials.company_id = p_company_id
    group by job_materials.job_id
  ),
  payment_totals as (
    select
      job_payments.job_id,
      bool_or(job_payments.scope = 'scf' and job_payments.method is not null) as scf_paid,
      bool_or(job_payments.scope = 'labor' and job_payments.method is not null) as labor_paid
    from public.job_payments
    where job_payments.company_id = p_company_id
      and job_payments.scope in ('scf', 'labor')
    group by job_payments.job_id
  ),
  rules as (
    select
      coalesce(company_payroll_rules.commission_percent, 50)::numeric as commission_percent,
      coalesce(company_payroll_rules.scf_only_payout_cents, 5000)::bigint as scf_only_payout_cents,
      coalesce(company_payroll_rules.include_scf_in_commission_base, true) as include_scf,
      coalesce(company_payroll_rules.deduct_materials_before_payroll, true) as deduct_materials
    from (select p_company_id as company_id) target
    left join public.company_payroll_rules on company_payroll_rules.company_id = target.company_id
  ),
  enriched as (
    select
      job_dates.*,
      coalesce(material_totals.materials_cents, 0)::bigint as materials_cents,
      coalesce(material_totals.missing_cost_count, 0)::bigint as missing_material_cost_count,
      case when coalesce(payment_totals.scf_paid, false) then coalesce(job_dates.service_call_fee_cents, 0) else 0 end::bigint as paid_scf_cents,
      case when coalesce(payment_totals.labor_paid, false) then coalesce(job_dates.labor_cents, 0) else 0 end::bigint as paid_labor_cents,
      (case when coalesce(payment_totals.scf_paid, false) then 0 else coalesce(job_dates.service_call_fee_cents, 0) end
        + case when coalesce(payment_totals.labor_paid, false) then 0 else coalesce(job_dates.labor_cents, 0) end)::bigint as unpaid_cents
    from job_dates
    left join material_totals on material_totals.job_id = job_dates.id
    left join payment_totals on payment_totals.job_id = job_dates.id
  ),
  calculated as (
    select
      enriched.*,
      (coalesce(enriched.service_call_fee_cents, 0) + coalesce(enriched.labor_cents, 0))::bigint as revenue_cents,
      (enriched.paid_scf_cents + enriched.paid_labor_cents)::bigint as collected_cents,
      case
        when enriched.paid_scf_cents > 0 and enriched.paid_labor_cents = 0 then (select scf_only_payout_cents from rules)
        else round(
          greatest(
            0,
            (case when (select include_scf from rules) then enriched.paid_scf_cents else 0 end)
              + enriched.paid_labor_cents
              - (case when (select deduct_materials from rules) then enriched.materials_cents else 0 end)
          ) * ((select commission_percent from rules) / 100)
        )::bigint
      end as payroll_cents
    from enriched
  ),
  period_rows as (
    select *, 'current'::text as period_key
    from calculated
    where analytics_date >= p_date_from::timestamptz
      and analytics_date < (p_date_to + 1)::timestamptz
    union all
    select *, 'previous'::text as period_key
    from calculated
    where analytics_date >= v_previous_from::timestamptz
      and analytics_date < (v_previous_to + 1)::timestamptz
  ),
  summaries as (
    select
      period_key,
      coalesce(sum(revenue_cents) filter (where status in ('Completed', 'Warranty')), 0)::numeric / 100 as revenue,
      coalesce(sum(collected_cents) filter (where status in ('Completed', 'Warranty')), 0)::numeric / 100 as collected,
      coalesce(sum(unpaid_cents) filter (where status in ('Completed', 'Warranty')), 0)::numeric / 100 as unpaid,
      coalesce(sum(materials_cents) filter (where status in ('Completed', 'Warranty')), 0)::numeric / 100 as materials,
      coalesce(sum(payroll_cents) filter (where status in ('Completed', 'Warranty')), 0)::numeric / 100 as technician_payroll,
      count(*) filter (where status in ('Completed', 'Warranty'))::numeric as completed_jobs,
      count(*) filter (where status = 'ReCall')::numeric as recall_jobs
    from period_rows
    group by period_key
  ),
  normalized_summaries as (
    select
      key as period_key,
      coalesce(revenue, 0) as revenue,
      coalesce(collected, 0) as collected,
      coalesce(unpaid, 0) as unpaid,
      coalesce(materials, 0) as materials,
      coalesce(technician_payroll, 0) as technician_payroll,
      coalesce(collected, 0) - coalesce(materials, 0) - coalesce(technician_payroll, 0) as estimated_gross_profit,
      coalesce(completed_jobs, 0) as completed_jobs,
      coalesce(recall_jobs, 0) as recall_jobs,
      case when coalesce(completed_jobs, 0) > 0 then coalesce(recall_jobs, 0) / completed_jobs else 0 end as recall_rate,
      case when coalesce(completed_jobs, 0) > 0 then coalesce(revenue, 0) / completed_jobs else 0 end as average_ticket
    from (values ('current'), ('previous')) as periods(key)
    left join summaries on summaries.period_key = periods.key
  )
  select jsonb_build_object(
    'revenue', revenue,
    'collected', collected,
    'unpaid', unpaid,
    'materials', materials,
    'technician_payroll', technician_payroll,
    'estimated_gross_profit', estimated_gross_profit,
    'completed_jobs', completed_jobs,
    'recall_jobs', recall_jobs,
    'recall_rate', recall_rate,
    'average_ticket', average_ticket
  )
  into v_current
  from normalized_summaries
  where period_key = 'current';

  with
  job_dates as (
    select jobs.id, jobs.company_id, jobs.customer_id, jobs.technician_id, jobs.job_number, jobs.status, jobs.system, jobs.service_call_fee_cents, jobs.labor_cents, jobs.completed_at, jobs.created_at, coalesce(jobs.completed_at, min(appointments.starts_at), jobs.created_at) as analytics_date
    from public.jobs
    left join public.appointments on appointments.company_id = jobs.company_id and appointments.job_id = jobs.id
    where jobs.company_id = p_company_id and (p_technician_id is null or jobs.technician_id = p_technician_id) and jobs.status in ('Completed', 'Warranty', 'ReCall')
    group by jobs.id
  ),
  material_totals as (
    select job_id, sum(round(coalesce(quantity, 1) * coalesce(unit_price_cents, 0)))::bigint as materials_cents
    from public.job_materials
    where company_id = p_company_id
    group by job_id
  ),
  payment_totals as (
    select job_id, bool_or(scope = 'scf' and method is not null) as scf_paid, bool_or(scope = 'labor' and method is not null) as labor_paid
    from public.job_payments
    where company_id = p_company_id and scope in ('scf', 'labor')
    group by job_id
  ),
  rules as (
    select coalesce(commission_percent, 50)::numeric as commission_percent, coalesce(scf_only_payout_cents, 5000)::bigint as scf_only_payout_cents, coalesce(include_scf_in_commission_base, true) as include_scf, coalesce(deduct_materials_before_payroll, true) as deduct_materials
    from (select p_company_id as company_id) target
    left join public.company_payroll_rules on company_payroll_rules.company_id = target.company_id
  ),
  enriched as (
    select job_dates.*, coalesce(material_totals.materials_cents, 0)::bigint as materials_cents,
      case when coalesce(payment_totals.scf_paid, false) then coalesce(job_dates.service_call_fee_cents, 0) else 0 end::bigint as paid_scf_cents,
      case when coalesce(payment_totals.labor_paid, false) then coalesce(job_dates.labor_cents, 0) else 0 end::bigint as paid_labor_cents,
      (case when coalesce(payment_totals.scf_paid, false) then 0 else coalesce(job_dates.service_call_fee_cents, 0) end + case when coalesce(payment_totals.labor_paid, false) then 0 else coalesce(job_dates.labor_cents, 0) end)::bigint as unpaid_cents
    from job_dates
    left join material_totals on material_totals.job_id = job_dates.id
    left join payment_totals on payment_totals.job_id = job_dates.id
  ),
  calculated as (
    select enriched.*, (coalesce(service_call_fee_cents, 0) + coalesce(labor_cents, 0))::bigint as revenue_cents, (paid_scf_cents + paid_labor_cents)::bigint as collected_cents,
      case when paid_scf_cents > 0 and paid_labor_cents = 0 then (select scf_only_payout_cents from rules)
      else round(greatest(0, (case when (select include_scf from rules) then paid_scf_cents else 0 end) + paid_labor_cents - (case when (select deduct_materials from rules) then materials_cents else 0 end)) * ((select commission_percent from rules) / 100))::bigint end as payroll_cents
    from enriched
  ),
  previous_rows as (
    select *
    from calculated
    where analytics_date >= v_previous_from::timestamptz and analytics_date < (v_previous_to + 1)::timestamptz
  ),
  previous_summary as (
    select
      coalesce(sum(revenue_cents) filter (where status in ('Completed', 'Warranty')), 0)::numeric / 100 as revenue,
      coalesce(sum(collected_cents) filter (where status in ('Completed', 'Warranty')), 0)::numeric / 100 as collected,
      coalesce(sum(unpaid_cents) filter (where status in ('Completed', 'Warranty')), 0)::numeric / 100 as unpaid,
      coalesce(sum(materials_cents) filter (where status in ('Completed', 'Warranty')), 0)::numeric / 100 as materials,
      coalesce(sum(payroll_cents) filter (where status in ('Completed', 'Warranty')), 0)::numeric / 100 as technician_payroll,
      count(*) filter (where status in ('Completed', 'Warranty'))::numeric as completed_jobs,
      count(*) filter (where status = 'ReCall')::numeric as recall_jobs
    from previous_rows
  )
  select jsonb_build_object(
    'revenue', revenue,
    'collected', collected,
    'unpaid', unpaid,
    'materials', materials,
    'technician_payroll', technician_payroll,
    'estimated_gross_profit', collected - materials - technician_payroll,
    'completed_jobs', completed_jobs,
    'recall_jobs', recall_jobs,
    'recall_rate', case when completed_jobs > 0 then recall_jobs / completed_jobs else 0 end,
    'average_ticket', case when completed_jobs > 0 then revenue / completed_jobs else 0 end
  )
  into v_previous
  from previous_summary;

  select jsonb_build_object(
    'revenue_percent', public.business_analytics_percent_change((v_current->>'revenue')::numeric, (v_previous->>'revenue')::numeric),
    'collected_percent', public.business_analytics_percent_change((v_current->>'collected')::numeric, (v_previous->>'collected')::numeric),
    'unpaid_percent', public.business_analytics_percent_change((v_current->>'unpaid')::numeric, (v_previous->>'unpaid')::numeric),
    'materials_percent', public.business_analytics_percent_change((v_current->>'materials')::numeric, (v_previous->>'materials')::numeric),
    'technician_payroll_percent', public.business_analytics_percent_change((v_current->>'technician_payroll')::numeric, (v_previous->>'technician_payroll')::numeric),
    'estimated_gross_profit_percent', public.business_analytics_percent_change((v_current->>'estimated_gross_profit')::numeric, (v_previous->>'estimated_gross_profit')::numeric),
    'completed_jobs_percent', public.business_analytics_percent_change((v_current->>'completed_jobs')::numeric, (v_previous->>'completed_jobs')::numeric),
    'recall_rate_percent', public.business_analytics_percent_change((v_current->>'recall_rate')::numeric, (v_previous->>'recall_rate')::numeric),
    'average_ticket_percent', public.business_analytics_percent_change((v_current->>'average_ticket')::numeric, (v_previous->>'average_ticket')::numeric)
  )
  into v_comparison;

  with current_jobs as (
    select jobs.id, jobs.service_call_fee_cents, jobs.labor_cents, coalesce(jobs.completed_at, min(appointments.starts_at), jobs.created_at) as analytics_date
    from public.jobs
    left join public.appointments on appointments.company_id = jobs.company_id and appointments.job_id = jobs.id
    where jobs.company_id = p_company_id and jobs.status in ('Completed', 'Warranty') and (p_technician_id is null or jobs.technician_id = p_technician_id)
    group by jobs.id
  ),
  payments as (
    select job_id, bool_or(scope = 'scf' and method is not null) as scf_paid, bool_or(scope = 'labor' and method is not null) as labor_paid
    from public.job_payments
    where company_id = p_company_id and scope in ('scf', 'labor')
    group by job_id
  ),
  debt as (
    select
      current_jobs.id,
      current_jobs.analytics_date,
      (case when coalesce(payments.scf_paid, false) then 0 else coalesce(current_jobs.service_call_fee_cents, 0) end
        + case when coalesce(payments.labor_paid, false) then 0 else coalesce(current_jobs.labor_cents, 0) end)::bigint as unpaid_cents
    from current_jobs
    left join payments on payments.job_id = current_jobs.id
    where current_jobs.analytics_date >= p_date_from::timestamptz and current_jobs.analytics_date < (p_date_to + 1)::timestamptz
  )
  select jsonb_build_object(
    'total_amount', coalesce(sum(unpaid_cents), 0)::numeric / 100,
    'jobs_count', count(*) filter (where unpaid_cents > 0),
    'older_than_30_days_amount', coalesce(sum(unpaid_cents) filter (where unpaid_cents > 0 and analytics_date < now() - interval '30 days'), 0)::numeric / 100,
    'older_than_30_days_count', count(*) filter (where unpaid_cents > 0 and analytics_date < now() - interval '30 days'),
    'job_ids', coalesce(jsonb_agg(id) filter (where unpaid_cents > 0), '[]'::jsonb)
  )
  into v_unpaid
  from debt;

  with recall_jobs as (
    select jobs.id, coalesce(jobs.completed_at, min(appointments.starts_at), jobs.created_at) as analytics_date
    from public.jobs
    left join public.appointments on appointments.company_id = jobs.company_id and appointments.job_id = jobs.id
    where jobs.company_id = p_company_id and jobs.status = 'ReCall' and (p_technician_id is null or jobs.technician_id = p_technician_id)
    group by jobs.id
  )
  select jsonb_build_object(
    'current_count', count(*) filter (where analytics_date >= p_date_from::timestamptz and analytics_date < (p_date_to + 1)::timestamptz),
    'previous_count', count(*) filter (where analytics_date >= v_previous_from::timestamptz and analytics_date < (v_previous_to + 1)::timestamptz),
    'change_percent', public.business_analytics_percent_change(
      count(*) filter (where analytics_date >= p_date_from::timestamptz and analytics_date < (p_date_to + 1)::timestamptz)::numeric,
      count(*) filter (where analytics_date >= v_previous_from::timestamptz and analytics_date < (v_previous_to + 1)::timestamptz)::numeric
    ),
    'job_ids', coalesce(jsonb_agg(id) filter (where analytics_date >= p_date_from::timestamptz and analytics_date < (p_date_to + 1)::timestamptz), '[]'::jsonb)
  )
  into v_recalls
  from recall_jobs;

  with
  dated_jobs as (
    select jobs.*, coalesce(jobs.completed_at, min(appointments.starts_at), jobs.created_at) as analytics_date
    from public.jobs
    left join public.appointments on appointments.company_id = jobs.company_id and appointments.job_id = jobs.id
    where jobs.company_id = p_company_id and jobs.status in ('Completed', 'Warranty', 'ReCall')
    group by jobs.id
  ),
  material_totals as (
    select job_id, sum(round(coalesce(quantity, 1) * coalesce(unit_price_cents, 0)))::bigint as materials_cents
    from public.job_materials
    where company_id = p_company_id
    group by job_id
  ),
  payment_totals as (
    select job_id, bool_or(scope = 'scf' and method is not null) as scf_paid, bool_or(scope = 'labor' and method is not null) as labor_paid
    from public.job_payments
    where company_id = p_company_id and scope in ('scf', 'labor')
    group by job_id
  ),
  rules as (
    select coalesce(commission_percent, 50)::numeric as commission_percent, coalesce(scf_only_payout_cents, 5000)::bigint as scf_only_payout_cents, coalesce(include_scf_in_commission_base, true) as include_scf, coalesce(deduct_materials_before_payroll, true) as deduct_materials
    from (select p_company_id as company_id) target
    left join public.company_payroll_rules on company_payroll_rules.company_id = target.company_id
  ),
  technician_rows as (
    select
      company_technicians.id as technician_id,
      coalesce(company_technicians.name, 'No technician') as technician,
      dated_jobs.status,
      (coalesce(dated_jobs.service_call_fee_cents, 0) + coalesce(dated_jobs.labor_cents, 0))::bigint as revenue_cents,
      (case when coalesce(payment_totals.scf_paid, false) then coalesce(dated_jobs.service_call_fee_cents, 0) else 0 end + case when coalesce(payment_totals.labor_paid, false) then coalesce(dated_jobs.labor_cents, 0) else 0 end)::bigint as collected_cents,
      coalesce(material_totals.materials_cents, 0)::bigint as materials_cents,
      case
        when coalesce(payment_totals.scf_paid, false) and not coalesce(payment_totals.labor_paid, false) then (select scf_only_payout_cents from rules)
        else round(greatest(0, (case when (select include_scf from rules) and coalesce(payment_totals.scf_paid, false) then coalesce(dated_jobs.service_call_fee_cents, 0) else 0 end) + (case when coalesce(payment_totals.labor_paid, false) then coalesce(dated_jobs.labor_cents, 0) else 0 end) - (case when (select deduct_materials from rules) then coalesce(material_totals.materials_cents, 0) else 0 end)) * ((select commission_percent from rules) / 100))::bigint
      end as payroll_cents
    from dated_jobs
    left join public.company_technicians on company_technicians.id = dated_jobs.technician_id
    left join material_totals on material_totals.job_id = dated_jobs.id
    left join payment_totals on payment_totals.job_id = dated_jobs.id
    where dated_jobs.analytics_date >= p_date_from::timestamptz and dated_jobs.analytics_date < (p_date_to + 1)::timestamptz
  ),
  grouped as (
    select
      technician_id,
      technician,
      count(*) filter (where status in ('Completed', 'Warranty')) as completed_jobs,
      coalesce(sum(revenue_cents) filter (where status in ('Completed', 'Warranty')), 0)::numeric / 100 as revenue,
      coalesce(sum(collected_cents) filter (where status in ('Completed', 'Warranty')), 0)::numeric / 100 as collected,
      coalesce(sum(materials_cents) filter (where status in ('Completed', 'Warranty')), 0)::numeric / 100 as materials,
      coalesce(sum(payroll_cents) filter (where status in ('Completed', 'Warranty')), 0)::numeric / 100 as payroll,
      count(*) filter (where status = 'ReCall') as recall_count
    from technician_rows
    group by technician_id, technician
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'technician_id', technician_id,
    'technician', technician,
    'completed_jobs', completed_jobs,
    'revenue', revenue,
    'collected', collected,
    'average_ticket', case when completed_jobs > 0 then revenue / completed_jobs else 0 end,
    'materials', materials,
    'payroll', payroll,
    'estimated_gross_profit', collected - materials - payroll,
    'recall_count', recall_count,
    'recall_rate', case when completed_jobs > 0 then recall_count::numeric / completed_jobs else 0 end
  ) order by technician), '[]'::jsonb)
  into v_technicians
  from grouped;

  with customer_completed as (
    select
      customers.id,
      coalesce(nullif(customers.organization, ''), nullif(customers.primary_name, ''), 'Unknown customer') as name,
      coalesce(jobs.completed_at, min(appointments.starts_at), jobs.created_at)::date as completed_date,
      (coalesce(jobs.service_call_fee_cents, 0) + coalesce(jobs.labor_cents, 0))::numeric / 100 as revenue
    from public.customers
    join public.jobs on jobs.company_id = customers.company_id and jobs.customer_id = customers.id
    left join public.appointments on appointments.company_id = jobs.company_id and appointments.job_id = jobs.id
    where customers.company_id = p_company_id
      and jobs.status in ('Completed', 'Warranty')
      and coalesce(customers.blacklist, '') = ''
    group by customers.id, jobs.id
  ),
  grouped as (
    select id, name, count(*) as jobs_count, sum(revenue) as revenue, max(completed_date) as last_job_date
    from customer_completed
    where completed_date >= (p_date_to - interval '12 months')::date and completed_date <= p_date_to
    group by id, name
    having count(*) >= 5 or sum(revenue) > 2500
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'customer_id', id,
    'name', name,
    'jobs_count', jobs_count,
    'revenue', revenue,
    'last_job_date', last_job_date
  ) order by revenue desc), '[]'::jsonb)
  into v_service_contract_candidates
  from grouped;

  with customer_completed as (
    select
      customers.id,
      coalesce(nullif(customers.organization, ''), nullif(customers.primary_name, ''), 'Unknown customer') as name,
      coalesce(jobs.completed_at, min(appointments.starts_at), jobs.created_at)::date as completed_date,
      (coalesce(jobs.service_call_fee_cents, 0) + coalesce(jobs.labor_cents, 0))::numeric / 100 as revenue
    from public.customers
    join public.jobs on jobs.company_id = customers.company_id and jobs.customer_id = customers.id
    left join public.appointments on appointments.company_id = jobs.company_id and appointments.job_id = jobs.id
    where customers.company_id = p_company_id
      and jobs.status in ('Completed', 'Warranty')
      and coalesce(customers.blacklist, '') = ''
    group by customers.id, jobs.id
  ),
  grouped as (
    select id, name, count(*) as lifetime_jobs, sum(revenue) as lifetime_revenue, max(completed_date) as last_job_date
    from customer_completed
    group by id, name
    having count(*) >= 3 and max(completed_date) < (p_date_to - interval '180 days')::date
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'customer_id', id,
    'name', name,
    'lifetime_jobs', lifetime_jobs,
    'lifetime_revenue', lifetime_revenue,
    'last_job_date', last_job_date,
    'inactive_days', p_date_to - last_job_date
  ) order by last_job_date asc), '[]'::jsonb)
  into v_inactive_customers
  from grouped;

  with dated_jobs as (
    select jobs.*, coalesce(jobs.completed_at, min(appointments.starts_at), jobs.created_at) as analytics_date
    from public.jobs
    left join public.appointments on appointments.company_id = jobs.company_id and appointments.job_id = jobs.id
    where jobs.company_id = p_company_id
    group by jobs.id
  )
  select jsonb_build_object(
    'missing_completed_at', count(*) filter (where status in ('Completed', 'Warranty') and completed_at is null and analytics_date >= p_date_from::timestamptz and analytics_date < (p_date_to + 1)::timestamptz),
    'missing_technician', count(*) filter (where status in ('Completed', 'Warranty') and technician_id is null and analytics_date >= p_date_from::timestamptz and analytics_date < (p_date_to + 1)::timestamptz),
    'missing_material_cost', (
      select count(*)
      from public.job_materials
      join public.jobs on jobs.id = job_materials.job_id and jobs.company_id = job_materials.company_id
      where job_materials.company_id = p_company_id and coalesce(job_materials.unit_price_cents, 0) = 0
    ),
    'missing_equipment_type', count(*) filter (where status in ('Completed', 'Warranty') and coalesce(system, '') = '' and analytics_date >= p_date_from::timestamptz and analytics_date < (p_date_to + 1)::timestamptz),
    'missing_lead_source', null
  )
  into v_data_quality
  from dated_jobs;

  return jsonb_build_object(
    'period', jsonb_build_object('date_from', p_date_from, 'date_to', p_date_to),
    'previous_period', jsonb_build_object('date_from', v_previous_from, 'date_to', v_previous_to),
    'summary', v_current,
    'comparison', v_comparison,
    'unpaid', v_unpaid,
    'recalls', v_recalls,
    'technicians', v_technicians,
    'customer_opportunities', jsonb_build_object(
      'service_contract_candidates', v_service_contract_candidates,
      'inactive_customers', v_inactive_customers
    ),
    'data_quality', v_data_quality
  );
end;
$$;

grant execute on function public.get_business_analytics(uuid, date, date, uuid) to authenticated;
revoke execute on function public.get_business_analytics(uuid, date, date, uuid) from anon;
