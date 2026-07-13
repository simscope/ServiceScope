-- Keep production plan limits aligned with the public billing catalog.
update public.plans
set
  seats_limit = case name
    when 'Launch' then 5
    when 'Growth' then 10
    when 'Scale' then 20
    else seats_limit
  end,
  technicians_limit = case name
    when 'Launch' then 8
    when 'Growth' then 15
    when 'Scale' then 30
    else technicians_limit
  end,
  storage_gb_limit = case name
    when 'Launch' then 10
    when 'Growth' then 30
    when 'Scale' then 100
    else storage_gb_limit
  end,
  support_level = case name
    when 'Launch' then 'Email'
    when 'Growth' then 'Priority'
    when 'Scale' then 'Dedicated'
    else support_level
  end,
  entitlements = case name
    when 'Launch' then array['Jobs', 'Invoices', 'Customer records', 'Basic support']
    when 'Growth' then array['Everything in Launch', 'Technician map', 'Finance view', 'Priority support']
    when 'Scale' then array['Everything in Growth', 'Advanced monitoring', 'Custom onboarding', 'Dedicated support']
    else entitlements
  end,
  updated_at = now()
where name in ('Launch', 'Growth', 'Scale');
