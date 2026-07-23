-- Warehouse Stage 5: counted-stock adjustments with an auditable document,
-- transactional row locks, idempotent posting, and safe reversal.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_adjustment_reason') THEN
    CREATE TYPE public.inventory_adjustment_reason AS ENUM ('initial', 'count', 'shortage', 'damage', 'found', 'correction');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.inventory_adjustment_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES public.inventory_warehouses(id) ON DELETE RESTRICT,
  bin_id uuid REFERENCES public.inventory_bins(id) ON DELETE SET NULL,
  adjustment_date date NOT NULL DEFAULT current_date,
  reason public.inventory_adjustment_reason NOT NULL DEFAULT 'count',
  reference_number text NOT NULL DEFAULT '',
  status public.inventory_document_status NOT NULL DEFAULT 'draft',
  notes text NOT NULL DEFAULT '',
  idempotency_key uuid,
  posted_at timestamptz,
  posted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  canceled_at timestamptz,
  canceled_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancel_reason text NOT NULL DEFAULT '',
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_adjustment_documents
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS public.inventory_adjustment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  adjustment_id uuid NOT NULL REFERENCES public.inventory_adjustment_documents(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE RESTRICT,
  system_quantity numeric(14,4),
  counted_quantity numeric(14,4),
  quantity_delta numeric(14,4) NOT NULL,
  unit_cost numeric(14,4) NOT NULL DEFAULT 0,
  movement_id uuid REFERENCES public.inventory_movements(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_adjustment_lines_nonzero_quantity CHECK (quantity_delta <> 0),
  CONSTRAINT inventory_adjustment_lines_nonnegative_cost CHECK (unit_cost >= 0)
);

ALTER TABLE public.inventory_adjustment_lines
  ADD COLUMN IF NOT EXISTS system_quantity numeric(14,4),
  ADD COLUMN IF NOT EXISTS counted_quantity numeric(14,4);

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS adjustment_id uuid REFERENCES public.inventory_adjustment_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS adjustment_line_id uuid REFERENCES public.inventory_adjustment_lines(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_adjustment_idempotency
  ON public.inventory_adjustment_documents(company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_adjustment_line_once
  ON public.inventory_movements(adjustment_line_id, reference_type)
  WHERE adjustment_line_id IS NOT NULL AND reference_type = 'stock_adjustment';
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_adjustment_lines_unique_item
  ON public.inventory_adjustment_lines(adjustment_id, item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustment_docs_company_status
  ON public.inventory_adjustment_documents(company_id, status, adjustment_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_adjustment
  ON public.inventory_movements(company_id, adjustment_id, adjustment_line_id);

DROP TRIGGER IF EXISTS set_inventory_adjustment_documents_updated_at ON public.inventory_adjustment_documents;
CREATE TRIGGER set_inventory_adjustment_documents_updated_at
BEFORE UPDATE ON public.inventory_adjustment_documents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.inventory_adjustment_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_adjustment_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory adjustments readable by company or platform" ON public.inventory_adjustment_documents;
CREATE POLICY "inventory adjustments readable by company or platform" ON public.inventory_adjustment_documents
  FOR SELECT USING (public.can_access_company(company_id));
DROP POLICY IF EXISTS "inventory adjustment lines readable by company or platform" ON public.inventory_adjustment_lines;
CREATE POLICY "inventory adjustment lines readable by company or platform" ON public.inventory_adjustment_lines
  FOR SELECT USING (public.can_access_company(company_id));

-- Stock corrections are posted only through SECURITY DEFINER RPCs below.
DROP POLICY IF EXISTS "inventory adjustments insertable as drafts by company managers or platform" ON public.inventory_adjustment_documents;
DROP POLICY IF EXISTS "inventory adjustments draft editable by company managers or platform" ON public.inventory_adjustment_documents;
DROP POLICY IF EXISTS "inventory adjustments draft deletable by company managers or platform" ON public.inventory_adjustment_documents;
DROP POLICY IF EXISTS "inventory adjustment lines writable for draft adjustments by company managers or platform" ON public.inventory_adjustment_lines;

CREATE OR REPLACE FUNCTION public.inventory_guard_adjustment_document_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.inventory_rpc_guard_enabled() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' OR OLD.posted_at IS NOT NULL OR OLD.canceled_at IS NOT NULL THEN
      RAISE EXCEPTION 'POSTED_ADJUSTMENT_LOCKED' USING errcode = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status <> 'draft' OR OLD.posted_at IS NOT NULL OR OLD.canceled_at IS NOT NULL THEN
    RAISE EXCEPTION 'POSTED_ADJUSTMENT_LOCKED' USING errcode = 'P0001';
  END IF;
  IF NEW.status <> 'draft' OR NEW.posted_at IS NOT NULL OR NEW.canceled_at IS NOT NULL THEN
    RAISE EXCEPTION 'ADJUSTMENT_POSTING_REQUIRES_RPC' USING errcode = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_guard_adjustment_line_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status public.inventory_document_status;
  v_posted_at timestamptz;
  v_canceled_at timestamptz;
  v_adjustment_id uuid;
BEGIN
  IF public.inventory_rpc_guard_enabled() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  v_adjustment_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.adjustment_id ELSE NEW.adjustment_id END;
  SELECT status, posted_at, canceled_at
    INTO v_status, v_posted_at, v_canceled_at
  FROM public.inventory_adjustment_documents
  WHERE id = v_adjustment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADJUSTMENT_NOT_FOUND' USING errcode = 'P0001';
  END IF;
  IF v_status <> 'draft' OR v_posted_at IS NOT NULL OR v_canceled_at IS NOT NULL THEN
    RAISE EXCEPTION 'POSTED_ADJUSTMENT_LINES_LOCKED' USING errcode = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_guard_adjustment_document_update ON public.inventory_adjustment_documents;
CREATE TRIGGER inventory_guard_adjustment_document_update
BEFORE UPDATE OR DELETE ON public.inventory_adjustment_documents
FOR EACH ROW EXECUTE FUNCTION public.inventory_guard_adjustment_document_update();
DROP TRIGGER IF EXISTS inventory_guard_adjustment_line_update ON public.inventory_adjustment_lines;
CREATE TRIGGER inventory_guard_adjustment_line_update
BEFORE INSERT OR UPDATE OR DELETE ON public.inventory_adjustment_lines
FOR EACH ROW EXECUTE FUNCTION public.inventory_guard_adjustment_line_update();

CREATE OR REPLACE FUNCTION public.inventory_adjust_stock(
  p_company_id uuid,
  p_idempotency_key uuid,
  p_item_id uuid,
  p_warehouse_id uuid,
  p_bin_id uuid,
  p_counted_quantity numeric,
  p_reason text,
  p_unit_cost numeric,
  p_reference_number text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_reason public.inventory_adjustment_reason;
  v_item public.inventory_items%ROWTYPE;
  v_balance public.inventory_stock_balances%ROWTYPE;
  v_document public.inventory_adjustment_documents%ROWTYPE;
  v_line_id uuid;
  v_movement_id uuid;
  v_warehouse_company uuid;
  v_bin_warehouse uuid;
  v_delta numeric(14,4);
  v_new_total numeric(14,4);
  v_new_average numeric(14,4);
  v_cost numeric(14,4);
BEGIN
  IF v_user_id IS NULL OR NOT public.can_manage_company(p_company_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED' USING errcode = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'IDEMPOTENCY_KEY_REQUIRED' USING errcode = 'P0001';
  END IF;

  SELECT * INTO v_document
  FROM public.inventory_adjustment_documents
  WHERE company_id = p_company_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT id, movement_id INTO v_line_id, v_movement_id
    FROM public.inventory_adjustment_lines
    WHERE adjustment_id = v_document.id
    ORDER BY created_at, id
    LIMIT 1;
    RETURN jsonb_build_object(
      'status', v_document.status,
      'adjustment_id', v_document.id,
      'adjustment_line_id', v_line_id,
      'movement_id', v_movement_id,
      'idempotent_replay', true
    );
  END IF;

  IF p_counted_quantity IS NULL OR p_counted_quantity < 0 THEN
    RAISE EXCEPTION 'INVALID_COUNTED_QUANTITY' USING errcode = 'P0001';
  END IF;
  IF coalesce(p_reason, '') NOT IN ('initial', 'count', 'shortage', 'damage', 'found', 'correction') THEN
    RAISE EXCEPTION 'INVALID_ADJUSTMENT_REASON' USING errcode = 'P0001';
  END IF;
  v_reason := p_reason::public.inventory_adjustment_reason;

  SELECT company_id INTO v_warehouse_company
  FROM public.inventory_warehouses
  WHERE id = p_warehouse_id AND is_active = true;
  IF v_warehouse_company IS NULL THEN
    RAISE EXCEPTION 'WAREHOUSE_NOT_FOUND' USING errcode = 'P0001';
  END IF;
  IF v_warehouse_company <> p_company_id THEN
    RAISE EXCEPTION 'WAREHOUSE_COMPANY_MISMATCH' USING errcode = 'P0001';
  END IF;

  IF p_bin_id IS NOT NULL THEN
    SELECT warehouse_id INTO v_bin_warehouse
    FROM public.inventory_bins
    WHERE id = p_bin_id AND company_id = p_company_id AND is_active = true;
    IF v_bin_warehouse IS NULL OR v_bin_warehouse <> p_warehouse_id THEN
      RAISE EXCEPTION 'BIN_WAREHOUSE_MISMATCH' USING errcode = 'P0001';
    END IF;
  END IF;

  SELECT * INTO v_item
  FROM public.inventory_items
  WHERE id = p_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND' USING errcode = 'P0001';
  END IF;
  IF v_item.company_id <> p_company_id THEN
    RAISE EXCEPTION 'ITEM_COMPANY_MISMATCH' USING errcode = 'P0001';
  END IF;

  INSERT INTO public.inventory_stock_balances (company_id, item_id, warehouse_id, bin_id, quantity)
  VALUES (p_company_id, p_item_id, p_warehouse_id, p_bin_id, 0)
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_balance
  FROM public.inventory_stock_balances
  WHERE company_id = p_company_id
    AND item_id = p_item_id
    AND warehouse_id = p_warehouse_id
    AND bin_id IS NOT DISTINCT FROM p_bin_id
  FOR UPDATE;

  v_delta := round(p_counted_quantity - v_balance.quantity, 4);
  IF v_delta = 0 THEN
    RAISE EXCEPTION 'NO_ADJUSTMENT_NEEDED' USING errcode = 'P0001';
  END IF;

  v_new_total := v_item.total_quantity + v_delta;
  IF v_new_total < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING errcode = 'P0001';
  END IF;

  v_cost := CASE
    WHEN v_delta > 0 THEN coalesce(p_unit_cost, v_item.average_cost, 0)
    ELSE v_item.average_cost
  END;
  IF v_cost < 0 THEN
    RAISE EXCEPTION 'INVALID_UNIT_COST' USING errcode = 'P0001';
  END IF;

  v_new_average := CASE
    WHEN v_new_total = 0 THEN 0
    WHEN v_delta > 0 AND v_item.total_quantity = 0 THEN v_cost
    WHEN v_delta > 0 THEN round(((v_item.total_quantity * v_item.average_cost) + (v_delta * v_cost)) / v_new_total, 4)
    ELSE v_item.average_cost
  END;

  INSERT INTO public.inventory_adjustment_documents (
    company_id, warehouse_id, bin_id, adjustment_date, reason, reference_number,
    status, notes, idempotency_key, created_by_user_id
  ) VALUES (
    p_company_id, p_warehouse_id, p_bin_id, current_date, v_reason,
    trim(coalesce(p_reference_number, '')), 'draft', trim(coalesce(p_notes, '')),
    p_idempotency_key, v_user_id
  )
  ON CONFLICT (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING * INTO v_document;

  IF NOT FOUND THEN
    SELECT * INTO v_document
    FROM public.inventory_adjustment_documents
    WHERE company_id = p_company_id AND idempotency_key = p_idempotency_key;
    SELECT id, movement_id INTO v_line_id, v_movement_id
    FROM public.inventory_adjustment_lines
    WHERE adjustment_id = v_document.id
    ORDER BY created_at, id
    LIMIT 1;
    RETURN jsonb_build_object(
      'status', v_document.status,
      'adjustment_id', v_document.id,
      'adjustment_line_id', v_line_id,
      'movement_id', v_movement_id,
      'idempotent_replay', true
    );
  END IF;

  INSERT INTO public.inventory_adjustment_lines (
    company_id, adjustment_id, item_id, system_quantity, counted_quantity,
    quantity_delta, unit_cost
  ) VALUES (
    p_company_id, v_document.id, p_item_id, v_balance.quantity, p_counted_quantity,
    v_delta, v_cost
  ) RETURNING id INTO v_line_id;

  PERFORM set_config('app.inventory_rpc', 'on', true);

  UPDATE public.inventory_stock_balances
  SET quantity = p_counted_quantity, updated_at = now()
  WHERE id = v_balance.id;

  UPDATE public.inventory_items
  SET total_quantity = v_new_total, average_cost = v_new_average, updated_at = now()
  WHERE id = v_item.id;

  INSERT INTO public.inventory_movements (
    company_id, item_id, movement_type, quantity, unit_cost,
    from_warehouse_id, from_bin_id, to_warehouse_id, to_bin_id,
    reference_type, reference_id, reference_number, notes,
    adjustment_id, adjustment_line_id,
    balance_before, balance_after, average_cost_before, average_cost_after,
    created_by_user_id
  ) VALUES (
    p_company_id, p_item_id, 'adjustment', abs(v_delta), v_cost,
    CASE WHEN v_delta < 0 THEN p_warehouse_id ELSE NULL END,
    CASE WHEN v_delta < 0 THEN p_bin_id ELSE NULL END,
    CASE WHEN v_delta > 0 THEN p_warehouse_id ELSE NULL END,
    CASE WHEN v_delta > 0 THEN p_bin_id ELSE NULL END,
    'stock_adjustment', v_document.id,
    coalesce(nullif(trim(coalesce(p_reference_number, '')), ''), v_document.id::text),
    concat(v_reason::text, CASE WHEN trim(coalesce(p_notes, '')) = '' THEN '' ELSE ': ' || trim(p_notes) END),
    v_document.id, v_line_id,
    v_balance.quantity, p_counted_quantity, v_item.average_cost, v_new_average,
    v_user_id
  ) RETURNING id INTO v_movement_id;

  UPDATE public.inventory_adjustment_lines
  SET movement_id = v_movement_id
  WHERE id = v_line_id;

  UPDATE public.inventory_adjustment_documents
  SET status = 'posted', posted_at = now(), posted_by_user_id = v_user_id, updated_at = now()
  WHERE id = v_document.id;

  RETURN jsonb_build_object(
    'status', 'posted',
    'adjustment_id', v_document.id,
    'adjustment_line_id', v_line_id,
    'movement_id', v_movement_id,
    'system_quantity', v_balance.quantity,
    'counted_quantity', p_counted_quantity,
    'quantity_delta', v_delta,
    'new_total_quantity', v_new_total,
    'average_cost', v_new_average,
    'idempotent_replay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_cancel_adjustment(p_adjustment_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_document public.inventory_adjustment_documents%ROWTYPE;
  v_line public.inventory_adjustment_lines%ROWTYPE;
  v_item public.inventory_items%ROWTYPE;
  v_balance public.inventory_stock_balances%ROWTYPE;
  v_movement public.inventory_movements%ROWTYPE;
  v_later_count integer;
  v_restored_balance numeric(14,4);
  v_restored_total numeric(14,4);
  v_restored_average numeric(14,4);
  v_canceled_lines integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'ACCESS_DENIED' USING errcode = 'P0001';
  END IF;

  SELECT * INTO v_document
  FROM public.inventory_adjustment_documents
  WHERE id = p_adjustment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADJUSTMENT_NOT_FOUND' USING errcode = 'P0001';
  END IF;
  IF NOT public.can_manage_company(v_document.company_id) THEN
    RAISE EXCEPTION 'ACCESS_DENIED' USING errcode = 'P0001';
  END IF;
  IF v_document.status = 'canceled' THEN
    RETURN jsonb_build_object('status', 'canceled', 'adjustment_id', v_document.id, 'idempotent_replay', true);
  END IF;
  IF v_document.status <> 'posted' THEN
    RAISE EXCEPTION 'ADJUSTMENT_NOT_POSTED' USING errcode = 'P0001';
  END IF;

  PERFORM set_config('app.inventory_rpc', 'on', true);

  FOR v_line IN
    SELECT * FROM public.inventory_adjustment_lines
    WHERE adjustment_id = v_document.id AND company_id = v_document.company_id
    ORDER BY created_at DESC, id DESC
    FOR UPDATE
  LOOP
    SELECT * INTO v_movement
    FROM public.inventory_movements
    WHERE adjustment_line_id = v_line.id AND reference_type = 'stock_adjustment'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ADJUSTMENT_MOVEMENT_NOT_FOUND' USING errcode = 'P0001';
    END IF;

    SELECT count(*) INTO v_later_count
    FROM public.inventory_movements m
    WHERE m.company_id = v_document.company_id
      AND m.item_id = v_line.item_id
      AND (m.created_at > v_movement.created_at OR (m.created_at = v_movement.created_at AND m.id <> v_movement.id))
      AND m.adjustment_line_id IS DISTINCT FROM v_line.id;
    IF v_later_count > 0 THEN
      RAISE EXCEPTION 'ADJUSTMENT_HAS_LATER_MOVEMENTS' USING errcode = 'P0001';
    END IF;

    SELECT * INTO v_item
    FROM public.inventory_items
    WHERE id = v_line.item_id
    FOR UPDATE;

    SELECT * INTO v_balance
    FROM public.inventory_stock_balances
    WHERE company_id = v_document.company_id
      AND item_id = v_line.item_id
      AND warehouse_id = v_document.warehouse_id
      AND bin_id IS NOT DISTINCT FROM v_document.bin_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK_TO_CANCEL' USING errcode = 'P0001';
    END IF;

    v_restored_balance := v_balance.quantity - v_line.quantity_delta;
    v_restored_total := v_item.total_quantity - v_line.quantity_delta;
    v_restored_average := coalesce(v_movement.average_cost_before, 0);
    IF v_restored_balance < 0 OR v_restored_total < 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK_TO_CANCEL' USING errcode = 'P0001';
    END IF;

    UPDATE public.inventory_stock_balances
    SET quantity = v_restored_balance, updated_at = now()
    WHERE id = v_balance.id;

    UPDATE public.inventory_items
    SET total_quantity = v_restored_total, average_cost = v_restored_average, updated_at = now()
    WHERE id = v_item.id;

    INSERT INTO public.inventory_movements (
      company_id, item_id, movement_type, quantity, unit_cost,
      from_warehouse_id, from_bin_id, to_warehouse_id, to_bin_id,
      reference_type, reference_id, reference_number, notes,
      adjustment_id, adjustment_line_id,
      balance_before, balance_after, average_cost_before, average_cost_after,
      created_by_user_id
    ) VALUES (
      v_document.company_id, v_line.item_id, 'adjustment', abs(v_line.quantity_delta), v_movement.unit_cost,
      CASE WHEN v_line.quantity_delta > 0 THEN v_document.warehouse_id ELSE NULL END,
      CASE WHEN v_line.quantity_delta > 0 THEN v_document.bin_id ELSE NULL END,
      CASE WHEN v_line.quantity_delta < 0 THEN v_document.warehouse_id ELSE NULL END,
      CASE WHEN v_line.quantity_delta < 0 THEN v_document.bin_id ELSE NULL END,
      'stock_adjustment_cancel', v_document.id,
      coalesce(nullif(v_document.reference_number, ''), v_document.id::text),
      trim(coalesce(p_reason, '')), v_document.id, v_line.id,
      v_balance.quantity, v_restored_balance, v_item.average_cost, v_restored_average,
      v_user_id
    );

    v_canceled_lines := v_canceled_lines + 1;
  END LOOP;

  UPDATE public.inventory_adjustment_documents
  SET status = 'canceled', canceled_at = now(), canceled_by_user_id = v_user_id,
      cancel_reason = trim(coalesce(p_reason, '')), updated_at = now()
  WHERE id = v_document.id;

  RETURN jsonb_build_object(
    'status', 'canceled',
    'adjustment_id', v_document.id,
    'canceled_lines', v_canceled_lines,
    'idempotent_replay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_adjust_stock(uuid, uuid, uuid, uuid, uuid, numeric, text, numeric, text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_adjust_stock(uuid, uuid, uuid, uuid, uuid, numeric, text, numeric, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.inventory_cancel_adjustment(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_cancel_adjustment(uuid, text) TO authenticated;

GRANT SELECT ON public.inventory_adjustment_documents TO authenticated;
GRANT SELECT ON public.inventory_adjustment_lines TO authenticated;
