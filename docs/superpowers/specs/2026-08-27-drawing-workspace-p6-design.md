# 1HK Drawing Workspace P6 Quantity, BOQ, and Material Lineage Design

Date: 2026-08-27

Status: approved P0-P7 program direction refined into an implementation contract. The user approved continuous execution without another product approval pause. This document defines P6 only; it does not claim P5 release completion or P7 productization.

## 1. Outcome and entry gate

P6 connects an approved Drawing Workspace object to the existing Verified BOQ and then to the existing material-control ledger without copying or weakening either authority.

The shipped lineage is:

`immutable PDF/IFC/RVT -> approved drawing snapshot -> exact drawing object -> P4 measurement -> BOQ mapping -> adjustment -> final quantity -> rate components -> amount -> BOQ approval -> material plan -> purchase order -> receipt/installation/waste -> carbon-factor evidence`

The visible vertical slice is:

1. Open an approved drawing revision and select a measurable object.
2. Create an immutable server-derived quantity source for `length`, `area`, or `count`.
3. Map that source, wholly or by explicit factors, to one or more draft BOQ rows.
4. Review raw quantity, signed adjustment, final quantity, rate composition, amount, and original drawing evidence in one lineage view.
5. Submit and independently approve the exact deterministic BOQ result.
6. Download approved CSV, XLSX, and a machine-verifiable manifest.
7. Hand approved material rate components to material plans, then follow existing purchase, receipt, installation, waste, and carbon evidence.
8. Compare successive approved BOQs with explainable `RAW`, `MAPPING`, `ADJUSTMENT`, `PRICE`, and `FORMULA` causes.

P6 implementation starts only after P5 Task 6 is independently accepted. At the time of this design, P5 Task 5 fix round 2 is committed at `98e031b`; the Task 6 release-evidence work is present but uncommitted in the shared worktree. That work is an input gate, not evidence that P5 or P6 is complete.

## 2. Non-negotiable invariants

1. PDF, IFC, RVT, QTO, price-book, receipt, invoice, EPD, and other evidence bytes and their recorded SHA-256 values are never changed by a P6 action.
2. Only an approved Drawing revision with an approved schema-v2 snapshot may produce a persisted Drawing quantity link. A draft, review-requested, rejected, stale, restored-but-unapproved, or superseded-without-its-own-approval subject cannot do so.
3. The server reloads and rehashes the approved snapshot, reads the exact object from that snapshot, runs `P4_MEASUREMENT_V1`, performs exact unit conversion, and then inserts. The browser never supplies `raw_quantity`, `object_version`, `object_fingerprint`, final quantity, unit price, amount, or result hash.
4. A quantity link is immutable and append-only. It identifies one object instance and its cross-revision `lineage_id`, exact version, snapshot, measurement kind, unit, fixed-point value, and rule version.
5. A BOQ link stores only allocation intent between an immutable source and a BOQ line. It does not copy source quantity. For every Drawing quantity source used by one BOQ version, allocation factors sum to exactly `1`; the submission transaction enforces this after locking the version.
6. Legacy `lukas_qto_boq_quantity_mappings` and `lukas_qto_boq_source_exclusions` retain their current meaning and V1 behavior. Drawing sources are companion inputs, not polymorphic rows forced into the legacy file/Element-ID contract.
7. `raw`, `adjustment`, `adjusted`, and `final` remain distinct. No UI or export may collapse them into one ambiguous quantity.
8. BOQ calculation, comparison, manifest creation, submission, approval export, and material handoff use server-side exact-decimal code. Browser arithmetic is preview-only.
9. `VERIFIED-BOQ-1.0` remains replayable without output changes. P6 introduces `VERIFIED-BOQ-1.1`; it does not silently reinterpret an approved 1.0 result.
10. A BOQ in `in_review`, `approved`, or `superseded` is immutable. Rejection returns the same version to draft under the existing maker-checker contract; all P6 links then become editable only through their guarded mutation boundary and the next submission receives new hashes.
11. An approved BOQ export is regenerated from authoritative frozen rows and must match both its stored result SHA-256 and manifest SHA-256. A mismatch blocks export and material handoff.
12. A material link is append-only and can reference only an approved BOQ, a material rate component/resource, its exact approved result, and a compatible material plan. No material quantity, unit, or carbon factor is inferred in the browser.
13. P4 has no safe volume measurement. P6 supports Drawing-derived `EA`, `m`, and `m2` only. `m3` remains available through the existing approved QTO/element-ledger path until a separately versioned, approved volume rule exists. Wall thickness or height is never multiplied into a guessed volume.
14. Quantity, rate, price, approval, material, order, receipt, and carbon state stays in Postgres and immutable file storage. It never enters Yjs, y-indexeddb, Awareness, the Drawing operation outbox, or user undo/redo.
15. Project identity is enforced by composite foreign keys and rechecked by every server mutation. No source, BOQ row, resource, plan, file, or approval may cross a project boundary.
16. UI capability is advisory. React Router actions, database grants, RLS, triggers, and server authority all fail closed independently.

## 3. Chosen architecture

### 3.1 Companion bridge

P6 adds exactly three public relationship tables:

- `lukas_drawing_quantity_links`: immutable Drawing measurement evidence;
- `lukas_drawing_boq_links`: mutable only while the target BOQ is the maker's draft;
- `lukas_drawing_material_links`: immutable approved BOQ-to-material-plan evidence.

The existing tables remain canonical for their own domains:

- Drawing snapshot and approval: `lukas_drawing_snapshots`, `lukas_drawing_revision_approvals`;
- legacy source quantity: `lukas_qto_boq_quantity_mappings`, `lukas_qto_boq_source_exclusions`;
- BOQ structure, adjustment, rate, result status, and approval: existing `lukas_qto_boq_*` tables;
- material, purchase, receipt, site events, and carbon: `lukas_qto_material_plans`, `lukas_qto_material_transactions`, and `lukas_qto_carbon_factors`.

