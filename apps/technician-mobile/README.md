# ServiceScope Technician Mobile

Imported from `simscope/hvac-app`.

This is the technician-facing mobile web app for ServiceScope. It is kept as a separate app so its Create React App dependencies do not interfere with the main Vite owner/company portal.

## Structure

- `client/` - React technician app.
- `server/` - small legacy server placeholder from the original repo.
- `railway.json` and `vercel.json` - original deployment configs retained for reference.

## Development

From the ServiceScope repo root:

```bash
npm run tech:install
npm run tech:dev
npm run tech:build
```

The client uses CRA environment variables. Create `apps/technician-mobile/client/.env.local` from `apps/technician-mobile/client/.env.example` and set the ServiceScope Supabase anon key.

```text
REACT_APP_SUPABASE_URL=https://sizdqtgejoikjlgukbqh.supabase.co
REACT_APP_SUPABASE_ANON_KEY=your-anon-key
REACT_APP_SUPABASE_FUNCTIONS_URL=https://sizdqtgejoikjlgukbqh.supabase.co/functions/v1
```

## Integration Notes

The app now belongs to this repository and points at the ServiceScope Supabase project through environment variables. The imported UI still uses several legacy table names from `hvac-app`, including `technicians`, `clients`, `materials`, `invoices`, `profiles`, and `comments`.

Before making it production-live for ServiceScope technicians, map those calls to the current ServiceScope schema:

- `technicians` -> `company_technicians`
- `clients` -> `customers` / `customer_locations`
- `materials` -> `job_materials`
- `invoices` -> `job_invoices`
- `profiles` -> `company_users`
- `comments` -> `job_comments`
