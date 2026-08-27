# Drawing Workspace P6 Quantity, BOQ, and Material Lineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect an approved schema-v2 Drawing snapshot and exact measurable object to deterministic Verified BOQ 1.1 quantities, maker-checker approval, approved CSV/XLSX/manifest exports, and the existing material/order/receipt/carbon lineage without changing source bytes or Verified BOQ 1.0 behavior.

**Architecture:** Add three narrowly scoped companion tables and one trusted server coordinator instead of changing the legacy QTO mapping contract. Pure TypeScript adapters reuse `P4_MEASUREMENT_V1` and the existing exact-decimal BOQ engine, while Postgres owns approval, project ancestry, OCC, append-only evidence, compare-and-freeze hashes, and material handoff. React Router loaders/actions expose persisted authority and keep browser arithmetic, Yjs, Awareness, and the Drawing outbox outside monetary state.

**Tech Stack:** React Router 7.18.2, React 19, TypeScript 5.9.3, Supabase/PostgreSQL with RLS and pgcrypto, Zod 3.24.2, Node `crypto`, existing exact-decimal helpers, `fflate@0.8.3`, Node test runner, PGlite 0.5.3, real PostgreSQL, and Playwright 1.62.1.

**Spec:** `docs/superpowers/specs/2026-08-27-drawing-workspace-p6-design.md`

## Global Constraints

- P6 starts only after P5 Task 6 is independently accepted; uncommitted P5 release work is not P6 completion evidence.
- Execution mode is already chosen as Subagent-Driven Development. Do not pause for another product or execution-method approval; stop only for a genuine new-authority blocker.
- Preserve every PDF, IFC, RVT, QTO, price-book, receipt, invoice, EPD, and manifest evidence byte and its recorded lowercase SHA-256 before and after P6 mutations.
- Persist a Drawing quantity source only from an independently approved schema-v2 snapshot for the exact revision version and SHA. Draft, review-requested, rejected, stale, restored-but-unapproved, and unapproved superseded subjects fail closed.
- The trusted server reloads and rehashes the snapshot, parses the exact object, derives `P4_MEASUREMENT_V1`, converts exactly, and inserts. The browser must not submit `raw_quantity`, `object_version`, `object_fingerprint`, final quantity, unit price, amount, or result hashes.
- Drawing-derived units are exactly `EA`, `m`, and `m2`. Reject `m3`; never infer volume from wall thickness, height, density, or any browser value.
- Quantity and material links are append-only. BOQ allocation links mutate only through guarded RPCs while the version is the maker's `draft`, with exact retry identity and `base_version` OCC.
- Allocation factors may be below `1` during draft entry, may never exceed `1`, and must sum to exactly `1` per used Drawing source inside the locked submission transaction.
- Keep `raw`, signed `adjustment`, `adjusted`, and `final` distinct in types, calculation, UI, comparison, CSV, XLSX, and manifest.
- Keep `VERIFIED-BOQ-1.0` inputs, output object order, CSV/XLSX behavior, and SHA bytes unchanged. Select additive `VERIFIED-BOQ-1.1` only from persisted `engine_version`.
- Use server-side exact-decimal calculation for quantity, rate, amount, comparison, manifest, export, and material handoff. Browser calculations are labelled `미리보기` and never authority.
- A BOQ in `in_review`, `approved`, or `superseded` and its P6 child evidence are immutable. Rejection returns the same version to `draft` through the existing append-only maker-checker decision path.
- Require an independently approved BOQ and matching recalculated result/manifest hashes for authoritative CSV/XLSX/manifest export and material handoff.
- Enforce same-project ancestry using composite foreign keys plus server rechecks for every source, snapshot, object, BOQ, line, resource, file, approval, material plan, transaction, and carbon factor.
- UI capability is advisory. React Router actions, explicit grants, RLS, triggers, RPCs, and trusted-server authority each fail closed independently.
- Keep P6 state out of the P3 collaboration document, Hocuspocus protocol, Yjs schema, y-indexeddb, Awareness, Drawing operation kinds, outbox, undo, and redo. Add no realtime publication for P6 tables.
- Add zero runtime dependencies and zero test frameworks. Reuse installed `fflate@0.8.3`; do not add a state manager, CRDT, collaboration server, queue, decimal library, spreadsheet library, ledger, rule DSL, or formula engine.
- Do not add AI classification/mapping, automatic approval, automatic price/carbon selection, guessed volume/density/waste, ERP/PMIS integration, supplier marketplace, payment, indirect cost, tax, profit, public market-price data, native DWG editing, OCR/sheet matching, a plugin SDK, Redis, bulk copy-on-write optimization, or P7 organization/retention/billing features.
- Add a new measurement rule only with supported deterministic geometry and server tests; add a queue only after measured request-boundary failure and an approved idempotent job contract; add another quantity ledger only when a real domain cannot use Drawing or legacy QTO adapters.
- Add the exact `fflate` MIT notice before the license gate: version `0.8.3`, upstream `https://github.com/101arrowz/fflate`, npm acquisition, unmodified `No`, purpose `Formula-free Verified BOQ XLSX ZIP generation`.
- Never edit historical migrations. Run `supabase --version`, inspect `supabase migration new --help`, then generate one forward migration named `drawing_workspace_p6_lineage`.
- Perform no data backfill. Operational rollback is restoration of the pre-migration database backup and application release, not a destructive down migration.
- Every P6 list is paginated and bounded at 200 rows by default. The material batch accepts at most 10,000 links and 2,000 plans.
- Performance evidence uses exactly 10,000 Drawing quantity links, 10,000 allocation links, 2,000 BOQ lines, representative legacy mappings, one approved snapshot, one price book, and material components.
- Record local performance on the documented Node 22 reference machine with cold/warm wall time, CPU, peak RSS, PostgreSQL plans, row counts, and output bytes; do not claim the separate P7 canvas 60fps or whole-workspace 2.5-second target.
- Hard local P6 gates are: no bridge-table sequential scan for indexed drill-down; no N+1 or unbounded response; calculation plus manifest p95 `<= 2.5s` and peak RSS `< 512 MiB`; comparison p95 `<= 3s`; warm 200-row real-PostgreSQL lineage p95 `<= 500ms`; 100 repeated runs with identical hashes and bytes.
- A missed threshold is `NOT MET`. Missing real PostgreSQL, hosted Supabase, deployed URLs, two-user credentials, cross-organization fixtures, provider authority, Storage/CORS authority, or production IDs is nonzero `UNEXECUTED`, never PASS.
- Preserve and exclude from every task commit the shared P4 evidence files, P5 Task 6 work, and `.superpowers/audits/` files already dirty when this plan was written.

## File Map

- Create `platform/app/lukas/lib/drawing-quantity-lineage.ts`: exact Drawing measurement conversion, canonical object-fingerprint digest, strict bridge/source types, material handoff derivation, and bounded P6 errors.
- Create `platform/supabase/migrations/20260827210000_drawing_workspace_p6_lineage.sql`: exactly three public tables, fixed RPC/private signatures, RLS, grants/revokes, immutable triggers, BOQ 1.1 columns/guards, FK/index preflight, and no realtime publication.
- Create `platform/tests/fixtures/drawing-workspace-p6-database-fixtures.mjs`, `platform/tests/drawing-workspace-p6-database-contract.test.mjs`, and `platform/tests/drawing-workspace-p6-postgres-concurrency.test.mjs`: fresh, upgrade, RLS, grant, lock, retry, and index proof.
- Create `platform/app/lukas/lib/drawing-quantity-lineage.server.ts`: authorized approved-snapshot loads, private RPC calls, BOQ freeze/decision, paginated lineage, export revalidation, manifest storage, and material handoff.
- Create `platform/app/lukas/lib/verified-boq-v1-1.server.ts` and `platform/app/lukas/lib/verified-boq-manifest.server.ts`: mixed source adapter, 1.1 result, canonical input, calculation manifest, approval envelope, and handoff manifest.
- Create `platform/app/lukas/lib/verified-boq-comparison-v1-1.server.ts`: RAW/MAPPING/ADJUSTMENT/PRICE/FORMULA approved-state waterfall.
- Create `platform/app/lukas/lib/verified-boq-approved-export.server.ts`: approved-only UTF-8 BOM CSV, formula-free XLSX input, and canonical manifest JSON.
- Modify `platform/app/lukas/lib/verified-boq.server.ts:13-114,441`, `verified-boq-xlsx.server.ts:5-90`, and `material-control.server.ts:8-216` additively; preserve 1.0 byte behavior.
- Modify `platform/app/lukas/screens/drawing-workspace.tsx:46-214`, `drawing-workspace.tsx:741-787,4117-4118,4755-4772`, and `drawing-inspector.tsx:31-57,162-184`; create `drawing-quantity-inspector.tsx`.
- Modify `platform/app/lukas/screens/verified-boq.tsx:45-142,306-445,448-707,708-1335,1980-2350`; create `verified-boq-drawing-sources.tsx` and `verified-boq-comparison.tsx`.
- Modify `platform/app/lukas/screens/material-control.tsx:326-735,760-1140`; create `material-boq-lineage.tsx`.
- Modify `platform/app/lukas/lib/drawing-workspace-view.ts:1-220` and `drawing-workspace.server.ts:1030-1065,1950-2000,2864` for exact authorized revision/object navigation.
- Create `platform/tests/drawing-quantity-lineage.test.mjs`, `drawing-quantity-lineage-server.test.mjs`, `verified-boq-v1-1.test.mjs`, and `drawing-workspace-p6-route.test.mjs`.
- Create `platform/e2e/drawing-workspace-p6.spec.ts`, `drawing-workspace-p6-production.spec.ts`, `platform/playwright.p6-release.config.ts`, P6 evidence/release scripts, and `drawing-workspace-p6-release.test.mjs`.
- Modify `platform/package.json` scripts only and `platform/THIRD_PARTY_NOTICES.md`; dependency and lockfile sections must not change.