One new server module, `drawing-quantity-lineage.server.ts`, coordinates authorized loads and existing pure modules. It accepts IDs, `measurementKind`, allocation factor, and OCC metadata only. It calls the existing Drawing snapshot/measurement loader, exact-decimal calculator, BOQ builders, and material-control functions; it does not create a second calculation engine.

### 3.2 Rejected alternatives

**B. Make the legacy mapping table polymorphic.** Rejected. Making `source_file_id`, SHA, subject key, or Element IDs nullable and adding source-kind branches would weaken the already approved Verified BOQ 1.0 contract, complicate coverage/exclusion rules, and make a Drawing snapshot pretend to be an immutable QTO file row.

**C. Export Drawing quantities to CSV and import them back.** Rejected. A CSV round trip loses direct object/revision FKs, makes a file copy the business authority, creates spreadsheet-tampering and locale risks, and breaks bidirectional navigation.

**D. Add a generic quantity ledger or rule DSL.** Rejected. The existing Verified BOQ is already the quantity-to-money ledger. A new generic ledger, formula language, queue, event bus, state manager, or CRDT duplicates working authority without a demonstrated need.

The companion bridge is additive, preserves legacy results, and is the shortest design that makes the required lineage enforceable.

## 4. Exact database model

All three tables use UUID primary keys, composite project FKs, explicit indexes, RLS, least-privilege grants, and bounded fixed-point values. Historical migrations are not rewritten.

### 4.1 `public.lukas_drawing_quantity_links`

```sql
create table public.lukas_drawing_quantity_links (
  id uuid primary key,
  project_id uuid not null,
  drawing_revision_id uuid not null,
  drawing_revision_version bigint not null check (drawing_revision_version > 0),
  drawing_snapshot_sha256 text not null check (drawing_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  drawing_object_id uuid not null,
  drawing_object_lineage_id uuid not null,
  drawing_object_version bigint not null check (drawing_object_version > 0),
  object_fingerprint text not null check (object_fingerprint ~ '^[0-9a-f]{64}$'),
  measurement_kind text not null check (measurement_kind in ('length','area','count')),
  raw_quantity numeric(29,12) not null check (raw_quantity >= 0),
  unit text not null check (unit in ('EA','m','m2')),
  measurement_rule_version text not null
    check (measurement_rule_version = 'P4_MEASUREMENT_V1'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  unique (
    drawing_revision_id, drawing_object_id, measurement_kind,
    measurement_rule_version
  ),
  foreign key (project_id)
    references public.lukas_qto_projects(id) on delete restrict,
  foreign key (
    drawing_revision_id, project_id, drawing_revision_version,
    drawing_snapshot_sha256
  ) references public.lukas_drawing_snapshots(
    revision_id, project_id, revision_version, sha256
  ) on delete restrict,
  foreign key (drawing_object_id, drawing_revision_id, project_id)
    references public.lukas_drawing_objects(id, revision_id, project_id)
    on delete restrict,
  check (
    (measurement_kind = 'length' and unit = 'm') or
    (measurement_kind = 'area' and unit = 'm2') or
    (measurement_kind = 'count' and unit = 'EA')
  )
);
```

`object_fingerprint` is the lowercase SHA-256 of the existing P4 canonical object fingerprint `{geometry,id,name,version}`. `drawing_object_lineage_id` remains the separate cross-revision identity. The private insert boundary computes both from the exact snapshot object; neither is a client claim. The insert transaction also verifies:

- the revision row has the same project/version and status `approved` or `superseded`;
- an append-only `approved` Drawing decision exists for the exact version/SHA;
- `schema_version = 2` and `SHA256(canonical_json::text)` equals the stored snapshot SHA under the existing Postgres snapshot writer contract;
- the snapshot contains exactly one matching object with the recorded ID, lineage ID, version, name, and geometry;
- the object is active and the chosen P4 measurement is non-null;
- exact conversion produces the stored value.

Conversion is fixed and has no locale or floating-point step:

- `length`: P4 millimetres divided by `1000`, unit `m`;
- `area`: P4 square millimetres divided by `1,000,000`, unit `m2`;
- `count`: P4 exact count `1`, unit `EA`.

The twelve-decimal database scale preserves P4's six fractional square-millimetre places after the six-place conversion to square metres. Conversion is exact first. A value outside the declared precision is rejected as unsupported instead of silently rounded.

Indexes:

- `(project_id, drawing_revision_id, drawing_object_id)` for workspace drill-down;
- `(project_id, drawing_object_lineage_id, created_at desc)` for cross-revision history;
- the composite snapshot and object FK indexes if an existing unique index does not already cover the exact leading columns.

Quantity links never update or delete. A trigger raises `P6Q02` for both operations even for roles that bypass RLS. A stable server-generated `id` makes an exact retry idempotent; reusing the ID with different canonical values raises `P6O01`.

### 4.2 `public.lukas_drawing_boq_links`

```sql
create table public.lukas_drawing_boq_links (
  id uuid primary key,
  project_id uuid not null,
  quantity_link_id uuid not null,
  boq_version_id uuid not null,
  boq_line_id uuid not null,
  allocation_factor numeric(20,9) not null
    check (allocation_factor > 0 and allocation_factor <= 1),
  version bigint not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (boq_version_id, quantity_link_id, boq_line_id),
  foreign key (project_id)
    references public.lukas_qto_projects(id) on delete restrict,
  foreign key (quantity_link_id, project_id)
    references public.lukas_drawing_quantity_links(id, project_id)
    on delete restrict,
  foreign key (boq_version_id, project_id)
    references public.lukas_qto_boq_versions(id, project_id)
    on delete restrict,
  foreign key (boq_line_id, boq_version_id, project_id)
    references public.lukas_qto_boq_lines(id, version_id, project_id)
    on delete restrict
);
```

One source may be split across multiple BOQ lines. One line may aggregate many sources. The factor is an exact decimal. The source quantity is always joined from `lukas_drawing_quantity_links`; it is never copied into this table.

Indexes:

- `(project_id, boq_version_id, boq_line_id)` for a BOQ row's evidence;
- `(project_id, quantity_link_id, boq_version_id)` for reverse navigation and factor-sum checks.

Authenticated roles receive SELECT only on the table. The only write boundaries are `public.lukas_drawing_put_boq_link(...)` and `public.lukas_drawing_delete_boq_link(...)`. They lock the BOQ version row and support insert, factor update, and delete with:

- authenticated `auth.uid()`;
- project role `owner | staff | estimator`;
- BOQ status `draft`;
- actor equals the BOQ version `created_by`;
- exact same-project source/version/line;
- source unit equals BOQ line unit;
- positive bounded factor;
- `base_version` OCC on updates/deletes.

Insert retries with the same ID and exact values return the existing row. A mismatched duplicate, stale `base_version`, or an update that has already been superseded raises `P6O01`. The RPC increments `version`, sets `updated_by/updated_at`, and never accepts a source quantity or BOQ result from the caller.

Factor totals may be below `1` while the maker is drafting so a split can be entered incrementally. They may never exceed `1`. Submission requires every used Drawing quantity link's exact factor sum to equal `1`; a partial or over-allocated source raises `P6B04`. A source is either used with a complete allocation or remains visibly unmapped. P6 does not create a parallel Drawing-source exclusion table: an unmapped Drawing source is simply outside that BOQ version and is listed as such in the source picker.

### 4.3 `public.lukas_drawing_material_links`

```sql
create table public.lukas_drawing_material_links (
  id uuid primary key,
  project_id uuid not null,
  boq_version_id uuid not null,
  boq_line_id uuid not null,
  boq_rate_component_id uuid not null,
  material_resource_id uuid not null,
  boq_result_sha256 text not null check (boq_result_sha256 ~ '^[0-9a-f]{64}$'),
  material_plan_id uuid not null,
  derived_design_quantity numeric(29,9) not null
    check (derived_design_quantity >= 0),
  material_rule_version text not null
    check (material_rule_version = 'P6_MATERIAL_HANDOFF_V1'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  unique (boq_version_id, boq_rate_component_id),
  foreign key (project_id)
    references public.lukas_qto_projects(id) on delete restrict,
  foreign key (boq_version_id, project_id)
    references public.lukas_qto_boq_versions(id, project_id)
    on delete restrict,
  foreign key (boq_line_id, boq_version_id, project_id)
    references public.lukas_qto_boq_lines(id, version_id, project_id)
    on delete restrict,
  foreign key (boq_rate_component_id, boq_version_id, project_id)
    references public.lukas_qto_boq_rate_components(id, version_id, project_id)
    on delete restrict,
  foreign key (material_resource_id, project_id)
    references public.lukas_qto_price_resources(id, project_id)
    on delete restrict,
  foreign key (material_plan_id, project_id)
    references public.lukas_qto_material_plans(id, project_id)
    on delete restrict
);
```

The material handoff transaction re-runs the approved BOQ, then for each selected `material` rate component computes:

`derived_design_quantity = Round(final_quantity × resource_coefficient, 6, half_away_from_zero)`

It verifies the component belongs to the line/version, its resource is type `material`, the resource is in the BOQ price book, and the material plan has:

- `material_code = resource_code`;
- `material_name = resource_name`;
- `specification = resource specification`;
- `unit = resource unit`;
- `design_quantity = sum(derived_design_quantity)` for every link grouped into that plan;
- `allowance_rate = 0`, `required_quantity = design_quantity`;
- `rule_id = P6_MATERIAL_HANDOFF_V1`;
- `source_file_id/source_sha256` pointing to the re-downloaded and rehashed approved BOQ manifest file.

P6 never invents loss, waste, conversion, density, baseline carbon, or product EPD values. A later explicit material workflow may create another immutable plan under an approved rule; it may not mutate this handoff evidence.

Indexes:

- `(project_id, boq_version_id, boq_line_id)` for upstream lineage;
- `(project_id, material_plan_id)` for order/receipt/carbon traversal;
- `(project_id, material_resource_id)` for resource usage.

Material links are append-only. Authenticated roles receive SELECT only. The server-only handoff may insert; UPDATE and DELETE are rejected by an all-role trigger with `P6M02`.

The insert guard independently requires an `approved` or independently approved `superseded` BOQ version, equality between `boq_result_sha256` and the version result, an approved decision, exact line/component/resource ownership, material resource type, compatible plan identity/unit/source manifest, and same-project ancestry. A service request that skips the application checks therefore still cannot attach an unrelated plan or stale result.

Creating the handoff requires project role `owner | staff | estimator`; repeated handoff of the same rate component returns the exact existing link or rejects a mismatched replay. Existing `procurement` and `site` material-transaction permissions remain unchanged and do not gain BOQ or Drawing mutation authority.

## 5. Migration, upgrade, RLS, and grants

### 5.1 Forward-only migration

The implementation uses `supabase migration new drawing_workspace_p6_lineage` after checking the installed CLI with `supabase --version` and discovering commands with `--help`. It never edits a historical migration.

The forward migration:

1. Preflights the expected composite keys and columns in Drawing, Verified BOQ, price-resource, rate-component, material-plan, and project tables; a mismatched base fails rather than creating weak FKs.
2. Creates the three tables, checks, triggers, composite FKs, and indexes above.
3. Alters the BOQ engine-version check to allow exactly `VERIFIED-BOQ-1.0` and `VERIFIED-BOQ-1.1`.
4. Adds nullable `input_state_sha256 text` and `manifest_sha256 text` to `lukas_qto_boq_versions`, both with 64-lowercase-hex checks. Existing 1.0 rows remain null and byte-stable. A transition guard requires non-null input, result, and manifest hashes for 1.1 `in_review | approved | superseded`; it continues the legacy 1.0 rule unchanged.
5. Adds the covering unique constraint `(id, version_id, project_id)` to `lukas_qto_boq_rate_components`, required by the material-link composite FK. Existing primary-key identity makes this a metadata/index addition, not a semantic change.
6. Adds only these guarded mutation boundaries: `private.lukas_drawing_insert_quantity_link(...)`, public `lukas_drawing_put_boq_link(...)`, public `lukas_drawing_delete_boq_link(...)`, public read-only `lukas_qto_boq_v1_1_input(...)`, private `lukas_qto_finalize_boq_v1_1(...)`, and private `lukas_drawing_insert_material_handoff(...)`. Every function has an empty or explicit safe `search_path`, bounded inputs, exact ownership checks, and explicit grants.
7. Enables RLS before any client grant, revokes automatic/default privileges, and adds one SELECT policy per table using `private.lukas_qto_project_role(project_id) is not null` plus the existing verified-non-anonymous restrictive policy.
8. Adds no table to `supabase_realtime`. P6 screens reload after acknowledged mutations and approval transitions; correctness and freshness never depend on broadcast delivery.

