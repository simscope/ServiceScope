# ServiceScope

ServiceScope is a multi-tenant service company platform prototype for HVAC, appliance, plumbing, handyman, and similar field-service businesses.

## Current Scope

- Owner Console for creating and monitoring companies.
- Company Portal with jobs, all jobs, calendar, materials, tasks, map, email, finance, library, onboarding, and support portal.
- Owner Monitoring command center for billing risk, onboarding health, support signals, storage, workload, and tenant health.
- Company onboarding for profile/logo, mailbox setup, ServiceScope autopay setup, accepted customer payment methods, job workflow, job types, technicians, and warranty/archive rules.
- Job detail card with client data, materials, invoices, comments, photos/files, and payment fields.
- Payroll workflow with technician financial cards, selected payouts, paid payroll, and archive logic.
- Supabase schema draft in `supabase/schema.sql`.

## Prototype Status

The owner/company shell still keeps a local fallback while Supabase Auth is being wired, but Company onboarding is backend-ready. When `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured, onboarding saves company profile, workflow, job types, payment methods, technicians, mailbox setup, and subscription payment metadata to Supabase tables.

## Development

```bash
npm install
npm run dev
npm run build
```

## Supabase

The initial database schema is in:

```text
supabase/schema.sql
```

Run it in a clean Supabase project, then create the first Auth user and insert that user into `platform_users` as `owner`.

Create `.env.local` from `.env.example`:

```text
VITE_SUPABASE_URL=https://sizdqtgejoikjlgukbqh.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

The current schema uses RLS policies based on Supabase Auth. For writes to succeed, the signed-in Supabase user must be present in `platform_users` or `company_users` with an active role that can manage the company.