---

### Task 1: Deterministic Drawing Quantity and Material Contracts

**Files:**

- Create: `platform/app/lukas/lib/drawing-quantity-lineage.ts`
- Modify: `platform/app/lukas/lib/drawing-semantic-schedules.ts:105-151`
- Modify: `platform/app/lukas/lib/material-control.server.ts:1-216`
- Test: `platform/tests/drawing-quantity-lineage.test.mjs`

**Interfaces:**

- Consumes: `measureDrawingObject(object, objects): DrawingMeasurement`, `drawingMeasurementObjectFingerprint(object): string`, `parseExactDecimal`, `multiplyExact`, `roundExact`, and `exactToString`.
- Produces:

```ts
export const P6_MEASUREMENT_RULE_VERSION = "P4_MEASUREMENT_V1" as const;
export const P6_MATERIAL_RULE_VERSION = "P6_MATERIAL_HANDOFF_V1" as const;
export type DrawingQuantityMeasurementKind = "length" | "area" | "count";
export type DrawingQuantityUnit = "EA" | "m" | "m2";
export type DrawingQuantityValue = {
  measurementKind: DrawingQuantityMeasurementKind;
  rawQuantity: string;
  unit: DrawingQuantityUnit;
  measurementRuleVersion: typeof P6_MEASUREMENT_RULE_VERSION;
};
export type DrawingQuantitySource = {
  quantityLinkId: string;
  revisionId: string;
  revisionVersion: number;
  snapshotSha256: string;
  objectId: string;
  lineageId: string;
  objectVersion: number;
  objectFingerprint: string;
  measurementKind: DrawingQuantityMeasurementKind;
  rawQuantity: string;
  unit: DrawingQuantityUnit;
  measurementRuleVersion: typeof P6_MEASUREMENT_RULE_VERSION;
  sourceAnchors: Array<{
    sourceFileId: string;
    sourceSha256: string;
    sourceKind: "pdf_region" | "ifc_element";
    pdfRegion: {
      pageNumber: number;
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
    ifcGlobalId: string | null;
  }>;
  issueLinks: Array<{ issueId: string }>;
};
export function drawingObjectFingerprintSha256(object: DrawingObject): string;
export function convertDrawingMeasurement(
  measurement: DrawingMeasurement,
  measurementKind: DrawingQuantityMeasurementKind,
): DrawingQuantityValue;
export type P6MaterialComponentInput = {
  boqVersionId: string;
  lineId: string;
  rateComponentId: string;
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceSpecification: string;
  resourceUnit: string;
  resourceCoefficient: string;
  finalQuantity: string;
};
export type P6MaterialPlanDerivation = {
  materialCode: string;
  materialName: string;
  specification: string;
  unit: string;
  designQuantity: string;
  allowanceRate: "0";
  requiredQuantity: string;
  ruleId: typeof P6_MATERIAL_RULE_VERSION;
  components: Array<{ rateComponentId: string; derivedDesignQuantity: string }>;
};
export function deriveP6MaterialPlans(
  components: readonly P6MaterialComponentInput[],
): P6MaterialPlanDerivation[];
```

- [ ] **Step 1: Write failing conversion, fingerprint, material, and no-volume tests**

```js
const measurement = {
  ruleVersion: "P4_MEASUREMENT_V1",
  lengthMillimeters: "1234.567891",
  areaSquareMillimeters: "2500000.123456",
  count: "1",
};
const unavailable = {
  ruleVersion: "P4_MEASUREMENT_V1",
  lengthMillimeters: null,
  areaSquareMillimeters: null,
  count: "1",
};
const wallObject = {
  id: "00000000-0000-4000-8000-000000000101",
  name: "W-01",
  layerId: "00000000-0000-4000-8000-000000000102",
  geometry: {
    type: "wall",
    semanticVersion: 1,
    start: { x: 0, y: 0 },
    end: { x: 1000, y: 0 },
    thicknessMillimeters: 200,
    heightMillimeters: 3000,
  },
  styleId: null,
  style: {},
  version: 1,
};
const materialA = {
  boqVersionId: "00000000-0000-4000-8000-000000000201",
  lineId: "00000000-0000-4000-8000-000000000202",
  rateComponentId: "00000000-0000-4000-8000-000000000203",
  resourceId: "00000000-0000-4000-8000-000000000204",
  resourceCode: "M-001",
  resourceName: "석고보드",
  resourceSpecification: "12.5T",
  resourceUnit: "m2",
  resourceCoefficient: "1.234567",
  finalQuantity: "10",
};
const materialB = {
  ...materialA,
  rateComponentId: "00000000-0000-4000-8000-000000000205",
  resourceCoefficient: "0.2962975",
};

test("P6 converts exact P4 measures without Number arithmetic", () => {
  assert.equal(
    convertDrawingMeasurement(measurement, "length").rawQuantity,
    "1.234567891",
  );
  assert.equal(
    convertDrawingMeasurement(measurement, "area").rawQuantity,
    "2.500000123456",
  );
  assert.equal(
    convertDrawingMeasurement(measurement, "count").rawQuantity,
    "1",
  );
  assert.throws(() => convertDrawingMeasurement(unavailable, "area"), /P6Q01/);
  assert.throws(
    () => convertDrawingMeasurement(measurement, "volume"),
    /P6Q01/,
  );
});

test("fingerprint is the SHA of canonical geometry id name and version", () => {
  const digest = drawingObjectFingerprintSha256(wallObject);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(
    digest,
    drawingObjectFingerprintSha256(structuredClone(wallObject)),
  );
  assert.notEqual(
    digest,
    drawingObjectFingerprintSha256({ ...wallObject, version: 2 }),
  );
});

test("material handoff groups exact final quantity times coefficient", () => {
  const [plan] = deriveP6MaterialPlans([materialA, materialB]);
  assert.equal(plan.designQuantity, "15.308642");
  assert.equal(plan.allowanceRate, "0");
  assert.equal(plan.ruleId, "P6_MATERIAL_HANDOFF_V1");
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd platform && node --test tests/drawing-quantity-lineage.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `drawing-quantity-lineage.ts`.

- [ ] **Step 3: Implement exact conversion and fingerprint digest**

```ts
export function convertDrawingMeasurement(measurement, kind) {
  if (measurement.ruleVersion !== P6_MEASUREMENT_RULE_VERSION)
    throw new P6LineageError("P6Q01", "지원하지 않는 측정 규칙입니다.");
  const source =
    kind === "length"
      ? measurement.lengthMillimeters
      : kind === "area"
        ? measurement.areaSquareMillimeters
        : kind === "count"
          ? measurement.count
          : null;
  if (source === null)
    throw new P6LineageError("P6Q01", "선택한 측정값을 확정할 수 없습니다.");
  const factor =
    kind === "length" ? "0.001" : kind === "area" ? "0.000001" : "1";
  return {
    measurementKind: kind,
    rawQuantity: exactToString(
      multiplyExact(parseExactDecimal(source), parseExactDecimal(factor)),
    ),
    unit: kind === "length" ? "m" : kind === "area" ? "m2" : "EA",
    measurementRuleVersion: P6_MEASUREMENT_RULE_VERSION,
  };
}