There is no backfill. Approved 1.0 BOQs, legacy mappings, material plans, drawing snapshots, and source files retain their exact stored values. New Drawing-linked BOQs explicitly use 1.1. A new 1.1 BOQ may also consume legacy QTO mappings.

### 5.2 Least privilege

For all three tables:

- `anon`: no privileges;
- `authenticated`: SELECT only;
- `service_role`: SELECT and INSERT only where the application server needs the private authority; no UPDATE/DELETE on immutable tables;
- table owner: triggers still reject immutable-row update/delete;
- `PUBLIC`: no function execute and no table privileges.

The two BOQ-link RPCs are the only direct authenticated P6 table-write APIs. The quantity insert, 1.1 finalize, and material handoff functions are callable only by the trusted application-server service role after the React Router action validates the user's access token. Public authenticated functions validate `auth.uid()` internally. Private implementations are revoked from `PUBLIC`, `anon`, and direct `authenticated` execution. No authorization uses `user_metadata`; the existing project-role helper remains authoritative.

Supabase's 2026 Data API default is moving to opt-in table exposure. The migration therefore never assumes automatic exposure: it declares every revoke and grant explicitly and tests both old-project and new-project default privilege states.

### 5.3 Upgrade proof

Upgrade tests seed the current P0-P5 schema with:

- an approved schema-v2 Drawing snapshot and decision;
- a legacy approved BOQ 1.0 and its exact expected hash/output;
- a draft and rejected BOQ;
- an existing material plan, purchase order, receipt, and carbon factor;
- cross-project users and rows.

After the P6 migration, all seeded rows and hashes must be identical, 1.0 must replay byte-for-byte, and only new 1.1/bridge behavior may appear. Migration down/rollback is operational rollback by restoring the pre-migration database backup and application release; P6 does not promise a destructive down migration.

### 5.4 Exact mutation API surface

The SQL signatures are fixed before implementation so a browser-visible RPC cannot grow into a generic write tunnel:

```text
private.lukas_drawing_insert_quantity_link(
  p_actor_id uuid, p_id uuid, p_revision_id uuid, p_object_id uuid,
  p_measurement_kind text, p_snapshot_sha256 text,
  p_object_lineage_id uuid, p_object_version bigint,
  p_object_fingerprint text, p_raw_quantity numeric, p_unit text,
  p_measurement_rule_version text
) -> lukas_drawing_quantity_links

public.lukas_drawing_put_boq_link(
  p_id uuid, p_quantity_link_id uuid, p_boq_version_id uuid,
  p_boq_line_id uuid, p_allocation_factor numeric,
  p_base_version bigint default null
) -> lukas_drawing_boq_links

public.lukas_drawing_delete_boq_link(
  p_id uuid, p_base_version bigint
) -> jsonb

public.lukas_qto_boq_v1_1_input(
  p_version_id uuid
) -> jsonb

private.lukas_qto_finalize_boq_v1_1(
  p_actor_id uuid, p_version_id uuid, p_input_state_sha256 text,
  p_result_sha256 text, p_manifest_sha256 text,
  p_direct_cost_krw numeric, p_line_count integer
) -> jsonb

private.lukas_drawing_insert_material_handoff(
  p_actor_id uuid, p_boq_version_id uuid, p_result_sha256 text,
  p_manifest_file_id uuid, p_manifest_file_sha256 text,
  p_material_plan_rows jsonb, p_material_link_rows jsonb
) -> jsonb
```

Private inputs that contain calculated values are accepted only from the trusted application-server service role after the named server module derives them. The material arrays are strict, reject unknown keys, are limited to 10,000 links/2,000 plans per call, and are inserted atomically. The public BOQ RPC accepts only IDs, allocation intent, and OCC version. No P6 function accepts project ID, role, source quantity, final quantity, price, amount, or hash from an untrusted browser request when that value can be derived from authoritative rows.

## 6. Deterministic server authority

### 6.1 Creating a Drawing quantity source

`drawing-quantity-lineage.server.ts` receives `{projectId, drawingRevisionId, drawingObjectId, measurementKind, linkId}` from an authenticated React Router action. It performs:

1. Validate shape and bounds with existing Zod/UUID/SHA helpers.
2. Load the project role, exact revision, exact approved decision, and exact schema-v2 snapshot from one transactionally consistent database authority.
3. Recompute the snapshot digest with Postgres `pgcrypto`; mismatch fails `P6Q03`.
4. Parse the canonical snapshot with the existing Drawing schema and locate exactly one object.
5. Resolve every active source and issue link embedded for that object, require exact same-project immutable file ID/SHA evidence, and retain missing optional issue linkage without manufacturing it.
6. Call the existing `deriveDrawingServerMeasurementEvidence` / `measureDrawingObject` path using `P4_MEASUREMENT_V1`.
7. Select only the requested non-null measure and convert exactly to `EA`, `m`, or `m2`.
8. Insert through the private server boundary, which repeats approval, project, object identity, snapshot digest, and fingerprint checks under locks.
9. Return the persisted row; never return success from the preview calculation alone.

A Viewer, Commenter, Reviewer, or project member may read authorized sources. Creating a quantity source requires Drawing `admin | editor` capability or project `owner | staff | estimator`, but never permits modification of the approved drawing. This action records derived evidence only.

