# ServiceScope

ServiceScope is a multi-tenant service company platform for HVAC, appliance, plumbing, handyman, and similar field-service businesses.

## Current Scope

- Owner Console for creating and monitoring companies.
- Company Portal with jobs, all jobs, calendar, materials, tasks, map, email, finance, library, onboarding, and support portal.
- Owner Monitoring command center for billing risk, onboarding health, support signals, storage, workload, and tenant health.
- Company onboarding for profile/logo, mailbox setup, ServiceScope autopay setup, accepted customer payment methods, job workflow, job types, technicians, and warranty/archive rules.
- Job detail card with client data, materials, invoices, comments, photos/files, and payment fields.
- Payroll workflow with technician financial cards, selected payouts, paid payroll, and archive logic.
- Supabase schema draft in `supabase/schema.sql`.

## Backend Status

All user access uses Supabase Auth. After sign-in, ServiceScope resolves the active user through `platform_users` or `company_users` and opens the correct owner or company workspace. Owner workspace data loads from Supabase, and legacy local browser business data is cleared on startup. Company onboarding saves company profile, workflow, job types, payment methods, technicians, mailbox setup, onboarding steps, company access rows, and subscription payment metadata to Supabase tables.

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

Run it in a clean Supabase project, then create the first Auth user and insert that user into `platform_users` as `owner`. For an existing database, also run `supabase/auth-session-rpc.sql`. Company owners, managers, dispatchers, and technicians must have matching active rows in `company_users`.

Create `.env.local` from `.env.example`:

```text
VITE_SUPABASE_URL=https://sizdqtgejoikjlgukbqh.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

The current schema uses RLS policies based on Supabase Auth. For writes to succeed, the signed-in Supabase user must be present in `platform_users` or `company_users` with an active role that can manage the company.

## User Access

ServiceScope uses Supabase Auth as the login backend, but does not use Supabase invite emails for company handoff.

The owner or company admin creates access from ServiceScope:

- Enter or generate a password.
- Click `Create access` for a new company owner or technician.
- Click `Reset password` when a user forgets their password.
- Share the email and password directly with the user.
- The user signs in from the normal ServiceScope login screen.

Passwords are sent to the Edge Function only for creating/updating the Supabase Auth account. They are not stored in tenant tables.

Deploy the Edge Function and set the service role secret:

```bash
supabase functions deploy access-invite
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Mailbox OAuth uses three Edge Functions. `mailbox-connect` and `mailbox-oauth-settings` must require the signed-in user's JWT, but `mailbox-oauth-callback` must be public because Google redirects to it without an `Authorization` header. Keep `supabase/config.toml` deployed with the functions:

```bash
supabase functions deploy mailbox-oauth-settings
supabase functions deploy mailbox-connect
supabase functions deploy mailbox-sync
supabase functions deploy mailbox-oauth-callback
supabase secrets set APP_URL=http://127.0.0.1:5173/#portal
```

Company logos are stored in the public `company-logos` storage bucket defined in `supabase/schema.sql`; apply the schema before relying on logo uploads.

Workflow:

- Platform owner creates a company and creates the company owner access from the owner console.
- The company owner signs in with the email/password received from ServiceScope.
- Company admins/managers add technicians in onboarding and create/reset technician access from the technician list.
- Disabled company users stay in `company_users` but cannot resolve an active ServiceScope session.
