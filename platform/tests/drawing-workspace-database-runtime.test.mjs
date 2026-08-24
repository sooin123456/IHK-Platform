import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createServer } from "vite";

const OWNER = "00000000-0000-4000-8000-000000000001";
const REVIEWER = "00000000-0000-4000-8000-000000000002";
const OUTSIDER = "00000000-0000-4000-8000-000000000003";
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
const workspaceServer = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-workspace.server.ts",
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
    "select public.lukas_drawing_create_document($1,$2,$3,true) result",
    [PROJECT, PDF, title],
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

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(foundationSql);
  await db.exec(await migration());
  await db.exec(await upgradeMigration());
  await db.query("insert into auth.users(id) values ($1),($2),($3)", [
    OWNER,
    REVIEWER,
    OUTSIDER,
  ]);
  await db.query(
    "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
    [PROJECT, OWNER],
  );
  await db.query(
    `insert into public.lukas_qto_project_members(project_id,user_id,role)
     values ($1,$2,'reviewer')`,
    [PROJECT, REVIEWER],
  );
  await db.query(
    `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256)
     values ($1,$2,$3,'pdf',$4)`,
    [PDF, PROJECT, OWNER, PDF_SHA],
  );
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

  await t.test("insert accepts custom but rejects manufactured system layers", async () => {
    const ids = await createDocument();
    const customId = await directLayer(ids);
    const stored = await db.query(
      "select system_kind from public.lukas_drawing_layers where id=$1",
      [customId],
    );
    assert.equal(stored.rows[0].system_kind, "custom");
    for (const systemKind of ["source", "work"]) {
      await assert.rejects(
        directLayer(ids, {
          name: `Manufactured ${systemKind}`,
          systemKind,
          locked: systemKind === "source",
        }),
        /Only custom drawing layers may be inserted directly/i,
      );
    }
  });

  await t.test("update cannot change system kind or mutate a source", async () => {
    const ids = await createDocument();
    const customId = await directLayer(ids);
    await assert.rejects(
      db.query(
        `update public.lukas_drawing_layers
         set system_kind='source',locked=true,version=version+1 where id=$1`,
        [customId],
      ),
      /Drawing layer identity is immutable/i,
    );
    await assert.rejects(
      db.query(
        `update public.lukas_drawing_layers
         set name='Renamed source',version=version+1 where id=$1`,
        [ids.sourceLayerId],
      ),
      /Source drawing layer is immutable/i,
    );
  });

  await t.test("update preserves a visible unlocked user layer", async () => {
    const ids = await createDocument();
    const customId = await directLayer(ids);
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
  });

  await t.test("authenticated delete is revoked and has no policy path", async () => {
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
  });

  await t.test("trusted direct deletes still cannot break layer invariants", async () => {
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
  });
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
  await workspaceServer.applyDrawingOperation(client, operationInput(added.operation));
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