### 6.2 BOQ 1.1 input dispatcher

The current 1.0 calculator remains an unchanged function selected for `VERIFIED-BOQ-1.0`. A small dispatcher selects the new 1.1 adapter when the version says 1.1.

The 1.1 adapter canonicalizes two source arrays into a common calculation input:

- legacy mappings: existing file ID/SHA, subject key, source quantity, factor, unit, Element IDs;
- Drawing mappings: quantity-link ID, snapshot SHA, revision/object/lineage/version/fingerprint, measurement rule, raw quantity, allocation factor, and unit.

Sources sort by source kind and stable identifiers; lines sort by item code then line ID; resources/components sort by code/ID; object and element identifiers sort deterministically. `JSON.stringify` is used only after constructing objects with a fixed field order and recursively sorted map/set material. No locale-dependent sort, number formatting, wall clock, random ID, signed URL, actor display name, or storage path enters a hash.

### 6.3 Quantity semantics

For each BOQ line:

- `mapped_quantity = immutable_source_quantity × allocation_factor`;
- `raw_quantity = Σ(mapped_quantity)` across legacy and Drawing sources;
- `signed_adjustment` is the existing BOQ-line value and requires the existing non-empty reason when nonzero;
- `adjusted_quantity = raw_quantity + signed_adjustment` before rounding;
- `final_quantity = Round(adjusted_quantity, quantity_scale, half_away_from_zero)`;
- negative final quantity blocks calculation;
- component unit amounts, grouped unit prices, and amount use the existing calculation policy exactly.

`raw_quantity`, `adjusted_quantity`, and `final_quantity` are 1.1 derived result fields, not bridge-table columns. The 1.0 result shape and hash remain unchanged. `signed_adjustment` and `adjustment_reason` remain in `lukas_qto_boq_lines`; P6 does not create a second adjustment ledger. The UI labels the four values as `원수량`, `보정값`, `보정 후 수량`, and `최종수량`.

### 6.4 Rule and manifest hashes

`VERIFIED-BOQ-1.1` produces two distinct digests:

- `result_sha256`: SHA-256 of the canonical result object, preserving the current meaning of result identity;
- `manifest_sha256`: SHA-256 of the canonical execution manifest below, excluding only its own `manifestSha256` field.

The manifest schema is `1HK_VERIFIED_BOQ_MANIFEST_V1` and contains:

```text
schemaVersion, engineVersion, projectId, boqVersionId, inputStateSha256,
calculationPolicy, quantityScale,
drawingSources[
  quantityLinkId, revisionId, revisionVersion, snapshotSha256,
  objectId, lineageId, objectVersion, objectFingerprint,
  measurementKind, unit, rawQuantity, measurementRuleVersion,
  sourceAnchors[sourceFileId, sourceSha256, sourceKind, pdfRegion, ifcGlobalId],
  issueLinks[issueId]
],
legacySources[fileId, fileSha256, subjectKey, unit, sourceQuantity, elementIds],
mappings[sourceKind, sourceId, lineId, allocationFactor],
lines[lineId, itemCode, unit, signedAdjustment, adjustmentReason],
priceBook[id, sourceFileId, sourceSha256, effectiveDate, rightsBasis],
resources[id, code, type, unit, unitPriceKrw],
rateComponents[id, lineId, resourceId, coefficient],
rules[measurementRuleVersion, engineVersion, calculationPolicy, quantityScale],
result[resultSha256, status, directCostKrw, canonicalLines]
```

The calculation manifest used at submission excludes later BOQ approvals; the downloadable approved handoff manifest includes a separate `approvalEnvelope` and hashes that envelope as `handoff_sha256`. Thus approval can be appended without changing the already frozen calculation `manifest_sha256`. The handoff manifest binds both hashes, the exact approved decision, and every file SHA.

Submission uses a compare-and-freeze protocol without duplicating the exact-decimal engine in PL/pgSQL:

1. `lukas_qto_boq_v1_1_input` authorizes the maker and returns every line/source/link/resource/component/price-book row from one database snapshot plus a Postgres-canonical `input_state_sha256`.
2. The application server validates exact unit compatibility and factor sums of `1`, runs the 1.1 exact-decimal engine, requires every line `calculated`, and creates the canonical result and calculation manifest.
3. The service-only `private.lukas_qto_finalize_boq_v1_1` locks the BOQ version, requires the same maker and `draft`, recomputes `input_state_sha256` from current rows, and rejects `P6O01` if it differs. It accepts calculation outputs only from the trusted application server.
4. The finalize transaction writes `input_state_sha256`, `result_sha256`, `manifest_sha256`, direct cost, line count, timestamp, and `in_review` status together.

An edit committed before the final lock changes the input hash and forces a reload/recalculation. An edit arriving after the lock observes `in_review` and fails. The database therefore never freezes a result calculated from a different input set, while the TypeScript exact engine remains the single calculation implementation.

The existing `lukas_qto_decide_boq` maker-checker decision path remains the approval authority. For a 1.1 approval it recomputes the Postgres input-state digest, requires equality with stored `input_state_sha256`, requires all three frozen hashes, and retains the existing independent-reviewer rule. It never accepts hashes from the decision request.

Before invoking that RPC, the React Router decision action also reloads the frozen 1.1 input, reruns the exact TypeScript engine and manifest builder, and compares both hashes with the stored values. A crafted direct decision RPC still cannot bypass input immutability or maker-checker checks; the application recheck additionally detects a corrupt server result before normal approval UX proceeds.

## 7. Revision comparison

Comparison is allowed only between two independently approved BOQ results. Item code is the stable row identity across BOQ versions; duplicate item codes already fail. Added and removed rows are row states, not sixth cause types.

Each row exposes zero or more approved causes:

- `RAW`: the immutable source set or source quantity changed, including Drawing snapshot/object/fingerprint/rule or legacy file/subject evidence;
- `MAPPING`: line assignment or allocation factor changed while source evidence remained identifiable;
- `ADJUSTMENT`: signed adjustment or its required reason changed;
- `PRICE`: price-book/resource unit price, rate component, or coefficient changed;
- `FORMULA`: engine version, calculation policy, quantity scale, or other declared calculation rule changed.

Cause amounts use a deterministic waterfall, always in this order:

`previous -> RAW -> MAPPING -> ADJUSTMENT -> PRICE -> FORMULA -> current`

At each step the exact 1.1 engine recalculates a counterfactual using the current category and the prior values for categories not yet applied. The difference from the prior step is that cause's amount delta. This ensures:

`Σ(row cause deltas) = Σ(row amount deltas) = current direct cost - previous direct cost`

The dispatcher replays each side under its declared engine. A 1.0-to-1.1 comparison is supported when the 1.0 side contains only its valid legacy inputs and the 1.1 adapter can reproduce both states; the engine switch is then a `FORMULA` cause. If either historical engine or input contract cannot be replayed exactly, comparison returns `review` rather than coercing the older data.

The comparison is `review` and cannot claim an explained change if any counterfactual is invalid, an engine/rule implementation is unavailable, a row identity is ambiguous, or the exact closure fails. The UI may show multiple causes on one row and never collapses them into a guessed primary cause.

## 8. Object-to-BOQ navigation and UX

The existing `/projects/:projectId/boq?version=:boqVersionId` screen gains Drawing source rows without replacing the current five-step BOQ workflow.

### From Drawing to BOQ

The right inspector's quantity section shows:

- approved snapshot status and short SHA;
- object name/type/lineage and exact version;
- available `길이`, `면적`, or `개수` measurement;
- created quantity sources and BOQ rows using them;
- an action to create a server-confirmed source and then open the BOQ mapping step.

Only persisted links are labelled `확정 근거`. A browser preview remains labelled `미리보기`.

### From BOQ to Drawing

Each BOQ row lists legacy and Drawing evidence separately. Selecting Drawing evidence links to:

`/projects/:projectId/drawings/:fileId/workspace?document=:documentId&revision=:revisionId&object=:objectId&boq=:boqVersionId&line=:boqLineId`

The server derives `fileId` and every ID from authorized rows; it does not accept a caller-provided cross-project path. The workspace loads the exact revision, switches to the object's page/canvas, selects it, fits it in view, and opens its source/quantity inspector. If the original document has no source file route identity, the link uses the project's Drawing-document entry resolver rather than inventing a file ID; implementation must add that resolver before advertising the link.

Missing/deleted authorization never causes automatic fallback to another revision or object. The user receives `연결된 도면 근거를 열 수 없습니다` while the immutable BOQ evidence remains visible.

### Change and handoff screens

- Raw, adjustment, adjusted, and final quantity use separate columns.
- Comparison filters by the five cause codes and shows exact amount closure.
- The material view shows `BOQ line -> material resource -> material plan -> PO -> receipt/site event -> carbon factor/file SHA` without embedding the Drawing workspace.
- Desktop is the authoring/mapping target. Tablet/mobile are read, evidence navigation, review, and approval targets; P7 owns broad responsive optimization.

## 9. Approved CSV, XLSX, and manifest handoff

Draft and in-review BOQs may use an on-screen preview but cannot download an authoritative P6 handoff. Export endpoints require `approved` or `superseded` with its own approved decision, then reload and recalculate before returning bytes.

Outputs:

1. UTF-8 BOM CSV with one row per BOQ line and explicit Drawing evidence IDs/hashes; legacy element IDs remain in their existing field.
2. XLSX using the already installed `fflate` implementation, with the current five sheets plus a `도면근거` sheet and an approval/manifest summary. Cells contain values, not executable formulas.
3. Canonical UTF-8 `.manifest.json` containing the calculation manifest, approval envelope, handoff hash, and source/file hashes.

All three expose the same result SHA and handoff SHA. Export tests re-open CSV/XLSX/JSON and prove item-code leading zeroes, Korean text, exact decimal strings, formula-injection protection, quantities, rates, amounts, evidence IDs, and hashes survive.

For material handoff, the server writes the exact approved manifest bytes to the existing private `lukas-qto` bucket at a deterministic SHA-based ASCII path, inserts/reuses an immutable `lukas_qto_files` row with kind `other`, re-downloads and rehashes the bytes, and only then creates the material plan and links. A storage object not yet referenced by a DB handoff is a recoverable orphan, not authority; a maintenance audit may remove such old orphans in P7. P6 adds no queue or artifact table for this rare boundary.

## 10. Material, order, receipt, and carbon lineage

P6 reuses the existing append-only material-control contract:

- `lukas_qto_material_plans` keeps design, allowance, required quantity, immutable source file/SHA, and optional baseline factor;
- `lukas_qto_material_transactions` keeps purchase orders, goods receipts, invoice evidence, installation, return, and waste events;
- `lukas_qto_carbon_factors` keeps product EPD/industry/generic provenance and source SHA.

The new material link proves how much of an approved BOQ material component created the design quantity. Existing transactions then prove ordered, received, installed, returned, wasted, and invoiced quantities. Existing carbon summaries prove baseline, committed, received, and installed A1-A3 values only when a compatible factor exists.

Rules:

- no automatic carbon-factor selection;
- no automatic density/unit conversion;
- material resource and plan units must be identical;
- product code and specification must match the selected price resource;
- receipts/installations/returns/waste keep the existing purchase-order relationship and immutable evidence requirements;
- carbon calculations continue to reject missing, mismatched, or expired evidence and report partial coverage honestly;
- a later BOQ revision creates new material plans/links; it never rewrites previous orders or receipts.

The lineage query starts from either an object, BOQ line, material plan, transaction, or carbon factor and traverses indexed same-project FKs. It is paginated and does not load all project history into one browser response.

## 11. Error, OCC, approval, and network behavior

### 11.1 Stable error classes

The server maps bounded SQLSTATEs to Korean user messages while logging safe technical context:

