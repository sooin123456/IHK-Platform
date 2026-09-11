import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const p6MigrationDirectory = new URL(
  "../../supabase/migrations/",
  import.meta.url,
);
const p6MaterialMigration = new URL(
  "../../sql/migrations/0010_material_control_pilot.sql",
  import.meta.url,
);

export const p6Ids = Object.freeze({
  owner: "60000000-0000-4000-8000-000000000001",
  maker: "60000000-0000-4000-8000-000000000002",
  reviewer: "60000000-0000-4000-8000-000000000003",
  viewer: "60000000-0000-4000-8000-000000000004",
  commenter: "60000000-0000-4000-8000-000000000005",
  outsider: "60000000-0000-4000-8000-000000000006",
  anonymous: "60000000-0000-4000-8000-000000000007",
  otherOwner: "60000000-0000-4000-8000-000000000008",
  otherMaker: "60000000-0000-4000-8000-000000000009",
  project: "61000000-0000-4000-8000-000000000001",
  otherProject: "61000000-0000-4000-8000-000000000002",
  drawingFile: "62000000-0000-4000-8000-000000000001",
  priceFile: "62000000-0000-4000-8000-000000000002",
  legacySourceFile: "62000000-0000-4000-8000-000000000003",
  manifestFile: "62000000-0000-4000-8000-000000000004",
  receiptFile: "62000000-0000-4000-8000-000000000005",
  epdFile: "62000000-0000-4000-8000-000000000006",
  otherFile: "62000000-0000-4000-8000-000000000007",
  otherDrawingFile: "62000000-0000-4000-8000-000000000008",
  otherManifestFile: "62000000-0000-4000-8000-000000000009",
  document: "63000000-0000-4000-8000-000000000001",
  revision: "63000000-0000-4000-8000-000000000002",
  page: "63000000-0000-4000-8000-000000000003",
  canvas: "63000000-0000-4000-8000-000000000004",
  layer: "63000000-0000-4000-8000-000000000005",
  wall: "63000000-0000-4000-8000-000000000006",
  opening: "63000000-0000-4000-8000-000000000007",
  space: "63000000-0000-4000-8000-000000000008",
  snapshot: "63000000-0000-4000-8000-000000000009",
  drawingApproval: "63000000-0000-4000-8000-00000000000a",
  issue: "63000000-0000-4000-8000-00000000000b",
  objectSource: "63000000-0000-4000-8000-00000000000c",
  issueLink: "63000000-0000-4000-8000-00000000000d",
  otherDocument: "63100000-0000-4000-8000-000000000001",
  otherRevision: "63100000-0000-4000-8000-000000000002",
  otherPage: "63100000-0000-4000-8000-000000000003",
  otherCanvas: "63100000-0000-4000-8000-000000000004",
  otherLayer: "63100000-0000-4000-8000-000000000005",
  otherWall: "63100000-0000-4000-8000-000000000006",
  otherSnapshot: "63100000-0000-4000-8000-000000000007",
  otherDrawingApproval: "63100000-0000-4000-8000-000000000008",
  priceBook: "64000000-0000-4000-8000-000000000001",
  materialResource: "64000000-0000-4000-8000-000000000002",
  otherPriceBook: "64100000-0000-4000-8000-000000000001",
  otherMaterialResource: "64100000-0000-4000-8000-000000000002",
  legacyApprovedBoq: "65000000-0000-4000-8000-000000000001",
  legacyDraftBoq: "65000000-0000-4000-8000-000000000002",
  legacyRejectedBoq: "65000000-0000-4000-8000-000000000003",
  boq11: "65000000-0000-4000-8000-000000000004",
  section: "65000000-0000-4000-8000-000000000005",
  boqLine: "65000000-0000-4000-8000-000000000006",
  mapping: "65000000-0000-4000-8000-000000000007",
  component: "65000000-0000-4000-8000-000000000008",
  boq11Section: "65000000-0000-4000-8000-000000000009",
  boq11Line: "65000000-0000-4000-8000-00000000000a",
  boq11Component: "65000000-0000-4000-8000-00000000000b",
  boqWbs: "65000000-0000-4000-8000-00000000000c",
  boqAllocation: "65000000-0000-4000-8000-00000000000d",
  boqExclusion: "65000000-0000-4000-8000-00000000000e",
  otherBoq: "65100000-0000-4000-8000-000000000001",
  otherSection: "65100000-0000-4000-8000-000000000002",
  otherBoqLine: "65100000-0000-4000-8000-000000000003",
  otherBoqComponent: "65100000-0000-4000-8000-000000000004",
  quantityLink: "66000000-0000-4000-8000-000000000001",
  boqLink: "66000000-0000-4000-8000-000000000002",
  secondBoqLink: "66000000-0000-4000-8000-000000000003",
  materialLink: "66000000-0000-4000-8000-000000000004",
  materialPlan: "67000000-0000-4000-8000-000000000001",
  existingMaterialPlan: "67000000-0000-4000-8000-000000000002",
  order: "67000000-0000-4000-8000-000000000003",
  receipt: "67000000-0000-4000-8000-000000000004",
  carbon: "67000000-0000-4000-8000-000000000005",
  otherMaterialPlan: "67100000-0000-4000-8000-000000000001",
});

export const p6Sha = Object.freeze({
  drawing: "a".repeat(64),
  price: "b".repeat(64),
  legacySource: "c".repeat(64),
  result: "d".repeat(64),
  manifest: "e".repeat(64),
  handoff: "4".repeat(64),
  receipt: "f".repeat(64),
  epd: "1".repeat(64),
  other: "2".repeat(64),
  otherDrawing: "5".repeat(64),
});

const p6HistoricalMigrationNames = Object.freeze({
  verifiedBoq: [
    "20260820025118_verified_boq_v1.sql",
    "20260820040254_verified_boq_security_hardening.sql",
  ],
  p4Core: "20260824110000_drawing_workspace_core.sql",
  p4Semantic: "20260826123529_drawing_workspace_p4_semantic_objects.sql",
  p4Contract:
    "20260826132102_drawing_workspace_p4_semantic_object_contract_fixes.sql",
  p5Evidence: "20260827045411_drawing_workspace_p5_evidence_authority.sql",
  materialCurrent: [
    "20260815051818_material_site_events.sql",
    "20260815052116_epd_provenance.sql",
  ],
});

const style = Object.freeze({ stroke: "#111111", strokeWidth: 1, fill: null });
const wallGeometry = Object.freeze({
  type: "wall",
  semanticVersion: 1,
  start: { x: 0, y: 0 },
  end: { x: 3000, y: 4000 },
  thicknessMillimeters: 200,
  heightMillimeters: 3000,
});
const openingGeometry = Object.freeze({
  type: "opening",
  semanticVersion: 1,
  hostWallId: p6Ids.wall,
  offsetMillimeters: 2500,
  widthMillimeters: 900,
  heightMillimeters: 2100,
  sillHeightMillimeters: 0,
  openingKind: "door",
});
const spaceGeometry = Object.freeze({
  type: "space",
  semanticVersion: 1,
  boundary: [
    { x: 0, y: 0 },
    { x: 4000, y: 0 },
    { x: 4000, y: 3000 },
    { x: 0, y: 3000 },
  ],
  number: "101",
  finishes: { floor: "tile", wall: null, ceiling: "paint" },
});
const otherWallGeometry = Object.freeze({
  type: "wall",
  semanticVersion: 1,
  start: { x: 0, y: 0 },
  end: { x: 1000, y: 0 },
  thicknessMillimeters: 100,
  heightMillimeters: 2400,
});

