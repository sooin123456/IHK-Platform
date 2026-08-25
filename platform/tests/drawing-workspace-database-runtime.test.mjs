import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createServer } from "vite";

const OWNER = "00000000-0000-4000-8000-000000000001";
const REVIEWER = "00000000-0000-4000-8000-000000000002";
const OUTSIDER = "00000000-0000-4000-8000-000000000003";
const EDITOR = "00000000-0000-4000-8000-000000000004";
const PROJECT = "10000000-0000-4000-8000-000000000001";
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
const drawingBlocks = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-blocks.ts",
);
const workspaceServer = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-workspace.server.ts",
);
const drawingOutbox = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-outbox.client.ts",
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
} = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-blocks-panel.tsx",
);
const { deriveDrawingTransientState } = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-document-store.client.ts",
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
    create schema auth;
    create schema private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable set search_path = '' as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;
    grant usage on schema private to authenticated, service_role;

    create table public.lukas_qto_projects(
      id uuid primary key,
      owner_id uuid not null references auth.users(id)
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
    create table public.lukas_drawing_issues(
      id uuid primary key,
      project_id uuid not null references public.lukas_qto_projects(id),
      unique(id, project_id)
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
      public.lukas_qto_files, public.lukas_drawing_issues to authenticated;
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
    blockId: block.id,
    layerId: ids.workLayerId,
    name: label,
    origin: { x: 0, y: 0 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  };
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
  await db.exec(await migration());
  await db.exec(await upgradeMigration());
  await db.exec(await issueLinkMigration());
  await db.exec(await releaseHardeningMigration());
  await db.exec(await p2Migration());
  await db.exec(await p2LegacyLayerBackfillMigration());
  await db.exec(await p2HardeningMigration());
  await db.exec(await p2CompatibilityMigration());
  await db.exec(await p2HistoryReconciliationMigration());
  await db.exec(await p2NavigationHardeningMigration());
  await db.exec(await p2StyleGuardSqlstateMigration());
  await db.exec(await p2BlockExactnessMigration());
  await db.query("insert into auth.users(id) values ($1),($2),($3),($4)", [
    OWNER,
    REVIEWER,
    OUTSIDER,
    EDITOR,
  ]);
  await db.query(
    "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
    [PROJECT, OWNER],
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
  await addCustomLayer(ids, "Visible fallback");
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
      pages: {},
      canvases: {},
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
      (select count(*)::int from public.lukas_drawing_block_instances where id=$4) instances`,
    [firstId, secondId, blockId, instanceId],
  );
  assert.deepEqual(rows.rows[0], { objects: 0, blocks: 1, instances: 1 });

  const undone = drawingCommands.undoDrawingCommand(local, OWNER);
  assert.ok(undone && !("kind" in undone));
  await persist(undone.operation);
  local = undone.state;
  rows = await db.query(
    `select
      (select count(*)::int from public.lukas_drawing_objects where id in ($1,$2) and status='active') objects,
      (select count(*)::int from public.lukas_drawing_blocks where id=$3) blocks,
      (select count(*)::int from public.lukas_drawing_block_instances where id=$4) instances`,
    [firstId, secondId, blockId, instanceId],
  );
  assert.deepEqual(rows.rows[0], { objects: 2, blocks: 0, instances: 0 });

  const redone = drawingCommands.redoDrawingCommand(local, OWNER);
  assert.ok(redone && !("kind" in redone));
  await persist(redone.operation);
  rows = await db.query(
    `select
      (select count(*)::int from public.lukas_drawing_objects where id in ($1,$2) and status='active') objects,
      (select count(*)::int from public.lukas_drawing_blocks where id=$3) blocks,
      (select count(*)::int from public.lukas_drawing_block_instances where id=$4) instances`,
    [firstId, secondId, blockId, instanceId],
  );
  assert.deepEqual(rows.rows[0], { objects: 0, blocks: 1, instances: 1 });
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
  assert.match(viewer, /Instance 1개/);
  assert.match(viewer, /Approved symbol Instance 1개 보기/);
  assert.match(viewer, /aria-expanded="false"/);
  assert.doesNotMatch(viewer, /<form/);
  assert.doesNotMatch(viewer, /Instance 삽입/);

  const expandedInstances = renderToStaticMarkup(
    createElement(DrawingBlockInstancesList, {
      block,
      canEdit: false,
      instances: [instance],
      layers: state.layers,
      onSelectionChange() {},
    }),
  );
  assert.match(expandedInstances, /aria-label="Approved symbol instances"/);
  assert.match(
    expandedInstances,
    /aria-label="Approved placement instance 선택"/,
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
  assert.match(inspector, /블록 Instance/);
  assert.match(inspector, /Approved placement/);
  assert.match(inspector, /12, 34/);
  assert.match(inspector, /30°/);
  assert.doesNotMatch(inspector, /<form/);
  assert.doesNotMatch(inspector, /Instance 저장/);

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
  assert.match(editor, /Instance 삽입/);
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
  assert.match(list, /Hidden active placement instance 선택/);
  assert.doesNotMatch(list, /Off canvas placement instance 선택/);
  const editorLockedList = renderToStaticMarkup(
    createElement(DrawingBlockInstancesList, {
      block,
      canEdit: true,
      instances: activeRows,
      layers,
      onSelectionChange() {},
    }),
  );
  assert.match(editorLockedList, /Hidden active placement instance 선택/);
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
    assert.doesNotMatch(inspector, /Instance 저장|Instance 삭제|Instance 복사/);
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
  assert.match(panel, /현재 Canvas 1개/);
  assert.match(panel, /다른 Canvas 1개/);
  assert.doesNotMatch(panel, /Off canvas placement instance 선택/);
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
    db.query("select public.lukas_drawing_create_from_template($1,$2,$3)", [
      ids.revisionId,
      "Unrelated source probe",
      unrelatedSourceId,
    ]),
    (error) =>
      error.code === "P1R01" &&
      error.message === "Drawing template target is unavailable",
  );
  const cloned = await db.query(
    "select public.lukas_drawing_create_from_template($1,$2,null) result",
    [ids.revisionId, "Approved clone"],
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
    "select public.lukas_drawing_create_from_template($1,'Explicit clone 1',$2) result",
    [source.revisionId, sourceFileId],
  );
  const second = await db.query(
    "select public.lukas_drawing_create_from_template($1,'Explicit clone 2',$2) result",
    [source.revisionId, sourceFileId],
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
        "select public.lukas_drawing_create_from_template($1,'probe',null)",
        [candidate],
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
    await upgradeDb.exec("set role authenticated");
    await upgradeDb.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [OWNER],
    );
    const created = await upgradeDb.query(
      "select public.lukas_drawing_create_document($1,null,'v1 template',true) result",
      [PROJECT],
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
    const clone = await upgradeDb.query(
      "select public.lukas_drawing_create_from_template($1,'v1 promoted',null) result",
      [source.revisionId],
    );
    await upgradeDb.exec("reset role");
    const promoted = await upgradeDb.query(
      `select count(*)::int count from public.lukas_drawing_canvases
       where revision_id=$1 and space_kind='paper' and sort_order=0`,
      [clone.rows[0].result.revisionId],
    );
    assert.equal(promoted.rows[0].count, 1);
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