- `P6A01`: unauthorized/non-member/capability mismatch;
- `P6Q01`: unsupported or unavailable measurement;
- `P6Q02`: immutable quantity/material link mutation;
- `P6Q03`: snapshot/object/fingerprint/hash mismatch;
- `P6U01`: unsupported or mismatched unit;
- `P6O01`: stale `base_version`, duplicate mismatch, or concurrent mutation;
- `P6B04`: incomplete/overallocated source, uncalculated line, or invalid BOQ state;
- `P6C01`: deterministic result/manifest mismatch;
- `P6M01`: incompatible BOQ component/resource/material plan;
- `P6M02`: immutable material-link mutation.

Unknown database, storage, parser, or calculation errors fail closed and return one request ID. They do not expose SQL, signed URLs, service keys, or source bytes.

### 11.2 OCC and idempotency

- Quantity/material inserts use stable server-generated UUIDs and exact replay comparison.
- BOQ-link updates/deletes require `base_version`; successful updates increment it.
- Every BOQ-link mutation and submission locks the BOQ version first. Mutation after submission loses the status race and fails rather than being omitted from the approved result.
- An interrupted exact retry returns the already committed result. A retry with the same identity but different payload is a conflict.
- No client-side optimistic result is labelled saved before the server response.

### 11.3 Approval

- Drawing approval precedes quantity creation.
- BOQ maker and approver remain different users under the existing role rules.
- Submission freezes exact 1.1 inputs and hashes; approval re-verifies them.
- Rejection note remains append-only, restores the BOQ to draft under the existing contract, and allows guarded bridge edits. The previous rejected calculation hashes remain audit evidence in its approval event/log but are not exported as approved.
- Approved/superseded versions and all their child/bridge/material rows reject direct update/delete.

### 11.4 Network and offline boundary

P6 monetary/business writes require a live server response. They are not put into the Drawing outbox or y-indexeddb. If a request disconnects, the UI retains the user's IDs/factor form locally for a retry with the same operation identity, then reloads authority before showing success. This prevents an offline browser from presenting an unapproved amount as canonical while avoiding a new queue.

Supabase Realtime may invalidate a visible BOQ/material query after another user's commit. Realtime is not the write, acknowledgement, ordering, or approval authority.

## 12. No-Yjs boundary

P6 does not change the P3 collaboration document, protocol version, Awareness payload, Hocuspocus service, Yjs schema, y-indexeddb database, or Drawing operation kinds.

Yjs continues to represent only draft Drawing commands. The approved snapshot is the handoff boundary. After that boundary, quantities, mappings, adjustments, prices, results, approvals, material plans, transactions, and carbon evidence are ordinary authoritative Postgres/file data.

Two users may see server commits through reload or existing Realtime invalidation, but BOQ link edits use database OCC, not CRDT merging. This avoids two conflicting truths for money and approval.

## 13. Open-source and dependency policy

P6 adds zero runtime dependencies and zero test frameworks.

It reuses:

- Node `crypto` for SHA-256;
- the existing exact-decimal module;
- existing Zod, Supabase, React Router, Node test runner, PGlite, and Playwright;
- existing `fflate@0.8.3` for formula-free XLSX ZIP generation.

`fflate` is MIT but is currently absent from `platform/THIRD_PARTY_NOTICES.md`; P6 must add its exact version, upstream URL, license, usage, and unmodified-package status before the release/license gate passes. No source is copied from Rayon, Figma, XCost, or another proprietary/source-available product. No GPL/AGPL/LGPL/MPL code is added or adapted in P6. The existing isolated `web-ifc` MPL notice remains a P5 boundary and is not expanded.

No new state manager, CRDT, collaboration server, job queue, generic rule engine/DSL, spreadsheet library, decimal library, or material ledger is justified by P6.

## 14. Performance contract

P6 queries are indexed and paginated. Default source, BOQ-line, and lineage pages contain at most 200 rows. Counts and totals come from bounded server queries; the browser does not download 10,000 objects just to calculate a BOQ.

Local release evidence uses a fixed seed of 10,000 Drawing quantity links, 10,000 allocation links, 2,000 BOQ lines, representative legacy mappings, one approved snapshot, one price book, and material components. On the documented Node 22/reference machine it records cold and warm wall time, CPU, peak RSS, PostgreSQL query plans, row counts, and output bytes for:

- authoritative source-page load;
- 1.1 calculation and manifest creation;
- approved revision comparison;
- CSV/XLSX/manifest generation;
- object-to-BOQ and material-lineage lookup.

Hard P6 gates:

- no sequential scan on a project-wide bridge table for the indexed drill-down queries at the 10k fixture;
- no unbounded response or N+1 query per source/line/component;
- calculation + manifest p95 at or below 2.5 seconds and peak RSS below 512 MiB on the recorded reference machine;
- comparison p95 at or below 3 seconds;
- a 200-row warm lineage query p95 at or below 500 ms against local real PostgreSQL;
- exact repeated-run hashes and outputs across at least 100 identical runs.

These are server P6 gates. They do not claim the Drawing canvas's 10,000-object 60 fps or whole-workspace 2.5-second first-use target, which remains a P7 product gate. A missed threshold is recorded `NOT MET`, never rewritten as a pass because a smaller fixture succeeds.

## 15. Verification and release gates

### 15.1 Pure deterministic tests

- each length/area/count conversion, maximum precision, zero, unavailable measure, and explicit no-volume rejection;
- snapshot object fingerprint canonicalization and ordering;
- mixed legacy + Drawing mappings, exact split factors, aggregation, unit mismatch, duplicates, and factor sum boundaries;
- raw/adjustment/adjusted/final separation and rounding order;
- 1.0 golden inputs and SHA outputs remain byte-identical;
- 1.1 canonical ordering, result SHA, manifest SHA, approval envelope, and 100-run reproducibility;
- all five comparison causes singly and in combinations, added/removed rows, invalid counterfactuals, and exact amount closure;
- material final-quantity × coefficient derivation, grouping, six-place rounding, unit/resource/plan mismatch, and no inferred allowance/carbon/volume;
- CSV injection/UTF-8/leading-zero/locale cases; XLSX and manifest round-trip.