export function drawingObjectFingerprintSha256(object: DrawingObject) {
  return createHash("sha256")
    .update(drawingMeasurementObjectFingerprint(object), "utf8")
    .digest("hex");
}
```

Keep `drawingMeasurementObjectFingerprint()` returning its current canonical JSON string because P4 staleness checks compare that exact value.

- [ ] **Step 4: Implement deterministic material derivation**

Use `multiplyExact()` then `roundExact(value, 6, "half_away_from_zero")`. Reject negative/overflow input, duplicate component IDs, and mismatched code/name/spec/unit within a group. Sort groups bytewise by code/spec/unit and component rows by `rateComponentId`. Do not add allowance, density, carbon, volume, or unit conversion.

- [ ] **Step 5: Add boundary and 100-run assertions**

Cover zero, maximum precision, overflow, unavailable length/area, explicit `m3` rejection, six-place ties, mismatched grouping, and 100 identical serialized outputs.

- [ ] **Step 6: Run focused and regression tests**

```bash
cd platform
node --test tests/drawing-quantity-lineage.test.mjs tests/drawing-workspace-measurements.test.mjs tests/drawing-workspace-semantic-schedules.test.mjs tests/verified-boq.test.mjs
npm run typecheck
git diff --check
```

Expected: all tests PASS; current 1.0 BOQ SHA assertions remain unchanged.

- [ ] **Step 7: Commit**

```bash
git add platform/app/lukas/lib/drawing-quantity-lineage.ts platform/app/lukas/lib/drawing-semantic-schedules.ts platform/app/lukas/lib/material-control.server.ts platform/tests/drawing-quantity-lineage.test.mjs
git commit -m "feat: define drawing quantity lineage contracts"
```

### Task 2: Forward Migration, RLS, Grants, Fresh Install, and Upgrade

**Files:**

- Create: `platform/supabase/migrations/20260827210000_drawing_workspace_p6_lineage.sql`
- Create: `platform/tests/fixtures/drawing-workspace-p6-database-fixtures.mjs`
- Create: `platform/tests/drawing-workspace-p6-database-contract.test.mjs`
- Create: `platform/tests/drawing-workspace-p6-postgres-concurrency.test.mjs`
- Modify after real type generation only: `platform/database.types.ts`

**Interfaces:**

- Consumes: exact composite keys from `20260824110000_drawing_workspace_core.sql`, `20260827045411_drawing_workspace_p5_evidence_authority.sql`, `20260820025118_verified_boq_v1.sql`, current material tables, and `private.lukas_qto_project_role(uuid)`.
- Produces the three tables in spec sections 4.1–4.3 and exactly:

```text
private.lukas_drawing_insert_quantity_link(uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,numeric,text,text)
public.lukas_drawing_put_boq_link(uuid,uuid,uuid,uuid,numeric,bigint)
public.lukas_drawing_delete_boq_link(uuid,bigint)
public.lukas_qto_boq_v1_1_input(uuid)
private.lukas_qto_finalize_boq_v1_1(uuid,uuid,text,text,text,numeric,integer)
private.lukas_drawing_insert_material_handoff(uuid,uuid,text,uuid,text,jsonb,jsonb)
```

- [ ] **Step 1: Discover CLI and generate one forward migration**

```bash
cd platform
supabase --version
supabase migration new --help
supabase migration new drawing_workspace_p6_lineage
```

Expected: one CLI-created empty migration after `20260827102503_drawing_workspace_p5_revision_relink_authority.sql`. Rename that newly created empty file to the reserved exact path `supabase/migrations/20260827210000_drawing_workspace_p6_lineage.sql` before adding SQL; no historical migration changes.

- [ ] **Step 2: Write failing SQL-surface and populated-upgrade tests**

```js
test("P6 exposes exactly three companion tables and least privilege", () => {
  const sql = readP6Migration();
  for (const table of [
    "lukas_drawing_quantity_links",
    "lukas_drawing_boq_links",
    "lukas_drawing_material_links",
  ])
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
  assert.doesNotMatch(sql, /alter publication supabase_realtime add table/);
  assert.doesNotMatch(sql, /user_metadata/);
});