const snapshotObject = (id, lineageId, name, type, geometry) => ({
  id,
  lineageId,
  pageId: p6Ids.page,
  layerId: p6Ids.layer,
  name,
  type,
  geometry,
  styleId: null,
  style,
  version: 1,
});

const p6CanonicalSnapshot = Object.freeze({
  schemaVersion: 2,
  revisionId: p6Ids.revision,
  revisionVersion: 7,
  operationSequence: 12,
  pages: [
    {
      id: p6Ids.page,
      revisionId: p6Ids.revision,
      name: "A-101",
      sortOrder: 0,
      version: 1,
    },
  ],
  canvases: [
    {
      id: p6Ids.canvas,
      pageId: p6Ids.page,
      name: "Paper",
      spaceKind: "paper",
      widthMillimeters: 420,
      heightMillimeters: 297,
      background: null,
      sortOrder: 0,
      version: 1,
    },
  ],
  layers: [
    {
      id: p6Ids.layer,
      pageId: p6Ids.page,
      canvasId: p6Ids.canvas,
      name: "Work",
      sortOrder: 1,
      visible: true,
      locked: false,
      systemKind: "work",
      version: 1,
    },
  ],
  objects: [
    snapshotObject(p6Ids.wall, p6Ids.wall, "W-01", "wall", wallGeometry),
    snapshotObject(
      p6Ids.opening,
      p6Ids.opening,
      "D-01",
      "opening",
      openingGeometry,
    ),
    snapshotObject(p6Ids.space, p6Ids.space, "R-101", "space", spaceGeometry),
  ],
});

const p6OtherCanonicalSnapshot = Object.freeze({
  schemaVersion: 2,
  revisionId: p6Ids.otherRevision,
  revisionVersion: 3,
  operationSequence: 4,
  pages: [
    {
      id: p6Ids.otherPage,
      revisionId: p6Ids.otherRevision,
      name: "OA-101",
      sortOrder: 0,
      version: 1,
    },
  ],
  canvases: [
    {
      id: p6Ids.otherCanvas,
      pageId: p6Ids.otherPage,
      name: "Other paper",
      spaceKind: "paper",
      widthMillimeters: 420,
      heightMillimeters: 297,
      background: null,
      sortOrder: 0,
      version: 1,
    },
  ],
  layers: [
    {
      id: p6Ids.otherLayer,
      pageId: p6Ids.otherPage,
      canvasId: p6Ids.otherCanvas,
      name: "Other work",
      sortOrder: 1,
      visible: true,
      locked: false,
      systemKind: "work",
      version: 1,
    },
  ],
  objects: [
    {
      id: p6Ids.otherWall,
      lineageId: p6Ids.otherWall,
      pageId: p6Ids.otherPage,
      layerId: p6Ids.otherLayer,
      name: "OW-01",
      type: "wall",
      geometry: otherWallGeometry,
      styleId: null,
      style,
      version: 1,
    },
  ],
});

export const p6LegacyInput = Object.freeze({
  versionId: p6Ids.legacyApprovedBoq,
  calculationPolicy: "general_half_away",
  quantityScale: 6,
  lines: [
    {
      id: p6Ids.boqLine,
      sectionCode: "S-01",
      itemCode: "I-001",
      itemName: "Wall finish",
      specification: "12.5T",
      unit: "m2",
      signedAdjustment: "0",
      adjustmentReason: "",
    },
  ],
  mappings: [
    {
      id: p6Ids.mapping,
      lineId: p6Ids.boqLine,
      sourceFileId: p6Ids.legacySourceFile,
      sourceSha256: p6Sha.legacySource,
      subjectKey: "wall-finish",
      sourceQuantity: "10",
      factor: "1",
      unit: "m2",
      elementIds: ["1"],
    },
  ],
  exclusions: [],
  resources: [
    {
      id: p6Ids.materialResource,
      code: "M-001",
      type: "material",
      unitPriceKrw: "1250",
    },
  ],
  components: [
    {
      id: p6Ids.component,
      lineId: p6Ids.boqLine,
      resourceId: p6Ids.materialResource,
      coefficient: "1.5",
    },
  ],
});

// Minimal P0 table DDL needed by this isolated fixture. Exact current P4/P5
// guards, source constraints/RLS, Verified BOQ, and material migrations are
// applied from their historical files below; this string is not a claim that
// the fixture reproduces unrelated current-schema surfaces.
const p6CurrentAuthoritySql = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema private;
create schema extensions;
create schema storage;
create extension pgcrypto with schema extensions;

