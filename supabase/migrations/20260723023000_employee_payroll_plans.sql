-- Per-employee payroll plans and hourly/salary period records.
-- Commission payroll stays job-based in payroll_items; hourly and salary payroll
-- are stored by explicit reporting period in staff_payroll_periods.

CREATE TABLE IF NOT EXISTS public.employee_payroll_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  technician_id uuid NOT NULL REFERENCES public.company_technicians(id) ON DELETE CASCADE,
  pay_type text NOT NULL DEFAULT 'commission',
  hourly_rate_cents integer NOT NULL DEFAULT 0,
  overtime_multiplier numeric(6,3) NOT NULL DEFAULT 1.5,
  salary_amount_cents integer NOT NULL DEFAULT 0,
  salary_frequency text NOT NULL DEFAULT 'weekly',
  commission_percent numeric(6,3) NOT NULL DEFAULT 50,
  scf_only_payout_cents integer NOT NULL DEFAULT 5000,
  include_scf boolean NOT NULL DEFAULT true,
  deduct_materials boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_payroll_settings_company_technician_unique UNIQUE (company_id, technician_id),
  CONSTRAINT employee_payroll_settings_pay_type_check CHECK (pay_type IN ('commission', 'hourly', 'salary', 'none')),
  CONSTRAINT employee_payroll_settings_salary_frequency_check CHECK (salary_frequency IN ('weekly', 'biweekly', 'monthly')),
  CONSTRAINT employee_payroll_settings_hourly_rate_check CHECK (hourly_rate_cents >= 0),
  CONSTRAINT employee_payroll_settings_overtime_multiplier_check CHECK (overtime_multiplier >= 1 AND overtime_multiplier <= 5),
  CONSTRAINT employee_payroll_settings_salary_amount_check CHECK (salary_amount_cents >= 0),
  CONSTRAINT employee_payroll_settings_commission_check CHECK (commission_percent >= 0 AND commission_percent <= 100),
  CONSTRAINT employee_payroll_settings_scf_only_check CHECK (scf_only_payout_cents >= 0)
);

CREATE TABLE IF NOT EXISTS public.staff_payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  technician_id uuid NOT NULL REFERENCES public.company_technicians(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  regular_hours numeric(10,2) NOT NULL DEFAULT 0,
  overtime_hours numeric(10,2) NOT NULL DEFAULT 0,
  gross_cents integer NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_payroll_periods_unique UNIQUE (company_id, technician_id, period_start, period_end),
  CONSTRAINT staff_payroll_periods_dates_check CHECK (period_end >= period_start),
  CONSTRAINT staff_payroll_periods_regular_hours_check CHECK (regular_hours >= 0),
  CONSTRAINT staff_payroll_periods_overtime_hours_check CHECK (overtime_hours >= 0),
  CONSTRAINT staff_payroll_periods_gross_check CHECK (gross_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_employee_payroll_settings_company
  ON public.employee_payroll_settings(company_id, technician_id);
CREATE INDEX IF NOT EXISTS idx_staff_payroll_periods_company_dates
  ON public.staff_payroll_periods(company_id, period_start DESC, period_end DESC);
CREATE INDEX IF NOT EXISTS idx_staff_payroll_periods_employee_dates
  ON public.staff_payroll_periods(technician_id, period_start DESC, period_end DESC);

DROP TRIGGER IF EXISTS set_employee_payroll_settings_updated_at ON public.employee_payroll_settings;
CREATE TRIGGER set_employee_payroll_settings_updated_at
BEFORE UPDATE ON public.employee_payroll_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS set_staff_payroll_periods_updated_at ON public.staff_payroll_periods;
CREATE TRIGGER set_staff_payroll_periods_updated_at
BEFORE UPDATE ON public.staff_payroll_periods
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.employee_payroll_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_payroll_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee payroll settings readable by company or platform" ON public.employee_payroll_settings;
CREATE POLICY "employee payroll settings readable by company or platform"
ON public.employee_payroll_settings
FOR SELECT USING (public.can_access_company(company_id));

DROP POLICY IF EXISTS "employee payroll settings manageable by company managers or platform" ON public.employee_payroll_settings;
CREATE POLICY "employee payroll settings manageable by company managers or platform"
ON public.employee_payroll_settings
FOR ALL
USING (public.can_manage_company(company_id))
WITH CHECK (
  public.can_manage_company(company_id)
  AND EXISTS (
    SELECT 1
    FROM public.company_technicians technician
    WHERE technician.id = technician_id
      AND technician.company_id = employee_payroll_settings.company_id
  )
);

DROP POLICY IF EXISTS "staff payroll periods readable by company or platform" ON public.staff_payroll_periods;
CREATE POLICY "staff payroll periods readable by company or platform"
ON public.staff_payroll_periods
FOR SELECT USING (public.can_access_company(company_id));

DROP POLICY IF EXISTS "staff payroll periods manageable by company managers or platform" ON public.staff_payroll_periods;
CREATE POLICY "staff payroll periods manageable by company managers or platform"
ON public.staff_payroll_periods
FOR ALL
USING (public.can_manage_company(company_id))
WITH CHECK (
  public.can_manage_company(company_id)
  AND EXISTS (
    SELECT 1
    FROM public.company_technicians technician
    WHERE technician.id = technician_id
      AND technician.company_id = staff_payroll_periods.company_id
  )
);
