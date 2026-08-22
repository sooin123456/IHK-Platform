# Lukas QTO next-product strategy — source notes

Snapshot date: 2026-08-15 (Asia/Seoul)

## Local product evidence

- `README.md`: Revit add-in compatibility, Properties extraction, IFC/QTO package, deterministic validation, and Desktop product boundary.
- `platform/README.md`: public website, authentication, project workflow, immutable evidence/review, material plan, purchase order, receipt, invoice, three-way matching, and A1–A3 carbon pilot.
- `platform/LUKAS_QTO_INTEGRATION.md`: connected hosted Supabase project metadata, private storage, RLS, and Lukas-prefixed schema boundary.
- `platform/supabase/migrations/0010_material_control_pilot.sql`: append-only material transactions, evidence requirements, fixed-point quantities and prices, RLS, and explicit grants.
- `platform/app/lib/material-control.server.ts`: deterministic three-way match and carbon coverage calculations.
- `docs/PROJECT_STATE.md`: implemented and externally gated features, including the decision to keep AI out of final quantity decisions.

## Local dependency audit

Command: `npm audit --omit=dev --json` in `platform/` on 2026-08-15.

- Total advisories in the installed dependency tree: 71.
- Severity: 7 critical, 25 high, 34 moderate, 5 low.
- Direct packages requiring staged remediation include React Router, Vite, Sentry React Router, Drizzle ORM, i18next backends, React Email, Playwright and Supabase JS.
- Notable installed-to-wanted versions: React Router 7.5.1 → 7.18.2; Supabase JS 2.49.4 → 2.112.3; Vite 5.4.18 → 5.4.21; Playwright 1.52.0 → 1.62.1.
- Do not use an unreviewed `npm audit fix --force`; upgrade in bounded batches and run auth, upload, SSR, RLS and download regression tests after each batch.

## Supabase evidence

- Supabase changelog, breaking changes: https://supabase.com/changelog?types=breaking-change
- Supabase documentation: https://supabase.com/docs
- Relevant upcoming change: new tables are not automatically exposed through the Data API/GraphQL API; explicit privileges plus RLS are required. Enforcement is scheduled for 2026-10-30 according to the changelog reviewed on 2026-08-15.
- The local migration already uses explicit grants and enables RLS, but the hosted project was not inspected because the local Supabase CLI is not authenticated. Remote migration state, database advisors, SMTP configuration and live policies remain deployment gates.

## Competitor and adjacent-product evidence

- Autodesk Forma Takeoff: https://www.autodesk.com/products/forma-takeoff/overview
- RIB CostX: https://www.rib-software.com/en/rib-benchmark?redirect=exactal
- Kreo: https://www.kreo.net/
- Togal.AI: https://www.togal.ai/features
- Solibri: https://www.solibri.com/products/advanced
- BIMcollab Nexus: https://www.bimcollab.com/en/products/bimcollab-nexus/
- Procore Materials: https://www.procore.com/materials
- One Click LCA: https://oneclicklca.com/en-us/software/design-construction
- 산군: https://www.sankun.com/ and https://www.sankun.com/main/pricing

The competitor descriptions in the report are bounded to capabilities stated on these official pages. No pricing or market-share comparison is asserted.

## Open-source and standards evidence

- IfcOpenShell: https://github.com/IfcOpenShell/IfcOpenShell
- That Open Engine / web-ifc: https://github.com/ThatOpen/engine_web-ifc
- Speckle Server: https://github.com/specklesystems/speckle-server
- openEPD: https://github.com/cchangelabs/openepd
- buildingSMART IDS: https://www.buildingsmart.org/standards/bsi-standards/information-delivery-specification-ids/
- buildingSMART Data Dictionary services: https://services.buildingsmart.org/
- GS1 EPCIS: https://www.gs1.org/standards/epcis
- EU Construction Products Regulation 2024/3110: https://eur-lex.europa.eu/eli/reg/2024/3110/oj/

## Interpretation boundaries

- SHA-256 is a file fingerprint, not blockchain or zero-knowledge proof.
- “Approval” means a verified, authorized business decision only when the approval registry and operator identity are independently controlled. A self-authored hash list is integrity checking, not independent authorization.
- Product-market conclusions are strategic hypotheses until validated by real estimators, BIM coordinators, procurement staff and site receivers on live projects.
- KOTO could not be reliably loaded during this review, so no KOTO-specific capability claim is included.
