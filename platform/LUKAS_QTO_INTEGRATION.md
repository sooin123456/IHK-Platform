# Lukas QTO Platform Integration

`platform/` is a private SaaS application base copied from Supaplate. It is
intentionally separate from `../site/`, which remains the public download and
product-information site.

## Current boundary

- `../site/`: public landing page, download and field-test instructions.
- `platform/`: authenticated project workspace for IFC, extracted CSV and
  review workflows.
- `../src/`: Windows/Revit extraction add-in; it remains the only component
  that reads RVT data.

The original `LICENSE.md` remains in this directory. Do not publish this
directory as a reusable template or UI kit.

## Connected Supabase project

The active project is **lua_Main** (naubrijesaqnnbfaehpy, Seoul region).
Lukas QTO owns only the following prefixed resources in that shared project:

- Tables: lukas*qto_projects, lukas_qto_files, lukas_qto_reviews,
  lukas_qto_shares, lukas_qto_suggestions, and
  lukas_qto_suggestion_decisions, lukas_qto_takeoff_artifacts, and
  lukas_qto_takeoff_approvals, lukas_qto_takeoff_inputs, and
  lukas_qto_file_revisions, plus the `lukas_qto_preflight*\*` artifact,
  input, and approval tables.
- Private Storage bucket: lukas-qto.
- Migration sources: sql/migrations/0002_lukas_qto_platform.sql through
  0009_preflight_audit_artifacts.sql.

The existing lua\_\* tables are not part of this product and must not be
modified by Lukas QTO migrations. RLS is enabled on every Lukas QTO table.
The browser receives only the publishable key; SUPABASE_SERVICE_ROLE_KEY is
server-only. Public share links are resolved by the server, not via a
browser-callable security-definer RPC.

## Safe local setup

1. Copy `.env.example` to `.env` and fill the Supabase project values.
2. Run `npm ci`.
3. Run `npm run dev`.

Do not use the Supabase service-role key in browser code. All project files
must be stored in private buckets with RLS policies that limit owner access.

## Lukas QTO product work to add next

1. Replace Supaplate's starter home, blog and payment routes with Lukas QTO
   project, upload, viewer and share-link routes.
2. Add project/version/file/review tables through a Supabase migration; every
   exposed table needs RLS.
3. Keep IFC, CSV and export manifests immutable after upload. Review status
   and notes are separate records, not edits to the source files.
4. The first IFC viewer is implemented with `web-ifc` and Three.js: an
   authenticated owner can rotate, pan and zoom a model, select geometry in 3D,
   search elements, and see its Express ID, IFC type, Global ID and raw IFC
   properties. It runs in the browser from a five-minute signed Storage URL and
   never writes to, recalculates or claims an IFC-to-Revit mapping for the file.
   Files over 75MB keep the property browser but skip client-side triangulation
   to protect browser memory.

## Evidence-bound automatic review

Uploading an `element_ledger` now runs `ELEMENT_LEDGER_REVIEW_V2`. It records
only suggestions for malformed rows, duplicate Element IDs, invalid quantity
states, missing classification and missing measurable properties. Every
suggestion is immutable and bound to the uploaded file SHA-256 and producer
version. It never edits or fills a quantity.

Human decisions are separate append-only rows (`accepted`, `rejected`, or
`deferred`). Future AI classification and mapping producers must write the
same suggestion contract with `producer_kind=ai`; they do not receive authority
to write final quantities or deterministic rule results. Apply migration 0006
before using this screen against the connected Supabase project.

When a project already has an element ledger, the next ledger upload compares
the two immutable files by canonical Revit Element ID. Added, removed,
classification-changed and measurement-changed elements become
`revision_change` suggestions containing both source SHA-256 values. A missing,
oversized or invalid previous source produces an explicit comparison-unavailable
suggestion instead of a false clean result.

The same revision review now adds an exact quantity-impact suggestion. For
volume, length and height it records comparable previous/current totals and
`delta = SUM(current comparable) - SUM(previous comparable)` without converting
decimal strings through JavaScript `number`. A value known on only one revision
is reported as `not_evaluated_count`; it is never silently treated as zero.