### 15.2 Database tests

Run both a fresh schema and the populated upgrade fixture under PGlite and real PostgreSQL. PGlite is fast coverage; it never substitutes for real PostgreSQL RLS/trigger/locking proof.

Required adversarial cases:

- anon, anonymous-sign-in, non-member, Viewer, Commenter, Reviewer, estimator, staff, owner, and service paths;
- cross-project revision/object/snapshot/BOQ/line/resource/plan/file IDs in every FK position;
- direct authenticated INSERT/UPDATE/DELETE against all three tables;
- direct function execution and default-PUBLIC execute grants;
- draft/review-requested/rejected/approved/superseded Drawing and BOQ statuses;
- missing/wrong approval, schema version, revision version, snapshot SHA, recomputed hash, object ID/lineage/version/fingerprint, rule, unit, and value;
- stale BOQ-link versions, racing edit versus submit, two simultaneous submissions, exact retries, and mismatched retries;
- partial/over allocation and a valid exact split;
- maker self-approval and approved child mutation denial;
- immutable link update/delete attempts by `service_role` and table owner trigger paths;
- migration preservation of populated P0-P5, BOQ 1.0, material, transaction, and carbon rows;
- RLS and grant inspection, FK/index coverage, function `search_path`, and security-definer execute audit;
- `supabase db advisors` or equivalent hosted advisors with no unresolved security/performance finding attributable to P6.

### 15.3 Mounted and E2E workflow

One mounted, production-shaped flow proves:

1. create/approve a Drawing revision without changing PDF/IFC bytes;
2. select wall/space/opening and create length/area/count sources;
3. deny a Viewer and a cross-project crafted request;
4. map and split sources into BOQ lines; show exact reverse navigation;
5. calculate, submit, reject, edit with OCC, resubmit, and approve by another user;
6. open a BOQ row back at the exact Drawing object and source anchor/IFC focus;
7. compare a successor approved revision with all five cause types and closed deltas;
8. download approved CSV/XLSX/manifest and verify their hashes/content;
9. create compatible material plans and links;
10. add purchase order, goods receipt, installation, waste, and carbon-factor evidence;
11. traverse end-to-end lineage from Drawing object to carbon provenance and back;
12. re-download and hash every PDF/IFC/RVT/QTO/price-book/manifest/receipt/EPD evidence file before and after relevant mutations.

Two browser contexts prove that a committed mapping/status/approval becomes visible after existing Realtime invalidation or bounded reload, while simultaneous edits resolve through OCC and never Yjs. Network-loss tests prove an unknown result is retried idempotently and never shown as approved from local state.

### 15.4 Regression and build gates

- all P0-P5 Drawing, PDF, IFC, source-link/relink, snapshot, collaboration, approval, export, and release suites;
- current quantity, Verified BOQ 1.0, IFC drill-down, price-book, material-control, order/receipt/site-event/carbon, Revit download, and Storage tests;
- application and collaboration typechecks;
- production build and route manifest;
- Prettier and `git diff --check`;
- dependency/license closure, including the missing `fflate` notice;
- no unexpected dependency/lockfile changes and no new Yjs/Awareness/schema version.

### 15.5 Production gates

Production completion requires evidence from disposable, production-equivalent authorities:

- hosted Supabase/PostgreSQL fresh and upgrade migrations, RLS matrix, concurrent locks, DB advisors, and backup/restore rehearsal;
- two real organization users plus cross-organization attacker fixtures for every bridge/RPC/storage route;
- deployed React Router application and private Storage with signed URL and CORS verification;
- approved Drawing-to-BOQ-to-material-to-receipt/carbon vertical workflow with persisted rows and re-downloaded source hashes;
- deterministic rerun/export from the deployed commit and recorded artifact hashes;
- actual project fixture reviewed by a maker and a distinct approver;
- production metrics with deployment ID, commit, database migration IDs, browser/Node/Postgres versions, hardware/region, cold/warm conditions, and timestamp.

The production release verifier exits nonzero when required URLs, keys, database authorities, fixture IDs, or two-user credentials are absent. Reports label each missing gate `UNEXECUTED`; skipped, mocked, compiled, listed, local-only, or PGlite-only evidence is never reported as production PASS. A threshold miss is `NOT MET`. P6 may be locally `CODE_GO` while production remains `UNEXECUTED`, but it is not release-complete and does not complete P0-P7.

## 16. Explicit non-goals and upgrade triggers

P6 does not implement:

- guessed Drawing volume, density conversion, wall solids, Boolean deductions, or automatic waste;
- AI classification/mapping, automatic approval, automatic price or carbon-factor selection;
- a second quantity/adjustment/approval/material ledger;
- offline BOQ approval or monetary CRDT merges;
- ERP/PMIS integration, supplier marketplace, payment, indirect cost, tax, profit, or public market-price data;
- a formula DSL, plugin SDK, job queue, Redis, new state manager, or new collaboration service;
- native DWG editing or OCR/sheet matching;
- bulk copy-on-write optimization or P7 organization libraries/retention/billing.

A new measurement rule is added only when a real supported geometry and deterministic server test exist. A queue is added only when measured material/export work cannot complete reliably inside the current server request and an idempotent job contract is approved. A new quantity ledger is added only if a domain outside Drawing and current QTO cannot be represented by the two existing source adapters.

## 17. Completion definition

P6 is complete only when current evidence proves every local and required production gate above, including the exact three-table lineage, deterministic 1.1 calculation/manifest, maker-checker approval, approved export, material/order/receipt/carbon traversal, legacy 1.0 preservation, role/RLS denial, source-byte invariance, performance thresholds, and deployed multi-user authority.

Creating the tables, rendering a demo, passing unit tests, or producing a local XLSX is not P6 completion. Until hosted credentials and real PostgreSQL evidence exist, the honest state is local implementation progress with production `UNEXECUTED`.