create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable set search_path='' as $$
  select nullif(pg_catalog.current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable set search_path='' as $$
  select coalesce(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
$$;
create function storage.foldername(text) returns text[] language sql immutable as $$
  select pg_catalog.string_to_array($1,'/')
$$;
grant usage on schema auth,private to authenticated,service_role;
grant execute on function auth.uid(),auth.jwt() to authenticated,service_role;

create table public.lukas_qto_projects(
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  name text not null,
  description text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);
create table public.lukas_qto_project_members(
  project_id uuid not null references public.lukas_qto_projects(id),
  user_id uuid not null references auth.users(id),
  role text not null check(role in ('owner','estimator','reviewer','site','procurement','viewer')),
  created_at timestamptz not null default pg_catalog.now(),
  primary key(project_id,user_id)
);
create table public.lukas_qto_files(
  id uuid primary key,
  project_id uuid not null references public.lukas_qto_projects(id),
  uploaded_by uuid not null references auth.users(id),
  kind text not null check(kind in ('ifc','pdf','rvt','qto_csv','element_ledger','formwork_ledger','estimate','mapping','other')),
  storage_path text not null unique,
  original_filename text not null,
  content_type text,
  byte_size bigint not null check(byte_size>=0),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  immutable boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  unique(id,project_id,sha256)
);
create function private.lukas_qto_project_role(p_project_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case
    when (select auth.jwt()->'app_metadata'->>'role')='hangil_staff' then 'staff'
    when p.owner_id=(select auth.uid()) then 'owner'
    else (select m.role from public.lukas_qto_project_members m
      where m.project_id=p.id and m.user_id=(select auth.uid()))
  end from public.lukas_qto_projects p where p.id=p_project_id
$$;
create function private.lukas_qto_verified_session()
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce((select (auth.jwt()->>'is_anonymous')::boolean),false)=false
$$;
revoke all on function private.lukas_qto_project_role(uuid),private.lukas_qto_verified_session() from public,anon;
grant execute on function private.lukas_qto_project_role(uuid),private.lukas_qto_verified_session() to authenticated,service_role;

create table public.lukas_drawing_documents(
  id uuid primary key,project_id uuid not null references public.lukas_qto_projects(id),
  source_file_id uuid,source_sha256 text,title text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),updated_at timestamptz not null default pg_catalog.now(),
  unique(id,project_id),foreign key(source_file_id,project_id,source_sha256)
    references public.lukas_qto_files(id,project_id,sha256)
);
create table public.lukas_drawing_revisions(
  id uuid primary key,document_id uuid not null,project_id uuid not null references public.lukas_qto_projects(id),
  parent_revision_id uuid,sequence integer not null,status text not null
    check(status in ('draft','review_requested','approved','superseded')),
  version bigint not null check(version>0),created_by uuid not null references auth.users(id),
  review_requested_at timestamptz,approved_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),updated_at timestamptz not null default pg_catalog.now(),
  unique(id,project_id),unique(id,document_id,project_id),
  foreign key(document_id,project_id) references public.lukas_drawing_documents(id,project_id)
);
create table public.lukas_drawing_pages(
  id uuid primary key,revision_id uuid not null,project_id uuid not null references public.lukas_qto_projects(id),
  name text not null,page_number integer not null,width_mm numeric(18,6) not null,height_mm numeric(18,6) not null,
  sort_order integer not null,version bigint not null,
  unique(id,revision_id,project_id),foreign key(revision_id,project_id)
    references public.lukas_drawing_revisions(id,project_id)
);
create table public.lukas_drawing_canvases(
  id uuid primary key,page_id uuid not null,revision_id uuid not null,project_id uuid not null,
  name text not null,space_kind text not null,width_mm numeric(18,6) not null,height_mm numeric(18,6) not null,
  sort_order integer not null,version bigint not null,created_by uuid not null references auth.users(id),
  unique(id,revision_id,project_id),unique(id,page_id,revision_id,project_id),
  foreign key(page_id,revision_id,project_id) references public.lukas_drawing_pages(id,revision_id,project_id)
);
create table public.lukas_drawing_layers(
  id uuid primary key,page_id uuid not null,canvas_id uuid not null,revision_id uuid not null,project_id uuid not null,
  name text not null,sort_order integer not null,visible boolean not null,locked boolean not null,
  system_kind text not null,version bigint not null,created_by uuid not null references auth.users(id),
  unique(id,revision_id,project_id),
  foreign key(canvas_id,page_id,revision_id,project_id)
    references public.lukas_drawing_canvases(id,page_id,revision_id,project_id)
);
create table public.lukas_drawing_objects(
  id uuid primary key,lineage_id uuid not null,page_id uuid not null,layer_id uuid not null,
  revision_id uuid not null,project_id uuid not null references public.lukas_qto_projects(id),
  name text not null,object_type text not null,geometry jsonb not null,style_id uuid,style jsonb not null,
  status text not null check(status in ('active','deleted')),version bigint not null,
  created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),updated_at timestamptz not null default pg_catalog.now(),
  host_object_id uuid generated always as (
    case when object_type='opening' then (geometry->>'hostWallId')::uuid end
  ) stored,
  unique(id,revision_id,project_id),unique(revision_id,lineage_id),
  foreign key(page_id,revision_id,project_id) references public.lukas_drawing_pages(id,revision_id,project_id),
  foreign key(layer_id,revision_id,project_id) references public.lukas_drawing_layers(id,revision_id,project_id),
  foreign key(host_object_id,revision_id,project_id) references public.lukas_drawing_objects(id,revision_id,project_id)
    deferrable initially deferred
);
create table public.lukas_drawing_snapshots(
  id uuid primary key,revision_id uuid not null,project_id uuid not null references public.lukas_qto_projects(id),
  revision_version bigint not null,operation_sequence bigint not null,canonical_json jsonb not null,
  sha256 text not null,created_by uuid not null references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),schema_version smallint not null,
  unique(revision_id,revision_version),unique(revision_id,project_id,revision_version,sha256),
  foreign key(revision_id,project_id) references public.lukas_drawing_revisions(id,project_id)
);
create table public.lukas_drawing_revision_approvals(
  id uuid primary key,revision_id uuid not null,project_id uuid not null,
  subject_version bigint not null,snapshot_sha256 text not null,
  decision text not null check(decision in ('approved','rejected')),note text not null default '',
  decided_by uuid not null references auth.users(id),created_at timestamptz not null default pg_catalog.now(),
  unique(revision_id,subject_version),foreign key(revision_id,project_id,subject_version,snapshot_sha256)
    references public.lukas_drawing_snapshots(revision_id,project_id,revision_version,sha256)
);
create table public.lukas_drawing_issues(
  id uuid primary key,project_id uuid not null references public.lukas_qto_projects(id),unique(id,project_id)
);
create table public.lukas_drawing_object_sources(
  id uuid primary key,object_id uuid not null,revision_id uuid not null,project_id uuid not null,
  source_file_id uuid not null,source_sha256 text not null,source_kind text not null,
  pdf_page_number integer,x numeric(12,10),y numeric(12,10),width numeric(12,10),height numeric(12,10),
  element_id text,ifc_global_id text,camera_json jsonb,status text not null default 'active',
  version bigint not null default 1,created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  foreign key(object_id,revision_id,project_id) references public.lukas_drawing_objects(id,revision_id,project_id),
  foreign key(source_file_id,project_id,source_sha256) references public.lukas_qto_files(id,project_id,sha256)
);
create table public.lukas_drawing_object_issue_links(
  id uuid primary key,object_id uuid not null,revision_id uuid not null,issue_id uuid not null,
  project_id uuid not null,created_by uuid not null references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),unique(object_id,issue_id),
  foreign key(object_id,revision_id,project_id) references public.lukas_drawing_objects(id,revision_id,project_id),
  foreign key(issue_id,project_id) references public.lukas_drawing_issues(id,project_id)
);