Concrete TAKEOFF registration also rechecks the public arithmetic invariant
`allowance_m3 = final_m3 - raw_m3`, requires nonnegative net/final quantities
and nonpositive deductions, rejects duplicate canonical Element IDs, and
requires seven distinct stored input files. A valid report hash alone is not
sufficient to make inconsistent quantities acceptable.

Staff can export `LUKAS_SUGGESTION_FEEDBACK_V1` JSON from the project screen.
The export contains source evidence, producer version and the ordered human
decision labels needed for a future offline evaluation set. It intentionally
omits user identifiers and free-text decision notes. It is evaluation data,
not permission for a model to update quantities or approvals.

Staff may also import offline AI recommendations using
`samples/ai-suggestions.example.json` as the exact
`LUKAS_AI_SUGGESTIONS_V1` contract. The selected source file SHA must match;
unknown fields are rejected, and classification/mapping recommendations need
an explicit recommendation string. The original AI JSON is stored as an
immutable private file with its own SHA. Quantity, cost and decision fields are
outside the accepted contract.

Suggestion rows are server-write-only through the service-role client after
the authenticated action validates project access. The authenticated Data API
role has `SELECT` but no `INSERT/UPDATE/DELETE` grant on suggestions, so a user
cannot bypass the rule/AI import validators with a direct REST call. Human
decision rows remain append-only inserts under project-scoped RLS.

The project screen groups quality metrics by producer kind, producer version
and suggestion kind. Metrics use only the latest append-only human decision:
accepted, rejected, deferred and pending counts, decision rate, and acceptance
rate over conclusive accepted/rejected decisions. With no conclusive decisions,
acceptance is `not evaluable`, never zero or pass. No metric automatically
promotes a producer into a calculation or approval role.

## Deterministic takeoff evidence

The project screen accepts the exact `CONCRETE_TAKEOFF_CSV_V1` report and
manifest pair produced by Lukas QTO Core. The server verifies the report
filename, report and manifest SHA-256, row count, lossless decimal syntax,
PASS-row formula/rule/evidence requirements, canonical Element IDs, and the
exact seven input hashes (`export_manifest`, `ifc`, `qto`, `element_ledger`,
`revit_mapping`, `concrete_rules`, and `registry`) before storing anything.
Each input role must also resolve to an immutable file row of the expected kind
in the same project. The role, file ID, project ID and SHA-256 are persisted as
a composite foreign-key link, so a manifest containing invented hashes cannot
enter the approval workflow.

Report and manifest bytes remain immutable private files. The artifact row is
server-write-only and binds both file identities and hashes. Human approval,
rejection, or deferral is stored as a separate append-only row. Opening the
detail page downloads both private files and runs the verifier again before it
shows base quantity, deduction, allowance, final quantity, formula, rule hash,
source evidence, and Element IDs. The web application does not recalculate or
change a Core quantity. Apply migration 0007 before using this flow.

## Explicit file revisions

Migration 0008 stores a server-written `supersedes` edge between immutable
files of the same project and kind. Both endpoints are bound by file ID and
SHA-256, the direction must follow creation time, and unique predecessor and
successor constraints keep a linear chain under concurrent uploads. Re-upload
of the latest identical SHA is rejected. Element-ledger revision suggestions
compare the same explicit predecessor bytes; the relation does not depend on a
filename or a guessed revision number.

## QTO and estimate preflight evidence

The L1 report and run manifest form another immutable bundle. Registration is
allowed only when the run manifest records `소스게이트=PASS`, a non-empty scope,
engine hashes, deterministic tolerances, report filename/SHA, and the QTO,
estimate, mapping, source-manifest and optional IFC identities. Every input
must already exist in the project with the exact expected kind, filename and
SHA. The detail route downloads and verifies the bundle again before showing
rule-level expected, actual, delta, evidence and message fields. Human approval
history is append-only and never changes a Core finding. Apply migration 0009
before using this flow.
