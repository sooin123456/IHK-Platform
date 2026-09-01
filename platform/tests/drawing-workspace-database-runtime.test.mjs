import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createServer } from "vite";
import {
  invalidP4Geometries,
  invalidP4PropertySchemas,
  p4ObjectNameCorpus,
  p4PersistedExactNameConsumers,
  p4FixtureIds,
  p4Object,
  validP4Geometries,
  validP4PropertySchemas,
} from "./fixtures/drawing-workspace-p4-database-fixtures.mjs";

const OWNER = "00000000-0000-4000-8000-000000000001";
const REVIEWER = "00000000-0000-4000-8000-000000000002";
const OUTSIDER = "00000000-0000-4000-8000-000000000003";
const EDITOR = "00000000-0000-4000-8000-000000000004";
const PROJECT = "10000000-0000-4000-8000-000000000001";
const ORGANIZATION = "10000000-0000-4000-8000-000000000010";
const PDF = "20000000-0000-4000-8000-000000000001";
const PDF_SHA = "a".repeat(64);
const STYLE = { stroke: "#112233", strokeWidth: 1, fill: null };

let db;

const migration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260824110000_drawing_workspace_core.sql",
      import.meta.url,
    ),
    "utf8",
  );
const upgradeMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260824113000_drawing_workspace_layers_inspector_upgrade.sql",
      import.meta.url,
    ),
    "utf8",
  );
const issueLinkMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260824135829_drawing_workspace_issue_links.sql",
      import.meta.url,
    ),
    "utf8",
  );
const releaseHardeningMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260824154700_drawing_workspace_release_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2Migration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825010814_drawing_workspace_p2_structure.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2HardeningMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825033000_drawing_workspace_p2_contract_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2LegacyLayerBackfillMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825030000_drawing_workspace_p2_legacy_layer_backfill.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2CompatibilityMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825040000_drawing_workspace_p2_compatibility_gaps.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2HistoryReconciliationMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825050000_drawing_workspace_p2_history_reconciliation.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2NavigationHardeningMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825100000_drawing_workspace_p2_navigation_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2StyleGuardSqlstateMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825110000_drawing_workspace_style_guard_sqlstate.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2BlockExactnessMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825120000_drawing_workspace_block_exactness.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2TemplateSnapshotGuardMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825130000_drawing_workspace_template_snapshot_guard.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2TemplateCloneIdempotencyMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825140000_drawing_workspace_template_clone_idempotency.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2BlockInstanceLineageMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825150000_drawing_workspace_block_instance_lineage.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2TemplateSnapshotAuthorityMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825160000_drawing_workspace_template_snapshot_authority.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2LegacyTemplateSnapshotCloneMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825170000_drawing_workspace_legacy_template_snapshot_clone.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2LineageSnapshotWriterMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825180000_drawing_workspace_lineage_snapshot_writer.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2TemplateCloneSecurityMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825190000_drawing_workspace_template_clone_security.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p3CollaborationStateMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825192113_drawing_workspace_p3_collaboration_state.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p3CollaborationStateFenceMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825193714_drawing_workspace_p3_collaboration_state_fence.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p2TemplateCloneFinalLedgerMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825200000_drawing_workspace_template_clone_final_ledger.sql",
      import.meta.url,
    ),
    "utf8",
  );
const task9ContractFixesMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825210000_drawing_workspace_task9_contract_fixes.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p3ServiceAuthorityMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825210528_drawing_workspace_p3_collaboration_service_authority.sql",
      import.meta.url,
    ),
    "utf8",
  );
const collaborationHistoryLineageMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260825234510_drawing_collaboration_history_lineage.sql",
      import.meta.url,
    ),
    "utf8",
  );
const collaborationHistoryAuthorityMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260826002019_drawing_collaboration_history_authority.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p3MentionsHistoryMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260826020804_drawing_workspace_p3_mentions_history.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p3ActivityAuthorityMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260826025543_drawing_workspace_p3_activity_authority.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p3CheckpointReferenceAuthorityMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260826041744_drawing_workspace_p3_checkpoint_reference_authority.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p3ReviewFreezeMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260826043741_drawing_workspace_p3_review_freeze.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p3ReviewRejectionRecoveryMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260826052305_drawing_workspace_p3_review_rejection_recovery.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p3CrossInstanceFreezeLeaseMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260826063603_drawing_workspace_p3_cross_instance_freeze_lease.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p3PreloadStoreFenceMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260826073708_drawing_workspace_p3_preload_store_fence.sql",
      import.meta.url,
    ),
    "utf8",
  );
const m1CollaborationServiceStoreMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260901112430_m1_collaboration_service_store_state.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p4SemanticObjectsMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260826123529_drawing_workspace_p4_semantic_objects.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p4SemanticContractFixesMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260826132102_drawing_workspace_p4_semantic_object_contract_fixes.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p4FinalContractFixesMigration = async () => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const names = (await readdir(directory)).filter((name) =>
    name.endsWith("_drawing_workspace_p4_final_contract_fixes.sql"),
  );
  assert.equal(names.length, 1);
  return readFile(new URL(names[0], directory), "utf8");
};
const p4FinalNameAuthorityMigration = async () => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const names = (await readdir(directory)).filter((name) =>
    name.endsWith("_drawing_workspace_p4_final_name_authority.sql"),
  );
  assert.equal(names.length, 1);
  return readFile(new URL(names[0], directory), "utf8");
};
const p5EvidenceAuthorityMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260827045411_drawing_workspace_p5_evidence_authority.sql",
      import.meta.url,
    ),
    "utf8",
  );
const p5RevisionRelinkAuthorityMigration = async () => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const names = (await readdir(directory)).filter((name) =>
    name.endsWith("_drawing_workspace_p5_revision_relink_authority.sql"),
  );
  assert.equal(names.length, 1);
  return readFile(new URL(names[0], directory), "utf8");
};
const p7OrganizationLibraryMigration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260827231130_organization_drawing_libraries.sql",
      import.meta.url,
    ),
    "utf8",
  );

async function applyP0ThroughP3Migrations(targetDb) {
  for (const readMigration of [
    migration,
    upgradeMigration,
    issueLinkMigration,
    releaseHardeningMigration,
    p2Migration,
    p2LegacyLayerBackfillMigration,
    p2HardeningMigration,
    p2CompatibilityMigration,
    p2HistoryReconciliationMigration,
    p2NavigationHardeningMigration,
    p2StyleGuardSqlstateMigration,
    p2BlockExactnessMigration,
    p2TemplateSnapshotGuardMigration,
    p2TemplateCloneIdempotencyMigration,
    p2BlockInstanceLineageMigration,
    p2TemplateSnapshotAuthorityMigration,
    p2LegacyTemplateSnapshotCloneMigration,
    p2LineageSnapshotWriterMigration,
    p2TemplateCloneSecurityMigration,
    p3CollaborationStateMigration,
    p3CollaborationStateFenceMigration,
    p2TemplateCloneFinalLedgerMigration,
    task9ContractFixesMigration,
    p3ServiceAuthorityMigration,
    collaborationHistoryLineageMigration,
    collaborationHistoryAuthorityMigration,
    p3MentionsHistoryMigration,
    p3ActivityAuthorityMigration,
    p3CheckpointReferenceAuthorityMigration,
    p3ReviewFreezeMigration,
    p3ReviewRejectionRecoveryMigration,
    p3CrossInstanceFreezeLeaseMigration,
    p3PreloadStoreFenceMigration,
    m1CollaborationServiceStoreMigration,
  ]) {
    await targetDb.exec(await readMigration());
  }
}

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const drawingCommands = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-commands.ts",
);
const drawingTypes = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-workspace.types.ts",
);
const drawingBlocks = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-blocks.ts",
);
const drawingProperties = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-properties.ts",
);
const workspaceServer = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-workspace.server.ts",
);
const drawingOutbox = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-outbox.ts",
);
const { DrawingInspector } = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-inspector.tsx",
);
const { DrawingStylesPanel } = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-styles-panel.tsx",
);
const {
  DrawingBlocksPanel,
  DrawingBlockInstancesList,
  drawingBlockInstancesForCanvas,
} = await vite.ssrLoadModule("/app/lukas/components/drawing-blocks-panel.tsx");
const { deriveDrawingTransientState } = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-document-store.ts",
);
const { DrawingLayersPanel } = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-layers-panel.tsx",
);
const { buildDrawingPerformanceFixture } = await vite.ssrLoadModule(
  "/e2e/utils/drawing-collaboration-fixture.ts",
);
const { drawingFittedViewport, drawingSelectionHitBounds } =
  await vite.ssrLoadModule("/app/lukas/components/drawing-canvas.client.tsx");
const { worldToScreen, zoomViewportAroundPointer } = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-geometry.ts",
);

const foundationSql = `
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create publication supabase_realtime;
    create schema auth;
    create schema private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable set search_path = '' as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;
    grant usage on schema private to authenticated, service_role;

    create table public.lukas_qto_organizations(
      id uuid primary key,
      name text not null,
      owner_id uuid not null references auth.users(id),
      is_personal boolean not null default false,
      created_at timestamptz not null default now()
    );
    create table public.lukas_qto_organization_members(
      organization_id uuid not null references public.lukas_qto_organizations(id),
      user_id uuid not null references auth.users(id),
      role text not null,
      created_at timestamptz not null default now(),
      primary key(organization_id,user_id)
    );
    create function private.lukas_qto_organization_role(p_organization_id uuid)
    returns text language sql stable security definer set search_path='' as $$
      select case when o.owner_id=(select auth.uid()) then 'owner'
        else (select m.role from public.lukas_qto_organization_members m
          where m.organization_id=o.id and m.user_id=(select auth.uid())) end
      from public.lukas_qto_organizations o where o.id=p_organization_id
    $$;

    create table public.lukas_qto_projects(
      id uuid primary key,
      owner_id uuid not null references auth.users(id),
      organization_id uuid references public.lukas_qto_organizations(id)
    );
    create table public.lukas_qto_project_members(
      project_id uuid not null references public.lukas_qto_projects(id),
      user_id uuid not null references auth.users(id),
      role text not null,
      primary key(project_id, user_id)
    );
    create table public.lukas_qto_files(
      id uuid primary key,
      project_id uuid not null references public.lukas_qto_projects(id),
      uploaded_by uuid not null references auth.users(id),
      kind text not null,
      sha256 text not null,
      immutable boolean not null default true,
      unique(id, project_id, sha256)
    );
    create table public.lukas_qto_file_revisions(
      id uuid primary key default gen_random_uuid(),
      project_id uuid not null references public.lukas_qto_projects(id),
      previous_file_id uuid not null,
      previous_sha256 text not null,
      current_file_id uuid not null,
      current_sha256 text not null,
      relation_kind text not null default 'supersedes',
      created_by uuid not null references auth.users(id),
      created_at timestamptz not null default now(),
      foreign key(previous_file_id,project_id,previous_sha256)
        references public.lukas_qto_files(id,project_id,sha256),
      foreign key(current_file_id,project_id,current_sha256)
        references public.lukas_qto_files(id,project_id,sha256)
    );
    create table public.lukas_drawing_issues(
      id uuid primary key,
      project_id uuid not null references public.lukas_qto_projects(id),
      unique(id, project_id)
    );
    create table public.lukas_drawing_issue_anchors(
      id uuid primary key default gen_random_uuid(),
      issue_id uuid not null,
      project_id uuid not null references public.lukas_qto_projects(id),
      file_id uuid not null references public.lukas_qto_files(id),
      anchor_kind text not null,
      element_id text,
      ifc_global_id text,
      camera_json jsonb,
      page_number integer,
      x numeric(12,10), y numeric(12,10),
      width numeric(12,10), height numeric(12,10),
      label text not null default '',
      active boolean not null default true,
      created_by uuid not null references auth.users(id),
      created_at timestamptz not null default now(),
      deactivated_by uuid references auth.users(id),
      deactivated_at timestamptz,
      deactivation_note text,
      foreign key(issue_id,project_id)
        references public.lukas_drawing_issues(id,project_id)
    );
    grant select,insert,update on public.lukas_drawing_issue_anchors
      to authenticated,service_role;
    create table public.lukas_drawing_issue_comments(
      id uuid primary key,
      issue_id uuid not null,
      project_id uuid not null references public.lukas_qto_projects(id),
      author_id uuid not null references auth.users(id),
      body text not null,
      created_at timestamptz not null default now(),
      foreign key(issue_id,project_id)
        references public.lukas_drawing_issues(id,project_id)
    );
    create table public.lukas_drawing_issue_events(
      id uuid primary key default gen_random_uuid(),
      issue_id uuid not null,
      project_id uuid not null references public.lukas_qto_projects(id),
      actor_id uuid references auth.users(id),
      event_type text not null,
      from_value jsonb,
      to_value jsonb,
      note text not null default '',
      created_at timestamptz not null default now(),
      unique(id,project_id),
      foreign key(issue_id,project_id)
        references public.lukas_drawing_issues(id,project_id)
    );
    create table public.lukas_drawing_notifications(
      id uuid primary key default gen_random_uuid(),
      project_id uuid not null references public.lukas_qto_projects(id),
      issue_id uuid not null,
      event_id uuid not null references public.lukas_drawing_issue_events(id),
      user_id uuid not null references auth.users(id),
      read_at timestamptz,
      created_at timestamptz not null default now(),
      unique(event_id,user_id),
      foreign key(issue_id,project_id)
        references public.lukas_drawing_issues(id,project_id)
    );
    create function private.lukas_qto_project_role(p_project_id uuid)
    returns text language sql stable security definer set search_path = '' as $$
      select case
        when p.owner_id = (select auth.uid()) then 'owner'
        else (select m.role from public.lukas_qto_project_members m
          where m.project_id = p.id and m.user_id = (select auth.uid()))
      end
      from public.lukas_qto_projects p where p.id = p_project_id
    $$;
    revoke all on function private.lukas_qto_project_role(uuid) from public, anon;
    grant execute on function private.lukas_qto_project_role(uuid)
      to authenticated, service_role;
    grant select on public.lukas_qto_projects, public.lukas_qto_project_members,
      public.lukas_qto_files, public.lukas_qto_file_revisions,
      public.lukas_drawing_issues to authenticated;
`;

async function asActor(actor) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    actor,
  ]);
}

async function createDocument(title = randomUUID()) {
  await asActor(OWNER);
  const result = await db.query(
    "select public.lukas_drawing_create_document($1,null,$2,true) result",
    [PROJECT, title],
  );
  return result.rows[0].result;
}

async function persistCollaborationState(revisionId) {
  const state = Buffer.from([0]);
  const sha = createHash("sha256").update(state).digest("hex");
  await db.exec("reset role");
  await db.query(
    `insert into private.lukas_drawing_collaboration_states(
      revision_id,project_id,schema_version,yjs_state,yjs_sha256,
      base_operation_sequence,store_generation,byte_size,persisted_at
    ) values($1,$2,1,$3::bytea,$4,0,1,1,clock_timestamp())`,
    [revisionId, PROJECT, state, sha],
  );
  await db.exec("set role lukas_drawing_collaboration");
}

async function applyOperation(
  revisionId,
  operationType,
  baseVersions,
  forward,
  inverse,
) {
  const result = await db.query(
    `select public.lukas_drawing_apply_operation($1,$2,$3,$4,$5,$6) result`,
    [revisionId, randomUUID(), operationType, baseVersions, forward, inverse],
  );
  return result.rows[0].result;
}

const applyStructure = (ids, baseVersions, actions, inverseActions) =>
  applyOperation(
    ids.revisionId,
    "mutate_structure",
    baseVersions,
    { type: "mutate_structure", actions },
    { type: "mutate_structure", actions: inverseActions },
  );

async function applyOperationWithId(
  revisionId,
  clientOperationId,
  operationType,
  baseVersions,
  forward,
  inverse,
) {
  const result = await db.query(
    `select public.lukas_drawing_apply_operation($1,$2,$3,$4,$5,$6) result`,
    [
      revisionId,
      clientOperationId,
      operationType,
      baseVersions,
      forward,
      inverse,
    ],
  );
  return result.rows[0].result;
}

const circleObject = (id, layerId, overrides = {}) => ({
  id,
  name: "Circle",
  layerId,
  geometry: { type: "circle", center: { x: 10, y: 20 }, radius: 5 },
  style: STYLE,
  version: 1,
  ...overrides,
});

async function addObject(ids, object) {
  return applyOperation(
    ids.revisionId,
    "add_objects",
    {},
    { type: "add_objects", objects: [object] },
    { type: "delete_objects", objectIds: [object.id] },
  );
}

async function createPersistedBlockInstance(ids, label) {
  const source = {
    ...circleObject(randomUUID(), ids.workLayerId),
    styleId: null,
  };
  await addObject(ids, source);
  const block = {
    id: randomUUID(),
    revisionId: ids.revisionId,
    name: label,
    primitives: [
      {
        localId: "local-a",
        name: source.name,
        geometry: source.geometry,
        styleId: null,
        style: source.style,
      },
    ],
    version: 1,
  };
  const instance = {
    id: randomUUID(),
    lineageId: null,
    blockId: block.id,
    layerId: ids.workLayerId,
    name: label,
    origin: { x: 0, y: 0 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  };
  instance.lineageId = instance.id;
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    { [source.id]: 1 },
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_block", entity: block, baseVersion: null },
        { kind: "put_block_instance", entity: instance, baseVersion: null },
        { kind: "delete_object", id: source.id, baseVersion: 1 },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_object", entity: source, baseVersion: null },
        { kind: "delete_block_instance", id: instance.id, baseVersion: 1 },
        { kind: "delete_block", id: block.id, baseVersion: 1 },
      ],
    },
  );
  return { block, instance };
}

async function localP2State(ids) {
  const [pages, canvases, layers] = await Promise.all([
    db.query(
      `select id,revision_id "revisionId",name,sort_order "sortOrder",version from public.lukas_drawing_pages where revision_id=$1`,
      [ids.revisionId],
    ),
    db.query(
      `select id,page_id "pageId",name,space_kind "spaceKind",width_mm "widthMillimeters",height_mm "heightMillimeters",sort_order "sortOrder",version from public.lukas_drawing_canvases where revision_id=$1`,
      [ids.revisionId],
    ),
    db.query(
      `select id,name,visible,locked,system_kind "systemKind",canvas_id "canvasId",sort_order "sortOrder",version from public.lukas_drawing_layers where revision_id=$1`,
      [ids.revisionId],
    ),
  ]);
  return drawingCommands.createDrawingDocumentState({
    revisionId: ids.revisionId,
    structure: {
      pages: Object.fromEntries(pages.rows.map((row) => [row.id, row])),
      canvases: Object.fromEntries(
        canvases.rows.map((row) => [row.id, { ...row, background: null }]),
      ),
      layers: Object.fromEntries(layers.rows.map((row) => [row.id, row])),
      objects: {},
      styles: {},
      blocks: {},
      blockInstances: {},
      propertySchemas: {},
      propertyValues: {},
      tables: {},
    },
  });
}

function runtimeOutboxAdapter() {
  const records = new Map();
  let sequence = 0;
  return {
    async claimLegacy() {
      return 0;
    },
    async delete(id) {
      records.delete(id);
    },
    async enqueue(entry) {
      const stored = { ...entry, enqueueSequence: ++sequence };
      records.set(entry.operation.clientOperationId, stored);
      return stored;
    },
    async list() {
      return structuredClone([...records.values()]);
    },
    async put(entry) {
      records.set(entry.operation.clientOperationId, structuredClone(entry));
    },
  };
}

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(foundationSql);
  await applyP0ThroughP3Migrations(db);
  await db.exec(await p4SemanticObjectsMigration());
  await db.exec(await p4SemanticContractFixesMigration());
  await db.exec(await p4FinalContractFixesMigration());
  await db.exec(await p4FinalNameAuthorityMigration());
  await db.exec(await p5EvidenceAuthorityMigration());
  await db.exec(await p5RevisionRelinkAuthorityMigration());
  await db.exec(await p7OrganizationLibraryMigration());
  await db.query("insert into auth.users(id) values ($1),($2),($3),($4)", [
    OWNER,
    REVIEWER,
    OUTSIDER,
    EDITOR,
  ]);
  await db.query(
    `insert into public.lukas_qto_organizations(id,name,owner_id)
     values($1,'1HK',$2)`,
    [ORGANIZATION, OWNER],
  );
  await db.query(
    `insert into public.lukas_qto_organization_members(organization_id,user_id,role)
     values($1,$2,'owner')`,
    [ORGANIZATION, OWNER],
  );
  await db.query(
    `insert into public.lukas_qto_projects(id,owner_id,organization_id)
     values($1,$2,$3)`,
    [PROJECT, OWNER, ORGANIZATION],
  );
  await db.query(
    `insert into public.lukas_qto_project_members(project_id,user_id,role)
     values ($1,$2,'reviewer'),($1,$3,'estimator')`,
    [PROJECT, REVIEWER, EDITOR],
  );
  await db.query(
    `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256)
     values ($1,$2,$3,'pdf',$4)`,
    [PDF, PROJECT, OWNER, PDF_SHA],
  );
});

test("P4 forward migrations preserve populated P0-P3 state before semantic writes", async () => {
  const upgradeDb = new PGlite({ extensions: { pgcrypto } });
  const actor = async (actorId) => {
    await upgradeDb.exec("set role authenticated");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [actorId],
    );
  };
  const create = async (title, sourceFileId = null) => {
    await actor(OWNER);
    const result = await upgradeDb.query(
      "select public.lukas_drawing_create_document($1,$2,$3,true) result",
      [PROJECT, sourceFileId, title],
    );
    return result.rows[0].result;
  };
  const addPrimitive = async (ids, objectId) => {
    const object = circleObject(objectId, ids.workLayerId);
    const result = await upgradeDb.query(
      `select public.lukas_drawing_apply_operation(
        $1,$2,'add_objects','{}'::jsonb,$3,$4
      ) result`,
      [
        ids.revisionId,
        randomUUID(),
        { type: "add_objects", objects: [object] },
        { type: "delete_objects", objectIds: [object.id] },
      ],
    );
    return result.rows[0].result;
  };
  const evidence = async () => {
    await upgradeDb.exec("reset role");
    const result = await upgradeDb.query(
      `select pg_catalog.jsonb_build_object(
        'documents',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(d) order by d.id)
          from public.lukas_drawing_documents d),
        'revisions',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) order by r.id)
          from public.lukas_drawing_revisions r),
        'pages',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by p.id)
          from public.lukas_drawing_pages p),
        'canvases',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) order by c.id)
          from public.lukas_drawing_canvases c),
        'layers',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l) order by l.id)
          from public.lukas_drawing_layers l),
        'objects',(select pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(o)-'host_object_id' order by o.id)
          from public.lukas_drawing_objects o),
        'operations',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(o) order by o.id)
          from public.lukas_drawing_operations o),
        'snapshots',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.id)
          from public.lukas_drawing_snapshots s),
        'approvals',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) order by a.id)
          from public.lukas_drawing_revision_approvals a),
        'cloneRequests',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c) order by c.client_request_id)
          from private.lukas_drawing_template_clone_requests c),
        'sourceFile',(select pg_catalog.to_jsonb(f)
          from public.lukas_qto_files f where f.id=$1)
      ) evidence`,
      [PDF],
    );
    return result.rows[0].evidence;
  };

  try {
    await upgradeDb.exec(foundationSql);
    await applyP0ThroughP3Migrations(upgradeDb);
    await upgradeDb.query("insert into auth.users(id) values ($1),($2),($3)", [
      OWNER,
      REVIEWER,
      EDITOR,
    ]);
    await upgradeDb.query(
      "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
      [PROJECT, OWNER],
    );
    await upgradeDb.query(
      `insert into public.lukas_qto_project_members(project_id,user_id,role)
       values ($1,$2,'reviewer'),($1,$3,'estimator')`,
      [PROJECT, REVIEWER, EDITOR],
    );
    await upgradeDb.query(
      `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256)
       values ($1,$2,$3,'pdf',$4)`,
      [PDF, PROJECT, OWNER, PDF_SHA],
    );

    const draft = await create("Populated P3 draft");
    await addPrimitive(draft, "51000000-0000-4000-8000-000000000001");
    const requested = await create("Populated P3 review");
    await addPrimitive(requested, "51000000-0000-4000-8000-000000000002");
    await upgradeDb.query("select public.lukas_drawing_request_review($1)", [
      requested.revisionId,
    ]);
    const approved = await create("Populated P3 approved", PDF);
    await addPrimitive(approved, "51000000-0000-4000-8000-000000000003");
    const review = await upgradeDb.query(
      "select public.lukas_drawing_request_review($1) result",
      [approved.revisionId],
    );
    await actor(REVIEWER);
    await upgradeDb.query(
      `select public.lukas_drawing_record_revision_decision(
        $1,$2,$3,'approved','pre-P4 evidence'
      )`,
      [
        approved.revisionId,
        review.rows[0].result.subjectVersion,
        review.rows[0].result.snapshotSha256,
      ],
    );
    await actor(EDITOR);
    await upgradeDb.query(
      "select public.lukas_drawing_create_from_template($1,$2,null,$3)",
      [approved.revisionId, "Populated P3 clone", randomUUID()],
    );

    const beforeUpgrade = await evidence();

    await upgradeDb.exec(await p4SemanticObjectsMigration());
    await upgradeDb.exec(await p4SemanticContractFixesMigration());
    await upgradeDb.exec(await p4FinalContractFixesMigration());
    await upgradeDb.exec(await p4FinalNameAuthorityMigration());
    await upgradeDb.exec(await p5EvidenceAuthorityMigration());
    await upgradeDb.exec(await p5RevisionRelinkAuthorityMigration());

    const afterUpgrade = await evidence();
    assert.deepEqual(afterUpgrade, beforeUpgrade);
    const preserved = await upgradeDb.query(
      `select
        (select pg_catalog.jsonb_object_agg(status,count) from (
          select status,count(*)::int count from public.lukas_drawing_revisions
          group by status
        ) statuses) statuses,
        (select pg_catalog.bool_and(host_object_id is null)
          from public.lukas_drawing_objects) primitive_hosts_null,
        (select pg_catalog.bool_and((canonical_json->>'schemaVersion')::int=2
          and sha256~'^[0-9a-f]{64}$') from public.lukas_drawing_snapshots) snapshots_readable`,
    );
    assert.deepEqual(preserved.rows[0], {
      statuses: { approved: 1, draft: 2, review_requested: 1 },
      primitive_hosts_null: true,
      snapshots_readable: true,
    });

    await actor(OWNER);
    const wall = p4Object(
      "52000000-0000-4000-8000-000000000001",
      draft.workLayerId,
      validP4Geometries[0],
      "Upgrade wall",
    );
    const opening = p4Object(
      "52000000-0000-4000-8000-000000000002",
      draft.workLayerId,
      { ...validP4Geometries[1], hostWallId: wall.id },
      "Upgrade opening",
    );
    const boundarySpace = p4Object(
      "52000000-0000-4000-8000-000000000003",
      draft.workLayerId,
      validP4Geometries[8],
      "Upgrade boundary space",
    );
    await upgradeDb.query(
      `select public.lukas_drawing_apply_operation(
        $1,$2,'add_objects','{}'::jsonb,$3,$4
      )`,
      [
        draft.revisionId,
        randomUUID(),
        { type: "add_objects", objects: [wall, opening, boundarySpace] },
        {
          type: "delete_objects",
          objectIds: [wall.id, opening.id, boundarySpace.id],
        },
      ],
    );
    await upgradeDb.exec("reset role");
    const semantic = await upgradeDb.query(
      `select id,object_type,host_object_id,geometry
       from public.lukas_drawing_objects
       where id=any($1::uuid[]) order by id`,
      [[wall.id, opening.id, boundarySpace.id]],
    );
    assert.equal(semantic.rows.length, 3);
    assert.equal(semantic.rows[1].host_object_id, wall.id);
    assert.equal(semantic.rows[2].geometry.number.length, 255);
    for (const row of semantic.rows) {
      assert.equal(
        drawingTypes.DrawingGeometrySchema.safeParse(row.geometry).success,
        true,
        row.object_type,
      );
    }
  } finally {
    await upgradeDb.close();
  }
});

test("P5 upgrade preserves every legal P0-P4 source shape without inventing IFC identity", async () => {
  const upgradeDb = new PGlite({ extensions: { pgcrypto } });
  const ifcFile = randomUUID();
  const ifcSha = "7".repeat(64);
  const globalId = "0Q2gXl1Hn3fQ9A2W4k6M8P";
  const camera = { position: [1, 2, 3], target: [4, 5, 6] };
  const shapes = [
    { elementId: "42", globalId: null },
    { elementId: "legacy-element", globalId: null },
    { elementId: null, globalId },
    { elementId: "42", globalId },
    { elementId: "legacy-element", globalId },
  ].flatMap((identity) =>
    [null, camera, { legacy: true }].map((cameraShape) => ({
      ...identity,
      camera: cameraShape,
      expected:
        identity.globalId &&
        (identity.elementId === null || identity.elementId === "42") &&
        (cameraShape === null || cameraShape === camera)
          ? "active"
          : "deleted",
    })),
  );
  try {
    await upgradeDb.exec(foundationSql);
    await applyP0ThroughP3Migrations(upgradeDb);
    await upgradeDb.exec(await p4SemanticObjectsMigration());
    await upgradeDb.exec(await p4SemanticContractFixesMigration());
    await upgradeDb.exec(await p4FinalContractFixesMigration());
    await upgradeDb.exec(await p4FinalNameAuthorityMigration());
    await upgradeDb.query("insert into auth.users(id) values ($1)", [OWNER]);
    await upgradeDb.query(
      "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
      [PROJECT, OWNER],
    );
    await upgradeDb.query(
      `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256)
       values($1,$2,$3,'pdf',$4),($5,$2,$3,'ifc',$6)`,
      [PDF, PROJECT, OWNER, PDF_SHA, ifcFile, ifcSha],
    );
    await upgradeDb.exec("set role authenticated");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    const created = (
      await upgradeDb.query(
        "select public.lukas_drawing_create_document($1,null,'Legacy source matrix',true) result",
        [PROJECT],
      )
    ).rows[0].result;
    const objects = Array.from({ length: shapes.length + 1 }, (_, index) =>
      circleObject(randomUUID(), created.workLayerId, {
        name: `Legacy source ${index}`,
      }),
    );
    await upgradeDb.query(
      `select public.lukas_drawing_apply_operation(
        $1,$2,'add_objects','{}'::jsonb,$3,$4
      )`,
      [
        created.revisionId,
        randomUUID(),
        { type: "add_objects", objects },
        { type: "delete_objects", objectIds: objects.map(({ id }) => id) },
      ],
    );
    await upgradeDb.exec("reset role");
    const pdfSourceId = randomUUID();
    await upgradeDb.query(
      `insert into public.lukas_drawing_object_sources(
        id,object_id,revision_id,project_id,source_file_id,source_sha256,
        source_kind,pdf_page_number,x,y,width,height,created_by
      ) values($1,$2,$3,$4,$5,$6,'pdf_region',1,.1,.2,.3,.4,$7)`,
      [
        pdfSourceId,
        objects[0].id,
        created.revisionId,
        PROJECT,
        PDF,
        PDF_SHA,
        OWNER,
      ],
    );
    const sourceIds = [];
    for (const [index, shape] of shapes.entries()) {
      const sourceId = randomUUID();
      sourceIds.push(sourceId);
      await upgradeDb.query(
        `insert into public.lukas_drawing_object_sources(
          id,object_id,revision_id,project_id,source_file_id,source_sha256,
          source_kind,element_id,ifc_global_id,camera_json,created_by
        ) values($1,$2,$3,$4,$5,$6,'ifc_element',$7,$8,$9,$10)`,
        [
          sourceId,
          objects[index + 1].id,
          created.revisionId,
          PROJECT,
          ifcFile,
          ifcSha,
          shape.elementId,
          shape.globalId,
          shape.camera,
          OWNER,
        ],
      );
    }

    await upgradeDb.exec(await p5EvidenceAuthorityMigration());
    await upgradeDb.exec(await p5RevisionRelinkAuthorityMigration());

    const rows = await upgradeDb.query(
      `select id,status,version,element_id "elementId",
        ifc_global_id "globalId",camera_json camera
       from public.lukas_drawing_object_sources order by id`,
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    assert.deepEqual(byId.get(pdfSourceId), {
      id: pdfSourceId,
      status: "active",
      version: 1,
      elementId: null,
      globalId: null,
      camera: null,
    });
    for (const [index, shape] of shapes.entries())
      assert.deepEqual(byId.get(sourceIds[index]), {
        id: sourceIds[index],
        status: shape.expected,
        version: shape.expected === "active" ? 1 : 2,
        elementId: shape.elementId,
        globalId: shape.globalId,
        camera: shape.camera,
      });
  } finally {
    await upgradeDb.close();
  }
});

test("P5 restores an immutable pre-P5 PDF checkpoint without rewriting its snapshot", async () => {
  const upgradeDb = new PGlite({ extensions: { pgcrypto } });
  try {
    await upgradeDb.exec(foundationSql);
    await applyP0ThroughP3Migrations(upgradeDb);
    await upgradeDb.query("insert into auth.users(id) values ($1),($2)", [
      OWNER,
      REVIEWER,
    ]);
    await upgradeDb.query(
      "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
      [PROJECT, OWNER],
    );
    await upgradeDb.query(
      `insert into public.lukas_qto_project_members(project_id,user_id,role)
       values($1,$2,'reviewer')`,
      [PROJECT, REVIEWER],
    );
    await upgradeDb.query(
      `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256)
       values($1,$2,$3,'pdf',$4)`,
      [PDF, PROJECT, OWNER, PDF_SHA],
    );
    await upgradeDb.exec("set role authenticated");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    const created = (
      await upgradeDb.query(
        "select public.lukas_drawing_create_document($1,null,'Legacy checkpoint',true) result",
        [PROJECT],
      )
    ).rows[0].result;
    const object = circleObject(randomUUID(), created.workLayerId);
    await upgradeDb.query(
      `select public.lukas_drawing_apply_operation(
        $1,$2,'add_objects','{}'::jsonb,$3,$4
      )`,
      [
        created.revisionId,
        randomUUID(),
        { type: "add_objects", objects: [object] },
        { type: "delete_objects", objectIds: [object.id] },
      ],
    );
    await upgradeDb.exec("reset role");
    const sourceId = randomUUID();
    await upgradeDb.query(
      `insert into public.lukas_drawing_object_sources(
        id,object_id,revision_id,project_id,source_file_id,source_sha256,
        source_kind,pdf_page_number,x,y,width,height,created_by
      ) values($1,$2,$3,$4,$5,$6,'pdf_region',1,.1,.2,.3,.4,$7)`,
      [sourceId, object.id, created.revisionId, PROJECT, PDF, PDF_SHA, OWNER],
    );
    await upgradeDb.exec("set role authenticated");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    const review = await upgradeDb.query(
      "select public.lukas_drawing_request_review($1) result",
      [created.revisionId],
    );
    const immutableBefore = await upgradeDb.query(
      "select canonical_json,sha256 from public.lukas_drawing_snapshots where id=$1",
      [review.rows[0].result.snapshotId],
    );
    assert.equal(
      immutableBefore.rows[0].canonical_json.sources[0].revisionId,
      undefined,
    );
    assert.equal(
      immutableBefore.rows[0].canonical_json.sources[0].version,
      undefined,
    );
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [REVIEWER],
    );
    await upgradeDb.query(
      `select public.lukas_drawing_record_revision_decision(
        $1,$2,$3,'rejected','legacy checkpoint fixture'
      )`,
      [
        created.revisionId,
        review.rows[0].result.subjectVersion,
        review.rows[0].result.snapshotSha256,
      ],
    );
    await upgradeDb.exec("reset role");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub','',false)",
    );
    await upgradeDb.exec(await p4SemanticObjectsMigration());
    await upgradeDb.exec(await p4SemanticContractFixesMigration());
    await upgradeDb.exec(await p4FinalContractFixesMigration());
    await upgradeDb.exec(await p4FinalNameAuthorityMigration());
    await upgradeDb.exec(await p5EvidenceAuthorityMigration());
    await upgradeDb.exec(await p5RevisionRelinkAuthorityMigration());
    await upgradeDb.exec("set role authenticated");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    const source = {
      id: sourceId,
      objectId: object.id,
      revisionId: created.revisionId,
      sourceFileId: PDF,
      sourceSha256: PDF_SHA,
      sourceKind: "pdf_region",
      pdfPageNumber: 1,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      version: 1,
    };
    await upgradeDb.query(
      `select public.lukas_drawing_apply_operation(
        $1,$2,'mutate_structure',$3,$4,$5
      )`,
      [
        created.revisionId,
        randomUUID(),
        { [sourceId]: 1 },
        {
          type: "mutate_structure",
          actions: [{ kind: "delete_source", id: sourceId, baseVersion: 1 }],
        },
        {
          type: "mutate_structure",
          actions: [{ kind: "put_source", entity: source, baseVersion: null }],
        },
      ],
    );
    const restored = await upgradeDb.query(
      `select public.lukas_drawing_apply_operation(
        $1,$2,'restore_checkpoint','{}'::jsonb,$3,$4
      ) result`,
      [
        created.revisionId,
        randomUUID(),
        {
          type: "restore_checkpoint",
          checkpointId: review.rows[0].result.snapshotId,
          actions: [{ kind: "put_source", entity: source, baseVersion: null }],
        },
        {
          type: "restore_checkpoint",
          checkpointId: review.rows[0].result.snapshotId,
          actions: [{ kind: "delete_source", id: sourceId, baseVersion: 3 }],
        },
      ],
    );
    assert.equal(restored.rows[0].result.resultVersions[sourceId], 3);
    await upgradeDb.exec("reset role");
    const after = await upgradeDb.query(
      `select s.status,s.version,x.canonical_json,x.sha256
       from public.lukas_drawing_object_sources s
       cross join public.lukas_drawing_snapshots x
       where s.id=$1 and x.id=$2`,
      [sourceId, review.rows[0].result.snapshotId],
    );
    assert.equal(after.rows[0].status, "active");
    assert.equal(after.rows[0].version, 3);
    assert.deepEqual(
      after.rows[0].canonical_json,
      immutableBefore.rows[0].canonical_json,
    );
    assert.equal(after.rows[0].sha256, immutableBefore.rows[0].sha256);
  } finally {
    await upgradeDb.close();
  }
});

test("P5 private trigger guards and future private functions deny direct execution", async () => {
  await db.exec("reset role");
  const guards = await db.query(
    `select
      has_function_privilege(
        'authenticated','private.lukas_drawing_anchor_guard()','execute'
      ) anchor_authenticated,
      has_function_privilege(
        'service_role','private.lukas_drawing_anchor_guard()','execute'
      ) anchor_service,
      has_function_privilege(
        'authenticated','private.lukas_drawing_object_source_guard()','execute'
      ) source_authenticated,
      has_function_privilege(
        'service_role','private.lukas_drawing_object_source_guard()','execute'
      ) source_service,
      has_function_privilege(
        'authenticated',
        'private.lukas_drawing_relink_issue_anchor(uuid,uuid,uuid,jsonb,text)',
        'execute'
      ) relink_authenticated,
      has_function_privilege(
        'service_role',
        'private.lukas_drawing_relink_issue_anchor(uuid,uuid,uuid,jsonb,text)',
        'execute'
      ) relink_service`,
  );
  assert.deepEqual(guards.rows, [
    {
      anchor_authenticated: false,
      anchor_service: false,
      source_authenticated: false,
      source_service: false,
      relink_authenticated: false,
      relink_service: false,
    },
  ]);
  await db.exec(`
    create function private.lukas_drawing_p5_default_acl_probe()
    returns integer language sql set search_path='' as $$ select 1 $$;
  `);
  try {
    const defaults = await db.query(
      `select
        has_function_privilege(
          'anon','private.lukas_drawing_p5_default_acl_probe()','execute'
        ) anon_execute,
        has_function_privilege(
          'authenticated','private.lukas_drawing_p5_default_acl_probe()','execute'
        ) authenticated_execute,
        has_function_privilege(
          'service_role','private.lukas_drawing_p5_default_acl_probe()','execute'
        ) service_execute`,
    );
    assert.deepEqual(defaults.rows, [
      {
        anon_execute: false,
        authenticated_execute: false,
        service_execute: false,
      },
    ]);
  } finally {
    await db.exec("drop function private.lukas_drawing_p5_default_acl_probe()");
  }
});

test("P5 source authority persists exact OCC, idempotent retry, soft delete and restore versions", async () => {
  const created = await createDocument("P5 source authority");
  const objectId = randomUUID();
  const sourceId = randomUUID();
  await asActor(OWNER);
  await addObject(created, circleObject(objectId, created.workLayerId));
  const source = {
    id: sourceId,
    objectId,
    revisionId: created.revisionId,
    sourceFileId: PDF,
    sourceSha256: PDF_SHA,
    sourceKind: "pdf_region",
    pdfPageNumber: 1,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    version: 1,
  };
  const clientOperationId = randomUUID();
  const forward = {
    type: "mutate_structure",
    actions: [{ kind: "put_source", entity: source, baseVersion: null }],
  };
  const inverse = {
    type: "mutate_structure",
    actions: [{ kind: "delete_source", id: sourceId, baseVersion: 1 }],
  };
  const first = await applyOperationWithId(
    created.revisionId,
    clientOperationId,
    "mutate_structure",
    {},
    forward,
    inverse,
  );
  const retry = await applyOperationWithId(
    created.revisionId,
    clientOperationId,
    "mutate_structure",
    {},
    forward,
    inverse,
  );
  assert.deepEqual(retry, first);
  assert.equal(first.resultVersions[sourceId], 1);
  let rows = await db.query(
    `select status,version,source_sha256 from public.lukas_drawing_object_sources
     where id=$1`,
    [sourceId],
  );
  assert.deepEqual(rows.rows, [
    { status: "active", version: 1, source_sha256: PDF_SHA },
  ]);

  const removed = await applyStructure(
    created,
    { [sourceId]: 1 },
    [{ kind: "delete_source", id: sourceId, baseVersion: 1 }],
    [{ kind: "put_source", entity: source, baseVersion: null }],
  );
  assert.equal(removed.resultVersions[sourceId], null);
  await db.exec("reset role");
  rows = await db.query(
    "select status,version from public.lukas_drawing_object_sources where id=$1",
    [sourceId],
  );
  assert.deepEqual(rows.rows, [{ status: "deleted", version: 2 }]);

  await asActor(OWNER);
  const restored = await applyStructure(
    created,
    {},
    [{ kind: "put_source", entity: source, baseVersion: null }],
    [{ kind: "delete_source", id: sourceId, baseVersion: 3 }],
  );
  assert.equal(restored.resultVersions[sourceId], 3);
  await db.exec("reset role");
  rows = await db.query(
    "select status,version from public.lukas_drawing_object_sources where id=$1",
    [sourceId],
  );
  assert.deepEqual(rows.rows, [{ status: "active", version: 3 }]);
  const canonicalObject = (
    await db.query(
      "select private.lukas_drawing_structure_entity_json('object',$1,$2,$3) entity",
      [objectId, created.revisionId, PROJECT],
    )
  ).rows[0].entity;

  await asActor(OWNER);
  const deletedWithObject = await applyOperation(
    created.revisionId,
    "mutate_objects_with_references",
    { [objectId]: 1, [sourceId]: 3 },
    {
      type: "mutate_objects_with_references",
      objectAction: "delete",
      objects: [canonicalObject],
      actions: [{ kind: "delete_source", id: sourceId, baseVersion: 3 }],
    },
    {
      type: "mutate_objects_with_references",
      objectAction: "restore",
      objects: [{ ...canonicalObject, version: 3 }],
      actions: [
        {
          kind: "put_source",
          entity: { ...source, version: 3 },
          baseVersion: null,
        },
      ],
    },
  );
  assert.equal(deletedWithObject.resultVersions[objectId], null);
  assert.equal(deletedWithObject.resultVersions[sourceId], null);
  await db.exec("reset role");
  rows = await db.query(
    "select status,version from public.lukas_drawing_object_sources where id=$1",
    [sourceId],
  );
  assert.deepEqual(rows.rows, [{ status: "deleted", version: 4 }]);

  await asActor(OWNER);
  await assert.rejects(
    db.query(
      `insert into public.lukas_drawing_object_sources(
        object_id,revision_id,project_id,source_file_id,source_sha256,
        source_kind,pdf_page_number,x,y,width,height,created_by,updated_by
      ) values($1,$2,$3,$4,$5,'pdf_region',1,.1,.1,.2,.2,$6,$6)`,
      [objectId, created.revisionId, PROJECT, PDF, PDF_SHA, OWNER],
    ),
    /permission denied/i,
  );
});

test("P5 review, template and approved-child paths preserve only active source lineage", async () => {
  const created = await createDocument("P5 source lineage copies");
  const object = circleObject(randomUUID(), created.workLayerId);
  const activeSource = {
    id: randomUUID(),
    objectId: object.id,
    revisionId: created.revisionId,
    sourceFileId: PDF,
    sourceSha256: PDF_SHA,
    sourceKind: "pdf_region",
    pdfPageNumber: 1,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    version: 1,
  };
  const deletedFile = randomUUID();
  const deletedSha = "e".repeat(64);
  const deletedSource = {
    ...activeSource,
    id: randomUUID(),
    sourceFileId: deletedFile,
    sourceSha256: deletedSha,
  };
  await db.exec("reset role");
  await db.query(
    `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256)
     values($1,$2,$3,'pdf',$4)`,
    [deletedFile, PROJECT, OWNER, deletedSha],
  );
  await asActor(OWNER);
  await addObject(created, object);
  await applyStructure(
    created,
    {},
    [{ kind: "put_source", entity: activeSource, baseVersion: null }],
    [{ kind: "delete_source", id: activeSource.id, baseVersion: 1 }],
  );
  await applyStructure(
    created,
    {},
    [{ kind: "put_source", entity: deletedSource, baseVersion: null }],
    [{ kind: "delete_source", id: deletedSource.id, baseVersion: 1 }],
  );
  await applyStructure(
    created,
    { [deletedSource.id]: 1 },
    [{ kind: "delete_source", id: deletedSource.id, baseVersion: 1 }],
    [{ kind: "put_source", entity: deletedSource, baseVersion: null }],
  );
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [created.revisionId],
  );
  const snapshot = await db.query(
    "select canonical_json from public.lukas_drawing_snapshots where id=$1",
    [review.rows[0].result.snapshotId],
  );
  assert.deepEqual(snapshot.rows[0].canonical_json.sources, [activeSource]);
  await assert.rejects(
    applyStructure(
      created,
      { [activeSource.id]: 1 },
      [{ kind: "delete_source", id: activeSource.id, baseVersion: 1 }],
      [{ kind: "put_source", entity: activeSource, baseVersion: null }],
    ),
    (error) => error.code === "P1R01" || error.code === "P1C01",
  );
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'approved','P5 source lineage fixture'
    )`,
    [
      created.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  const template = await db.query(
    "select public.lukas_drawing_create_from_template($1,'P5 source clone',null,$2) result",
    [created.revisionId, randomUUID()],
  );
  const child = await db.query(
    "select public.lukas_drawing_restore_approved_snapshot($1,$2) result",
    [created.revisionId, randomUUID()],
  );
  await db.exec("reset role");
  const copied = await db.query(
    `select s.revision_id "revisionId",s.source_file_id "sourceFileId",
      s.status,o.lineage_id "objectLineage"
     from public.lukas_drawing_object_sources s
     join public.lukas_drawing_objects o on o.id=s.object_id
     where s.revision_id in ($1,$2) order by s.revision_id`,
    [template.rows[0].result.revisionId, child.rows[0].result.revisionId],
  );
  assert.deepEqual(
    new Set(copied.rows.map((row) => row.revisionId)),
    new Set([
      template.rows[0].result.revisionId,
      child.rows[0].result.revisionId,
    ]),
  );
  assert.ok(
    copied.rows.every(
      (row) =>
        row.sourceFileId === PDF &&
        row.status === "active" &&
        row.objectLineage === object.id,
    ),
  );
});

test("P5 source authority rejects file identity, active uniqueness and role violations atomically", async () => {
  const created = await createDocument("P5 rejected source authority");
  const object = circleObject(randomUUID(), created.workLayerId);
  const source = {
    id: randomUUID(),
    objectId: object.id,
    revisionId: created.revisionId,
    sourceFileId: PDF,
    sourceSha256: PDF_SHA,
    sourceKind: "pdf_region",
    pdfPageNumber: 1,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    version: 1,
  };
  await asActor(OWNER);
  await addObject(created, object);
  const put = (entity) =>
    applyStructure(
      created,
      {},
      [{ kind: "put_source", entity, baseVersion: null }],
      [{ kind: "delete_source", id: entity.id, baseVersion: 1 }],
    );
  await assert.rejects(put({ ...source, sourceSha256: "f".repeat(64) }));
  await assert.rejects(
    put({
      id: randomUUID(),
      objectId: object.id,
      revisionId: created.revisionId,
      sourceFileId: PDF,
      sourceSha256: PDF_SHA,
      sourceKind: "ifc_element",
      ifcGlobalId: "0Q2gXl1Hn3fQ9A2W4k6M8P",
      elementId: "42",
      camera: null,
      version: 1,
    }),
  );
  const mutableFile = randomUUID();
  const mutableSha = "d".repeat(64);
  await db.exec("reset role");
  await db.query(
    `insert into public.lukas_qto_files(
      id,project_id,uploaded_by,kind,sha256,immutable
    ) values($1,$2,$3,'pdf',$4,false)`,
    [mutableFile, PROJECT, OWNER, mutableSha],
  );
  await asActor(OWNER);
  await assert.rejects(
    put({
      ...source,
      id: randomUUID(),
      sourceFileId: mutableFile,
      sourceSha256: mutableSha,
    }),
  );
  await put(source);
  await assert.rejects(put({ ...source, id: randomUUID() }));
  await asActor(OUTSIDER);
  await assert.rejects(
    put({ ...source, id: randomUUID(), sourceFileId: mutableFile }),
  );
  await db.exec("reset role");
  const evidence = await db.query(
    `select id,status,version from public.lukas_drawing_object_sources
     where revision_id=$1 order by id`,
    [created.revisionId],
  );
  assert.deepEqual(evidence.rows, [
    { id: source.id, status: "active", version: 1 },
  ]);
});

test("P5 revision-review anchors reject direct ordinary replacement and predecessor deactivation", async () => {
  const currentFileId = randomUUID();
  const currentSha = "7".repeat(64);
  const issueId = randomUUID();
  const previousAnchorId = randomUUID();
  await db.exec("reset role");
  await db.query(
    `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256)
     values($1,$2,$3,'pdf',$4)`,
    [currentFileId, PROJECT, OWNER, currentSha],
  );
  await db.query(
    `insert into public.lukas_qto_file_revisions(
      project_id,previous_file_id,previous_sha256,current_file_id,current_sha256,
      relation_kind,created_by
    ) values($1,$2,$3,$4,$5,'supersedes',$6)`,
    [PROJECT, PDF, PDF_SHA, currentFileId, currentSha, OWNER],
  );
  await db.query(
    "insert into public.lukas_drawing_issues(id,project_id) values($1,$2)",
    [issueId, PROJECT],
  );
  await asActor(OWNER);
  await db.query(
    `insert into public.lukas_drawing_issue_anchors(
      id,issue_id,project_id,file_id,anchor_kind,page_number,x,y,width,height,
      label,created_by
    ) values($1,$2,$3,$4,'pdf_region',1,.1,.1,.2,.2,'old',$5)`,
    [previousAnchorId, issueId, PROJECT, PDF, OWNER],
  );

  await assert.rejects(
    db.query(
      `insert into public.lukas_drawing_issue_anchors(
        issue_id,project_id,file_id,anchor_kind,page_number,x,y,width,height,
        label,created_by
      ) values($1,$2,$3,'pdf_region',1,.2,.2,.2,.2,'ordinary replacement',$4)`,
      [issueId, PROJECT, currentFileId, OWNER],
    ),
    /atomic relink function/i,
  );
  await assert.rejects(
    db.query(
      `update public.lukas_drawing_issue_anchors
       set active=false,deactivation_note='separate deactivate'
       where id=$1`,
      [previousAnchorId],
    ),
    /atomic relink function/i,
  );
  await db.exec("reset role");
  const preserved = await db.query(
    `select
      (select active from public.lukas_drawing_issue_anchors where id=$1) active,
      count(*)::integer anchor_count
     from public.lukas_drawing_issue_anchors
     where issue_id=$2`,
    [previousAnchorId, issueId],
  );
  assert.deepEqual(preserved.rows, [{ active: true, anchor_count: 1 }]);
});

test("P5 legacy non-revision anchors retain generic add and deactivate behavior", async () => {
  const issueId = randomUUID();
  const anchorId = randomUUID();
  const legacyFileId = randomUUID();
  await db.exec("reset role");
  await db.query(
    `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256)
     values($1,$2,$3,'pdf',$4)`,
    [legacyFileId, PROJECT, OWNER, "6".repeat(64)],
  );
  await db.query(
    "insert into public.lukas_drawing_issues(id,project_id) values($1,$2)",
    [issueId, PROJECT],
  );
  await asActor(OWNER);
  await db.query(
    `insert into public.lukas_drawing_issue_anchors(
      id,issue_id,project_id,file_id,anchor_kind,page_number,x,y,width,height,
      label,created_by
    ) values($1,$2,$3,$4,'pdf_region',1,.1,.1,.2,.2,'legacy',$5)`,
    [anchorId, issueId, PROJECT, legacyFileId, OWNER],
  );
  await db.query(
    `update public.lukas_drawing_issue_anchors
     set active=false,deactivation_note='legacy deactivate'
     where id=$1`,
    [anchorId],
  );
  await db.exec("reset role");
  const row = await db.query(
    `select active,deactivation_note
     from public.lukas_drawing_issue_anchors where id=$1`,
    [anchorId],
  );
  assert.deepEqual(row.rows, [
    { active: false, deactivation_note: "legacy deactivate" },
  ]);
});

test("P5 relink atomically preserves predecessor lineage across one exact file edge", async () => {
  const currentFileId = randomUUID();
  const currentSha = "c".repeat(64);
  const issueId = randomUUID();
  const previousAnchorId = randomUUID();
  const newAnchorId = randomUUID();
  await db.exec("reset role");
  await db.query(
    `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256)
     values($1,$2,$3,'pdf',$4)`,
    [currentFileId, PROJECT, OWNER, currentSha],
  );
  await db.query(
    `insert into public.lukas_qto_file_revisions(
      project_id,previous_file_id,previous_sha256,current_file_id,current_sha256,
      relation_kind,created_by
    ) values($1,$2,$3,$4,$5,'supersedes',$6)`,
    [PROJECT, PDF, PDF_SHA, currentFileId, currentSha, OWNER],
  );
  await db.query(
    "insert into public.lukas_drawing_issues(id,project_id) values($1,$2)",
    [issueId, PROJECT],
  );
  await asActor(OWNER);
  await db.query(
    `insert into public.lukas_drawing_issue_anchors(
      id,issue_id,project_id,file_id,anchor_kind,page_number,x,y,width,height,
      label,created_by
    ) values($1,$2,$3,$4,'pdf_region',1,.1,.1,.2,.2,'old',$5)`,
    [previousAnchorId, issueId, PROJECT, PDF, OWNER],
  );
  const result = await db.query(
    `select public.lukas_drawing_relink_issue_anchor($1,$2,$3,$4,$5) result`,
    [
      previousAnchorId,
      newAnchorId,
      currentFileId,
      {
        kind: "pdf_region",
        fileId: currentFileId,
        pageNumber: 2,
        x: 0.2,
        y: 0.2,
        width: 0.3,
        height: 0.3,
        label: "new",
      },
      "revision relink",
    ],
  );
  assert.deepEqual(result.rows[0].result, {
    previousAnchorId,
    newAnchorId,
  });
  await db.exec("reset role");
  const anchors = await db.query(
    `select id,active,replaces_anchor_id,deactivation_note
     from public.lukas_drawing_issue_anchors
     where id in ($1,$2) order by id`,
    [previousAnchorId, newAnchorId],
  );
  const byId = new Map(anchors.rows.map((row) => [row.id, row]));
  assert.deepEqual(byId.get(previousAnchorId), {
    id: previousAnchorId,
    active: false,
    replaces_anchor_id: null,
    deactivation_note: "revision relink",
  });
  assert.deepEqual(byId.get(newAnchorId), {
    id: newAnchorId,
    active: true,
    replaces_anchor_id: previousAnchorId,
    deactivation_note: null,
  });
  await asActor(OWNER);
  await assert.rejects(
    db.query(
      "select public.lukas_drawing_relink_issue_anchor($1,$2,$3,$4,$5)",
      [
        previousAnchorId,
        randomUUID(),
        currentFileId,
        {
          kind: "pdf_region",
          fileId: currentFileId,
          pageNumber: 1,
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.2,
          label: "stale",
        },
        "stale predecessor",
      ],
    ),
    /stale or inactive/i,
  );
  await assert.rejects(
    db.query(
      `insert into public.lukas_drawing_issue_anchors(
        id,issue_id,project_id,file_id,anchor_kind,page_number,x,y,width,height,
        label,created_by,replaces_anchor_id
      ) values($1,$2,$3,$4,'pdf_region',1,.1,.1,.2,.2,'forged',$5,$6)`,
      [randomUUID(), issueId, PROJECT, currentFileId, OWNER, newAnchorId],
    ),
    /atomic relink function/i,
  );
  await db.exec("begin");
  try {
    await db.query(
      "select set_config('private.lukas_drawing_anchor_relink',$1,false)",
      [newAnchorId],
    );
    await db.query(
      "select set_config('private.lukas_drawing_client_state','forged',false)",
    );
    await assert.rejects(
      db.query(
        `insert into public.lukas_drawing_issue_anchors(
          id,issue_id,project_id,file_id,anchor_kind,page_number,x,y,width,height,
          label,created_by,replaces_anchor_id
        ) values($1,$2,$3,$4,'pdf_region',1,.1,.1,.2,.2,'forged session',$5,$6)`,
        [randomUUID(), issueId, PROJECT, currentFileId, OWNER, newAnchorId],
      ),
      /atomic relink function/i,
    );
  } finally {
    await db.exec("rollback");
  }
  const rollbackAnchorId = randomUUID();
  const rejectedAnchorId = randomUUID();
  await db.query(
    `insert into public.lukas_drawing_issue_anchors(
      id,issue_id,project_id,file_id,anchor_kind,page_number,x,y,width,height,
      label,created_by
    ) values($1,$2,$3,$4,'pdf_region',1,.1,.1,.2,.2,'rollback',$5)`,
    [rollbackAnchorId, issueId, PROJECT, PDF, OWNER],
  );
  await assert.rejects(
    db.query(
      "select public.lukas_drawing_relink_issue_anchor($1,$2,$3,$4,$5)",
      [
        rollbackAnchorId,
        rejectedAnchorId,
        currentFileId,
        {
          kind: "ifc_element",
          fileId: currentFileId,
          elementId: "42",
          ifcGlobalId: "0Q2gXl1Hn3fQ9A2W4k6M8P",
          camera: null,
          label: "wrong kind",
        },
        "must roll back",
      ],
    ),
  );
  await db.exec("reset role");
  const rollback = await db.query(
    `select
      (select active from public.lukas_drawing_issue_anchors where id=$1) active,
      exists(select 1 from public.lukas_drawing_issue_anchors where id=$2) inserted`,
    [rollbackAnchorId, rejectedAnchorId],
  );
  assert.deepEqual(rollback.rows, [{ active: true, inserted: false }]);
});

test("P4 final name authority rejects legacy-valid poison transactionally before constraints", async () => {
  const legacyDb = new PGlite({ extensions: { pgcrypto } });
  try {
    await legacyDb.exec(foundationSql);
    await applyP0ThroughP3Migrations(legacyDb);
    await legacyDb.exec(await p4SemanticObjectsMigration());
    await legacyDb.exec(await p4SemanticContractFixesMigration());
    await legacyDb.exec(await p4FinalContractFixesMigration());
    await legacyDb.query("insert into auth.users(id) values ($1)", [OWNER]);
    await legacyDb.query(
      "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
      [PROJECT, OWNER],
    );
    await legacyDb.exec("set role authenticated");
    await legacyDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    const created = await legacyDb.query(
      "select public.lukas_drawing_create_document($1,null,'Legacy names',true) result",
      [PROJECT],
    );
    await legacyDb.exec("reset role");
    await legacyDb.exec(
      "alter table public.lukas_drawing_pages disable trigger user",
    );
    await legacyDb.query(
      "update public.lukas_drawing_pages set name=name||$1 where id=$2",
      ["\u00a0", created.rows[0].result.pageId],
    );
    await legacyDb.exec(
      "alter table public.lukas_drawing_pages enable trigger user",
    );

    await assert.rejects(
      legacyDb.exec(await p4FinalNameAuthorityMigration()),
      (error) =>
        error.code === "P1C01" &&
        /final name authority: page/i.test(error.message),
    );
    await legacyDb.exec("rollback");
    const rolledBack = await legacyDb.query(
      `select
        pg_catalog.to_regprocedure(
          'private.lukas_drawing_p4_array_names_valid(jsonb,text)'
        ) helper,
        exists(select 1 from pg_catalog.pg_constraint
          where conname='lukas_drawing_pages_name_contract') installed`,
    );
    assert.deepEqual(rolledBack.rows[0], { helper: null, installed: false });

    await legacyDb.exec(
      "alter table public.lukas_drawing_pages disable trigger user",
    );
    await legacyDb.query(
      "update public.lukas_drawing_pages set name='Recovered page' where id=$1",
      [created.rows[0].result.pageId],
    );
    await legacyDb.exec(
      "alter table public.lukas_drawing_pages enable trigger user",
    );
    await legacyDb.exec(await p4FinalNameAuthorityMigration());
    const upgraded = await legacyDb.query(
      `select private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) valid
       from public.lukas_drawing_pages where id=$1`,
      [created.rows[0].result.pageId],
    );
    assert.deepEqual(upgraded.rows, [{ valid: true }]);
  } finally {
    await legacyDb.close();
  }
});

test("P4 shared geometry corpus matches strict Zod and SQL authorities", async () => {
  await db.exec("reset role");
  for (const geometry of validP4Geometries) {
    assert.equal(
      drawingTypes.DrawingGeometrySchema.safeParse(geometry).success,
      true,
    );
    const result = await db.query(
      "select private.lukas_drawing_geometry_valid($1,$2::jsonb) valid",
      [geometry.type, JSON.stringify(geometry)],
    );
    assert.equal(result.rows[0].valid, true, geometry.type);
  }
  for (const [name, geometry] of invalidP4Geometries) {
    assert.equal(
      drawingTypes.DrawingGeometrySchema.safeParse(geometry).success,
      false,
    );
    let sqlAccepted = false;
    try {
      const result = await db.query(
        "select private.lukas_drawing_geometry_valid($1,$2::jsonb) valid",
        [geometry.type, JSON.stringify(geometry)],
      );
      sqlAccepted = result.rows[0].valid;
    } catch {
      // PostgreSQL cannot materialize JSON strings containing NUL or an
      // unpaired surrogate; transport rejection is the same closed boundary.
    }
    assert.equal(sqlAccepted, false, name);
  }

  const ids = await createDocument("P4 Unicode persistence boundary");
  for (const [name, geometry] of invalidP4Geometries.filter(([fixtureName]) =>
    fixtureName.startsWith("256 "),
  )) {
    const object = p4Object(randomUUID(), ids.workLayerId, geometry, name);
    const clientOperationId = randomUUID();
    await assert.rejects(
      applyOperationWithId(
        ids.revisionId,
        clientOperationId,
        "add_objects",
        {},
        { type: "add_objects", objects: [object] },
        { type: "delete_objects", objectIds: [object.id] },
      ),
      (error) => error.code === "P1C01",
      name,
    );
    await db.exec("reset role");
    const unchanged = await db.query(
      `select
        (select count(*)::int from public.lukas_drawing_objects where id=$1) objects,
        (select count(*)::int from public.lukas_drawing_operations
          where revision_id=$2 and client_operation_id=$3) operations`,
      [object.id, ids.revisionId, clientOperationId],
    );
    assert.deepEqual(unchanged.rows[0], { objects: 0, operations: 0 }, name);
    await asActor(OWNER);
  }
});

test("P4 shared randomized object-name corpus has exact Zod, SQL helper, authenticated RPC, and reload parity", async () => {
  await db.exec("reset role");
  for (const [name, value, expected] of p4ObjectNameCorpus) {
    assert.equal(
      drawingTypes.DrawingObjectNameSchema.safeParse(value).success,
      expected,
      `Zod ${name}`,
    );
    let sqlAccepted = false;
    try {
      const result = await db.query(
        "select private.lukas_drawing_p2_name($1::jsonb) valid",
        [JSON.stringify(value)],
      );
      sqlAccepted = result.rows[0].valid;
    } catch {
      // PostgreSQL rejects NUL and unpaired-surrogate JSON before the helper.
    }
    assert.equal(sqlAccepted, expected, `SQL ${name}`);
  }

  const ids = await createDocument("P4 exact object names");
  const acceptedIds = [];
  for (const [name, value, expected] of p4ObjectNameCorpus) {
    const object = circleObject(randomUUID(), ids.workLayerId, { name: value });
    const clientOperationId = randomUUID();
    if (expected) {
      await applyOperationWithId(
        ids.revisionId,
        clientOperationId,
        "add_objects",
        {},
        { type: "add_objects", objects: [object] },
        { type: "delete_objects", objectIds: [object.id] },
      );
      acceptedIds.push(object.id);
      continue;
    }
    await assert.rejects(
      applyOperationWithId(
        ids.revisionId,
        clientOperationId,
        "add_objects",
        {},
        { type: "add_objects", objects: [object] },
        { type: "delete_objects", objectIds: [object.id] },
      ),
      (error) =>
        error.code === "P1C01" ||
        /domain JSON|invalid input syntax|unicode|zero byte/i.test(
          error.message,
        ),
      `RPC ${name}`,
    );
    await db.exec("reset role");
    const unchanged = await db.query(
      `select
        (select count(*)::int from public.lukas_drawing_objects where id=$1) objects,
        (select count(*)::int from public.lukas_drawing_operations
          where revision_id=$2 and client_operation_id=$3) operations`,
      [object.id, ids.revisionId, clientOperationId],
    );
    assert.deepEqual(unchanged.rows[0], { objects: 0, operations: 0 }, name);
    await asActor(OWNER);
  }

  await db.exec("reset role");
  const persisted = await db.query(
    `select id,name,layer_id,object_type,geometry,style_id,style,version
     from public.lukas_drawing_objects where id=any($1::uuid[]) order by id`,
    [acceptedIds],
  );
  assert.equal(persisted.rows.length, acceptedIds.length);
  for (const row of persisted.rows) {
    const reloaded = drawingTypes.DrawingObjectSchema.parse({
      id: row.id,
      name: row.name,
      layerId: row.layer_id,
      geometry: row.geometry,
      styleId: row.style_id,
      style: row.style,
      version: Number(row.version),
    });
    assert.equal(reloaded.geometry.type, row.object_type);
  }
});

test("P4 global exact-name authority accepts and strictly reloads every persisted name consumer", async () => {
  const ids = await createDocument("P4 global exact names");
  const validNames = p4ObjectNameCorpus
    .filter(([, , expected]) => expected)
    .map(([, value]) => value);
  const name = (index) => validNames[index % validNames.length];
  const style = {
    id: randomUUID(),
    revisionId: ids.revisionId,
    name: name(5),
    value: STYLE,
    version: 1,
  };
  const propertySchema = {
    id: randomUUID(),
    revisionId: ids.revisionId,
    name: name(8),
    valueType: "enum",
    enumOptions: [name(9)],
    appliesTo: ["circle"],
    required: false,
    version: 1,
  };
  const table = {
    id: randomUUID(),
    revisionId: ids.revisionId,
    name: name(10),
    columns: [
      {
        id: randomUUID(),
        name: name(11),
        kind: "text",
        propertySchemaId: null,
      },
    ],
    rows: [],
    version: 1,
  };
  const page = {
    id: randomUUID(),
    revisionId: ids.revisionId,
    name: name(0),
    sortOrder: 1,
    version: 1,
  };
  const canvas = {
    id: randomUUID(),
    pageId: page.id,
    name: name(1),
    spaceKind: "paper",
    widthMillimeters: 420,
    heightMillimeters: 297,
    background: null,
    sortOrder: 0,
    version: 1,
  };
  const layer = {
    id: randomUUID(),
    name: name(2),
    visible: true,
    locked: false,
    systemKind: "work",
    canvasId: canvas.id,
    sortOrder: 0,
    version: 1,
  };
  await asActor(OWNER);
  await applyStructure(
    ids,
    {},
    [
      { kind: "put_page", entity: page, baseVersion: null },
      { kind: "put_canvas", entity: canvas, baseVersion: null },
      { kind: "put_layer", entity: layer, baseVersion: null },
      { kind: "put_style", entity: style, baseVersion: null },
      {
        kind: "put_property_schema",
        entity: propertySchema,
        baseVersion: null,
      },
      { kind: "put_table", entity: table, baseVersion: null },
    ],
    [
      { kind: "delete_table", id: table.id, baseVersion: 1 },
      {
        kind: "delete_property_schema",
        id: propertySchema.id,
        baseVersion: 1,
      },
      { kind: "delete_style", id: style.id, baseVersion: 1 },
      { kind: "delete_layer", id: layer.id, baseVersion: 1 },
      { kind: "delete_canvas", id: canvas.id, baseVersion: 1 },
      { kind: "delete_page", id: page.id, baseVersion: 1 },
    ],
  );
  const object = circleObject(randomUUID(), layer.id, { name: name(3) });
  await addObject(ids, object);
  const persistedBlock = await createPersistedBlockInstance(ids, name(7));
  const updatedBlock = {
    ...persistedBlock.block,
    name: name(5),
    primitives: persistedBlock.block.primitives.map((primitive) => ({
      ...primitive,
      name: name(6),
    })),
    version: 1,
  };
  const updatedInstance = {
    ...persistedBlock.instance,
    name: name(7),
    version: 1,
  };
  await applyStructure(
    ids,
    { [updatedBlock.id]: 1, [updatedInstance.id]: 1 },
    [
      { kind: "put_block", entity: updatedBlock, baseVersion: 1 },
      { kind: "put_block_instance", entity: updatedInstance, baseVersion: 1 },
    ],
    [
      {
        kind: "put_block_instance",
        entity: persistedBlock.instance,
        baseVersion: 2,
      },
      {
        kind: "put_block",
        entity: persistedBlock.block,
        baseVersion: 2,
      },
    ],
  );

  await db.exec("reset role");
  const rows = await db.query(
    `select pg_catalog.jsonb_build_object(
      'page',(select pg_catalog.jsonb_build_object('id',id,'revisionId',revision_id,'name',name,'sortOrder',sort_order,'version',version) from public.lukas_drawing_pages where id=$1),
      'canvas',(select pg_catalog.jsonb_build_object('id',id,'pageId',page_id,'name',name,'spaceKind',space_kind,'widthMillimeters',width_mm,'heightMillimeters',height_mm,'background',null,'sortOrder',sort_order,'version',version) from public.lukas_drawing_canvases where id=$2),
      'layer',(select pg_catalog.jsonb_build_object('id',id,'name',name,'visible',visible,'locked',locked,'systemKind',system_kind,'canvasId',canvas_id,'sortOrder',sort_order,'version',version) from public.lukas_drawing_layers where id=$3),
      'object',(select pg_catalog.jsonb_build_object('id',id,'name',name,'layerId',layer_id,'geometry',geometry,'styleId',style_id,'style',style,'version',version) from public.lukas_drawing_objects where id=$4),
      'style',(select pg_catalog.jsonb_build_object('id',id,'revisionId',revision_id,'name',name,'value',value,'version',version) from public.lukas_drawing_styles where id=$5),
      'block',(select pg_catalog.jsonb_build_object('id',id,'revisionId',revision_id,'name',name,'primitives',primitives,'version',version) from public.lukas_drawing_blocks where id=$6),
      'instance',(select pg_catalog.jsonb_build_object('id',id,'lineageId',lineage_id,'blockId',block_id,'layerId',layer_id,'name',name,'origin',origin,'rotation',rotation,'scaleX',scale_x,'scaleY',scale_y,'version',version) from public.lukas_drawing_block_instances where id=$7),
      'schema',(select pg_catalog.jsonb_build_object('id',id,'revisionId',revision_id,'name',name,'valueType',value_type,'enumOptions',enum_options,'appliesTo',applies_to,'required',required,'version',version) from public.lukas_drawing_property_schemas where id=$8),
      'table',(select pg_catalog.jsonb_build_object('id',id,'revisionId',revision_id,'name',name,'columns',columns_json,'rows',rows_json,'version',version) from public.lukas_drawing_tables where id=$9)
    ) entities`,
    [
      page.id,
      canvas.id,
      layer.id,
      object.id,
      style.id,
      updatedBlock.id,
      updatedInstance.id,
      propertySchema.id,
      table.id,
    ],
  );
  const entities = rows.rows[0].entities;
  drawingTypes.DrawingPageSchema.parse(entities.page);
  drawingTypes.DrawingCanvasSchema.parse(entities.canvas);
  drawingTypes.DrawingStructureLayerSchema.parse(entities.layer);
  drawingTypes.DrawingObjectSchema.parse(entities.object);
  drawingTypes.DrawingStyleDefinitionSchema.parse(entities.style);
  drawingTypes.DrawingBlockSchema.parse(entities.block);
  drawingTypes.DrawingBlockInstanceSchema.parse(entities.instance);
  drawingTypes.DrawingPropertySchemaSchema.parse(entities.schema);
  drawingTypes.DrawingTableSchema.parse(entities.table);
  assert.equal(Object.keys(entities).length, 9);

  const invalidName = " invalid";
  const invalidMutations = [
    [
      "page",
      "put_page",
      entities.page,
      { ...entities.page, name: invalidName },
    ],
    [
      "canvas",
      "put_canvas",
      entities.canvas,
      { ...entities.canvas, name: invalidName },
    ],
    [
      "style",
      "put_style",
      entities.style,
      { ...entities.style, name: invalidName },
    ],
    [
      "block",
      "put_block",
      entities.block,
      { ...entities.block, name: invalidName },
    ],
    [
      "block primitive",
      "put_block",
      entities.block,
      {
        ...entities.block,
        primitives: entities.block.primitives.map((primitive, index) =>
          index === 0 ? { ...primitive, name: invalidName } : primitive,
        ),
      },
    ],
    [
      "block instance",
      "put_block_instance",
      entities.instance,
      { ...entities.instance, name: invalidName },
    ],
    [
      "property schema",
      "put_property_schema",
      entities.schema,
      { ...entities.schema, name: invalidName },
    ],
    [
      "enum option",
      "put_property_schema",
      entities.schema,
      { ...entities.schema, enumOptions: [invalidName] },
    ],
    [
      "table",
      "put_table",
      entities.table,
      { ...entities.table, name: invalidName },
    ],
    [
      "table column",
      "put_table",
      entities.table,
      {
        ...entities.table,
        columns: entities.table.columns.map((column, index) =>
          index === 0 ? { ...column, name: invalidName } : column,
        ),
      },
    ],
  ];
  for (const [consumer, kind, previous, invalid] of invalidMutations) {
    const clientOperationId = randomUUID();
    await asActor(OWNER);
    await assert.rejects(
      applyOperationWithId(
        ids.revisionId,
        clientOperationId,
        "mutate_structure",
        { [previous.id]: previous.version },
        {
          type: "mutate_structure",
          actions: [{ kind, entity: invalid, baseVersion: previous.version }],
        },
        {
          type: "mutate_structure",
          actions: [
            {
              kind,
              entity: previous,
              baseVersion: previous.version + 1,
            },
          ],
        },
      ),
      (error) =>
        error.code === "P1C01" ||
        /name|primitive|schema|table|column|option/i.test(error.message),
      consumer,
    );
    await db.exec("reset role");
    const operation = await db.query(
      `select count(*)::int count from public.lukas_drawing_operations
       where revision_id=$1 and client_operation_id=$2`,
      [ids.revisionId, clientOperationId],
    );
    assert.equal(operation.rows[0].count, 0, consumer);
  }
  await asActor(OWNER);
  const layerOperationId = randomUUID();
  await assert.rejects(
    applyOperationWithId(
      ids.revisionId,
      layerOperationId,
      "update_layer",
      { [entities.layer.id]: entities.layer.version },
      {
        type: "update_layer",
        layerId: entities.layer.id,
        patch: { name: invalidName },
      },
      {
        type: "update_layer",
        layerId: entities.layer.id,
        patch: { name: entities.layer.name },
      },
    ),
    (error) => error.code === "P1C01",
    "layer",
  );
  await db.exec("reset role");
  const rejectedOperations = await db.query(
    `select count(*)::int count from public.lukas_drawing_operations
     where revision_id=$1 and client_operation_id=$2`,
    [ids.revisionId, layerOperationId],
  );
  assert.equal(rejectedOperations.rows[0].count, 0);

  const constraints = await db.query(
    `select conname from pg_catalog.pg_constraint
     where conname=any($1::text[]) order by conname`,
    [
      [
        "lukas_drawing_pages_name_contract",
        "lukas_drawing_canvases_name_contract",
        "lukas_drawing_layers_name_contract",
        "lukas_drawing_objects_name_contract",
        "lukas_drawing_styles_name_contract",
        "lukas_drawing_blocks_name_contract",
        "lukas_drawing_blocks_primitive_names_contract",
        "lukas_drawing_block_instances_name_contract",
        "lukas_drawing_property_schemas_name_contract",
        "lukas_drawing_property_schemas_enum_option_names_contract",
        "lukas_drawing_tables_name_contract",
        "lukas_drawing_tables_column_names_contract",
      ],
    ],
  );
  assert.equal(constraints.rows.length, p4PersistedExactNameConsumers.length);
});

test("P4 shared property-schema corpus matches SQL and duplicate RPC mutations leave no poisoned revision", async () => {
  await db.exec("reset role");
  for (const schema of validP4PropertySchemas) {
    const result = await db.query(
      "select private.lukas_drawing_p2_property_schema_json_valid($1,$2::jsonb,$3::jsonb) valid",
      [schema.valueType, schema.enumOptions, schema.appliesTo],
    );
    assert.equal(result.rows[0].valid, true);
  }
  for (const [name, schema] of invalidP4PropertySchemas) {
    const result = await db.query(
      "select private.lukas_drawing_p2_property_schema_json_valid($1,$2::jsonb,$3::jsonb) valid",
      [schema.valueType, schema.enumOptions, schema.appliesTo],
    );
    assert.equal(result.rows[0].valid, false, name);
  }

  const ids = await createDocument("P4 property appliesTo parity");
  const valid = {
    ...validP4PropertySchemas[1],
    id: randomUUID(),
    revisionId: ids.revisionId,
  };
  await applyStructure(
    ids,
    {},
    [{ kind: "put_property_schema", entity: valid, baseVersion: null }],
    [{ kind: "delete_property_schema", id: valid.id, baseVersion: 1 }],
  );
  for (const [name, fixture] of invalidP4PropertySchemas) {
    const invalid = {
      ...fixture,
      id: randomUUID(),
      revisionId: ids.revisionId,
    };
    const clientOperationId = randomUUID();
    await assert.rejects(
      applyOperationWithId(
        ids.revisionId,
        clientOperationId,
        "mutate_structure",
        {},
        {
          type: "mutate_structure",
          actions: [
            { kind: "put_property_schema", entity: invalid, baseVersion: null },
          ],
        },
        {
          type: "mutate_structure",
          actions: [
            { kind: "delete_property_schema", id: invalid.id, baseVersion: 1 },
          ],
        },
      ),
      (error) => error.code === "P1C01",
      name,
    );
    await db.exec("reset role");
    const unchanged = await db.query(
      `select
        (select count(*)::int from public.lukas_drawing_property_schemas where id=$1) schemas,
        (select count(*)::int from public.lukas_drawing_operations
          where revision_id=$2 and client_operation_id=$3) operations`,
      [invalid.id, ids.revisionId, clientOperationId],
    );
    assert.deepEqual(unchanged.rows[0], { schemas: 0, operations: 0 }, name);
    await asActor(OWNER);
  }
});

test("P4 persists generated hosted references and validates the final operation graph", async () => {
  const ids = await createDocument("P4 semantic graph");
  const wall = p4Object(
    p4FixtureIds.wall,
    ids.workLayerId,
    validP4Geometries[0],
    "W-01",
  );
  const opening = p4Object(
    p4FixtureIds.opening,
    ids.workLayerId,
    validP4Geometries[1],
    "D-01",
  );
  const added = await applyOperationWithId(
    ids.revisionId,
    randomUUID(),
    "add_objects",
    {},
    { type: "add_objects", objects: [wall, opening] },
    { type: "delete_objects", objectIds: [wall.id, opening.id] },
  );
  assert.deepEqual(added.resultVersions, { [wall.id]: 1, [opening.id]: 1 });
  await db.exec("reset role");
  const stored = await db.query(
    "select object_type,host_object_id from public.lukas_drawing_objects where id=any($1::uuid[]) order by id",
    [[wall.id, opening.id]],
  );
  assert.deepEqual(stored.rows, [
    { object_type: "wall", host_object_id: null },
    { object_type: "opening", host_object_id: wall.id },
  ]);

  await asActor(OWNER);
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "delete_objects",
      { [wall.id]: 1 },
      { type: "delete_objects", objectIds: [wall.id] },
      { type: "add_objects", objects: [{ ...wall, version: 3 }] },
    ),
    (error) => error.code === "P1C01",
  );
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "update_objects",
      { [wall.id]: 1 },
      {
        type: "update_objects",
        updates: [
          {
            objectId: wall.id,
            patch: { geometry: { ...wall.geometry, end: { x: 800, y: 0 } } },
          },
        ],
      },
      {
        type: "update_objects",
        updates: [{ objectId: wall.id, patch: { geometry: wall.geometry } }],
      },
    ),
    (error) => error.code === "P1C01",
  );
  await db.exec("reset role");
  await assert.rejects(
    db.query("delete from public.lukas_drawing_objects where id=$1", [wall.id]),
    (error) => /foreign key constraint/i.test(error.message),
  );
  for (const actor of [REVIEWER, OUTSIDER]) {
    await asActor(actor);
    await assert.rejects(
      applyOperation(
        ids.revisionId,
        "update_objects",
        { [opening.id]: 1 },
        {
          type: "update_objects",
          updates: [{ objectId: opening.id, patch: { name: "Denied" } }],
        },
        {
          type: "update_objects",
          updates: [{ objectId: opening.id, patch: { name: opening.name } }],
        },
      ),
      (error) => error.code === "P1R01",
    );
  }
});

test("P4 widens property applicability but keeps semantic geometry out of blocks", async () => {
  await db.exec("reset role");
  const property = await db.query(
    "select private.lukas_drawing_p2_property_schema_json_valid('text','[]'::jsonb,$1::jsonb) valid",
    [JSON.stringify(["wall", "opening", "space", "area", "grid", "arc"])],
  );
  assert.equal(property.rows[0].valid, true);
  const ids = await createDocument("P4 block boundary");
  await db.exec("reset role");
  const primitives = [
    {
      localId: "semantic",
      name: "Wall",
      geometry: validP4Geometries[0],
      styleId: null,
      style: { stroke: "#112233", strokeWidth: 1, fill: null },
    },
  ];
  const block = await db.query(
    "select private.lukas_drawing_p2_block_primitives_valid($1::jsonb,$2,$3) valid",
    [JSON.stringify(primitives), ids.revisionId, PROJECT],
  );
  assert.equal(block.rows[0].valid, false);
});

test("P4 mixed semantic operations require an exact complete base-version ledger", async () => {
  for (const variant of ["missing", "wrong", "extra", "false"]) {
    const ids = await createDocument(`P4 mixed bases ${variant}`);
    const wall = p4Object(
      randomUUID(),
      ids.workLayerId,
      validP4Geometries[0],
      "W-B",
    );
    const retained = p4Object(
      randomUUID(),
      ids.workLayerId,
      { ...validP4Geometries[1], hostWallId: wall.id, widthMillimeters: 100 },
      "D-B1",
    );
    const deleted = p4Object(
      randomUUID(),
      ids.workLayerId,
      {
        ...validP4Geometries[1],
        hostWallId: wall.id,
        offsetMillimeters: 850,
        widthMillimeters: 100,
      },
      "D-B2",
    );
    await applyOperation(
      ids.revisionId,
      "add_objects",
      {},
      {
        type: "add_objects",
        objects: [wall, retained, deleted].sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
      },
      {
        type: "delete_objects",
        objectIds: [wall.id, retained.id, deleted.id].sort(),
      },
    );
    const changedWall = {
      ...wall,
      geometry: { ...wall.geometry, end: { x: 700, y: 0 } },
    };
    const changedOpening = {
      ...retained,
      geometry: { ...retained.geometry, offsetMillimeters: 400 },
    };
    const forward = {
      type: "mutate_objects_with_references",
      objectAction: "delete",
      objects: [deleted],
      actions: [
        {
          kind: "put_object",
          entity: changedWall,
          baseVersion: variant === "false" ? 777 : 1,
        },
        { kind: "put_object", entity: changedOpening, baseVersion: 1 },
      ],
    };
    const inverse = {
      type: "mutate_objects_with_references",
      objectAction: "restore",
      objects: [{ ...deleted, version: 3 }],
      actions: [
        { kind: "put_object", entity: retained, baseVersion: 2 },
        { kind: "put_object", entity: wall, baseVersion: 2 },
      ],
    };
    const exact = { [wall.id]: 1, [retained.id]: 1, [deleted.id]: 1 };
    const malformed =
      variant === "missing"
        ? { [retained.id]: 1, [deleted.id]: 1 }
        : variant === "wrong"
          ? { ...exact, [wall.id]: 777 }
          : variant === "extra"
            ? { ...exact, [randomUUID()]: 1 }
            : { ...exact, [wall.id]: 777 };
    const clientOperationId = randomUUID();
    await db.exec("reset role");
    const before = await db.query(
      `select id,status,version,geometry from public.lukas_drawing_objects
       where id=any($1::uuid[]) order by id`,
      [[wall.id, retained.id, deleted.id]],
    );
    await asActor(OWNER);
    await assert.rejects(
      applyOperationWithId(
        ids.revisionId,
        clientOperationId,
        "mutate_objects_with_references",
        malformed,
        forward,
        inverse,
      ),
      (error) => error.code === "P1C01",
      variant,
    );
    await assert.rejects(
      applyOperationWithId(
        ids.revisionId,
        clientOperationId,
        "mutate_objects_with_references",
        malformed,
        forward,
        inverse,
      ),
      (error) => error.code === "P1C01",
      `${variant} retry`,
    );
    await db.exec("reset role");
    const after = await db.query(
      `select id,status,version,geometry from public.lukas_drawing_objects
       where id=any($1::uuid[]) order by id`,
      [[wall.id, retained.id, deleted.id]],
    );
    assert.deepEqual(after.rows, before.rows, variant);
    const ledger = await db.query(
      `select count(*)::int count from public.lukas_drawing_operations
       where revision_id=$1 and client_operation_id=$2`,
      [ids.revisionId, clientOperationId],
    );
    assert.equal(ledger.rows[0].count, 0, variant);
  }
});

test("P4 persists mixed wall updates with explicit opening deletion exactly once", async () => {
  const ids = await createDocument("P4 mixed semantic operation");
  const wall = p4Object(
    randomUUID(),
    ids.workLayerId,
    validP4Geometries[0],
    "W-02",
  );
  const retained = p4Object(
    randomUUID(),
    ids.workLayerId,
    { ...validP4Geometries[1], hostWallId: wall.id, widthMillimeters: 100 },
    "D-02",
  );
  const deleted = p4Object(
    randomUUID(),
    ids.workLayerId,
    {
      ...validP4Geometries[1],
      hostWallId: wall.id,
      offsetMillimeters: 850,
      widthMillimeters: 100,
    },
    "D-03",
  );
  await applyOperation(
    ids.revisionId,
    "add_objects",
    {},
    {
      type: "add_objects",
      objects: [wall, retained, deleted].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    },
    {
      type: "delete_objects",
      objectIds: [wall.id, retained.id, deleted.id].sort(),
    },
  );
  const changedWall = {
    ...wall,
    geometry: { ...wall.geometry, end: { x: 700, y: 0 } },
  };
  const changedOpening = {
    ...retained,
    geometry: { ...retained.geometry, offsetMillimeters: 400 },
  };
  const forward = {
    type: "mutate_objects_with_references",
    objectAction: "delete",
    objects: [deleted],
    actions: [
      { kind: "put_object", entity: changedWall, baseVersion: 1 },
      { kind: "put_object", entity: changedOpening, baseVersion: 1 },
    ],
  };
  const inverse = {
    type: "mutate_objects_with_references",
    objectAction: "restore",
    objects: [{ ...deleted, version: 3 }],
    actions: [
      { kind: "put_object", entity: retained, baseVersion: 2 },
      { kind: "put_object", entity: wall, baseVersion: 2 },
    ],
  };
  const clientOperationId = randomUUID();
  const baseVersions = { [wall.id]: 1, [retained.id]: 1, [deleted.id]: 1 };
  const first = await applyOperationWithId(
    ids.revisionId,
    clientOperationId,
    "mutate_objects_with_references",
    baseVersions,
    forward,
    inverse,
  );
  const retry = await applyOperationWithId(
    ids.revisionId,
    clientOperationId,
    "mutate_objects_with_references",
    baseVersions,
    forward,
    inverse,
  );
  assert.deepEqual(retry, first);
  assert.deepEqual(first.resultVersions, {
    [wall.id]: 2,
    [retained.id]: 2,
    [deleted.id]: null,
  });
  await db.exec("reset role");
  const stored = await db.query(
    "select id,geometry,status,version from public.lukas_drawing_objects where id=any($1::uuid[]) order by id",
    [[wall.id, retained.id, deleted.id]],
  );
  assert.equal(
    stored.rows.find((row) => row.id === wall.id).geometry.end.x,
    700,
  );
  assert.equal(
    stored.rows.find((row) => row.id === retained.id).geometry
      .offsetMillimeters,
    400,
  );
  assert.equal(
    stored.rows.find((row) => row.id === deleted.id).status,
    "deleted",
  );
  await asActor(OWNER);
  const undoForward = {
    type: "mutate_objects_with_references",
    objectAction: "restore",
    objects: [{ ...deleted, version: 3 }],
    actions: [
      {
        kind: "put_object",
        entity: { ...retained, version: 2 },
        baseVersion: 2,
      },
      { kind: "put_object", entity: { ...wall, version: 2 }, baseVersion: 2 },
    ],
  };
  const undoInverse = {
    type: "mutate_objects_with_references",
    objectAction: "delete",
    objects: [{ ...deleted, version: 3 }],
    actions: [
      {
        kind: "put_object",
        entity: { ...changedWall, version: 2 },
        baseVersion: 3,
      },
      {
        kind: "put_object",
        entity: { ...changedOpening, version: 2 },
        baseVersion: 3,
      },
    ],
  };
  const undone = await db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'mutate_objects_with_references',$3,$4,$5,'undo',$6
    ) result`,
    [
      ids.revisionId,
      randomUUID(),
      { [wall.id]: 2, [retained.id]: 2, [deleted.id]: 2 },
      undoForward,
      undoInverse,
      clientOperationId,
    ],
  );
  assert.deepEqual(undone.rows[0].result.resultVersions, {
    [wall.id]: 3,
    [retained.id]: 3,
    [deleted.id]: 3,
  });
  await db.exec("reset role");
  const restored = await db.query(
    "select id,geometry,status,version from public.lukas_drawing_objects where id=any($1::uuid[]) order by id",
    [[wall.id, retained.id, deleted.id]],
  );
  assert.equal(
    restored.rows.find((row) => row.id === wall.id).geometry.end.x,
    1000,
  );
  assert.equal(
    restored.rows.find((row) => row.id === retained.id).geometry
      .offsetMillimeters,
    500,
  );
  assert.equal(
    restored.rows.find((row) => row.id === deleted.id).status,
    "active",
  );

  await asActor(OWNER);
  const redoClientOperationId = randomUUID();
  const redoForward = {
    type: "mutate_objects_with_references",
    objectAction: "delete",
    objects: [{ ...deleted, version: 3 }],
    actions: [
      {
        kind: "put_object",
        entity: { ...changedWall, version: 3 },
        baseVersion: 3,
      },
      {
        kind: "put_object",
        entity: { ...changedOpening, version: 3 },
        baseVersion: 3,
      },
    ],
  };
  const redoInverse = {
    type: "mutate_objects_with_references",
    objectAction: "restore",
    objects: [{ ...deleted, version: 5 }],
    actions: [
      {
        kind: "put_object",
        entity: { ...retained, version: 3 },
        baseVersion: 4,
      },
      {
        kind: "put_object",
        entity: { ...wall, version: 3 },
        baseVersion: 4,
      },
    ],
  };
  const redoParameters = [
    ids.revisionId,
    redoClientOperationId,
    { [wall.id]: 3, [retained.id]: 3, [deleted.id]: 3 },
    redoForward,
    redoInverse,
    clientOperationId,
  ];
  const redone = await db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'mutate_objects_with_references',$3,$4,$5,'redo',$6
    ) result`,
    redoParameters,
  );
  const redoRetry = await db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'mutate_objects_with_references',$3,$4,$5,'redo',$6
    ) result`,
    redoParameters,
  );
  assert.deepEqual(redoRetry.rows[0].result, redone.rows[0].result);
  assert.deepEqual(redone.rows[0].result.resultVersions, {
    [wall.id]: 4,
    [retained.id]: 4,
    [deleted.id]: null,
  });
});

test("P4 accepts an opening-first compound host deletion and rejects host-only deletion", async () => {
  const ids = await createDocument("P4 host compound delete");
  const wall = p4Object(
    randomUUID(),
    ids.workLayerId,
    validP4Geometries[0],
    "W-03",
  );
  const opening = p4Object(
    randomUUID(),
    ids.workLayerId,
    { ...validP4Geometries[1], hostWallId: wall.id },
    "D-04",
  );
  await applyOperation(
    ids.revisionId,
    "add_objects",
    {},
    { type: "add_objects", objects: [opening, wall] },
    { type: "delete_objects", objectIds: [opening.id, wall.id] },
  );
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_objects_with_references",
      { [opening.id]: 1, [wall.id]: 1 },
      {
        type: "mutate_objects_with_references",
        objectAction: "delete",
        objects: [wall, opening],
        actions: [],
      },
      {
        type: "mutate_objects_with_references",
        objectAction: "restore",
        objects: [
          { ...wall, version: 3 },
          { ...opening, version: 3 },
        ],
        actions: [],
      },
    ),
    (error) => error.code === "P1C01",
  );
  const result = await applyOperation(
    ids.revisionId,
    "mutate_objects_with_references",
    { [opening.id]: 1, [wall.id]: 1 },
    {
      type: "mutate_objects_with_references",
      objectAction: "delete",
      objects: [opening, wall],
      actions: [],
    },
    {
      type: "mutate_objects_with_references",
      objectAction: "restore",
      objects: [
        { ...opening, version: 3 },
        { ...wall, version: 3 },
      ],
      actions: [],
    },
  );
  assert.deepEqual(result.resultVersions, {
    [opening.id]: null,
    [wall.id]: null,
  });
});

test("P4 approved template clone remaps hosted IDs without changing source bytes", async () => {
  const ids = await createDocument("P4 semantic template");
  const wall = p4Object(
    randomUUID(),
    ids.workLayerId,
    validP4Geometries[0],
    "W-T",
  );
  const opening = p4Object(
    randomUUID(),
    ids.workLayerId,
    { ...validP4Geometries[1], hostWallId: wall.id },
    "D-T",
  );
  await applyOperation(
    ids.revisionId,
    "add_objects",
    {},
    {
      type: "add_objects",
      objects: [wall, opening].sort((a, b) => a.id.localeCompare(b.id)),
    },
    { type: "delete_objects", objectIds: [wall.id, opening.id].sort() },
  );
  await db.exec("reset role");
  const sourceBefore = await db.query(
    "select to_jsonb(f) bytes from public.lukas_qto_files f where id=$1",
    [PDF],
  );
  await asActor(OWNER);
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "update_objects",
      { [wall.id]: 1 },
      {
        type: "update_objects",
        updates: [{ objectId: wall.id, patch: { name: "Frozen" } }],
      },
      {
        type: "update_objects",
        updates: [{ objectId: wall.id, patch: { name: wall.name } }],
      },
    ),
    (error) => error.code === "P1C01",
  );
  await asActor(REVIEWER);
  await db.query(
    "select public.lukas_drawing_record_revision_decision($1,$2,$3,'approved','p4 template')",
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "update_objects",
      { [wall.id]: 1 },
      {
        type: "update_objects",
        updates: [{ objectId: wall.id, patch: { name: "Approved frozen" } }],
      },
      {
        type: "update_objects",
        updates: [{ objectId: wall.id, patch: { name: wall.name } }],
      },
    ),
    (error) => error.code === "P1C01",
  );
  const cloned = await db.query(
    "select public.lukas_drawing_create_from_template($1,'P4 clone',null,$2) result",
    [ids.revisionId, randomUUID()],
  );
  await db.exec("reset role");
  const copied = await db.query(
    `select id,lineage_id,object_type,geometry,host_object_id,version
     from public.lukas_drawing_objects where revision_id=$1 and status='active'
     order by object_type`,
    [cloned.rows[0].result.revisionId],
  );
  const clonedOpening = copied.rows.find(
    (row) => row.object_type === "opening",
  );
  const clonedWall = copied.rows.find((row) => row.object_type === "wall");
  assert.equal(clonedWall.lineage_id, wall.id);
  assert.equal(clonedOpening.lineage_id, opening.id);
  assert.equal(clonedOpening.geometry.hostWallId, clonedWall.id);
  assert.equal(clonedOpening.host_object_id, clonedWall.id);
  assert.equal(clonedOpening.version, 1);
  await asActor(OWNER);
  const restored = await db.query(
    "select public.lukas_drawing_restore_approved_snapshot($1,$2) result",
    [ids.revisionId, randomUUID()],
  );
  await db.exec("reset role");
  const restoredHost = await db.query(
    `select opening.geometry->>'hostWallId' host_id,wall.id wall_id
     from public.lukas_drawing_objects opening
     join public.lukas_drawing_objects wall
       on wall.id=opening.host_object_id and wall.revision_id=opening.revision_id
     where opening.revision_id=$1 and opening.object_type='opening'`,
    [restored.rows[0].result.revisionId],
  );
  assert.equal(restoredHost.rows[0].host_id, restoredHost.rows[0].wall_id);
  const sourceAfter = await db.query(
    "select to_jsonb(f) bytes from public.lukas_qto_files f where id=$1",
    [PDF],
  );
  assert.deepEqual(sourceAfter.rows, sourceBefore.rows);
});

test("P7 organization template import remaps all references and restores locked layers", async () => {
  const ids = await createDocument("P7 organization template");
  const layerId = randomUUID();
  await applyOperation(
    ids.revisionId,
    "add_layer",
    { [layerId]: 1 },
    {
      type: "add_layer",
      layer: {
        id: layerId,
        name: "Locked standard",
        canvasId: ids.canvasId,
        sortOrder: 9,
        visible: true,
        locked: false,
        version: 1,
      },
    },
    {},
  );
  const styleId = randomUUID();
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [
        {
          kind: "put_style",
          entity: {
            id: styleId,
            revisionId: ids.revisionId,
            name: "P7 standard",
            value: STYLE,
            version: 1,
          },
          baseVersion: null,
        },
      ],
    },
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_style", id: styleId, baseVersion: 1 }],
    },
  );
  const wall = {
    ...p4Object(randomUUID(), layerId, validP4Geometries[0], "W-P7"),
    styleId,
    style: {},
  };
  const opening = {
    ...p4Object(
      randomUUID(),
      layerId,
      { ...validP4Geometries[1], hostWallId: wall.id },
      "D-P7",
    ),
    styleId,
    style: {},
  };
  await applyOperation(
    ids.revisionId,
    "add_objects",
    {},
    {
      type: "add_objects",
      objects: [wall, opening].sort((a, b) => a.id.localeCompare(b.id)),
    },
    { type: "delete_objects", objectIds: [wall.id, opening.id].sort() },
  );
  const blockId = randomUUID();
  const instanceId = randomUUID();
  const schemaId = randomUUID();
  const valueId = randomUUID();
  const tableId = randomUUID();
  const columnId = randomUUID();
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [
        {
          kind: "put_block",
          entity: {
            id: blockId,
            revisionId: ids.revisionId,
            name: "P7 block",
            primitives: [
              {
                localId: "edge",
                name: "Edge",
                geometry: {
                  type: "line",
                  start: { x: 0, y: 0 },
                  end: { x: 10, y: 0 },
                },
                styleId,
                style: {},
              },
            ],
            version: 1,
          },
          baseVersion: null,
        },
        {
          kind: "put_block_instance",
          entity: {
            id: instanceId,
            lineageId: instanceId,
            blockId,
            layerId,
            name: "P7 placement",
            origin: { x: 5, y: 5 },
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            version: 1,
          },
          baseVersion: null,
        },
        {
          kind: "put_property_schema",
          entity: {
            id: schemaId,
            revisionId: ids.revisionId,
            name: "P7 mark",
            valueType: "text",
            enumOptions: [],
            appliesTo: ["wall"],
            required: false,
            version: 1,
          },
          baseVersion: null,
        },
        {
          kind: "put_property_value",
          entity: {
            id: valueId,
            schemaId,
            objectId: wall.id,
            blockInstanceId: null,
            value: "W-01",
            version: 1,
          },
          baseVersion: null,
        },
        {
          kind: "put_table",
          entity: {
            id: tableId,
            revisionId: ids.revisionId,
            name: "P7 schedule",
            columns: [
              {
                id: columnId,
                name: "Mark",
                kind: "property",
                propertySchemaId: schemaId,
              },
            ],
            rows: [
              {
                id: randomUUID(),
                objectId: wall.id,
                blockInstanceId: null,
                cells: {},
              },
            ],
            version: 1,
          },
          baseVersion: null,
        },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_table", id: tableId, baseVersion: 1 },
        { kind: "delete_property_value", id: valueId, baseVersion: 1 },
        { kind: "delete_property_schema", id: schemaId, baseVersion: 1 },
        { kind: "delete_block_instance", id: instanceId, baseVersion: 1 },
        { kind: "delete_block", id: blockId, baseVersion: 1 },
      ],
    },
  );
  await applyOperation(
    ids.revisionId,
    "update_layer",
    { [layerId]: 1 },
    { type: "update_layer", layerId, patch: { locked: true } },
    { type: "update_layer", layerId, patch: { locked: false } },
  );
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    "select public.lukas_drawing_record_revision_decision($1,$2,$3,'approved','p7 library')",
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  const targetProject = randomUUID();
  await db.exec("reset role");
  await db.query(
    `insert into public.lukas_qto_projects(id,owner_id,organization_id)
     values($1,$2,$3)`,
    [targetProject, OWNER, ORGANIZATION],
  );
  await db.query(
    `insert into public.lukas_qto_project_members(project_id,user_id,role)
     values($1,$2,'owner')`,
    [targetProject, OWNER],
  );
  await asActor(OWNER);
  const draft = await db.query(
    `select public.lukas_drawing_create_library_draft(
      $1,'workspace_template','P7 complete template',$2,null,null
    ) result`,
    [ORGANIZATION, ids.revisionId],
  );
  const versionId = draft.rows[0].result.versionId;
  await db.query("select public.lukas_drawing_publish_library_version($1,$2)", [
    ORGANIZATION,
    versionId,
  ]);
  const imported = await db.query(
    `select public.lukas_drawing_import_library_version(
      $1,$2,$3,null,$4
    ) result`,
    [ORGANIZATION, versionId, targetProject, randomUUID()],
  );
  await db.exec("reset role");
  const targetRevision = imported.rows[0].result.revisionId;
  const copiedObjects = await db.query(
    `select id,lineage_id,object_type,geometry,host_object_id,style_id
     from public.lukas_drawing_objects where revision_id=$1 order by object_type`,
    [targetRevision],
  );
  assert.equal(copiedObjects.rows.length, 2);
  const copiedOpening = copiedObjects.rows.find(
    (object) => object.object_type === "opening",
  );
  const copiedWall = copiedObjects.rows.find(
    (object) => object.object_type === "wall",
  );
  assert.equal(copiedWall.lineage_id, copiedWall.id);
  assert.equal(copiedOpening.lineage_id, copiedOpening.id);
  assert.notEqual(copiedWall.lineage_id, wall.id);
  assert.notEqual(copiedOpening.lineage_id, opening.id);
  assert.equal(copiedOpening.geometry.hostWallId, copiedWall.id);
  assert.equal(copiedOpening.host_object_id, copiedWall.id);
  assert.equal(copiedOpening.style_id, copiedWall.style_id);
  const copiedStructure = await db.query(
    `select
      (select locked from public.lukas_drawing_layers where revision_id=$1 and name='Locked standard') locked,
      (select version from public.lukas_drawing_layers where revision_id=$1 and name='Locked standard') layer_version,
      (select count(*)::int from public.lukas_drawing_block_instances where revision_id=$1 and lineage_id=id) fresh_instances,
      (select count(*)::int from public.lukas_drawing_property_values v
        join public.lukas_drawing_property_schemas s on s.id=v.schema_id and s.revision_id=v.revision_id
        where v.revision_id=$1 and v.object_id=$2) property_refs,
      (select count(*)::int from public.lukas_drawing_tables t,
        jsonb_array_elements(t.rows_json) row
        where t.revision_id=$1 and row->>'objectId'=$2::text) table_refs,
      private.lukas_drawing_p4_semantic_graph_valid($1) semantic_valid`,
    [targetRevision, copiedWall.id],
  );
  assert.deepEqual(copiedStructure.rows[0], {
    locked: true,
    layer_version: 2,
    fresh_instances: 1,
    property_refs: 1,
    table_refs: 1,
    semantic_valid: true,
  });
});

test("P3 collaboration bootstrap is one canonical capability-scoped payload", async () => {
  const ids = await createDocument("P3 bootstrap");
  const owner = await db.query(
    "select public.lukas_drawing_collaboration_bootstrap($1) result",
    [ids.revisionId],
  );
  const payload = owner.rows[0].result;
  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.operationSequence, 0);
  assert.equal(payload.revisionStatus, "draft");
  assert.equal(payload.capability, "admin");
  assert.equal(payload.canWrite, true);
  assert.equal(payload.canonicalJson.revision.id, ids.revisionId);
  await db.exec("reset role");
  const canonicalDigest = await db.query(
    "select encode(extensions.digest(convert_to(private.lukas_drawing_p2_canonical_snapshot($1,true)::text,'UTF8'),'sha256'),'hex') sha",
    [ids.revisionId],
  );
  assert.equal(payload.sha256, canonicalDigest.rows[0].sha);
  assert.deepEqual(payload.recentOutcomes, []);

  await db.exec("set role lukas_drawing_collaboration");
  const privateOwner = await db.query(
    "select private.lukas_drawing_collaboration_bootstrap($1,$2,$3) result",
    [OWNER, PROJECT, ids.revisionId],
  );
  assert.deepEqual(privateOwner.rows[0].result, payload);

  await asActor(REVIEWER);
  const reviewer = await db.query(
    "select public.lukas_drawing_collaboration_bootstrap($1) result",
    [ids.revisionId],
  );
  assert.equal(reviewer.rows[0].result.capability, "reviewer");
  assert.equal(reviewer.rows[0].result.canWrite, false);

  await asActor(OUTSIDER);
  await assert.rejects(
    db.query("select public.lukas_drawing_collaboration_bootstrap($1)", [
      ids.revisionId,
    ]),
    (error) => error.code === "P3A01",
  );

  await db.exec("reset role");
  await db.query(
    "insert into public.lukas_qto_project_members(project_id,user_id,role) values($1,$2,'viewer')",
    [PROJECT, OUTSIDER],
  );
  await asActor(OUTSIDER);
  const viewer = await db.query(
    "select public.lukas_drawing_collaboration_bootstrap($1) result",
    [ids.revisionId],
  );
  assert.equal(viewer.rows[0].result.capability, "viewer");
  assert.equal(viewer.rows[0].result.canWrite, false);
  await db.exec("reset role");
  await db.query(
    "delete from public.lukas_qto_project_members where project_id=$1 and user_id=$2",
    [PROJECT, OUTSIDER],
  );

  await db.exec("reset role; set role lukas_drawing_collaboration");
  const editor = await db.query(
    "select * from private.lukas_drawing_collaboration_authorize($1,$2,$3)",
    [EDITOR, PROJECT, ids.revisionId],
  );
  assert.deepEqual(editor.rows[0], {
    capability: "editor",
    can_write: true,
    revision_status: "draft",
  });
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_authorize($1,$2,$3)",
      [EDITOR, randomUUID(), ids.revisionId],
    ),
    (error) => error.code === "P3A01",
  );
  await db.exec("reset role");
});

test("collaboration history lineage is authoritative across RPC retry, lookup, and bootstrap", async () => {
  const ids = await createDocument("P3 history lineage");
  const layerResult = await db.query(
    "select id,name,version from public.lukas_drawing_layers where revision_id=$1 and system_kind='work' limit 1",
    [ids.revisionId],
  );
  const layer = layerResult.rows[0];
  const originalId = randomUUID();
  const undoId = randomUUID();
  const apply = (
    operationId,
    baseVersion,
    name,
    inverseName,
    action,
    original,
  ) =>
    db.query(
      "select public.lukas_drawing_apply_operation($1,$2,'update_layer',$3::jsonb,$4::jsonb,$5::jsonb,$6::text,$7::uuid) result",
      [
        ids.revisionId,
        operationId,
        JSON.stringify({ [layer.id]: baseVersion }),
        JSON.stringify({
          type: "update_layer",
          layerId: layer.id,
          patch: { name },
        }),
        JSON.stringify({
          type: "update_layer",
          layerId: layer.id,
          patch: { name: inverseName },
        }),
        action,
        original,
      ],
    );
  await apply(
    originalId,
    Number(layer.version),
    "History edited",
    layer.name,
    null,
    null,
  );
  await apply(
    undoId,
    Number(layer.version) + 1,
    layer.name,
    "History edited",
    "undo",
    originalId,
  );
  const exactRetry = await apply(
    undoId,
    Number(layer.version) + 1,
    layer.name,
    "History edited",
    "undo",
    originalId,
  );
  assert.equal(exactRetry.rows[0].result.sequence, 2);
  await assert.rejects(
    db.query(
      "select public.lukas_drawing_apply_operation($1,$2,'update_layer',$3::jsonb,$4::jsonb,$5::jsonb)",
      [
        ids.revisionId,
        undoId,
        JSON.stringify({ [layer.id]: Number(layer.version) + 1 }),
        JSON.stringify({
          type: "update_layer",
          layerId: layer.id,
          patch: { name: layer.name },
        }),
        JSON.stringify({
          type: "update_layer",
          layerId: layer.id,
          patch: { name: "History edited" },
        }),
      ],
    ),
    (error) => error.code === "P1C01",
  );
  await assert.rejects(
    db.query(
      "select private.lukas_drawing_apply_operation($1,$2,'update_layer',$3::jsonb,$4::jsonb,$5::jsonb)",
      [
        ids.revisionId,
        undoId,
        JSON.stringify({ [layer.id]: Number(layer.version) + 1 }),
        JSON.stringify({
          type: "update_layer",
          layerId: layer.id,
          patch: { name: layer.name },
        }),
        JSON.stringify({
          type: "update_layer",
          layerId: layer.id,
          patch: { name: "History edited" },
        }),
      ],
    ),
    (error) => error.code === "P1C01",
  );
  await assert.rejects(
    apply(
      undoId,
      Number(layer.version) + 1,
      layer.name,
      "History edited",
      "redo",
      originalId,
    ),
    (error) => error.code === "P1C01",
  );

  await db.exec("reset role; set role lukas_drawing_collaboration");
  const lookup = await db.query(
    "select * from private.lukas_drawing_collaboration_lookup_operations($1,$2)",
    [ids.revisionId, [undoId]],
  );
  assert.equal(lookup.rows[0].history_action, "undo");
  assert.equal(lookup.rows[0].original_operation_id, originalId);
  const bootstrap = await db.query(
    "select private.lukas_drawing_collaboration_bootstrap($1,$2,$3) result",
    [OWNER, PROJECT, ids.revisionId],
  );
  const outcome = bootstrap.rows[0].result.recentOutcomes.find(
    (value) => value.clientOperationId === undoId,
  );
  assert.equal(outcome.historyAction, "undo");
  assert.equal(outcome.originalOperationId, originalId);
  const serviceBootstrap = await db.query(
    "select private.lukas_drawing_collaboration_service_bootstrap($1,$2) result",
    [PROJECT, ids.revisionId],
  );
  const serviceOutcome = serviceBootstrap.rows[0].result.historyOutcomes.find(
    (value) => value.clientOperationId === undoId,
  );
  assert.equal(serviceOutcome.historyAction, "undo");
  assert.equal(serviceOutcome.originalOperationId, originalId);
  await db.exec("reset role");
});

test("legacy six-argument apply is the null-lineage form of the authoritative RPC", async () => {
  const ids = await createDocument("P3 legacy history wrapper");
  const layerResult = await db.query(
    "select id,name,version from public.lukas_drawing_layers where revision_id=$1 and system_kind='work' limit 1",
    [ids.revisionId],
  );
  const layer = layerResult.rows[0];
  const operationId = randomUUID();
  const parameters = [
    ids.revisionId,
    operationId,
    JSON.stringify({ [layer.id]: Number(layer.version) }),
    JSON.stringify({
      type: "update_layer",
      layerId: layer.id,
      patch: { name: "Legacy non-history" },
    }),
    JSON.stringify({
      type: "update_layer",
      layerId: layer.id,
      patch: { name: layer.name },
    }),
  ];
  const legacy = await db.query(
    "select public.lukas_drawing_apply_operation($1,$2,'update_layer',$3::jsonb,$4::jsonb,$5::jsonb) result",
    parameters,
  );
  const authoritative = await db.query(
    "select public.lukas_drawing_apply_operation($1,$2,'update_layer',$3::jsonb,$4::jsonb,$5::jsonb,null::text,null::uuid) result",
    parameters,
  );
  const legacyRetry = await db.query(
    "select public.lukas_drawing_apply_operation($1,$2,'update_layer',$3::jsonb,$4::jsonb,$5::jsonb) result",
    parameters,
  );
  assert.equal(legacy.rows[0].result.sequence, 1);
  assert.deepEqual(authoritative.rows, legacy.rows);
  assert.deepEqual(legacyRetry.rows, legacy.rows);
});

test("operation lineage foreign key rejects cross-actor service writes", async () => {
  const ids = await createDocument("P3 actor-bound history");
  const layerResult = await db.query(
    "select id,name,version from public.lukas_drawing_layers where revision_id=$1 and system_kind='work' limit 1",
    [ids.revisionId],
  );
  const layer = layerResult.rows[0];
  const ownerOriginalId = randomUUID();
  const ownerUndoId = randomUUID();
  const apply = (
    operationId,
    baseVersion,
    name,
    inverseName,
    action,
    original,
  ) =>
    db.query(
      "select public.lukas_drawing_apply_operation($1,$2,'update_layer',$3::jsonb,$4::jsonb,$5::jsonb,$6::text,$7::uuid)",
      [
        ids.revisionId,
        operationId,
        JSON.stringify({ [layer.id]: baseVersion }),
        JSON.stringify({
          type: "update_layer",
          layerId: layer.id,
          patch: { name },
        }),
        JSON.stringify({
          type: "update_layer",
          layerId: layer.id,
          patch: { name: inverseName },
        }),
        action,
        original,
      ],
    );
  await apply(
    ownerOriginalId,
    Number(layer.version),
    "Owner edit",
    layer.name,
    null,
    null,
  );
  await apply(
    ownerUndoId,
    Number(layer.version) + 1,
    layer.name,
    "Owner edit",
    "undo",
    ownerOriginalId,
  );

  await asActor(EDITOR);
  const editorOriginalId = randomUUID();
  await apply(
    editorOriginalId,
    Number(layer.version) + 2,
    "Editor edit",
    layer.name,
    null,
    null,
  );

  await db.exec("reset role; set role service_role; begin");
  try {
    await db.exec("savepoint cross_actor_insert");
    await assert.rejects(
      db.query(
        `insert into public.lukas_drawing_operations(
          revision_id,project_id,sequence,client_operation_id,operation_type,
          base_versions,forward,inverse,result_versions,actor_id,
          history_action,original_operation_id
        )
        select revision_id,project_id,
          (select max(sequence)+1 from public.lukas_drawing_operations where revision_id=$1),
          $2,operation_type,base_versions,forward,inverse,result_versions,$3,
          'undo',$4
        from public.lukas_drawing_operations
        where revision_id=$1 and client_operation_id=$5`,
        [ids.revisionId, randomUUID(), EDITOR, ownerOriginalId, ownerUndoId],
      ),
      (error) => error.code === "23503",
    );
    await db.exec("rollback to savepoint cross_actor_insert");

    await db.exec("savepoint cross_actor_update");
    await db.query(
      "select set_config('private.lukas_drawing_history_write','1',true)",
    );
    await assert.rejects(
      db.query(
        `update public.lukas_drawing_operations
         set history_action='undo',original_operation_id=$1
         where revision_id=$2 and client_operation_id=$3`,
        [editorOriginalId, ids.revisionId, ownerOriginalId],
      ),
      (error) => error.code === "23503",
    );
    await db.exec("rollback to savepoint cross_actor_update");
  } finally {
    await db.exec("rollback; reset role");
  }

  const stored = await db.query(
    `select actor_id,history_action,original_operation_id
     from public.lukas_drawing_operations
     where revision_id=$1 and client_operation_id=$2`,
    [ids.revisionId, ownerUndoId],
  );
  assert.deepEqual(stored.rows, [
    {
      actor_id: OWNER,
      history_action: "undo",
      original_operation_id: ownerOriginalId,
    },
  ]);
  await asActor(OWNER);
});

test("history authority migration validates existing same-actor lineage without rewriting it", async () => {
  const upgradeDb = new PGlite({ extensions: { pgcrypto } });
  try {
    await upgradeDb.exec(foundationSql);
    for (const load of [
      migration,
      upgradeMigration,
      issueLinkMigration,
      releaseHardeningMigration,
      p2Migration,
      p2LegacyLayerBackfillMigration,
      p2HardeningMigration,
      p2CompatibilityMigration,
      p2HistoryReconciliationMigration,
      p2NavigationHardeningMigration,
      p2StyleGuardSqlstateMigration,
      p2BlockExactnessMigration,
      p2TemplateSnapshotGuardMigration,
      p2TemplateCloneIdempotencyMigration,
      p2BlockInstanceLineageMigration,
      p2TemplateSnapshotAuthorityMigration,
      p2LegacyTemplateSnapshotCloneMigration,
      p2LineageSnapshotWriterMigration,
      p2TemplateCloneSecurityMigration,
      p3CollaborationStateMigration,
      p3CollaborationStateFenceMigration,
      p2TemplateCloneFinalLedgerMigration,
      task9ContractFixesMigration,
      p3ServiceAuthorityMigration,
      collaborationHistoryLineageMigration,
    ]) {
      await upgradeDb.exec(await load());
    }
    await upgradeDb.query("insert into auth.users(id) values ($1)", [OWNER]);
    await upgradeDb.query(
      "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
      [PROJECT, OWNER],
    );
    await upgradeDb.exec("set role authenticated");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    const created = await upgradeDb.query(
      "select public.lukas_drawing_create_document($1,null,'History upgrade',true) result",
      [PROJECT],
    );
    const revisionId = created.rows[0].result.revisionId;
    const layerResult = await upgradeDb.query(
      "select id,name,version from public.lukas_drawing_layers where revision_id=$1 and system_kind='work' limit 1",
      [revisionId],
    );
    const layer = layerResult.rows[0];
    const originalId = randomUUID();
    const undoId = randomUUID();
    const operation = (
      operationId,
      baseVersion,
      name,
      inverseName,
      action,
      original,
    ) =>
      upgradeDb.query(
        "select public.lukas_drawing_apply_operation($1,$2,'update_layer',$3::jsonb,$4::jsonb,$5::jsonb,$6::text,$7::uuid)",
        [
          revisionId,
          operationId,
          JSON.stringify({ [layer.id]: baseVersion }),
          JSON.stringify({
            type: "update_layer",
            layerId: layer.id,
            patch: { name },
          }),
          JSON.stringify({
            type: "update_layer",
            layerId: layer.id,
            patch: { name: inverseName },
          }),
          action,
          original,
        ],
      );
    await operation(
      originalId,
      Number(layer.version),
      "Before upgrade",
      layer.name,
      null,
      null,
    );
    await operation(
      undoId,
      Number(layer.version) + 1,
      layer.name,
      "Before upgrade",
      "undo",
      originalId,
    );
    await upgradeDb.exec("reset role");

    await upgradeDb.exec(await collaborationHistoryAuthorityMigration());
    const preserved = await upgradeDb.query(
      `select client_operation_id,actor_id,history_action,original_operation_id
       from public.lukas_drawing_operations
       where revision_id=$1 order by sequence`,
      [revisionId],
    );
    assert.deepEqual(preserved.rows, [
      {
        client_operation_id: originalId,
        actor_id: OWNER,
        history_action: null,
        original_operation_id: null,
      },
      {
        client_operation_id: undoId,
        actor_id: OWNER,
        history_action: "undo",
        original_operation_id: originalId,
      },
    ]);
    const constraint = await upgradeDb.query(
      `select convalidated,pg_catalog.pg_get_constraintdef(oid) definition
       from pg_catalog.pg_constraint
       where conrelid='public.lukas_drawing_operations'::regclass
         and conname='lukas_drawing_operations_history_original_fkey'`,
    );
    assert.equal(constraint.rows[0].convalidated, true);
    assert.match(constraint.rows[0].definition, /actor_id.*actor_id/i);
  } finally {
    await upgradeDb.close();
  }
});

test("P3 collaboration state is private, exact-byte hashed, bounded, monotonic, and draft-only", async () => {
  const ids = await createDocument("P3 state");
  const firstBytes = Buffer.from([0, 1, 2, 3]);
  await db.exec("reset role; set role lukas_drawing_collaboration");
  const stored = await db.query(
    "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,0::bigint,0::bigint,null)",
    [OWNER, PROJECT, ids.revisionId, firstBytes],
  );
  assert.equal(stored.rows[0].byte_size, firstBytes.length);
  assert.equal(
    stored.rows[0].yjs_sha256,
    createHash("sha256").update(firstBytes).digest("hex"),
  );
  assert.equal(stored.rows[0].store_generation, 1);
  const editorStore = await db.query(
    "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,0::bigint,$5::bigint,$6)",
    [
      EDITOR,
      PROJECT,
      ids.revisionId,
      Buffer.from([3, 2, 1]),
      stored.rows[0].store_generation,
      stored.rows[0].yjs_sha256,
    ],
  );
  assert.deepEqual([...editorStore.rows[0].yjs_state], [3, 2, 1]);
  assert.equal(editorStore.rows[0].store_generation, 2);
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,0::bigint,$5::bigint,$6)",
      [
        OWNER,
        PROJECT,
        ids.revisionId,
        Buffer.from([9, 9]),
        stored.rows[0].store_generation,
        stored.rows[0].yjs_sha256,
      ],
    ),
    (error) => error.code === "P3S03",
  );
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,0::bigint,$5::bigint,$6)",
      [
        OWNER,
        PROJECT,
        ids.revisionId,
        Buffer.from([8, 8]),
        editorStore.rows[0].store_generation,
        stored.rows[0].yjs_sha256,
      ],
    ),
    (error) => error.code === "P3S03",
  );
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,0::bigint,$5::bigint,$6)",
      [
        OWNER,
        PROJECT,
        ids.revisionId,
        Buffer.from([7, 7]),
        stored.rows[0].store_generation,
        editorStore.rows[0].yjs_sha256,
      ],
    ),
    (error) => error.code === "P3S03",
  );
  const afterStale = await db.query(
    "select * from private.lukas_drawing_collaboration_load_state($1,$2,$3)",
    [OWNER, PROJECT, ids.revisionId],
  );
  assert.deepEqual([...afterStale.rows[0].yjs_state], [3, 2, 1]);
  assert.equal(afterStale.rows[0].store_generation, 2);
  assert.equal(afterStale.rows[0].yjs_sha256, editorStore.rows[0].yjs_sha256);
  const retry = await db.query(
    "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,0::bigint,$5::bigint,$6)",
    [
      EDITOR,
      PROJECT,
      ids.revisionId,
      Buffer.from([3, 2, 1]),
      stored.rows[0].store_generation,
      stored.rows[0].yjs_sha256,
    ],
  );
  assert.equal(retry.rows[0].store_generation, 2);

  const reviewerLoad = await db.query(
    "select * from private.lukas_drawing_collaboration_load_state($1,$2,$3)",
    [REVIEWER, PROJECT, ids.revisionId],
  );
  assert.equal(reviewerLoad.rows.length, 1);
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,0::bigint,$5::bigint,$6)",
      [
        REVIEWER,
        PROJECT,
        ids.revisionId,
        Buffer.from([9]),
        editorStore.rows[0].store_generation,
        editorStore.rows[0].yjs_sha256,
      ],
    ),
    (error) => error.code === "P3A02",
  );
  for (const [schema, bytes, sequence] of [
    [2, Buffer.from([1]), 0],
    [1, Buffer.alloc(0), 0],
    [1, Buffer.from([1]), 1],
  ]) {
    await assert.rejects(
      db.query(
        "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,$4::smallint,$5::bytea,$6::bigint,$7::bigint,$8)",
        [
          OWNER,
          PROJECT,
          ids.revisionId,
          schema,
          bytes,
          sequence,
          editorStore.rows[0].store_generation,
          editorStore.rows[0].yjs_sha256,
        ],
      ),
      (error) => error.code === "P3S01",
    );
  }
  await db.exec("reset role");

  await asActor(OWNER);
  const layerId = randomUUID();
  const acceptedId = randomUUID();
  await applyOperationWithId(
    ids.revisionId,
    acceptedId,
    "add_layer",
    { [layerId]: 1 },
    {
      type: "add_layer",
      layer: {
        id: layerId,
        name: "P3 accepted layer",
        canvasId: ids.canvasId,
        sortOrder: 4,
        visible: true,
        locked: false,
        version: 1,
      },
    },
    {},
  );
  await db.exec("reset role; set role lukas_drawing_collaboration");
  const advanced = await db.query(
    "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,1::bigint,$5::bigint,$6)",
    [
      OWNER,
      PROJECT,
      ids.revisionId,
      Buffer.from([4, 5]),
      editorStore.rows[0].store_generation,
      editorStore.rows[0].yjs_sha256,
    ],
  );
  assert.equal(advanced.rows[0].store_generation, 3);
  const current = await db.query(
    "select * from private.lukas_drawing_collaboration_load_state($1,$2,$3)",
    [OWNER, PROJECT, ids.revisionId],
  );
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,0::bigint,$5::bigint,$6)",
      [
        OWNER,
        PROJECT,
        ids.revisionId,
        Buffer.from([6]),
        current.rows[0].store_generation,
        current.rows[0].yjs_sha256,
      ],
    ),
    (error) => error.code === "P3S02",
  );

  const accepted = await db.query(
    "select * from private.lukas_drawing_collaboration_lookup_operations($1,$2)",
    [ids.revisionId, [acceptedId, randomUUID()]],
  );
  assert.equal(accepted.rows.length, 1);
  assert.deepEqual(Object.keys(accepted.rows[0]), [
    "revision_id",
    "client_operation_id",
    "actor_id",
    "operation_type",
    "base_versions",
    "forward",
    "inverse",
    "history_action",
    "original_operation_id",
    "sequence",
    "result_versions",
  ]);
  const bootstrap = await db.query(
    "select private.lukas_drawing_collaboration_bootstrap($1,$2,$3) result",
    [OWNER, PROJECT, ids.revisionId],
  );
  assert.equal(bootstrap.rows[0].result.operationSequence, 1);
  assert.equal(bootstrap.rows[0].result.recentOutcomes.length, 1);
  assert.equal(
    bootstrap.rows[0].result.recentOutcomes[0].clientOperationId,
    acceptedId,
  );
  assert.deepEqual(Object.keys(bootstrap.rows[0].result.recentOutcomes[0]), [
    "actorId",
    "forward",
    "inverse",
    "sequence",
    "revisionId",
    "baseVersions",
    "operationType",
    "resultVersions",
    "clientOperationId",
  ]);
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_lookup_operations($1,$2)",
      [ids.revisionId, []],
    ),
    (error) => error.code === "P3S01",
  );
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_lookup_operations($1,$2)",
      [ids.revisionId, Array.from({ length: 257 }, () => randomUUID())],
    ),
    (error) => error.code === "P3S01",
  );
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_lookup_operations($1,$2)",
      [ids.revisionId, [acceptedId, acceptedId]],
    ),
    (error) => error.code === "P3S01",
  );
  await db.exec("reset role");
  await asActor(OWNER);
  const publicAtSequenceOne = await db.query(
    "select public.lukas_drawing_collaboration_bootstrap($1) result",
    [ids.revisionId],
  );
  assert.deepEqual(
    publicAtSequenceOne.rows[0].result,
    bootstrap.rows[0].result,
  );

  await db.exec(
    "reset role; alter table public.lukas_drawing_revisions disable trigger user",
  );
  await db.query(
    "update public.lukas_drawing_revisions set status='review_requested',review_requested_at=now() where id=$1",
    [ids.revisionId],
  );
  await db.exec(
    "alter table public.lukas_drawing_revisions enable trigger user; set role lukas_drawing_collaboration",
  );
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,1::bigint,$5::bigint,$6)",
      [
        OWNER,
        PROJECT,
        ids.revisionId,
        Buffer.from([7]),
        current.rows[0].store_generation,
        current.rows[0].yjs_sha256,
      ],
    ),
    (error) => error.code === "P3A02",
  );
  await db.exec(
    "reset role; alter table public.lukas_drawing_revisions disable trigger user",
  );
  await db.query(
    "update public.lukas_drawing_revisions set status='approved',approved_at=now() where id=$1",
    [ids.revisionId],
  );
  await db.exec(
    "alter table public.lukas_drawing_revisions enable trigger user; set role lukas_drawing_collaboration",
  );
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,1::bigint,$5::bigint,$6)",
      [
        OWNER,
        PROJECT,
        ids.revisionId,
        Buffer.from([8]),
        current.rows[0].store_generation,
        current.rows[0].yjs_sha256,
      ],
    ),
    (error) => error.code === "P3A02",
  );
  await db.exec("reset role");

  const privileges = await db.query(`select
    has_table_privilege('authenticated','private.lukas_drawing_collaboration_states','select') authenticated_table,
    has_table_privilege('service_role','private.lukas_drawing_collaboration_states','select') service_table,
    has_table_privilege('anon','private.lukas_drawing_collaboration_states','select') anon_table,
    has_table_privilege('lukas_drawing_collaboration','private.lukas_drawing_collaboration_states','select') collaboration_table,
    has_function_privilege('authenticated','private.lukas_drawing_collaboration_bootstrap(uuid,uuid,uuid)','execute') authenticated_private,
    has_function_privilege('anon','private.lukas_drawing_collaboration_bootstrap(uuid,uuid,uuid)','execute') anon_private,
    has_function_privilege('service_role','private.lukas_drawing_collaboration_store_state(uuid,uuid,uuid,smallint,bytea,bigint,bigint,text)','execute') service_store,
    has_function_privilege('service_role','public.lukas_drawing_collaboration_bootstrap(uuid)','execute') service_public,
    has_function_privilege('authenticated','public.lukas_drawing_collaboration_bootstrap(uuid)','execute') authenticated_public,
    has_function_privilege('lukas_drawing_collaboration','private.lukas_drawing_collaboration_store_state(uuid,uuid,uuid,smallint,bytea,bigint,bigint,text)','execute') collaboration_store,
    has_function_privilege('lukas_drawing_collaboration','private.lukas_drawing_collaboration_store_state(uuid,uuid,uuid,smallint,bytea,bigint)','execute') unsafe_store`);
  assert.deepEqual(privileges.rows[0], {
    authenticated_table: false,
    service_table: false,
    anon_table: false,
    collaboration_table: false,
    authenticated_private: false,
    anon_private: false,
    service_store: false,
    service_public: false,
    authenticated_public: true,
    collaboration_store: true,
    unsafe_store: false,
  });
  const privateSignatures = [
    "private.lukas_drawing_collaboration_authorize(uuid,uuid,uuid)",
    "private.lukas_drawing_collaboration_load_state(uuid,uuid,uuid)",
    "private.lukas_drawing_collaboration_store_state(uuid,uuid,uuid,smallint,bytea,bigint,bigint,text)",
    "private.lukas_drawing_collaboration_lookup_operations(uuid,uuid[])",
    "private.lukas_drawing_collaboration_bootstrap(uuid,uuid,uuid)",
  ];
  for (const signature of privateSignatures) {
    const grants = await db.query(
      `select
      has_function_privilege('public',$1,'execute') public_execute,
      has_function_privilege('anon',$1,'execute') anon_execute,
      has_function_privilege('authenticated',$1,'execute') authenticated_execute,
      has_function_privilege('service_role',$1,'execute') service_execute,
      has_function_privilege('lukas_drawing_collaboration',$1,'execute') collaboration_execute`,
      [signature],
    );
    assert.deepEqual(grants.rows[0], {
      public_execute: false,
      anon_execute: false,
      authenticated_execute: false,
      service_execute: false,
      collaboration_execute: true,
    });
  }
  const roleAndPublication = await db.query(`select
    (select not rolcanlogin from pg_roles where rolname='lukas_drawing_collaboration') role_is_nologin,
    (select not rolinherit from pg_roles where rolname='lukas_drawing_collaboration') role_is_noinherit,
    (select array_agg(tablename order by tablename) from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename in ('lukas_drawing_revisions','lukas_drawing_object_issue_links','lukas_drawing_issues','lukas_qto_project_members')) publication_tables,
    exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
      and tablename='lukas_drawing_collaboration_states') private_state_published`);
  assert.deepEqual(roleAndPublication.rows[0], {
    role_is_nologin: true,
    role_is_noinherit: true,
    publication_tables: [
      "lukas_drawing_issues",
      "lukas_drawing_object_issue_links",
      "lukas_drawing_revisions",
      "lukas_qto_project_members",
    ],
    private_state_published: false,
  });
});

test("P3 collaborative review requires the exact service-frozen accepted manifest and is idempotent", async () => {
  const ids = await createDocument("P3 atomic review freeze");
  const operationId = randomUUID();
  const layerId = randomUUID();
  await applyOperationWithId(
    ids.revisionId,
    operationId,
    "add_layer",
    { [layerId]: 1 },
    {
      type: "add_layer",
      layer: {
        id: layerId,
        name: "Freeze ledger",
        canvasId: ids.canvasId,
        sortOrder: 9,
        visible: true,
        locked: false,
        version: 1,
      },
    },
    {},
  );
  const accepted = await db.query(
    `select client_operation_id "clientOperationId",revision_id "revisionId",
      actor_id "actorId",operation_type "operationType",
      base_versions "baseVersions",forward,inverse,
      history_action "historyAction",original_operation_id "originalOperationId",
      sequence,result_versions "resultVersions"
     from public.lukas_drawing_operations where revision_id=$1 order by sequence`,
    [ids.revisionId],
  );
  const manifest = accepted.rows;
  const manifestSha256 = createHash("sha256")
    .update(JSON.stringify(manifest))
    .digest("hex");
  const operationStatuses = manifest.map((operation) => ({
    clientOperationId: operation.clientOperationId,
    status: "acked",
    authoritativeSequence: Number(operation.sequence),
    resultVersions: operation.resultVersions,
  }));
  const stateVectorBase64 = "AQ==";
  const subjectVersion = 1;
  const requestId = randomUUID();
  const ownerToken = randomUUID();

  await db.exec("reset role");
  const legacyPrivileges = await db.query(`select
    has_function_privilege('authenticated','private.lukas_drawing_request_review(uuid)','execute') authenticated_execute,
    has_function_privilege('service_role','private.lukas_drawing_request_review(uuid)','execute') service_execute`);
  assert.deepEqual(legacyPrivileges.rows[0], {
    authenticated_execute: false,
    service_execute: false,
  });
  await asActor(OWNER);
  await assert.rejects(
    db.query("select private.lukas_drawing_request_review($1)", [
      ids.revisionId,
    ]),
    (error) => error.code === "42501",
  );

  await assert.rejects(
    db.query(
      "select public.lukas_drawing_request_collaborative_review($1,$2,$3,$4,0,$5,$6,$7,$8)",
      [
        ids.revisionId,
        requestId,
        manifestSha256,
        manifest.length,
        subjectVersion,
        stateVectorBase64,
        operationStatuses,
        manifest,
      ],
    ),
    (error) => error.code === "P3F01",
  );

  await db.exec("reset role; set role lukas_drawing_collaboration");
  await persistCollaborationState(ids.revisionId);
  await db.query(
    "select private.lukas_drawing_collaboration_acquire_freeze_lease($1,$2,$3,$4,30,$5::bytea,0)",
    [PROJECT, ids.revisionId, requestId, ownerToken, Buffer.from([0])],
  );
  await db.query(
    "select private.lukas_drawing_collaboration_begin_freeze($1,$2,$3,$4::bytea,0,$5)",
    [PROJECT, ids.revisionId, requestId, Buffer.from([1, 2, 3]), ownerToken],
  );
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,0::bigint,2::bigint,$5)",
      [
        OWNER,
        PROJECT,
        ids.revisionId,
        Buffer.from([9, 9, 9]),
        createHash("sha256")
          .update(Buffer.from([1, 2, 3]))
          .digest("hex"),
      ],
    ),
    (error) => error.code === "P3F02",
  );
  const completedFreeze = await db.query(
    "select private.lukas_drawing_collaboration_complete_freeze($1,$2,$3,$4::bytea,$5,$6,$7,0,$8,$9,$10) result",
    [
      PROJECT,
      ids.revisionId,
      requestId,
      Buffer.from([4, 5, 6]),
      manifest,
      manifestSha256,
      manifest.length,
      stateVectorBase64,
      operationStatuses,
      ownerToken,
    ],
  );
  assert.equal(completedFreeze.rows[0].result.frozenSubjectRevisionVersion, 1);
  assert.equal(
    completedFreeze.rows[0].result.stateVectorBase64,
    stateVectorBase64,
  );
  assert.deepEqual(
    completedFreeze.rows[0].result.operationStatuses,
    operationStatuses,
  );
  await db.exec("reset role");
  await asActor(OWNER);
  await assert.rejects(
    db.query(
      "select public.lukas_drawing_request_collaborative_review($1,$2,$3,$4,0,$5,$6,$7,$8)",
      [
        ids.revisionId,
        randomUUID(),
        manifestSha256,
        manifest.length,
        subjectVersion,
        stateVectorBase64,
        operationStatuses,
        manifest,
      ],
    ),
    (error) => error.code === "P3F01",
  );
  await assert.rejects(
    db.query(
      "select public.lukas_drawing_request_collaborative_review($1,$2,$3,$4,0,$5,$6,$7,$8)",
      [
        ids.revisionId,
        requestId,
        "f".repeat(64),
        manifest.length,
        subjectVersion,
        stateVectorBase64,
        operationStatuses,
        manifest,
      ],
    ),
    (error) => error.code === "P3F01",
  );

  const first = await db.query(
    "select public.lukas_drawing_request_collaborative_review($1,$2,$3,$4,0,$5,$6,$7,$8) result",
    [
      ids.revisionId,
      requestId,
      manifestSha256,
      manifest.length,
      subjectVersion,
      stateVectorBase64,
      operationStatuses,
      manifest,
    ],
  );
  const retry = await db.query(
    "select public.lukas_drawing_request_collaborative_review($1,$2,$3,$4,0,$5,$6,$7,$8) result",
    [
      ids.revisionId,
      requestId,
      manifestSha256,
      manifest.length,
      subjectVersion,
      stateVectorBase64,
      operationStatuses,
      manifest,
    ],
  );
  assert.deepEqual(retry.rows[0].result, first.rows[0].result);
  assert.equal(first.rows[0].result.freezeRequestId, requestId);
  await db.exec("reset role");
  const evidence = await db.query(
    `select r.status,s.freeze_state,s.freeze_request_id,s.accepted_manifest_sha256,
      sn.sha256,encode(extensions.digest(convert_to(sn.canonical_json::text,'UTF8'),'sha256'),'hex') recomputed
     from public.lukas_drawing_revisions r
     join private.lukas_drawing_collaboration_states s on s.revision_id=r.id
     join public.lukas_drawing_snapshots sn on sn.revision_id=r.id
     where r.id=$1`,
    [ids.revisionId],
  );
  assert.equal(evidence.rows[0].status, "review_requested");
  assert.equal(evidence.rows[0].freeze_state, "frozen");
  assert.equal(evidence.rows[0].accepted_manifest_sha256, manifestSha256);
  assert.equal(evidence.rows[0].sha256, evidence.rows[0].recomputed);

  await asActor(REVIEWER);
  await db.query(
    "select public.lukas_drawing_record_revision_decision($1,$2,$3,'rejected','changes required')",
    [
      ids.revisionId,
      first.rows[0].result.subjectVersion,
      first.rows[0].result.snapshotSha256,
    ],
  );
  await db.exec("reset role");
  const rejected = await db.query(
    `select r.status,r.version,s.freeze_state,s.review_committed_at,
      s.frozen_subject_revision_version,s.frozen_yjs_state_vector,
      s.frozen_operation_statuses,s.accepted_manifest_sha256
     from public.lukas_drawing_revisions r
     join private.lukas_drawing_collaboration_states s on s.revision_id=r.id
     where r.id=$1`,
    [ids.revisionId],
  );
  assert.deepEqual(rejected.rows[0], {
    status: "draft",
    version: 2,
    freeze_state: "released",
    review_committed_at: null,
    frozen_subject_revision_version: null,
    frozen_yjs_state_vector: null,
    frozen_operation_statuses: null,
    accepted_manifest_sha256: null,
  });

  await asActor(OWNER);
  await assert.rejects(
    db.query(
      "select public.lukas_drawing_request_collaborative_review($1,$2,$3,$4,0,$5,$6,$7,$8)",
      [
        ids.revisionId,
        requestId,
        manifestSha256,
        manifest.length,
        subjectVersion,
        stateVectorBase64,
        operationStatuses,
        manifest,
      ],
    ),
    (error) => error.code === "P3F01",
  );

  const secondOperationId = randomUUID();
  const secondLayerId = randomUUID();
  await applyOperationWithId(
    ids.revisionId,
    secondOperationId,
    "add_layer",
    { [secondLayerId]: 1 },
    {
      type: "add_layer",
      layer: {
        id: secondLayerId,
        name: "After rejection",
        canvasId: ids.canvasId,
        sortOrder: 10,
        visible: true,
        locked: false,
        version: 1,
      },
    },
    {},
  );
  const secondAccepted = await db.query(
    `select client_operation_id "clientOperationId",revision_id "revisionId",
      actor_id "actorId",operation_type "operationType",base_versions "baseVersions",
      forward,inverse,history_action "historyAction",
      original_operation_id "originalOperationId",sequence,result_versions "resultVersions"
     from public.lukas_drawing_operations where revision_id=$1 order by sequence`,
    [ids.revisionId],
  );
  const secondManifest = secondAccepted.rows;
  const secondSha = createHash("sha256")
    .update(JSON.stringify(secondManifest))
    .digest("hex");
  const secondStatuses = secondManifest.map((operation) => ({
    clientOperationId: operation.clientOperationId,
    status: "acked",
    authoritativeSequence: Number(operation.sequence),
    resultVersions: operation.resultVersions,
  }));
  const secondRequestId = randomUUID();
  const secondOwnerToken = randomUUID();
  await db.exec("reset role; set role lukas_drawing_collaboration");
  await db.query(
    "select private.lukas_drawing_collaboration_acquire_freeze_lease($1,$2,$3,$4,30,$5::bytea,0)",
    [
      PROJECT,
      ids.revisionId,
      secondRequestId,
      secondOwnerToken,
      Buffer.from([0]),
    ],
  );
  await db.query(
    "select private.lukas_drawing_collaboration_begin_freeze($1,$2,$3,$4::bytea,0,$5)",
    [
      PROJECT,
      ids.revisionId,
      secondRequestId,
      Buffer.from([8]),
      secondOwnerToken,
    ],
  );
  await db.query(
    "select private.lukas_drawing_collaboration_complete_freeze($1,$2,$3,$4::bytea,$5,$6,$7,0,$8,$9,$10)",
    [
      PROJECT,
      ids.revisionId,
      secondRequestId,
      Buffer.from([9]),
      secondManifest,
      secondSha,
      secondManifest.length,
      stateVectorBase64,
      secondStatuses,
      secondOwnerToken,
    ],
  );
  await db.exec("reset role");
  await asActor(OWNER);
  const secondReview = await db.query(
    "select public.lukas_drawing_request_collaborative_review($1,$2,$3,$4,0,2,$5,$6,$7) result",
    [
      ids.revisionId,
      secondRequestId,
      secondSha,
      secondManifest.length,
      stateVectorBase64,
      secondStatuses,
      secondManifest,
    ],
  );
  assert.equal(secondReview.rows[0].result.subjectRevisionVersion, 2);
  await asActor(REVIEWER);
  await db.query(
    "select public.lukas_drawing_record_revision_decision($1,$2,$3,'approved','accepted')",
    [
      ids.revisionId,
      secondReview.rows[0].result.subjectVersion,
      secondReview.rows[0].result.snapshotSha256,
    ],
  );
  await db.exec("reset role; set role lukas_drawing_collaboration");
  await assert.rejects(
    db.query(
      "select private.lukas_drawing_collaboration_release_freeze($1,$2,$3,$4::bytea,$5)",
      [
        PROJECT,
        ids.revisionId,
        secondRequestId,
        Buffer.from([10]),
        secondOwnerToken,
      ],
    ),
    (error) => error.code === "P3F02",
  );
  await db.exec("reset role");
});

test("P3 stale release cannot report success or release a newer freeze", async () => {
  const ids = await createDocument("P3 stale release fence");
  const firstRequestId = randomUUID();
  const secondRequestId = randomUUID();
  const firstOwnerToken = randomUUID();
  const secondOwnerToken = randomUUID();
  await db.exec("reset role; set role lukas_drawing_collaboration");
  await persistCollaborationState(ids.revisionId);
  await db.query(
    "select private.lukas_drawing_collaboration_acquire_freeze_lease($1,$2,$3,$4,30,$5::bytea,0)",
    [
      PROJECT,
      ids.revisionId,
      firstRequestId,
      firstOwnerToken,
      Buffer.from([0]),
    ],
  );
  await db.query(
    "select private.lukas_drawing_collaboration_begin_freeze($1,$2,$3,$4::bytea,0,$5)",
    [
      PROJECT,
      ids.revisionId,
      firstRequestId,
      Buffer.from([1]),
      firstOwnerToken,
    ],
  );
  await db.query(
    "select private.lukas_drawing_collaboration_release_freeze($1,$2,$3,$4::bytea,$5)",
    [
      PROJECT,
      ids.revisionId,
      firstRequestId,
      Buffer.from([2]),
      firstOwnerToken,
    ],
  );
  await db.query(
    "select private.lukas_drawing_collaboration_acquire_freeze_lease($1,$2,$3,$4,30,$5::bytea,0)",
    [
      PROJECT,
      ids.revisionId,
      secondRequestId,
      secondOwnerToken,
      Buffer.from([0]),
    ],
  );
  await db.query(
    "select private.lukas_drawing_collaboration_begin_freeze($1,$2,$3,$4::bytea,0,$5)",
    [
      PROJECT,
      ids.revisionId,
      secondRequestId,
      Buffer.from([3]),
      secondOwnerToken,
    ],
  );
  await assert.rejects(
    db.query(
      "select private.lukas_drawing_collaboration_release_freeze($1,$2,$3,$4::bytea,$5)",
      [
        PROJECT,
        ids.revisionId,
        firstRequestId,
        Buffer.from([4]),
        firstOwnerToken,
      ],
    ),
    (error) => error.code === "P3F03",
  );
  await db.exec("reset role");
  const state = await db.query(
    "select freeze_state,freeze_request_id from private.lukas_drawing_collaboration_states where revision_id=$1",
    [ids.revisionId],
  );
  assert.deepEqual(state.rows[0], {
    freeze_state: "freezing",
    freeze_request_id: secondRequestId,
  });
});

test("P3 cross-instance lease admits one owner and fences stale takeover", async () => {
  const ids = await createDocument("P3 cross-instance lease");
  const requestId = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  await db.exec("reset role");
  const privileges = await db.query(`select
    has_function_privilege('lukas_drawing_collaboration','private.lukas_drawing_collaboration_acquire_freeze_lease(uuid,uuid,uuid,uuid,integer,bytea,bigint)','execute') collaboration_acquire,
    has_function_privilege('service_role','private.lukas_drawing_collaboration_acquire_freeze_lease(uuid,uuid,uuid,uuid,integer,bytea,bigint)','execute') service_acquire,
    has_table_privilege('lukas_drawing_collaboration','private.lukas_drawing_collaboration_freeze_leases','select') collaboration_table,
    has_table_privilege('service_role','private.lukas_drawing_collaboration_freeze_leases','select') service_table,
    has_function_privilege('lukas_drawing_collaboration','private.lukas_drawing_collaboration_begin_freeze(uuid,uuid,uuid,bytea,bigint)','execute') legacy_begin`);
  assert.deepEqual(privileges.rows[0], {
    collaboration_acquire: true,
    service_acquire: false,
    collaboration_table: false,
    service_table: false,
    legacy_begin: false,
  });
  await db.exec("set role lukas_drawing_collaboration");
  await db.query(
    "select private.lukas_drawing_collaboration_acquire_freeze_lease($1,$2,$3,$4,5,null,null)",
    [PROJECT, ids.revisionId, requestId, ownerA],
  );
  await db.exec("reset role");
  const prepared = await db.query(
    `select
      (select count(*)::int from private.lukas_drawing_collaboration_freeze_leases where revision_id=$1) lease_count,
      (select count(*)::int from private.lukas_drawing_collaboration_states where revision_id=$1) state_count`,
    [ids.revisionId],
  );
  assert.deepEqual(prepared.rows[0], { lease_count: 1, state_count: 0 });
  await db.exec("set role lukas_drawing_collaboration");
  await assert.rejects(
    db.query(
      "select private.lukas_drawing_collaboration_acquire_freeze_lease($1,$2,$3,$4,5,$5::bytea,0)",
      [PROJECT, ids.revisionId, requestId, ownerB, Buffer.from([0])],
    ),
    (error) => error.code === "P3F03",
  );
  await db.query(
    "select private.lukas_drawing_collaboration_acquire_freeze_lease($1,$2,$3,$4,5,$5::bytea,0)",
    [PROJECT, ids.revisionId, requestId, ownerA, Buffer.from([0])],
  );
  await db.query(
    "select private.lukas_drawing_collaboration_begin_freeze($1,$2,$3,$4::bytea,0,$5)",
    [PROJECT, ids.revisionId, requestId, Buffer.from([1]), ownerA],
  );
  await db.exec("reset role");
  await db.query(
    `with setting as (
      select set_config('private.lukas_drawing_freeze_write','1',true)
    ) update private.lukas_drawing_collaboration_states
      set freeze_owner_lease_expires_at=clock_timestamp()-interval '1 second'
      from setting where revision_id=$1`,
    [ids.revisionId],
  );
  await db.query(
    `update private.lukas_drawing_collaboration_freeze_leases
      set lease_expires_at=clock_timestamp()-interval '1 second'
      where revision_id=$1`,
    [ids.revisionId],
  );
  await db.exec("set role lukas_drawing_collaboration");
  await db.query(
    "select private.lukas_drawing_collaboration_acquire_freeze_lease($1,$2,$3,$4,5,$5::bytea,0)",
    [PROJECT, ids.revisionId, requestId, ownerB, Buffer.from([0])],
  );
  const manifest = [];
  const manifestSha256 = createHash("sha256")
    .update(JSON.stringify(manifest))
    .digest("hex");
  await assert.rejects(
    db.query(
      "select private.lukas_drawing_collaboration_complete_freeze($1,$2,$3,$4::bytea,$5,$6,0,0,$7,'[]'::jsonb,$8)",
      [
        PROJECT,
        ids.revisionId,
        requestId,
        Buffer.from([2]),
        manifest,
        manifestSha256,
        "AQ==",
        ownerA,
      ],
    ),
    (error) => error.code === "P3F03",
  );
  const completed = await db.query(
    "select private.lukas_drawing_collaboration_complete_freeze($1,$2,$3,$4::bytea,$5,$6,0,0,$7,'[]'::jsonb,$8) result",
    [
      PROJECT,
      ids.revisionId,
      requestId,
      Buffer.from([2]),
      manifest,
      manifestSha256,
      "AQ==",
      ownerB,
    ],
  );
  assert.equal(completed.rows[0].result.state, "frozen");
  await db.exec("reset role");
});

test("P3 preload lease fences every generic state store before detached freeze begins", async () => {
  const ids = await createDocument("P3 preload store fence");
  const requestId = randomUUID();
  const ownerToken = randomUUID();
  const detachedBytes = Buffer.from([11, 12, 13]);
  const detachedSha = createHash("sha256").update(detachedBytes).digest("hex");

  await db.exec("reset role");
  const privileges = await db.query(`select
    has_function_privilege('lukas_drawing_collaboration','private.lukas_drawing_collaboration_store_state(uuid,uuid,uuid,smallint,bytea,bigint,bigint,text)','execute') user_store,
    has_function_privilege('lukas_drawing_collaboration','private.lukas_drawing_collaboration_service_store_state(uuid,uuid,smallint,bytea,bigint,bigint,text)','execute') service_store,
    has_function_privilege('lukas_drawing_collaboration','private.lukas_drawing_collaboration_store_state_unfenced(uuid,uuid,uuid,smallint,bytea,bigint,bigint,text)','execute') user_unfenced,
    has_function_privilege('lukas_drawing_collaboration','private.lukas_drawing_collaboration_service_store_state_unfenced(uuid,uuid,smallint,bytea,bigint,bigint,text)','execute') service_unfenced,
    has_function_privilege('lukas_drawing_collaboration','private.lukas_drawing_collaboration_store_state(uuid,uuid,uuid,smallint,bytea,bigint)','execute') legacy_store,
    has_function_privilege('lukas_drawing_collaboration','private.lukas_drawing_collaboration_assert_store_unleased(uuid,uuid)','execute') fence_helper,
    has_function_privilege('service_role','private.lukas_drawing_collaboration_service_store_state(uuid,uuid,smallint,bytea,bigint,bigint,text)','execute') data_api_store`);
  assert.deepEqual(privileges.rows[0], {
    user_store: true,
    service_store: true,
    user_unfenced: false,
    service_unfenced: false,
    legacy_store: false,
    fence_helper: false,
    data_api_store: false,
  });

  await db.exec("set role lukas_drawing_collaboration");
  const initial = await db.query(
    "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,0::bigint,0::bigint,null)",
    [OWNER, PROJECT, ids.revisionId, detachedBytes],
  );
  assert.equal(initial.rows[0].store_generation, 1);
  await db.query(
    "select private.lukas_drawing_collaboration_acquire_freeze_lease($1,$2,$3,$4,30,null,null)",
    [PROJECT, ids.revisionId, requestId, ownerToken],
  );

  for (const runStore of [
    () =>
      db.query(
        "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,0::bigint,1::bigint,$5)",
        [OWNER, PROJECT, ids.revisionId, Buffer.from([21]), detachedSha],
      ),
    () =>
      db.query(
        "select * from private.lukas_drawing_collaboration_service_store_state($1,$2,1::smallint,$3::bytea,0::bigint,1::bigint,$4)",
        [PROJECT, ids.revisionId, Buffer.from([22]), detachedSha],
      ),
  ]) {
    await assert.rejects(runStore(), (error) => error.code === "P3F03");
  }
  await db.exec("reset role");
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,0::bigint)",
      [OWNER, PROJECT, ids.revisionId, Buffer.from([23])],
    ),
    (error) => error.code === "P3F03",
  );

  const unchanged = await db.query(
    "select yjs_state,yjs_sha256,store_generation from private.lukas_drawing_collaboration_states where revision_id=$1",
    [ids.revisionId],
  );
  assert.deepEqual([...unchanged.rows[0].yjs_state], [...detachedBytes]);
  assert.equal(unchanged.rows[0].yjs_sha256, detachedSha);
  assert.equal(unchanged.rows[0].store_generation, 1);

  await db.exec("set role lukas_drawing_collaboration");
  await db.query(
    "select private.lukas_drawing_collaboration_acquire_freeze_lease($1,$2,$3,$4,30,$5::bytea,0)",
    [PROJECT, ids.revisionId, requestId, ownerToken, detachedBytes],
  );
  await db.query(
    "select private.lukas_drawing_collaboration_begin_freeze($1,$2,$3,$4::bytea,0,$5)",
    [PROJECT, ids.revisionId, requestId, detachedBytes, ownerToken],
  );
  const manifest = [];
  const manifestSha = createHash("sha256")
    .update(JSON.stringify(manifest))
    .digest("hex");
  await db.query(
    "select private.lukas_drawing_collaboration_complete_freeze($1,$2,$3,$4::bytea,$5,$6,0,0,'AQ==','[]'::jsonb,$7)",
    [
      PROJECT,
      ids.revisionId,
      requestId,
      detachedBytes,
      manifest,
      manifestSha,
      ownerToken,
    ],
  );
  await db.exec("reset role");
  const frozen = await db.query(
    "select yjs_state,yjs_sha256,store_generation,frozen_yjs_state_vector,freeze_state from private.lukas_drawing_collaboration_states where revision_id=$1",
    [ids.revisionId],
  );
  assert.deepEqual([...frozen.rows[0].yjs_state], [...detachedBytes]);
  assert.equal(frozen.rows[0].yjs_sha256, detachedSha);
  assert.equal(frozen.rows[0].store_generation, 3);
  assert.equal(frozen.rows[0].frozen_yjs_state_vector, "AQ==");
  assert.equal(frozen.rows[0].freeze_state, "frozen");
});

test("P3 service store persists initial and CAS state through the unleased fenced wrapper", async () => {
  const ids = await createDocument("P3 service store success");
  const [sequence] = (await db.query(
    `select coalesce(max(sequence),0::bigint) sequence
     from public.lukas_drawing_operations where revision_id=$1`,
    [ids.revisionId],
  )).rows;
  const baseOperationSequence = Number(sequence.sequence);
  const initialBytes = Buffer.from([41, 42, 43]);
  const initialSha = createHash("sha256").update(initialBytes).digest("hex");
  const updatedBytes = Buffer.from([41, 42, 43, 44]);
  const updatedSha = createHash("sha256").update(updatedBytes).digest("hex");

  await db.exec("reset role; set role lukas_drawing_collaboration");
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_service_store_state($1,$2,1::smallint,$3::bytea,$4::bigint,0::bigint,null)",
      [PROJECT, ids.revisionId, Buffer.from([40]), baseOperationSequence + 1],
    ),
    (error) => error.code === "P3S01",
  );
  const initial = await db.query(
    "select * from private.lukas_drawing_collaboration_service_store_state($1,$2,1::smallint,$3::bytea,$4::bigint,0::bigint,null)",
    [PROJECT, ids.revisionId, initialBytes, baseOperationSequence],
  );
  assert.equal(initial.rows[0].store_generation, 1);
  assert.equal(initial.rows[0].yjs_sha256, initialSha);
  assert.deepEqual([...initial.rows[0].yjs_state], [...initialBytes]);
  const updated = await db.query(
    "select * from private.lukas_drawing_collaboration_service_store_state($1,$2,1::smallint,$3::bytea,$4::bigint,$5::bigint,$6)",
    [
      PROJECT,
      ids.revisionId,
      updatedBytes,
      baseOperationSequence,
      initial.rows[0].store_generation,
      initial.rows[0].yjs_sha256,
    ],
  );
  assert.equal(updated.rows[0].store_generation, 2);
  assert.equal(updated.rows[0].yjs_sha256, updatedSha);
  assert.deepEqual([...updated.rows[0].yjs_state], [...updatedBytes]);
  await db.exec("reset role");
  const persisted = await db.query(
    `select yjs_state,yjs_sha256,store_generation,base_operation_sequence,byte_size
     from private.lukas_drawing_collaboration_states where revision_id=$1`,
    [ids.revisionId],
  );
  assert.deepEqual([...persisted.rows[0].yjs_state], [...updatedBytes]);
  assert.equal(persisted.rows[0].yjs_sha256, updatedSha);
  assert.equal(persisted.rows[0].store_generation, 2);
  assert.equal(
    persisted.rows[0].base_operation_sequence,
    baseOperationSequence,
  );
  assert.equal(persisted.rows[0].byte_size, updatedBytes.byteLength);
});

test("P3 preload lease fences absent-state initialization and expired preload is cleaned", async () => {
  const fenced = await createDocument("P3 absent preload fence");
  const requestId = randomUUID();
  const ownerToken = randomUUID();
  await db.exec("reset role; set role lukas_drawing_collaboration");
  await db.query(
    "select private.lukas_drawing_collaboration_acquire_freeze_lease($1,$2,$3,$4,30,null,null)",
    [PROJECT, fenced.revisionId, requestId, ownerToken],
  );
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,0::bigint,0::bigint,null)",
      [OWNER, PROJECT, fenced.revisionId, Buffer.from([31])],
    ),
    (error) => error.code === "P3F03",
  );
  await assert.rejects(
    db.query(
      "select * from private.lukas_drawing_collaboration_service_store_state($1,$2,1::smallint,$3::bytea,0::bigint,0::bigint,null)",
      [PROJECT, fenced.revisionId, Buffer.from([32])],
    ),
    (error) => error.code === "P3F03",
  );
  await db.exec("reset role");
  const absent = await db.query(
    "select count(*)::int count from private.lukas_drawing_collaboration_states where revision_id=$1",
    [fenced.revisionId],
  );
  assert.equal(absent.rows[0].count, 0);

  await db.query(
    "update private.lukas_drawing_collaboration_freeze_leases set lease_expires_at=clock_timestamp()-interval '1 second' where revision_id=$1",
    [fenced.revisionId],
  );
  await db.exec("set role lukas_drawing_collaboration");
  const stored = await db.query(
    "select * from private.lukas_drawing_collaboration_store_state($1,$2,$3,1::smallint,$4::bytea,0::bigint,0::bigint,null)",
    [OWNER, PROJECT, fenced.revisionId, Buffer.from([33])],
  );
  assert.equal(stored.rows[0].store_generation, 1);
  await db.exec("reset role");
  const cleaned = await db.query(
    "select count(*)::int count from private.lukas_drawing_collaboration_freeze_leases where revision_id=$1",
    [fenced.revisionId],
  );
  assert.equal(cleaned.rows[0].count, 0);
});

test("P2 navigation persists exact layer-only reorder and inverse through the RPC", async () => {
  const ids = await createDocument();
  const detailId = randomUUID();
  const detail = {
    id: detailId,
    name: "Details",
    visible: true,
    locked: false,
    canvasId: ids.canvasId,
    sortOrder: 2,
    version: 1,
  };
  await applyOperation(
    ids.revisionId,
    "add_layer",
    { [detailId]: 1 },
    { type: "add_layer", layer: detail },
    {},
  );
  const existingWork = await db.query(
    "select name,visible,locked,system_kind,canvas_id,sort_order,version from public.lukas_drawing_layers where id=$1",
    [ids.workLayerId],
  );
  const existingDetail = await db.query(
    "select name,visible,locked,system_kind,canvas_id,sort_order,version from public.lukas_drawing_layers where id=$1",
    [detailId],
  );
  const work = {
    id: ids.workLayerId,
    name: existingWork.rows[0].name,
    visible: existingWork.rows[0].visible,
    locked: existingWork.rows[0].locked,
    systemKind: existingWork.rows[0].system_kind,
    canvasId: existingWork.rows[0].canvas_id,
    sortOrder: 1,
    version: existingWork.rows[0].version,
  };
  const persistedDetail = {
    id: detailId,
    name: existingDetail.rows[0].name,
    visible: existingDetail.rows[0].visible,
    locked: existingDetail.rows[0].locked,
    systemKind: existingDetail.rows[0].system_kind,
    canvasId: existingDetail.rows[0].canvas_id,
    sortOrder: existingDetail.rows[0].sort_order,
    version: existingDetail.rows[0].version,
  };
  const first = {
    type: "mutate_structure",
    actions: [
      { kind: "put_layer", entity: work, baseVersion: 1 },
      {
        kind: "put_layer",
        entity: { ...persistedDetail, sortOrder: 1 },
        baseVersion: 1,
      },
    ],
  };
  const undoFirst = {
    type: "mutate_structure",
    actions: [
      { kind: "put_layer", entity: persistedDetail, baseVersion: 2 },
      {
        kind: "put_layer",
        entity: { ...work, sortOrder: existingWork.rows[0].sort_order },
        baseVersion: 2,
      },
    ],
  };
  const redoFirst = {
    type: "mutate_structure",
    actions: [
      { kind: "put_layer", entity: { ...work, version: 2 }, baseVersion: 3 },
      {
        kind: "put_layer",
        entity: { ...persistedDetail, sortOrder: 1, version: 2 },
        baseVersion: 3,
      },
    ],
  };
  const applied = await applyOperation(
    ids.revisionId,
    "mutate_structure",
    { [ids.workLayerId]: 1, [detailId]: 1 },
    first,
    undoFirst,
  );
  assert.deepEqual(applied.resultVersions, {
    [ids.workLayerId]: 2,
    [detailId]: 2,
  });
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    { [ids.workLayerId]: 2, [detailId]: 2 },
    undoFirst,
    redoFirst,
  );
  await db.exec("reset role");
  const persisted = await db.query(
    "select id,sort_order,version from public.lukas_drawing_layers where id in ($1,$2) order by id",
    [ids.workLayerId, detailId],
  );
  const restored = Object.fromEntries(
    persisted.rows.map((row) => [row.id, [row.sort_order, row.version]]),
  );
  assert.deepEqual(restored[ids.workLayerId], [
    existingWork.rows[0].sort_order,
    3,
  ]);
  assert.deepEqual(restored[detailId], [existingDetail.rows[0].sort_order, 3]);
});

test("production canvas and layer commands round-trip through outbox, RPC, undo, and redo", async () => {
  const ids = await createDocument();
  const rows = await Promise.all([
    db.query(
      `select id,revision_id "revisionId",name,sort_order "sortOrder",version
       from public.lukas_drawing_pages where revision_id=$1`,
      [ids.revisionId],
    ),
    db.query(
      `select id,page_id "pageId",name,space_kind "spaceKind",
              width_mm "widthMillimeters",height_mm "heightMillimeters",
              sort_order "sortOrder",version
       from public.lukas_drawing_canvases where revision_id=$1`,
      [ids.revisionId],
    ),
    db.query(
      `select id,name,visible,locked,system_kind "systemKind",canvas_id "canvasId",
              sort_order "sortOrder",version
       from public.lukas_drawing_layers where revision_id=$1`,
      [ids.revisionId],
    ),
  ]);
  const structure = {
    pages: Object.fromEntries(rows[0].rows.map((row) => [row.id, row])),
    canvases: Object.fromEntries(
      rows[1].rows.map((row) => [row.id, { ...row, background: null }]),
    ),
    layers: Object.fromEntries(rows[2].rows.map((row) => [row.id, row])),
    objects: {},
    styles: {},
    blocks: {},
    blockInstances: {},
    propertySchemas: {},
    propertyValues: {},
    tables: {},
  };
  let local = drawingCommands.createDrawingDocumentState({
    revisionId: ids.revisionId,
    structure,
  });
  const outbox = drawingOutbox.createDrawingOutbox(runtimeOutboxAdapter(), {
    ownerId: OWNER,
    revisionId: ids.revisionId,
    schedule: () => () => {},
  });
  const client = pgliteWorkspaceClient(db);
  const persist = async (recorded) => {
    await outbox.enqueue(operationInput(recorded));
    await outbox.flush(async (operation) => {
      await workspaceServer.applyDrawingOperation(client, operation);
      return {
        clientOperationId: operation.clientOperationId,
        status: "acked",
      };
    });
  };

  const added = drawingCommands.applyDrawingCommand(
    local,
    drawingCommands.createDrawingLayerCommand(
      local,
      OWNER,
      "Details",
      () => randomUUID(),
      ids.canvasId,
    ),
  );
  await persist(added.operation);
  local = added.state;
  const detailId = Object.keys(local.layers).find(
    (id) => id !== ids.workLayerId && local.layers[id].systemKind === "custom",
  );
  const reordered = drawingCommands.applyDrawingCommand(
    local,
    drawingCommands.reorderDrawingLayerCommand(
      local,
      OWNER,
      ids.workLayerId,
      "down",
    ),
  );
  await persist(reordered.operation);
  local = reordered.state;
  const undone = drawingCommands.undoDrawingCommand(local, OWNER);
  assert.ok(undone && !("kind" in undone));
  assert.equal(
    undone.operation.forward.actions.every(
      (action) => action.baseVersion === 2 && action.entity.version === 2,
    ),
    true,
  );
  await persist(undone.operation);
  local = undone.state;
  const redone = drawingCommands.redoDrawingCommand(local, OWNER);
  assert.ok(redone && !("kind" in redone));
  assert.equal(
    redone.operation.forward.actions.every(
      (action) => action.baseVersion === 3 && action.entity.version === 3,
    ),
    true,
  );
  await persist(redone.operation);
  const persisted = await db.query(
    "select id,sort_order,version from public.lukas_drawing_layers where id in ($1,$2) order by id",
    [ids.workLayerId, detailId],
  );
  assert.deepEqual(
    persisted.rows.map((row) => row.version),
    [4, 4],
  );
  const createdCanvasIds = [];
  for (const spaceKind of ["paper", "model", "paper", "model"]) {
    const created = drawingCommands.applyDrawingCommand(
      local,
      drawingCommands.createDrawingCanvasCommand(
        local,
        OWNER,
        ids.pageId,
        spaceKind,
        spaceKind === "paper" ? "Paper" : "Model",
        () => randomUUID(),
      ),
    );
    createdCanvasIds.push(
      created.operation.forward.actions.find(
        (action) => action.kind === "put_canvas",
      ).entity.id,
    );
    await persist(created.operation);
    local = created.state;
  }
  assert.throws(
    () =>
      drawingCommands.reorderDrawingCanvasCommand(
        local,
        OWNER,
        ids.canvasId,
        "down",
      ),
    /default paper canvas/i,
  );
  assert.throws(
    () =>
      drawingCommands.reorderDrawingCanvasCommand(
        local,
        OWNER,
        createdCanvasIds[0],
        "up",
      ),
    /cannot move farther/i,
  );
  const canvasReordered = drawingCommands.applyDrawingCommand(
    local,
    drawingCommands.reorderDrawingCanvasCommand(
      local,
      OWNER,
      createdCanvasIds.at(-1),
      "up",
    ),
  );
  await persist(canvasReordered.operation);
  local = canvasReordered.state;
  const createdLayers = await db.query(
    "select name from public.lukas_drawing_layers where revision_id=$1 and name in ('Paper work','Paper work 2','Model work','Model work 2') order by name",
    [ids.revisionId],
  );
  assert.deepEqual(
    createdLayers.rows.map((row) => row.name),
    ["Model work", "Model work 2", "Paper work", "Paper work 2"],
  );
  const canvasOrders = await db.query(
    "select id,sort_order from public.lukas_drawing_canvases where page_id=$1 order by sort_order,id",
    [ids.pageId],
  );
  assert.equal(canvasOrders.rows[0].id, ids.canvasId);
  assert.deepEqual(
    canvasOrders.rows.slice(1).map((row) => row.sort_order),
    [1, 2, 3, 4],
  );
  outbox.dispose();
});

test("P2 navigation database invariant refuses removal of the last page", async () => {
  const ids = await createDocument();
  await db.exec("reset role");
  await db.query(
    "select set_config('private.lukas_drawing_delete_page_ids',$1,false)",
    [ids.pageId],
  );
  await assert.rejects(
    db.query("delete from public.lukas_drawing_pages where id=$1", [
      ids.pageId,
    ]),
    (error) =>
      error.code === "P1C01" && /at least one page/i.test(error.message),
  );
  await db.query(
    "select set_config('private.lukas_drawing_delete_page_ids','',false)",
  );
  await asActor(OWNER);
});

test("release hardening gives one non-null source one document and keeps blank documents repeatable", async () => {
  await asActor(OWNER);
  const source = randomUUID();
  await db.exec("reset role");
  await db.query(
    `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256)
     values ($1,$2,$3,'pdf',$4)`,
    [source, PROJECT, OWNER, "d".repeat(64)],
  );
  await asActor(OWNER);

  const createFromSource = () =>
    db.query("select public.lukas_drawing_create_document($1,$2,$3,false)", [
      PROJECT,
      source,
      randomUUID(),
    ]);
  const outcomes = await Promise.allSettled([
    createFromSource(),
    createFromSource(),
  ]);
  assert.equal(
    outcomes.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  const duplicate = outcomes.find(({ status }) => status === "rejected");
  assert.equal(duplicate.reason.code, "P1C01");
  await assert.rejects(createFromSource(), (error) => error.code === "P1C01");

  const firstBlank = await db.query(
    "select public.lukas_drawing_create_document($1,null,$2,true) result",
    [PROJECT, randomUUID()],
  );
  const secondBlank = await db.query(
    "select public.lukas_drawing_create_document($1,null,$2,true) result",
    [PROJECT, randomUUID()],
  );
  assert.notEqual(
    firstBlank.rows[0].result.documentId,
    secondBlank.rows[0].result.documentId,
  );
});

test("release hardening binds an idempotency key to the canonical stored request", async () => {
  const ids = await createDocument();
  const object = circleObject(randomUUID(), ids.workLayerId);
  const clientOperationId = randomUUID();
  const args = [
    ids.revisionId,
    clientOperationId,
    "add_objects",
    {},
    { type: "add_objects", objects: [object] },
    { type: "delete_objects", objectIds: [object.id] },
  ];
  const send = (values = args) =>
    db.query(
      "select public.lukas_drawing_apply_operation($1,$2,$3,$4,$5,$6) result",
      values,
    );

  const first = await send();
  assert.deepEqual((await send()).rows[0].result, first.rows[0].result);
  const mismatches = [
    [
      ...args.slice(0, 2),
      "update_objects",
      { [object.id]: 1 },
      {
        type: "update_objects",
        updates: [{ objectId: object.id, patch: { name: "Changed" } }],
      },
      {
        type: "update_objects",
        updates: [{ objectId: object.id, patch: { name: "Circle" } }],
      },
    ],
    [args[0], args[1], args[2], { [object.id]: 1 }, args[4], args[5]],
    [args[0], args[1], args[2], args[3], { ...args[4], extra: true }, args[5]],
    [args[0], args[1], args[2], args[3], args[4], {}],
  ];
  for (const mismatch of mismatches)
    await assert.rejects(send(mismatch), (error) => error.code === "P1C01");

  await asActor(EDITOR);
  await assert.rejects(send(), (error) => error.code === "P1C01");
});

test("release hardening makes inaccessible and random revision targets indistinguishable", async () => {
  const foreignProject = randomUUID();
  const foreignFile = randomUUID();
  await db.exec("reset role");
  await db.query(
    "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
    [foreignProject, OUTSIDER],
  );
  await db.query(
    `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256)
     values ($1,$2,$3,'pdf',$4)`,
    [foreignFile, foreignProject, OUTSIDER, "e".repeat(64)],
  );
  await asActor(OUTSIDER);
  const foreign = await db.query(
    "select public.lukas_drawing_create_document($1,$2,$3,false) result",
    [foreignProject, foreignFile, randomUUID()],
  );
  const foreignRevision = foreign.rows[0].result.revisionId;
  const foreignReview = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [foreignRevision],
  );
  await asActor(EDITOR);
  const randomRevision = randomUUID();
  const operationArgs = (revisionId) => [
    revisionId,
    randomUUID(),
    "add_layer",
    {},
    {
      type: "add_layer",
      layer: {
        id: randomUUID(),
        name: "Unavailable",
        visible: true,
        locked: false,
        version: 1,
      },
    },
    {},
  ];
  const probes = [
    (revisionId) =>
      db.query(
        "select public.lukas_drawing_apply_operation($1,$2,$3,$4,$5,$6)",
        operationArgs(revisionId),
      ),
    (revisionId) =>
      db.query("select public.lukas_drawing_request_review($1)", [revisionId]),
    (revisionId) =>
      db.query(
        "select public.lukas_drawing_record_revision_decision($1,$2,$3,'approved','probe')",
        [
          revisionId,
          foreignReview.rows[0].result.subjectVersion,
          foreignReview.rows[0].result.snapshotSha256,
        ],
      ),
  ];

  for (const probe of probes) {
    const errors = [];
    for (const revisionId of [foreignRevision, randomRevision]) {
      try {
        await probe(revisionId);
        assert.fail("expected unavailable target");
      } catch (error) {
        errors.push({ code: error.code, message: error.message });
      }
    }
    assert.deepEqual(errors, [
      { code: "P1R01", message: "Drawing revision target is unavailable" },
      { code: "P1R01", message: "Drawing revision target is unavailable" },
    ]);
  }
});

test("release hardening reports a real stale object version with a stable conflict code", async () => {
  const ids = await createDocument();
  const object = circleObject(randomUUID(), ids.workLayerId);
  await addObject(ids, object);
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "update_objects",
      { [object.id]: 99 },
      {
        type: "update_objects",
        updates: [{ objectId: object.id, patch: { name: "Stale" } }],
      },
      {
        type: "update_objects",
        updates: [{ objectId: object.id, patch: { name: "Circle" } }],
      },
    ),
    (error) => error.code === "P1C01",
  );
});

test("real PGlite errors drive terminal conflict and transient retry through server and outbox", async () => {
  const ids = await createDocument();
  const object = circleObject(randomUUID(), ids.workLayerId);
  await addObject(ids, object);
  const operation = {
    clientOperationId: randomUUID(),
    revisionId: ids.revisionId,
    type: "update_objects",
    baseVersions: { [object.id]: 99 },
    forward: {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: "Stale" } }],
    },
    inverse: {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: "Circle" } }],
    },
    createdAt: "2026-08-25T00:00:00.000Z",
  };
  const workspace = {
    document: { revision: { id: ids.revisionId } },
  };
  const databaseClient = {
    async rpc(_name, args) {
      try {
        const result = await db.query(
          "select public.lukas_drawing_apply_operation($1,$2,$3,$4,$5,$6) result",
          [
            args.p_revision_id,
            args.p_client_operation_id,
            args.p_operation_type,
            args.p_base_versions,
            args.p_forward,
            args.p_inverse,
          ],
        );
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        return {
          data: null,
          error: { code: error.code, message: error.message },
        };
      }
    },
  };
  const routeFetch = (client) => async (_url, init) => {
    const result = await workspaceServer.handleWorkspaceMutation({
      client,
      projectId: PROJECT,
      capability: "editor",
      workspace,
      form: init.body,
    });
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      async json() {
        return result.body;
      },
    };
  };
  const conflicted = drawingOutbox.createDrawingOutbox(runtimeOutboxAdapter(), {
    ownerId: OWNER,
    revisionId: ids.revisionId,
    schedule: () => () => {},
  });
  await conflicted.enqueue(operation);
  await conflicted.flush((queued) =>
    drawingOutbox.sendDrawingOperation(
      queued,
      "/workspace",
      routeFetch(databaseClient),
    ),
  );
  assert.equal((await conflicted.entries())[0].status, "conflicted");
  assert.equal(
    drawingOutbox.drawingSaveStatus({ pending: 1, conflicted: true }),
    "충돌 검토 필요",
  );
  conflicted.dispose();

  for (const code of ["40001", "40P01"]) {
    const transientClient = {
      async rpc() {
        try {
          await db.exec(
            `do $$ begin raise exception using errcode='${code}', message='retry transaction'; end $$`,
          );
          assert.fail("expected transient database failure");
        } catch (error) {
          return {
            data: null,
            error: { code: error.code, message: error.message },
          };
        }
      },
    };
    const retryable = drawingOutbox.createDrawingOutbox(
      runtimeOutboxAdapter(),
      {
        ownerId: OWNER,
        revisionId: ids.revisionId,
        schedule: () => () => {},
      },
    );
    await retryable.enqueue({ ...operation, clientOperationId: randomUUID() });
    await assert.rejects(
      retryable.flush((queued) =>
        drawingOutbox.sendDrawingOperation(
          queued,
          "/workspace",
          routeFetch(transientClient),
        ),
      ),
      /retry transaction/,
    );
    assert.equal((await retryable.entries())[0].status, "pending");
    retryable.dispose();
  }
});

test("release migration duplicate preflight fails before installing the unique index", async () => {
  const preflightDb = new PGlite({ extensions: { pgcrypto } });
  try {
    await preflightDb.exec(foundationSql);
    await preflightDb.exec(await migration());
    await preflightDb.exec(await upgradeMigration());
    await preflightDb.exec(await issueLinkMigration());
    await preflightDb.query("insert into auth.users(id) values ($1)", [OWNER]);
    await preflightDb.query(
      "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
      [PROJECT, OWNER],
    );
    await preflightDb.query(
      `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256)
       values ($1,$2,$3,'pdf',$4)`,
      [PDF, PROJECT, OWNER, PDF_SHA],
    );
    await preflightDb.exec("set role authenticated");
    await preflightDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    for (let index = 0; index < 2; index += 1)
      await preflightDb.query(
        "select public.lukas_drawing_create_document($1,$2,$3,false)",
        [PROJECT, PDF, `duplicate ${index}`],
      );
    await preflightDb.exec("reset role");
    await assert.rejects(
      preflightDb.exec(await releaseHardeningMigration()),
      (error) =>
        error.code === "P1C01" && /before deployment/i.test(error.message),
    );
  } finally {
    await preflightDb.close();
  }
});

after(async () => {
  await db?.close();
  await vite.close();
});

test("task 9 table identity preflight fails closed on legacy duplicate JSON before upgrade", async () => {
  const upgradeDb = new PGlite({ extensions: { pgcrypto } });
  try {
    await upgradeDb.exec(foundationSql);
    for (const load of [
      migration,
      upgradeMigration,
      issueLinkMigration,
      releaseHardeningMigration,
      p2Migration,
      p2LegacyLayerBackfillMigration,
      p2HardeningMigration,
      p2CompatibilityMigration,
      p2HistoryReconciliationMigration,
      p2NavigationHardeningMigration,
      p2StyleGuardSqlstateMigration,
      p2BlockExactnessMigration,
      p2TemplateSnapshotGuardMigration,
      p2TemplateCloneIdempotencyMigration,
      p2BlockInstanceLineageMigration,
      p2TemplateSnapshotAuthorityMigration,
      p2LegacyTemplateSnapshotCloneMigration,
      p2LineageSnapshotWriterMigration,
      p2TemplateCloneSecurityMigration,
      p2TemplateCloneFinalLedgerMigration,
    ])
      await upgradeDb.exec(await load());
    await upgradeDb.query("insert into auth.users(id) values ($1)", [OWNER]);
    await upgradeDb.query(
      "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
      [PROJECT, OWNER],
    );
    await upgradeDb.exec("set role authenticated");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    const created = await upgradeDb.query(
      "select public.lukas_drawing_create_document($1,null,'Legacy table',true) result",
      [PROJECT],
    );
    await upgradeDb.exec("reset role");
    const duplicateId = randomUUID();
    await upgradeDb.query(
      `insert into public.lukas_drawing_tables(
        id,revision_id,project_id,name,columns_json,rows_json,version,created_by
      ) values($1,$2,$3,'Legacy duplicates',$4,'[]'::jsonb,1,$5)`,
      [
        randomUUID(),
        created.rows[0].result.revisionId,
        PROJECT,
        [
          { id: duplicateId, name: "A", kind: "text", propertySchemaId: null },
          {
            id: duplicateId,
            name: "B",
            kind: "number",
            propertySchemaId: null,
          },
        ],
        OWNER,
      ],
    );
    await assert.rejects(
      upgradeDb.exec(await task9ContractFixesMigration()),
      (error) =>
        error.code === "P1C01" &&
        /duplicate.*before upgrade/i.test(error.message),
    );
  } finally {
    await upgradeDb.close();
  }
});

test("runtime migration rejects malformed domain and inverse JSON", async (t) => {
  await t.test("missing and untrimmed object names", async () => {
    const ids = await createDocument();
    const missing = circleObject(randomUUID(), ids.workLayerId);
    delete missing.name;
    await assert.rejects(
      addObject(ids, missing),
      /Drawing operation domain JSON is invalid/,
    );
    await assert.rejects(
      addObject(
        ids,
        circleObject(randomUUID(), ids.workLayerId, { name: " Circle " }),
      ),
      /Drawing operation domain JSON is invalid/,
    );
  });

  await t.test("geometry with a missing mandatory key", async () => {
    const ids = await createDocument();
    const object = circleObject(randomUUID(), ids.workLayerId, {
      geometry: { type: "circle", radius: 5 },
    });
    await assert.rejects(
      addObject(ids, object),
      /Drawing operation domain JSON is invalid/,
    );
  });

  await t.test("empty style", async () => {
    const ids = await createDocument();
    const object = circleObject(randomUUID(), ids.workLayerId, { style: {} });
    await assert.rejects(
      addObject(ids, object),
      /Drawing operation domain JSON is invalid/,
    );
  });

  await t.test("Konva-shaped and mismatched inverse payloads", async () => {
    const ids = await createDocument();
    const object = circleObject(randomUUID(), ids.workLayerId);
    await assert.rejects(
      applyOperation(
        ids.revisionId,
        "add_objects",
        {},
        { type: "add_objects", objects: [object] },
        { type: "delete_objects", attrs: { id: object.id } },
      ),
      /inverse payload is invalid/i,
    );
    await assert.rejects(
      applyOperation(
        ids.revisionId,
        "add_objects",
        {},
        { type: "add_objects", objects: [object] },
        {
          type: "update_layer",
          layerId: ids.workLayerId,
          patch: { visible: false },
        },
      ),
      /inverse payload is invalid/i,
    );
  });
});

test("runtime migration rejects incomplete PDF evidence", async () => {
  const ids = await createDocument();
  const object = circleObject(randomUUID(), ids.workLayerId);
  await addObject(ids, object);
  await db.exec("reset role");
  await db.query(
    "select set_config('private.lukas_drawing_source_operation',$1,false)",
    [ids.revisionId],
  );
  await assert.rejects(
    db.query(
      `insert into public.lukas_drawing_object_sources(
        object_id,revision_id,project_id,source_file_id,source_sha256,
        source_kind,created_by
      ) values ($1,$2,$3,$4,$5,'pdf_region',$6)`,
      [object.id, ids.revisionId, PROJECT, PDF, PDF_SHA, OWNER],
    ),
    /check constraint/i,
  );
});

test("runtime add_objects rejects an existing soft-deleted ID", async () => {
  const ids = await createDocument();
  const object = circleObject(randomUUID(), ids.workLayerId);
  await addObject(ids, object);
  await applyOperation(
    ids.revisionId,
    "delete_objects",
    { [object.id]: 1 },
    { type: "delete_objects", objectIds: [object.id] },
    { type: "add_objects", objects: [{ ...object, version: 3 }] },
  );
  await assert.rejects(
    addObject(ids, object),
    /Drawing object (already exists|restore version conflict)/,
  );
});

test("runtime delete inverse is exactly replayable through add_objects", async () => {
  const ids = await createDocument();
  const object = circleObject(randomUUID(), ids.workLayerId);
  const restore = { ...object, version: 3 };
  await addObject(ids, object);
  await applyOperation(
    ids.revisionId,
    "delete_objects",
    { [object.id]: 1 },
    { type: "delete_objects", objectIds: [object.id] },
    { type: "add_objects", objects: [restore] },
  );
  const deleted = await db.query(
    "select status,version from public.lukas_drawing_objects where id=$1",
    [object.id],
  );
  assert.deepEqual(deleted.rows[0], { status: "deleted", version: 2 });

  await applyOperation(
    ids.revisionId,
    "add_objects",
    { [object.id]: 2 },
    { type: "add_objects", objects: [restore] },
    { type: "delete_objects", objectIds: [object.id] },
  );
  const restored = await db.query(
    `select status,version,layer_id "layerId",name,geometry,style
     from public.lukas_drawing_objects where id=$1`,
    [object.id],
  );
  assert.deepEqual(restored.rows[0], {
    status: "active",
    version: 3,
    layerId: ids.workLayerId,
    name: "Circle",
    geometry: object.geometry,
    style: object.style,
  });
});

test("runtime object rename and snapshot preserve the canonical name", async () => {
  const ids = await createDocument();
  const object = circleObject(randomUUID(), ids.workLayerId);
  await addObject(ids, object);
  await applyOperation(
    ids.revisionId,
    "update_objects",
    { [object.id]: 1 },
    {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: "Door circle" } }],
    },
    {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: "Circle" } }],
    },
  );
  const renamed = await db.query(
    "select name,version from public.lukas_drawing_objects where id=$1",
    [object.id],
  );
  assert.deepEqual(renamed.rows[0], { name: "Door circle", version: 2 });
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await db.exec("reset role");
  const snapshot = await db.query(
    "select canonical_json from public.lukas_drawing_snapshots where id=$1",
    [review.rows[0].result.snapshotId],
  );
  assert.equal(snapshot.rows[0].canonical_json.objects[0].name, "Door circle");
});

test("runtime layers enforce trimmed uniqueness, source immutability, and an editable fallback", async () => {
  const ids = await createDocument();
  const customId = randomUUID();
  await applyOperation(
    ids.revisionId,
    "add_layer",
    {},
    {
      type: "add_layer",
      layer: {
        id: customId,
        name: " Details ",
        visible: true,
        locked: false,
        version: 1,
      },
    },
    {},
  );
  const stored = await db.query(
    "select name,system_kind from public.lukas_drawing_layers where id=$1",
    [customId],
  );
  assert.deepEqual(stored.rows[0], { name: "Details", system_kind: "custom" });
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "add_layer",
      {},
      {
        type: "add_layer",
        layer: {
          id: randomUUID(),
          name: "Details",
          visible: true,
          locked: false,
          version: 1,
        },
      },
      {},
    ),
    /unique|duplicate/i,
  );
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "update_layer",
      { [ids.sourceLayerId]: 1 },
      {
        type: "update_layer",
        layerId: ids.sourceLayerId,
        patch: { visible: false },
      },
      {
        type: "update_layer",
        layerId: ids.sourceLayerId,
        patch: { visible: true },
      },
    ),
    /Source drawing layer is immutable/,
  );
  await applyOperation(
    ids.revisionId,
    "update_layer",
    { [ids.workLayerId]: 1 },
    {
      type: "update_layer",
      layerId: ids.workLayerId,
      patch: { locked: true },
    },
    {
      type: "update_layer",
      layerId: ids.workLayerId,
      patch: { locked: false },
    },
  );
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "update_layer",
      { [customId]: 1 },
      {
        type: "update_layer",
        layerId: customId,
        patch: { visible: false },
      },
      {
        type: "update_layer",
        layerId: customId,
        patch: { visible: true },
      },
    ),
    /visible unlocked user drawing layer/i,
  );
});

test("authenticated direct layer SQL cannot bypass canonical layer integrity", async (t) => {
  const directLayer = async (ids, overrides = {}) => {
    const id = randomUUID();
    await db.query(
      `insert into public.lukas_drawing_layers(
        id,page_id,revision_id,project_id,name,sort_order,
        visible,locked,system_kind,version,created_by
      ) values ($1,$2,$3,$4,$5,10,$6,$7,$8,1,$9)`,
      [
        id,
        ids.pageId,
        ids.revisionId,
        PROJECT,
        overrides.name ?? "Direct custom",
        overrides.visible ?? true,
        overrides.locked ?? false,
        overrides.systemKind ?? "custom",
        OWNER,
      ],
    );
    return id;
  };

  await t.test(
    "authenticated inserts are revoked for every layer kind",
    async () => {
      const ids = await createDocument();
      for (const systemKind of ["custom", "source", "work"]) {
        await assert.rejects(
          directLayer(ids, {
            name: `Manufactured ${systemKind}`,
            systemKind,
            locked: systemKind === "source",
          }),
          /permission denied/i,
        );
      }
    },
  );

  await t.test(
    "authenticated updates cannot change custom or source layers",
    async () => {
      const ids = await createDocument();
      await assert.rejects(
        db.query(
          `update public.lukas_drawing_layers
         set name='Renamed work',version=version+1 where id=$1`,
          [ids.workLayerId],
        ),
        /permission denied/i,
      );
      await assert.rejects(
        db.query(
          `update public.lukas_drawing_layers
         set name='Renamed source',version=version+1 where id=$1`,
          [ids.sourceLayerId],
        ),
        /permission denied/i,
      );
    },
  );

  await t.test(
    "trusted updates preserve a visible unlocked user layer",
    async () => {
      const ids = await createDocument();
      const customId = await addCustomLayer(ids, "Trusted custom");
      await db.exec("reset role");
      await db.query(
        `update public.lukas_drawing_layers
       set locked=true,version=version+1 where id=$1`,
        [ids.workLayerId],
      );
      await assert.rejects(
        db.query(
          `update public.lukas_drawing_layers
         set visible=false,version=version+1 where id=$1`,
          [customId],
        ),
        /visible unlocked user drawing layer/i,
      );
    },
  );

  await t.test(
    "authenticated delete is revoked and has no policy path",
    async () => {
      const ids = await createDocument();
      await assert.rejects(
        db.query("delete from public.lukas_drawing_layers where id=$1", [
          ids.workLayerId,
        ]),
        /permission denied/i,
      );
      const privilege = await db.query(
        `select has_table_privilege('authenticated',
        'public.lukas_drawing_layers','DELETE') allowed`,
      );
      assert.equal(privilege.rows[0].allowed, false);
    },
  );

  await t.test(
    "trusted direct deletes still cannot break layer invariants",
    async () => {
      const ids = await createDocument();
      await db.exec("reset role");
      await assert.rejects(
        db.query("delete from public.lukas_drawing_layers where id=$1", [
          ids.sourceLayerId,
        ]),
        /Source drawing layer is immutable/i,
      );
      await assert.rejects(
        db.query("delete from public.lukas_drawing_layers where id=$1", [
          ids.workLayerId,
        ]),
        /visible unlocked user drawing layer/i,
      );
    },
  );
});

async function addCustomLayer(ids, name) {
  const layerId = randomUUID();
  await applyOperation(
    ids.revisionId,
    "add_layer",
    { [layerId]: 1 },
    {
      type: "add_layer",
      layer: {
        id: layerId,
        name,
        visible: true,
        locked: false,
        version: 1,
      },
    },
    {},
  );
  return layerId;
}

test("authorized draft parent deletion cascades through system and custom layers", async (t) => {
  await t.test("page deletion", async () => {
    const ids = await createDocument();
    await addCustomLayer(ids, "Page cascade custom");
    await db.exec("reset role");
    await db.query("delete from public.lukas_drawing_pages where id=$1", [
      ids.pageId,
    ]);

    const remaining = await db.query(
      `select
        (select count(*)::int from public.lukas_drawing_pages where id=$1) pages,
        (select count(*)::int from public.lukas_drawing_layers
          where revision_id=$2) layers`,
      [ids.pageId, ids.revisionId],
    );
    assert.deepEqual(remaining.rows[0], { pages: 0, layers: 0 });
  });

  await t.test("document deletion", async () => {
    const ids = await createDocument();
    await addCustomLayer(ids, "Document cascade custom");

    await db.query("delete from public.lukas_drawing_documents where id=$1", [
      ids.documentId,
    ]);

    const remaining = await db.query(
      `select
        (select count(*)::int from public.lukas_drawing_documents where id=$1) documents,
        (select count(*)::int from public.lukas_drawing_revisions where id=$2) revisions,
        (select count(*)::int from public.lukas_drawing_pages where revision_id=$2) pages,
        (select count(*)::int from public.lukas_drawing_layers where revision_id=$2) layers`,
      [ids.documentId, ids.revisionId],
    );
    assert.deepEqual(remaining.rows[0], {
      documents: 0,
      revisions: 0,
      pages: 0,
      layers: 0,
    });
  });
});

test("approved parent deletion remains denied", async () => {
  const ids = await createDocument();
  await addCustomLayer(ids, "Approved custom");
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'approved','cascade denial fixture'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  await db.exec("reset role");
  await assert.rejects(
    db.query("delete from public.lukas_drawing_pages where id=$1", [
      ids.pageId,
    ]),
    /immutable/i,
  );
  await assert.rejects(
    db.query("delete from public.lukas_drawing_documents where id=$1", [
      ids.documentId,
    ]),
    /immutable/i,
  );

  const remaining = await db.query(
    `select
      (select count(*)::int from public.lukas_drawing_documents where id=$1) documents,
      (select count(*)::int from public.lukas_drawing_pages where id=$2) pages,
      (select count(*)::int from public.lukas_drawing_layers
        where revision_id=$3) layers`,
    [ids.documentId, ids.pageId, ids.revisionId],
  );
  assert.deepEqual(remaining.rows[0], { documents: 1, pages: 1, layers: 3 });
});

function operationInput(recorded) {
  return {
    clientOperationId: recorded.clientOperationId,
    revisionId: recorded.revisionId,
    type: recorded.type,
    baseVersions: recorded.baseVersions,
    forward: recorded.forward,
    inverse: recorded.inverse,
    createdAt: recorded.createdAt,
  };
}

function pgliteWorkspaceClient(database) {
  return {
    async rpc(name, args) {
      assert.equal(name, "lukas_drawing_apply_operation");
      try {
        const result = await database.query(
          `select public.lukas_drawing_apply_operation($1,$2,$3,$4,$5,$6) result`,
          [
            args.p_revision_id,
            args.p_client_operation_id,
            args.p_operation_type,
            args.p_base_versions,
            args.p_forward,
            args.p_inverse,
          ],
        );
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        return { data: null, error: { message: error.message } };
      }
    },
  };
}

test("generated undo and redo operations parse on the server and replay through the RPC", async () => {
  const ids = await createDocument();
  const object = circleObject(randomUUID(), ids.workLayerId);
  const env = {
    createId: () => randomUUID(),
    now: () => "2026-08-24T00:00:00.000Z",
  };
  let local = drawingCommands.createDrawingDocumentState({
    revisionId: ids.revisionId,
    layers: [
      {
        id: ids.workLayerId,
        name: "Work",
        visible: true,
        locked: false,
        systemKind: "work",
        version: 1,
      },
    ],
  });
  const client = pgliteWorkspaceClient(db);

  const added = drawingCommands.applyDrawingCommand(
    local,
    { type: "add_objects", actorId: OWNER, objects: [object] },
    env,
  );
  await workspaceServer.applyDrawingOperation(
    client,
    operationInput(added.operation),
  );
  local = added.state;

  const undoneAdd = drawingCommands.undoDrawingCommand(local, OWNER, env);
  await workspaceServer.applyDrawingOperation(
    client,
    operationInput(undoneAdd.operation),
  );
  local = undoneAdd.state;
  let stored = await db.query(
    "select status,version from public.lukas_drawing_objects where id=$1",
    [object.id],
  );
  assert.deepEqual(stored.rows[0], { status: "deleted", version: 2 });

  const redoneAdd = drawingCommands.redoDrawingCommand(local, OWNER, env);
  await workspaceServer.applyDrawingOperation(
    client,
    operationInput(redoneAdd.operation),
  );
  local = redoneAdd.state;
  stored = await db.query(
    "select status,version from public.lukas_drawing_objects where id=$1",
    [object.id],
  );
  assert.deepEqual(stored.rows[0], { status: "active", version: 3 });

  const deleted = drawingCommands.applyDrawingCommand(
    local,
    { type: "delete_objects", actorId: OWNER, objectIds: [object.id] },
    env,
  );
  await workspaceServer.applyDrawingOperation(
    client,
    operationInput(deleted.operation),
  );
  local = deleted.state;
  const restored = drawingCommands.undoDrawingCommand(local, OWNER, env);
  await workspaceServer.applyDrawingOperation(
    client,
    operationInput(restored.operation),
  );
  local = restored.state;
  const deletedAgain = drawingCommands.redoDrawingCommand(local, OWNER, env);
  await workspaceServer.applyDrawingOperation(
    client,
    operationInput(deletedAgain.operation),
  );
  stored = await db.query(
    "select status,version from public.lukas_drawing_objects where id=$1",
    [object.id],
  );
  assert.deepEqual(stored.rows[0], { status: "deleted", version: 6 });
  const restoredAgain = drawingCommands.undoDrawingCommand(
    deletedAgain.state,
    OWNER,
    env,
  );
  await workspaceServer.applyDrawingOperation(
    client,
    operationInput(restoredAgain.operation),
  );
  stored = await db.query(
    "select status,version from public.lukas_drawing_objects where id=$1",
    [object.id],
  );
  assert.deepEqual(stored.rows[0], { status: "active", version: 7 });
});

test("style-aware delete and restore stay exact and monotonic on a hidden unlocked layer", async () => {
  const ids = await createDocument();
  const fallbackLayerId = await addCustomLayer(ids, "Visible fallback");
  const styleId = randomUUID();
  const objectId = randomUUID();
  const style = {
    id: styleId,
    revisionId: ids.revisionId,
    name: "Referenced delete style",
    value: STYLE,
    version: 1,
  };
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [{ kind: "put_style", entity: style, baseVersion: null }],
    },
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_style", id: styleId, baseVersion: 1 }],
    },
  );
  const env = {
    createId: () => randomUUID(),
    now: () => "2026-08-25T00:00:00.000Z",
  };
  const object = circleObject(objectId, ids.workLayerId, {
    styleId,
    style: { fill: "#abcdef" },
  });
  let local = drawingCommands.createDrawingDocumentState({
    revisionId: ids.revisionId,
    structure: {
      pages: {
        [ids.pageId]: {
          id: ids.pageId,
          revisionId: ids.revisionId,
          name: "A1",
          sortOrder: 0,
          version: 1,
        },
      },
      canvases: {
        [ids.canvasId]: {
          id: ids.canvasId,
          pageId: ids.pageId,
          name: "Paper",
          spaceKind: "paper",
          widthMillimeters: 210,
          heightMillimeters: 297,
          background: null,
          sortOrder: 0,
          version: 1,
        },
      },
      layers: {
        [ids.workLayerId]: {
          id: ids.workLayerId,
          name: "Work",
          visible: true,
          locked: false,
          systemKind: "work",
          canvasId: ids.canvasId,
          sortOrder: 1,
          version: 1,
        },
        [fallbackLayerId]: {
          id: fallbackLayerId,
          name: "Visible fallback",
          visible: true,
          locked: false,
          systemKind: "custom",
          canvasId: ids.canvasId,
          sortOrder: 2,
          version: 1,
        },
      },
      objects: {},
      styles: { [styleId]: style },
      blocks: {},
      blockInstances: {},
      propertySchemas: {},
      propertyValues: {},
      tables: {},
    },
  });
  const client = pgliteWorkspaceClient(db);
  const added = drawingCommands.applyDrawingCommand(
    local,
    { type: "add_objects", actorId: OWNER, objects: [object] },
    env,
  );
  await workspaceServer.applyDrawingOperation(
    client,
    operationInput(added.operation),
  );
  local = added.state;
  await applyOperation(
    ids.revisionId,
    "update_layer",
    { [ids.workLayerId]: 1 },
    {
      type: "update_layer",
      layerId: ids.workLayerId,
      patch: { visible: false },
    },
    {
      type: "update_layer",
      layerId: ids.workLayerId,
      patch: { visible: true },
    },
  );
  local = {
    ...local,
    layers: {
      ...local.layers,
      [ids.workLayerId]: {
        ...local.layers[ids.workLayerId],
        visible: false,
        version: 2,
      },
    },
    structure: {
      ...local.structure,
      layers: {
        ...local.structure.layers,
        [ids.workLayerId]: {
          ...local.structure.layers[ids.workLayerId],
          visible: false,
          version: 2,
        },
      },
    },
  };
  const deleted = drawingCommands.applyDrawingCommand(
    local,
    { type: "delete_objects", actorId: OWNER, objectIds: [objectId] },
    env,
  );
  await workspaceServer.applyDrawingOperation(
    client,
    operationInput(deleted.operation),
  );
  assert.deepEqual(deleted.operation.baseVersions, { [objectId]: 1 });
  assert.deepEqual(deleted.operation.inverse.objects[0], {
    ...object,
    version: 3,
  });
  const restored = drawingCommands.undoDrawingCommand(
    deleted.state,
    OWNER,
    env,
  );
  await workspaceServer.applyDrawingOperation(
    client,
    operationInput(restored.operation),
  );
  await db.exec("reset role");
  const stored = await db.query(
    `select status,version,style_id "styleId",style
     from public.lukas_drawing_objects where id=$1`,
    [objectId],
  );
  assert.deepEqual(stored.rows[0], {
    status: "active",
    version: 3,
    styleId,
    style: { fill: "#abcdef" },
  });

  const lockedDelete = drawingCommands.applyDrawingCommand(
    restored.state,
    { type: "delete_objects", actorId: OWNER, objectIds: [objectId] },
    env,
  );
  await asActor(OWNER);
  await applyOperation(
    ids.revisionId,
    "update_layer",
    { [ids.workLayerId]: 2 },
    { type: "update_layer", layerId: ids.workLayerId, patch: { locked: true } },
    {
      type: "update_layer",
      layerId: ids.workLayerId,
      patch: { locked: false },
    },
  );
  await assert.rejects(
    workspaceServer.applyDrawingOperation(
      client,
      operationInput(lockedDelete.operation),
    ),
    (error) =>
      error.kind === "rpc" &&
      /layer target is unavailable/i.test(error.message),
  );
  await db.exec("reset role");
  const lockedUnchanged = await db.query(
    "select status,version from public.lukas_drawing_objects where id=$1",
    [objectId],
  );
  assert.deepEqual(lockedUnchanged.rows, [{ status: "active", version: 3 }]);
});

test("style helpers persist through command history, outbox, RPC, undo, and redo", async () => {
  const ids = await createDocument();
  let local = await localP2State(ids);
  const outbox = drawingOutbox.createDrawingOutbox(runtimeOutboxAdapter(), {
    ownerId: OWNER,
    revisionId: ids.revisionId,
    schedule: () => () => {},
  });
  const client = pgliteWorkspaceClient(db);
  const persist = async (recorded) => {
    await outbox.enqueue(operationInput(recorded));
    await outbox.flush(async (operation) => {
      await workspaceServer.applyDrawingOperation(client, operation);
      return {
        clientOperationId: operation.clientOperationId,
        status: "acked",
      };
    });
  };
  const apply = async (command) => {
    const recorded = drawingCommands.applyDrawingCommand(local, command);
    await persist(recorded.operation);
    local = recorded.state;
    return recorded;
  };
  const styleId = randomUUID();
  await apply(
    drawingCommands.createDrawingStyleCommand(
      local,
      OWNER,
      "Lifecycle",
      STYLE,
      () => styleId,
    ),
  );
  await apply(
    drawingCommands.updateDrawingStyleCommand(local, OWNER, styleId, {
      value: { stroke: "#445566", strokeWidth: 3, fill: null },
    }),
  );
  const objectId = randomUUID();
  await apply({
    type: "add_objects",
    actorId: OWNER,
    objects: [circleObject(objectId, ids.workLayerId)],
  });
  await apply(
    drawingCommands.applyDrawingStyleSelection(
      local,
      [objectId],
      OWNER,
      styleId,
    ),
  );
  await apply(
    drawingCommands.resetDrawingStyleOverrides(local, [objectId], OWNER),
  );
  await apply(
    drawingCommands.detachDrawingStyleSelection(local, [objectId], OWNER),
  );
  const deleted = await apply(
    drawingCommands.deleteDrawingStyleCommand(local, OWNER, styleId),
  );
  const undone = drawingCommands.undoDrawingCommand(local, OWNER);
  assert.ok(undone && !("kind" in undone));
  await persist(undone.operation);
  local = undone.state;
  const redone = drawingCommands.redoDrawingCommand(local, OWNER);
  assert.ok(redone && !("kind" in redone));
  await persist(redone.operation);
  const stored = await db.query(
    'select style_id "styleId",style,version from public.lukas_drawing_objects where id=$1',
    [objectId],
  );
  assert.deepEqual(stored.rows[0], {
    styleId: null,
    style: { stroke: "#445566", strokeWidth: 3, fill: null },
    version: 4,
  });
  assert.equal(deleted.operation.type, "mutate_structure");
  await db.exec("reset role");
  const styles = await db.query(
    "select count(*)::int count from public.lukas_drawing_styles where id=$1",
    [styleId],
  );
  assert.equal(styles.rows[0].count, 0);
  outbox.dispose();
});

test("block helper persists atomic selection conversion through outbox, RPC, undo, and redo", async () => {
  const ids = await createDocument();
  let local = await localP2State(ids);
  const outbox = drawingOutbox.createDrawingOutbox(runtimeOutboxAdapter(), {
    ownerId: OWNER,
    revisionId: ids.revisionId,
    schedule: () => () => {},
  });
  const client = pgliteWorkspaceClient(db);
  const persist = async (recorded) => {
    await outbox.enqueue(operationInput(recorded));
    await outbox.flush(async (operation) => {
      await workspaceServer.applyDrawingOperation(client, operation);
      return {
        clientOperationId: operation.clientOperationId,
        status: "acked",
      };
    });
  };
  const apply = async (command) => {
    const applied = drawingCommands.applyDrawingCommand(local, command);
    await persist(applied.operation);
    local = applied.state;
    return applied;
  };
  const firstId = randomUUID();
  const secondId = randomUUID();
  await apply({
    type: "add_objects",
    actorId: OWNER,
    objects: [
      { ...circleObject(firstId, ids.workLayerId), styleId: null },
      {
        id: secondId,
        name: "Cable",
        layerId: ids.workLayerId,
        geometry: {
          type: "line",
          start: { x: 20, y: 20 },
          end: { x: 30, y: 25 },
        },
        styleId: null,
        style: STYLE,
        version: 1,
      },
    ],
  });
  const schemaId = randomUUID();
  const valueId = randomUUID();
  const tableId = randomUUID();
  const columnId = randomUUID();
  const rowId = randomUUID();
  const schema = {
    id: schemaId,
    revisionId: ids.revisionId,
    name: "Mark",
    valueType: "text",
    enumOptions: [],
    appliesTo: ["circle"],
    required: false,
    version: 1,
  };
  const value = {
    id: valueId,
    schemaId,
    objectId: firstId,
    blockInstanceId: null,
    value: "C-01",
    version: 1,
  };
  const table = {
    id: tableId,
    revisionId: ids.revisionId,
    name: "Objects",
    columns: [
      {
        id: columnId,
        name: "Name",
        kind: "object_name",
        propertySchemaId: null,
      },
    ],
    rows: [{ id: rowId, objectId: firstId, blockInstanceId: null, cells: {} }],
    version: 1,
  };
  await apply({
    type: "mutate_structure",
    actorId: OWNER,
    actions: [
      { kind: "put_property_schema", entity: schema, baseVersion: null },
      { kind: "put_property_value", entity: value, baseVersion: null },
      { kind: "put_table", entity: table, baseVersion: null },
    ],
  });
  const blockId = randomUUID();
  const instanceId = randomUUID();
  const generated = [blockId, instanceId, "circle", "line"];
  const created = await apply(
    drawingBlocks.createBlockFromSelection(
      local,
      [secondId, firstId],
      OWNER,
      "RPC symbol",
      { activeLayerId: ids.workLayerId, createId: () => generated.shift() },
    ),
  );
  assert.equal(created.operation.type, "mutate_structure");
  let rows = await db.query(
    `select
      (select count(*)::int from public.lukas_drawing_objects where id in ($1,$2) and status='active') objects,
      (select count(*)::int from public.lukas_drawing_blocks where id=$3) blocks,
      (select count(*)::int from public.lukas_drawing_block_instances where id=$4) instances,
      (select count(*)::int from public.lukas_drawing_property_values where id=$5) property_values,
      (select pg_catalog.jsonb_array_length(rows_json) from public.lukas_drawing_tables where id=$6) table_rows`,
    [firstId, secondId, blockId, instanceId, valueId, tableId],
  );
  assert.deepEqual(rows.rows[0], {
    objects: 0,
    blocks: 1,
    instances: 1,
    property_values: 0,
    table_rows: 0,
  });

  const undone = drawingCommands.undoDrawingCommand(local, OWNER);
  assert.ok(undone && !("kind" in undone));
  const wrongUndoInverse = structuredClone(undone.operation.inverse);
  const wrongCleanup = wrongUndoInverse.actions.find(
    (action) => action.kind === "delete_property_value",
  );
  wrongCleanup.baseVersion = 999;
  await db.exec("begin");
  try {
    await assert.rejects(
      workspaceServer.applyDrawingOperation(client, {
        ...operationInput(undone.operation),
        inverse: wrongUndoInverse,
      }),
      (error) => error.kind === "rpc" && /inverse|cleanup/i.test(error.message),
    );
  } finally {
    await db.exec("rollback");
  }
  await persist(undone.operation);
  local = undone.state;
  rows = await db.query(
    `select
      (select count(*)::int from public.lukas_drawing_objects where id in ($1,$2) and status='active') objects,
      (select count(*)::int from public.lukas_drawing_blocks where id=$3) blocks,
      (select count(*)::int from public.lukas_drawing_block_instances where id=$4) instances,
      (select count(*)::int from public.lukas_drawing_property_values where id=$5) property_values,
      (select pg_catalog.jsonb_array_length(rows_json) from public.lukas_drawing_tables where id=$6) table_rows`,
    [firstId, secondId, blockId, instanceId, valueId, tableId],
  );
  assert.deepEqual(rows.rows[0], {
    objects: 2,
    blocks: 0,
    instances: 0,
    property_values: 1,
    table_rows: 1,
  });

  const redone = drawingCommands.redoDrawingCommand(local, OWNER);
  assert.ok(redone && !("kind" in redone));
  await persist(redone.operation);
  rows = await db.query(
    `select
      (select count(*)::int from public.lukas_drawing_objects where id in ($1,$2) and status='active') objects,
      (select count(*)::int from public.lukas_drawing_blocks where id=$3) blocks,
      (select count(*)::int from public.lukas_drawing_block_instances where id=$4) instances,
      (select count(*)::int from public.lukas_drawing_property_values where id=$5) property_values,
      (select pg_catalog.jsonb_array_length(rows_json) from public.lukas_drawing_tables where id=$6) table_rows`,
    [firstId, secondId, blockId, instanceId, valueId, tableId],
  );
  assert.deepEqual(rows.rows[0], {
    objects: 0,
    blocks: 1,
    instances: 1,
    property_values: 0,
    table_rows: 0,
  });
  outbox.dispose();
});

test("strict structure mutation denies deleting a style referenced only by a block primitive", async () => {
  const ids = await createDocument();
  const styleId = randomUUID();
  const blockId = randomUUID();
  const style = {
    id: styleId,
    revisionId: ids.revisionId,
    name: "Block-only style",
    value: STYLE,
    version: 1,
  };
  const block = {
    id: blockId,
    revisionId: ids.revisionId,
    name: "Block-only reference",
    primitives: [
      {
        localId: "circle",
        name: "Circle",
        geometry: circleObject(randomUUID(), ids.workLayerId).geometry,
        styleId,
        style: {},
      },
    ],
    version: 1,
  };
  const createForward = {
    type: "mutate_structure",
    actions: [
      { kind: "put_style", entity: style, baseVersion: null },
      { kind: "put_block", entity: block, baseVersion: null },
    ],
  };
  const client = pgliteWorkspaceClient(db);
  const outbox = drawingOutbox.createDrawingOutbox(runtimeOutboxAdapter(), {
    ownerId: OWNER,
    revisionId: ids.revisionId,
    schedule: () => () => {},
  });
  const operation = (baseVersions, forward, inverse) => ({
    clientOperationId: randomUUID(),
    revisionId: ids.revisionId,
    type: "mutate_structure",
    baseVersions,
    forward,
    inverse,
    createdAt: "2026-08-25T00:00:00.000Z",
  });
  const persist = async (input) => {
    let result;
    await outbox.enqueue(input);
    await outbox.flush(async (queued) => {
      result = await workspaceServer.applyDrawingOperation(client, queued);
      return { clientOperationId: queued.clientOperationId, status: "acked" };
    });
    return result;
  };
  await persist(
    operation({}, createForward, {
      type: "mutate_structure",
      actions: [
        { kind: "delete_block", id: blockId, baseVersion: 1 },
        { kind: "delete_style", id: styleId, baseVersion: 1 },
      ],
    }),
  );

  await db.exec("reset role");
  const beforeCount = await db.query(
    "select count(*)::int count from public.lukas_drawing_operations where revision_id=$1",
    [ids.revisionId],
  );
  await asActor(OWNER);
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      { [styleId]: 1 },
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_style", id: styleId, baseVersion: 1 }],
      },
      {
        type: "mutate_structure",
        actions: [{ kind: "put_style", entity: style, baseVersion: null }],
      },
    ),
    (error) =>
      error.code === "P1C01" && /referenced drawing style/i.test(error.message),
  );
  await db.exec("reset role");
  const [storedStyle, storedBlock, afterCount] = await Promise.all([
    db.query("select version from public.lukas_drawing_styles where id=$1", [
      styleId,
    ]),
    db.query(
      "select version,primitives from public.lukas_drawing_blocks where id=$1",
      [blockId],
    ),
    db.query(
      "select count(*)::int count from public.lukas_drawing_operations where revision_id=$1",
      [ids.revisionId],
    ),
  ]);
  assert.deepEqual(storedStyle.rows, [{ version: 1 }]);
  assert.deepEqual(storedBlock.rows, [
    { version: 1, primitives: block.primitives },
  ]);
  assert.deepEqual(afterCount.rows, beforeCount.rows);

  await asActor(OWNER);
  const detachedBlock = {
    ...block,
    primitives: [{ ...block.primitives[0], styleId: null, style: STYLE }],
  };
  await persist(
    operation(
      { [blockId]: 1 },
      {
        type: "mutate_structure",
        actions: [{ kind: "put_block", entity: detachedBlock, baseVersion: 1 }],
      },
      {
        type: "mutate_structure",
        actions: [{ kind: "put_block", entity: block, baseVersion: 2 }],
      },
    ),
  );
  const deleted = await persist(
    operation(
      { [styleId]: 1 },
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_style", id: styleId, baseVersion: 1 }],
      },
      {
        type: "mutate_structure",
        actions: [{ kind: "put_style", entity: style, baseVersion: null }],
      },
    ),
  );
  assert.deepEqual(deleted.resultVersions, { [styleId]: null });
  await persist(
    operation(
      {},
      {
        type: "mutate_structure",
        actions: [{ kind: "put_style", entity: style, baseVersion: null }],
      },
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_style", id: styleId, baseVersion: 3 }],
      },
    ),
  );
  await db.exec("reset role");
  const restored = await db.query(
    "select version from public.lukas_drawing_styles where id=$1",
    [styleId],
  );
  assert.deepEqual(restored.rows, [{ version: 3 }]);
  outbox.dispose();
});

test("command-produced explicit add_layer uses its canonical creation base version", async () => {
  const ids = await createDocument();
  const layerId = randomUUID();
  const local = drawingCommands.createDrawingDocumentState({
    revisionId: ids.revisionId,
    layers: [
      {
        id: ids.workLayerId,
        name: "Work",
        visible: true,
        locked: false,
        systemKind: "work",
        canvasId: ids.canvasId,
        sortOrder: 1,
        version: 1,
      },
    ],
  });
  const added = drawingCommands.applyDrawingCommand(
    local,
    {
      type: "add_layer",
      actorId: OWNER,
      layer: {
        id: layerId,
        name: "Command layer",
        visible: true,
        locked: false,
        canvasId: ids.canvasId,
        sortOrder: 2,
        version: 1,
      },
    },
    { createId: () => randomUUID(), now: () => "2026-08-25T00:00:00.000Z" },
  );
  assert.deepEqual(added.operation.baseVersions, { [layerId]: 1 });
  assert.deepEqual(added.operation.inverse, {});
  const result = await workspaceServer.applyDrawingOperation(
    pgliteWorkspaceClient(db),
    operationInput(added.operation),
  );
  assert.deepEqual(result.resultVersions, { [layerId]: 1 });
});

test("additive upgrade backfills a pre-name approved state without rewriting evidence", async () => {
  const upgradeDb = new PGlite({ extensions: { pgcrypto } });
  try {
    await upgradeDb.exec(foundationSql);
    await upgradeDb.exec(await migration());
    await upgradeDb.query("insert into auth.users(id) values ($1),($2),($3)", [
      OWNER,
      REVIEWER,
      OUTSIDER,
    ]);
    await upgradeDb.query(
      "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
      [PROJECT, OWNER],
    );
    await upgradeDb.query(
      `insert into public.lukas_qto_project_members(project_id,user_id,role)
       values ($1,$2,'reviewer')`,
      [PROJECT, REVIEWER],
    );
    await upgradeDb.query(
      `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256)
       values ($1,$2,$3,'pdf',$4)`,
      [PDF, PROJECT, OWNER, PDF_SHA],
    );
    await upgradeDb.exec("set role authenticated");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    const created = await upgradeDb.query(
      "select public.lukas_drawing_create_document($1,$2,$3,true) result",
      [PROJECT, PDF, "Pre-name approved"],
    );
    const ids = created.rows[0].result;
    await upgradeDb.exec("reset role");
    await upgradeDb.exec(
      "alter table public.lukas_drawing_objects drop column name",
    );
    const objectId = randomUUID();
    const operationId = randomUUID();
    const snapshotSha = "b".repeat(64);
    const geometry = {
      type: "circle",
      center: { x: 10, y: 20 },
      radius: 5,
    };
    await upgradeDb.query(
      `insert into public.lukas_drawing_objects(
        id,lineage_id,page_id,layer_id,revision_id,project_id,
        object_type,geometry,style,status,version,created_by,updated_by
      ) values ($1,$1,$2,$3,$4,$5,'circle',$6,$7,'active',1,$8,$8)`,
      [
        objectId,
        ids.pageId,
        ids.workLayerId,
        ids.revisionId,
        PROJECT,
        geometry,
        STYLE,
        OWNER,
      ],
    );
    const oldForward = {
      type: "add_objects",
      objects: [
        {
          id: objectId,
          layerId: ids.workLayerId,
          geometry,
          style: STYLE,
          version: 1,
        },
      ],
    };
    const oldInverse = { type: "delete_objects", objectIds: [objectId] };
    await upgradeDb.query(
      `insert into public.lukas_drawing_operations(
        revision_id,project_id,sequence,client_operation_id,operation_type,
        base_versions,forward,inverse,result_versions,actor_id
      ) values ($1,$2,1,$3,'add_objects','{}',$4,$5,$6,$7)`,
      [
        ids.revisionId,
        PROJECT,
        operationId,
        oldForward,
        oldInverse,
        { [objectId]: 1 },
        OWNER,
      ],
    );
    const oldCanonical = {
      revisionId: ids.revisionId,
      objects: [
        {
          id: objectId,
          layerId: ids.workLayerId,
          type: "circle",
          geometry,
          style: STYLE,
          version: 1,
        },
      ],
    };
    await upgradeDb.query(
      `insert into public.lukas_drawing_snapshots(
        revision_id,project_id,revision_version,operation_sequence,
        canonical_json,sha256,created_by
      ) values ($1,$2,1,1,$3,$4,$5)`,
      [ids.revisionId, PROJECT, oldCanonical, snapshotSha, OWNER],
    );
    await upgradeDb.exec(
      "alter table public.lukas_drawing_revisions disable trigger user",
    );
    await upgradeDb.query(
      `update public.lukas_drawing_revisions
       set status='approved',review_requested_at=now(),approved_at=now()
       where id=$1`,
      [ids.revisionId],
    );
    await upgradeDb.exec(
      "alter table public.lukas_drawing_revisions enable trigger user",
    );
    await upgradeDb.exec(
      "alter table public.lukas_drawing_revision_approvals disable trigger user",
    );
    await upgradeDb.query(
      `insert into public.lukas_drawing_revision_approvals(
        revision_id,project_id,subject_version,snapshot_sha256,
        decision,note,decided_by
      ) values ($1,$2,1,$3,'approved','historical',$4)`,
      [ids.revisionId, PROJECT, snapshotSha, REVIEWER],
    );
    await upgradeDb.exec(
      "alter table public.lukas_drawing_revision_approvals enable trigger user",
    );
    const beforeEvidence = await upgradeDb.query(
      `select o.forward,o.inverse,o.result_versions "resultVersions",
        s.canonical_json "canonicalJson",s.sha256,
        a.snapshot_sha256 "approvalSha"
       from public.lukas_drawing_operations o
       join public.lukas_drawing_snapshots s on s.revision_id=o.revision_id
       join public.lukas_drawing_revision_approvals a
         on a.revision_id=o.revision_id
       where o.client_operation_id=$1`,
      [operationId],
    );
    const preNameColumn = await upgradeDb.query(
      `select count(*)::int count from information_schema.columns
       where table_schema='public' and table_name='lukas_drawing_objects'
         and column_name='name'`,
    );
    assert.equal(preNameColumn.rows[0].count, 0);

    await upgradeDb.exec(await upgradeMigration());

    const upgraded = await upgradeDb.query(
      "select name,status,version from public.lukas_drawing_objects where id=$1",
      [objectId],
    );
    assert.deepEqual(upgraded.rows[0], {
      name: "Circle",
      status: "active",
      version: 1,
    });
    const afterEvidence = await upgradeDb.query(
      `select o.forward,o.inverse,o.result_versions "resultVersions",
        s.canonical_json "canonicalJson",s.sha256,
        a.snapshot_sha256 "approvalSha"
       from public.lukas_drawing_operations o
       join public.lukas_drawing_snapshots s on s.revision_id=o.revision_id
       join public.lukas_drawing_revision_approvals a
         on a.revision_id=o.revision_id
       where o.client_operation_id=$1`,
      [operationId],
    );
    assert.deepEqual(afterEvidence.rows[0], beforeEvidence.rows[0]);
    await upgradeDb.exec("set role authenticated");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    const newDocument = await upgradeDb.query(
      "select public.lukas_drawing_create_document($1,$2,$3,true) result",
      [PROJECT, PDF, "Post-upgrade names"],
    );
    const newIds = newDocument.rows[0].result;
    const newObject = circleObject(randomUUID(), newIds.workLayerId, {
      name: "Post-upgrade circle",
    });
    await upgradeDb.query(
      `select public.lukas_drawing_apply_operation($1,$2,'add_objects',$3,$4,$5)`,
      [
        newIds.revisionId,
        randomUUID(),
        {},
        { type: "add_objects", objects: [newObject] },
        { type: "delete_objects", objectIds: [newObject.id] },
      ],
    );
    await upgradeDb.exec("reset role");
    await assert.rejects(
      upgradeDb.query(
        `update public.lukas_drawing_objects
         set name=' Circle ',version=version+1,updated_by=$2 where id=$1`,
        [newObject.id, OWNER],
      ),
      /check constraint/i,
    );
    await upgradeDb.exec("set role authenticated");
    const review = await upgradeDb.query(
      "select public.lukas_drawing_request_review($1) result",
      [newIds.revisionId],
    );
    await upgradeDb.exec("reset role");
    const newSnapshot = await upgradeDb.query(
      "select canonical_json from public.lukas_drawing_snapshots where id=$1",
      [review.rows[0].result.snapshotId],
    );
    assert.equal(
      newSnapshot.rows[0].canonical_json.objects[0].name,
      "Post-upgrade circle",
    );
  } finally {
    await upgradeDb.close();
  }
});

test("runtime delete rejects a non-replayable inverse version", async () => {
  const ids = await createDocument();
  const object = circleObject(randomUUID(), ids.workLayerId);
  await addObject(ids, object);
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "delete_objects",
      { [object.id]: 1 },
      { type: "delete_objects", objectIds: [object.id] },
      { type: "add_objects", objects: [{ ...object, version: 2 }] },
    ),
    /Drawing delete inverse is not replayable/,
  );
  const unchanged = await db.query(
    "select status,version from public.lukas_drawing_objects where id=$1",
    [object.id],
  );
  assert.deepEqual(unchanged.rows[0], { status: "active", version: 1 });
});

test("runtime operation retry is idempotent with a validated inverse", async () => {
  const ids = await createDocument();
  const object = circleObject(randomUUID(), ids.workLayerId);
  const clientOperationId = randomUUID();
  const parameters = [
    ids.revisionId,
    clientOperationId,
    "add_objects",
    {},
    { type: "add_objects", objects: [object] },
    { type: "delete_objects", objectIds: [object.id] },
  ];
  const first = await db.query(
    "select public.lukas_drawing_apply_operation($1,$2,$3,$4,$5,$6) result",
    parameters,
  );
  const retry = await db.query(
    "select public.lukas_drawing_apply_operation($1,$2,$3,$4,$5,$6) result",
    parameters,
  );
  assert.deepEqual(retry.rows[0].result, first.rows[0].result);
  const count = await db.query(
    `select count(*)::int count from public.lukas_drawing_operations
     where revision_id=$1 and client_operation_id=$2`,
    [ids.revisionId, clientOperationId],
  );
  assert.equal(count.rows[0].count, 1);
});

test("runtime review freeze rejects inserts into the locked revision", async () => {
  const ids = await createDocument();
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await db.exec("reset role");
  const hash = await db.query(
    `select s.sha256,
      encode(extensions.digest(convert_to(s.canonical_json::text,'UTF8'),'sha256'),'hex') recomputed
     from public.lukas_drawing_snapshots s where s.id=$1`,
    [review.rows[0].result.snapshotId],
  );
  assert.equal(hash.rows[0].sha256, hash.rows[0].recomputed);
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'approved','runtime fixture'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    OWNER,
  ]);
  await assert.rejects(
    db.query(
      `insert into public.lukas_drawing_pages(
        revision_id,project_id,name,page_number,width_mm,height_mm
      ) values ($1,$2,'late page',2,420,297)`,
      [ids.revisionId, PROJECT],
    ),
    /drawing revision is immutable/i,
  );
});

test("runtime privileged child and approval guards reject missing membership", async (t) => {
  await t.test(
    "child guard rejects unauthenticated and nonmember actors",
    async () => {
      const unauthenticatedIds = await createDocument();
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      await assert.rejects(
        db.query(
          `insert into public.lukas_drawing_pages(
          revision_id,project_id,name,page_number,width_mm,height_mm
        ) values ($1,$2,'unauthenticated late page',2,420,297)`,
          [unauthenticatedIds.revisionId, PROJECT],
        ),
        /Drawing workspace editor capability required/,
      );
      await assert.rejects(
        db.query(
          "update public.lukas_drawing_pages set name='unauthenticated edit' where id=$1",
          [unauthenticatedIds.pageId],
        ),
        /Drawing workspace editor capability required/,
      );

      const nonmemberIds = await createDocument();
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        OUTSIDER,
      ]);
      await assert.rejects(
        db.query(
          `insert into public.lukas_drawing_pages(
          revision_id,project_id,name,page_number,width_mm,height_mm
        ) values ($1,$2,'nonmember late page',2,420,297)`,
          [nonmemberIds.revisionId, PROJECT],
        ),
        /Drawing workspace editor capability required/,
      );
      await assert.rejects(
        db.query(
          "update public.lukas_drawing_pages set name='nonmember edit' where id=$1",
          [nonmemberIds.pageId],
        ),
        /Drawing workspace editor capability required/,
      );
    },
  );

  await t.test(
    "approval guard rejects unauthenticated and nonmember actors",
    async () => {
      const ids = await createDocument();
      const review = await db.query(
        "select public.lukas_drawing_request_review($1) result",
        [ids.revisionId],
      );
      const approval = [
        ids.revisionId,
        PROJECT,
        review.rows[0].result.subjectVersion,
        review.rows[0].result.snapshotSha256,
        OUTSIDER,
      ];
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      await assert.rejects(
        db.query(
          `insert into public.lukas_drawing_revision_approvals(
          revision_id,project_id,subject_version,snapshot_sha256,
          decision,note,decided_by
        ) values ($1,$2,$3,$4,'approved','unauthenticated',$5)`,
          approval,
        ),
        /Authenticated drawing reviewer required/,
      );

      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        OUTSIDER,
      ]);
      await assert.rejects(
        db.query(
          `insert into public.lukas_drawing_revision_approvals(
          revision_id,project_id,subject_version,snapshot_sha256,
          decision,note,decided_by
        ) values ($1,$2,$3,$4,'approved','nonmember',$5)`,
          approval,
        ),
        /Project role cannot approve drawing revisions/,
      );
    },
  );
});

test("runtime issue links are same-project, idempotent, append-only, and draft-only", async (t) => {
  const link = async (objectId, issueId) => {
    const result = await db.query(
      "select public.lukas_drawing_link_object_issue($1,$2) result",
      [objectId, issueId],
    );
    return result.rows[0].result;
  };
  const makeObjectAndIssue = async () => {
    const ids = await createDocument();
    const object = circleObject(randomUUID(), ids.workLayerId);
    await addObject(ids, object);
    const issueId = randomUUID();
    await db.exec("reset role");
    await db.query(
      "insert into public.lukas_drawing_issues(id,project_id) values ($1,$2)",
      [issueId, PROJECT],
    );
    await asActor(OWNER);
    return { ids, object, issueId };
  };

  await t.test("editor retry returns one authoritative link", async () => {
    const fixture = await makeObjectAndIssue();
    await asActor(EDITOR);
    const client = {
      async rpc(name, args) {
        assert.equal(name, "lukas_drawing_link_object_issue");
        try {
          const result = await db.query(
            "select public.lukas_drawing_link_object_issue($1,$2) result",
            [args.p_object_id, args.p_issue_id],
          );
          return { data: result.rows[0].result, error: null };
        } catch (error) {
          return { data: null, error: { message: error.message } };
        }
      },
    };
    const first = await workspaceServer.linkDrawingObjectIssue(
      client,
      fixture.object.id,
      fixture.issueId,
    );
    const retry = await link(fixture.object.id, fixture.issueId);
    assert.deepEqual(retry, first);
    const count = await db.query(
      `select count(*)::int count from public.lukas_drawing_object_issue_links
       where object_id=$1 and issue_id=$2`,
      [fixture.object.id, fixture.issueId],
    );
    assert.equal(count.rows[0].count, 1);
    await asActor(REVIEWER);
    const visible = await db.query(
      `select count(*)::int count from public.lukas_drawing_object_issue_links
       where object_id=$1`,
      [fixture.object.id],
    );
    assert.equal(visible.rows[0].count, 1);
    await asActor(OUTSIDER);
    const hidden = await db.query(
      `select count(*)::int count from public.lukas_drawing_object_issue_links
       where object_id=$1`,
      [fixture.object.id],
    );
    assert.equal(hidden.rows[0].count, 0);
  });

  await t.test("cross-project issue is rejected", async () => {
    const fixture = await makeObjectAndIssue();
    const otherProject = randomUUID();
    const otherIssue = randomUUID();
    await db.exec("reset role");
    await db.query(
      "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
      [otherProject, OUTSIDER],
    );
    await db.query(
      "insert into public.lukas_drawing_issues(id,project_id) values ($1,$2)",
      [otherIssue, otherProject],
    );
    await asActor(OWNER);
    await assert.rejects(
      link(fixture.object.id, otherIssue),
      /target is unavailable/i,
    );
  });

  await t.test("read-only project roles cannot link", async () => {
    const fixture = await makeObjectAndIssue();
    await asActor(REVIEWER);
    await assert.rejects(
      link(fixture.object.id, fixture.issueId),
      /target is unavailable/i,
    );
  });

  await t.test(
    "missing and foreign targets have one fail-closed response",
    async () => {
      const fixture = await makeObjectAndIssue();
      const otherProject = randomUUID();
      const otherFile = randomUUID();
      const otherIssue = randomUUID();
      await db.exec("reset role");
      await db.query(
        "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
        [otherProject, OUTSIDER],
      );
      await db.query(
        `insert into public.lukas_qto_files(
        id,project_id,uploaded_by,kind,sha256
      ) values ($1,$2,$3,'pdf',$4)`,
        [otherFile, otherProject, OUTSIDER, "c".repeat(64)],
      );
      await db.query(
        "insert into public.lukas_drawing_issues(id,project_id) values ($1,$2)",
        [otherIssue, otherProject],
      );
      await asActor(OUTSIDER);
      const other = await db.query(
        "select public.lukas_drawing_create_document($1,$2,$3,true) result",
        [otherProject, otherFile, "Foreign workspace"],
      );
      const foreignObject = circleObject(
        randomUUID(),
        other.rows[0].result.workLayerId,
      );
      await addObject(other.rows[0].result, foreignObject);
      await asActor(EDITOR);

      const unavailable = async (objectId, issueId) => {
        try {
          await link(objectId, issueId);
          assert.fail("expected unavailable target");
        } catch (error) {
          return { code: error.code, message: error.message };
        }
      };
      const messages = [];
      for (const [objectId, issueId] of [
        [randomUUID(), fixture.issueId],
        [foreignObject.id, fixture.issueId],
        [fixture.object.id, randomUUID()],
        [fixture.object.id, otherIssue],
      ])
        messages.push(await unavailable(objectId, issueId));
      assert.deepEqual(
        new Set(messages.map(({ code }) => code)),
        new Set(["P1R01"]),
      );
      assert.deepEqual(
        new Set(messages.map(({ message }) => message)),
        new Set(["Drawing issue link target is unavailable"]),
      );
    },
  );

  for (const status of ["review_requested", "approved"]) {
    await t.test(`${status} revision cannot be linked`, async () => {
      const fixture = await makeObjectAndIssue();
      const review = await db.query(
        "select public.lukas_drawing_request_review($1) result",
        [fixture.ids.revisionId],
      );
      if (status === "approved") {
        await asActor(REVIEWER);
        await db.query(
          `select public.lukas_drawing_record_revision_decision(
            $1,$2,$3,'approved','issue link freeze fixture'
          )`,
          [
            fixture.ids.revisionId,
            review.rows[0].result.subjectVersion,
            review.rows[0].result.snapshotSha256,
          ],
        );
        await asActor(OWNER);
      }
      await assert.rejects(
        link(fixture.object.id, fixture.issueId),
        /draft revision|required draft/i,
      );
    });
  }

  await t.test(
    "authenticated direct writes have no mutation grant",
    async () => {
      const fixture = await makeObjectAndIssue();
      await assert.rejects(
        db.query(
          `insert into public.lukas_drawing_object_issue_links(
          object_id,revision_id,issue_id,project_id,created_by
        ) values ($1,$2,$3,$4,$5)`,
          [
            fixture.object.id,
            fixture.ids.revisionId,
            fixture.issueId,
            PROJECT,
            OWNER,
          ],
        ),
        /permission denied/i,
      );
      for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
        const result = await db.query(
          `select has_table_privilege('authenticated',
          'public.lukas_drawing_object_issue_links',$1) allowed`,
          [privilege],
        );
        assert.equal(result.rows[0].allowed, false);
      }
    },
  );

  await t.test(
    "trusted direct insert still enforces the authenticated actor",
    async () => {
      const fixture = await makeObjectAndIssue();
      await db.exec("reset role");
      await assert.rejects(
        db.query(
          `insert into public.lukas_drawing_object_issue_links(
          object_id,revision_id,issue_id,project_id,created_by
        ) values ($1,$2,$3,$4,$5)`,
          [
            fixture.object.id,
            fixture.ids.revisionId,
            fixture.issueId,
            PROJECT,
            REVIEWER,
          ],
        ),
        /actor mismatch/i,
      );
    },
  );

  await t.test(
    "trusted direct updates and deletes remain append-only",
    async () => {
      const fixture = await makeObjectAndIssue();
      const linked = await link(fixture.object.id, fixture.issueId);
      await db.exec("reset role");
      await assert.rejects(
        db.query(
          "update public.lukas_drawing_object_issue_links set created_at=now() where id=$1",
          [linked.id],
        ),
        /append-only/i,
      );
      await assert.rejects(
        db.query(
          "delete from public.lukas_drawing_object_issue_links where id=$1",
          [linked.id],
        ),
        /append-only/i,
      );
    },
  );
});

test("authenticated editors mutate drawing objects only through the operation RPC", async () => {
  const ids = await createDocument();
  const directId = randomUUID();
  await asActor(EDITOR);
  await assert.rejects(
    db.query(
      `insert into public.lukas_drawing_objects(
        id,lineage_id,page_id,layer_id,revision_id,project_id,
        name,object_type,geometry,style,status,version,created_by,updated_by
      ) values ($1,$1,$2,$3,$4,$5,'Direct','circle',$6,$7,'active',1,$8,$8)`,
      [
        directId,
        ids.pageId,
        ids.workLayerId,
        ids.revisionId,
        PROJECT,
        circleObject(directId, ids.workLayerId).geometry,
        STYLE,
        EDITOR,
      ],
    ),
    /permission denied/i,
  );

  const object = circleObject(randomUUID(), ids.workLayerId);
  await addObject(ids, object);
  await assert.rejects(
    db.query(
      "update public.lukas_drawing_objects set name='Direct update' where id=$1",
      [object.id],
    ),
    /permission denied/i,
  );
  await assert.rejects(
    db.query("delete from public.lukas_drawing_objects where id=$1", [
      object.id,
    ]),
    /permission denied/i,
  );
  for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
    const result = await db.query(
      `select has_table_privilege(
        'authenticated','public.lukas_drawing_objects',$1
      ) allowed`,
      [privilege],
    );
    assert.equal(result.rows[0].allowed, false);
  }
  const mutationPolicies = await db.query(
    `select count(*)::int count
     from pg_catalog.pg_policies
     where schemaname='public'
       and tablename='lukas_drawing_objects'
       and cmd in ('INSERT','UPDATE','DELETE')
       and 'authenticated'=any(roles)`,
  );
  assert.equal(mutationPolicies.rows[0].count, 0);

  await applyOperation(
    ids.revisionId,
    "update_objects",
    { [object.id]: 1 },
    {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: "RPC update" } }],
    },
    {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: "Circle" } }],
    },
  );
  const issueId = randomUUID();
  await db.exec("reset role");
  await db.query(
    "insert into public.lukas_drawing_issues(id,project_id) values ($1,$2)",
    [issueId, PROJECT],
  );
  await asActor(EDITOR);
  await db.query("select public.lukas_drawing_link_object_issue($1,$2)", [
    object.id,
    issueId,
  ]);
  await applyOperation(
    ids.revisionId,
    "delete_objects",
    { [object.id]: 2 },
    { type: "delete_objects", objectIds: [object.id] },
    {
      type: "add_objects",
      objects: [{ ...object, name: "RPC update", version: 4 }],
    },
  );
  const stored = await db.query(
    `select o.status,o.version,
      (select count(*)::int from public.lukas_drawing_object_issue_links l
       where l.object_id=o.id) "linkCount"
     from public.lukas_drawing_objects o where o.id=$1`,
    [object.id],
  );
  assert.deepEqual(stored.rows[0], {
    status: "deleted",
    version: 3,
    linkCount: 1,
  });
});

test("inspector renders linked issues read-only and draft editor controls accessibly", () => {
  const objectId = randomUUID();
  const layerId = randomUUID();
  const issueId = randomUUID();
  const styleId = randomUUID();
  const props = {
    actorId: OWNER,
    canEdit: false,
    canLinkIssues: false,
    issueLinks: [
      {
        id: randomUUID(),
        object_id: objectId,
        revision_id: randomUUID(),
        issue_id: issueId,
        project_id: PROJECT,
        created_by: OWNER,
        created_at: "2026-08-24T00:00:00.000Z",
      },
    ],
    issues: [
      {
        id: issueId,
        project_id: PROJECT,
        title: "출입문 치수 확인",
        priority: "high",
        status: "open",
        updated_at: "2026-08-24T00:00:00.000Z",
      },
    ],
    onCommand() {},
    selectedIds: [objectId],
    state: {
      layers: {
        [layerId]: {
          id: layerId,
          name: "Work",
          visible: true,
          locked: false,
          systemKind: "work",
          version: 1,
        },
      },
      objects: {
        [objectId]: circleObject(objectId, layerId, {
          styleId,
          style: { fill: "#abcdef" },
        }),
      },
      structure: {
        styles: {
          [styleId]: {
            id: styleId,
            revisionId: randomUUID(),
            name: "Read-only effective",
            value: {
              stroke: "#112233",
              strokeWidth: 2,
              fill: null,
              fontSize: 14,
            },
            version: 1,
          },
        },
      },
    },
  };
  const render = (componentProps) =>
    renderToStaticMarkup(
      createElement(RouterProvider, {
        router: createMemoryRouter(
          [
            {
              path: "/",
              element: createElement(DrawingInspector, componentProps),
            },
          ],
          { initialEntries: ["/"] },
        ),
      }),
    );
  const readOnly = render(props);
  assert.match(readOnly, /연결된 이슈/);
  assert.match(readOnly, /출입문 치수 확인/);
  assert.match(readOnly, /Circle/);
  assert.match(readOnly, /#112233/);
  assert.match(readOnly, /#abcdef/);
  assert.match(readOnly, /14/);
  assert.doesNotMatch(readOnly, /이슈 검색/);
  assert.doesNotMatch(readOnly, /name="issue_id"/);
  assert.doesNotMatch(readOnly, /<form/);
  assert.doesNotMatch(readOnly, /속성 적용/);

  const editable = render({ ...props, canEdit: true, canLinkIssues: true });
  assert.match(editable, /aria-label="이슈 연결"/);
  assert.match(editable, /이슈 검색/);
  assert.match(editable, /for="inspector-issue"/);
  assert.match(editable, /name="issue_id"/);
  assert.match(editable, /name="object_id"/);
  assert.doesNotMatch(editable, /새 이슈 만들기/);
});

test("style library stays readable for viewers and describes referenced delete denial", () => {
  const styleId = randomUUID();
  const objectId = randomUUID();
  const layerId = randomUUID();
  const state = {
    revisionId: randomUUID(),
    layers: {
      [layerId]: {
        id: layerId,
        name: "Work",
        visible: true,
        locked: false,
        systemKind: "work",
        version: 1,
      },
    },
    objects: {
      [objectId]: circleObject(objectId, layerId, { styleId, style: {} }),
    },
    structure: {
      styles: {
        [styleId]: {
          id: styleId,
          revisionId: randomUUID(),
          name: "Shared visible",
          value: STYLE,
          version: 1,
        },
      },
      blocks: {},
    },
  };
  const render = (canEdit) =>
    renderToStaticMarkup(
      createElement(DrawingStylesPanel, {
        actorId: OWNER,
        canEdit,
        onCommand() {},
        state,
      }),
    );
  const viewer = render(false);
  assert.match(viewer, /스타일 라이브러리/);
  assert.match(viewer, /Shared visible/);
  assert.doesNotMatch(viewer, /<form/);
  assert.doesNotMatch(viewer, /스타일 삭제/);

  const editor = render(true);
  assert.match(editor, /aria-label="스타일 삭제: Shared visible"/);
  assert.match(editor, /disabled=""/);
  assert.match(editor, /aria-describedby="style-delete-reason-/);
  assert.match(editor, /사용 중인 스타일은 삭제할 수 없습니다/);
});

test("block library and instance inspector remain readable while approved viewers receive no mutation controls", () => {
  const revisionId = randomUUID();
  const pageId = randomUUID();
  const canvasId = randomUUID();
  const layerId = randomUUID();
  const blockId = randomUUID();
  const instanceId = randomUUID();
  const block = {
    id: blockId,
    revisionId,
    name: "Approved symbol",
    version: 1,
    primitives: [
      {
        localId: "line",
        name: "Line",
        geometry: { type: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
        styleId: null,
        style: STYLE,
      },
    ],
  };
  const instance = {
    id: instanceId,
    lineageId: instanceId,
    blockId,
    layerId,
    name: "Approved placement",
    origin: { x: 12, y: 34 },
    rotation: 30,
    scaleX: 2,
    scaleY: 0.5,
    version: 1,
  };
  const state = drawingCommands.createDrawingDocumentState({
    revisionId,
    structure: {
      pages: {
        [pageId]: {
          id: pageId,
          revisionId,
          name: "A1",
          sortOrder: 0,
          version: 1,
        },
      },
      canvases: {
        [canvasId]: {
          id: canvasId,
          pageId,
          name: "Paper",
          spaceKind: "paper",
          widthMillimeters: 210,
          heightMillimeters: 297,
          background: null,
          sortOrder: 0,
          version: 1,
        },
      },
      layers: {
        [layerId]: {
          id: layerId,
          name: "Work",
          visible: true,
          locked: false,
          systemKind: "work",
          canvasId,
          sortOrder: 0,
          version: 1,
        },
      },
      objects: {},
      styles: {},
      blocks: { [blockId]: block },
      blockInstances: { [instanceId]: instance },
      propertySchemas: {},
      propertyValues: {},
      tables: {},
    },
  });
  const viewer = renderToStaticMarkup(
    createElement(DrawingBlocksPanel, {
      activeLayerId: null,
      actorId: OWNER,
      canEdit: false,
      onCommand() {},
      onSelectionChange() {},
      selectedIds: [],
      state,
    }),
  );
  assert.match(viewer, /읽기 전용 블록 목록/);
  assert.match(viewer, /Approved symbol/);
  assert.match(viewer, /인스턴스 1개/);
  assert.match(viewer, /Approved symbol 인스턴스 1개 보기/);
  assert.match(viewer, /aria-expanded="false"/);
  assert.doesNotMatch(viewer, /<form/);
  assert.doesNotMatch(viewer, /인스턴스 삽입/);

  const expandedInstances = renderToStaticMarkup(
    createElement(DrawingBlockInstancesList, {
      block,
      canEdit: false,
      instances: [instance],
      layers: state.layers,
      onSelectionChange() {},
    }),
  );
  assert.match(expandedInstances, /aria-label="Approved symbol 인스턴스"/);
  assert.match(
    expandedInstances,
    /aria-label="Approved placement 인스턴스 선택"/,
  );
  assert.match(expandedInstances, /읽기 전용/);
  assert.doesNotMatch(expandedInstances, /삭제|저장|삽입/);

  const inspector = renderToStaticMarkup(
    createElement(DrawingInspector, {
      actorId: OWNER,
      canEdit: false,
      canLinkIssues: false,
      issueLinks: [],
      issues: [],
      onCommand() {},
      selectedIds: [instanceId],
      state,
    }),
  );
  assert.match(inspector, /블록 인스턴스/);
  assert.match(inspector, /Approved placement/);
  assert.match(inspector, /12, 34/);
  assert.match(inspector, /30°/);
  assert.doesNotMatch(inspector, /<form/);
  assert.doesNotMatch(inspector, /인스턴스 저장/);

  const editor = renderToStaticMarkup(
    createElement(DrawingBlocksPanel, {
      activeLayerId: layerId,
      actorId: OWNER,
      canEdit: true,
      onCommand() {},
      onSelectionChange() {},
      selectedIds: [],
      state,
    }),
  );
  assert.match(editor, /선택 객체로 블록 만들기/);
  assert.match(editor, /정의 저장/);
  assert.match(editor, /인스턴스 삽입/);
  assert.match(editor, /사용 중인 정의는 삭제할 수 없습니다/);
});

test("semantic block navigation exposes hidden active-canvas instances but no off-canvas buttons or edits", () => {
  const revisionId = randomUUID();
  const pageId = randomUUID();
  const activeCanvasId = randomUUID();
  const otherCanvasId = randomUUID();
  const lockedLayerId = randomUUID();
  const otherLayerId = randomUUID();
  const blockId = randomUUID();
  const activeInstanceId = randomUUID();
  const offCanvasInstanceId = randomUUID();
  const block = {
    id: blockId,
    revisionId,
    name: "Navigation symbol",
    version: 1,
    primitives: [
      {
        localId: "line",
        name: "Line",
        geometry: {
          type: "line",
          start: { x: 0, y: 0 },
          end: { x: 10, y: 0 },
        },
        styleId: null,
        style: STYLE,
      },
    ],
  };
  const activeInstance = {
    id: activeInstanceId,
    lineageId: activeInstanceId,
    blockId,
    layerId: lockedLayerId,
    name: "Hidden active placement",
    origin: { x: 7, y: 8 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  };
  const offCanvasInstance = {
    ...activeInstance,
    id: offCanvasInstanceId,
    lineageId: offCanvasInstanceId,
    layerId: otherLayerId,
    name: "Off canvas placement",
  };
  const layers = {
    [lockedLayerId]: {
      id: lockedLayerId,
      name: "Hidden locked",
      visible: false,
      locked: true,
      systemKind: "work",
      canvasId: activeCanvasId,
      sortOrder: 0,
      version: 1,
    },
    [otherLayerId]: {
      id: otherLayerId,
      name: "Other canvas",
      visible: true,
      locked: false,
      systemKind: "work",
      canvasId: otherCanvasId,
      sortOrder: 0,
      version: 1,
    },
  };
  const state = drawingCommands.createDrawingDocumentState({
    revisionId,
    structure: {
      pages: {
        [pageId]: {
          id: pageId,
          revisionId,
          name: "A1",
          sortOrder: 0,
          version: 1,
        },
      },
      canvases: {
        [activeCanvasId]: {
          id: activeCanvasId,
          pageId,
          name: "Active",
          spaceKind: "paper",
          widthMillimeters: 210,
          heightMillimeters: 297,
          background: null,
          sortOrder: 0,
          version: 1,
        },
        [otherCanvasId]: {
          id: otherCanvasId,
          pageId,
          name: "Other",
          spaceKind: "model",
          widthMillimeters: 210,
          heightMillimeters: 297,
          background: null,
          sortOrder: 1,
          version: 1,
        },
      },
      layers,
      objects: {},
      styles: {},
      blocks: { [blockId]: block },
      blockInstances: {
        [activeInstanceId]: activeInstance,
        [offCanvasInstanceId]: offCanvasInstance,
      },
      propertySchemas: {},
      propertyValues: {},
      tables: {},
    },
  });
  assert.equal(typeof drawingBlockInstancesForCanvas, "function");
  const activeRows = drawingBlockInstancesForCanvas(
    blockId,
    activeCanvasId,
    state.structure.blockInstances,
    layers,
  );
  assert.deepEqual(
    activeRows.map((instance) => instance.id),
    [activeInstanceId],
  );
  const list = renderToStaticMarkup(
    createElement(DrawingBlockInstancesList, {
      block,
      canEdit: false,
      instances: activeRows,
      layers,
      onSelectionChange() {},
    }),
  );
  assert.match(list, /Hidden active placement 인스턴스 선택/);
  assert.doesNotMatch(list, /Off canvas placement 인스턴스 선택/);
  const editorLockedList = renderToStaticMarkup(
    createElement(DrawingBlockInstancesList, {
      block,
      canEdit: true,
      instances: activeRows,
      layers,
      onSelectionChange() {},
    }),
  );
  assert.match(editorLockedList, /Hidden active placement 인스턴스 선택/);
  assert.match(editorLockedList, /aria-describedby="block-instance-readonly-/);
  assert.match(editorLockedList, /읽기 전용/);

  const editableLayers = {
    ...layers,
    [lockedLayerId]: {
      ...layers[lockedLayerId],
      visible: true,
      locked: false,
    },
  };
  const editorEditableList = renderToStaticMarkup(
    createElement(DrawingBlockInstancesList, {
      block,
      canEdit: true,
      instances: activeRows,
      layers: editableLayers,
      onSelectionChange() {},
    }),
  );
  assert.doesNotMatch(editorEditableList, /읽기 전용/);

  const transient = deriveDrawingTransientState(
    { ...state, activePageId: pageId, activeCanvasId },
    {
      canEdit: false,
      canSelect: true,
      activeLayerId: null,
      activeTool: "select",
      selectedIds: [activeInstanceId],
      semanticBlockInstanceIds: [activeInstanceId],
    },
  );
  assert.deepEqual(transient.selectedIds, [activeInstanceId]);
  for (const canEdit of [false, true]) {
    const inspector = renderToStaticMarkup(
      createElement(DrawingInspector, {
        actorId: OWNER,
        canEdit,
        canLinkIssues: false,
        issueLinks: [],
        issues: [],
        onCommand() {},
        selectedIds: transient.selectedIds,
        state: transient.state,
      }),
    );
    assert.match(inspector, /Hidden active placement/);
    assert.match(inspector, /읽기 전용/);
    assert.doesNotMatch(inspector, /인스턴스 저장|인스턴스 삭제|인스턴스 복사/);
  }

  const panel = renderToStaticMarkup(
    createElement(DrawingBlocksPanel, {
      activeCanvasId,
      activeLayerId: null,
      actorId: OWNER,
      canEdit: false,
      layers,
      onCommand() {},
      onSelectionChange() {},
      selectedIds: [],
      state,
    }),
  );
  assert.match(panel, /현재 캔버스 1개/);
  assert.match(panel, /다른 캔버스 1개/);
  assert.doesNotMatch(panel, /Off canvas placement 인스턴스 선택/);
});

test("viewer layer panel keeps read surfaces but omits every mutation control", () => {
  const layerId = randomUUID();
  const readOnly = renderToStaticMarkup(
    createElement(DrawingLayersPanel, {
      activeLayerId: null,
      actorId: OWNER,
      canEdit: false,
      onActiveLayerChange() {},
      onCommand() {},
      state: {
        layers: {
          [layerId]: {
            id: layerId,
            name: "Work read only",
            visible: true,
            locked: false,
            systemKind: "work",
            version: 1,
          },
        },
      },
    }),
  );
  assert.match(readOnly, /Work read only/);
  assert.match(readOnly, /표시/);
  assert.match(readOnly, /잠금 해제/);
  assert.doesNotMatch(readOnly, /<form/);
  assert.doesNotMatch(readOnly, /<input/);
  assert.doesNotMatch(readOnly, /<button/);
});

test("performance selection target intersects exactly one tolerance-expanded object", () => {
  const fixture = buildDrawingPerformanceFixture(
    10_000,
    "00000000-0000-4000-8000-000000000099",
    (index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  const zoom = 0.5;
  const point = fixture.selectionTarget.world;
  const hits = fixture.objects.filter((object) => {
    const bounds = drawingSelectionHitBounds(object.geometry, zoom, 6);
    return (
      point.x >= bounds.x &&
      point.x <= bounds.x + bounds.width &&
      point.y >= bounds.y &&
      point.y <= bounds.y + bounds.height
    );
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, fixture.selectionTarget.id);
  assert.equal(hits[0].name, fixture.selectionTarget.name);
});

test("1440x900 performance gestures move the isolated target off-canvas until fit view resets it", () => {
  assert.equal(typeof drawingFittedViewport, "function");
  const fixture = buildDrawingPerformanceFixture(
    10_000,
    "00000000-0000-4000-8000-000000000099",
    (index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  const browser = { width: 1440, height: 900 };
  const surface = {
    width: browser.width - 14 * 16 - 17 * 16,
    height: browser.height - 64,
  };
  assert.deepEqual(fixture.canvas, { width: 420, height: 297 });
  const background = { kind: "blank", ...fixture.canvas };
  const target = fixture.selectionTarget.world;
  const pointer = { x: surface.width / 2, y: surface.height / 2 };
  let viewport = drawingFittedViewport(surface, background);
  for (let frame = 0; frame < 60; frame += 1) {
    const deltaY = frame < 30 ? -3 : 1;
    viewport = zoomViewportAroundPointer(
      pointer,
      viewport,
      viewport.zoom * Math.exp(-deltaY * 0.002),
    );
  }
  viewport = { ...viewport, x: viewport.x + 90, y: viewport.y + 60 };
  const displaced = worldToScreen(target, viewport);
  assert.ok(displaced.x > surface.width || displaced.y > surface.height);

  const reset = drawingFittedViewport(surface, background);
  const visible = worldToScreen(target, reset);
  const safetyMargin = 40;
  assert.ok(visible.x >= safetyMargin);
  assert.ok(visible.y >= safetyMargin);
  assert.ok(visible.x <= surface.width - safetyMargin);
  assert.ok(visible.y <= surface.height - safetyMargin);
});

test("P2 upgrade backfills one authoritative paper canvas and binds every legacy layer", async () => {
  const ids = await createDocument();
  await db.exec("reset role");
  const result = await db.query(
    `select c.id,c.page_id "pageId",c.space_kind "spaceKind",
      c.sort_order "sortOrder",c.width_mm::float8 width,c.height_mm::float8 height,
      count(l.id)::int "layerCount"
     from public.lukas_drawing_canvases c
     join public.lukas_drawing_layers l on l.canvas_id=c.id
     where c.page_id=$1
     group by c.id,c.page_id,c.space_kind,c.sort_order,c.width_mm,c.height_mm`,
    [ids.pageId],
  );
  assert.deepEqual(result.rows, [
    {
      id: result.rows[0].id,
      pageId: ids.pageId,
      spaceKind: "paper",
      sortOrder: 0,
      width: 420,
      height: 297,
      layerCount: 2,
    },
  ]);
  assert.equal(ids.canvasId, result.rows[0].id);
});

test("P2 mutate_structure is strict, atomic, conflict-safe, and exactly idempotent", async () => {
  const ids = await createDocument();
  const styleId = randomUUID();
  const style = {
    id: styleId,
    revisionId: ids.revisionId,
    name: "Door style",
    value: { stroke: "#123456", strokeWidth: 2, fill: null },
    version: 1,
  };
  const forward = {
    type: "mutate_structure",
    actions: [{ kind: "put_style", entity: style, baseVersion: null }],
  };
  const inverse = {
    type: "mutate_structure",
    actions: [{ kind: "delete_style", id: styleId, baseVersion: 1 }],
  };
  const clientOperationId = randomUUID();
  const args = [
    ids.revisionId,
    clientOperationId,
    "mutate_structure",
    {},
    forward,
    inverse,
  ];
  const first = await db.query(
    "select public.lukas_drawing_apply_operation($1,$2,$3,$4,$5,$6) result",
    args,
  );
  const retry = await db.query(
    "select public.lukas_drawing_apply_operation($1,$2,$3,$4,$5,$6) result",
    args,
  );
  assert.deepEqual(retry.rows[0].result, first.rows[0].result);
  assert.deepEqual(first.rows[0].result.resultVersions, { [styleId]: 1 });

  await assert.rejects(
    db.query("select public.lukas_drawing_apply_operation($1,$2,$3,$4,$5,$6)", [
      ids.revisionId,
      clientOperationId,
      "mutate_structure",
      {},
      { ...forward, authority: "admin" },
      inverse,
    ]),
    (error) => error.code === "P1C01",
  );
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      { [styleId]: 99 },
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_style", id: styleId, baseVersion: 99 }],
      },
      {
        type: "mutate_structure",
        actions: [{ kind: "put_style", entity: style, baseVersion: null }],
      },
    ),
    (error) => error.code === "P1C01",
  );

  const mutableBackgroundId = randomUUID();
  const mutableBackgroundSha = "c".repeat(64);
  await db.exec("reset role");
  await db.query(
    `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256,immutable)
     values ($1,$2,$3,'pdf',$4,false)`,
    [mutableBackgroundId, PROJECT, OWNER, mutableBackgroundSha],
  );
  await asActor(OWNER);
  const invalidCanvasId = randomUUID();
  const invalidCanvasLayerId = randomUUID();
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      {},
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_canvas",
            entity: {
              id: invalidCanvasId,
              pageId: ids.pageId,
              name: "Mutable source",
              spaceKind: "paper",
              widthMillimeters: 100,
              heightMillimeters: 100,
              background: {
                sourceFileId: mutableBackgroundId,
                sourceSha256: mutableBackgroundSha,
                pdfPageNumber: 1,
                calibration: null,
              },
              sortOrder: 1,
              version: 1,
            },
            baseVersion: null,
          },
          {
            kind: "put_layer",
            entity: {
              id: invalidCanvasLayerId,
              name: "Mutable source work",
              visible: true,
              locked: false,
              systemKind: "custom",
              canvasId: invalidCanvasId,
              sortOrder: 0,
              version: 1,
            },
            baseVersion: null,
          },
        ],
      },
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_layer", id: invalidCanvasLayerId, baseVersion: 1 },
          { kind: "delete_canvas", id: invalidCanvasId, baseVersion: 1 },
        ],
      },
    ),
    (error) => error.code === "P1R01",
  );

  const invalidTableId = randomUUID();
  const columnId = randomUUID();
  const rowId = randomUUID();
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      {},
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_table",
            entity: {
              id: invalidTableId,
              revisionId: ids.revisionId,
              name: "Invalid cells",
              columns: [
                {
                  id: columnId,
                  name: "Text",
                  kind: "text",
                  propertySchemaId: null,
                },
              ],
              rows: [
                {
                  id: rowId,
                  objectId: null,
                  blockInstanceId: null,
                  cells: { [columnId]: true },
                },
              ],
              version: 1,
            },
            baseVersion: null,
          },
        ],
      },
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_table", id: invalidTableId, baseVersion: 1 }],
      },
    ),
    (error) => error.code === "P1C01",
  );
  const unknownCellTableId = randomUUID();
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      {},
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_table",
            entity: {
              id: unknownCellTableId,
              revisionId: ids.revisionId,
              name: "Unknown cell",
              columns: [
                {
                  id: columnId,
                  name: "Text",
                  kind: "text",
                  propertySchemaId: null,
                },
              ],
              rows: [
                {
                  id: randomUUID(),
                  objectId: null,
                  blockInstanceId: null,
                  cells: { [randomUUID()]: "detached" },
                },
              ],
              version: 1,
            },
            baseVersion: null,
          },
        ],
      },
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_table", id: unknownCellTableId, baseVersion: 1 },
        ],
      },
    ),
    (error) => error.code === "P1C01",
  );

  const rolledBackStyleId = randomUUID();
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      {},
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_style",
            entity: { ...style, id: rolledBackStyleId, name: "Rollback style" },
            baseVersion: null,
          },
          {
            kind: "put_canvas",
            entity: {
              id: randomUUID(),
              pageId: randomUUID(),
              name: "Missing parent",
              spaceKind: "model",
              widthMillimeters: 100,
              heightMillimeters: 100,
              background: null,
              sortOrder: 1,
              version: 1,
            },
            baseVersion: null,
          },
        ],
      },
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_canvas", id: randomUUID(), baseVersion: 1 },
          { kind: "delete_style", id: rolledBackStyleId, baseVersion: 1 },
        ],
      },
    ),
    (error) => error.code === "P1R01" || error.code === "P1C01",
  );
  await db.exec("reset role");
  const rolledBack = await db.query(
    "select count(*)::int count from public.lukas_drawing_styles where id=$1",
    [rolledBackStyleId],
  );
  assert.equal(rolledBack.rows[0].count, 0);
});

test("reference-aware object deletion is one idempotent RPC transaction with exact undo and redo", async () => {
  const ids = await createDocument();
  const object = {
    ...circleObject(randomUUID(), ids.workLayerId),
    styleId: null,
  };
  const schema = {
    id: randomUUID(),
    revisionId: ids.revisionId,
    name: "Mark",
    valueType: "text",
    enumOptions: [],
    appliesTo: ["circle"],
    required: false,
    version: 1,
  };
  const value = {
    id: randomUUID(),
    schemaId: schema.id,
    objectId: object.id,
    blockInstanceId: null,
    value: "C-01",
    version: 1,
  };
  const table = {
    id: randomUUID(),
    revisionId: ids.revisionId,
    name: "Circle schedule",
    columns: [
      {
        id: randomUUID(),
        name: "Name",
        kind: "object_name",
        propertySchemaId: null,
      },
    ],
    rows: [
      {
        id: randomUUID(),
        objectId: object.id,
        blockInstanceId: null,
        cells: {},
      },
    ],
    version: 1,
  };
  await addObject(ids, object);
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_property_schema", entity: schema, baseVersion: null },
        { kind: "put_property_value", entity: value, baseVersion: null },
        { kind: "put_table", entity: table, baseVersion: null },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_table", id: table.id, baseVersion: 1 },
        { kind: "delete_property_value", id: value.id, baseVersion: 1 },
        { kind: "delete_property_schema", id: schema.id, baseVersion: 1 },
      ],
    },
  );
  const navigation = await localP2State(ids);
  const initial = drawingCommands.createDrawingDocumentState({
    revisionId: ids.revisionId,
    structure: {
      ...navigation.structure,
      objects: { [object.id]: object },
      propertySchemas: { [schema.id]: schema },
      propertyValues: { [value.id]: value },
      tables: { [table.id]: table },
    },
  });
  const deleteCommand =
    drawingProperties.deleteDrawingObjectsWithReferencesCommand(
      initial,
      OWNER,
      [object.id],
    );
  assert.deepEqual(deleteCommand.objects, [initial.objects[object.id]]);
  const deleted = drawingCommands.applyDrawingCommand(initial, deleteCommand);
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      deleted.operation.type,
      { [object.id]: 1, [value.id]: 1 },
      {
        ...deleted.operation.forward,
        actions: [deleted.operation.forward.actions[0]],
      },
      {
        ...deleted.operation.inverse,
        actions: [deleted.operation.inverse.actions[1]],
      },
    ),
    (error) => error.code === "P1C01",
  );
  const before = await db.query(
    `select
      (select count(*)::int from public.lukas_drawing_objects where id=$1 and status='active') objects,
      (select count(*)::int from public.lukas_drawing_property_values where id=$2) values,
      (select pg_catalog.jsonb_array_length(rows_json) from public.lukas_drawing_tables where id=$3) rows`,
    [object.id, value.id, table.id],
  );
  assert.deepEqual(before.rows[0], { objects: 1, values: 1, rows: 1 });

  const persist = (applied) =>
    applyOperationWithId(
      ids.revisionId,
      applied.operation.clientOperationId,
      applied.operation.type,
      applied.operation.baseVersions,
      applied.operation.forward,
      applied.operation.inverse,
    );
  const first = await persist(deleted);
  assert.deepEqual(await persist(deleted), first);
  assert.deepEqual(first.resultVersions, {
    [object.id]: null,
    [value.id]: null,
    [table.id]: 2,
  });
  const removed = await db.query(
    `select
      (select count(*)::int from public.lukas_drawing_objects where id=$1 and status='active') objects,
      (select count(*)::int from public.lukas_drawing_property_values where id=$2) values,
      (select pg_catalog.jsonb_array_length(rows_json) from public.lukas_drawing_tables where id=$3) rows,
      (select count(*)::int from public.lukas_drawing_operations where client_operation_id=$4) operations`,
    [object.id, value.id, table.id, deleted.operation.clientOperationId],
  );
  assert.deepEqual(removed.rows[0], {
    objects: 0,
    values: 0,
    rows: 0,
    operations: 1,
  });

  const restored = drawingCommands.undoDrawingCommand(deleted.state, OWNER);
  assert.ok(restored && !("kind" in restored));
  await persist(restored);
  const afterUndo = await db.query(
    `select
      (select version::int from public.lukas_drawing_objects where id=$1 and status='active') object_version,
      (select version::int from public.lukas_drawing_property_values where id=$2) value_version,
      (select pg_catalog.jsonb_array_length(rows_json) from public.lukas_drawing_tables where id=$3) rows`,
    [object.id, value.id, table.id],
  );
  assert.deepEqual(afterUndo.rows[0], {
    object_version: 3,
    value_version: 3,
    rows: 1,
  });

  const deletedAgain = drawingCommands.redoDrawingCommand(
    restored.state,
    OWNER,
  );
  assert.ok(deletedAgain && !("kind" in deletedAgain));
  await persist(deletedAgain);
  const afterRedo = await db.query(
    `select
      (select count(*)::int from public.lukas_drawing_objects where id=$1 and status='active') objects,
      (select count(*)::int from public.lukas_drawing_property_values where id=$2) values,
      (select pg_catalog.jsonb_array_length(rows_json) from public.lukas_drawing_tables where id=$3) rows`,
    [object.id, value.id, table.id],
  );
  assert.deepEqual(afterRedo.rows[0], { objects: 0, values: 0, rows: 0 });

  const restoredAgain = drawingCommands.undoDrawingCommand(
    deletedAgain.state,
    OWNER,
  );
  assert.ok(restoredAgain && !("kind" in restoredAgain));
  await persist(restoredAgain);
  const lockedDelete = drawingCommands.applyDrawingCommand(
    restoredAgain.state,
    drawingProperties.deleteDrawingObjectsWithReferencesCommand(
      restoredAgain.state,
      OWNER,
      [object.id],
    ),
  );
  const backupLayerId = randomUUID();
  await applyOperation(
    ids.revisionId,
    "add_layer",
    { [backupLayerId]: 1 },
    {
      type: "add_layer",
      layer: {
        id: backupLayerId,
        name: "Backup work",
        visible: true,
        locked: false,
        canvasId: ids.canvasId,
        sortOrder: 99,
        version: 1,
      },
    },
    {},
  );
  await applyOperation(
    ids.revisionId,
    "update_layer",
    { [ids.workLayerId]: 1 },
    { type: "update_layer", layerId: ids.workLayerId, patch: { locked: true } },
    {
      type: "update_layer",
      layerId: ids.workLayerId,
      patch: { locked: false },
    },
  );
  await assert.rejects(
    persist(lockedDelete),
    (error) =>
      error.code === "P1C01" && /snapshot|layer|cleanup/i.test(error.message),
  );
  await db.exec("reset role");
  const lockedUnchanged = await db.query(
    "select status,version::int version from public.lukas_drawing_objects where id=$1",
    [object.id],
  );
  assert.deepEqual(lockedUnchanged.rows, [{ status: "active", version: 5 }]);
});

test("reference-aware restore rejects every noncanonical object field and preserves the tombstone", async () => {
  const ids = await createDocument();
  const backupLayerId = randomUUID();
  const style = {
    id: randomUUID(),
    revisionId: ids.revisionId,
    name: "Restore test style",
    value: STYLE,
    version: 1,
  };
  await applyOperation(
    ids.revisionId,
    "add_layer",
    { [backupLayerId]: 1 },
    {
      type: "add_layer",
      layer: {
        id: backupLayerId,
        name: "Restore backup",
        visible: true,
        locked: false,
        canvasId: ids.canvasId,
        sortOrder: 99,
        version: 1,
      },
    },
    {},
  );
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [{ kind: "put_style", entity: style, baseVersion: null }],
    },
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_style", id: style.id, baseVersion: 1 }],
    },
  );
  const object = {
    ...circleObject(randomUUID(), ids.workLayerId),
    styleId: null,
  };
  await addObject(ids, object);
  const navigation = await localP2State(ids);
  const initial = drawingCommands.createDrawingDocumentState({
    revisionId: ids.revisionId,
    structure: {
      ...navigation.structure,
      objects: { [object.id]: object },
    },
  });
  const deleted = drawingCommands.applyDrawingCommand(
    initial,
    drawingProperties.deleteDrawingObjectsWithReferencesCommand(
      initial,
      OWNER,
      [object.id],
    ),
  );
  const persist = (applied) =>
    applyOperationWithId(
      ids.revisionId,
      applied.operation.clientOperationId,
      applied.operation.type,
      applied.operation.baseVersions,
      applied.operation.forward,
      applied.operation.inverse,
    );
  await persist(deleted);
  const restored = drawingCommands.undoDrawingCommand(deleted.state, OWNER);
  assert.ok(restored && !("kind" in restored));
  const storedFields = `id,revision_id,project_id,page_id,layer_id,name,
    object_type,geometry,style_id,style,created_by`;
  const tombstone = await db.query(
    `select ${storedFields},status,version::int version
     from public.lukas_drawing_objects where id=$1`,
    [object.id],
  );
  assert.equal(tombstone.rows[0].status, "deleted");
  assert.equal(tombstone.rows[0].version, 2);

  const mutations = [
    ["name", (snapshot) => ({ ...snapshot, name: "Forged restore" })],
    ["layer", (snapshot) => ({ ...snapshot, layerId: backupLayerId })],
    [
      "geometry",
      (snapshot) => ({
        ...snapshot,
        geometry: {
          ...snapshot.geometry,
          radius: snapshot.geometry.radius + 1,
        },
      }),
    ],
    [
      "inline style",
      (snapshot) => ({
        ...snapshot,
        style: { ...snapshot.style, stroke: "#445566" },
      }),
    ],
    [
      "style reference",
      (snapshot) => ({ ...snapshot, styleId: style.id, style: {} }),
    ],
    ["identity", (snapshot) => ({ ...snapshot, id: randomUUID() })],
    [
      "revision identity",
      (snapshot) => ({ ...snapshot, revisionId: randomUUID() }),
    ],
    [
      "project identity",
      (snapshot) => ({ ...snapshot, projectId: randomUUID() }),
    ],
    ["page identity", (snapshot) => ({ ...snapshot, pageId: randomUUID() })],
    [
      "creator identity",
      (snapshot) => ({ ...snapshot, createdBy: randomUUID() }),
    ],
  ];
  for (const [name, mutate] of mutations) {
    const forgedObject = mutate(restored.operation.forward.objects[0]);
    const clientOperationId = randomUUID();
    await assert.rejects(
      applyOperationWithId(
        ids.revisionId,
        clientOperationId,
        restored.operation.type,
        restored.operation.baseVersions,
        { ...restored.operation.forward, objects: [forgedObject] },
        { ...restored.operation.inverse, objects: [forgedObject] },
      ),
      (error) => error.code === "P1C01",
      name,
    );
    const unchanged = await db.query(
      `select ${storedFields},status,version::int version,
        (select count(*)::int from public.lukas_drawing_operations
          where client_operation_id=$2) operation_count
       from public.lukas_drawing_objects where id=$1`,
      [object.id, clientOperationId],
    );
    assert.deepEqual(
      unchanged.rows,
      [{ ...tombstone.rows[0], operation_count: 0 }],
      name,
    );
  }

  const first = await persist(restored);
  assert.deepEqual(await persist(restored), first);
  const active = await db.query(
    `select ${storedFields},status,version::int version,
      (select count(*)::int from public.lukas_drawing_operations
        where client_operation_id=$2) operation_count
     from public.lukas_drawing_objects where id=$1`,
    [object.id, restored.operation.clientOperationId],
  );
  assert.deepEqual(active.rows, [
    {
      ...tombstone.rows[0],
      status: "active",
      version: 3,
      operation_count: 1,
    },
  ]);
});

test("table SQL and RPC boundaries reject duplicate identity and incompatible property targets", async () => {
  const ids = await createDocument();
  const rectangle = circleObject(randomUUID(), ids.workLayerId);
  rectangle.geometry = {
    type: "rectangle",
    origin: { x: 0, y: 0 },
    width: 10,
    height: 10,
    rotation: 0,
  };
  const circle = circleObject(randomUUID(), ids.workLayerId);
  await addObject(ids, rectangle);
  await addObject(ids, circle);
  const schema = {
    id: randomUUID(),
    revisionId: ids.revisionId,
    name: "Rectangle mark",
    valueType: "text",
    enumOptions: [],
    appliesTo: ["rectangle"],
    required: false,
    version: 1,
  };
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_property_schema", entity: schema, baseVersion: null },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_property_schema", id: schema.id, baseVersion: 1 },
      ],
    },
  );
  const duplicateColumnId = randomUUID();
  const duplicateRowId = randomUUID();
  const invalidTable = {
    id: randomUUID(),
    revisionId: ids.revisionId,
    name: "Invalid schedule",
    columns: [
      {
        id: duplicateColumnId,
        name: "Duplicate",
        kind: "property",
        propertySchemaId: schema.id,
      },
      {
        id: duplicateColumnId,
        name: "Duplicate",
        kind: "text",
        propertySchemaId: null,
      },
    ],
    rows: [
      {
        id: duplicateRowId,
        objectId: circle.id,
        blockInstanceId: null,
        cells: {},
      },
      {
        id: duplicateRowId,
        objectId: rectangle.id,
        blockInstanceId: null,
        cells: {},
      },
    ],
    version: 1,
  };
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      {},
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_table", entity: invalidTable, baseVersion: null },
        ],
      },
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_table", id: invalidTable.id, baseVersion: 1 },
        ],
      },
    ),
    (error) =>
      error.code === "P1C01" &&
      /invalid|table|schedule|column|row/i.test(error.message),
  );
  const incompatibleTable = {
    ...invalidTable,
    id: randomUUID(),
    name: "Incompatible schedule",
    columns: [invalidTable.columns[0]],
    rows: [
      {
        id: randomUUID(),
        objectId: circle.id,
        blockInstanceId: null,
        cells: {},
      },
    ],
  };
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      {},
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_table", entity: incompatibleTable, baseVersion: null },
        ],
      },
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_table", id: incompatibleTable.id, baseVersion: 1 },
        ],
      },
    ),
    (error) => error.code === "P1C01" && /does not apply/i.test(error.message),
  );
  await assert.rejects(
    db.query(
      `insert into public.lukas_drawing_tables(
        id,revision_id,project_id,name,columns_json,rows_json,version,created_by
      ) values($1,$2,$3,$4,$5,$6,1,$7)`,
      [
        invalidTable.id,
        ids.revisionId,
        PROJECT,
        invalidTable.name,
        invalidTable.columns,
        invalidTable.rows,
        OWNER,
      ],
    ),
    /table|schedule|column|row|unique/i,
  );
  await db.exec("reset role");
  const stored = await db.query(
    "select count(*)::int count from public.lukas_drawing_tables where id=$1",
    [invalidTable.id],
  );
  assert.equal(stored.rows[0].count, 0);
});

test("task 9 keeps only the canonical apply function executable", async () => {
  const privileges = await db.query(
    `select
      has_function_privilege('anon','private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb)','execute') anon_apply,
      has_function_privilege('authenticated','private.lukas_drawing_apply_operation_pre_task9_contract_fixes(uuid,uuid,text,jsonb,jsonb,jsonb)','execute') authenticated_block_wrapper,
      has_function_privilege('authenticated','private.lukas_drawing_apply_operation_pre_task9_block_references(uuid,uuid,text,jsonb,jsonb,jsonb)','execute') authenticated_previous_apply,
      has_function_privilege('authenticated','private.lukas_drawing_structure_action_valid_pre_task9_table_identity(jsonb,uuid)','execute') authenticated_previous_validator,
      has_function_privilege('authenticated','private.lukas_drawing_table_domain_guard()','execute') authenticated_table_guard`,
  );
  assert.deepEqual(privileges.rows[0], {
    anon_apply: false,
    authenticated_block_wrapper: false,
    authenticated_previous_apply: false,
    authenticated_previous_validator: false,
    authenticated_table_guard: false,
  });
});

test("P2 hardening records canvas layers, validates tables/properties/numbers, and permits atomic page swaps", async () => {
  const ids = await createDocument();
  const canvasId = randomUUID();
  const layerId = randomUUID();
  const canvas = {
    id: canvasId,
    pageId: ids.pageId,
    name: "Model",
    spaceKind: "model",
    widthMillimeters: 100,
    heightMillimeters: 100,
    background: null,
    sortOrder: 1,
    version: 1,
  };
  const layer = {
    id: layerId,
    name: "Model work",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId,
    sortOrder: 7,
    version: 1,
  };
  const createForward = {
    type: "mutate_structure",
    actions: [
      { kind: "put_canvas", entity: canvas, baseVersion: null },
      { kind: "put_layer", entity: layer, baseVersion: null },
    ],
  };
  const createInverse = {
    type: "mutate_structure",
    actions: [
      { kind: "delete_layer", id: layerId, baseVersion: 1 },
      { kind: "delete_canvas", id: canvasId, baseVersion: 1 },
    ],
  };
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      {},
      { type: "mutate_structure", actions: [createForward.actions[0]] },
      { type: "mutate_structure", actions: [createInverse.actions[1]] },
    ),
    (error) => error.code === "P1C01",
  );
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    createForward,
    createInverse,
  );
  await db.exec("reset role");
  const exactLayer = await db.query(
    `select id,canvas_id "canvasId",sort_order "sortOrder",name
     from public.lukas_drawing_layers where canvas_id=$1`,
    [canvasId],
  );
  assert.deepEqual(exactLayer.rows, [
    { id: layerId, canvasId, sortOrder: 7, name: "Model work" },
  ]);

  await asActor(OWNER);
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      { [canvasId]: 1 },
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_canvas", id: canvasId, baseVersion: 1 }],
      },
      {
        type: "mutate_structure",
        actions: [{ kind: "put_canvas", entity: canvas, baseVersion: null }],
      },
    ),
    (error) => error.code === "P1C01",
  );
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    { [layerId]: 1, [canvasId]: 1 },
    createInverse,
    createForward,
  );
  await applyOperation(ids.revisionId, "mutate_structure", {}, createForward, {
    type: "mutate_structure",
    actions: [
      { kind: "delete_layer", id: layerId, baseVersion: 3 },
      { kind: "delete_canvas", id: canvasId, baseVersion: 3 },
    ],
  });
  await db.exec("reset role");
  const restoredLayer = await db.query(
    `select id,canvas_id "canvasId",sort_order "sortOrder",name,version
     from public.lukas_drawing_layers where id=$1`,
    [layerId],
  );
  assert.deepEqual(restoredLayer.rows, [
    {
      id: layerId,
      canvasId,
      sortOrder: 7,
      name: "Model work",
      version: 3,
    },
  ]);

  const tableId = randomUUID();
  const columnId = randomUUID();
  const invalidTable = {
    id: tableId,
    revisionId: ids.revisionId,
    name: "No target",
    columns: [
      { id: columnId, name: "Note", kind: "text", propertySchemaId: null },
    ],
    rows: [
      { id: randomUUID(), objectId: null, blockInstanceId: null, cells: {} },
    ],
    version: 1,
  };
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      {},
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_table", entity: invalidTable, baseVersion: null },
        ],
      },
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_table", id: tableId, baseVersion: 1 }],
      },
    ),
    (error) => error.code === "P1C01",
  );
  await db.exec("reset role");
  await assert.rejects(
    db.query(
      `insert into public.lukas_drawing_tables(id,revision_id,project_id,name,columns_json,rows_json,
         version,created_by) values($1,$2,$3,'Bad direct',$4,$5,1,$6)`,
      [
        tableId,
        ids.revisionId,
        PROJECT,
        invalidTable.columns,
        invalidTable.rows,
        OWNER,
      ],
    ),
    /exactly one target/i,
  );

  await asActor(OWNER);
  const propertyObject = circleObject(randomUUID(), ids.workLayerId);
  await addObject(ids, propertyObject);
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "update_objects",
      { [propertyObject.id]: 1 },
      {
        type: "update_objects",
        updates: [
          {
            objectId: propertyObject.id,
            patch: { geometry: { ...propertyObject.geometry, radius: 1e20 } },
          },
        ],
      },
      {
        type: "update_objects",
        updates: [
          {
            objectId: propertyObject.id,
            patch: { geometry: propertyObject.geometry },
          },
        ],
      },
    ),
    (error) => error.code === "P1C01",
  );
  const schemaId = randomUUID();
  const valueId = randomUUID();
  const propertySchema = {
    id: schemaId,
    revisionId: ids.revisionId,
    name: "Circle note",
    valueType: "text",
    enumOptions: [],
    appliesTo: ["circle"],
    required: false,
    version: 1,
  };
  const propertyValue = {
    id: valueId,
    schemaId,
    objectId: propertyObject.id,
    blockInstanceId: null,
    value: "kept",
    version: 1,
  };
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [
        {
          kind: "put_property_schema",
          entity: propertySchema,
          baseVersion: null,
        },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_property_schema", id: schemaId, baseVersion: 1 },
      ],
    },
  );
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [
        {
          kind: "put_property_value",
          entity: propertyValue,
          baseVersion: null,
        },
      ],
    },
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_property_value", id: valueId, baseVersion: 1 }],
    },
  );
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      { [schemaId]: 1 },
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_property_schema",
            entity: { ...propertySchema, appliesTo: ["rectangle"] },
            baseVersion: 1,
          },
        ],
      },
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_property_schema",
            entity: propertySchema,
            baseVersion: 2,
          },
        ],
      },
    ),
    (error) => error.code === "P1C01",
  );

  await asActor(OWNER);
  const hugeCanvas = {
    ...canvas,
    id: randomUUID(),
    name: "Huge",
    widthMillimeters: 1e20,
  };
  const hugeLayer = {
    ...layer,
    id: randomUUID(),
    name: "Huge work",
    canvasId: hugeCanvas.id,
  };
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      {},
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_canvas", entity: hugeCanvas, baseVersion: null },
          { kind: "put_layer", entity: hugeLayer, baseVersion: null },
        ],
      },
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_layer", id: hugeLayer.id, baseVersion: 1 },
          { kind: "delete_canvas", id: hugeCanvas.id, baseVersion: 1 },
        ],
      },
    ),
    (error) => error.code === "P1C01",
  );

  const page2Id = randomUUID();
  const canvas2Id = randomUUID();
  const layer2Id = randomUUID();
  const page2 = {
    id: page2Id,
    revisionId: ids.revisionId,
    name: "Page 2",
    sortOrder: 1,
    version: 1,
  };
  const canvas2 = {
    ...canvas,
    id: canvas2Id,
    pageId: page2Id,
    name: "Paper",
    spaceKind: "paper",
    sortOrder: 0,
  };
  const layer2 = {
    ...layer,
    id: layer2Id,
    canvasId: canvas2Id,
    name: "Page 2 work",
    sortOrder: 0,
  };
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_page", entity: page2, baseVersion: null },
        { kind: "put_canvas", entity: canvas2, baseVersion: null },
        { kind: "put_layer", entity: layer2, baseVersion: null },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_layer", id: layer2Id, baseVersion: 1 },
        { kind: "delete_canvas", id: canvas2Id, baseVersion: 1 },
        { kind: "delete_page", id: page2Id, baseVersion: 1 },
      ],
    },
  );
  await db.exec("reset role");
  const page1Result = await db.query(
    `select id,revision_id "revisionId",name,sort_order "sortOrder",version
     from public.lukas_drawing_pages where id=$1`,
    [ids.pageId],
  );
  const page1 = page1Result.rows[0];
  await asActor(OWNER);
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    { [ids.pageId]: 1, [page2Id]: 1 },
    {
      type: "mutate_structure",
      actions: [
        {
          kind: "put_page",
          entity: { ...page1, sortOrder: 1 },
          baseVersion: 1,
        },
        {
          kind: "put_page",
          entity: { ...page2, sortOrder: 0 },
          baseVersion: 1,
        },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_page", entity: page2, baseVersion: 2 },
        { kind: "put_page", entity: page1, baseVersion: 2 },
      ],
    },
  );
  await db.exec("reset role");
  const pageOrder = await db.query(
    'select id,sort_order "sortOrder" from public.lukas_drawing_pages where revision_id=$1 order by sort_order',
    [ids.revisionId],
  );
  assert.deepEqual(
    pageOrder.rows.map((row) => row.id),
    [page2Id, ids.pageId],
  );

  const privileges = await db.query(
    `select has_table_privilege('authenticated','public.lukas_drawing_pages','insert,update,delete') pages,
      has_table_privilege('authenticated','public.lukas_drawing_layers','insert,update,delete') layers`,
  );
  assert.deepEqual(privileges.rows, [{ pages: false, layers: false }]);
  const indexes = await db.query(
    `select indexdef from pg_indexes where schemaname='public'
      and indexname in ('lukas_drawing_styles_project_idx','lukas_drawing_blocks_project_idx',
        'lukas_drawing_block_instances_project_idx','lukas_drawing_property_schemas_project_idx',
        'lukas_drawing_property_values_project_idx')`,
  );
  assert.equal(
    indexes.rows.some(({ indexdef }) =>
      /include\s*\([^)]*\b(value|primitives|origin|enum_options|applies_to)\b/i.test(
        indexdef,
      ),
    ),
    false,
  );
});

test("P2 legacy RPCs persist referenced style overrides and explicit layer placement with exact inverses", async () => {
  const ids = await createDocument();
  const styleId = randomUUID();
  const style = {
    id: styleId,
    revisionId: ids.revisionId,
    name: "Referenced",
    value: { stroke: "#112233", strokeWidth: 1, fill: null },
    version: 1,
  };
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [{ kind: "put_style", entity: style, baseVersion: null }],
    },
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_style", id: styleId, baseVersion: 1 }],
    },
  );
  const object = circleObject(randomUUID(), ids.workLayerId, {
    styleId,
    style: { strokeWidth: 2 },
  });
  await addObject(ids, object);
  await applyOperation(
    ids.revisionId,
    "update_objects",
    { [object.id]: 1 },
    {
      type: "update_objects",
      updates: [
        { objectId: object.id, patch: { styleId, style: { fill: "#abcdef" } } },
      ],
    },
    {
      type: "update_objects",
      updates: [
        { objectId: object.id, patch: { styleId, style: { strokeWidth: 2 } } },
      ],
    },
  );
  await db.exec("reset role");
  const storedObject = await db.query(
    `select style_id "styleId",style,version from public.lukas_drawing_objects where id=$1`,
    [object.id],
  );
  assert.deepEqual(storedObject.rows, [
    { styleId, style: { fill: "#abcdef" }, version: 2 },
  ]);

  await asActor(OWNER);
  const modelCanvasId = randomUUID();
  const modelWorkId = randomUUID();
  const modelCanvas = {
    id: modelCanvasId,
    pageId: ids.pageId,
    name: "Legacy model",
    spaceKind: "model",
    widthMillimeters: 100,
    heightMillimeters: 100,
    background: null,
    sortOrder: 1,
    version: 1,
  };
  const modelWork = {
    id: modelWorkId,
    name: "Legacy model work",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: modelCanvasId,
    sortOrder: 0,
    version: 1,
  };
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_canvas", entity: modelCanvas, baseVersion: null },
        { kind: "put_layer", entity: modelWork, baseVersion: null },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_layer", id: modelWorkId, baseVersion: 1 },
        { kind: "delete_canvas", id: modelCanvasId, baseVersion: 1 },
      ],
    },
  );
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "update_layer",
      { [modelWorkId]: 1 },
      {
        type: "update_layer",
        layerId: modelWorkId,
        patch: { canvasId: ids.canvasId },
      },
      {
        type: "update_layer",
        layerId: modelWorkId,
        patch: { canvasId: modelCanvasId },
      },
    ),
    (error) => error.code === "P1C01" && /previous canvas/i.test(error.message),
  );
  const layerId = randomUUID();
  await applyOperation(
    ids.revisionId,
    "add_layer",
    { [layerId]: 1 },
    {
      type: "add_layer",
      layer: {
        id: layerId,
        name: "Placed",
        visible: true,
        locked: false,
        canvasId: ids.canvasId,
        sortOrder: 8,
        version: 1,
      },
    },
    {},
  );
  await applyOperation(
    ids.revisionId,
    "update_layer",
    { [layerId]: 1 },
    {
      type: "update_layer",
      layerId,
      patch: { canvasId: modelCanvasId, sortOrder: 4 },
    },
    {
      type: "update_layer",
      layerId,
      patch: { canvasId: ids.canvasId, sortOrder: 8 },
    },
  );
  await db.exec("reset role");
  const storedLayer = await db.query(
    `select canvas_id "canvasId",sort_order "sortOrder",version
     from public.lukas_drawing_layers where id=$1`,
    [layerId],
  );
  assert.deepEqual(storedLayer.rows, [
    { canvasId: modelCanvasId, sortOrder: 4, version: 2 },
  ]);
});

test("P2 layer moves reject nonempty cross-page ancestry but allow valid same-page canvas moves", async () => {
  const ids = await createDocument();
  const samePageCanvasId = randomUUID();
  const samePageWorkId = randomUUID();
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [
        {
          kind: "put_canvas",
          entity: {
            id: samePageCanvasId,
            pageId: ids.pageId,
            name: "Same page model",
            spaceKind: "model",
            widthMillimeters: 100,
            heightMillimeters: 100,
            background: null,
            sortOrder: 1,
            version: 1,
          },
          baseVersion: null,
        },
        {
          kind: "put_layer",
          entity: {
            id: samePageWorkId,
            name: "Same page work",
            visible: true,
            locked: false,
            systemKind: "custom",
            canvasId: samePageCanvasId,
            sortOrder: 0,
            version: 1,
          },
          baseVersion: null,
        },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_layer", id: samePageWorkId, baseVersion: 1 },
        { kind: "delete_canvas", id: samePageCanvasId, baseVersion: 1 },
      ],
    },
  );
  const movableLayerId = randomUUID();
  await applyOperation(
    ids.revisionId,
    "add_layer",
    { [movableLayerId]: 1 },
    {
      type: "add_layer",
      layer: {
        id: movableLayerId,
        name: "Movable",
        visible: true,
        locked: false,
        canvasId: ids.canvasId,
        sortOrder: 4,
        version: 1,
      },
    },
    {},
  );
  await applyOperation(
    ids.revisionId,
    "update_layer",
    { [movableLayerId]: 1 },
    {
      type: "update_layer",
      layerId: movableLayerId,
      patch: { canvasId: samePageCanvasId, sortOrder: 2 },
    },
    {
      type: "update_layer",
      layerId: movableLayerId,
      patch: { canvasId: ids.canvasId, sortOrder: 4 },
    },
  );
  const object = circleObject(randomUUID(), movableLayerId);
  await addObject(ids, object);

  const secondPageId = randomUUID();
  const secondCanvasId = randomUUID();
  const secondWorkId = randomUUID();
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [
        {
          kind: "put_page",
          entity: {
            id: secondPageId,
            revisionId: ids.revisionId,
            name: "Second",
            sortOrder: 1,
            version: 1,
          },
          baseVersion: null,
        },
        {
          kind: "put_canvas",
          entity: {
            id: secondCanvasId,
            pageId: secondPageId,
            name: "Second paper",
            spaceKind: "paper",
            widthMillimeters: 100,
            heightMillimeters: 100,
            background: null,
            sortOrder: 0,
            version: 1,
          },
          baseVersion: null,
        },
        {
          kind: "put_layer",
          entity: {
            id: secondWorkId,
            name: "Second work",
            visible: true,
            locked: false,
            systemKind: "custom",
            canvasId: secondCanvasId,
            sortOrder: 0,
            version: 1,
          },
          baseVersion: null,
        },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_layer", id: secondWorkId, baseVersion: 1 },
        { kind: "delete_canvas", id: secondCanvasId, baseVersion: 1 },
        { kind: "delete_page", id: secondPageId, baseVersion: 1 },
      ],
    },
  );
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "update_layer",
      { [movableLayerId]: 2 },
      {
        type: "update_layer",
        layerId: movableLayerId,
        patch: { canvasId: secondCanvasId },
      },
      {
        type: "update_layer",
        layerId: movableLayerId,
        patch: { canvasId: samePageCanvasId },
      },
    ),
    (error) =>
      error.code === "P1C01" &&
      /nonempty layer cannot move across pages/i.test(error.message),
  );
});

test("P2 layer payload JSON and stored sort order use strict bounded domains", async () => {
  const ids = await createDocument();
  for (const [field, value] of [
    ["visible", "true"],
    ["locked", 0],
    ["sortOrder", 1.5],
  ]) {
    const layerId = randomUUID();
    const layer = {
      id: layerId,
      name: `Invalid ${field}`,
      visible: true,
      locked: false,
      canvasId: ids.canvasId,
      sortOrder: 2,
      version: 1,
      [field]: value,
    };
    await assert.rejects(
      applyOperation(
        ids.revisionId,
        "add_layer",
        { [layerId]: 1 },
        { type: "add_layer", layer },
        {},
      ),
      (error) =>
        error.code === "P1C01" && /add_layer payload/i.test(error.message),
    );
  }
  for (const [patch, inverse] of [
    [{ visible: "false" }, { visible: true }],
    [{ name: " padded " }, { name: "작업" }],
    [{ sortOrder: -1 }, { sortOrder: 1 }],
    [{ sortOrder: 2.5 }, { sortOrder: 1 }],
  ]) {
    await assert.rejects(
      applyOperation(
        ids.revisionId,
        "update_layer",
        { [ids.workLayerId]: 1 },
        { type: "update_layer", layerId: ids.workLayerId, patch },
        { type: "update_layer", layerId: ids.workLayerId, patch: inverse },
      ),
      (error) =>
        error.code === "P1C01" && /update_layer payload/i.test(error.message),
    );
  }
  await db.exec("reset role");
  const constraint = await db.query(
    `select pg_catalog.pg_get_constraintdef(oid) definition
     from pg_catalog.pg_constraint
     where conname='lukas_drawing_layers_sort_order_nonnegative'`,
  );
  assert.match(constraint.rows[0]?.definition ?? "", /sort_order >= 0/);
});

test("P2 review rejects active objects whose stored page differs from their layer page", async () => {
  const ids = await createDocument();
  const object = circleObject(randomUUID(), ids.workLayerId);
  await addObject(ids, object);
  const other = await createDocument();
  await db.exec(
    "reset role; alter table public.lukas_drawing_objects disable trigger all",
  );
  await db.query(
    "update public.lukas_drawing_objects set page_id=$1 where id=$2",
    [other.pageId, object.id],
  );
  await db.exec("alter table public.lukas_drawing_objects enable trigger all");
  await asActor(OWNER);
  await assert.rejects(
    db.query("select public.lukas_drawing_request_review($1)", [
      ids.revisionId,
    ]),
    (error) =>
      error.code === "P1C01" &&
      /object-layer page ancestry/i.test(error.message),
  );
});

test("P2 structure tombstones restore monotonically and reserve raw IDs across entity kinds", async () => {
  const ids = await createDocument();
  const styleId = randomUUID();
  const style = {
    id: styleId,
    revisionId: ids.revisionId,
    name: "Tombstone style",
    value: STYLE,
    version: 1,
  };
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [{ kind: "put_style", entity: style, baseVersion: null }],
    },
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_style", id: styleId, baseVersion: 1 }],
    },
  );
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    { [styleId]: 1 },
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_style", id: styleId, baseVersion: 1 }],
    },
    {
      type: "mutate_structure",
      actions: [{ kind: "put_style", entity: style, baseVersion: null }],
    },
  );
  const collisionLayerId = randomUUID();
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      {},
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_canvas",
            entity: {
              id: styleId,
              pageId: ids.pageId,
              name: "Raw collision",
              spaceKind: "model",
              widthMillimeters: 100,
              heightMillimeters: 100,
              background: null,
              sortOrder: 1,
              version: 1,
            },
            baseVersion: null,
          },
          {
            kind: "put_layer",
            entity: {
              id: collisionLayerId,
              name: "Collision work",
              visible: true,
              locked: false,
              systemKind: "custom",
              canvasId: styleId,
              sortOrder: 0,
              version: 1,
            },
            baseVersion: null,
          },
        ],
      },
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_layer", id: collisionLayerId, baseVersion: 1 },
          { kind: "delete_canvas", id: styleId, baseVersion: 1 },
        ],
      },
    ),
    (error) =>
      error.code === "P1C01" && /raw ID collision/i.test(error.message),
  );
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [{ kind: "put_style", entity: style, baseVersion: null }],
    },
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_style", id: styleId, baseVersion: 3 }],
    },
  );
  await db.exec("reset role");
  const restored = await db.query(
    "select version from public.lukas_drawing_styles where id=$1",
    [styleId],
  );
  assert.deepEqual(restored.rows, [{ version: 3 }]);
});

test("P2 block compounds must exactly represent their editable source objects", async () => {
  const ids = await createDocument();
  const object = circleObject(randomUUID(), ids.workLayerId);
  const blockId = randomUUID();
  const instanceId = randomUUID();
  await addObject(ids, object);
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      { [object.id]: 1 },
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_object", id: object.id, baseVersion: 1 },
          {
            kind: "put_block",
            entity: {
              id: blockId,
              revisionId: ids.revisionId,
              name: "Mismatched block",
              primitives: [
                {
                  localId: "p1",
                  name: object.name,
                  geometry: { ...object.geometry, radius: 99 },
                  styleId: null,
                  style: object.style,
                },
              ],
              version: 1,
            },
            baseVersion: null,
          },
          {
            kind: "put_block_instance",
            entity: {
              id: instanceId,
              lineageId: instanceId,
              blockId,
              layerId: ids.workLayerId,
              name: "Mismatched instance",
              origin: { x: 0, y: 0 },
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              version: 1,
            },
            baseVersion: null,
          },
        ],
      },
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_block_instance", id: instanceId, baseVersion: 1 },
          { kind: "delete_block", id: blockId, baseVersion: 1 },
          {
            kind: "put_object",
            entity: { ...object, styleId: null },
            baseVersion: null,
          },
        ],
      },
    ),
    (error) => error.code === "P1C01",
  );

  const validBlockId = randomUUID();
  const validInstanceId = randomUUID();
  const exactObject = { ...object, styleId: null };
  const validForward = {
    type: "mutate_structure",
    actions: [
      { kind: "delete_object", id: object.id, baseVersion: 1 },
      {
        kind: "put_block",
        entity: {
          id: validBlockId,
          revisionId: ids.revisionId,
          name: "Exact block",
          primitives: [
            {
              localId: "p1",
              name: object.name,
              geometry: object.geometry,
              styleId: null,
              style: object.style,
            },
          ],
          version: 1,
        },
        baseVersion: null,
      },
      {
        kind: "put_block_instance",
        entity: {
          id: validInstanceId,
          lineageId: validInstanceId,
          blockId: validBlockId,
          layerId: ids.workLayerId,
          name: "Exact instance",
          origin: { x: 0, y: 0 },
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          version: 1,
        },
        baseVersion: null,
      },
    ],
  };
  const validInverse = {
    type: "mutate_structure",
    actions: [
      { kind: "delete_block_instance", id: validInstanceId, baseVersion: 1 },
      { kind: "delete_block", id: validBlockId, baseVersion: 1 },
      { kind: "put_object", entity: exactObject, baseVersion: null },
    ],
  };
  await db.exec("reset role");
  const geometryMatch = await db.query(
    `select private.lukas_drawing_p2_world_geometry_matches(
      $1,$2,$3,0,1,1) matches`,
    [object.geometry, object.geometry, { x: 0, y: 0 }],
  );
  assert.equal(geometryMatch.rows[0].matches, true);
  const compoundMatch = await db.query(
    "select private.lukas_drawing_structure_block_compound_valid($1,$2,$3) matches",
    [validForward.actions, ids.revisionId, PROJECT],
  );
  assert.equal(compoundMatch.rows[0].matches, true);
  await asActor(OWNER);
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    { [object.id]: 1 },
    validForward,
    validInverse,
  );
  await db.exec(
    "reset role; alter table public.lukas_drawing_blocks disable trigger user",
  );
  await db.query(
    `update public.lukas_drawing_blocks
     set primitives=jsonb_set(primitives,'{0,name}',to_jsonb('Corrupted'::text)) where id=$1`,
    [validBlockId],
  );
  await db.exec("alter table public.lukas_drawing_blocks enable trigger user");
  await asActor(OWNER);
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      { [validInstanceId]: 1, [validBlockId]: 1 },
      validInverse,
      {
        ...validForward,
        actions: [
          { ...validForward.actions[0], baseVersion: 3 },
          ...validForward.actions.slice(1),
        ],
      },
    ),
    (error) => error.code === "P1C01",
  );
  await db.exec(
    "reset role; alter table public.lukas_drawing_blocks disable trigger user",
  );
  await db.query(
    "update public.lukas_drawing_blocks set primitives=$2 where id=$1",
    [validBlockId, validForward.actions[1].entity.primitives],
  );
  await db.exec("alter table public.lukas_drawing_blocks enable trigger user");
  await asActor(OWNER);
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    { [validInstanceId]: 1, [validBlockId]: 1 },
    validInverse,
    {
      ...validForward,
      actions: [
        { ...validForward.actions[0], baseVersion: 3 },
        ...validForward.actions.slice(1),
      ],
    },
  );
  await db.exec("reset role");
  const restored = await db.query(
    "select status,version from public.lukas_drawing_objects where id=$1",
    [object.id],
  );
  assert.deepEqual(restored.rows, [{ status: "active", version: 3 }]);
});

test("P2 authority rejects transformed create-block compounds for rectangle and text geometry", async () => {
  for (const geometry of [
    {
      world: {
        type: "rectangle",
        origin: { x: 10, y: 20 },
        width: 20,
        height: 10,
        rotation: 30,
      },
      local: {
        type: "rectangle",
        origin: { x: 0, y: 0 },
        width: 10,
        height: 20,
        rotation: 0,
      },
    },
    {
      world: {
        type: "text",
        origin: { x: 10, y: 20 },
        width: 20,
        text: "Panel\nA",
      },
      local: {
        type: "text",
        origin: { x: 0, y: 0 },
        width: 10,
        text: "Panel\nA",
      },
    },
  ]) {
    const ids = await createDocument();
    const objectId = randomUUID();
    const source = {
      id: objectId,
      name: "Source",
      layerId: ids.workLayerId,
      geometry: geometry.world,
      styleId: null,
      style: STYLE,
      version: 1,
    };
    await addObject(ids, source);
    const blockId = randomUUID();
    const instanceId = randomUUID();
    const block = {
      id: blockId,
      revisionId: ids.revisionId,
      name: "Transformed conversion",
      primitives: [
        {
          localId: "local-a",
          name: source.name,
          geometry: geometry.local,
          styleId: null,
          style: STYLE,
        },
      ],
      version: 1,
    };
    const instance = {
      id: instanceId,
      lineageId: instanceId,
      blockId,
      layerId: ids.workLayerId,
      name: block.name,
      origin: { x: 10, y: 20 },
      rotation: 30,
      scaleX: 2,
      scaleY: 0.5,
      version: 1,
    };
    await assert.rejects(
      applyOperation(
        ids.revisionId,
        "mutate_structure",
        { [objectId]: 1 },
        {
          type: "mutate_structure",
          actions: [
            { kind: "put_block", entity: block, baseVersion: null },
            { kind: "put_block_instance", entity: instance, baseVersion: null },
            { kind: "delete_object", id: objectId, baseVersion: 1 },
          ],
        },
        {
          type: "mutate_structure",
          actions: [
            { kind: "put_object", entity: source, baseVersion: null },
            { kind: "delete_block_instance", id: instanceId, baseVersion: 1 },
            { kind: "delete_block", id: blockId, baseVersion: 1 },
          ],
        },
      ),
      (error) =>
        error.code === "P1C01" && /translation-only/i.test(error.message),
    );
  }
});

test("P2 authority denies block instance delete and restore on an ineligible layer without an operation row", async () => {
  const ids = await createDocument();
  const fallbackLayerId = randomUUID();
  await db.exec("reset role");
  await db.query(
    `insert into public.lukas_drawing_layers(
      id,page_id,canvas_id,revision_id,project_id,name,sort_order,visible,locked,
      system_kind,version,created_by
    )
    select $1,c.page_id,c.id,c.revision_id,c.project_id,'Fallback',99,true,false,
      'custom',1,$2
    from public.lukas_drawing_canvases c
    where c.id=(select canvas_id from public.lukas_drawing_layers where id=$3)`,
    [fallbackLayerId, OWNER, ids.workLayerId],
  );
  await asActor(OWNER);
  const objectId = randomUUID();
  const source = {
    ...circleObject(objectId, ids.workLayerId),
    styleId: null,
  };
  await addObject(ids, source);
  const blockId = randomUUID();
  const instanceId = randomUUID();
  const block = {
    id: blockId,
    revisionId: ids.revisionId,
    name: "Guarded block",
    primitives: [
      {
        localId: "local-a",
        name: source.name,
        geometry: source.geometry,
        styleId: null,
        style: source.style,
      },
    ],
    version: 1,
  };
  const instance = {
    id: instanceId,
    lineageId: instanceId,
    blockId,
    layerId: ids.workLayerId,
    name: block.name,
    origin: { x: 0, y: 0 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  };
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    { [objectId]: 1 },
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_block", entity: block, baseVersion: null },
        { kind: "put_block_instance", entity: instance, baseVersion: null },
        { kind: "delete_object", id: objectId, baseVersion: 1 },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_object", entity: source, baseVersion: null },
        { kind: "delete_block_instance", id: instanceId, baseVersion: 1 },
        { kind: "delete_block", id: blockId, baseVersion: 1 },
      ],
    },
  );
  await db.exec(
    "reset role; alter table public.lukas_drawing_layers disable trigger user",
  );
  await db.query(
    "update public.lukas_drawing_layers set locked=true where id=$1",
    [ids.workLayerId],
  );
  await db.exec("alter table public.lukas_drawing_layers enable trigger user");
  await asActor(OWNER);
  const before = await db.query(
    "select count(*)::int count from public.lukas_drawing_operations where revision_id=$1",
    [ids.revisionId],
  );
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      { [instanceId]: 1 },
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_block_instance", id: instanceId, baseVersion: 1 },
        ],
      },
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_block_instance", entity: instance, baseVersion: null },
        ],
      },
    ),
    (error) =>
      error.code === "P1C01" && /eligible editable layer/i.test(error.message),
  );
  const afterDelete = await db.query(
    "select count(*)::int count from public.lukas_drawing_operations where revision_id=$1",
    [ids.revisionId],
  );
  assert.deepEqual(afterDelete.rows, before.rows);
  const stored = await db.query(
    "select id from public.lukas_drawing_block_instances where id=$1",
    [instanceId],
  );
  assert.equal(stored.rows.length, 1);

  await db.exec(
    "reset role; alter table public.lukas_drawing_layers disable trigger user",
  );
  await db.query(
    "update public.lukas_drawing_layers set locked=false where id=$1",
    [ids.workLayerId],
  );
  await db.exec("alter table public.lukas_drawing_layers enable trigger user");
  await asActor(OWNER);
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    { [instanceId]: 1 },
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_block_instance", id: instanceId, baseVersion: 1 },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_block_instance", entity: instance, baseVersion: null },
      ],
    },
  );
  await db.exec(
    "reset role; alter table public.lukas_drawing_layers disable trigger user",
  );
  await db.query(
    "update public.lukas_drawing_layers set visible=false where id=$1",
    [ids.workLayerId],
  );
  await db.exec("alter table public.lukas_drawing_layers enable trigger user");
  await asActor(OWNER);
  const beforeRestore = await db.query(
    "select count(*)::int count from public.lukas_drawing_operations where revision_id=$1",
    [ids.revisionId],
  );
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      {},
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_block_instance", entity: instance, baseVersion: null },
        ],
      },
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_block_instance", id: instanceId, baseVersion: 3 },
        ],
      },
    ),
    (error) =>
      error.code === "P1C01" && /eligible editable layer/i.test(error.message),
  );
  const afterRestore = await db.query(
    "select count(*)::int count from public.lukas_drawing_operations where revision_id=$1",
    [ids.revisionId],
  );
  assert.deepEqual(afterRestore.rows, beforeRestore.rows);
  const absent = await db.query(
    "select id from public.lukas_drawing_block_instances where id=$1",
    [instanceId],
  );
  assert.equal(absent.rows.length, 0);
});

test("P2 block instance deletion returns the exact stored result when retried after the row is absent", async () => {
  const ids = await createDocument();
  const { instance } = await createPersistedBlockInstance(
    ids,
    "Idempotent placement",
  );
  const clientOperationId = randomUUID();
  const baseVersions = { [instance.id]: 1 };
  const forward = {
    type: "mutate_structure",
    actions: [
      { kind: "delete_block_instance", id: instance.id, baseVersion: 1 },
    ],
  };
  const inverse = {
    type: "mutate_structure",
    actions: [
      { kind: "put_block_instance", entity: instance, baseVersion: null },
    ],
  };
  const first = await applyOperationWithId(
    ids.revisionId,
    clientOperationId,
    "mutate_structure",
    baseVersions,
    forward,
    inverse,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int count from public.lukas_drawing_block_instances where id=$1",
        [instance.id],
      )
    ).rows[0].count,
    0,
  );

  const retried = await applyOperationWithId(
    ids.revisionId,
    clientOperationId,
    "mutate_structure",
    baseVersions,
    forward,
    inverse,
  );
  assert.deepEqual(retried, first);
  assert.equal(
    (
      await db.query(
        `select count(*)::int count from public.lukas_drawing_operations
         where revision_id=$1 and client_operation_id=$2`,
        [ids.revisionId, clientOperationId],
      )
    ).rows[0].count,
    1,
  );
});

test("P2 block idempotency key reuse reports binding conflict before missing target state", async () => {
  const ids = await createDocument();
  const { instance } = await createPersistedBlockInstance(
    ids,
    "Bound placement",
  );
  const clientOperationId = randomUUID();
  const forward = {
    type: "mutate_structure",
    actions: [
      { kind: "delete_block_instance", id: instance.id, baseVersion: 1 },
    ],
  };
  const inverse = {
    type: "mutate_structure",
    actions: [
      { kind: "put_block_instance", entity: instance, baseVersion: null },
    ],
  };
  await applyOperationWithId(
    ids.revisionId,
    clientOperationId,
    "mutate_structure",
    { [instance.id]: 1 },
    forward,
    inverse,
  );

  await assert.rejects(
    applyOperationWithId(
      ids.revisionId,
      clientOperationId,
      "mutate_structure",
      { [instance.id]: 2 },
      forward,
      inverse,
    ),
    (error) =>
      error.code === "P1C01" &&
      /idempotency key does not match the stored request/i.test(error.message),
  );
});

test("P2 block wrapper declares the authoritative revision-first concurrent lock order", async () => {
  const sql = await p2BlockExactnessMigration();
  const wrapper = sql.slice(
    sql.indexOf(
      "create or replace function private.lukas_drawing_apply_operation(",
    ),
  );
  const revisionQuery = wrapper.indexOf(
    "from public.lukas_drawing_revisions r",
  );
  const revisionLock = wrapper.indexOf("for update", revisionQuery);
  const idempotencyQuery = wrapper.indexOf(
    "from public.lukas_drawing_operations o",
  );
  const instancePreflight = wrapper.indexOf(
    "from public.lukas_drawing_block_instances i",
  );
  assert.ok(revisionQuery >= 0);
  assert.ok(revisionLock > revisionQuery);
  assert.ok(idempotencyQuery > revisionLock);
  assert.ok(instancePreflight > idempotencyQuery);
  assert.match(
    wrapper,
    /jsonb_array_elements\(p_forward->'actions'\)[\s\S]*order by value->>'id'[\s\S]*from public\.lukas_drawing_block_instances i[\s\S]*for update/,
  );
});

test("P2 review writes a deterministic complete v2 snapshot and freezes every P2 child", async () => {
  const ids = await createDocument();
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await db.exec("reset role");
  const snapshot = await db.query(
    `select canonical_json "canonicalJson",sha256,
      encode(extensions.digest(convert_to(canonical_json::text,'UTF8'),'sha256'),'hex') recomputed
     from public.lukas_drawing_snapshots where id=$1`,
    [review.rows[0].result.snapshotId],
  );
  assert.equal(snapshot.rows[0].canonicalJson.schemaVersion, 2);
  for (const key of [
    "pages",
    "canvases",
    "layers",
    "objects",
    "styles",
    "blocks",
    "blockInstances",
    "propertySchemas",
    "propertyValues",
    "tables",
    "issues",
  ])
    assert.ok(Array.isArray(snapshot.rows[0].canonicalJson[key]), key);
  assert.equal(snapshot.rows[0].sha256, snapshot.rows[0].recomputed);
  await asActor(OWNER);
  await assert.rejects(
    applyOperation(
      ids.revisionId,
      "mutate_structure",
      {},
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_style",
            entity: {
              id: randomUUID(),
              revisionId: ids.revisionId,
              name: "Late",
              value: STYLE,
              version: 1,
            },
            baseVersion: null,
          },
        ],
      },
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_style", id: randomUUID(), baseVersion: 1 }],
      },
    ),
    (error) => error.code === "P1C01",
  );
});

test("P2 approved template clone generates fresh identities inside the source project", async () => {
  const ids = await createDocument();
  const unrelatedSourceId = randomUUID();
  const unrelatedSourceSha = "b".repeat(64);
  const object = circleObject(randomUUID(), ids.workLayerId, {
    name: unrelatedSourceSha,
  });
  const tableId = randomUUID();
  const columnId = randomUUID();
  const rowId = randomUUID();
  await addObject(ids, object);
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [
        {
          kind: "put_table",
          entity: {
            id: tableId,
            revisionId: ids.revisionId,
            name: "Template table",
            columns: [
              {
                id: columnId,
                name: "Note",
                kind: "text",
                propertySchemaId: null,
              },
            ],
            rows: [
              {
                id: rowId,
                objectId: object.id,
                blockInstanceId: null,
                cells: { [columnId]: "kept" },
              },
            ],
            version: 1,
          },
          baseVersion: null,
        },
      ],
    },
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_table", id: tableId, baseVersion: 1 }],
    },
  );
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    "select public.lukas_drawing_record_revision_decision($1,$2,$3,'approved','template')",
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await db.exec("reset role");
  await db.query(
    `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256)
     values ($1,$2,$3,'pdf',$4)`,
    [unrelatedSourceId, PROJECT, OWNER, unrelatedSourceSha],
  );
  await asActor(OWNER);
  await assert.rejects(
    db.query("select public.lukas_drawing_create_from_template($1,$2,$3,$4)", [
      ids.revisionId,
      "Unrelated source probe",
      unrelatedSourceId,
      randomUUID(),
    ]),
    (error) =>
      error.code === "P1R01" &&
      error.message === "Drawing template target is unavailable",
  );
  const cloned = await db.query(
    "select public.lukas_drawing_create_from_template($1,$2,null,$3) result",
    [ids.revisionId, "Approved clone", randomUUID()],
  );
  const clone = cloned.rows[0].result;
  assert.notEqual(clone.documentId, ids.documentId);
  assert.notEqual(clone.revisionId, ids.revisionId);
  await db.exec("reset role");
  const copied = await db.query(
    `select id,lineage_id "lineageId",revision_id "revisionId"
     from public.lukas_drawing_objects where revision_id=$1 and status='active'`,
    [clone.revisionId],
  );
  assert.equal(copied.rows.length, 1);
  assert.notEqual(copied.rows[0].id, object.id);
  assert.equal(copied.rows[0].lineageId, object.id);
  assert.equal(copied.rows[0].revisionId, clone.revisionId);
  const tables = await db.query(
    `select revision_id "revisionId",columns_json "columns",rows_json "rows"
     from public.lukas_drawing_tables where revision_id in ($1,$2) order by revision_id`,
    [ids.revisionId, clone.revisionId],
  );
  const sourceTable = tables.rows.find(
    (table) => table.revisionId === ids.revisionId,
  );
  const clonedTable = tables.rows.find(
    (table) => table.revisionId === clone.revisionId,
  );
  assert.notEqual(clonedTable.columns[0].id, sourceTable.columns[0].id);
  assert.notEqual(clonedTable.rows[0].id, sourceTable.rows[0].id);
  assert.equal(clonedTable.rows[0].cells[clonedTable.columns[0].id], "kept");
});

test("P2 explicit-source template clones keep documents source-free and preserve frozen canvas anchors", async () => {
  const sourceFileId = randomUUID();
  const sourceSha = "d".repeat(64);
  await db.exec("reset role");
  await db.query(
    `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256,immutable)
     values($1,$2,$3,'pdf',$4,true)`,
    [sourceFileId, PROJECT, OWNER, sourceSha],
  );
  await asActor(OWNER);
  const created = await db.query(
    "select public.lukas_drawing_create_document($1,$2,'Explicit source template',false) result",
    [PROJECT, sourceFileId],
  );
  const source = created.rows[0].result;
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [source.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    "select public.lukas_drawing_record_revision_decision($1,$2,$3,'approved','source template')",
    [
      source.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  const first = await db.query(
    "select public.lukas_drawing_create_from_template($1,'Explicit clone 1',$2,$3) result",
    [source.revisionId, sourceFileId, randomUUID()],
  );
  const second = await db.query(
    "select public.lukas_drawing_create_from_template($1,'Explicit clone 2',$2,$3) result",
    [source.revisionId, sourceFileId, randomUUID()],
  );
  await db.exec("reset role");
  const documents = await db.query(
    `select id,source_file_id "sourceFileId",source_sha256 "sourceSha256"
     from public.lukas_drawing_documents where id in ($1,$2) order by id`,
    [first.rows[0].result.documentId, second.rows[0].result.documentId],
  );
  assert.equal(documents.rows.length, 2);
  assert.ok(
    documents.rows.every(
      (document) =>
        document.sourceFileId === null && document.sourceSha256 === null,
    ),
  );
  const anchors = await db.query(
    `select revision_id "revisionId",background_source_file_id "sourceFileId",
      background_source_sha256 "sourceSha256"
     from public.lukas_drawing_canvases where revision_id in ($1,$2) order by revision_id`,
    [first.rows[0].result.revisionId, second.rows[0].result.revisionId],
  );
  assert.equal(anchors.rows.length, 2);
  assert.ok(
    anchors.rows.every(
      (anchor) =>
        anchor.sourceFileId === sourceFileId &&
        anchor.sourceSha256 === sourceSha,
    ),
  );
});

test("cloned block-instance lineage survives delete and undo while forged action lineage is rejected atomically", async () => {
  const source = await createDocument("Instance lineage template");
  const persisted = await createPersistedBlockInstance(
    source,
    "Lineage placement",
  );
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [source.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    "select public.lukas_drawing_record_revision_decision($1,$2,$3,'approved','lineage')",
    [
      source.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  const cloned = await db.query(
    "select public.lukas_drawing_create_from_template($1,'Lineage clone',null,$2) result",
    [source.revisionId, randomUUID()],
  );
  const clone = cloned.rows[0].result;
  await db.exec("reset role");
  const copied = await db.query(
    `select id,lineage_id "lineageId",block_id "blockId",layer_id "layerId",
      name,origin,rotation::float8 rotation,scale_x::float8 "scaleX",
      scale_y::float8 "scaleY",version
     from public.lukas_drawing_block_instances where revision_id=$1`,
    [clone.revisionId],
  );
  assert.equal(copied.rows.length, 1);
  const instance = copied.rows[0];
  assert.notEqual(instance.id, instance.lineageId);
  assert.equal(instance.lineageId, persisted.instance.lineageId);

  await asActor(OWNER);
  for (const lineage of [undefined, randomUUID()]) {
    const freshId = randomUUID();
    const clientOperationId = randomUUID();
    const entity = {
      ...instance,
      id: freshId,
      name: "Forged lineage",
      version: 1,
    };
    if (lineage === undefined) delete entity.lineageId;
    else entity.lineageId = lineage;
    await assert.rejects(
      applyOperationWithId(
        clone.revisionId,
        clientOperationId,
        "mutate_structure",
        {},
        {
          type: "mutate_structure",
          actions: [{ kind: "put_block_instance", entity, baseVersion: null }],
        },
        {
          type: "mutate_structure",
          actions: [
            { kind: "delete_block_instance", id: freshId, baseVersion: 1 },
          ],
        },
      ),
      (error) => error.code === "P1C01",
    );
    await db.exec("reset role");
    const sideEffects = await db.query(
      `select
        (select count(*)::int from public.lukas_drawing_block_instances where id=$1) instances,
        (select count(*)::int from public.lukas_drawing_operations where revision_id=$2 and client_operation_id=$3) operations`,
      [freshId, clone.revisionId, clientOperationId],
    );
    assert.deepEqual(sideEffects.rows[0], { instances: 0, operations: 0 });
    await asActor(OWNER);
  }

  const deleteForward = {
    type: "mutate_structure",
    actions: [
      { kind: "delete_block_instance", id: instance.id, baseVersion: 1 },
    ],
  };
  const restoreForward = {
    type: "mutate_structure",
    actions: [
      { kind: "put_block_instance", entity: instance, baseVersion: null },
    ],
  };
  await applyOperation(
    clone.revisionId,
    "mutate_structure",
    { [instance.id]: 1 },
    deleteForward,
    restoreForward,
  );
  await applyOperation(
    clone.revisionId,
    "mutate_structure",
    {},
    restoreForward,
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_block_instance", id: instance.id, baseVersion: 3 },
      ],
    },
  );
  await db.exec("reset role");
  const restored = await db.query(
    `select lineage_id "lineageId",version
     from public.lukas_drawing_block_instances where id=$1`,
    [instance.id],
  );
  assert.deepEqual(restored.rows, [
    { lineageId: instance.lineageId, version: 3 },
  ]);

  await asActor(OWNER);
  const mismatchedClientOperationId = randomUUID();
  await assert.rejects(
    applyOperationWithId(
      clone.revisionId,
      mismatchedClientOperationId,
      "mutate_structure",
      { [instance.id]: 3 },
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_block_instance",
            entity: { ...instance, lineageId: randomUUID(), version: 3 },
            baseVersion: 3,
          },
        ],
      },
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_block_instance",
            entity: { ...instance, version: 3 },
            baseVersion: 4,
          },
        ],
      },
    ),
    (error) => error.code === "P1C01",
  );
  await db.exec("reset role");
  const unchanged = await db.query(
    `select i.lineage_id "lineageId",i.version,
      (select count(*)::int from public.lukas_drawing_operations o
       where o.revision_id=i.revision_id and o.client_operation_id=$2) operations
     from public.lukas_drawing_block_instances i where i.id=$1`,
    [instance.id, mismatchedClientOperationId],
  );
  assert.deepEqual(unchanged.rows, [
    { lineageId: instance.lineageId, version: 3, operations: 0 },
  ]);
});

test("template clone request IDs return one destination and bind their payload", async () => {
  const source = await createDocument("Idempotent template");
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [source.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    "select public.lukas_drawing_record_revision_decision($1,$2,$3,'approved','template')",
    [
      source.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  const requestId = randomUUID();
  const results = await Promise.all([
    db.query(
      "select public.lukas_drawing_create_from_template($1,$2,null,$3) result",
      [source.revisionId, "Retry clone", requestId],
    ),
    db.query(
      "select public.lukas_drawing_create_from_template($1,$2,null,$3) result",
      [source.revisionId, "Retry clone", requestId],
    ),
  ]);
  assert.equal(
    results[0].rows[0].result.documentId,
    results[1].rows[0].result.documentId,
  );
  await assert.rejects(
    db.query(
      "select public.lukas_drawing_create_from_template($1,$2,null,$3)",
      [source.revisionId, "Different title", requestId],
    ),
    (error) => error.code === "P1C01",
  );
  await db.exec("reset role");
  const created = await db.query(
    `select count(*)::int count
     from private.lukas_drawing_template_clone_requests
     where actor_id=$1 and client_request_id=$2`,
    [OWNER, requestId],
  );
  assert.equal(created.rows[0].count, 1);
});

test("template clone bindings cannot be forged through document rows and never create ledger authority", async () => {
  const plain = await createDocument("Unbound document");
  const updateRequestId = randomUUID();
  const insertRequestId = randomUUID();
  const forgedHash = "f".repeat(64);
  await db.exec("reset role; begin");
  let updateError = null;
  let insertError = null;
  try {
    await db.exec("savepoint forged_update");
    try {
      await db.query(
        `update public.lukas_drawing_documents
         set clone_requested_by=$1,clone_request_id=$2,clone_request_hash=$3
         where id=$4`,
        [OWNER, updateRequestId, forgedHash, plain.documentId],
      );
    } catch (error) {
      updateError = error;
    }
    await db.exec("rollback to savepoint forged_update");

    await db.exec("savepoint forged_insert");
    try {
      await db.query(
        `insert into public.lukas_drawing_documents(
          project_id,title,created_by,clone_requested_by,clone_request_id,clone_request_hash
        ) values($1,'Forged clone binding',$2,$2,$3,$4)`,
        [PROJECT, OWNER, insertRequestId, forgedHash],
      );
    } catch (error) {
      insertError = error;
    }
    await db.exec("rollback to savepoint forged_insert");

    const ledger = await db.query(
      `select count(*)::int count
       from private.lukas_drawing_template_clone_requests
       where actor_id=$1 and client_request_id in ($2,$3)`,
      [OWNER, updateRequestId, insertRequestId],
    );
    assert.equal(updateError?.code, "P1C01");
    assert.equal(insertError?.code, "P1C01");
    assert.equal(ledger.rows[0].count, 0);
  } finally {
    await db.exec("rollback");
  }
});

test("template clone ledger rows are append-only and only the public four-argument RPC is executable", async () => {
  const source = await createDocument("Append-only ledger template");
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [source.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    "select public.lukas_drawing_record_revision_decision($1,$2,$3,'approved','ledger')",
    [
      source.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  const requestId = randomUUID();
  await db.query(
    "select public.lukas_drawing_create_from_template($1,'Ledger clone',null,$2)",
    [source.revisionId, requestId],
  );

  await db.exec("reset role; begin");
  let updateError = null;
  let deleteError = null;
  try {
    await db.exec("savepoint mutate_ledger");
    try {
      await db.query(
        `update private.lukas_drawing_template_clone_requests
         set request_hash=$1 where actor_id=$2 and client_request_id=$3`,
        ["e".repeat(64), OWNER, requestId],
      );
    } catch (error) {
      updateError = error;
    }
    await db.exec("rollback to savepoint mutate_ledger");
    await db.exec("savepoint delete_ledger");
    try {
      await db.query(
        `delete from private.lukas_drawing_template_clone_requests
         where actor_id=$1 and client_request_id=$2`,
        [OWNER, requestId],
      );
    } catch (error) {
      deleteError = error;
    }
    await db.exec("rollback to savepoint delete_ledger");
    assert.equal(updateError?.code, "P1C01");
    assert.equal(deleteError?.code, "P1C01");
  } finally {
    await db.exec("rollback");
  }

  const privileges = await db.query(
    `select
      has_function_privilege('authenticated','public.lukas_drawing_create_from_template(uuid,text,uuid,uuid)','execute') public_four,
      has_function_privilege('authenticated','public.lukas_drawing_create_from_template(uuid,text,uuid)','execute') public_three,
      has_function_privilege('authenticated','private.lukas_drawing_create_from_template(uuid,text,uuid,uuid)','execute') private_four,
      has_function_privilege('authenticated','private.lukas_drawing_create_from_template(uuid,text,uuid)','execute') private_three,
      has_function_privilege('authenticated','private.lukas_drawing_clone_v1_snapshot(jsonb,uuid,uuid,text,uuid)','execute') private_v1`,
  );
  assert.deepEqual(privileges.rows[0], {
    public_four: true,
    public_three: false,
    private_four: false,
    private_three: false,
    private_v1: false,
  });
});

test("template clone rejects corrupt snapshots atomically and makes viewer denial non-enumerating", async () => {
  const source = await createDocument("Corrupt snapshot template");
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [source.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    "select public.lukas_drawing_record_revision_decision($1,$2,$3,'approved','template')",
    [
      source.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await db.exec("reset role");
  const before = await db.query(
    `select
      (select count(*)::int from public.lukas_drawing_documents) documents,
      (select count(*)::int from public.lukas_drawing_pages where revision_id=$1) pages,
      (select count(*)::int from public.lukas_drawing_layers where revision_id=$1) layers`,
    [source.revisionId],
  );
  await db.exec(
    "alter table public.lukas_drawing_snapshots disable trigger user",
  );
  await db.query(
    `update public.lukas_drawing_snapshots
     set canonical_json=jsonb_set(canonical_json,'{schemaVersion}','99'::jsonb)
     where revision_id=$1`,
    [source.revisionId],
  );
  await db.exec(
    "alter table public.lukas_drawing_snapshots enable trigger user",
  );

  await asActor(OWNER);
  await assert.rejects(
    db.query(
      "select public.lukas_drawing_create_from_template($1,'must not clone',null,$2)",
      [source.revisionId, randomUUID()],
    ),
    (error) =>
      error.code === "P1R01" &&
      error.message === "Drawing template target is unavailable",
  );
  await db.exec("reset role");
  const after = await db.query(
    `select
      (select count(*)::int from public.lukas_drawing_documents) documents,
      (select count(*)::int from public.lukas_drawing_pages where revision_id=$1) pages,
      (select count(*)::int from public.lukas_drawing_layers where revision_id=$1) layers`,
    [source.revisionId],
  );
  assert.deepEqual(after.rows, before.rows);

  await db.query(
    `insert into public.lukas_qto_project_members(project_id,user_id,role)
     values ($1,$2,'viewer') on conflict (project_id,user_id) do update set role='viewer'`,
    [PROJECT, OUTSIDER],
  );
  await asActor(OUTSIDER);
  const denied = [];
  for (const revisionId of [source.revisionId, randomUUID()]) {
    try {
      await db.query(
        "select public.lukas_drawing_create_from_template($1,'viewer probe',null,$2)",
        [revisionId, randomUUID()],
      );
      assert.fail("expected unavailable template");
    } catch (error) {
      denied.push({ code: error.code, message: error.message });
    }
  }
  assert.deepEqual(denied, [
    { code: "P1R01", message: "Drawing template target is unavailable" },
    { code: "P1R01", message: "Drawing template target is unavailable" },
  ]);
});

test("P2 tables deny authenticated direct DML and cascade only through a draft parent", async () => {
  const ids = await createDocument();
  const styleId = randomUUID();
  await assert.rejects(
    db.query(
      `insert into public.lukas_drawing_styles(
        id,revision_id,project_id,name,value,version,created_by
      ) values ($1,$2,$3,'Direct style',$4,1,$5)`,
      [styleId, ids.revisionId, PROJECT, STYLE, OWNER],
    ),
    /permission denied/i,
  );
  for (const table of [
    "lukas_drawing_canvases",
    "lukas_drawing_styles",
    "lukas_drawing_blocks",
    "lukas_drawing_block_instances",
    "lukas_drawing_property_schemas",
    "lukas_drawing_property_values",
    "lukas_drawing_tables",
  ]) {
    const privileges = await db.query(
      `select has_table_privilege('authenticated',$1,'INSERT,UPDATE,DELETE') allowed`,
      [`public.${table}`],
    );
    assert.equal(privileges.rows[0].allowed, false, table);
  }
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    {},
    {
      type: "mutate_structure",
      actions: [
        {
          kind: "put_style",
          entity: {
            id: styleId,
            revisionId: ids.revisionId,
            name: "Cascade style",
            value: STYLE,
            version: 1,
          },
          baseVersion: null,
        },
      ],
    },
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_style", id: styleId, baseVersion: 1 }],
    },
  );
  await db.query("delete from public.lukas_drawing_documents where id=$1", [
    ids.documentId,
  ]);
  await db.exec("reset role");
  const remaining = await db.query(
    `select
      (select count(*)::int from public.lukas_drawing_canvases where revision_id=$1) canvases,
      (select count(*)::int from public.lukas_drawing_styles where revision_id=$1) styles`,
    [ids.revisionId],
  );
  assert.deepEqual(remaining.rows[0], { canvases: 0, styles: 0 });
});

test("P2 template lookup makes foreign approved and random revisions uniformly unavailable", async () => {
  const foreignProject = randomUUID();
  await db.exec("reset role");
  await db.query(
    "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
    [foreignProject, OUTSIDER],
  );
  await db.query(
    "insert into public.lukas_qto_project_members(project_id,user_id,role) values ($1,$2,'reviewer')",
    [foreignProject, REVIEWER],
  );
  await asActor(OUTSIDER);
  const created = await db.query(
    "select public.lukas_drawing_create_document($1,null,$2,true) result",
    [foreignProject, "Foreign approved template"],
  );
  const revisionId = created.rows[0].result.revisionId;
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    "select public.lukas_drawing_record_revision_decision($1,$2,$3,'approved','foreign')",
    [
      revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(EDITOR);
  const errors = [];
  for (const candidate of [revisionId, randomUUID()]) {
    try {
      await db.query(
        "select public.lukas_drawing_create_from_template($1,'probe',null,$2)",
        [candidate, randomUUID()],
      );
      assert.fail("expected unavailable template");
    } catch (error) {
      errors.push({ code: error.code, message: error.message });
    }
  }
  assert.deepEqual(errors, [
    { code: "P1R01", message: "Drawing template target is unavailable" },
    { code: "P1R01", message: "Drawing template target is unavailable" },
  ]);
});

test("final ledger upgrade ignores clone bindings forged before its guard", async () => {
  const upgradeDb = new PGlite({ extensions: { pgcrypto } });
  try {
    await upgradeDb.exec(foundationSql);
    await upgradeDb.exec(await migration());
    await upgradeDb.exec(await upgradeMigration());
    await upgradeDb.exec(await issueLinkMigration());
    await upgradeDb.exec(await releaseHardeningMigration());
    await upgradeDb.exec(await p2Migration());
    await upgradeDb.exec(await p2LegacyLayerBackfillMigration());
    await upgradeDb.exec(await p2HardeningMigration());
    await upgradeDb.exec(await p2CompatibilityMigration());
    await upgradeDb.exec(await p2HistoryReconciliationMigration());
    await upgradeDb.exec(await p2NavigationHardeningMigration());
    await upgradeDb.exec(await p2StyleGuardSqlstateMigration());
    await upgradeDb.exec(await p2BlockExactnessMigration());
    await upgradeDb.exec(await p2TemplateSnapshotGuardMigration());
    await upgradeDb.exec(await p2TemplateCloneIdempotencyMigration());
    await upgradeDb.exec(await p2BlockInstanceLineageMigration());
    await upgradeDb.exec(await p2TemplateSnapshotAuthorityMigration());
    await upgradeDb.exec(await p2LegacyTemplateSnapshotCloneMigration());
    await upgradeDb.exec(await p2LineageSnapshotWriterMigration());
    await upgradeDb.exec(await p2TemplateCloneSecurityMigration());
    await upgradeDb.query("insert into auth.users(id) values ($1),($2),($3)", [
      OWNER,
      REVIEWER,
      EDITOR,
    ]);
    await upgradeDb.query(
      "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
      [PROJECT, OWNER],
    );
    await upgradeDb.query(
      `insert into public.lukas_qto_project_members(project_id,user_id,role)
       values ($1,$2,'reviewer'),($1,$3,'estimator')`,
      [PROJECT, REVIEWER, EDITOR],
    );

    await upgradeDb.exec("set role authenticated");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    const source = await upgradeDb.query(
      "select public.lukas_drawing_create_document($1,null,$2,true) result",
      [PROJECT, "Approved upgrade template"],
    );
    const review = await upgradeDb.query(
      "select public.lukas_drawing_request_review($1) result",
      [source.rows[0].result.revisionId],
    );
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [REVIEWER],
    );
    await upgradeDb.query(
      "select public.lukas_drawing_record_revision_decision($1,$2,$3,'approved','upgrade')",
      [
        source.rows[0].result.revisionId,
        review.rows[0].result.subjectVersion,
        review.rows[0].result.snapshotSha256,
      ],
    );
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [EDITOR],
    );
    const forged = await upgradeDb.query(
      "select public.lukas_drawing_create_document($1,null,$2,true) result",
      [PROJECT, "Unbound editor draft"],
    );
    const requestId = randomUUID();
    const cloneTitle = "Post-upgrade clone";
    await upgradeDb.exec("reset role");
    const requestHash = await upgradeDb.query(
      `select pg_catalog.encode(extensions.digest(
         pg_catalog.convert_to(pg_catalog.jsonb_build_object(
           'sourceRevisionId',$1::uuid,'title',pg_catalog.btrim($2::text),
           'sourceFileId',null::uuid
         )::text,'UTF8'),'sha256'),'hex') hash`,
      [source.rows[0].result.revisionId, cloneTitle],
    );
    await upgradeDb.exec("set role authenticated");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [EDITOR],
    );
    await upgradeDb.query(
      `update public.lukas_drawing_documents
       set clone_requested_by=$1,clone_request_id=$2,clone_request_hash=$3
       where id=$4`,
      [
        EDITOR,
        requestId,
        requestHash.rows[0].hash,
        forged.rows[0].result.documentId,
      ],
    );
    await upgradeDb.exec("reset role");

    await upgradeDb.exec(await p2TemplateCloneFinalLedgerMigration());
    const beforeClone = await upgradeDb.query(
      `select count(*)::int count
       from private.lukas_drawing_template_clone_requests
       where actor_id=$1 and client_request_id=$2`,
      [EDITOR, requestId],
    );
    await upgradeDb.exec("set role authenticated");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [EDITOR],
    );
    const clone = await upgradeDb.query(
      "select public.lukas_drawing_create_from_template($1,$2,null,$3) result",
      [source.rows[0].result.revisionId, cloneTitle, requestId],
    );
    await upgradeDb.exec("reset role");
    const ledger = await upgradeDb.query(
      `select document_id "documentId",revision_id "revisionId"
       from private.lukas_drawing_template_clone_requests
       where actor_id=$1 and client_request_id=$2`,
      [EDITOR, requestId],
    );

    assert.deepEqual(
      {
        importedRows: beforeClone.rows[0].count,
        returnedForgedDocument:
          clone.rows[0].result.documentId === forged.rows[0].result.documentId,
        returnedForgedRevision:
          clone.rows[0].result.revisionId === forged.rows[0].result.revisionId,
        ledger: ledger.rows,
      },
      {
        importedRows: 0,
        returnedForgedDocument: false,
        returnedForgedRevision: false,
        ledger: [
          {
            documentId: clone.rows[0].result.documentId,
            revisionId: clone.rows[0].result.revisionId,
          },
        ],
      },
    );
  } finally {
    await upgradeDb.close();
  }
});

test("P2 upgrade leaves an approved v1 snapshot byte-stable and promotes its clone with a default canvas", async () => {
  const upgradeDb = new PGlite({ extensions: { pgcrypto } });
  try {
    await upgradeDb.exec(foundationSql);
    await upgradeDb.exec(await migration());
    await upgradeDb.exec(await upgradeMigration());
    await upgradeDb.exec(await issueLinkMigration());
    await upgradeDb.exec(await releaseHardeningMigration());
    await upgradeDb.query("insert into auth.users(id) values ($1),($2)", [
      OWNER,
      REVIEWER,
    ]);
    await upgradeDb.query(
      "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
      [PROJECT, OWNER],
    );
    await upgradeDb.query(
      "insert into public.lukas_qto_project_members(project_id,user_id,role) values ($1,$2,'reviewer')",
      [PROJECT, REVIEWER],
    );
    await upgradeDb.query(
      `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256,immutable)
       values($1,$2,$3,'pdf',$4,true)`,
      [PDF, PROJECT, OWNER, PDF_SHA],
    );
    await upgradeDb.exec("set role authenticated");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    const created = await upgradeDb.query(
      "select public.lukas_drawing_create_document($1,$2,'v1 template',false) result",
      [PROJECT, PDF],
    );
    const source = created.rows[0].result;
    const review = await upgradeDb.query(
      "select public.lukas_drawing_request_review($1) result",
      [source.revisionId],
    );
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [REVIEWER],
    );
    await upgradeDb.query(
      "select public.lukas_drawing_record_revision_decision($1,$2,$3,'approved','v1')",
      [
        source.revisionId,
        review.rows[0].result.subjectVersion,
        review.rows[0].result.snapshotSha256,
      ],
    );
    await upgradeDb.exec("reset role");
    const before = await upgradeDb.query(
      "select canonical_json,sha256 from public.lukas_drawing_snapshots where revision_id=$1",
      [source.revisionId],
    );
    await upgradeDb.exec(await p2Migration());
    await upgradeDb.exec(await p2LegacyLayerBackfillMigration());
    await upgradeDb.exec(await p2HardeningMigration());
    await upgradeDb.exec(await p2CompatibilityMigration());
    await upgradeDb.exec(await p2HistoryReconciliationMigration());
    await upgradeDb.exec(await p2TemplateSnapshotGuardMigration());
    await upgradeDb.exec(await p2TemplateCloneIdempotencyMigration());
    await upgradeDb.exec(await p2BlockInstanceLineageMigration());
    await upgradeDb.exec(await p2TemplateSnapshotAuthorityMigration());
    await upgradeDb.exec(await p2LegacyTemplateSnapshotCloneMigration());
    await upgradeDb.exec(await p2LineageSnapshotWriterMigration());
    await upgradeDb.exec(await p2TemplateCloneSecurityMigration());
    await upgradeDb.exec(await p2TemplateCloneFinalLedgerMigration());
    const afterUpgrade = await upgradeDb.query(
      "select canonical_json,sha256,schema_version from public.lukas_drawing_snapshots where revision_id=$1",
      [source.revisionId],
    );
    assert.deepEqual(afterUpgrade.rows[0], {
      ...before.rows[0],
      schema_version: 1,
    });
    await upgradeDb.exec("set role authenticated");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    const blankClone = await upgradeDb.query(
      "select public.lukas_drawing_create_from_template($1,'v1 promoted',null,$2) result",
      [source.revisionId, randomUUID()],
    );
    const sourcedClone = await upgradeDb.query(
      "select public.lukas_drawing_create_from_template($1,'v1 promoted source',$2,$3) result",
      [source.revisionId, PDF, randomUUID()],
    );
    await upgradeDb.exec("reset role");
    const promoted = await upgradeDb.query(
      `select revision_id "revisionId",background_source_file_id "sourceFileId",
        background_source_sha256 "sourceSha256",background_pdf_page "pdfPageNumber",
        calibration
       from public.lukas_drawing_canvases
       where revision_id in ($1,$2) and space_kind='paper' and sort_order=0
       order by revision_id`,
      [
        blankClone.rows[0].result.revisionId,
        sourcedClone.rows[0].result.revisionId,
      ],
    );
    assert.equal(promoted.rows.length, 2);
    const blankCanvas = promoted.rows.find(
      (row) => row.revisionId === blankClone.rows[0].result.revisionId,
    );
    const sourcedCanvas = promoted.rows.find(
      (row) => row.revisionId === sourcedClone.rows[0].result.revisionId,
    );
    assert.deepEqual(blankCanvas, {
      revisionId: blankClone.rows[0].result.revisionId,
      sourceFileId: null,
      sourceSha256: null,
      pdfPageNumber: null,
      calibration: null,
    });
    assert.deepEqual(sourcedCanvas, {
      revisionId: sourcedClone.rows[0].result.revisionId,
      sourceFileId: PDF,
      sourceSha256: PDF_SHA,
      pdfPageNumber: 1,
      calibration: null,
    });
    const cloneDocuments = await upgradeDb.query(
      `select source_file_id "sourceFileId",source_sha256 "sourceSha256"
       from public.lukas_drawing_documents where id in ($1,$2) order by id`,
      [
        blankClone.rows[0].result.documentId,
        sourcedClone.rows[0].result.documentId,
      ],
    );
    assert.ok(
      cloneDocuments.rows.every(
        (row) => row.sourceFileId === null && row.sourceSha256 === null,
      ),
    );

    const metadataTamperCases = [
      ["{revision,documentId}", randomUUID()],
      ["{revision,sequence}", 99],
      ["{revision,version}", 99],
      ["{operationSequence}", 99],
    ];
    for (const [path, value] of metadataTamperCases) {
      await upgradeDb.exec("begin");
      try {
        await upgradeDb.exec(
          `alter table public.lukas_drawing_snapshots disable trigger all;
           alter table public.lukas_drawing_revision_approvals disable trigger all`,
        );
        await upgradeDb.query(
          `update public.lukas_drawing_snapshots
           set canonical_json=jsonb_set(canonical_json,$2::text[],to_jsonb($3::text),false)
           where revision_id=$1`,
          [source.revisionId, path, String(value)],
        );
        if (path !== "{revision,documentId}") {
          await upgradeDb.query(
            `update public.lukas_drawing_snapshots
             set canonical_json=jsonb_set(canonical_json,$2::text[],to_jsonb($3::bigint),false)
             where revision_id=$1`,
            [source.revisionId, path, Number(value)],
          );
        }
        await upgradeDb.query(
          `update public.lukas_drawing_snapshots
           set sha256=encode(extensions.digest(convert_to(canonical_json::text,'UTF8'),'sha256'),'hex')
           where revision_id=$1`,
          [source.revisionId],
        );
        await upgradeDb.query(
          `update public.lukas_drawing_revision_approvals a
           set snapshot_sha256=s.sha256
           from public.lukas_drawing_snapshots s
           where a.revision_id=$1 and s.revision_id=a.revision_id`,
          [source.revisionId],
        );
        await upgradeDb.exec("set role authenticated");
        await upgradeDb.query(
          "select set_config('request.jwt.claim.sub',$1,false)",
          [OWNER],
        );
        await assert.rejects(
          upgradeDb.query(
            "select public.lukas_drawing_create_from_template($1,'metadata probe',null,$2)",
            [source.revisionId, randomUUID()],
          ),
          (error) =>
            error.code === "P1R01" &&
            error.message === "Drawing template target is unavailable",
        );
      } finally {
        await upgradeDb.exec("rollback");
        await upgradeDb.exec("reset role");
      }
    }
  } finally {
    await upgradeDb.close();
  }
});

test("P2 upgrade deterministically repairs legacy canvases without editable layers", async () => {
  const legacyDb = new PGlite({ extensions: { pgcrypto } });
  try {
    await legacyDb.exec(foundationSql);
    await legacyDb.exec(await migration());
    await legacyDb.exec(await upgradeMigration());
    await legacyDb.exec(await issueLinkMigration());
    await legacyDb.exec(await releaseHardeningMigration());
    await legacyDb.query("insert into auth.users(id) values ($1)", [OWNER]);
    await legacyDb.query(
      "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
      [PROJECT, OWNER],
    );
    await legacyDb.exec("set role authenticated");
    await legacyDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    const first = await legacyDb.query(
      "select public.lukas_drawing_create_document($1,null,'Legacy empty',true) result",
      [PROJECT],
    );
    const second = await legacyDb.query(
      "select public.lukas_drawing_create_document($1,null,'Legacy source only',true) result",
      [PROJECT],
    );
    await legacyDb.exec("reset role");
    await legacyDb.exec(
      "alter table public.lukas_drawing_layers disable trigger user",
    );
    await legacyDb.query(
      "delete from public.lukas_drawing_layers where revision_id=$1",
      [first.rows[0].result.revisionId],
    );
    await legacyDb.query(
      "delete from public.lukas_drawing_layers where revision_id=$1 and system_kind<>'source'",
      [second.rows[0].result.revisionId],
    );
    await legacyDb.query(
      "update public.lukas_drawing_layers set sort_order=-4 where revision_id=$1 and system_kind='source'",
      [second.rows[0].result.revisionId],
    );
    await legacyDb.exec(
      "alter table public.lukas_drawing_layers enable trigger user",
    );
    const preservedSourceBefore = await legacyDb.query(
      `select id,name,sort_order "sortOrder",visible,locked,version
       from public.lukas_drawing_layers where revision_id=$1`,
      [second.rows[0].result.revisionId],
    );
    await legacyDb.exec(await p2Migration());
    await legacyDb.exec(await p2LegacyLayerBackfillMigration());
    const afterFirstRun = await legacyDb.query(
      `select c.id canvas_id,l.id,l.name,l.sort_order,l.version
       from public.lukas_drawing_canvases c join public.lukas_drawing_layers l on l.canvas_id=c.id
       where c.revision_id in ($1,$2) and l.system_kind<>'source' and l.visible and not l.locked
       order by c.id,l.id`,
      [first.rows[0].result.revisionId, second.rows[0].result.revisionId],
    );
    assert.equal(afterFirstRun.rows.length, 2);
    await legacyDb.exec(await p2LegacyLayerBackfillMigration());
    const afterSecondRun = await legacyDb.query(
      `select c.id canvas_id,l.id,l.name,l.sort_order,l.version
       from public.lukas_drawing_canvases c join public.lukas_drawing_layers l on l.canvas_id=c.id
       where c.revision_id in ($1,$2) and l.system_kind<>'source' and l.visible and not l.locked
       order by c.id,l.id`,
      [first.rows[0].result.revisionId, second.rows[0].result.revisionId],
    );
    assert.deepEqual(afterSecondRun.rows, afterFirstRun.rows);
    const preservedSourceAfter = await legacyDb.query(
      `select id,name,sort_order "sortOrder",visible,locked,version
       from public.lukas_drawing_layers where revision_id=$1 and system_kind='source'`,
      [second.rows[0].result.revisionId],
    );
    assert.deepEqual(
      preservedSourceAfter.rows,
      preservedSourceBefore.rows.map((row) => ({
        ...row,
        sortOrder: 0,
      })),
    );
    await legacyDb.exec(await p2HardeningMigration());
    await legacyDb.exec(await p2CompatibilityMigration());
    const beforeReconciliation = await legacyDb.query(
      `select id,canvas_id,name,sort_order,visible,locked,version
       from public.lukas_drawing_layers order by id`,
    );
    await legacyDb.exec(await p2HistoryReconciliationMigration());
    const afterReconciliation = await legacyDb.query(
      `select id,canvas_id,name,sort_order,visible,locked,version
       from public.lukas_drawing_layers order by id`,
    );
    assert.deepEqual(afterReconciliation.rows, beforeReconciliation.rows);
  } finally {
    await legacyDb.close();
  }
});

test("forward P2 reconciliation repairs a recorded hardening history that skipped the ordered repair", async () => {
  const historyDb = new PGlite({ extensions: { pgcrypto } });
  try {
    await historyDb.exec(foundationSql);
    await historyDb.exec(await migration());
    await historyDb.exec(await upgradeMigration());
    await historyDb.exec(await issueLinkMigration());
    await historyDb.exec(await releaseHardeningMigration());
    await historyDb.query("insert into auth.users(id) values ($1)", [OWNER]);
    await historyDb.query(
      "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
      [PROJECT, OWNER],
    );
    await historyDb.exec("set role authenticated");
    await historyDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    const created = await historyDb.query(
      "select public.lukas_drawing_create_document($1,null,'Skipped ordered repair',true) result",
      [PROJECT],
    );
    const ids = created.rows[0].result;
    await historyDb.exec("reset role");
    await historyDb.exec(await p2Migration());
    await historyDb.exec(await p2HardeningMigration());
    await historyDb.exec(await p2CompatibilityMigration());
    const canvas = await historyDb.query(
      "select id from public.lukas_drawing_canvases where revision_id=$1",
      [ids.revisionId],
    );
    const canvasId = canvas.rows[0].id;

    await historyDb.exec(
      "alter table public.lukas_drawing_layers disable trigger user",
    );
    await historyDb.query(
      "delete from public.lukas_drawing_layers where revision_id=$1 and system_kind<>'source'",
      [ids.revisionId],
    );
    await historyDb.query(
      "update public.lukas_drawing_layers set sort_order=-7 where revision_id=$1",
      [ids.revisionId],
    );
    await historyDb.exec(
      "alter table public.lukas_drawing_layers enable trigger user",
    );

    await historyDb.exec(await p2HistoryReconciliationMigration());
    const repaired = await historyDb.query(
      `select id,name,sort_order "sortOrder",visible,locked,system_kind "systemKind",version
       from public.lukas_drawing_layers where revision_id=$1 order by system_kind,id`,
      [ids.revisionId],
    );
    assert.equal(repaired.rows.length, 2);
    assert.deepEqual(
      repaired.rows.map((row) => row.sortOrder),
      [0, 0],
    );
    const custom = repaired.rows.find((row) => row.systemKind === "custom");
    const digest = createHash("md5")
      .update(`lukas-drawing-p2-editable-layer:${canvasId}`)
      .digest("hex");
    const stableLayerId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    assert.equal(custom.id, stableLayerId);
    assert.deepEqual(
      { ...custom, id: undefined },
      {
        id: undefined,
        name: `P2 Work ${canvasId}`,
        sortOrder: 0,
        visible: true,
        locked: false,
        systemKind: "custom",
        version: 1,
      },
    );
    const constraint = await historyDb.query(
      `select convalidated,pg_catalog.pg_get_constraintdef(oid) definition
       from pg_catalog.pg_constraint
       where conrelid='public.lukas_drawing_layers'::regclass
         and conname='lukas_drawing_layers_sort_order_nonnegative'`,
    );
    assert.deepEqual(constraint.rows, [
      {
        convalidated: true,
        definition: "CHECK ((sort_order >= 0))",
      },
    ]);
  } finally {
    await historyDb.close();
  }
});

test("P2 review refuses a page whose canvas lost every editable layer", async () => {
  const ids = await createDocument();
  await db.exec(
    "reset role; alter table public.lukas_drawing_layers disable trigger user",
  );
  await db.query(
    "delete from public.lukas_drawing_layers where revision_id=$1 and system_kind<>'source'",
    [ids.revisionId],
  );
  await db.exec("alter table public.lukas_drawing_layers enable trigger user");
  await asActor(OWNER);
  await assert.rejects(
    db.query("select public.lukas_drawing_request_review($1)", [
      ids.revisionId,
    ]),
    (error) =>
      error.code === "P1C01" &&
      /editable-layer invariants/i.test(error.message),
  );
});

test("P3 comments persist only explicit same-project mentions with idempotent evidence", async () => {
  const ids = await createDocument("P3 explicit mentions");
  const issueId = randomUUID();
  const commentId = randomUUID();
  await db.exec("reset role");
  await db.query(
    "insert into public.lukas_drawing_issues(id,project_id) values($1,$2)",
    [issueId, PROJECT],
  );
  await asActor(OWNER);
  const addComment = (body, mentionedUserIds) =>
    db.query("select public.lukas_drawing_add_comment($1,$2,$3,$4) result", [
      issueId,
      commentId,
      body,
      mentionedUserIds,
    ]);

  const first = await addComment("@누구나 표시 문구", [REVIEWER]);
  const retried = await addComment("@누구나 표시 문구", [REVIEWER]);
  assert.deepEqual(retried.rows[0].result, first.rows[0].result);
  assert.equal(first.rows[0].result.commentId, commentId);
  assert.deepEqual(first.rows[0].result.mentionedUserIds, [REVIEWER]);

  await db.exec("reset role");
  const [mentions, events, notifications] = await Promise.all([
    db.query(
      "select comment_id,user_id,project_id from public.lukas_drawing_comment_mentions where comment_id=$1",
      [commentId],
    ),
    db.query(
      "select event_type,to_value from public.lukas_drawing_issue_events where to_value->>'comment_id'=$1 order by event_type",
      [commentId],
    ),
    db.query(
      "select user_id from public.lukas_drawing_notifications where issue_id=$1",
      [issueId],
    ),
  ]);
  assert.deepEqual(mentions.rows, [
    { comment_id: commentId, user_id: REVIEWER, project_id: PROJECT },
  ]);
  assert.deepEqual(events.rows, [
    {
      event_type: "mention_added",
      to_value: { comment_id: commentId, mentioned_user_id: REVIEWER },
    },
  ]);
  assert.deepEqual(notifications.rows, [{ user_id: REVIEWER }]);

  await asActor(OWNER);
  await assert.rejects(
    addComment("@문구만으로는 권한이 생기지 않음", [OUTSIDER]),
    (error) => error.code === "P3S01",
  );
  await assert.rejects(
    addComment("다른 요청", [REVIEWER]),
    (error) => error.code === "P3S01",
  );
  await assert.rejects(
    db.query(
      "update public.lukas_drawing_comment_mentions set user_id=$1 where comment_id=$2",
      [EDITOR, commentId],
    ),
  );
  await assert.rejects(
    db.query(
      "delete from public.lukas_drawing_comment_mentions where comment_id=$1",
      [commentId],
    ),
  );

  await asActor(randomUUID());
  const hidden = await db.query(
    "select * from public.lukas_drawing_comment_mentions where comment_id=$1",
    [commentId],
  );
  assert.deepEqual(hidden.rows, []);
});

test("P3 canvas anchors preserve signed finite world millimeters and composite identity", async () => {
  const ids = await createDocument("P3 canvas region anchors");
  const issueId = randomUUID();
  const anchorId = randomUUID();
  await db.exec("reset role");
  await db.query(
    "insert into public.lukas_drawing_issues(id,project_id) values($1,$2)",
    [issueId, PROJECT],
  );
  const graph = await db.query(
    `select p.id page_id,c.id canvas_id
     from public.lukas_drawing_pages p
     join public.lukas_drawing_canvases c on c.page_id=p.id
     where p.revision_id=$1 limit 1`,
    [ids.revisionId],
  );
  const { page_id: pageId, canvas_id: canvasId } = graph.rows[0];
  await asActor(OWNER);
  const insert = (id, x, y, width, height, canvas = canvasId) =>
    db.query(
      `select public.lukas_drawing_add_canvas_region_anchor(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
      ) result`,
      [
        issueId,
        ids.revisionId,
        pageId,
        canvas,
        id,
        x,
        y,
        width,
        height,
        "서측 영역",
      ],
    );

  const created = await insert(anchorId, -25.5, -10, 120.25, 80);
  assert.deepEqual(created.rows[0].result, {
    anchorId,
    canvasId,
    heightMm: 80,
    pageId,
    revisionId: ids.revisionId,
    widthMm: 120.25,
    xMm: -25.5,
    yMm: -10,
  });
  for (const [x, y, width, height] of [
    [0, 0, 0, 1],
    [0, 0, 1, -1],
    [Number.NaN, 0, 1, 1],
    [Number.POSITIVE_INFINITY, 0, 1, 1],
    [0, Number.NEGATIVE_INFINITY, 1, 1],
  ])
    await assert.rejects(insert(randomUUID(), x, y, width, height));
  await assert.rejects(insert(randomUUID(), 0, 0, 1, 1, randomUUID()));
  await assert.rejects(
    db.query(
      "update public.lukas_drawing_canvas_region_anchors set x_mm=0 where id=$1",
      [anchorId],
    ),
  );
  await assert.rejects(
    db.query(
      "delete from public.lukas_drawing_canvas_region_anchors where id=$1",
      [anchorId],
    ),
  );
});

test("P3 approved checkpoint restore is an idempotent fresh child draft with lineage", async () => {
  const ids = await createDocument("P3 approved restore parent");
  const object = circleObject(randomUUID(), ids.workLayerId);
  await addObject(ids, object);
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'approved','restore fixture'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  const requestId = randomUUID();
  const restore = () =>
    db.query(
      "select public.lukas_drawing_restore_approved_snapshot($1,$2) result",
      [ids.revisionId, requestId],
    );
  const first = (await restore()).rows[0].result;
  assert.deepEqual((await restore()).rows[0].result, first);
  assert.equal(first.documentId, ids.documentId);
  assert.notEqual(first.revisionId, ids.revisionId);
  assert.equal(first.sourceRevisionId, ids.revisionId);
  assert.equal(first.parentRevisionId, ids.revisionId);
  assert.equal(first.status, "draft");
  const cloned = await db.query(
    "select id,lineage_id from public.lukas_drawing_objects where revision_id=$1",
    [first.revisionId],
  );
  assert.equal(cloned.rows.length, 1);
  assert.notEqual(cloned.rows[0].id, object.id);
  assert.equal(cloned.rows[0].lineage_id, object.lineageId ?? object.id);
  const parent = await db.query(
    "select status from public.lukas_drawing_revisions where id=$1",
    [ids.revisionId],
  );
  assert.equal(parent.rows[0].status, "approved");
});

test("P3 reviewer can restore an approved checkpoint into a child draft", async () => {
  const ids = await createDocument("P3 reviewer approved restore");
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'approved','reviewer restore fixture'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  const result = await db.query(
    "select public.lukas_drawing_restore_approved_snapshot($1,$2) result",
    [ids.revisionId, randomUUID()],
  );
  assert.equal(result.rows[0].result.sourceRevisionId, ids.revisionId);
  assert.equal(result.rows[0].result.status, "draft");
});

test("P3 approved restore locks the document before child sequence allocation", async () => {
  const definition = await db.query(
    `select pg_catalog.pg_get_functiondef(
      'public.lukas_drawing_restore_approved_snapshot(uuid,uuid)'::regprocedure
    ) body`,
  );
  assert.match(
    definition.rows[0].body,
    /lukas_drawing_documents[\s\S]+for update[\s\S]+lukas_drawing_restore_approved_snapshot_pre_document_lock/i,
  );
});

test("P3 checkpoint restore rejects a valid arbitrary delta outside its canonical snapshot", async () => {
  const ids = await createDocument("P3 authoritative checkpoint");
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'rejected','continue editing'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  const layer = await db.query(
    `select id,canvas_id,name,sort_order,visible,locked,system_kind,version
     from public.lukas_drawing_layers where id=$1`,
    [ids.workLayerId],
  );
  const current = layer.rows[0];
  const malicious = {
    id: current.id,
    canvasId: current.canvas_id,
    name: "NOT IN CHECKPOINT",
    sortOrder: current.sort_order,
    visible: current.visible,
    locked: current.locked,
    systemKind: current.system_kind,
    version: current.version,
  };
  const original = { ...malicious, name: current.name };
  await assert.rejects(
    db.query(
      `select public.lukas_drawing_apply_operation(
        $1,$2,'restore_checkpoint',$3,$4,$5,null,null
      )`,
      [
        ids.revisionId,
        randomUUID(),
        { [current.id]: current.version },
        {
          type: "restore_checkpoint",
          checkpointId: review.rows[0].result.snapshotId,
          actions: [
            {
              kind: "put_layer",
              entity: malicious,
              baseVersion: current.version,
            },
          ],
        },
        {
          type: "restore_checkpoint",
          checkpointId: review.rows[0].result.snapshotId,
          actions: [
            {
              kind: "put_layer",
              entity: original,
              baseVersion: current.version + 1,
            },
          ],
        },
      ],
    ),
    (error) => error.code === "P1C01",
  );
  const unchanged = await db.query(
    "select name from public.lukas_drawing_layers where id=$1",
    [ids.workLayerId],
  );
  assert.equal(unchanged.rows[0].name, current.name);
});

test("P3 checkpoint restore applies an ordinary object change without block conversion", async () => {
  const ids = await createDocument("P3 checkpoint ordinary object");
  const object = circleObject(randomUUID(), ids.workLayerId);
  await addObject(ids, object);
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  const snapshot = await db.query(
    "select canonical_json from public.lukas_drawing_snapshots where id=$1",
    [review.rows[0].result.snapshotId],
  );
  const canonicalTarget = snapshot.rows[0].canonical_json.objects.find(
    (candidate) => candidate.id === object.id,
  );
  const {
    lineageId: _lineageId,
    pageId: _pageId,
    type: _type,
    ...target
  } = canonicalTarget;
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'rejected','edit object then restore'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  await applyOperation(
    ids.revisionId,
    "update_objects",
    { [object.id]: 1 },
    {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: "Changed later" } }],
    },
    {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: target.name } }],
    },
  );
  const current = { ...target, name: "Changed later", version: 2 };
  await assert.rejects(
    db.query(
      `select public.lukas_drawing_apply_operation(
        $1,$2,'restore_checkpoint',$3,$4,$5,null,null
      )`,
      [
        ids.revisionId,
        randomUUID(),
        { [object.id]: 2 },
        {
          type: "restore_checkpoint",
          checkpointId: review.rows[0].result.snapshotId,
          actions: [
            {
              kind: "put_object",
              entity: { ...target, version: 2 },
              baseVersion: 2,
            },
          ],
          unexpected: true,
        },
        {
          type: "restore_checkpoint",
          checkpointId: review.rows[0].result.snapshotId,
          actions: [{ kind: "put_object", entity: current, baseVersion: 3 }],
        },
      ],
    ),
    (error) => error.code === "P1C01",
  );
  const result = await db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'restore_checkpoint',$3,$4,$5,null,null
    ) result`,
    [
      ids.revisionId,
      randomUUID(),
      { [object.id]: 2 },
      {
        type: "restore_checkpoint",
        checkpointId: review.rows[0].result.snapshotId,
        actions: [
          {
            kind: "put_object",
            entity: { ...target, version: 2 },
            baseVersion: 2,
          },
        ],
      },
      {
        type: "restore_checkpoint",
        checkpointId: review.rows[0].result.snapshotId,
        actions: [{ kind: "put_object", entity: current, baseVersion: 3 }],
      },
    ],
  );
  assert.equal(result.rows[0].result.resultVersions[object.id], 3);
  const restored = await db.query(
    "select name,version,status from public.lukas_drawing_objects where id=$1",
    [object.id],
  );
  assert.deepEqual(restored.rows, [
    { name: target.name, version: 3, status: "active" },
  ]);
});

test("P3 checkpoint restore deletes an object added after the checkpoint", async () => {
  const ids = await createDocument("P3 checkpoint later object");
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'rejected','add object then restore'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  const object = {
    ...circleObject(randomUUID(), ids.workLayerId),
    styleId: null,
  };
  await addObject(ids, object);
  const issueId = randomUUID();
  await db.exec("reset role");
  await db.query(
    "insert into public.lukas_drawing_issues(id,project_id) values ($1,$2)",
    [issueId, PROJECT],
  );
  await asActor(OWNER);
  const source = {
    id: randomUUID(),
    objectId: object.id,
    revisionId: ids.revisionId,
    sourceFileId: PDF,
    sourceSha256: PDF_SHA,
    sourceKind: "pdf_region",
    pdfPageNumber: 1,
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.2,
    version: 1,
  };
  await applyStructure(
    ids,
    {},
    [{ kind: "put_source", entity: source, baseVersion: null }],
    [{ kind: "delete_source", id: source.id, baseVersion: 1 }],
  );
  await db.query("select public.lukas_drawing_link_object_issue($1,$2)", [
    object.id,
    issueId,
  ]);
  const clientOperationId = randomUUID();
  const restore = () =>
    db.query(
      `select public.lukas_drawing_apply_operation(
      $1,$2,'restore_checkpoint',$3,$4,$5,null,null
    ) result`,
      [
        ids.revisionId,
        clientOperationId,
        { [object.id]: 1, [source.id]: 1 },
        {
          type: "restore_checkpoint",
          checkpointId: review.rows[0].result.snapshotId,
          actions: [
            { kind: "delete_source", id: source.id, baseVersion: 1 },
            { kind: "delete_object", id: object.id, baseVersion: 1 },
          ],
        },
        {
          type: "restore_checkpoint",
          checkpointId: review.rows[0].result.snapshotId,
          actions: [
            { kind: "put_object", entity: object, baseVersion: null },
            { kind: "put_source", entity: source, baseVersion: null },
          ],
        },
      ],
    );
  const result = await restore();
  assert.deepEqual((await restore()).rows[0].result, result.rows[0].result);
  assert.equal(result.rows[0].result.resultVersions[object.id], null);
  const deleted = await db.query(
    "select status,version from public.lukas_drawing_objects where id=$1",
    [object.id],
  );
  assert.deepEqual(deleted.rows, [{ status: "deleted", version: 2 }]);
  await db.exec("reset role");
  const references = await db.query(
    `select
      (select count(*)::integer from public.lukas_drawing_object_sources
        where object_id=$1 and status='active') source_count,
      (select count(*)::integer from public.lukas_drawing_object_sources
        where object_id=$1 and status='deleted') source_tombstone_count,
      (select count(*)::integer from public.lukas_drawing_object_issue_links
        where object_id=$1) issue_count,
      (select count(*)::integer from private.lukas_drawing_checkpoint_reference_history
        where client_operation_id=$2) audit_count,
      (select count(*)::integer from public.lukas_drawing_operations
        where revision_id=$3 and client_operation_id=$2) operation_count`,
    [object.id, clientOperationId, ids.revisionId],
  );
  assert.deepEqual(references.rows, [
    {
      source_count: 0,
      source_tombstone_count: 1,
      issue_count: 0,
      audit_count: 2,
      operation_count: 1,
    },
  ]);
});

test("P3 checkpoint restore revives exact source and issue references with a mixed object delta", async () => {
  const ids = await createDocument("P3 checkpoint reference revival");
  const object = {
    ...circleObject(randomUUID(), ids.workLayerId),
    styleId: null,
  };
  await addObject(ids, object);
  const issueId = randomUUID();
  await db.exec("reset role");
  await db.query(
    "insert into public.lukas_drawing_issues(id,project_id) values ($1,$2)",
    [issueId, PROJECT],
  );
  await asActor(OWNER);
  const sourceId = randomUUID();
  const source = {
    id: sourceId,
    objectId: object.id,
    revisionId: ids.revisionId,
    sourceFileId: PDF,
    sourceSha256: PDF_SHA,
    sourceKind: "pdf_region",
    pdfPageNumber: 1,
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.2,
    version: 1,
  };
  await applyStructure(
    ids,
    {},
    [{ kind: "put_source", entity: source, baseVersion: null }],
    [{ kind: "delete_source", id: source.id, baseVersion: 1 }],
  );
  await db.query("select public.lukas_drawing_link_object_issue($1,$2)", [
    object.id,
    issueId,
  ]);
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  const snapshot = await db.query(
    "select canonical_json from public.lukas_drawing_snapshots where id=$1",
    [review.rows[0].result.snapshotId],
  );
  const canonicalObject = snapshot.rows[0].canonical_json.objects.find(
    (candidate) => candidate.id === object.id,
  );
  const {
    lineageId: _lineage,
    pageId: _page,
    type: _type,
    ...target
  } = canonicalObject;
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'rejected','remove evidence then restore'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  await applyOperation(
    ids.revisionId,
    "mutate_objects_with_references",
    { [object.id]: 1, [source.id]: 1 },
    {
      type: "mutate_objects_with_references",
      objectAction: "delete",
      objects: [target],
      actions: [{ kind: "delete_source", id: source.id, baseVersion: 1 }],
    },
    {
      type: "mutate_objects_with_references",
      objectAction: "restore",
      objects: [{ ...target, version: 3 }],
      actions: [{ kind: "put_source", entity: source, baseVersion: null }],
    },
  );
  const later = {
    ...circleObject(randomUUID(), ids.workLayerId),
    styleId: null,
  };
  await addObject(ids, later);
  const operationId = randomUUID();
  const forward = {
    type: "restore_checkpoint",
    checkpointId: review.rows[0].result.snapshotId,
    actions: [
      {
        kind: "put_object",
        entity: { ...target, version: 3 },
        baseVersion: null,
      },
      { kind: "put_source", entity: source, baseVersion: null },
      { kind: "delete_object", id: later.id, baseVersion: 1 },
    ],
  };
  const inverse = {
    type: "restore_checkpoint",
    checkpointId: review.rows[0].result.snapshotId,
    actions: [
      { kind: "put_object", entity: later, baseVersion: null },
      { kind: "delete_source", id: source.id, baseVersion: 3 },
      { kind: "delete_object", id: object.id, baseVersion: 3 },
    ],
  };
  await applyOperationWithId(
    ids.revisionId,
    operationId,
    "restore_checkpoint",
    { [later.id]: 1 },
    forward,
    inverse,
  );
  const graph = await db.query(
    `select
      (select jsonb_agg(jsonb_build_object('id',s.id,'objectId',s.object_id))
       from public.lukas_drawing_object_sources s where s.revision_id=$1) sources,
      (select jsonb_agg(jsonb_build_object('id',l.issue_id,'objectId',l.object_id))
       from public.lukas_drawing_object_issue_links l where l.revision_id=$1) issues`,
    [ids.revisionId],
  );
  assert.deepEqual(graph.rows[0], {
    sources: [{ id: sourceId, objectId: object.id }],
    issues: [{ id: issueId, objectId: object.id }],
  });
});

test("P3 checkpoint restore rejects a hash-valid cross-project reference graph atomically", async () => {
  const ids = await createDocument("P3 invalid checkpoint reference");
  const foreignProject = randomUUID();
  const foreignIssue = randomUUID();
  await db.exec("reset role");
  await db.query(
    "insert into public.lukas_qto_projects(id,owner_id) values($1,$2)",
    [foreignProject, OWNER],
  );
  await db.query(
    "insert into public.lukas_drawing_issues(id,project_id) values($1,$2)",
    [foreignIssue, foreignProject],
  );
  await asActor(OWNER);
  const object = {
    ...circleObject(randomUUID(), ids.workLayerId),
    styleId: null,
  };
  await addObject(ids, object);
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'rejected','invalid reference fixture'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await db.exec("reset role");
  await db.exec(
    "alter table public.lukas_drawing_revision_approvals disable trigger user",
  );
  await db.query(
    "delete from public.lukas_drawing_revision_approvals where revision_id=$1",
    [ids.revisionId],
  );
  await db.exec(
    "alter table public.lukas_drawing_revision_approvals enable trigger user",
  );
  await db.exec(
    "alter table public.lukas_drawing_snapshots disable trigger user",
  );
  await db.query(
    `update public.lukas_drawing_snapshots set
      canonical_json=jsonb_set(canonical_json,'{issues}',$2::jsonb),
      sha256=encode(extensions.digest(convert_to(
        jsonb_set(canonical_json,'{issues}',$2::jsonb)::text,'UTF8'
      ),'sha256'),'hex')
     where id=$1`,
    [
      review.rows[0].result.snapshotId,
      [{ id: foreignIssue, objectId: object.id }],
    ],
  );
  await db.exec(
    "alter table public.lukas_drawing_snapshots enable trigger user",
  );
  await asActor(OWNER);
  await assert.rejects(
    db.query(
      `select public.lukas_drawing_apply_operation(
        $1,$2,'restore_checkpoint',$3,$4,$5,null,null
      )`,
      [
        ids.revisionId,
        randomUUID(),
        { [object.id]: 1 },
        {
          type: "restore_checkpoint",
          checkpointId: review.rows[0].result.snapshotId,
          actions: [{ kind: "delete_object", id: object.id, baseVersion: 1 }],
        },
        {
          type: "restore_checkpoint",
          checkpointId: review.rows[0].result.snapshotId,
          actions: [{ kind: "put_object", entity: object, baseVersion: null }],
        },
      ],
    ),
    (error) => error.code === "P1C01",
  );
  const unchanged = await db.query(
    "select status,version from public.lukas_drawing_objects where id=$1",
    [object.id],
  );
  assert.deepEqual(unchanged.rows, [{ status: "active", version: 1 }]);
});

test("P3 checkpoint restore combines a layer update with another structure collection", async () => {
  const ids = await createDocument("P3 checkpoint mixed layer update");
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  const snapshot = await db.query(
    "select canonical_json from public.lukas_drawing_snapshots where id=$1",
    [review.rows[0].result.snapshotId],
  );
  const canonicalLayer = snapshot.rows[0].canonical_json.layers.find(
    (layer) => layer.id === ids.workLayerId,
  );
  const { pageId: _pageId, ...targetLayer } = canonicalLayer;
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'rejected','mixed restore'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  await applyOperation(
    ids.revisionId,
    "update_layer",
    { [ids.workLayerId]: 1 },
    {
      type: "update_layer",
      layerId: ids.workLayerId,
      patch: { name: "Changed after checkpoint" },
    },
    {
      type: "update_layer",
      layerId: ids.workLayerId,
      patch: { name: targetLayer.name },
    },
  );
  const style = {
    id: randomUUID(),
    revisionId: ids.revisionId,
    name: "Later style",
    value: STYLE,
    version: 1,
  };
  await applyStructure(
    ids,
    {},
    [{ kind: "put_style", entity: style, baseVersion: null }],
    [{ kind: "delete_style", id: style.id, baseVersion: 1 }],
  );
  const currentLayer = {
    ...targetLayer,
    name: "Changed after checkpoint",
    version: 2,
  };
  const result = await db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'restore_checkpoint',$3,$4,$5,null,null
    ) result`,
    [
      ids.revisionId,
      randomUUID(),
      { [ids.workLayerId]: 2, [style.id]: 1 },
      {
        type: "restore_checkpoint",
        checkpointId: review.rows[0].result.snapshotId,
        actions: [
          {
            kind: "put_layer",
            entity: { ...targetLayer, version: 2 },
            baseVersion: 2,
          },
          { kind: "delete_style", id: style.id, baseVersion: 1 },
        ],
      },
      {
        type: "restore_checkpoint",
        checkpointId: review.rows[0].result.snapshotId,
        actions: [
          { kind: "put_style", entity: style, baseVersion: null },
          { kind: "put_layer", entity: currentLayer, baseVersion: 3 },
        ],
      },
    ],
  );
  assert.equal(result.rows[0].result.resultVersions[ids.workLayerId], 3);
  const restored = await db.query(
    `select l.name,l.version,
      (select count(*)::int from public.lukas_drawing_styles s where s.id=$2) style_count
     from public.lukas_drawing_layers l where l.id=$1`,
    [ids.workLayerId, style.id],
  );
  assert.deepEqual(restored.rows, [
    { name: targetLayer.name, version: 3, style_count: 0 },
  ]);
});

test("P3 checkpoint restore revives a dependent canvas layer and object", async () => {
  const ids = await createDocument("P3 checkpoint dependent object");
  const canvas = {
    id: randomUUID(),
    pageId: ids.pageId,
    name: "Checkpoint model",
    spaceKind: "model",
    widthMillimeters: 100,
    heightMillimeters: 100,
    background: null,
    sortOrder: 1,
    version: 1,
  };
  const layer = {
    id: randomUUID(),
    name: "Checkpoint model work",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: canvas.id,
    sortOrder: 0,
    version: 1,
  };
  await applyStructure(
    ids,
    {},
    [
      { kind: "put_canvas", entity: canvas, baseVersion: null },
      { kind: "put_layer", entity: layer, baseVersion: null },
    ],
    [
      { kind: "delete_layer", id: layer.id, baseVersion: 1 },
      { kind: "delete_canvas", id: canvas.id, baseVersion: 1 },
    ],
  );
  const object = { ...circleObject(randomUUID(), layer.id), styleId: null };
  await addObject(ids, object);
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'rejected','dependent restore'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  await applyOperation(
    ids.revisionId,
    "delete_objects",
    { [object.id]: 1 },
    { type: "delete_objects", objectIds: [object.id] },
    { type: "add_objects", objects: [{ ...object, version: 3 }] },
  );
  await db.exec("reset role");
  await db.query("delete from public.lukas_drawing_objects where id=$1", [
    object.id,
  ]);
  await asActor(OWNER);
  await applyStructure(
    ids,
    { [layer.id]: 1, [canvas.id]: 1 },
    [
      { kind: "delete_layer", id: layer.id, baseVersion: 1 },
      { kind: "delete_canvas", id: canvas.id, baseVersion: 1 },
    ],
    [
      { kind: "put_canvas", entity: canvas, baseVersion: null },
      { kind: "put_layer", entity: layer, baseVersion: null },
    ],
  );
  const result = await db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'restore_checkpoint',$3,$4,$5,null,null
    ) result`,
    [
      ids.revisionId,
      randomUUID(),
      {},
      {
        type: "restore_checkpoint",
        checkpointId: review.rows[0].result.snapshotId,
        actions: [
          { kind: "put_canvas", entity: canvas, baseVersion: null },
          { kind: "put_layer", entity: layer, baseVersion: null },
          {
            kind: "put_object",
            entity: { ...object, version: 3 },
            baseVersion: null,
          },
        ],
      },
      {
        type: "restore_checkpoint",
        checkpointId: review.rows[0].result.snapshotId,
        actions: [
          { kind: "delete_object", id: object.id, baseVersion: 5 },
          { kind: "delete_layer", id: layer.id, baseVersion: 3 },
          { kind: "delete_canvas", id: canvas.id, baseVersion: 3 },
        ],
      },
    ],
  );
  assert.equal(result.rows[0].result.resultVersions[object.id], 5);
  const restored = await db.query(
    `select o.name,o.version,l.name layer_name,c.name canvas_name
     from public.lukas_drawing_objects o
     join public.lukas_drawing_layers l on l.id=o.layer_id
     join public.lukas_drawing_canvases c on c.id=l.canvas_id
     where o.id=$1`,
    [object.id],
  );
  assert.deepEqual(restored.rows, [
    {
      name: object.name,
      version: 5,
      layer_name: layer.name,
      canvas_name: canvas.name,
    },
  ]);
});

test("P3 checkpoint restore keeps objects on a checkpoint-locked hidden layer", async () => {
  const ids = await createDocument("P3 checkpoint locked layer object");
  await addCustomLayer(ids, "Editable fallback");
  const object = {
    ...circleObject(randomUUID(), ids.workLayerId),
    styleId: null,
  };
  await addObject(ids, object);
  await applyOperation(
    ids.revisionId,
    "update_layer",
    { [ids.workLayerId]: 1 },
    {
      type: "update_layer",
      layerId: ids.workLayerId,
      patch: { visible: false, locked: true },
    },
    {
      type: "update_layer",
      layerId: ids.workLayerId,
      patch: { visible: true, locked: false },
    },
  );
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  const snapshot = await db.query(
    "select canonical_json from public.lukas_drawing_snapshots where id=$1",
    [review.rows[0].result.snapshotId],
  );
  const { pageId: _layerPageId, ...targetLayer } =
    snapshot.rows[0].canonical_json.layers.find(
      (layer) => layer.id === ids.workLayerId,
    );
  const {
    lineageId: _lineageId,
    pageId: _objectPageId,
    type: _objectType,
    ...targetObject
  } = snapshot.rows[0].canonical_json.objects.find(
    (candidate) => candidate.id === object.id,
  );
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'rejected','locked layer restore'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  await applyOperation(
    ids.revisionId,
    "update_layer",
    { [ids.workLayerId]: 2 },
    {
      type: "update_layer",
      layerId: ids.workLayerId,
      patch: { visible: true, locked: false },
    },
    {
      type: "update_layer",
      layerId: ids.workLayerId,
      patch: { visible: false, locked: true },
    },
  );
  await applyOperation(
    ids.revisionId,
    "update_objects",
    { [object.id]: 1 },
    {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: "Changed unlocked" } }],
    },
    {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: object.name } }],
    },
  );
  const result = await db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'restore_checkpoint',$3,$4,$5,null,null
    ) result`,
    [
      ids.revisionId,
      randomUUID(),
      { [ids.workLayerId]: 3, [object.id]: 2 },
      {
        type: "restore_checkpoint",
        checkpointId: review.rows[0].result.snapshotId,
        actions: [
          {
            kind: "put_layer",
            entity: { ...targetLayer, version: 3 },
            baseVersion: 3,
          },
          {
            kind: "put_object",
            entity: { ...targetObject, version: 2 },
            baseVersion: 2,
          },
        ],
      },
      {
        type: "restore_checkpoint",
        checkpointId: review.rows[0].result.snapshotId,
        actions: [
          {
            kind: "put_object",
            entity: { ...targetObject, name: "Changed unlocked", version: 2 },
            baseVersion: 3,
          },
          {
            kind: "put_layer",
            entity: {
              ...targetLayer,
              visible: true,
              locked: false,
              version: 3,
            },
            baseVersion: 4,
          },
        ],
      },
    ],
  );
  assert.equal(result.rows[0].result.resultVersions[object.id], 3);
  const restored = await db.query(
    `select o.name,l.visible,l.locked
     from public.lukas_drawing_objects o
     join public.lukas_drawing_layers l on l.id=o.layer_id
     where o.id=$1`,
    [object.id],
  );
  assert.deepEqual(restored.rows, [
    { name: object.name, visible: false, locked: true },
  ]);
});

test("P3 checkpoint restore stages a deleted canvas before moving its surviving layer", async () => {
  const ids = await createDocument("P3 checkpoint moved layer canvas");
  const canvas = {
    id: randomUUID(),
    pageId: ids.pageId,
    name: "Checkpoint move canvas",
    spaceKind: "model",
    widthMillimeters: 100,
    heightMillimeters: 100,
    background: null,
    sortOrder: 1,
    version: 1,
  };
  const layer = {
    id: randomUUID(),
    name: "Checkpoint movable layer",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: canvas.id,
    sortOrder: 0,
    version: 1,
  };
  await applyStructure(
    ids,
    {},
    [
      { kind: "put_canvas", entity: canvas, baseVersion: null },
      { kind: "put_layer", entity: layer, baseVersion: null },
    ],
    [
      { kind: "delete_layer", id: layer.id, baseVersion: 1 },
      { kind: "delete_canvas", id: canvas.id, baseVersion: 1 },
    ],
  );
  const companionLayer = {
    id: randomUUID(),
    name: "Checkpoint canvas companion",
    visible: true,
    locked: false,
    canvasId: canvas.id,
    sortOrder: 1,
    version: 1,
  };
  await applyOperation(
    ids.revisionId,
    "add_layer",
    { [companionLayer.id]: 1 },
    { type: "add_layer", layer: companionLayer },
    {},
  );
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'rejected','move layer then restore canvas'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  const movedLayer = { ...layer, canvasId: ids.canvasId, version: 1 };
  await applyStructure(
    ids,
    { [layer.id]: 1 },
    [{ kind: "put_layer", entity: movedLayer, baseVersion: 1 }],
    [
      {
        kind: "put_layer",
        entity: layer,
        baseVersion: 2,
      },
    ],
  );
  await applyStructure(
    ids,
    { [companionLayer.id]: 1, [canvas.id]: 1 },
    [
      { kind: "delete_layer", id: companionLayer.id, baseVersion: 1 },
      { kind: "delete_canvas", id: canvas.id, baseVersion: 1 },
    ],
    [
      { kind: "put_canvas", entity: canvas, baseVersion: null },
      {
        kind: "put_layer",
        entity: { ...companionLayer, systemKind: "custom" },
        baseVersion: null,
      },
    ],
  );
  await assert.rejects(
    db.query(
      `select public.lukas_drawing_apply_operation(
        $1,$2,'restore_checkpoint',$3,$4,$5,null,null
      )`,
      [
        ids.revisionId,
        randomUUID(),
        { [layer.id]: 2 },
        {
          type: "restore_checkpoint",
          checkpointId: review.rows[0].result.snapshotId,
          actions: [
            { kind: "put_canvas", entity: canvas, baseVersion: null },
            {
              kind: "put_layer",
              entity: { ...companionLayer, systemKind: "custom" },
              baseVersion: null,
              unexpected: true,
            },
            {
              kind: "put_layer",
              entity: { ...layer, version: 2 },
              baseVersion: 2,
            },
          ],
        },
        {
          type: "restore_checkpoint",
          checkpointId: review.rows[0].result.snapshotId,
          actions: [
            {
              kind: "put_layer",
              entity: { ...movedLayer, version: 2 },
              baseVersion: 3,
            },
            {
              kind: "delete_layer",
              id: companionLayer.id,
              baseVersion: 3,
            },
            { kind: "delete_canvas", id: canvas.id, baseVersion: 3 },
          ],
        },
      ],
    ),
    (error) => error.code === "P1C01",
  );
  const result = await db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'restore_checkpoint',$3,$4,$5,null,null
    ) result`,
    [
      ids.revisionId,
      randomUUID(),
      { [layer.id]: 2 },
      {
        type: "restore_checkpoint",
        checkpointId: review.rows[0].result.snapshotId,
        actions: [
          { kind: "put_canvas", entity: canvas, baseVersion: null },
          {
            kind: "put_layer",
            entity: { ...companionLayer, systemKind: "custom" },
            baseVersion: null,
          },
          {
            kind: "put_layer",
            entity: { ...layer, version: 2 },
            baseVersion: 2,
          },
        ],
      },
      {
        type: "restore_checkpoint",
        checkpointId: review.rows[0].result.snapshotId,
        actions: [
          {
            kind: "put_layer",
            entity: { ...movedLayer, version: 2 },
            baseVersion: 3,
          },
          {
            kind: "delete_layer",
            id: companionLayer.id,
            baseVersion: 3,
          },
          { kind: "delete_canvas", id: canvas.id, baseVersion: 3 },
        ],
      },
    ],
  );
  assert.equal(result.rows[0].result.resultVersions[canvas.id], 3);
  const restored = await db.query(
    `select l.canvas_id,c.version canvas_version,l.version layer_version
     from public.lukas_drawing_layers l
     join public.lukas_drawing_canvases c on c.id=l.canvas_id
     where l.id=$1`,
    [layer.id],
  );
  assert.deepEqual(restored.rows, [
    { canvas_id: canvas.id, canvas_version: 3, layer_version: 3 },
  ]);
});

test("P3 checkpoint restore revives older object content and removes later block state", async () => {
  const ids = await createDocument("P3 checkpoint object tombstone");
  const object = {
    ...circleObject(randomUUID(), ids.workLayerId),
    styleId: null,
  };
  await addObject(ids, object);
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  const snapshot = await db.query(
    "select canonical_json from public.lukas_drawing_snapshots where id=$1",
    [review.rows[0].result.snapshotId],
  );
  const canonicalTarget = snapshot.rows[0].canonical_json.objects.find(
    (candidate) => candidate.id === object.id,
  );
  const {
    lineageId: _lineageId,
    pageId: _pageId,
    type: _type,
    ...target
  } = canonicalTarget;
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'rejected','convert then restore'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  await applyOperation(
    ids.revisionId,
    "update_objects",
    { [object.id]: 1 },
    {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: "Changed later" } }],
    },
    {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: target.name } }],
    },
  );
  const changed = { ...target, name: "Changed later", version: 2 };
  const block = {
    id: randomUUID(),
    revisionId: ids.revisionId,
    name: "Later block",
    primitives: [
      {
        localId: "local-a",
        name: changed.name,
        geometry: changed.geometry,
        styleId: null,
        style: changed.style,
      },
    ],
    version: 1,
  };
  const instance = {
    id: randomUUID(),
    lineageId: randomUUID(),
    blockId: block.id,
    layerId: ids.workLayerId,
    name: "Later instance",
    origin: { x: 0, y: 0 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  };
  instance.lineageId = instance.id;
  await applyOperation(
    ids.revisionId,
    "mutate_structure",
    { [object.id]: 2 },
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_block", entity: block, baseVersion: null },
        { kind: "put_block_instance", entity: instance, baseVersion: null },
        { kind: "delete_object", id: object.id, baseVersion: 2 },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_object", entity: changed, baseVersion: null },
        { kind: "delete_block_instance", id: instance.id, baseVersion: 1 },
        { kind: "delete_block", id: block.id, baseVersion: 1 },
      ],
    },
  );
  const result = await db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'restore_checkpoint',$3,$4,$5,null,null
    ) result`,
    [
      ids.revisionId,
      randomUUID(),
      { [instance.id]: 1, [block.id]: 1 },
      {
        type: "restore_checkpoint",
        checkpointId: review.rows[0].result.snapshotId,
        actions: [
          {
            kind: "put_object",
            entity: { ...target, version: 2 },
            baseVersion: null,
          },
          { kind: "delete_block_instance", id: instance.id, baseVersion: 1 },
          { kind: "delete_block", id: block.id, baseVersion: 1 },
        ],
      },
      {
        type: "restore_checkpoint",
        checkpointId: review.rows[0].result.snapshotId,
        actions: [
          { kind: "put_block", entity: block, baseVersion: null },
          { kind: "put_block_instance", entity: instance, baseVersion: null },
          { kind: "delete_object", id: object.id, baseVersion: 4 },
        ],
      },
    ],
  );
  assert.equal(result.rows[0].result.resultVersions[object.id], 4);
  const restored = await db.query(
    "select name,version,status from public.lukas_drawing_objects where id=$1",
    [object.id],
  );
  assert.deepEqual(restored.rows, [
    { name: target.name, version: 4, status: "active" },
  ]);
});

test("P3 checkpoint restore revives older non-object tombstone content", async () => {
  const ids = await createDocument("P3 checkpoint style tombstone");
  const style = {
    id: randomUUID(),
    revisionId: ids.revisionId,
    name: "Checkpoint style",
    value: STYLE,
    version: 1,
  };
  await applyStructure(
    ids,
    {},
    [{ kind: "put_style", entity: style, baseVersion: null }],
    [{ kind: "delete_style", id: style.id, baseVersion: 1 }],
  );
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'rejected','change style then restore'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await asActor(OWNER);
  const changed = { ...style, name: "Changed style", version: 1 };
  await applyStructure(
    ids,
    { [style.id]: 1 },
    [{ kind: "put_style", entity: changed, baseVersion: 1 }],
    [{ kind: "put_style", entity: style, baseVersion: 2 }],
  );
  await applyStructure(
    ids,
    { [style.id]: 2 },
    [{ kind: "delete_style", id: style.id, baseVersion: 2 }],
    [
      {
        kind: "put_style",
        entity: { ...changed, version: 2 },
        baseVersion: null,
      },
    ],
  );
  const result = await db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'restore_checkpoint',$3,$4,$5,null,null
    ) result`,
    [
      ids.revisionId,
      randomUUID(),
      {},
      {
        type: "restore_checkpoint",
        checkpointId: review.rows[0].result.snapshotId,
        actions: [
          {
            kind: "put_style",
            entity: { ...style, version: 2 },
            baseVersion: null,
          },
        ],
      },
      {
        type: "restore_checkpoint",
        checkpointId: review.rows[0].result.snapshotId,
        actions: [{ kind: "delete_style", id: style.id, baseVersion: 4 }],
      },
    ],
  );
  assert.equal(result.rows[0].result.resultVersions[style.id], 4);
  const restored = await db.query(
    "select name,version from public.lukas_drawing_styles where id=$1",
    [style.id],
  );
  assert.deepEqual(restored.rows, [{ name: style.name, version: 4 }]);
});
