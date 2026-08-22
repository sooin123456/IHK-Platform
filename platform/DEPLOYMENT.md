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

## Commercial boundary

The current Revit field beta is a free download, not a zero-value card charge.
The unsafe scaffold checkout was removed. A paid release requires server-side
order creation, signed payment confirmation/webhooks, an entitlement bound to the
immutable release SHA-256, refund handling, and download access auditing.
