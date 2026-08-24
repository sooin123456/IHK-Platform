# Lukas QTO Platform deployment

This is a server-rendered React Router application. Deploy it as a Node.js
application; do not export it as a static site because login cookies and
private Storage links are created on the server.

## Required runtime variables

Set these values in the deployment host. `VITE_*` values are intentionally
browser-visible publishable settings. The service-role key is server-only and
must never use a `VITE_` prefix or be embedded in the client bundle.

```text
SUPABASE_URL=https://naubrijesaqnnbfaehpy.supabase.co
SUPABASE_ANON_KEY=<Supabase publishable key>
VITE_SUPABASE_URL=https://naubrijesaqnnbfaehpy.supabase.co
VITE_SUPABASE_ANON_KEY=<Supabase publishable key>
APP_URL=https://<platform-domain>
SITE_URL=https://<platform-domain>
VITE_APP_NAME=Lukas QTO Platform
VITE_REVIT_2025_BETA_URL=https://<verified-release-url>
VITE_REVIT_2025_BETA_SHA256=<64-hex-sha256>
VITE_REVIT_2025_BETA_VERSION=<release-label>
SUPABASE_SERVICE_ROLE_KEY=<server-only service role key>
```

Use Node 20 or later, then run `npm ci` and `npm run build`. For Vercel,
the same application is already configured with the React Router Vercel preset;
use `npm run build:vercel` as the deployment build command.

## Supabase Auth configuration

In the connected Supabase project, set the production Site URL to the
platform domain and add this redirect URL:

```text
https://<platform-domain>/auth/confirm
```

Keep the exact callback for every local port used by the development server,
for example `http://localhost:3000/auth/confirm` and
`http://127.0.0.1:4173/auth/confirm`. Local login links return to the origin
where they were requested; production links always use `APP_URL`. Test one
passwordless email sign-in after the domain is configured: it must finish at
`/workspace`.

## Release checks

1. Create a new account with an email link.
2. Create a project and upload a non-sensitive IFC and QTO CSV.
3. Open **IFC 속성 보기** and confirm a selected element shows its raw IFC
   properties.
4. Confirm another unauthenticated browser cannot open the project URL.
5. Create a read-only share link and a review share link, then confirm the
   active `lukas-qto-share` Edge Function never returns original file bytes.
6. Open `/news`, `/news.xml`, and each published company update.
7. Confirm `/download` shows **0원** and does not request payment information.
8. Download the ZIP and independently compare its SHA-256 with the value shown
   on the page. If the URL and hash are not both configured, the button must stay disabled.
9. Submit `/inquiry` and confirm a `hangil_staff` account can update it at
   `/staff/inquiries`, while a customer account cannot open that route.
10. Confirm an anonymous Supabase Auth session cannot read or create customer
    projects even though it uses the PostgreSQL `authenticated` role.
11. Apply `0010_material_control_pilot.sql`, open a project’s **자재·발주·입고 관리**,
    and record one concrete plan, purchase order, partial receipt and invoice evidence.
12. Confirm receipt/invoice insertion fails without an immutable evidence file and
    another customer cannot read the material plan, transaction or carbon-factor rows.

## Drawing collaboration deployment order

Apply the drawing collaboration release in this order:

1. Record the current schema and production deployment ID.
2. Apply the additive drawing migrations in filename order.
3. Confirm all `lukas_drawing_*` tables have RLS enabled and authenticated grants
   match the least-privilege migration.
4. Confirm only issues, comments, and events are members of `supabase_realtime`.
5. Run `node --test tests/*.test.mjs`, `npm run build`, and the IFC geometry smoke.
6. Deploy to Vercel production and verify public 200 responses plus protected-route
   redirects.
7. Run the disposable four-role Playwright flow against production with a real,
   non-logged `SUPABASE_SERVICE_ROLE_KEY`:
   `E2E_BASE_URL=https://lukas-qto-platform.vercel.app npx playwright test e2e/drawing-collaboration.spec.ts --project=chromium`.
8. Complete the two-user desktop/mobile checklist in
   `../docs/DRAWING_COLLABORATION_FIELD_CHECK.md`.

Useful verification queries:

```sql
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename like 'lukas_drawing_%'
order by tablename;

select c.relname, c.relrowsecurity, c.relacl
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname like 'lukas_drawing_%'
  and c.relkind = 'r'
order by c.relname;
```

Do not mark the drawing room complete from build output alone. Production maker,
reviewer, viewer, and non-member behavior must be verified by database enforcement,
and two real users must complete the field flow.

## Drawing Workspace P0/P1 release runbook

The browser editor is an additive route. Keep the existing collaboration room
available throughout rollout and use it as the immediate product rollback path.

1. Take a database backup and a schema snapshot. Record the backup identifier,
   current migration list, application deployment ID, and the SHA-256 values of
   the representative immutable PDF and IFC files.
2. Apply every drawing workspace migration in filename order. Never edit an
   already-applied migration; ship an additive forward-fix migration instead.
3. Run `npm run db:typegen` with `SUPABASE_PROJECT_REF` and commit/review the
   generated database type diff before application promotion.
4. Run `npm run test:drawing-workspace`, `node --test tests/*.test.mjs`,
   `npm run test:ifc`, `npm run typecheck`, and `npm run build`.
   With no path argument, `test:ifc` requires network access and downloads the
   pinned public `examples/example.ifc` from `ThatOpen/engine_web-ifc` commit
   `3f6f3640b8317664194911fad63bcd407f7e32ca`, verifies its known SHA-256,
   runs the selectable/renderable geometry smoke, and removes the temporary
   bytes. The upstream fixture is provided under MPL-2.0. Offline or
   changed-source runs fail explicitly; they are never reported as skipped.
   A reviewer may instead run `npm run test:ifc -- /absolute/path/model.ifc`.
5. Deploy a Vercel preview. Smoke the PDF-backed and blank routes with an Editor,
   then confirm a Viewer has no mutation controls and receives a database
   rejection for an attempted mutation.
6. Run the isolated production fixture only against the intended preview or
   production target:

   ```sh
   E2E_BASE_URL=https://<target-domain> npm run test:e2e:drawing-workspace:production
   ```

   The process also requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY`. Never print their values. The fixture creates its
   own project/users/files and deletes the project cascade, Storage objects, and
   Auth users in dependency order while collecting every cleanup failure.
7. Promote only after the Editor/Viewer smoke, exact PDF/IFC SHA comparison,
   separate reviewer approval, and cleanup all pass. Record the Playwright browser,
   viewport, 10,000-object composition, 120-frame median/p95, and selection
   median/p95. The P0/P1 catastrophic threshold is 50 ms p95; 60fps remains an
   unachieved P7 optimization target.

If any required credential or target is absent, record this production gate as
`unexecuted`, never as passed. If application behavior regresses, route users back
to the existing collaboration room and roll back the application deployment. For
an applied additive database migration, prefer a reviewed forward-fix; restore the
backup only under the incident runbook after confirming no post-snapshot customer
writes would be lost. Approved revisions and immutable source-file rows must never
be directly rewritten during rollback.

## Commercial boundary

The current Revit field beta is a free download, not a zero-value card charge.
The unsafe scaffold checkout was removed. A paid release requires server-side
order creation, signed payment confirmation/webhooks, an entitlement bound to the
immutable release SHA-256, refund handling, and download access auditing.