test("upgrade preserves P0-P5 and complete 1.0 rows", async () => {
  const before = await snapshotSeededP0P5Authority(db);
  await applyP6Migration(db);
  assert.deepEqual(await snapshotSeededP0P5Authority(db), before);
});
```

- [ ] **Step 3: Run and verify failure**

Run: `cd platform && node --test tests/drawing-workspace-p6-database-contract.test.mjs`

Expected: FAIL because the generated migration has no P6 schema.

- [ ] **Step 4: Add preflight and exact schema**

Fail before DDL when base columns/keys differ. Create exact numeric scales, kind/unit checks, three-table constraints, composite FKs, and indexes from spec section 4. Add `(id,version_id,project_id)` uniqueness to rate components; nullable checked `input_state_sha256`/`manifest_sha256`; and engine check allowing only 1.0/1.1. No backfill.

- [ ] **Step 5: Add immutable guards and BOQ-link RPCs**

```sql
create trigger lukas_drawing_quantity_links_immutable
before update or delete on public.lukas_drawing_quantity_links
for each row execute function private.lukas_drawing_reject_p6_immutable();
create trigger lukas_drawing_material_links_immutable
before update or delete on public.lukas_drawing_material_links
for each row execute function private.lukas_drawing_reject_p6_material_immutable();
```

Both link RPCs use `security definer set search_path=''`, lock version first, require authenticated maker role `owner|staff|estimator`, draft status, project/unit ancestry, factor `(0,1]`, total `<=1`, and exact `base_version`. Exact insert retry returns the row; mismatch/stale/status race raises `P6O01`.

- [ ] **Step 6: Add trusted quantity/finalize/material boundaries**

Quantity insert repeats approval, schema-v2, snapshot digest, exact object identity/geometry/fingerprint, active status, rule, kind/unit/value, and project checks. Finalize locks/recomputes input SHA then atomically freezes hashes/cost/count/status. Material input rejects unknown keys, over 10k links/2k plans, stale result, non-material resource, incompatible plan, and cross-project ancestry.

- [ ] **Step 7: Harden transition and decision authority**

In the new migration, preserve the 1.0 transition rule; require all three hashes for 1.1 submitted/approved/superseded; make decision recompute input SHA; reject approved child mutation; keep rejection append-only and return to draft.

- [ ] **Step 8: Add explicit RLS and grants**

Authenticated receives SELECT only on three tables. Service receives only required SELECT/INSERT. Public link RPCs grant execute to authenticated/service; private functions revoke from PUBLIC/anon/authenticated. Add project-role SELECT and existing verified-non-anonymous restrictive policies. Test old and 2026 opt-in default privileges.

- [ ] **Step 9: Run fresh/upgrade/adversarial PGlite**

Run: `cd platform && node --test tests/drawing-workspace-p6-database-contract.test.mjs`

Expected: PASS for `anon`, anonymous-sign-in, non-member, Viewer, Commenter, Reviewer, estimator, staff, owner, and service paths; Drawing `draft|review_requested|approved|superseded` with rejected/approved/missing decisions; BOQ `draft|in_review|approved|superseded` with rejection; every cross-project revision/object/snapshot/quantity/BOQ/line/component/resource/plan/file position; direct DML/function denial; wrong schema/version/SHA/fingerprint/rule/unit/value; partial/over/exact allocation; immutable service/table-owner attempts; exact/mismatched retries; and FK/index/grant/search-path/security-definer audits.

- [ ] **Step 10: Run real PostgreSQL proof or fail honestly**

Run: `cd platform && P6_REAL_POSTGRES_REQUIRED=1 node --test tests/drawing-workspace-p6-postgres-concurrency.test.mjs`

Expected with authority: PASS for submission/edit races, simultaneous submissions, retries, triggers, RLS, and index plans. Without authority: nonzero `P6 real PostgreSQL gate is UNEXECUTED`.

- [ ] **Step 11: Generate types only from applied real schema and check format**

Run with project authority: `cd platform && npm run db:typegen`. Without `SUPABASE_PROJECT_REF`, do not edit generated types; Task 3 uses a focused overlay and release evidence says `UNEXECUTED`.

Run: `cd platform && ./node_modules/.bin/prettier --check tests/fixtures/drawing-workspace-p6-database-fixtures.mjs tests/drawing-workspace-p6-*.test.mjs && git diff --check`

- [ ] **Step 12: Commit**

```bash
git add platform/supabase/migrations/*_drawing_workspace_p6_lineage.sql platform/tests/fixtures/drawing-workspace-p6-database-fixtures.mjs platform/tests/drawing-workspace-p6-database-contract.test.mjs platform/tests/drawing-workspace-p6-postgres-concurrency.test.mjs
git add platform/database.types.ts  # only if generated from the applied real schema
git commit -m "feat: enforce drawing quantity lineage authority"
```

### Task 3: Trusted Server Quantity Authority and Paginated Lineage

**Files:**

- Create: `platform/app/lukas/lib/drawing-quantity-lineage.server.ts`
- Create: `platform/tests/drawing-quantity-lineage-server.test.mjs`
- Modify: `platform/app/lukas/screens/drawing-workspace.tsx:46-214`
- Modify: `platform/app/lukas/lib/drawing-workspace.server.ts:1030-1065,1950-2000,2864`
- Test: `platform/tests/drawing-workspace-p6-route.test.mjs`

**Interfaces:**

- Consumes: Task 1 conversion/fingerprint, existing `deriveAuthorizedDrawingMeasurementEvidence`, Task 2 private insert, authenticated Supabase client, and the already installed `postgres` package with server-only `DATABASE_URL`.
- Produces:

```ts
export type P6LineageErrorCode =
  | "P6A01"
  | "P6Q01"
  | "P6Q02"
  | "P6Q03"
  | "P6U01"
  | "P6O01"
  | "P6B04"
  | "P6C01"
  | "P6M01"
  | "P6M02";
export class DrawingQuantityLineageServerError extends Error {
  readonly code: P6LineageErrorCode;
  readonly requestId: string;
}
export type CreateDrawingQuantityLinkInput = {
  projectId: string;
  drawingRevisionId: string;
  drawingObjectId: string;
  measurementKind: DrawingQuantityMeasurementKind;
  linkId: string;
};
export async function createDrawingQuantityLink(
  userClient: SupabaseClient,
  actorId: string,
  input: CreateDrawingQuantityLinkInput,
): Promise<DrawingQuantityLinkRow>;
export type DrawingQuantityLinkRow = {
  id: string;
  projectId: string;
  drawingRevisionId: string;
  drawingRevisionVersion: number;
  drawingSnapshotSha256: string;
  drawingObjectId: string;
  drawingObjectLineageId: string;
  drawingObjectVersion: number;
  objectFingerprint: string;
  measurementKind: DrawingQuantityMeasurementKind;
  rawQuantity: string;
  unit: DrawingQuantityUnit;
  measurementRuleVersion: "P4_MEASUREMENT_V1";
  createdBy: string;
  createdAt: string;
};
export type DrawingObjectQuantityLineageRow = {
  quantity: DrawingQuantityLinkRow;
  boqLinks: Array<{
    id: string;
    boqVersionId: string;
    boqVersionStatus: "draft" | "in_review" | "approved" | "superseded";
    boqLineId: string;
    itemCode: string;
    allocationFactor: string;
    version: number;
  }>;
};
export async function listDrawingObjectQuantityLineage(
  userClient: SupabaseClient,
  input: {
    projectId: string;
    revisionId: string;
    objectId: string;
    cursor: string | null;
    limit?: number;
  },
): Promise<{
  rows: DrawingObjectQuantityLineageRow[];
  nextCursor: string | null;
}>;
export async function resolveDrawingWorkspaceEntry(
  userClient: SupabaseClient,
  input: {
    projectId: string;
    revisionId: string;
    objectId: string;
    boqVersionId: string;
    boqLineId: string;
  },
): Promise<string>;
```

- [ ] **Step 1: Write failing server-boundary and form tests**

Accept only `intent`, stable link ID, revision ID, object ID, and measurement kind. Inject raw quantity, version, fingerprint, unit, final quantity, price, amount, and hashes and prove they are not forwarded.

```js
assert.deepEqual(adminRpc.args, {
  p_actor_id: actorId,
  p_id: linkId,
  p_revision_id: revisionId,
  p_object_id: objectId,
  p_measurement_kind: "area",
  p_snapshot_sha256: snapshot.sha256,
  p_object_lineage_id: object.lineageId,
  p_object_version: object.version,
  p_object_fingerprint: digest,
  p_raw_quantity: "12.5",
  p_unit: "m2",
  p_measurement_rule_version: "P4_MEASUREMENT_V1",
});
```

- [ ] **Step 2: Run and verify failure**

Run: `cd platform && node --test tests/drawing-quantity-lineage-server.test.mjs tests/drawing-workspace-p6-route.test.mjs`

Expected: FAIL on absent module/action.

- [ ] **Step 3: Implement approved snapshot/object/source authority**

Use the authenticated Supabase client to verify the access token/user. Open one direct `postgres` transaction from server-only `DATABASE_URL`, execute the static `set local role service_role`, and load the exact revision, approval, schema-v2 snapshot, document/file, canonical object, active source anchors, and issue links. Recompute snapshot SHA in that transaction, parse the strict snapshot, require one object, derive/convert measure, then call `private.lukas_drawing_insert_quantity_link` before commit. The private function repeats checks under locks. Never expose the raw client, accept a database URL from a request, use live draft rows, or derive from browser evidence. This avoids exposing the `private` schema through PostgREST while making the `service_role` grant executable and testable.

- [ ] **Step 4: Implement capability and bounded error mapping**

Allow Drawing admin/editor or project owner/staff/estimator. Deny Viewer, Commenter, Reviewer, anonymous, non-member, and cross-project with `P6A01`. Map only fixed P6 SQLSTATEs; log request ID and safe IDs, never SQL, keys, URLs, or bytes.

- [ ] **Step 5: Implement bounded lineage and exact route resolution**

Limit 1–200 with `(created_at,id)` cursor. Resolve authorized document, source file, revision, object, BOQ, and line, then return the exact workspace URL with document/revision/object/boq/line. If no source-file identity exists, call a document-entry resolver. Never fall back; return `연결된 도면 근거를 열 수 없습니다`.

- [ ] **Step 6: Wire route loader/action**

Loader requests at most 200 persisted rows. Action retains stable ID after unknown network outcome, calls server authority, and reloads before success. No Yjs/outbox/y-indexeddb write.

- [ ] **Step 7: Run focused and regressions**

```bash
cd platform
node --test tests/drawing-quantity-lineage-server.test.mjs tests/drawing-workspace-p6-route.test.mjs tests/drawing-workspace-server.test.mjs tests/drawing-workspace-p4-release.test.mjs tests/drawing-workspace-p5-server.test.mjs
npm run typecheck
git diff --check
```

Expected: PASS; browser form fields contain no server-derived values.

- [ ] **Step 8: Commit**

```bash
git add platform/app/lukas/lib/drawing-quantity-lineage.server.ts platform/app/lukas/lib/drawing-workspace.server.ts platform/app/lukas/screens/drawing-workspace.tsx platform/tests/drawing-quantity-lineage-server.test.mjs platform/tests/drawing-workspace-p6-route.test.mjs
git commit -m "feat: derive approved drawing quantities on server"
```

### Task 4: Verified BOQ 1.1 Adapter and Canonical Manifest

**Files:**

- Create: `platform/app/lukas/lib/verified-boq-v1-1.server.ts`
- Create: `platform/app/lukas/lib/verified-boq-manifest.server.ts`
- Modify only for shared type imports: `platform/app/lukas/lib/verified-boq.server.ts:13-114`
- Test: `platform/tests/verified-boq-v1-1.test.mjs`
- Test: `platform/tests/verified-boq.test.mjs`

**Interfaces:**

- Consumes: unchanged `calculateVerifiedBoq(input): VerifiedBoqResult`, existing exact-decimal functions, and Task 1 `DrawingQuantitySource`.
- Produces:

```ts
export const VERIFIED_BOQ_V1_1_ENGINE_VERSION = "VERIFIED-BOQ-1.1" as const;
export type VerifiedBoqDrawingMapping = {
  id: string;
  lineId: string;
  quantityLinkId: string;
  allocationFactor: string;
  source: DrawingQuantitySource;
};
export type VerifiedBoqV1_1Input = Omit<VerifiedBoqInput, "mappings"> & {
  engineVersion: typeof VERIFIED_BOQ_V1_1_ENGINE_VERSION;
  legacyMappings: BoqQuantityMapping[];
  drawingMappings: VerifiedBoqDrawingMapping[];
  priceBook: VerifiedBoqManifestPriceBook;
};
export type VerifiedBoqManifestPriceBook = {
  id: string;
  sourceFileId: string;
  sourceSha256: string;
  effectiveDate: string;
  rightsBasis: string;
};
export type VerifiedBoqV1_1Line = Omit<VerifiedBoqLine, "adjustment"> & {
  adjustment: string;
  adjustedQuantity: string | null;
  drawingQuantityLinkIds: string[];
};
export type VerifiedBoqV1_1Result = Omit<
  VerifiedBoqResult,
  "engineVersion" | "lines" | "canonicalSha256"
> & {
  engineVersion: typeof VERIFIED_BOQ_V1_1_ENGINE_VERSION;
  lines: VerifiedBoqV1_1Line[];
  canonicalSha256: string;
};
export type VerifiedBoqCalculationManifest = {
  schemaVersion: "1HK_VERIFIED_BOQ_MANIFEST_V1";
  engineVersion: "VERIFIED-BOQ-1.1";
  projectId: string;
  boqVersionId: string;
  inputStateSha256: string;
  calculationPolicy: BoqCalculationPolicy;
  quantityScale: number;
  drawingSources: DrawingQuantitySource[];
  legacySources: Array<{
    fileId: string;
    fileSha256: string;
    subjectKey: string;
    unit: "EA" | "m" | "m2" | "m3";
    sourceQuantity: string;
    elementIds: string[];
  }>;
  mappings: Array<{
    sourceKind: "legacy" | "drawing";
    sourceId: string;
    lineId: string;
    allocationFactor: string;
  }>;
  lines: Array<{
    lineId: string;
    itemCode: string;
    unit: string;
    signedAdjustment: string;
    adjustmentReason: string;
  }>;
  priceBook: VerifiedBoqManifestPriceBook;
  resources: Array<{
    id: string;
    code: string;
    type: string;
    unit: string;
    unitPriceKrw: string;
  }>;
  rateComponents: Array<{
    id: string;
    lineId: string;
    resourceId: string;
    coefficient: string;
  }>;
  rules: Array<{
    measurementRuleVersion: string;
    engineVersion: string;
    calculationPolicy: string;
    quantityScale: number;
  }>;
  result: {
    resultSha256: string;
    status: "calculated" | "review";
    directCostKrw: string;
    canonicalLines: VerifiedBoqV1_1Line[];
  };
};
export type VerifiedBoqApprovalEnvelope = {
  versionId: string;
  resultSha256: string;
  manifestSha256: string;
  decision: "approved";
  decidedBy: string;
  decidedAt: string;
  note: string;
};
export type VerifiedBoqHandoffManifest = {
  calculationManifest: VerifiedBoqCalculationManifest;
  approvalEnvelope: VerifiedBoqApprovalEnvelope;
  resultSha256: string;
  manifestSha256: string;
  handoffSha256: string;
  evidenceFiles: Array<{ fileId: string; sha256: string }>;
};
export function calculateVerifiedBoqV1_1(
  input: VerifiedBoqV1_1Input,
): VerifiedBoqV1_1Result;
export function calculateVerifiedBoqByEngine(
  input: VerifiedBoqInput | VerifiedBoqV1_1Input,
): VerifiedBoqResult | VerifiedBoqV1_1Result;
export function canonicalizeVerifiedBoqV1_1Input(
  input: VerifiedBoqV1_1Input,
): VerifiedBoqV1_1Input;
export function buildVerifiedBoqCalculationManifest(
  input: VerifiedBoqV1_1Input,
  result: VerifiedBoqV1_1Result,
  context: { projectId: string; inputStateSha256: string },
): {
  manifest: VerifiedBoqCalculationManifest;
  canonicalBytes: Uint8Array;
  manifestSha256: string;
};
export function buildVerifiedBoqHandoffManifest(
  calculation: VerifiedBoqCalculationManifest,
  approvalEnvelope: VerifiedBoqApprovalEnvelope,
): {
  manifest: VerifiedBoqHandoffManifest;
  canonicalBytes: Uint8Array;
  handoffSha256: string;
};
```

- [ ] **Step 1: Freeze current 1.0 golden bytes**

Add literal expected `JSON.stringify(result)`, `canonicalSha256`, CSV-byte SHA, and XLSX-byte SHA for representative 1.0 inputs. These are regression oracles; never update them to accommodate P6.

- [ ] **Step 2: Write failing mixed-input and manifest tests**

Cover legacy plus Drawing sources, exact split factors, raw/adjustment/adjusted/final separation, negative adjusted failure, source ordering, anchors/issues, result SHA, manifest SHA, approval-envelope handoff SHA, 100-run determinism, locale/time/random independence, and unavailable engine rejection.

- [ ] **Step 3: Run and verify failure**

Run: `cd platform && node --test tests/verified-boq-v1-1.test.mjs tests/verified-boq.test.mjs`

Expected: 1.0 PASS; 1.1 FAIL with missing module/exports.

- [ ] **Step 4: Implement the 1.1 adapter by reusing the exact engine core**

Adapt Drawing input only in memory and keep source kind explicit:

```ts
const adaptedDrawing = input.drawingMappings.map(
  ({ id, lineId, allocationFactor, source }) => ({
    id: `drawing:${id}`,
    lineId,
    sourceKind: "drawing" as const,
    sourceId: source.quantityLinkId,
    sourceSha256: source.snapshotSha256,
    sourceQuantity: source.rawQuantity,
    factor: allocationFactor,
    unit: source.unit,
  }),
);
```

Do not weaken 1.0 positive Element-ID checks. Extract a shared internal calculation core only if needed; the exported 1.0 path/order stays byte-identical. `adjustedQuantity` is exact `raw + signedAdjustment` before rounding; `finalQuantity` stays rounded.

- [ ] **Step 5: Implement canonical input/result/manifest hashes**

Construct fixed-field-order objects and bytewise-sort all arrays/maps/sets. `JSON.stringify` only after construction. `canonicalizeVerifiedBoqV1_1Input()` normalizes engine input but does not invent the database input-state digest. The manifest builder requires the exact `inputStateSha256` returned by `lukas_qto_boq_v1_1_input`; SQL tests independently prove it is the hash of the locked Postgres-canonical payload. Exclude `manifestSha256` from its own digest. Use schema `1HK_VERIFIED_BOQ_MANIFEST_V1` with every field in spec 6.4. Keep approval in a separate envelope; `handoffSha256` binds calculation/result hashes, exact decision, approver/time, and file hashes.

- [ ] **Step 6: Implement exact failure contracts**

Drawing factors total exactly `1`; mixed sources aggregate by line; units match; IDs are unique; Drawing `m3` fails `P6U01`; every submission line calculates. An unmapped Drawing source is absent from input, not an exclusion.

- [ ] **Step 7: Run deterministic regressions**

```bash
cd platform
node --test tests/verified-boq-v1-1.test.mjs tests/verified-boq.test.mjs tests/drawing-quantity-lineage.test.mjs
npm run typecheck
git diff --check
```

Expected: PASS, including byte-identical 1.0 and 100 identical 1.1 hashes.

- [ ] **Step 8: Commit**

```bash
git add platform/app/lukas/lib/verified-boq-v1-1.server.ts platform/app/lukas/lib/verified-boq-manifest.server.ts platform/app/lukas/lib/verified-boq.server.ts platform/tests/verified-boq-v1-1.test.mjs platform/tests/verified-boq.test.mjs
git commit -m "feat: calculate verified BOQ 1.1 lineage"
```

### Task 5: BOQ Mapping, Compare-and-Freeze Actions, and Lineage UI

**Files:**

- Modify: `platform/app/lukas/lib/drawing-quantity-lineage.server.ts`
- Modify: `platform/app/lukas/screens/verified-boq.tsx:45-142,306-445,448-707,708-1335,1980-2350`
- Create: `platform/app/lukas/components/verified-boq-drawing-sources.tsx`
- Create: `platform/app/lukas/components/drawing-quantity-inspector.tsx`
- Modify: `platform/app/lukas/components/drawing-inspector.tsx:31-57,162-184`
- Modify: `platform/app/lukas/components/drawing-workspace.tsx:741-787,4117-4118,4755-4772`
- Test: `platform/tests/drawing-workspace-p6-route.test.mjs`
- Test: `platform/tests/drawing-quantity-lineage-server.test.mjs`
- Test: `platform/tests/verified-boq-v1-1.test.mjs`

**Interfaces:**

- Consumes: Task 2 public link/input RPCs and private finalize; Task 3 coordinator; Task 4 engine/manifest.
- Produces:

```ts
export type PutDrawingBoqLinkInput = {
  id: string;
  quantityLinkId: string;
  boqVersionId: string;
  boqLineId: string;
  allocationFactor: string;
  baseVersion: number | null;
};
export async function putDrawingBoqLink(
  userClient: SupabaseClient,
  input: PutDrawingBoqLinkInput,
): Promise<DrawingBoqLinkRow>;
export async function deleteDrawingBoqLink(
  userClient: SupabaseClient,
  input: { id: string; baseVersion: number },
): Promise<void>;
export async function submitVerifiedBoqV1_1(
  userClient: SupabaseClient,
  actorId: string,
  versionId: string,
): Promise<{ resultSha256: string; manifestSha256: string }>;
export async function recheckAndDecideVerifiedBoqV1_1(
  userClient: SupabaseClient,
  actorId: string,
  input: {
    versionId: string;
    decision: "approved" | "rejected" | "deferred";
    note: string;
  },
): Promise<void>;
```

- [ ] **Step 1: Write failing action/OCC/UI tests**

Test put/delete/submit/decision with valid and injected fields. Browser sends IDs, factor, and `base_version` only. Test partial draft display, over-allocation, exact split, stale edit, retry, submit race, uncalculated line, unit mismatch, maker-only edit, independent approval, Viewer, and cross-project requests. Inspector labels browser measure `미리보기` and persisted row `확정 근거`.

- [ ] **Step 2: Run and verify failure**

Run: `cd platform && node --test tests/drawing-workspace-p6-route.test.mjs tests/drawing-quantity-lineage-server.test.mjs tests/verified-boq-v1-1.test.mjs`

Expected: FAIL on absent actions/components and legacy direct submit.

- [ ] **Step 3: Add persisted engine dispatch and bounded loader**

Load `engine_version,input_state_sha256,manifest_sha256`. For 1.0 use current calculation. For 1.1, call `lukas_qto_boq_v1_1_input`, parse strict fixed fields, and dispatch Task 4. Load at most 200 Drawing sources/links; keep legacy sources separate.

- [ ] **Step 4: Add public link actions with retained identity**

Use strict UUID/decimal/int schemas. Keep stable link ID after unknown result. Do not label saved before acknowledgment/reload. `P6O01` shows bounded Korean conflict/current version. No optimistic calculation, outbox, Yjs, or Awareness.

- [ ] **Step 5: Implement compare-and-freeze submission**

Call the input RPC, authorize maker, calculate result/manifest, require every line calculated, then call private finalize with actor/version/input SHA/result SHA/manifest SHA/cost/count. Input changes before lock raise `P6O01`; reload, never finalize stale output.

- [ ] **Step 6: Implement decision recheck**

Reload frozen input, rerun result/manifest, compare all hashes, then call existing `lukas_qto_decide_boq`. Mismatch is `P6C01`; database independently checks input SHA and maker/approver separation.

- [ ] **Step 7: Render distinct quantities and mapping UI**

Columns are exactly `원수량`, `보정값`, `보정 후 수량`, `최종수량`, rate groups, amount. Source UI shows immutable object/snapshot/rule/unit/value, factor total, allocations, OCC version, and unmapped sources. It never copies quantity into form state. Desktop maps; tablet/mobile read/review.

- [ ] **Step 8: Render Drawing quantity inspector**

For one semantic object show approval, short SHA, name/type/lineage/version, available length/area/count, persisted sources, mapped BOQ rows, and BOQ link. Never show `m3`; approved geometry remains immutable.

- [ ] **Step 9: Run focused and full route/build regressions**

```bash
cd platform
node --test tests/drawing-workspace-p6-route.test.mjs tests/drawing-quantity-lineage-server.test.mjs tests/verified-boq-v1-1.test.mjs tests/verified-boq.test.mjs tests/drawing-workspace-server.test.mjs tests/drawing-workspace-p4-release.test.mjs
npm run typecheck
npm run build
git diff --check
```

Expected: PASS; 1.0 workflow/output remains unchanged.

- [ ] **Step 10: Commit**

```bash
git add platform/app/lukas/lib/drawing-quantity-lineage.server.ts platform/app/lukas/screens/verified-boq.tsx platform/app/lukas/components/verified-boq-drawing-sources.tsx platform/app/lukas/components/drawing-quantity-inspector.tsx platform/app/lukas/components/drawing-inspector.tsx platform/app/lukas/components/drawing-workspace.tsx platform/tests/drawing-workspace-p6-route.test.mjs platform/tests/drawing-quantity-lineage-server.test.mjs platform/tests/verified-boq-v1-1.test.mjs
git commit -m "feat: map drawing quantities into verified BOQ"
```

### Task 6: Five-Cause Comparison and Bidirectional Evidence Navigation

**Files:**

- Create: `platform/app/lukas/lib/verified-boq-comparison-v1-1.server.ts`
- Create: `platform/app/lukas/components/verified-boq-comparison.tsx`
- Modify: `platform/app/lukas/screens/verified-boq.tsx:448-707,2100-2300`
- Modify: `platform/app/lukas/lib/drawing-workspace-view.ts:1-220`
- Modify: `platform/app/lukas/lib/drawing-workspace.server.ts:2864`
- Modify: `platform/app/lukas/screens/drawing-workspace.tsx:46-140`
- Test: `platform/tests/verified-boq-v1-1.test.mjs`
- Test: `platform/tests/drawing-workspace-p6-route.test.mjs`

**Interfaces:**

- Consumes: Task 3 authorized workspace resolver and Task 4 replayable 1.0/1.1 states.
- Produces:

```ts
export type VerifiedBoqCause =
  "RAW" | "MAPPING" | "ADJUSTMENT" | "PRICE" | "FORMULA";
export type VerifiedBoqCauseDelta = {
  cause: VerifiedBoqCause;
  amountDeltaKrw: string;
};
export type VerifiedBoqV1_1ComparisonRow = {
  itemCode: string;
  rowState: "added" | "removed" | "changed" | "unchanged";
  causes: VerifiedBoqCauseDelta[];
  previousAmountKrw: string;
  currentAmountKrw: string;
  amountDeltaKrw: string;
};
export type VerifiedBoqV1_1Comparison = {
  status: "comparable" | "review";
  rows: VerifiedBoqV1_1ComparisonRow[];
  amountDeltaKrw: string;
  causeAmountDeltaKrw: string;
  rowAmountDeltaKrw: string;
  amountCloses: boolean;
  message: string;
};
export type ReplayableApprovedBoqState = {
  engineVersion: "VERIFIED-BOQ-1.0" | "VERIFIED-BOQ-1.1";
  status: "approved" | "superseded";
  approvedDecision: { decidedBy: string; createdAt: string };
  input: VerifiedBoqInput | VerifiedBoqV1_1Input;
  result: VerifiedBoqResult | VerifiedBoqV1_1Result;
};
export function compareVerifiedBoqApprovedStates(
  previous: ReplayableApprovedBoqState,
  current: ReplayableApprovedBoqState,
): VerifiedBoqV1_1Comparison;
```

- [ ] **Step 1: Write failing cause and navigation tests**

Test each cause, combinations, added/removed, 1.0-to-1.1 FORMULA, missing engine, invalid counterfactual, duplicate item code, exact closure, multiple visible causes, cross-project denial, and no fallback.

- [ ] **Step 2: Run and verify failure**

Run: `cd platform && node --test tests/verified-boq-v1-1.test.mjs tests/drawing-workspace-p6-route.test.mjs`

Expected: FAIL on absent comparator/focus query.

- [ ] **Step 3: Implement deterministic waterfall**

Replay persisted engines. For each item code calculate:

```text
previous -> RAW -> MAPPING -> ADJUSTMENT -> PRICE -> FORMULA -> current
```

Apply current category while later categories retain previous values, rerun exact engine, subtract prior step, and require cause sum = row sum = direct-cost delta. Unavailable engine/input, ambiguous identity, invalid counterfactual, or failed closure returns `review` without explanation claim.

- [ ] **Step 4: Implement authorized BOQ-to-Drawing navigation**

Build links from server ancestry only. Parse UUID `revision/object/boq/line`. Load exact revision, page/canvas, select and fit object, open quantity/source inspector, and focus PDF/IFC evidence. Missing/unauthorized returns `연결된 도면 근거를 열 수 없습니다`; never fallback.

- [ ] **Step 5: Render cause filters and closure**

Show five filters, added/removed states, every cause per row, cause/row/total deltas and closure. Do not choose a primary cause. Use loader-returned authorized URLs.

- [ ] **Step 6: Run comparison/navigation/IFC/PDF regressions**

```bash
cd platform
node --test tests/verified-boq-v1-1.test.mjs tests/drawing-workspace-p6-route.test.mjs tests/drawing-workspace-p5-view.test.mjs tests/drawing-ifc-focus.test.mjs tests/drawing-pdf-transform.test.mjs tests/drawing-anchor-navigation.test.mjs
npm run typecheck
npm run build
git diff --check
```

Expected: PASS with exact closure and existing navigation unchanged.

- [ ] **Step 7: Commit**

```bash
git add platform/app/lukas/lib/verified-boq-comparison-v1-1.server.ts platform/app/lukas/components/verified-boq-comparison.tsx platform/app/lukas/screens/verified-boq.tsx platform/app/lukas/lib/drawing-workspace-view.ts platform/app/lukas/lib/drawing-workspace.server.ts platform/app/lukas/screens/drawing-workspace.tsx platform/tests/verified-boq-v1-1.test.mjs platform/tests/drawing-workspace-p6-route.test.mjs
git commit -m "feat: explain and navigate BOQ revisions"
```

### Task 7: Approved CSV, XLSX, and Verifiable Manifest

**Files:**

- Create: `platform/app/lukas/lib/verified-boq-approved-export.server.ts`
- Modify: `platform/app/lukas/lib/verified-boq-xlsx.server.ts:5-90`
- Modify: `platform/app/lukas/screens/verified-boq.tsx:448-707`
- Modify: `platform/app/lukas/lib/drawing-quantity-lineage.server.ts`
- Test: `platform/tests/verified-boq-v1-1.test.mjs`
- Test: `platform/tests/drawing-quantity-lineage-server.test.mjs`

**Interfaces:**

- Consumes: Task 4 result/calculation/handoff builders and Task 5 authoritative reload/recalculation.
- Produces:

```ts
export type ApprovedVerifiedBoqExport = {
  resultSha256: string;
  manifestSha256: string;
  handoffSha256: string;
  csv: Uint8Array;
  xlsx: Uint8Array;
  manifestJson: Uint8Array;
};
export type VerifiedBoqWorkbookDrawingEvidence = {
  itemCode: string;
  quantityLinkId: string;
  revisionId: string;
  revisionVersion: number;
  snapshotSha256: string;
  objectId: string;
  lineageId: string;
  objectVersion: number;
  objectFingerprint: string;
  measurementKind: DrawingQuantityMeasurementKind;
  unit: DrawingQuantityUnit;
  rawQuantity: string;
  allocationFactor: string;
  measurementRuleVersion: "P4_MEASUREMENT_V1";
  sourceAnchorIds: string[];
  sourceFileSha256: string[];
  issueIds: string[];
};
export function buildApprovedVerifiedBoqExport(input: {
  result: VerifiedBoqV1_1Result;
  calculationManifest: VerifiedBoqCalculationManifest;
  approvalEnvelope: VerifiedBoqApprovalEnvelope;
  resources: VerifiedBoqWorkbookInput["resources"];
  legacyMappings: VerifiedBoqWorkbookInput["mappings"];
  drawingEvidence: VerifiedBoqWorkbookDrawingEvidence[];
  structures: VerifiedBoqWorkbookInput["structures"];
  review: VerifiedBoqWorkbookInput["review"];
}): ApprovedVerifiedBoqExport;
export async function loadApprovedVerifiedBoqExport(
  userClient: SupabaseClient,
  actorId: string,
  versionId: string,
): Promise<ApprovedVerifiedBoqExport>;
```

- [ ] **Step 1: Write failing approved-only round-trip tests**

Test draft/in-review/rejected denial; approved and independently approved superseded success; stale input/result/manifest denial; BOM CSV; leading-zero codes; Korean; exact decimals; `= + - @` injection; no XLSX formulas; five current sheets plus `도면근거` and `승인·매니페스트`; canonical JSON; same result/handoff SHA in every output.

- [ ] **Step 2: Run and verify failure**

Run: `cd platform && node --test tests/verified-boq-v1-1.test.mjs tests/drawing-quantity-lineage-server.test.mjs`

Expected: FAIL on absent approved export and Drawing sheet.

- [ ] **Step 3: Implement authoritative reload/hash recheck**

Require approved/superseded with its own approved decision. Reload frozen input, rerun engine, rebuild both manifests, compare stored input/result/manifest hashes. Mismatch throws `P6C01`; return no bytes.

- [ ] **Step 4: Build CSV and manifest bytes**

CSV has BOM and one row per line with raw/adjustment/adjusted/final, rates/amount, Drawing link/revision/snapshot/object/lineage/fingerprint/rule/anchor/issue IDs/hashes, legacy Element IDs, and three hashes. Protect user cells. Manifest is canonical UTF-8 with calculation manifest, approval envelope, handoff SHA, and source/file hashes.

- [ ] **Step 5: Extend XLSX without changing 1.0 bytes**

With Drawing/manifest fields absent, execute current five-sheet path byte-for-byte. When present, append `도면근거` and `승인·매니페스트`, inline values only, same three hashes.

- [ ] **Step 6: Wire existing download query**

Support `download=csv|xlsx|manifest`. Draft/in-review may preview on screen but cannot download. Return private no-store, exact content types, safe ASCII filenames. Signed URLs/storage paths never enter hashes.

- [ ] **Step 7: Reopen artifacts and run regressions**

```bash
cd platform
node --test tests/verified-boq-v1-1.test.mjs tests/drawing-quantity-lineage-server.test.mjs tests/verified-boq.test.mjs
npm run typecheck
npm run build
git diff --check
```

Expected: parsed CSV/XLSX/JSON fields and hashes survive, evidence bytes/SHA remain identical, and 1.0 export bytes stay fixed.

- [ ] **Step 8: Commit**

```bash
git add platform/app/lukas/lib/verified-boq-approved-export.server.ts platform/app/lukas/lib/verified-boq-xlsx.server.ts platform/app/lukas/screens/verified-boq.tsx platform/app/lukas/lib/drawing-quantity-lineage.server.ts platform/tests/verified-boq-v1-1.test.mjs platform/tests/drawing-quantity-lineage-server.test.mjs
git commit -m "feat: export approved BOQ lineage artifacts"
```

### Task 8: Approved BOQ Material Handoff and Existing Control Ledger

**Files:**

- Modify: `platform/app/lukas/lib/drawing-quantity-lineage.server.ts`
- Modify: `platform/app/lukas/lib/material-control.server.ts:1-216`
- Modify: `platform/app/lukas/lib/storage-object-key.server.ts:1-49`
- Modify: `platform/app/lukas/screens/material-control.tsx:326-735,760-1140`
- Create: `platform/app/lukas/components/material-boq-lineage.tsx`
- Test: `platform/tests/drawing-quantity-lineage-server.test.mjs`
- Test: `platform/tests/verified-boq-v1-1.test.mjs`
- Test: `platform/tests/drawing-workspace-p6-route.test.mjs`

**Interfaces:**

- Consumes: Task 1 material derivation, Task 7 approved manifest bytes, Task 2 private handoff.
- Produces:

```ts
export type CreateP6MaterialHandoffInput = {
  projectId: string;
  boqVersionId: string;
  operationId: string;
  selectedRateComponentIds: string[];
};
export async function createP6MaterialHandoff(
  userClient: SupabaseClient,
  actorId: string,
  input: CreateP6MaterialHandoffInput,
): Promise<{
  manifestFileId: string;
  materialPlanIds: string[];
  materialLinkIds: string[];
}>;
export function boqManifestStorageObjectPath(input: {
  ownerId: string;
  projectId: string;
  handoffSha256: string;
}): string;
export async function listMaterialBoqLineage(
  userClient: SupabaseClient,
  input: {
    projectId: string;
    materialPlanId?: string;
    boqLineId?: string;
    cursor: string | null;
    limit?: number;
  },
): Promise<{ rows: MaterialBoqLineageRow[]; nextCursor: string | null }>;
export type MaterialBoqLineageRow = {
  boqVersionId: string;
  boqResultSha256: string;
  boqLineId: string;
  itemCode: string;
  rateComponentId: string;
  materialResourceId: string;
  materialPlanId: string;
  derivedDesignQuantity: string;
  materialPlan: MaterialPlan;
  transactions: MaterialTransaction[];
  carbonFactors: CarbonFactor[];
  manifestFileId: string;
  manifestFileSha256: string;
};
```

- [ ] **Step 1: Write failing handoff/traversal tests**

Cover approved-only, distinct approval, material resource, price-book ownership, code/name/spec/unit match, exact final times coefficient, grouping/rounding, zero allowance, no carbon/density/volume inference, exact/mismatched retry, stale hashes, manifest upload/re-download, incompatible plan, later-version new plan, and reverse PO/receipt/installation/return/waste/invoice/factor/file traversal.

- [ ] **Step 2: Run and verify failure**

Run: `cd platform && node --test tests/drawing-quantity-lineage-server.test.mjs tests/verified-boq-v1-1.test.mjs tests/drawing-workspace-p6-route.test.mjs`

Expected: FAIL on absent handoff and lineage UI.

- [ ] **Step 3: Recalculate approved BOQ and material rows**

Call Task 7 authority; select authoritative components by submitted IDs; require material type, same version/line/project/price book, exact unit, positive coefficient. Browser sends IDs only.

- [ ] **Step 4: Persist and rehash manifest**

Add `boqManifestStorageObjectPath()` using validated lowercase UUID owner/project segments and exact lowercase 64-hex digest, returning `${ownerId}/${projectId}/boq-manifests/${handoffSha256}.manifest.json`. Use that deterministic ASCII path in private `lukas-qto`, a stable UUID file ID, exact canonical bytes, immutable `lukas_qto_files(kind='other')`, then re-download and hash. Unreferenced upload is a recoverable orphan; add no queue/artifact table.

- [ ] **Step 5: Insert plans/links atomically**

Send strict stable-ID JSON. Plans use exact resource identity/unit, grouped design, allowance `0`, required=design, rule, and manifest file/SHA. Links bind exact result/line/component/resource/plan/derived quantity. Exact retry returns rows; mismatch fails. Old plans/orders/receipts never mutate.

- [ ] **Step 6: Add bounded UI/action**

Action accepts only `intent=boq_handoff`, version ID, operation ID, and repeated component IDs. UI shows `BOQ line -> material resource -> plan -> PO -> receipt/site event -> carbon factor/file SHA`, explicit partial/missing carbon, 200 rows/cursor. Procurement/site permissions gain no BOQ/Drawing write.

- [ ] **Step 7: Run material and build regressions**

```bash
cd platform
node --test tests/drawing-quantity-lineage-server.test.mjs tests/verified-boq-v1-1.test.mjs tests/drawing-workspace-p6-route.test.mjs tests/verified-boq.test.mjs
node --test --test-name-pattern='material|purchase|receipt|carbon' tests/*.test.mjs
npm run typecheck
npm run build
git diff --check
```

Expected: PASS with existing material transaction/carbon authority unchanged.

- [ ] **Step 8: Commit**

```bash
git add platform/app/lukas/lib/drawing-quantity-lineage.server.ts platform/app/lukas/lib/material-control.server.ts platform/app/lukas/lib/storage-object-key.server.ts platform/app/lukas/screens/material-control.tsx platform/app/lukas/components/material-boq-lineage.tsx platform/tests/drawing-quantity-lineage-server.test.mjs platform/tests/verified-boq-v1-1.test.mjs platform/tests/drawing-workspace-p6-route.test.mjs
git commit -m "feat: hand approved BOQ materials to control ledger"
```

### Task 9: End-to-End Workflow, Performance, Release Gates, and License Closure

**Files:**

- Create: `platform/e2e/drawing-workspace-p6.spec.ts`
- Create: `platform/e2e/drawing-workspace-p6-production.spec.ts`
- Create: `platform/playwright.p6-release.config.ts`
- Create: `platform/scripts/drawing-p6-performance-evidence.mjs`
- Create: `platform/scripts/drawing-p6-performance-evidence.d.mts`
- Create: `platform/scripts/drawing-p6-release-evidence.mjs`
- Create: `platform/scripts/drawing-p6-release-evidence.d.mts`
- Create: `platform/scripts/run-drawing-workspace-p6-release.mjs`
- Create: `platform/tests/drawing-workspace-p6-release.test.mjs`
- Modify: `platform/package.json`
- Modify: `platform/THIRD_PARTY_NOTICES.md`
- Record: `.superpowers/sdd/2026-08-27-drawing-workspace-p6/`

**Interfaces:**

- Consumes: Tasks 1–8 and all P0–P5 release commands.
- Produces:

```ts
export type DrawingP6GateStatus = "PASS" | "NOT MET" | "UNEXECUTED";
export type DrawingP6ReleaseEvidence = {
  schemaVersion: 1;
  phase: "local" | "production";
  commit: string;
  migrationIds: string[];
  generatedAt: string;
  authorities: Record<string, DrawingP6GateStatus>;
  hashes: Record<string, string>;
  metrics: {
    calculationManifestP95Ms: number | null;
    comparisonP95Ms: number | null;
    lineageP95Ms: number | null;
    peakRssMiB: number | null;
    repeatedRuns: number;
  };
  gates: Record<string, DrawingP6GateStatus>;
};
export function p6LocalReleaseManifest(): ReleaseGate[];
export type ReleaseGate = { label: string; argv: string[] };
export type P6ProductionAuthority = {
  baseUrl: URL;
  supabaseUrl: URL;
  postgresUrl: string;
  storageCorsOrigin: string;
  deploymentId: string;
  commit: string;
  backupId: string;
  makerEmail: string;
  approverEmail: string;
  attackerEmail: string;
  projectId: string;
  drawingRevisionId: string;
  boqVersionId: string;
  materialPlanId: string;
};
export function requireP6ProductionAuthorities(
  environment: NodeJS.ProcessEnv,
): P6ProductionAuthority;
```

- [ ] **Step 1: Add exact fflate notice and failing license assertion**

```markdown
| fflate | 0.8.3 | https://github.com/101arrowz/fflate | MIT | No | npm | Formula-free Verified BOQ XLSX ZIP generation |
```

Assert exact notice and no dependency/lockfile changes relative to Task 8.

- [ ] **Step 2: Write failing release/production authority tests**

```js
assert.throws(
  () => requireP6ProductionAuthorities({}),
  /P6 production gate is UNEXECUTED/,
);
const run = spawnSync(
  "node",
  ["scripts/run-drawing-workspace-p6-release.mjs", "production"],
  {
    cwd: platformRoot,
    env: cleanEnvironment,
  },
);
assert.notEqual(run.status, 0);
```

Require hosted URL/anon/service, real PostgreSQL, backup ID, two distinct users, cross-org attacker, project/drawing/BOQ/material fixture IDs, private bucket/CORS, deployment ID, and commit. Missing one is nonzero `UNEXECUTED`.

- [ ] **Step 3: Run and verify failure**

Run: `cd platform && node --test tests/drawing-workspace-p6-release.test.mjs`

Expected: FAIL on absent scripts/config/evidence.

- [ ] **Step 4: Build mounted local vertical**

Prove: Drawing approval/source hash invariance; wall/space/opening length/area/count; Viewer/cross-project denial; map/split/OCC/reverse navigation; submit/reject/edit/resubmit/distinct approval; exact Drawing/PDF/IFC focus; successor with all five closed causes; export reopen/hash; material plan/link; PO/receipt/installation/waste/carbon; object-to-carbon and reverse traversal; every source file re-download/hash before/after.

- [ ] **Step 5: Add two-context and network uncertainty**

Committed mapping/status/approval appears after bounded reload/invalidation. Simultaneous edits yield one commit and one `P6O01`, never Yjs merge. Abort response after commit, retry stable identity, and return exact existing row without local approved state.

- [ ] **Step 6: Implement exact 10k/10k/2k performance evidence**

Record cold/warm wall time, CPU, peak RSS, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`, rows, response/output bytes for source page, calculation/manifest, comparison, exports, object-to-BOQ, and material lineage. Run 100 identical hashes/bytes. A smaller fixture, scan, N+1, response >200, threshold miss, or nondeterminism is nonzero `NOT MET`.

- [ ] **Step 7: Implement release scripts**

Add only these package scripts:

```json
{
  "test:e2e:drawing-workspace-p6:local": "P6_RELEASE_PRODUCTION_BUILD=1 playwright test e2e/drawing-workspace-p6.spec.ts --config=playwright.p6-release.config.ts --project=chromium --workers=1",
  "test:e2e:drawing-workspace-p6:production": "playwright test e2e/drawing-workspace-p6-production.spec.ts --project=chromium --workers=1",
  "release:drawing-workspace-p6:local": "node scripts/run-drawing-workspace-p6-release.mjs local",
  "release:drawing-workspace-p6:production": "node scripts/run-drawing-workspace-p6-release.mjs production"
}
```

Local composes P5 local release, P6 pure/DB/server, real-PG-required, production-build E2E, performance, license, typechecks, build, Prettier, diff. Production composes hosted fresh/upgrade/RLS/locks/advisors/backup, deployed two-user/attacker/Storage/CORS/signed URL, actual maker/approver, and deployed rerun hashes.

- [ ] **Step 8: Run local release**

Run: `cd platform && npm run release:drawing-workspace-p6:local`

Expected with all local authorities/thresholds: exit 0 and commit-bound PASS evidence. Without real PG: nonzero `UNEXECUTED`. Threshold miss: nonzero `NOT MET`. Never weaken runner.

- [ ] **Step 9: Prove production fail-closed without credentials**

Run the production-authority unit test with its sanitized environment helper: `cd platform && node --test --test-name-pattern='production authority fails closed' tests/drawing-workspace-p6-release.test.mjs`

Expected: nonzero and `UNEXECUTED` for hosted migration/RLS/concurrency/advisors, backup restore, users/attacker, deployed route, Storage/CORS/signed URL, maker/approver, production metrics, and deployed export.

- [ ] **Step 10: Run complete regression/build/license matrix**

```bash
cd platform
node --test tests/*.test.mjs
npm run test:ifc
npm run typecheck
npm run typecheck:collaboration
npm run build
./node_modules/.bin/prettier --check "app/**/*.{ts,tsx,js,jsx,json,css,md,mdx}" "tests/**/*.mjs" "scripts/**/*.{mjs,mts}" "../docs/superpowers/specs/2026-08-27-drawing-workspace-p6-design.md" "../docs/superpowers/plans/2026-08-27-drawing-workspace-p6.md"
git diff --check
```

Expected: locally executable regressions PASS; dependency/lockfile and collaboration schema/database version unchanged; production remains `UNEXECUTED` until executed. Use repository-installed binaries or npm scripts only; do not invoke `npx`, `pnpm`, or another package manager that can create a lockfile/workspace artifact.

- [ ] **Step 11: Audit generated evidence**

Require commit, migration IDs, Node/browser/Postgres, machine/region, cold/warm, timestamps, row/byte counts, plans, p95/RSS, repeated hashes, before/after source hashes, and each status. Local `CODE_GO` requires local PASS. P6/P0–P7 is not release-complete with any required production `UNEXECUTED` or threshold `NOT MET`.

- [ ] **Step 12: Commit**

```bash
git add platform/e2e/drawing-workspace-p6.spec.ts platform/e2e/drawing-workspace-p6-production.spec.ts platform/playwright.p6-release.config.ts platform/scripts/drawing-p6-performance-evidence.mjs platform/scripts/drawing-p6-performance-evidence.d.mts platform/scripts/drawing-p6-release-evidence.mjs platform/scripts/drawing-p6-release-evidence.d.mts platform/scripts/run-drawing-workspace-p6-release.mjs platform/tests/drawing-workspace-p6-release.test.mjs platform/package.json platform/THIRD_PARTY_NOTICES.md .superpowers/sdd/2026-08-27-drawing-workspace-p6
git commit -m "test: verify drawing workspace P6 lineage"
```

## Final Evidence Contract

- `LOCAL PASS` requires pure contracts, 1.0 byte goldens, 1.1 100-run hashes, PGlite fresh/upgrade, real PostgreSQL RLS/locks/indexes, trusted server, mounted flow, two-context OCC, byte invariance, export reopen, material/order/receipt/carbon traversal, P0–P5 regressions, both typechecks, build, Prettier, diff, and license.
- `LOCAL NOT MET` covers any performance, scan, N+1, bound, RSS, closure, byte mutation, or deterministic-hash failure.
- `PRODUCTION PASS` requires hosted fresh/upgrade, RLS/concurrency/advisors, backup/restore, deployed private Storage/CORS/signed URL, two users, attacker, actual maker/approver, persisted lineage, re-download/hash, deterministic deployed rerun/export, and deployment/runtime/region evidence.
- `PRODUCTION UNEXECUTED` applies when any URL, key, database, backup, deployment, fixture, credential, Storage, or provider authority is absent; verifier exits nonzero.

Do not mark P6 complete from local `CODE_GO`; the spec requires local and production gates. Do not mark P0–P7 complete after P6; P7 productization, canvas performance, adaptive UI, organization libraries, retention, backup/restore operations, field validation, plans, and organization management remain separate work.