create or replace function private.lukas_drawing_p2_uuid(p_value jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(pg_catalog.jsonb_typeof(p_value)='string' and p_value#>>'{}' ~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',false)
$$;
`;

const p6MaterialCurrentColumnsSql = `
alter table public.lukas_qto_material_plans
  add column source_artifact_id uuid,
  add column source_group_key text;
`;

const p6OptInDefaultPrivilegesSql = `
alter default privileges revoke execute on functions from public;
alter default privileges revoke all on tables from public;
`;

const p6AuthorityExtracts = Object.freeze({
  p4Core: [
    "create or replace function private.lukas_drawing_point_valid",
    "create or replace function private.lukas_drawing_document_guard",
  ],
  p4Semantic: [
    "create function private.lukas_drawing_p4_number_valid",
    "create or replace function private.lukas_drawing_p2_property_schema_json_valid",
  ],
  p4Contract: [
    "create function private.lukas_drawing_p4_utf16_string_valid",
    "alter function private.lukas_drawing_apply_operation",
  ],
  p4Capability: [
    "create or replace function private.lukas_drawing_workspace_capability",
    "create or replace function private.lukas_drawing_create_document",
  ],
  p4RevisionGuard: [
    "create or replace function private.lukas_drawing_revision_guard()",
    "create or replace function private.lukas_drawing_draft_child_guard",
  ],
  p4DraftGuard: [
    "create or replace function private.lukas_drawing_draft_child_guard",
    "create trigger lukas_drawing_pages_revision_guard",
  ],
  p4DraftTriggers: [
    "create trigger lukas_drawing_pages_revision_guard",
    "create or replace function private.lukas_drawing_draft_child_insert_guard",
  ],
  p4SourceTriggers: [
    "create trigger lukas_drawing_object_sources_domain_guard",
    "create or replace function private.lukas_drawing_revision_approval_guard",
  ],
  p5Camera: [
    "create or replace function private.lukas_drawing_p5_camera_valid",
    "update public.lukas_drawing_object_sources",
  ],
  p5SourceConstraints: [
    "alter table public.lukas_drawing_object_sources\n  add constraint lukas_drawing_object_sources_exact_payload_check",
    "create or replace function private.lukas_drawing_source_json",
  ],
  p5SourceGuard: [
    "create or replace function private.lukas_drawing_object_source_guard()",
    "alter table public.lukas_drawing_issue_anchors",
  ],
  p5SourceRls: [
    'drop policy if exists "workspace editors add draft drawing object sources"',
    "revoke all on function\n  private.lukas_drawing_p5_camera_valid",
  ],
  materialBase: [
    "create table if not exists public.lukas_qto_carbon_factors",
    "-- Field evidence stays private",
  ],
});

function extractSql(source, [startMarker, endMarker], name) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start)
    throw new Error(`Unable to extract ${name} authority SQL`);
  return source.slice(start, end);
}

export async function readP6Migration() {
  const names = (await readdir(p6MigrationDirectory)).filter((name) =>
    name.endsWith("_drawing_workspace_p6_lineage.sql"),
  );
  if (
    names.length !== 1 ||
    names[0] !== "20260827210000_drawing_workspace_p6_lineage.sql"
  )
    throw new Error(`Unexpected P6 migration set: ${names.join(",")}`);
  const [authority, primitiveParity] = await Promise.all([
    readFile(new URL(names[0], p6MigrationDirectory), "utf8"),
    readFile(
      new URL(
        "20260902002000_drawing_p6_primitive_measurement_parity.sql",
        p6MigrationDirectory,
      ),
      "utf8",
    ),
  ]);
  return `${authority}\n${primitiveParity}`;
}

export async function readRelevantMigrations() {
  const readSupabase = (name) =>
    readFile(new URL(name, p6MigrationDirectory), "utf8");
  const [
    p4CoreSource,
    p4SemanticSource,
    p4ContractSource,
    p5EvidenceSource,
    materialSource,
  ] = await Promise.all([
    readSupabase(p6HistoricalMigrationNames.p4Core),
    readSupabase(p6HistoricalMigrationNames.p4Semantic),
    readSupabase(p6HistoricalMigrationNames.p4Contract),
    readSupabase(p6HistoricalMigrationNames.p5Evidence),
    readFile(p6MaterialMigration, "utf8"),
  ]);
  return {
    p4Core: extractSql(p4CoreSource, p6AuthorityExtracts.p4Core, "P4 core"),
    p4Semantic: extractSql(
      p4SemanticSource,
      p6AuthorityExtracts.p4Semantic,
      "P4 semantic",
    ),
    p4Contract: extractSql(
      p4ContractSource,
      p6AuthorityExtracts.p4Contract,
      "P4 contract",
    ),
    p4CurrentGuards: [
      extractSql(
        p4CoreSource,
        p6AuthorityExtracts.p4Capability,
        "P4 workspace capability",
      ),
      extractSql(
        p4CoreSource,
        p6AuthorityExtracts.p4RevisionGuard,
        "P4 revision guard",
      ),
      extractSql(
        p4CoreSource,
        p6AuthorityExtracts.p4DraftGuard,
        "P4 draft child guard",
      ),
      extractSql(
        p4CoreSource,
        p6AuthorityExtracts.p4DraftTriggers,
        "P4 draft child triggers",
      ),
    ],
    p5CurrentSources: [
      extractSql(
        p5EvidenceSource,
        p6AuthorityExtracts.p5Camera,
        "P5 camera validator",
      ),
      extractSql(
        p5EvidenceSource,
        p6AuthorityExtracts.p5SourceConstraints,
        "P5 source constraints",
      ),
      extractSql(
        p5EvidenceSource,
        p6AuthorityExtracts.p5SourceGuard,
        "P5 source guard",
      ),
      extractSql(
        p4CoreSource,
        p6AuthorityExtracts.p4SourceTriggers,
        "P4 source triggers",
      ),
      `alter table public.lukas_drawing_object_sources enable row level security;\n${extractSql(
        p5EvidenceSource,
        p6AuthorityExtracts.p5SourceRls,
        "P5 source RLS",
      )}`,
    ],
    materialBase: extractSql(
      materialSource,
      p6AuthorityExtracts.materialBase,
      "material base",
    ),
    materialCurrent: await Promise.all(
      p6HistoricalMigrationNames.materialCurrent.map(readSupabase),
    ),
    verifiedBoq: await Promise.all(
      p6HistoricalMigrationNames.verifiedBoq.map(readSupabase),
    ),
  };
}

export async function applyP6AuthorityFixture(
  db,
  { createRoles = true, optIn = false } = {},
) {
  const migrations = await readRelevantMigrations();
  await db.exec(
    createRoles
      ? p6CurrentAuthoritySql
      : p6CurrentAuthoritySql.replace(
          /^\s*create role anon nologin;\ncreate role authenticated nologin;\ncreate role service_role nologin bypassrls;/,
          "\n",
        ),
  );
  await db.exec(migrations.p4Core);
  await db.exec(migrations.p4Semantic);
  await db.exec(migrations.p4Contract);
  for (const sql of migrations.p4CurrentGuards) await db.exec(sql);
  for (const sql of migrations.p5CurrentSources) await db.exec(sql);
  await db.exec(migrations.materialBase);
  await db.exec(p6MaterialCurrentColumnsSql);
  for (const sql of migrations.materialCurrent) await db.exec(sql);
  for (const sql of migrations.verifiedBoq) await db.exec(sql);
  if (optIn) await db.exec(p6OptInDefaultPrivilegesSql);
}

export function p6MaterialPayload() {
  return {
    plans: [
      {
        id: p6Ids.materialPlan,
        materialResourceId: p6Ids.materialResource,
        materialCode: "M-001",
        materialName: "Gypsum board",
        specification: "12.5T",
        unit: "m2",
        designQuantity: "5",
        allowanceRate: "0",
        requiredQuantity: "5",
        ruleId: "P6_MATERIAL_HANDOFF_V1",
      },
    ],
    links: [
      {
        id: p6Ids.materialLink,
        boqLineId: p6Ids.boq11Line,
        boqRateComponentId: p6Ids.boq11Component,
        materialResourceId: p6Ids.materialResource,
        materialPlanId: p6Ids.materialPlan,
        derivedDesignQuantity: "5",
      },
    ],
  };
}

export async function p6SeedBoq11Draft(db) {
  await p6SetSession(db, null, p6Ids.maker);
  await db.query(
    `insert into public.lukas_qto_boq_versions(
      id,project_id,version_no,title,status,calculation_policy,quantity_scale,
      price_book_id,engine_version,created_by,created_at
    ) values($1,$2,4,'Drawing BOQ 1.1','draft','general_half_away',6,$3,
      'VERIFIED-BOQ-1.1',$4,'2026-08-08T00:00:00Z')`,
    [p6Ids.boq11, p6Ids.project, p6Ids.priceBook, p6Ids.maker],
  );
  await db.query(
    `insert into public.lukas_qto_boq_sections(
      id,project_id,version_id,parent_id,code,name,sort_order,created_by,created_at
    ) values($1,$2,$3,null,'S-11','Drawing',0,$4,'2026-08-08T00:00:00Z')`,
    [p6Ids.boq11Section, p6Ids.project, p6Ids.boq11, p6Ids.maker],
  );
  await db.query(
    `insert into public.lukas_qto_boq_lines(
      id,project_id,version_id,section_id,item_code,item_name,specification,unit,
      signed_adjustment,adjustment_reason,sort_order,created_by,created_at
    ) values($1,$2,$3,$4,'I-011','Drawing wall','12.5T','m',0,'',0,$5,
      '2026-08-08T00:00:00Z')`,
    [
      p6Ids.boq11Line,
      p6Ids.project,
      p6Ids.boq11,
      p6Ids.boq11Section,
      p6Ids.maker,
    ],
  );
  await db.query(
    `insert into public.lukas_qto_boq_rate_components(
      id,project_id,version_id,line_id,resource_id,coefficient,created_by,created_at
    ) values($1,$2,$3,$4,$5,1,$6,'2026-08-08T00:00:00Z')`,
    [
      p6Ids.boq11Component,
      p6Ids.project,
      p6Ids.boq11,
      p6Ids.boq11Line,
      p6Ids.materialResource,
      p6Ids.maker,
    ],
  );
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export const p6WallFingerprint = createHash("sha256")
  .update(
    canonicalJson({
      geometry: wallGeometry,
      id: p6Ids.wall,
      name: "W-01",
      version: 1,
    }),
  )
  .digest("hex");

export const p6OpeningFingerprint = createHash("sha256")
  .update(
    canonicalJson({
      geometry: openingGeometry,
      id: p6Ids.opening,
      name: "D-01",
      version: 1,
    }),
  )
  .digest("hex");

export const p6SpaceFingerprint = createHash("sha256")
  .update(
    canonicalJson({
      geometry: spaceGeometry,
      id: p6Ids.space,
      name: "R-101",
      version: 1,
    }),
  )
  .digest("hex");

export const p6OtherWallFingerprint = createHash("sha256")
  .update(
    canonicalJson({
      geometry: otherWallGeometry,
      id: p6Ids.otherWall,
      name: "OW-01",
      version: 1,
    }),
  )
  .digest("hex");

export async function p6SetSession(
  db,
  role,
  userId = null,
  { anonymous = false, staff = false } = {},
) {
  await db.exec("reset role");
  if (userId) {
    await db.query(
      "select pg_catalog.set_config('request.jwt.claim.sub',$1,false)",
      [userId],
    );
    await db.query(
      "select pg_catalog.set_config('request.jwt.claims',$1,false)",
      [
        JSON.stringify({
          sub: userId,
          is_anonymous: anonymous,
          app_metadata: staff ? { role: "hangil_staff" } : {},
        }),
      ],
    );
  } else {
    await db.exec(`select pg_catalog.set_config('request.jwt.claim.sub','',false);
      select pg_catalog.set_config('request.jwt.claims','{}',false);`);
  }
  if (role) await db.exec(`set role ${role}`);
}

export async function p6SeedPopulatedAuthority(db, legacyResult) {
  await p6SetSession(db, null);
  await db.query(
    `insert into auth.users(id) select value::uuid
     from pg_catalog.jsonb_array_elements_text($1::jsonb)`,
    [
      JSON.stringify([
        p6Ids.owner,
        p6Ids.maker,
        p6Ids.reviewer,
        p6Ids.viewer,
        p6Ids.commenter,
        p6Ids.outsider,
        p6Ids.anonymous,
        p6Ids.otherOwner,
        p6Ids.otherMaker,
      ]),
    ],
  );
  await db.query(
    `insert into public.lukas_qto_projects(id,owner_id,name,description,created_at,updated_at)
     values($1,$2,'P6 authority','fixture','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z'),
       ($3,$4,'Other authority','fixture','2026-08-01T00:00:00Z','2026-08-01T00:00:00Z')`,
    [p6Ids.project, p6Ids.owner, p6Ids.otherProject, p6Ids.otherOwner],
  );
  await db.query(
    `insert into public.lukas_qto_project_members(project_id,user_id,role,created_at) values
      ($1,$2,'owner','2026-08-01T00:00:00Z'),($1,$3,'estimator','2026-08-01T00:00:00Z'),
      ($1,$4,'reviewer','2026-08-01T00:00:00Z'),($1,$5,'viewer','2026-08-01T00:00:00Z'),
      ($1,$6,'site','2026-08-01T00:00:00Z'),($7,$8,'owner','2026-08-01T00:00:00Z'),
      ($7,$9,'estimator','2026-08-01T00:00:00Z')`,
    [
      p6Ids.project,
      p6Ids.owner,
      p6Ids.maker,
      p6Ids.reviewer,
      p6Ids.viewer,
      p6Ids.commenter,
      p6Ids.otherProject,
      p6Ids.otherOwner,
      p6Ids.otherMaker,
    ],
  );
  const files = [
    [
      p6Ids.drawingFile,
      p6Ids.project,
      p6Ids.owner,
      "pdf",
      "p6/drawing.pdf",
      "drawing.pdf",
      p6Sha.drawing,
    ],
    [
      p6Ids.priceFile,
      p6Ids.project,
      p6Ids.maker,
      "other",
      "p6/price.csv",
      "price.csv",
      p6Sha.price,
    ],
    [
      p6Ids.legacySourceFile,
      p6Ids.project,
      p6Ids.maker,
      "qto_csv",
      "p6/qto.csv",
      "qto.csv",
      p6Sha.legacySource,
    ],
    [
      p6Ids.manifestFile,
      p6Ids.project,
      p6Ids.maker,
      "other",
      `p6/boq-manifests/${p6Sha.handoff}.manifest.json`,
      "approved.manifest.json",
      p6Sha.handoff,
    ],
    [
      p6Ids.receiptFile,
      p6Ids.project,
      p6Ids.commenter,
      "other",
      "p6/receipt.pdf",
      "receipt.pdf",
      p6Sha.receipt,
    ],
    [
      p6Ids.epdFile,
      p6Ids.project,
      p6Ids.maker,
      "other",
      "p6/epd.pdf",
      "epd.pdf",
      p6Sha.epd,
    ],
    [
      p6Ids.otherFile,
      p6Ids.otherProject,
      p6Ids.otherMaker,
      "other",
      "other/file.bin",
      "file.bin",
      p6Sha.other,
    ],
    [
      p6Ids.otherDrawingFile,
      p6Ids.otherProject,
      p6Ids.otherOwner,
      "pdf",
      "other/drawing.pdf",
      "drawing.pdf",
      p6Sha.otherDrawing,
    ],
    [
      p6Ids.otherManifestFile,
      p6Ids.otherProject,
      p6Ids.otherMaker,
      "other",
      `other/boq-manifests/${p6Sha.handoff}.manifest.json`,
      "approved.manifest.json",
      p6Sha.handoff,
    ],
  ];
  for (const row of files)
    await db.query(
      `insert into public.lukas_qto_files(
        id,project_id,uploaded_by,kind,storage_path,original_filename,
        content_type,byte_size,sha256,immutable,created_at
      ) values($1,$2,$3,$4,$5,$6,'application/octet-stream',128,$7,true,'2026-08-01T00:00:00Z')`,
      row,
    );

  await db.query(
    `insert into public.lukas_drawing_documents(
      id,project_id,source_file_id,source_sha256,title,created_by,created_at,updated_at
    ) values($1,$2,$3,$4,'Approved drawing',$5,'2026-08-02T00:00:00Z','2026-08-02T00:00:00Z')`,
    [
      p6Ids.document,
      p6Ids.project,
      p6Ids.drawingFile,
      p6Sha.drawing,
      p6Ids.owner,
    ],
  );
  await db.query(
    `insert into public.lukas_drawing_revisions(
      id,document_id,project_id,sequence,status,version,created_by,
      review_requested_at,approved_at,created_at,updated_at
    ) values($1,$2,$3,1,'approved',7,$4,'2026-08-03T00:00:00Z','2026-08-04T00:00:00Z',
      '2026-08-02T00:00:00Z','2026-08-04T00:00:00Z')`,
    [p6Ids.revision, p6Ids.document, p6Ids.project, p6Ids.owner],
  );
  await db.query(
    `insert into public.lukas_drawing_pages(
      id,revision_id,project_id,name,page_number,width_mm,height_mm,sort_order,version
    ) values($1,$2,$3,'A-101',1,420,297,0,1)`,
    [p6Ids.page, p6Ids.revision, p6Ids.project],
  );
  await db.query(
    `insert into public.lukas_drawing_canvases(
      id,page_id,revision_id,project_id,name,space_kind,width_mm,height_mm,sort_order,version,created_by
    ) values($1,$2,$3,$4,'Paper','paper',420,297,0,1,$5)`,
    [p6Ids.canvas, p6Ids.page, p6Ids.revision, p6Ids.project, p6Ids.owner],
  );
  await db.query(
    `insert into public.lukas_drawing_layers(
      id,page_id,canvas_id,revision_id,project_id,name,sort_order,visible,locked,system_kind,version,created_by
    ) values($1,$2,$3,$4,$5,'Work',1,true,false,'work',1,$6)`,
    [
      p6Ids.layer,
      p6Ids.page,
      p6Ids.canvas,
      p6Ids.revision,
      p6Ids.project,
      p6Ids.owner,
    ],
  );
  for (const object of [
    [p6Ids.wall, "W-01", "wall", wallGeometry],
    [p6Ids.opening, "D-01", "opening", openingGeometry],
    [p6Ids.space, "R-101", "space", spaceGeometry],
  ])
    await db.query(
      `insert into public.lukas_drawing_objects(
        id,lineage_id,page_id,layer_id,revision_id,project_id,name,object_type,
        geometry,style_id,style,status,version,created_by,updated_by,created_at,updated_at
      ) values($1,$1,$2,$3,$4,$5,$6,$7,$8::jsonb,null,$9::jsonb,'active',1,$10,$10,
        '2026-08-02T00:00:00Z','2026-08-04T00:00:00Z')`,
      [
        object[0],
        p6Ids.page,
        p6Ids.layer,
        p6Ids.revision,
        p6Ids.project,
        object[1],
        object[2],
        JSON.stringify(object[3]),
        JSON.stringify(style),
        p6Ids.owner,
      ],
    );
  const [digest] = (
    await db.query(
      `select pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to($1::jsonb::text,'UTF8'),'sha256'),'hex') sha`,
      [JSON.stringify(p6CanonicalSnapshot)],
    )
  ).rows;
  await db.query(
    `insert into public.lukas_drawing_snapshots(
      id,revision_id,project_id,revision_version,operation_sequence,canonical_json,
      sha256,created_by,created_at,schema_version
    ) values($1,$2,$3,7,12,$4::jsonb,$5,$6,'2026-08-04T00:00:00Z',2)`,
    [
      p6Ids.snapshot,
      p6Ids.revision,
      p6Ids.project,
      JSON.stringify(p6CanonicalSnapshot),
      digest.sha,
      p6Ids.owner,
    ],
  );
  await db.query(
    `insert into public.lukas_drawing_revision_approvals(
      id,revision_id,project_id,subject_version,snapshot_sha256,decision,note,decided_by,created_at
    ) values($1,$2,$3,7,$4,'approved','checked',$5,'2026-08-04T00:00:00Z')`,
    [
      p6Ids.drawingApproval,
      p6Ids.revision,
      p6Ids.project,
      digest.sha,
      p6Ids.reviewer,
    ],
  );
  await db.query(
    `insert into public.lukas_drawing_issues(id,project_id) values($1,$2)`,
    [p6Ids.issue, p6Ids.project],
  );
  await p6SetSession(db, null, p6Ids.owner);
  await db.query(
    `select pg_catalog.set_config(
      'private.lukas_drawing_source_operation',$1,false
    )`,
    [p6Ids.revision],
  );
  await db.query(
    `insert into public.lukas_drawing_object_sources(
      id,object_id,revision_id,project_id,source_file_id,source_sha256,source_kind,
      pdf_page_number,x,y,width,height,status,version,created_by,updated_by,created_at,updated_at
    ) values($1,$2,$3,$4,$5,$6,'pdf_region',1,0.1,0.1,0.2,0.2,'active',1,$7,$7,
      '2026-08-02T00:00:00Z','2026-08-02T00:00:00Z')`,
    [
      p6Ids.objectSource,
      p6Ids.wall,
      p6Ids.revision,
      p6Ids.project,
      p6Ids.drawingFile,
      p6Sha.drawing,
      p6Ids.owner,
    ],
  );
  await db.exec(
    `select pg_catalog.set_config('private.lukas_drawing_source_operation','',false)`,
  );
  await db.query(
    `insert into public.lukas_drawing_object_issue_links(
      id,object_id,revision_id,issue_id,project_id,created_by,created_at
    ) values($1,$2,$3,$4,$5,$6,'2026-08-02T00:00:00Z')`,
    [
      p6Ids.issueLink,
      p6Ids.wall,
      p6Ids.revision,
      p6Ids.issue,
      p6Ids.project,
      p6Ids.owner,
    ],
  );

  await db.query(
    `insert into public.lukas_drawing_documents(
      id,project_id,source_file_id,source_sha256,title,created_by,created_at,updated_at
    ) values($1,$2,$3,$4,'Other approved drawing',$5,
      '2026-08-02T00:00:00Z','2026-08-02T00:00:00Z')`,
    [
      p6Ids.otherDocument,
      p6Ids.otherProject,
      p6Ids.otherDrawingFile,
      p6Sha.otherDrawing,
      p6Ids.otherOwner,
    ],
  );
  await db.query(
    `insert into public.lukas_drawing_revisions(
      id,document_id,project_id,sequence,status,version,created_by,
      review_requested_at,approved_at,created_at,updated_at
    ) values($1,$2,$3,1,'approved',3,$4,
      '2026-08-03T00:00:00Z','2026-08-04T00:00:00Z',
      '2026-08-02T00:00:00Z','2026-08-04T00:00:00Z')`,
    [
      p6Ids.otherRevision,
      p6Ids.otherDocument,
      p6Ids.otherProject,
      p6Ids.otherMaker,
    ],
  );
  await db.query(
    `insert into public.lukas_drawing_pages(
      id,revision_id,project_id,name,page_number,width_mm,height_mm,sort_order,version
    ) values($1,$2,$3,'A-201',1,420,297,0,1)`,
    [p6Ids.otherPage, p6Ids.otherRevision, p6Ids.otherProject],
  );
  await db.query(
    `insert into public.lukas_drawing_canvases(
      id,page_id,revision_id,project_id,name,space_kind,width_mm,height_mm,
      sort_order,version,created_by
    ) values($1,$2,$3,$4,'Paper','paper',420,297,0,1,$5)`,
    [
      p6Ids.otherCanvas,
      p6Ids.otherPage,
      p6Ids.otherRevision,
      p6Ids.otherProject,
      p6Ids.otherOwner,
    ],
  );
  await db.query(
    `insert into public.lukas_drawing_layers(
      id,page_id,canvas_id,revision_id,project_id,name,sort_order,visible,
      locked,system_kind,version,created_by
    ) values($1,$2,$3,$4,$5,'Work',1,true,false,'work',1,$6)`,
    [
      p6Ids.otherLayer,
      p6Ids.otherPage,
      p6Ids.otherCanvas,
      p6Ids.otherRevision,
      p6Ids.otherProject,
      p6Ids.otherOwner,
    ],
  );
  await db.query(
    `insert into public.lukas_drawing_objects(
      id,lineage_id,page_id,layer_id,revision_id,project_id,name,object_type,
      geometry,style_id,style,status,version,created_by,updated_by,created_at,updated_at
    ) values($1,$1,$2,$3,$4,$5,'OW-01','wall',$6::jsonb,null,$7::jsonb,
      'active',1,$8,$8,'2026-08-02T00:00:00Z','2026-08-04T00:00:00Z')`,
    [
      p6Ids.otherWall,
      p6Ids.otherPage,
      p6Ids.otherLayer,
      p6Ids.otherRevision,
      p6Ids.otherProject,
      JSON.stringify(otherWallGeometry),
      JSON.stringify(style),
      p6Ids.otherOwner,
    ],
  );
  const [otherDigest] = (
    await db.query(
      `select pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to($1::jsonb::text,'UTF8'),'sha256'),'hex') sha`,
      [JSON.stringify(p6OtherCanonicalSnapshot)],
    )
  ).rows;
  await db.query(
    `insert into public.lukas_drawing_snapshots(
      id,revision_id,project_id,revision_version,operation_sequence,canonical_json,
      sha256,created_by,created_at,schema_version
    ) values($1,$2,$3,3,4,$4::jsonb,$5,$6,'2026-08-04T00:00:00Z',2)`,
    [
      p6Ids.otherSnapshot,
      p6Ids.otherRevision,
      p6Ids.otherProject,
      JSON.stringify(p6OtherCanonicalSnapshot),
      otherDigest.sha,
      p6Ids.otherOwner,
    ],
  );
  await db.query(
    `insert into public.lukas_drawing_revision_approvals(
      id,revision_id,project_id,subject_version,snapshot_sha256,decision,
      note,decided_by,created_at
    ) values($1,$2,$3,3,$4,'approved','checked',$5,'2026-08-04T00:00:00Z')`,
    [
      p6Ids.otherDrawingApproval,
      p6Ids.otherRevision,
      p6Ids.otherProject,
      otherDigest.sha,
      p6Ids.otherOwner,
    ],
  );

  await p6SetSession(db, null, p6Ids.maker);
  await db.query(
    `insert into public.lukas_qto_price_books(
      id,project_id,name,version_label,effective_date,currency,rights_basis,
      license_note,source_file_id,source_sha256,created_by,created_at
    ) values($1,$2,'Fixture prices','2026-08','2026-08-01','KRW','customer_owned',
      'fixture',$3,$4,$5,'2026-08-05T00:00:00Z')`,
    [p6Ids.priceBook, p6Ids.project, p6Ids.priceFile, p6Sha.price, p6Ids.maker],
  );
  await db.query(
    `insert into public.lukas_qto_price_resources(
      id,project_id,price_book_id,resource_code,resource_type,resource_name,
      specification,unit,unit_price_krw,created_by,created_at
    ) values($1,$2,$3,'M-001','material','Gypsum board','12.5T','m2',1250,$4,'2026-08-05T00:00:00Z')`,
    [p6Ids.materialResource, p6Ids.project, p6Ids.priceBook, p6Ids.maker],
  );
  await p6SetSession(db, null, p6Ids.otherMaker);
  await db.query(
    `insert into public.lukas_qto_price_books(
      id,project_id,name,version_label,effective_date,currency,rights_basis,
      license_note,source_file_id,source_sha256,created_by,created_at
    ) values($1,$2,'Other prices','2026-08','2026-08-01','KRW',
      'customer_owned','fixture',$3,$4,$5,'2026-08-05T00:00:00Z')`,
    [
      p6Ids.otherPriceBook,
      p6Ids.otherProject,
      p6Ids.otherFile,
      p6Sha.other,
      p6Ids.otherMaker,
    ],
  );
  await db.query(
    `insert into public.lukas_qto_price_resources(
      id,project_id,price_book_id,resource_code,resource_type,resource_name,
      specification,unit,unit_price_krw,created_by,created_at
    ) values($1,$2,$3,'OM-001','material','Other board','9T','m2',900,$4,
      '2026-08-05T00:00:00Z')`,
    [
      p6Ids.otherMaterialResource,
      p6Ids.otherProject,
      p6Ids.otherPriceBook,
      p6Ids.otherMaker,
    ],
  );
  await db.query(
    `insert into public.lukas_qto_boq_versions(
      id,project_id,version_no,title,status,calculation_policy,quantity_scale,
      price_book_id,engine_version,created_by,created_at
    ) values($1,$2,1,'Other draft','draft','general_half_away',6,$3,
      'VERIFIED-BOQ-1.0',$4,'2026-08-05T00:00:00Z')`,
    [
      p6Ids.otherBoq,
      p6Ids.otherProject,
      p6Ids.otherPriceBook,
      p6Ids.otherMaker,
    ],
  );
  await db.query(
    `insert into public.lukas_qto_boq_sections(
      id,project_id,version_id,parent_id,code,name,sort_order,created_by,created_at
    ) values($1,$2,$3,null,'OS-01','Other',0,$4,'2026-08-05T00:00:00Z')`,
    [p6Ids.otherSection, p6Ids.otherProject, p6Ids.otherBoq, p6Ids.otherMaker],
  );
  await db.query(
    `insert into public.lukas_qto_boq_lines(
      id,project_id,version_id,section_id,item_code,item_name,specification,unit,
      signed_adjustment,adjustment_reason,sort_order,created_by,created_at
    ) values($1,$2,$3,$4,'OI-001','Other wall','9T','m2',0,'',0,$5,
      '2026-08-05T00:00:00Z')`,
    [
      p6Ids.otherBoqLine,
      p6Ids.otherProject,
      p6Ids.otherBoq,
      p6Ids.otherSection,
      p6Ids.otherMaker,
    ],
  );
  await db.query(
    `insert into public.lukas_qto_boq_rate_components(
      id,project_id,version_id,line_id,resource_id,coefficient,created_by,created_at
    ) values($1,$2,$3,$4,$5,1,$6,'2026-08-05T00:00:00Z')`,
    [
      p6Ids.otherBoqComponent,
      p6Ids.otherProject,
      p6Ids.otherBoq,
      p6Ids.otherBoqLine,
      p6Ids.otherMaterialResource,
      p6Ids.otherMaker,
    ],
  );
  await p6SetSession(db, null, p6Ids.maker);
  await db.query(
    `insert into public.lukas_qto_boq_versions(
      id,project_id,version_no,title,status,calculation_policy,quantity_scale,
      price_book_id,engine_version,created_by,created_at
    ) values($1,$2,1,'Approved 1.0','draft','general_half_away',6,$3,'VERIFIED-BOQ-1.0',$4,'2026-08-05T00:00:00Z'),
      ($5,$2,2,'Draft 1.0','draft','general_half_away',6,$3,'VERIFIED-BOQ-1.0',$4,'2026-08-06T00:00:00Z'),
      ($6,$2,3,'Rejected 1.0','draft','general_half_away',6,$3,'VERIFIED-BOQ-1.0',$4,'2026-08-07T00:00:00Z')`,
    [
      p6Ids.legacyApprovedBoq,
      p6Ids.project,
      p6Ids.priceBook,
      p6Ids.maker,
      p6Ids.legacyDraftBoq,
      p6Ids.legacyRejectedBoq,
    ],
  );
  await db.query(
    `insert into public.lukas_qto_boq_sections(
      id,project_id,version_id,parent_id,code,name,sort_order,created_by,created_at
    ) values($1,$2,$3,null,'S-01','Finishes',0,$4,'2026-08-05T00:00:00Z')`,
    [p6Ids.section, p6Ids.project, p6Ids.legacyApprovedBoq, p6Ids.maker],
  );
  await db.query(
    `insert into public.lukas_qto_boq_lines(
      id,project_id,version_id,section_id,item_code,item_name,specification,unit,
      signed_adjustment,adjustment_reason,sort_order,created_by,created_at
    ) values($1,$2,$3,$4,'I-001','Wall finish','12.5T','m2',0,'',0,$5,'2026-08-05T00:00:00Z')`,
    [
      p6Ids.boqLine,
      p6Ids.project,
      p6Ids.legacyApprovedBoq,
      p6Ids.section,
      p6Ids.maker,
    ],
  );
  await db.query(
    `insert into public.lukas_qto_boq_quantity_mappings(
      id,project_id,version_id,line_id,source_file_id,source_sha256,
      source_subject_key,source_quantity,factor,unit,element_ids,created_by,created_at
    ) values($1,$2,$3,$4,$5,$6,'wall-finish',10,1,'m2',array['1'],$7,'2026-08-05T00:00:00Z')`,
    [
      p6Ids.mapping,
      p6Ids.project,
      p6Ids.legacyApprovedBoq,
      p6Ids.boqLine,
      p6Ids.legacySourceFile,
      p6Sha.legacySource,
      p6Ids.maker,
    ],
  );
  await db.query(
    `insert into public.lukas_qto_boq_rate_components(
      id,project_id,version_id,line_id,resource_id,coefficient,created_by,created_at
    ) values($1,$2,$3,$4,$5,1.5,$6,'2026-08-05T00:00:00Z')`,
    [
      p6Ids.component,
      p6Ids.project,
      p6Ids.legacyApprovedBoq,
      p6Ids.boqLine,
      p6Ids.materialResource,
      p6Ids.maker,
    ],
  );
  await db.query(
    `insert into public.lukas_qto_boq_wbs_nodes(
      id,project_id,version_id,parent_id,code,name,sort_order,created_by,created_at
    ) values($1,$2,$3,null,'W-01','Approved WBS',0,$4,'2026-08-05T00:00:00Z')`,
    [p6Ids.boqWbs, p6Ids.project, p6Ids.legacyApprovedBoq, p6Ids.maker],
  );
  await db.query(
    `insert into public.lukas_qto_boq_wbs_allocations(
      id,project_id,version_id,line_id,wbs_node_id,allocation_percent,
      created_by,created_at
    ) values($1,$2,$3,$4,$5,100,$6,'2026-08-05T00:00:00Z')`,
    [
      p6Ids.boqAllocation,
      p6Ids.project,
      p6Ids.legacyApprovedBoq,
      p6Ids.boqLine,
      p6Ids.boqWbs,
      p6Ids.maker,
    ],
  );
  await db.query(
    `insert into public.lukas_qto_boq_source_exclusions(
      id,project_id,version_id,source_file_id,source_sha256,source_subject_key,
      source_quantity,unit,element_ids,reason,created_by,created_at
    ) values($1,$2,$3,$4,$5,'excluded-subject',1,'m2',array['2'],
      'not in scope',$6,'2026-08-05T00:00:00Z')`,
    [
      p6Ids.boqExclusion,
      p6Ids.project,
      p6Ids.legacyApprovedBoq,
      p6Ids.legacySourceFile,
      p6Sha.legacySource,
      p6Ids.maker,
    ],
  );
  await db.query(
    `update public.lukas_qto_boq_versions set status='in_review',result_sha256=$2,
      direct_cost_krw=$3,line_count=$4 where id=$1`,
    [
      p6Ids.legacyApprovedBoq,
      legacyResult.canonicalSha256,
      legacyResult.directCostKrw,
      legacyResult.lines.length,
    ],
  );
  await p6SetSession(db, null, p6Ids.reviewer);
  await db.query(
    `select public.lukas_qto_decide_boq($1,'approved','approved fixture')`,
    [p6Ids.legacyApprovedBoq],
  );
  await p6SetSession(db, null, p6Ids.maker);
  await db.query(
    `update public.lukas_qto_boq_versions set status='in_review',result_sha256=$2,
      direct_cost_krw=0,line_count=0 where id=$1`,
    [p6Ids.legacyRejectedBoq, "3".repeat(64)],
  );
  await p6SetSession(db, null, p6Ids.reviewer);
  await db.query(
    `select public.lukas_qto_decide_boq($1,'rejected','fix quantities')`,
    [p6Ids.legacyRejectedBoq],
  );

  await p6SetSession(db, null, p6Ids.maker);
  await db.query(
    `insert into public.lukas_qto_carbon_factors(
      id,project_id,material_code,product_name,manufacturer,declared_unit,
      gwp_a1_a3_per_unit,source_type,standard,geography,valid_from,valid_until,
      source_file_id,source_sha256,created_by,created_at
    ) values($1,$2,'M-001','Generic gypsum','','m2',2.5,'generic','ISO 14040','KR',
      '2026-01-01',null,$3,$4,$5,'2026-08-05T00:00:00Z')`,
    [p6Ids.carbon, p6Ids.project, p6Ids.epdFile, p6Sha.epd, p6Ids.maker],
  );
  await db.query(
    `insert into public.lukas_qto_material_plans(
      id,project_id,material_code,material_name,specification,unit,design_quantity,
      allowance_rate,required_quantity,rule_id,required_by,source_file_id,source_sha256,
      baseline_factor_id,created_by,created_at,source_artifact_id,source_group_key
    ) values($1,$2,'M-001','Gypsum board','12.5T','m2',10,0,10,'EXISTING_RULE',
      '2026-09-01',$3,$4,$5,$6,'2026-08-05T00:00:00Z',null,null)`,
    [
      p6Ids.existingMaterialPlan,
      p6Ids.project,
      p6Ids.legacySourceFile,
      p6Sha.legacySource,
      p6Ids.carbon,
      p6Ids.maker,
    ],
  );
  await db.query(
    `insert into public.lukas_qto_material_plans(
      id,project_id,material_code,material_name,specification,unit,
      design_quantity,allowance_rate,required_quantity,rule_id,required_by,
      source_file_id,source_sha256,baseline_factor_id,created_by,created_at,
      source_artifact_id,source_group_key
    ) values($1,$2,'OM-001','Other board','9T','m2',3,0,3,'EXISTING_RULE',
      null,$3,$4,null,$5,'2026-08-05T00:00:00Z',null,null)`,
    [
      p6Ids.otherMaterialPlan,
      p6Ids.otherProject,
      p6Ids.otherManifestFile,
      p6Sha.handoff,
      p6Ids.otherMaker,
    ],
  );
  await db.query(
    `insert into public.lukas_qto_material_transactions(
      id,project_id,material_plan_id,transaction_type,document_number,supplier_name,
      occurred_on,quantity,related_order_id,carbon_factor_id,evidence_file_id,evidence_sha256,
      received_by_name,site_acknowledgement,note,created_by,created_at,event_location
    ) values($1,$2,$3,'purchase_order','PO-1','Supplier','2026-08-10',10,null,$4,null,null,
      '',false,'ordered',$5,'2026-08-10T00:00:00Z',''),
      ($6,$2,$3,'goods_receipt','GR-1','Supplier','2026-08-11',10,$1,$4,$7,$8,
      'Receiver',true,'received',$5,'2026-08-11T00:00:00Z','Gate A')`,
    [
      p6Ids.order,
      p6Ids.project,
      p6Ids.existingMaterialPlan,
      p6Ids.carbon,
      p6Ids.maker,
      p6Ids.receipt,
      p6Ids.receiptFile,
      p6Sha.receipt,
    ],
  );
  await p6SetSession(db, null);
  return {
    snapshotSha256: digest.sha,
    otherSnapshotSha256: otherDigest.sha,
    legacyResult,
  };
}
