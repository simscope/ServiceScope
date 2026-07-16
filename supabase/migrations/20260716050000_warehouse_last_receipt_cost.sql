-- Warehouse costing policy: use the latest posted receipt price as the current
-- stock price. The existing inventory_items.average_cost column is kept for
-- compatibility, but it now stores current/latest landed unit cost, not a
-- weighted average.

create or replace function public.inventory_latest_receipt_unit_cost(
  p_company_id uuid,
  p_item_id uuid
)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
  select m.unit_cost
  from public.inventory_movements m
  left join public.inventory_stock_receipts r on r.id = m.receipt_id
  where m.company_id = p_company_id
    and m.item_id = p_item_id
    and m.movement_type = 'receipt'
    and (
      m.receipt_id is null
      or (
        r.status = 'posted'
        and r.canceled_at is null
      )
    )
  order by coalesce(r.posted_at, m.created_at) desc, m.created_at desc, m.id desc
  limit 1
$$;

create or replace function public.inventory_apply_latest_receipt_cost(
  p_company_id uuid,
  p_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_latest_cost numeric(14,4);
begin
  select public.inventory_latest_receipt_unit_cost(p_company_id, p_item_id)
  into v_latest_cost;

  if v_latest_cost is null then
    return;
  end if;

  perform set_config('app.inventory_rpc', 'on', true);

  update public.inventory_items
    set average_cost = v_latest_cost,
        updated_at = now()
  where id = p_item_id
    and company_id = p_company_id
    and average_cost is distinct from v_latest_cost;
end;
$$;

create or replace function public.inventory_apply_last_cost_from_movement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.inventory_apply_latest_receipt_cost(new.company_id, new.item_id);
  return new;
end;
$$;

drop trigger if exists inventory_movements_apply_last_cost on public.inventory_movements;
create trigger inventory_movements_apply_last_cost
after insert on public.inventory_movements
for each row execute function public.inventory_apply_last_cost_from_movement();

create or replace function public.inventory_apply_last_cost_from_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_line record;
begin
  for v_line in
    select distinct item_id
    from public.inventory_stock_receipt_lines
    where receipt_id = new.id
  loop
    perform public.inventory_apply_latest_receipt_cost(new.company_id, v_line.item_id);
  end loop;

  return new;
end;
$$;

drop trigger if exists inventory_receipts_apply_last_cost on public.inventory_stock_receipts;
create trigger inventory_receipts_apply_last_cost
after update of status, canceled_at on public.inventory_stock_receipts
for each row
when (
  old.status is distinct from new.status
  or old.canceled_at is distinct from new.canceled_at
)
execute function public.inventory_apply_last_cost_from_receipt();

select set_config('app.inventory_rpc', 'on', false);

with latest_cost as (
  select distinct on (m.company_id, m.item_id)
    m.company_id,
    m.item_id,
    m.unit_cost
  from public.inventory_movements m
  left join public.inventory_stock_receipts r on r.id = m.receipt_id
  where m.movement_type = 'receipt'
    and (
      m.receipt_id is null
      or (
        r.status = 'posted'
        and r.canceled_at is null
      )
    )
  order by m.company_id, m.item_id, coalesce(r.posted_at, m.created_at) desc, m.created_at desc, m.id desc
)
update public.inventory_items i
  set average_cost = latest_cost.unit_cost,
      updated_at = now()
from latest_cost
where i.company_id = latest_cost.company_id
  and i.id = latest_cost.item_id
  and i.average_cost is distinct from latest_cost.unit_cost;

revoke all on function public.inventory_latest_receipt_unit_cost(uuid, uuid) from public;
revoke all on function public.inventory_latest_receipt_unit_cost(uuid, uuid) from anon;
revoke all on function public.inventory_latest_receipt_unit_cost(uuid, uuid) from authenticated;
revoke all on function public.inventory_apply_latest_receipt_cost(uuid, uuid) from public;
revoke all on function public.inventory_apply_latest_receipt_cost(uuid, uuid) from anon;
revoke all on function public.inventory_apply_latest_receipt_cost(uuid, uuid) from authenticated;
revoke all on function public.inventory_apply_last_cost_from_movement() from public;
revoke all on function public.inventory_apply_last_cost_from_movement() from anon;
revoke all on function public.inventory_apply_last_cost_from_movement() from authenticated;
revoke all on function public.inventory_apply_last_cost_from_receipt() from public;
revoke all on function public.inventory_apply_last_cost_from_receipt() from anon;
revoke all on function public.inventory_apply_last_cost_from_receipt() from authenticated;
