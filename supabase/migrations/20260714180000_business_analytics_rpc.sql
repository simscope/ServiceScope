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

create or replace function public.business_analytics_company_timezone(p_company_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  -- Fallback is temporary until every company profile has a timezone.
  select coalesce(nullif(company_profiles.timezone, ''), 'America/New_York')
  from public.company_profiles
  where company_profiles.company_id = p_company_id
  union all
  select 'America/New_York'
  limit 1;
$$;

create or replace function public.business_analytics_job_facts(
  p_company_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_technician_id uuid default null
)
returns table (
  job_id uuid,
  customer_id uuid,
  technician_id uuid,
  technician text,
  analytics_at timestamptz,
  status public.job_status,
  system text,
  scf_cents bigint,
  labor_cents bigint,
  revenue_cents bigint,
  paid_scf_cents bigint,
  paid_labor_cents bigint,
  collected_cents bigint,
  materials_cents bigint,
  payroll_cents bigint,
  unpaid_cents bigint,
  scf_paid boolean,
  labor_paid boolean,
  completed_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  with
  rules as (
    select
      coalesce(company_payroll_rules.commission_percent, 50)::numeric as commission_percent,
      coalesce(company_payroll_rules.scf_only_payout_cents, 5000)::bigint as scf_only_payout_cents,
      coalesce(company_payroll_rules.include_scf_in_commission_base, true) as include_scf,
      coalesce(company_payroll_rules.deduct_materials_before_payroll, true) as deduct_materials
    from (select p_company_id as company_id) target
    left join public.company_payroll_rules on company_payroll_rules.company_id = target.company_id
  ),
  appointments_one as (
    select appointments.job_id, min(appointments.starts_at) as starts_at
    from public.appointments
    where appointments.company_id = p_company_id
    group by appointments.job_id
  ),
  materials as (
    select
      job_materials.job_id,
      sum(round(coalesce(job_materials.quantity, 1) * coalesce(job_materials.unit_price_cents, 0)))::bigint as materials_cents
    from public.job_materials
    where job_materials.company_id = p_company_id
    group by job_materials.job_id
  ),
  payments as (
    select
      job_payments.job_id,
      bool_or(job_payments.scope = 'scf' and job_payments.method is not null) as scf_paid,
      bool_or(job_payments.scope = 'labor' and job_payments.method is not null) as labor_paid
    from public.job_payments
    where job_payments.company_id = p_company_id
      and job_payments.scope in ('scf', 'labor')
    group by job_payments.job_id
  ),
  base as (
    select
      jobs.id as job_id,
      jobs.customer_id,
      jobs.technician_id,
      coalesce(company_technicians.name, 'No technician') as technician,
      coalesce(jobs.completed_at, appointments_one.starts_at, jobs.created_at) as analytics_at,
      jobs.status,
      jobs.system,
      coalesce(jobs.service_call_fee_cents, 0)::bigint as scf_cents,
      coalesce(jobs.labor_cents, 0)::bigint as labor_cents,
      coalesce(materials.materials_cents, 0)::bigint as materials_cents,
      coalesce(payments.scf_paid, false) as scf_paid,
      coalesce(payments.labor_paid, false) as labor_paid,
      jobs.completed_at
    from public.jobs
    left join appointments_one on appointments_one.job_id = jobs.id
    left join public.company_technicians on company_technicians.id = jobs.technician_id
    left join materials on materials.job_id = jobs.id
    left join payments on payments.job_id = jobs.id
    where jobs.company_id = p_company_id
      and jobs.status in ('Completed', 'Warranty')
      and (p_technician_id is null or jobs.technician_id = p_technician_id)
  ),
  calculated as (
    select
      base.*,
      (base.scf_cents + base.labor_cents)::bigint as revenue_cents,
      case when base.scf_paid then base.scf_cents else 0 end::bigint as paid_scf_cents,
      case when base.labor_paid then base.labor_cents else 0 end::bigint as paid_labor_cents
    from base
    where base.analytics_at >= p_start_at
      and base.analytics_at < p_end_at
  )
  select
    calculated.job_id,
    calculated.customer_id,
    calculated.technician_id,
    calculated.technician,
    calculated.analytics_at,
    calculated.status,
    calculated.system,
    calculated.scf_cents,
    calculated.labor_cents,
    calculated.revenue_cents,
    calculated.paid_scf_cents,
    calculated.paid_labor_cents,
    (calculated.paid_scf_cents + calculated.paid_labor_cents)::bigint as collected_cents,
    calculated.materials_cents,
    case
      when calculated.paid_scf_cents > 0 and calculated.paid_labor_cents = 0 then (select scf_only_payout_cents from rules)
      else round(
        greatest(
          0,
          (case when (select include_scf from rules) then calculated.paid_scf_cents else 0 end)
            + calculated.paid_labor_cents
            - (case when (select deduct_materials from rules) then calculated.materials_cents else 0 end)
        ) * ((select commission_percent from rules) / 100)
      )::bigint
    end as payroll_cents,
    ((case when calculated.scf_paid then 0 else calculated.scf_cents end)
      + (case when calculated.labor_paid then 0 else calculated.labor_cents end))::bigint as unpaid_cents,
    calculated.scf_paid,
    calculated.labor_paid,
    calculated.completed_at
  from calculated;
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
  v_timezone text;
  v_timezone_source text;
  v_current_start timestamptz;
  v_current_end timestamptz;
  v_previous_start timestamptz;
  v_previous_end timestamptz;
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
            and coalesce(company_users.portal_access_rules->>'aiBusiness', company_users.portal_access_rules->>'finances', 'off') in ('full', 'readonly')
            and coalesce(
              (
                select company_profiles.access_rules->>'aiBusiness'
                from public.company_profiles
                where company_profiles.company_id = p_company_id
              ),
              (
                select company_profiles.access_rules->>'finances'
                from public.company_profiles
                where company_profiles.company_id = p_company_id
              ),
              'full'
            ) in ('full', 'readonly')
          )
        )
    )
  into v_has_access;

  if not coalesce(v_has_access, false) then
    raise exception 'Business analytics access denied';
  end if;

  v_timezone := public.business_analytics_company_timezone(p_company_id);
  select case
    when exists (
      select 1
      from public.company_profiles
      where company_id = p_company_id
        and nullif(timezone, '') is not null
    ) then 'company_profile'
    else 'fallback'
  end into v_timezone_source;

  v_days := (p_date_to - p_date_from) + 1;
  v_previous_to := p_date_from - 1;
  v_previous_from := v_previous_to - (v_days - 1);
  v_current_start := p_date_from::timestamp at time zone v_timezone;
  v_current_end := (p_date_to + 1)::timestamp at time zone v_timezone;
  v_previous_start := v_previous_from::timestamp at time zone v_timezone;
  v_previous_end := (v_previous_to + 1)::timestamp at time zone v_timezone;

  with current_rows as (
    select * from public.business_analytics_job_facts(p_company_id, v_current_start, v_current_end, p_technician_id)
  ),
  summary as (
    select
      coalesce(sum(revenue_cents), 0)::numeric / 100 as revenue,
      coalesce(sum(collected_cents), 0)::numeric / 100 as collected,
      coalesce(sum(unpaid_cents), 0)::numeric / 100 as unpaid,
      coalesce(sum(materials_cents), 0)::numeric / 100 as materials,
      coalesce(sum(payroll_cents), 0)::numeric / 100 as technician_payroll,
      count(*)::numeric as completed_jobs
    from current_rows
  ),
  recall_snapshot as (
    select count(*)::numeric as recall_jobs
    from public.jobs
    where jobs.company_id = p_company_id
      and jobs.status = 'ReCall'
      and (p_technician_id is null or jobs.technician_id = p_technician_id)
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
    'recall_rate', null,
    'average_ticket', case when completed_jobs > 0 then revenue / completed_jobs else 0 end
  )
  into v_current
  from summary cross join recall_snapshot;

  with previous_rows as (
    select * from public.business_analytics_job_facts(p_company_id, v_previous_start, v_previous_end, p_technician_id)
  ),
  summary as (
    select
      coalesce(sum(revenue_cents), 0)::numeric / 100 as revenue,
      coalesce(sum(collected_cents), 0)::numeric / 100 as collected,
      coalesce(sum(unpaid_cents), 0)::numeric / 100 as unpaid,
      coalesce(sum(materials_cents), 0)::numeric / 100 as materials,
      coalesce(sum(payroll_cents), 0)::numeric / 100 as technician_payroll,
      count(*)::numeric as completed_jobs
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
    'recall_jobs', 0,
    'recall_rate', null,
    'average_ticket', case when completed_jobs > 0 then revenue / completed_jobs else 0 end
  )
  into v_previous
  from summary;

  select jsonb_build_object(
    'revenue_percent', public.business_analytics_percent_change((v_current->>'revenue')::numeric, (v_previous->>'revenue')::numeric),
    'collected_percent', public.business_analytics_percent_change((v_current->>'collected')::numeric, (v_previous->>'collected')::numeric),
    'unpaid_percent', public.business_analytics_percent_change((v_current->>'unpaid')::numeric, (v_previous->>'unpaid')::numeric),
    'materials_percent', public.business_analytics_percent_change((v_current->>'materials')::numeric, (v_previous->>'materials')::numeric),
    'technician_payroll_percent', public.business_analytics_percent_change((v_current->>'technician_payroll')::numeric, (v_previous->>'technician_payroll')::numeric),
    'estimated_gross_profit_percent', public.business_analytics_percent_change((v_current->>'estimated_gross_profit')::numeric, (v_previous->>'estimated_gross_profit')::numeric),
    'completed_jobs_percent', public.business_analytics_percent_change((v_current->>'completed_jobs')::numeric, (v_previous->>'completed_jobs')::numeric),
    'recall_rate_percent', null,
    'average_ticket_percent', public.business_analytics_percent_change((v_current->>'average_ticket')::numeric, (v_previous->>'average_ticket')::numeric)
  )
  into v_comparison;

  with
  period_debt as (
    select * from public.business_analytics_job_facts(p_company_id, v_current_start, v_current_end, p_technician_id)
    where unpaid_cents > 0
  ),
  all_debt as (
    select * from public.business_analytics_job_facts(p_company_id, '-infinity'::timestamptz, v_current_end, p_technician_id)
    where unpaid_cents > 0
  )
  select jsonb_build_object(
    'period_total_amount', coalesce((select sum(unpaid_cents) from period_debt), 0)::numeric / 100,
    'period_jobs_count', coalesce((select count(*) from period_debt), 0),
    'total_outstanding_amount', coalesce((select sum(unpaid_cents) from all_debt), 0)::numeric / 100,
    'total_outstanding_jobs_count', coalesce((select count(*) from all_debt), 0),
    'older_than_30_days_amount', coalesce((select sum(unpaid_cents) from all_debt where analytics_at < v_current_end - interval '30 days'), 0)::numeric / 100,
    'older_than_30_days_count', coalesce((select count(*) from all_debt where analytics_at < v_current_end - interval '30 days'), 0),
    'period_job_ids', coalesce((select jsonb_agg(job_id) from period_debt), '[]'::jsonb),
    'older_than_30_days_job_ids', coalesce((select jsonb_agg(job_id) from all_debt where analytics_at < v_current_end - interval '30 days'), '[]'::jsonb),
    'aging_basis', 'completed-age'
  )
  into v_unpaid;

  select jsonb_build_object(
    'current_count', count(*),
    'previous_count', 0,
    'change_percent', null,
    'job_ids', coalesce(jsonb_agg(jobs.id) filter (where jobs.id is not null), '[]'::jsonb),
    'measurement_mode', 'snapshot',
    'rate_available', false,
    'notice', 'Recall period analytics require job status history. Current data only supports a ReCall snapshot.'
  )
  into v_recalls
  from public.jobs
  where jobs.company_id = p_company_id
    and jobs.status = 'ReCall'
    and (p_technician_id is null or jobs.technician_id = p_technician_id);

  with current_rows as (
    select * from public.business_analytics_job_facts(p_company_id, v_current_start, v_current_end, p_technician_id)
  ),
  recall_snapshot as (
    select technician_id, count(*) as recall_count
    from public.jobs
    where jobs.company_id = p_company_id
      and jobs.status = 'ReCall'
      and (p_technician_id is null or jobs.technician_id = p_technician_id)
    group by technician_id
  ),
  grouped as (
    select
      current_rows.technician_id,
      current_rows.technician,
      count(*) as completed_jobs,
      coalesce(sum(revenue_cents), 0)::numeric / 100 as revenue,
      coalesce(sum(collected_cents), 0)::numeric / 100 as collected,
      coalesce(sum(materials_cents), 0)::numeric / 100 as materials,
      coalesce(sum(payroll_cents), 0)::numeric / 100 as payroll
    from current_rows
    group by current_rows.technician_id, current_rows.technician
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'technician_id', grouped.technician_id,
    'technician', grouped.technician,
    'completed_jobs', grouped.completed_jobs,
    'revenue', grouped.revenue,
    'collected', grouped.collected,
    'average_ticket', case when grouped.completed_jobs > 0 then grouped.revenue / grouped.completed_jobs else 0 end,
    'materials', grouped.materials,
    'payroll', grouped.payroll,
    'estimated_gross_profit', grouped.collected - grouped.materials - grouped.payroll,
    'recall_count', coalesce(recall_snapshot.recall_count, 0),
    'recall_rate', null
  ) order by grouped.technician), '[]'::jsonb)
  into v_technicians
  from grouped
  left join recall_snapshot on recall_snapshot.technician_id is not distinct from grouped.technician_id;

  with customer_completed as (
    select
      customers.id,
      coalesce(nullif(customers.organization, ''), nullif(customers.primary_name, ''), 'Unknown customer') as name,
      (facts.analytics_at at time zone v_timezone)::date as completed_date,
      facts.revenue_cents::numeric / 100 as revenue
    from public.customers
    join public.business_analytics_job_facts(p_company_id, (p_date_to::timestamp - interval '12 months') at time zone v_timezone, v_current_end, null) facts
      on facts.customer_id = customers.id
    where customers.company_id = p_company_id
      and coalesce(customers.blacklist, '') = ''
  ),
  grouped as (
    select id, name, count(*) as jobs_count, sum(revenue) as revenue, max(completed_date) as last_job_date
    from customer_completed
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

  with
  customer_jobs as (
    select
      customers.id,
      coalesce(nullif(customers.organization, ''), nullif(customers.primary_name, ''), 'Unknown customer') as name,
      customers.blacklist,
      jobs.status,
      coalesce(jobs.completed_at, min(appointments.starts_at), jobs.created_at) as significant_at,
      (coalesce(jobs.service_call_fee_cents, 0) + coalesce(jobs.labor_cents, 0))::numeric / 100 as revenue
    from public.customers
    join public.jobs on jobs.company_id = customers.company_id and jobs.customer_id = customers.id
    left join public.appointments on appointments.company_id = jobs.company_id and appointments.job_id = jobs.id
    where customers.company_id = p_company_id
      and jobs.status <> 'Cancelled'
    group by customers.id, jobs.id
  ),
  grouped as (
    select
      id,
      name,
      count(*) filter (where status in ('Completed', 'Warranty')) as lifetime_jobs,
      coalesce(sum(revenue) filter (where status in ('Completed', 'Warranty')), 0) as lifetime_revenue,
      max(significant_at) filter (where status in ('Completed', 'Warranty')) as last_completed_at,
      max(significant_at) as last_non_cancelled_at,
      bool_or(status not in ('Completed', 'Warranty', 'Archived')) as has_active_job
    from customer_jobs
    where coalesce(blacklist, '') = ''
    group by id, name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'customer_id', id,
    'name', name,
    'lifetime_jobs', lifetime_jobs,
    'lifetime_revenue', lifetime_revenue,
    'last_job_date', (last_completed_at at time zone v_timezone)::date,
    'inactive_days', p_date_to - (last_non_cancelled_at at time zone v_timezone)::date
  ) order by last_non_cancelled_at asc), '[]'::jsonb)
  into v_inactive_customers
  from grouped
  where lifetime_jobs >= 3
    and not has_active_job
    and last_non_cancelled_at < v_current_end - interval '180 days';

  with current_rows as (
    select * from public.business_analytics_job_facts(p_company_id, v_current_start, v_current_end, p_technician_id)
  ),
  period_materials_without_cost as (
    select count(*) as count_value
    from public.job_materials
    join current_rows on current_rows.job_id = job_materials.job_id
    where job_materials.company_id = p_company_id
      and job_materials.name <> ''
      and coalesce(job_materials.unit_price_cents, 0) = 0
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'missing_completed_at', (select count(*) from current_rows where completed_at is null),
      'missing_technician', (select count(*) from current_rows where technician_id is null),
      'missing_material_cost', (select count_value from period_materials_without_cost),
      'missing_equipment_type', (select count(*) from current_rows where coalesce(system, '') = '')
    ),
    'company_wide', jsonb_build_object(
      'missing_lead_source', null
    )
  )
  into v_data_quality;

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
    'data_quality', v_data_quality,
    'metadata', jsonb_build_object(
      'timezone', v_timezone,
      'timezone_source', v_timezone_source,
      'technician_filter_applied', p_technician_id is not null,
      'customer_opportunities_scope', 'company-wide'
    )
  );
end;
$$;

grant execute on function public.get_business_analytics(uuid, date, date, uuid) to authenticated;
revoke execute on function public.get_business_analytics(uuid, date, date, uuid) from anon;
revoke execute on function public.business_analytics_job_facts(uuid, timestamptz, timestamptz, uuid) from anon, authenticated;
revoke execute on function public.business_analytics_company_timezone(uuid) from anon, authenticated;
