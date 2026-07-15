-- Business Analytics security and edge-case checks.
-- Run in a Supabase SQL session after applying migration 20260714180000.
-- Replace the UUID/email placeholders with test fixtures in the target project.

begin;

-- Test fixture inputs.
create temp table ba_check_params (
  allowed_company_id uuid,
  other_company_id uuid,
  allowed_auth_user_id uuid,
  allowed_email text,
  no_access_auth_user_id uuid,
  no_access_email text,
  report_date date
) on commit drop;

create temp table ba_timezone_restore (
  company_id uuid primary key,
  timezone text
) on commit drop;

insert into ba_check_params values (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000101',
  'allowed@example.com',
  '00000000-0000-0000-0000-000000000102',
  'no-access@example.com',
  '2026-07-14'
);

-- 1. Authenticated user must not call the SECURITY DEFINER helper directly.
set local role authenticated;

do $$
declare
  v_params ba_check_params%rowtype;
begin
  select * into v_params from ba_check_params limit 1;

  begin
    perform *
    from public.business_analytics_job_facts(
      v_params.allowed_company_id,
      v_params.report_date::timestamp at time zone 'America/New_York',
      (v_params.report_date + 1)::timestamp at time zone 'America/New_York',
      null
    );
    raise exception 'business_analytics_job_facts unexpectedly executed for authenticated';
  exception
    when insufficient_privilege then
      raise notice 'PASS: authenticated cannot execute business_analytics_job_facts directly';
  end;
end $$;

reset role;

-- 2. User with access can call get_business_analytics.
set local role authenticated;

do $$
declare
  v_params ba_check_params%rowtype;
  v_result jsonb;
begin
  select * into v_params from ba_check_params limit 1;
  perform set_config('request.jwt.claim.sub', v_params.allowed_auth_user_id::text, true);
  perform set_config('request.jwt.claim.email', v_params.allowed_email, true);

  select public.get_business_analytics(v_params.allowed_company_id, v_params.report_date - 29, v_params.report_date, null)
  into v_result;

  if v_result is null or v_result->'summary' is null then
    raise exception 'get_business_analytics returned an invalid payload for allowed user';
  end if;

  raise notice 'PASS: allowed authenticated user can execute get_business_analytics';
end $$;

reset role;

-- 3. User from another company must not receive data.
set local role authenticated;

do $$
declare
  v_params ba_check_params%rowtype;
begin
  select * into v_params from ba_check_params limit 1;
  perform set_config('request.jwt.claim.sub', v_params.no_access_auth_user_id::text, true);
  perform set_config('request.jwt.claim.email', v_params.no_access_email, true);

  begin
    perform public.get_business_analytics(v_params.allowed_company_id, v_params.report_date - 29, v_params.report_date, null);
    raise exception 'get_business_analytics unexpectedly returned data for another company user';
  exception
    when raise_exception then
      raise notice 'PASS: another company user cannot execute get_business_analytics for this company';
  end;
end $$;

reset role;

-- 4. Invalid timezone falls back instead of breaking the RPC.
do $$
declare
  v_params ba_check_params%rowtype;
begin
  select * into v_params from ba_check_params limit 1;
  insert into ba_timezone_restore (company_id, timezone)
  select company_id, timezone
  from public.company_profiles
  where company_id = v_params.allowed_company_id
  on conflict (company_id) do update set timezone = excluded.timezone;

  update public.company_profiles
  set timezone = 'Invalid/Timezone'
  where company_id = v_params.allowed_company_id;
end $$;

set local role authenticated;

do $$
declare
  v_params ba_check_params%rowtype;
  v_result jsonb;
begin
  select * into v_params from ba_check_params limit 1;
  perform set_config('request.jwt.claim.sub', v_params.allowed_auth_user_id::text, true);
  perform set_config('request.jwt.claim.email', v_params.allowed_email, true);

  select public.get_business_analytics(v_params.allowed_company_id, v_params.report_date - 29, v_params.report_date, null)
  into v_result;

  if v_result #>> '{metadata,timezone_source}' <> 'fallback' then
    raise exception 'invalid timezone did not return fallback metadata: %', v_result #>> '{metadata,timezone_source}';
  end if;

  raise notice 'PASS: invalid timezone uses fallback';
end $$;

reset role;

update public.company_profiles
set timezone = ba_timezone_restore.timezone
from ba_timezone_restore
where company_profiles.company_id = ba_timezone_restore.company_id;

-- 5 and 6. Calendar aged debt boundary checks.
-- These expect fixture jobs with unpaid balances completed exactly 31 and 30
-- local calendar days before report_date. Replace job IDs below with fixtures.
set local role authenticated;

do $$
declare
  v_params ba_check_params%rowtype;
  v_result jsonb;
  v_job_31 uuid := '00000000-0000-0000-0000-000000000031';
  v_job_30 uuid := '00000000-0000-0000-0000-000000000030';
begin
  select * into v_params from ba_check_params limit 1;
  perform set_config('request.jwt.claim.sub', v_params.allowed_auth_user_id::text, true);
  perform set_config('request.jwt.claim.email', v_params.allowed_email, true);

  select public.get_business_analytics(v_params.allowed_company_id, v_params.report_date - 29, v_params.report_date, null)
  into v_result;

  if not (coalesce(v_result #> '{unpaid,older_than_30_days_job_ids}', '[]'::jsonb) ? v_job_31::text) then
    raise exception '31-calendar-day unpaid job is missing from aged debt';
  end if;

  if coalesce(v_result #> '{unpaid,older_than_30_days_job_ids}', '[]'::jsonb) ? v_job_30::text then
    raise exception 'exactly-30-calendar-day unpaid job should not be older than 30 days';
  end if;

  raise notice 'PASS: aged debt calendar boundary checks passed';
end $$;

reset role;

rollback;
