import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

import { parseVerifiedBoqV1_1RpcInput } from "../app/lukas/lib/drawing-quantity-lineage.server.ts";
import { calculateVerifiedBoqV1_1 } from "../app/lukas/lib/verified-boq-v1-1.server.ts";
import { buildDrawingDxfImportPlan } from "../app/lukas/lib/drawing-dxf-import-plan.server.ts";

const OWNER = "00000000-0000-4000-8000-000000000101";
const REVIEWER = "00000000-0000-4000-8000-000000000102";
const APPROVER = "00000000-0000-4000-8000-000000000103";
const VIEWER = "00000000-0000-4000-8000-000000000104";
const EDITOR = "00000000-0000-4000-8000-000000000105";
const DXF_SHA = "d".repeat(64);
const PDF_SHA = "a".repeat(64);
const IFC_SHA = "b".repeat(64);
const FOREIGN_DXF_SHA = "e".repeat(64);
const MUTABLE_DXF_SHA = "f".repeat(64);
const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const fixtureUrl = new URL(
  "./fixtures/drawing-workspace-dxf-source-foundation.sql",
  import.meta.url,
);
const migrationSuffix = "_drawing_workspace_m4_dxf_entity_source_authority.sql";
const STYLE = { stroke: "#112233", strokeWidth: 1, fill: null };

let db;
let projectId;
let foreignProjectId;
let dxfFile;
let pdfFile;
let ifcFile;
let foreignDxfFile;
let mutableDxfFile;

async function migrationEntries() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.equal(
    names.filter((name) => name.endsWith(migrationSuffix)).length,
    1,
    "one DXF source authority migration is installed",
  );
  return names;
}

async function freshDatabase() {
  const target = new PGlite({ extensions: { pgcrypto } });
  await target.exec(await readFile(fixtureUrl, "utf8"));
  for (const name of await migrationEntries())
    await target.exec(
      await readFile(new URL(name, migrationsDirectory), "utf8"),
    );
  return target;
}

async function setSession(role, actorId) {
  await db.exec("reset role");
  await db.exec(`set role ${role}`);
  await db.query(
    "select pg_catalog.set_config('request.jwt.claims',$1,false)",
    [
      JSON.stringify({
        role,
        sub: actorId,
        is_anonymous: false,
        app_metadata: {},
      }),
    ],
  );
}

async function resetSession() {
  await db.exec("reset role");
  await db.query("select pg_catalog.set_config('request.jwt.claims','',false)");
}

async function setPrivilegedAuthenticatedClaims(actorId = OWNER) {
  await resetSession();
  await db.query(
    "select pg_catalog.set_config('request.jwt.claims',$1,false)",
    [
      JSON.stringify({
        role: "authenticated",
        sub: actorId,
        is_anonymous: false,
        app_metadata: {},
      }),
    ],
  );
}

async function assertSqlState(promise, codes) {
  await assert.rejects(promise, (error) => {
    assert.ok(codes.includes(error.code), `${error.code}: ${error.message}`);
    return true;
  });
}

async function createProject(name) {
  await setSession("authenticated", OWNER);
  const result = await db.query(
    `insert into public.lukas_qto_projects(
      owner_id,name,description,contact_name,contact_phone,workflow_status
    ) values($1,$2,'','','','inquiry_received')
    returning id`,
    [OWNER, name],
  );
  return result.rows[0].id;
}

async function insertFile({
  id = randomUUID(),
  project,
  kind,
  sha256,
  immutable = true,
}) {
  const storagePath = `${OWNER}/${project}/source-uploads/${id}.${kind}`;
  await resetSession();
  await db.query(
    `insert into public.lukas_qto_files(
      id,project_id,uploaded_by,kind,storage_path,original_filename,
      content_type,byte_size,sha256,immutable
    ) values($1,$2,$3,$4,$5,$6,'application/octet-stream',17,$7,$8)`,
    [id, project, OWNER, kind, storagePath, `${id}.${kind}`, sha256, immutable],
  );
  await db.query(
    "insert into storage.objects(bucket_id,name) values('lukas-qto',$1)",
    [storagePath],
  );
  return { id, projectId: project, kind, sha256, immutable };
}

function flattenedInsertDxf() {
  return new TextEncoder().encode(
    [
      "0",
      "SECTION",
      "2",
      "HEADER",
      "9",
      "$INSUNITS",
      "70",
      "4",
      "0",
      "ENDSEC",
      "0",
      "SECTION",
      "2",
      "TABLES",
      "0",
      "TABLE",
      "2",
      "LAYER",
      "70",
      "1",
      "0",
      "LAYER",
      "2",
      "BLOCKS",
      "70",
      "0",
      "62",
      "7",
      "0",
      "ENDTAB",
      "0",
      "ENDSEC",
      "0",
      "SECTION",
      "2",
      "BLOCKS",
      "0",
      "BLOCK",
      "8",
      "0",
      "2",
      "UNIT",
      "3",
      "UNIT",
      "70",
      "0",
      "10",
      "1",
      "20",
      "1",
      "30",
      "0",
      "0",
      "LINE",
      "5",
      "B10C",
      "8",
      "0",
      "10",
      "1",
      "20",
      "1",
      "11",
      "2",
      "21",
      "1",
      "0",
      "ENDBLK",
      "0",
      "ENDSEC",
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "INSERT",
      "5",
      "7A0",
      "8",
      "BLOCKS",
      "2",
      "UNIT",
      "10",
      "10",
      "20",
      "20",
      "41",
      "2",
      "42",
      "2",
      "43",
      "1",
      "50",
      "90",
      "0",
      "ENDSEC",
      "0",
      "EOF",
      "",
    ].join("\n"),
  );
}

async function createDocument(title) {
  await setSession("authenticated", OWNER);
  const result = await db.query(
    `select public.lukas_drawing_create_document_idempotent(
      $1,null,$2,true,$3,null
    ) value`,
    [projectId, title, randomUUID()],
  );
  const document = result.rows[0].value;
  await resetSession();
  const layer = await db.query(
    "select name from public.lukas_drawing_layers where id=$1",
    [document.workLayerId],
  );
  return { ...document, workLayerName: layer.rows[0].name };
}

function circleObject(document, overrides = {}) {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    name: "DXF circle",
    layerId: document.workLayerId,
    geometry: { type: "circle", center: { x: 10, y: 20 }, radius: 5 },
    styleId: null,
    style: STYLE,
    version: 1,
    ...overrides,
  };
}

function dxfSource(document, objectId, overrides = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    objectId,
    revisionId: document.revisionId,
    sourceFileId: dxfFile.id,
    sourceSha256: dxfFile.sha256,
    sourceKind: "dxf_entity",
    entityKey: "entities:0",
    entityType: "CIRCLE",
    sourceLayer: document.workLayerName,
    handle: "1A2B",
    unitCode: 4,
    unitSource: "declared",
    importerVersion: 1,
    version: 1,
    ...overrides,
  };
}

async function applyOperationWithId(
  document,
  clientOperationId,
  baseVersions,
  forward,
  inverse,
  options = {},
) {
  return applyTypedOperationWithId(
    document,
    clientOperationId,
    "mutate_structure",
    baseVersions,
    forward,
    inverse,
    options,
  );
}

function operationInput(
  document,
  clientOperationId,
  baseVersions,
  forward,
  inverse,
) {
  return {
    revisionId: document.revisionId,
    clientOperationId,
    type: "mutate_structure",
    baseVersions,
    forward,
    inverse,
    createdAt: "2026-09-05T00:00:00.000Z",
  };
}

function sourceOperation(document, group, layerId = document.workLayerId) {
  const object = circleObject(document, { layerId });
  const source = dxfSource(document, object.id);
  return operationInput(
    document,
    randomUUID(),
    {},
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_object", entity: object, baseVersion: null },
          { kind: "put_source", entity: source, baseVersion: null },
        ],
      },
      group,
    ),
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_source", id: source.id, baseVersion: 1 },
          { kind: "delete_object", id: object.id, baseVersion: 1 },
        ],
      },
      group,
    ),
  );
}

async function applyPlanOperation(document, operation, options) {
  return applyOperationWithId(
    document,
    operation.clientOperationId,
    operation.baseVersions,
    operation.forward,
    operation.inverse,
    options,
  );
}

// Layer-focused regressions still start from an entire attested import.
// Creation precedes the source phase; finalization follows it.
async function applyLayerImportFixture(
  document,
  clientOperationId,
  baseVersions,
  forward,
  inverse,
  { prefixOnly = false } = {},
) {
  const group = forward.historyGroup;
  const creating = forward.actions[0].baseVersion === null;
  Object.assign(group, { index: creating ? 0 : 2, count: creating ? 2 : 3 });
  Object.assign(inverse.historyGroup, group);
  const layerOperation = operationInput(
    document,
    clientOperationId,
    baseVersions,
    forward,
    inverse,
  );
  const source = sourceOperation(
    document,
    historyGroup(group.id, 1, group.count),
    forward.actions[0].entity.id,
  );
  const layer = inverse.actions[0].entity;
  const createGroup = historyGroup(group.id, 0, group.count);
  const create = creating
    ? layerOperation
    : operationInput(
        document,
        randomUUID(),
        {},
        groupedPayload(
          {
            type: "mutate_structure",
            actions: [{ kind: "put_layer", entity: layer, baseVersion: null }],
          },
          createGroup,
        ),
        groupedPayload(
          {
            type: "mutate_structure",
            actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 1 }],
          },
          createGroup,
        ),
      );
  const operations = creating
    ? [create, source]
    : [create, source, layerOperation];
  await attestDxfPlan(document, dxfFile, { operations });
  let result;
  for (const operation of operations.slice(
    0,
    prefixOnly ? 1 : operations.length,
  )) {
    const receipt = await applyPlanOperation(document, operation);
    if (operation === layerOperation) result = receipt;
  }
  return result;
}

async function applyAttestedOperationWithId(
  document,
  clientOperationId,
  baseVersions,
  forward,
  inverse,
) {
  const group = forward.historyGroup;
  Object.assign(group, { index: 1, count: 2 });
  Object.assign(inverse.historyGroup, group);
  const layer = {
    id: randomUUID(),
    name: `Imported DXF ${clientOperationId}`,
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: document.canvasId,
    sortOrder: 20,
    version: 1,
  };
  for (const action of forward.actions)
    if (action.kind === "put_object") action.entity.layerId = layer.id;
  const createGroup = historyGroup(group.id, 0, 2);
  const operations = [
    operationInput(
      document,
      randomUUID(),
      {},
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [{ kind: "put_layer", entity: layer, baseVersion: null }],
        },
        createGroup,
      ),
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 1 }],
        },
        createGroup,
      ),
    ),
    operationInput(document, clientOperationId, baseVersions, forward, inverse),
  ];
  await attestDxfPlan(document, dxfFile, { operations });
  await applyPlanOperation(document, operations[0]);
  return applyPlanOperation(document, operations[1]);
}

async function applyTypedOperationWithId(
  document,
  clientOperationId,
  operationType,
  baseVersions,
  forward,
  inverse,
  { historyAction = null, originalOperationId = null, actorId = OWNER } = {},
) {
  await setSession("authenticated", actorId);
  const result = await db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8
    ) value`,
    [
      document.revisionId,
      clientOperationId,
      operationType,
      JSON.stringify(baseVersions),
      JSON.stringify(forward),
      JSON.stringify(inverse),
      historyAction,
      originalOperationId,
    ],
  );
  return result.rows[0].value;
}

function historyGroup(id, index, count) {
  return { id, kind: "dxf_import", index, count };
}

function groupedPayload(payload, group) {
  return { ...payload, historyGroup: group };
}

async function beginFreeze(document) {
  const requestId = randomUUID();
  await resetSession();
  await db.query(
    `insert into private.lukas_drawing_collaboration_states(
      revision_id,project_id,schema_version,yjs_state,yjs_sha256,
      base_operation_sequence,store_generation,byte_size,persisted_at
    ) values(
      $1,$2,1,decode('01','hex'),
      pg_catalog.encode(extensions.digest(decode('01','hex'),'sha256'),'hex'),
      0,1,1,pg_catalog.now()
    )`,
    [document.revisionId, projectId],
  );
  const result = await db.query(
    `select private.lukas_drawing_collaboration_begin_freeze(
      $1,$2,$3,decode('01','hex'),0
    ) value`,
    [projectId, document.revisionId, requestId],
  );
  assert.equal(result.rows[0].value.state, "freezing");
  return requestId;
}

async function completeFreeze(document, requestId, manifest) {
  const manifestSha256 = createHash("sha256")
    .update(JSON.stringify(manifest))
    .digest("hex");
  const operationStatuses = manifest.map((operation) => ({
    clientOperationId: operation.clientOperationId,
    status: "acked",
    authoritativeSequence: Number(operation.sequence),
    resultVersions: operation.resultVersions,
  }));
  await resetSession();
  return db.query(
    `select private.lukas_drawing_collaboration_complete_freeze(
      $1,$2,$3,decode('02','hex'),$4::jsonb,$5,$6,0,'AQ==',$7::jsonb
    ) value`,
    [
      projectId,
      document.revisionId,
      requestId,
      JSON.stringify(manifest),
      manifestSha256,
      manifest.length,
      JSON.stringify(operationStatuses),
    ],
  );
}

async function operationManifest(document) {
  await resetSession();
  return (
    await db.query(
      `select client_operation_id "clientOperationId",revision_id "revisionId",
        actor_id "actorId",operation_type "operationType",
        base_versions "baseVersions",forward,inverse,
        history_action "historyAction",original_operation_id "originalOperationId",
        sequence,result_versions "resultVersions"
       from public.lukas_drawing_operations
       where revision_id=$1 order by sequence`,
      [document.revisionId],
    )
  ).rows;
}

async function dxfGroupsComplete(document) {
  await resetSession();
  return (
    await db.query(
      "select private.lukas_drawing_dxf_history_groups_complete($1) complete",
      [document.revisionId],
    )
  ).rows[0].complete;
}

async function insertDirectOperation(
  document,
  {
    clientOperationId = randomUUID(),
    operationType = "mutate_structure",
    baseVersions,
    forward,
    inverse,
    resultVersions,
    historyAction = null,
    originalOperationId = null,
    actorId = OWNER,
  },
) {
  return db.query(
    `insert into public.lukas_drawing_operations(
      revision_id,project_id,sequence,client_operation_id,operation_type,
      base_versions,forward,inverse,result_versions,actor_id,
      history_action,original_operation_id
    ) values(
      $1,$2,(
        select coalesce(max(sequence),0)+1
        from public.lukas_drawing_operations where revision_id=$1
      ),$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11
    ) returning id`,
    [
      document.revisionId,
      projectId,
      clientOperationId,
      operationType,
      JSON.stringify(baseVersions),
      JSON.stringify(forward),
      JSON.stringify(inverse),
      JSON.stringify(resultVersions),
      actorId,
      historyAction,
      originalOperationId,
    ],
  );
}

test("a privileged direct group cannot wrap an unchanged baseline layer", async () => {
  const document = await createDocument("DXF baseline group authority");
  const layer = await canonicalLayer(document, document.workLayerId);
  const group = historyGroup(randomUUID(), 0, 1);

  await setPrivilegedAuthenticatedClaims();
  await db.query(
    "select pg_catalog.set_config('private.lukas_drawing_operation_write_token',$1,true)",
    [randomUUID()],
  );
  await assertSqlState(
    insertDirectOperation(document, {
      baseVersions: {},
      forward: groupedPayload(
        {
          type: "mutate_structure",
          actions: [{ kind: "put_layer", entity: layer, baseVersion: null }],
        },
        group,
      ),
      inverse: groupedPayload(
        {
          type: "mutate_structure",
          actions: [
            { kind: "delete_layer", id: layer.id, baseVersion: layer.version },
          ],
        },
        group,
      ),
      resultVersions: { [layer.id]: layer.version },
    }),
    ["P1C01"],
  );
});

test("canonical operation proof survives a session timezone change", async () => {
  const document = await createDocument("DXF timezone-stable proof");
  const clientOperationId = randomUUID();
  const layer = {
    id: randomUUID(),
    name: "TIMEZONE-STABLE",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: document.canvasId,
    sortOrder: 24,
    version: 1,
  };
  const group = historyGroup(randomUUID(), 0, 1);
  const forward = groupedPayload(
    {
      type: "mutate_structure",
      actions: [{ kind: "put_layer", entity: layer, baseVersion: null }],
    },
    group,
  );
  const inverse = groupedPayload(
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 1 }],
    },
    group,
  );
  await applyLayerImportFixture(
    document,
    clientOperationId,
    {},
    forward,
    inverse,
  );

  await resetSession();
  try {
    await db.exec("set timezone to 'UTC'");
    const utc = (
      await db.query(
        `select private.lukas_drawing_operation_envelope_sha256(o) sha
         from public.lukas_drawing_operations o
         where o.client_operation_id=$1`,
        [clientOperationId],
      )
    ).rows[0].sha;
    await db.exec("set timezone to 'Asia/Seoul'");
    const seoul = (
      await db.query(
        `select private.lukas_drawing_operation_envelope_sha256(o) sha
         from public.lukas_drawing_operations o
         where o.client_operation_id=$1`,
        [clientOperationId],
      )
    ).rows[0].sha;
    assert.equal(seoul, utc);
    assert.equal(await dxfGroupsComplete(document), true);
  } finally {
    await db.exec("set timezone to 'UTC'");
  }
});

async function canonicalLayer(document, layerId) {
  await resetSession();
  return (
    await db.query(
      `select private.lukas_drawing_structure_entity_json(
        'layer',$1,$2,$3
      ) layer`,
      [layerId, document.revisionId, projectId],
    )
  ).rows[0].layer;
}

async function canonicalObjectSource(document, objectId, sourceId) {
  await resetSession();
  return (
    await db.query(
      `select
        private.lukas_drawing_structure_entity_json(
          'object',$1,$2,$3
        ) object,
        private.lukas_drawing_source_json($4,$2,$3,true) source`,
      [objectId, document.revisionId, projectId, sourceId],
    )
  ).rows[0];
}

async function putObjectAndSource(
  document,
  object,
  source,
  clientOperationId = randomUUID(),
) {
  const group = historyGroup(clientOperationId, 0, 1);
  const forward = groupedPayload(
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_object", entity: object, baseVersion: null },
        { kind: "put_source", entity: source, baseVersion: null },
      ],
    },
    group,
  );
  const inverse = groupedPayload(
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_source", id: source.id, baseVersion: 1 },
        { kind: "delete_object", id: object.id, baseVersion: 1 },
      ],
    },
    group,
  );
  return {
    forward,
    inverse,
    result: await applyAttestedOperationWithId(
      document,
      clientOperationId,
      {},
      forward,
      inverse,
    ),
  };
}

async function addSource(document, source) {
  return applyOperationWithId(
    document,
    randomUUID(),
    {},
    {
      type: "mutate_structure",
      actions: [{ kind: "put_source", entity: source, baseVersion: null }],
    },
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_source", id: source.id, baseVersion: 1 }],
    },
  );
}

async function recordDecision(actor, document, review, decision, note) {
  await setSession("authenticated", actor);
  return db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,$4,$5
    ) value`,
    [
      document.revisionId,
      review.subjectVersion,
      review.snapshotSha256,
      decision,
      note,
    ],
  );
}

before(async () => {
  db = await freshDatabase();
  await resetSession();
  await db.query("insert into auth.users(id) values($1),($2),($3),($4),($5)", [
    OWNER,
    REVIEWER,
    APPROVER,
    VIEWER,
    EDITOR,
  ]);
  projectId = await createProject("DXF source authority");
  foreignProjectId = await createProject("Foreign DXF source authority");
  await resetSession();
  await db.query(
    `insert into public.lukas_qto_project_members(project_id,user_id,role)
     values($1,$2,'reviewer'),($1,$3,'approver'),($1,$4,'viewer'),
       ($1,$5,'estimator')`,
    [projectId, REVIEWER, APPROVER, VIEWER, EDITOR],
  );
  dxfFile = await insertFile({
    project: projectId,
    kind: "dxf",
    sha256: DXF_SHA,
  });
  pdfFile = await insertFile({
    project: projectId,
    kind: "pdf",
    sha256: PDF_SHA,
  });
  ifcFile = await insertFile({
    project: projectId,
    kind: "ifc",
    sha256: IFC_SHA,
  });
  foreignDxfFile = await insertFile({
    project: foreignProjectId,
    kind: "dxf",
    sha256: FOREIGN_DXF_SHA,
  });
  mutableDxfFile = await insertFile({
    project: projectId,
    kind: "dxf",
    sha256: MUTABLE_DXF_SHA,
    immutable: false,
  });
});

after(async () => {
  await db?.close();
});

async function attestDxfPlan(
  document,
  source,
  plan,
  {
    actorId = OWNER,
    project = projectId,
    role = "service_role",
    claimRole = role,
  } = {},
) {
  await setSession(role, actorId);
  if (claimRole !== role)
    await db.query(
      "select pg_catalog.set_config('request.jwt.claims',$1,false)",
      [JSON.stringify({ role: claimRole, sub: actorId, is_anonymous: false })],
    );
  const result = await db.query(
    `select public.lukas_drawing_attest_dxf_import_plan(
      $1,$2,$3,$4,$5,$6,$7::jsonb
    ) value`,
    [
      actorId,
      project,
      document.revisionId,
      document.canvasId,
      source.id,
      source.sha256,
      JSON.stringify(plan.operations),
    ],
  );
  return result.rows[0].value;
}

async function attestationFixture(title) {
  const document = await createDocument(title);
  const source = await insertFile({
    project: projectId,
    kind: "dxf",
    sha256: createHash("sha256").update(flattenedInsertDxf()).digest("hex"),
  });
  const plan = await buildDrawingDxfImportPlan({
    bytes: flattenedInsertDxf(),
    revisionId: document.revisionId,
    canvasId: document.canvasId,
    sourceFileId: source.id,
    createdAt: "2026-09-05T00:00:00.000Z",
  });
  return { document, source, plan };
}

async function proofState(document) {
  await resetSession();
  return (
    await db.query(
      `select count(*)::integer issued,
    count(consumed_operation_id)::integer consumed
    from private.lukas_drawing_dxf_plan_attestations where revision_id=$1`,
      [document.revisionId],
    )
  ).rows[0];
}

function reindexPlan(operations) {
  const copy = structuredClone(operations);
  copy.forEach((operation, index) => {
    for (const payload of [operation.forward, operation.inverse])
      Object.assign(payload.historyGroup, { index, count: copy.length });
  });
  return { operations: copy };
}

test("issuer authority, target bindings, complete topology, and exact re-attestation fail closed", async () => {
  const { document, source, plan } = await attestationFixture(
    "DXF issuer bindings",
  );
  const other = await createDocument("DXF other revision");
  const sourcePhase = plan.operations.at(-1);
  const changedSource = structuredClone(plan);
  changedSource.operations
    .at(-1)
    .forward.actions.find((a) => a.kind === "put_source").entity.sourceSha256 =
    DXF_SHA;
  const existingLayer = structuredClone(plan);
  existingLayer.operations
    .at(-1)
    .forward.actions.find((a) => a.kind === "put_object").entity.layerId =
    other.workLayerId;
  const badCanvas = structuredClone(plan);
  badCanvas.operations[0].forward.actions[0].entity.canvasId = other.canvasId;
  const wrongRevision = structuredClone(plan);
  wrongRevision.operations.at(-1).revisionId = other.revisionId;
  const missingRevision = structuredClone(plan);
  delete missingRevision.operations.at(-1).revisionId;
  const duplicateId = structuredClone(plan);
  duplicateId.operations.at(-1).clientOperationId =
    duplicateId.operations[0].clientOperationId;
  const invalid = [
    [document, source, plan, { role: "authenticated" }, "42501"],
    [document, source, plan, { claimRole: null }, "P1C01"],
    [document, source, plan, { actorId: VIEWER }, "P1C01"],
    [document, source, plan, { project: foreignProjectId }, "P1C01"],
    [other, source, plan, {}, "P1C01"],
    [{ ...document, canvasId: other.canvasId }, source, plan, {}, "P1C01"],
    [document, foreignDxfFile, plan, {}, "P1C01"],
    [document, pdfFile, plan, {}, "P1C01"],
    [document, mutableDxfFile, plan, {}, "P1C01"],
    [document, { ...source, sha256: DXF_SHA }, plan, {}, "P1C01"],
    ...[
      changedSource,
      existingLayer,
      badCanvas,
      wrongRevision,
      missingRevision,
      duplicateId,
      { operations: plan.operations.slice(0, -1) },
      reindexPlan([...plan.operations].reverse()),
      reindexPlan([sourcePhase]),
      reindexPlan([plan.operations[0]]),
      { operations: [plan.operations[0], plan.operations[0]] },
    ].map((candidate) => [document, source, candidate, {}, "P1C01"]),
  ];
  for (const [target, file, candidate, options, code] of invalid) {
    await assertSqlState(attestDxfPlan(target, file, candidate, options), [
      code,
    ]);
    assert.deepEqual(await proofState(document), { issued: 0, consumed: 0 });
  }
  const first = await attestDxfPlan(document, source, plan);
  assert.equal(first.alreadyAppliedCount, 0);
  assert.deepEqual(await attestDxfPlan(document, source, plan), first);
  const changed = structuredClone(plan);
  changed.operations
    .at(-1)
    .forward.actions.find(
      (a) => a.kind === "put_object",
    ).entity.geometry.start.x += 1;
  await assertSqlState(attestDxfPlan(document, source, changed), ["P1C01"]);
  await assertSqlState(
    attestDxfPlan(document, source, plan, { actorId: EDITOR }),
    ["P1C01"],
  );
  await applyPlanOperation(document, plan.operations[0]);
  await assertSqlState(
    applyPlanOperation(document, sourcePhase, { actorId: EDITOR }),
    ["P1C01"],
  );
  const stripped = structuredClone(sourcePhase);
  delete stripped.forward.historyGroup;
  delete stripped.inverse.historyGroup;
  await assertSqlState(applyPlanOperation(document, stripped), ["P1C01"]);
  assert.deepEqual(await proofState(document), {
    issued: plan.operations.length,
    consumed: 1,
  });
  assert.equal((await operationManifest(document)).length, 1);
  await resetSession();
  assert.equal(
    (
      await db.query(
        "select count(*)::integer n from public.lukas_drawing_object_sources where revision_id=$1",
        [document.revisionId],
      )
    ).rows[0].n,
    0,
  );
  for (const role of ["authenticated", "service_role"]) {
    await setSession(role, OWNER);
    await assertSqlState(
      db.query("select * from private.lukas_drawing_dxf_plan_attestations"),
      ["42501"],
    );
  }
});

for (const phase of ["layer_delete", "object_source_delete"])
  test(`issuer rejects inherited ${phase} phases without issuing partial proofs`, async () => {
    const { document, source, plan } = await attestationFixture(
      `DXF rejected ${phase}`,
    );
    const original = plan.operations[phase === "layer_delete" ? 0 : 1];
    const deletion = operationInput(
      document,
      randomUUID(),
      Object.fromEntries(
        original.inverse.actions.map((action) => [
          action.id,
          action.baseVersion,
        ]),
      ),
      structuredClone(original.inverse),
      structuredClone(original.forward),
    );
    const candidate = reindexPlan([...plan.operations, deletion]);
    const last = candidate.operations.at(-1);
    await resetSession();
    const recognized = await db.query(
      `select private.lukas_drawing_dxf_import_phase(
      $1::jsonb,$2::jsonb,$3::jsonb) phase`,
      [
        JSON.stringify(last.baseVersions),
        JSON.stringify(last.forward),
        JSON.stringify(last.inverse),
      ],
    );
    assert.equal(
      recognized.rows[0].phase,
      phase,
      "the shared history classifier recognizes a valid deletion phase",
    );
    await assertSqlState(attestDxfPlan(document, source, candidate), ["P1C01"]);
    assert.deepEqual(await proofState(document), { issued: 0, consumed: 0 });
    assert.deepEqual(await operationManifest(document), []);
  });

test("additive rollout reconciles exact committed prefixes with absent or unconsumed proofs", async () => {
  for (const preissued of [false, true]) {
    const { document, source, plan } = await attestationFixture(
      `DXF additive ${preissued}`,
    );
    if (preissued) await attestDxfPlan(document, source, plan);
    // Simulate the additive foundation window before enforcement is installed.
    await resetSession();
    await db.exec(
      "alter table public.lukas_drawing_operations disable trigger lukas_drawing_z_dxf_plan_attestation_guard",
    );
    let prefix;
    try {
      prefix = await applyPlanOperation(document, plan.operations[0]);
    } finally {
      await resetSession();
      await db.exec(
        "alter table public.lukas_drawing_operations enable trigger lukas_drawing_z_dxf_plan_attestation_guard",
      );
    }
    assert.deepEqual(await proofState(document), {
      issued: preissued ? plan.operations.length : 0,
      consumed: 0,
    });
    const receipt = await attestDxfPlan(document, source, plan);
    assert.equal(receipt.alreadyAppliedCount, 1);
    assert.deepEqual(await attestDxfPlan(document, source, plan), receipt);
    const changedPrefix = structuredClone(plan);
    changedPrefix.operations[0].forward.actions[0].entity.name += " changed";
    await assertSqlState(attestDxfPlan(document, source, changedPrefix), [
      "P1C01",
    ]);
    assert.deepEqual(await proofState(document), {
      issued: plan.operations.length,
      consumed: 1,
    });
    assert.deepEqual(
      await applyPlanOperation(document, plan.operations[0]),
      prefix,
    );
    for (const operation of plan.operations.slice(1))
      await applyPlanOperation(document, operation);
    assert.deepEqual(await proofState(document), {
      issued: plan.operations.length,
      consumed: plan.operations.length,
    });
    assert.equal(await dxfGroupsComplete(document), true);
  }
});

test("re-attestation rejects rogue, sparse, and reordered legacy group members atomically", async () => {
  for (const mode of ["rogue", "sparse", "reordered"]) {
    const { document, source, plan } = await attestationFixture(
      `DXF legacy ${mode}`,
    );
    // Model corrupt legacy ledger rows predating the operation guards. Restore
    // all guards before exercising the issuer; failed issuance must add no proof.
    await resetSession();
    await db.exec("begin");
    try {
      await db.exec(
        "alter table public.lukas_drawing_operations disable trigger user",
      );
      const originals =
        mode === "reordered"
          ? [...plan.operations].reverse()
          : [plan.operations[mode === "sparse" ? 1 : 0]];
      for (const operation of originals)
        await insertDirectOperation(document, {
          clientOperationId:
            mode === "rogue" ? randomUUID() : operation.clientOperationId,
          baseVersions: operation.baseVersions,
          forward: operation.forward,
          inverse: operation.inverse,
          resultVersions: {},
        });
      await db.exec(
        "alter table public.lukas_drawing_operations enable trigger user",
      );
      await db.exec("commit");
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
    await assertSqlState(attestDxfPlan(document, source, plan), ["P1C01"]);
    assert.deepEqual(await proofState(document), { issued: 0, consumed: 0 });
    assert.equal(
      (await operationManifest(document)).length,
      mode === "reordered" ? plan.operations.length : 1,
    );
  }
});

test("reference-aware original, undo, and redo rewrites cannot introduce a novel DXF source", async () => {
  for (const historyAction of [null, "undo", "redo"]) {
    const document = await createDocument(
      `DXF reference rewrite ${historyAction}`,
    );
    const object = circleObject(document);
    await applyTypedOperationWithId(
      document,
      randomUUID(),
      "add_objects",
      {},
      { type: "add_objects", objects: [object] },
      { type: "delete_objects", objectIds: [object.id] },
    );
    const payload = (action, version, actions = []) => ({
      type: "mutate_objects_with_references",
      objectAction: action,
      objects: [{ ...object, version }],
      actions,
    });
    const removeId = randomUUID();
    await applyTypedOperationWithId(
      document,
      removeId,
      "mutate_objects_with_references",
      { [object.id]: 1 },
      payload("delete", 1),
      payload("restore", 3),
    );
    let originalOperationId = historyAction ? removeId : null;
    let version = 3;
    if (historyAction === "redo") {
      originalOperationId = randomUUID();
      await applyTypedOperationWithId(
        document,
        originalOperationId,
        "mutate_objects_with_references",
        { [object.id]: 2 },
        payload("restore", 3),
        payload("delete", 3),
      );
      await applyTypedOperationWithId(
        document,
        randomUUID(),
        "mutate_objects_with_references",
        { [object.id]: 3 },
        payload("delete", 3),
        payload("restore", 5),
        { historyAction: "undo", originalOperationId },
      );
      version = 5;
    }
    const source = dxfSource(document, object.id);
    const before = await operationManifest(document);
    await assert.rejects(
      applyTypedOperationWithId(
        document,
        randomUUID(),
        "mutate_objects_with_references",
        { [object.id]: version - 1 },
        payload("restore", version, [
          { kind: "put_source", entity: source, baseVersion: null },
        ]),
        payload("delete", version, [
          { kind: "delete_source", id: source.id, baseVersion: 1 },
        ]),
        { historyAction, originalOperationId },
      ),
      (error) => {
        assert.equal(error.code, "P1C01");
        assert.match(
          error.message,
          /DXF reference rewrite requires a server plan/,
        );
        return true;
      },
    );
    assert.deepEqual(await operationManifest(document), before);
    await resetSession();
    assert.deepEqual(
      (
        await db.query(
          `select status,version,
      (select count(*)::integer from public.lukas_drawing_object_sources where revision_id=$1) sources
      from public.lukas_drawing_objects where id=$2`,
          [document.revisionId, object.id],
        )
      ).rows,
      [{ status: "deleted", version: version - 1, sources: 0 }],
    );
    assert.deepEqual(await proofState(document), { issued: 0, consumed: 0 });
  }
});

test("a real server plan requires service attestation and rejects a one-coordinate mutation atomically", async () => {
  const document = await createDocument("DXF plan attestation runtime");
  const source = await insertFile({
    project: projectId,
    kind: "dxf",
    sha256: createHash("sha256").update(flattenedInsertDxf()).digest("hex"),
  });
  const plan = await buildDrawingDxfImportPlan({
    bytes: flattenedInsertDxf(),
    revisionId: document.revisionId,
    canvasId: document.canvasId,
    sourceFileId: source.id,
    createdAt: "2026-09-05T00:00:00.000Z",
  });
  assert.ok(plan.operations.length > 0);

  await assertSqlState(
    applyOperationWithId(
      document,
      plan.operations[0].clientOperationId,
      plan.operations[0].baseVersions,
      plan.operations[0].forward,
      plan.operations[0].inverse,
      { attest: false },
    ),
    ["P1T01"],
  );
  await attestDxfPlan(document, source, plan);

  const sourcePhaseIndex = plan.operations.findIndex((operation) =>
    operation.forward.actions.some((action) => action.kind === "put_source"),
  );
  assert.ok(sourcePhaseIndex > 0);
  for (const operation of plan.operations.slice(0, sourcePhaseIndex))
    await applyOperationWithId(
      document,
      operation.clientOperationId,
      operation.baseVersions,
      operation.forward,
      operation.inverse,
      { attest: false },
    );
  const phase = plan.operations[sourcePhaseIndex];
  const changed = structuredClone(phase);
  const sourceAction = changed.forward.actions.find(
    (action) => action.kind === "put_object",
  );
  if (
    sourceAction?.kind === "put_object" &&
    sourceAction.entity.geometry.type === "line"
  )
    sourceAction.entity.geometry.start.x += 1;
  else {
    const objectAction = changed.forward.actions.find(
      (action) => action.kind === "put_object",
    );
    assert.ok(objectAction?.kind === "put_object");
    objectAction.entity.name = `${objectAction.entity.name} changed`;
  }
  await assertSqlState(
    applyOperationWithId(
      document,
      phase.clientOperationId,
      phase.baseVersions,
      changed.forward,
      changed.inverse,
      { attest: false },
    ),
    ["P1C01"],
  );
  await resetSession();
  const rejected = await db.query(
    `select count(*)::integer operations,
      (select count(*)::integer from public.lukas_drawing_objects where revision_id=$1) objects,
      (select count(*)::integer from public.lukas_drawing_object_sources where revision_id=$1) sources
     from public.lukas_drawing_operations where revision_id=$1`,
    [document.revisionId],
  );
  assert.deepEqual(rejected.rows, [
    { operations: sourcePhaseIndex, objects: 0, sources: 0 },
  ]);
  assert.deepEqual(await proofState(document), {
    issued: plan.operations.length,
    consumed: sourcePhaseIndex,
  });

  for (const operation of plan.operations.slice(sourcePhaseIndex))
    await applyOperationWithId(
      document,
      operation.clientOperationId,
      operation.baseVersions,
      operation.forward,
      operation.inverse,
      { attest: false },
    );
});

test("an explicitly discarded DXF plan operation stays terminal before attestation recovery", async () => {
  const document = await createDocument("DXF discarded attestation recovery");
  const source = await insertFile({
    project: projectId,
    kind: "dxf",
    sha256: createHash("sha256").update(flattenedInsertDxf()).digest("hex"),
  });
  const plan = await buildDrawingDxfImportPlan({
    bytes: flattenedInsertDxf(),
    revisionId: document.revisionId,
    canvasId: document.canvasId,
    sourceFileId: source.id,
    createdAt: "2026-09-05T00:00:00.000Z",
  });
  const operation = plan.operations[0];

  await setSession("authenticated", OWNER);
  const discarded = await db.query(
    `select public.lukas_drawing_discard_operation_suffix(
      $1,$2::jsonb
    ) value`,
    [document.revisionId, JSON.stringify([operation])],
  );
  assert.equal(discarded.rows[0].value.dispositions[0].status, "rejected");

  await assertSqlState(applyPlanOperation(document, operation), ["P1R01"]);
  const changed = structuredClone(operation);
  changed.forward.actions[0].entity.name += " changed";
  await assert.rejects(applyPlanOperation(document, changed), (error) => {
    assert.equal(error.code, "P1C01");
    assert.match(error.message, /discarded request/i);
    return true;
  });
  assert.deepEqual(await operationManifest(document), []);
  assert.deepEqual(await proofState(document), { issued: 0, consumed: 0 });
});

test("canonical DXF three-phase plan persists, resumes, finalizes v1 to v2, and rejects mixed compounds", async () => {
  const document = await createDocument("DXF three-phase persistence");
  const layer = {
    id: randomUUID(),
    name: "A-HIDDEN",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: document.canvasId,
    sortOrder: 20,
    version: 1,
  };
  const layerCreateId = randomUUID();
  const planId = randomUUID();
  const layerCreateForward = groupedPayload(
    {
      type: "mutate_structure",
      actions: [{ kind: "put_layer", entity: layer, baseVersion: null }],
    },
    historyGroup(planId, 0, 3),
  );
  const layerCreateInverse = groupedPayload(
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 1 }],
    },
    historyGroup(planId, 0, 3),
  );
  const object = circleObject(document, { layerId: layer.id });
  const source = dxfSource(document, object.id, { sourceLayer: "0" });
  const objectSourceId = randomUUID();
  const objectSourceForward = groupedPayload(
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_object", entity: object, baseVersion: null },
        { kind: "put_source", entity: source, baseVersion: null },
      ],
    },
    historyGroup(planId, 1, 3),
  );
  const objectSourceInverse = groupedPayload(
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_source", id: source.id, baseVersion: 1 },
        { kind: "delete_object", id: object.id, baseVersion: 1 },
      ],
    },
    historyGroup(planId, 1, 3),
  );
  const finalizedLayer = { ...layer, visible: false, locked: true };
  const finalizeId = randomUUID();
  const finalizeForward = groupedPayload(
    {
      type: "mutate_structure",
      actions: [{ kind: "put_layer", entity: finalizedLayer, baseVersion: 1 }],
    },
    historyGroup(planId, 2, 3),
  );
  const finalizeInverse = groupedPayload(
    {
      type: "mutate_structure",
      actions: [{ kind: "put_layer", entity: layer, baseVersion: 2 }],
    },
    historyGroup(planId, 2, 3),
  );
  await attestDxfPlan(document, dxfFile, {
    operations: [
      {
        clientOperationId: layerCreateId,
        revisionId: document.revisionId,
        type: "mutate_structure",
        baseVersions: {},
        forward: layerCreateForward,
        inverse: layerCreateInverse,
        createdAt: "2026-09-05T00:00:00.000Z",
      },
      {
        clientOperationId: objectSourceId,
        revisionId: document.revisionId,
        type: "mutate_structure",
        baseVersions: {},
        forward: objectSourceForward,
        inverse: objectSourceInverse,
        createdAt: "2026-09-05T00:00:00.000Z",
      },
      {
        clientOperationId: finalizeId,
        revisionId: document.revisionId,
        type: "mutate_structure",
        baseVersions: { [layer.id]: 1 },
        forward: finalizeForward,
        inverse: finalizeInverse,
        createdAt: "2026-09-05T00:00:00.000Z",
      },
    ],
  });
  const layerCreated = await applyOperationWithId(
    document,
    layerCreateId,
    {},
    layerCreateForward,
    layerCreateInverse,
    { attest: false },
  );
  const objectSource = {
    forward: objectSourceForward,
    inverse: objectSourceInverse,
    result: await applyOperationWithId(
      document,
      objectSourceId,
      {},
      objectSourceForward,
      objectSourceInverse,
      { attest: false },
    ),
  };
  assert.equal(layerCreated.resultVersions[layer.id], 1);
  assert.equal(objectSource.result.resultVersions[object.id], 1);
  assert.equal(objectSource.result.resultVersions[source.id], 1);
  const finalized = await applyOperationWithId(
    document,
    finalizeId,
    { [layer.id]: 1 },
    finalizeForward,
    finalizeInverse,
  );
  assert.equal(finalized.resultVersions[layer.id], 2);
  assert.deepEqual(
    await applyOperationWithId(
      document,
      finalizeId,
      { [layer.id]: 1 },
      finalizeForward,
      finalizeInverse,
    ),
    finalized,
  );

  const mixedLayer = {
    ...layer,
    id: randomUUID(),
    name: "A-MIXED",
    sortOrder: 21,
  };
  const mixedObject = circleObject(document, { layerId: mixedLayer.id });
  const mixedSource = dxfSource(document, mixedObject.id);
  await assertSqlState(
    applyOperationWithId(
      document,
      randomUUID(),
      {},
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_layer", entity: mixedLayer, baseVersion: null },
          { kind: "put_object", entity: mixedObject, baseVersion: null },
          { kind: "put_source", entity: mixedSource, baseVersion: null },
        ],
      },
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_source", id: mixedSource.id, baseVersion: 1 },
          { kind: "delete_object", id: mixedObject.id, baseVersion: 1 },
          { kind: "delete_layer", id: mixedLayer.id, baseVersion: 1 },
        ],
      },
    ),
    ["P1C01", "P1R01"],
  );

  const wrongTypeObject = circleObject(document);
  const wrongTypeSource = dxfSource(document, wrongTypeObject.id, {
    entityType: "LINE",
  });
  await assertSqlState(
    putObjectAndSource(document, wrongTypeObject, wrongTypeSource),
    ["P1C01"],
  );

  await resetSession();
  const persisted = await db.query(
    `select l.visible,l.locked,l.version,
      (select status from public.lukas_drawing_objects where id=$2) object_status,
      (select status from public.lukas_drawing_object_sources where id=$3) source_status,
      (select count(*)::integer from public.lukas_drawing_operations
        where id in($4,$5,$6)) operation_count,
      (select count(*)::integer from public.lukas_drawing_layers where id=$7) mixed_count
     from public.lukas_drawing_layers l where l.id=$1`,
    [
      layer.id,
      object.id,
      source.id,
      layerCreated.operationId,
      objectSource.result.operationId,
      finalized.operationId,
      mixedLayer.id,
    ],
  );
  assert.deepEqual(persisted.rows, [
    {
      visible: false,
      locked: true,
      version: 2,
      object_status: "active",
      source_status: "active",
      operation_count: 3,
      mixed_count: 0,
    },
  ]);
});

test("DXF history group metadata is required and exact for new imports", async () => {
  const document = await createDocument("DXF strict history group metadata");
  const groupId = randomUUID();
  const cases = [
    {
      forwardGroup: historyGroup(groupId, 0, 1),
      inverseGroup: undefined,
    },
    {
      forwardGroup: historyGroup(groupId, 0, 1),
      inverseGroup: historyGroup(randomUUID(), 0, 1),
    },
    {
      forwardGroup: { ...historyGroup(groupId, 0, 1), extra: true },
      inverseGroup: { ...historyGroup(groupId, 0, 1), extra: true },
    },
    {
      forwardGroup: { ...historyGroup(groupId, 0, 1), id: "not-a-uuid" },
      inverseGroup: { ...historyGroup(groupId, 0, 1), id: "not-a-uuid" },
    },
    {
      forwardGroup: { ...historyGroup(groupId, 0, 1), kind: "other" },
      inverseGroup: { ...historyGroup(groupId, 0, 1), kind: "other" },
    },
    {
      forwardGroup: historyGroup(groupId, -1, 1),
      inverseGroup: historyGroup(groupId, -1, 1),
    },
    {
      forwardGroup: historyGroup(groupId, 1, 1),
      inverseGroup: historyGroup(groupId, 1, 1),
    },
    {
      forwardGroup: historyGroup(groupId, 0, 49),
      inverseGroup: historyGroup(groupId, 0, 49),
    },
  ];

  for (const candidate of cases) {
    const object = circleObject(document);
    const source = dxfSource(document, object.id);
    const forward = {
      type: "mutate_structure",
      actions: [
        { kind: "put_object", entity: object, baseVersion: null },
        { kind: "put_source", entity: source, baseVersion: null },
      ],
      ...(candidate.forwardGroup
        ? { historyGroup: candidate.forwardGroup }
        : {}),
    };
    const inverse = {
      type: "mutate_structure",
      actions: [
        { kind: "delete_source", id: source.id, baseVersion: 1 },
        { kind: "delete_object", id: object.id, baseVersion: 1 },
      ],
      ...(candidate.inverseGroup
        ? { historyGroup: candidate.inverseGroup }
        : {}),
    };
    await assertSqlState(
      applyOperationWithId(document, randomUUID(), {}, forward, inverse),
      ["P1C01"],
    );
    await resetSession();
    assert.equal(
      (
        await db.query(
          "select count(*)::integer count from public.lukas_drawing_objects where id=$1",
          [object.id],
        )
      ).rows[0].count,
      0,
    );
  }
});

test("ungrouped P2 layer rename, reorder, and canvas moves are not DXF finalization", async () => {
  const document = await createDocument("Generic layer update regression");
  const secondaryCanvas = {
    id: randomUUID(),
    pageId: document.pageId,
    name: "Generic secondary canvas",
    spaceKind: "model",
    widthMillimeters: 100,
    heightMillimeters: 100,
    background: null,
    sortOrder: 10,
    version: 1,
  };
  const movingLayer = {
    id: randomUUID(),
    name: "Generic custom layer",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: secondaryCanvas.id,
    sortOrder: 20,
    version: 1,
  };
  const companionLayer = {
    id: randomUUID(),
    name: "Generic companion layer",
    visible: true,
    locked: false,
    canvasId: secondaryCanvas.id,
    sortOrder: 21,
    version: 1,
  };
  await applyOperationWithId(
    document,
    randomUUID(),
    {},
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_canvas", entity: secondaryCanvas, baseVersion: null },
        { kind: "put_layer", entity: movingLayer, baseVersion: null },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_layer", id: movingLayer.id, baseVersion: 1 },
        { kind: "delete_canvas", id: secondaryCanvas.id, baseVersion: 1 },
      ],
    },
  );
  await applyTypedOperationWithId(
    document,
    randomUUID(),
    "add_layer",
    { [companionLayer.id]: 1 },
    { type: "add_layer", layer: companionLayer },
    {},
  );

  const originalCustom = await canonicalLayer(document, movingLayer.id);
  const originalWork = await canonicalLayer(document, document.workLayerId);
  const updatedCustom = {
    ...originalCustom,
    name: "Renamed custom layer",
    canvasId: document.canvasId,
    sortOrder: 40,
  };
  const updatedWork = {
    ...originalWork,
    name: "Renamed work layer",
    canvasId: secondaryCanvas.id,
    sortOrder: 41,
  };
  const forward = {
    type: "mutate_structure",
    actions: [
      { kind: "put_layer", entity: updatedCustom, baseVersion: 1 },
      { kind: "put_layer", entity: updatedWork, baseVersion: 1 },
    ],
  };
  const inverse = {
    type: "mutate_structure",
    actions: [
      { kind: "put_layer", entity: originalWork, baseVersion: 2 },
      { kind: "put_layer", entity: originalCustom, baseVersion: 2 },
    ],
  };

  await resetSession();
  const phase = await db.query(
    `select private.lukas_drawing_dxf_import_phase(
      $1::jsonb,$2::jsonb,$3::jsonb
    ) phase`,
    [
      JSON.stringify({
        [movingLayer.id]: 1,
        [document.workLayerId]: 1,
      }),
      JSON.stringify(forward),
      JSON.stringify(inverse),
    ],
  );
  assert.equal(phase.rows[0].phase, null);

  const applied = await applyOperationWithId(
    document,
    randomUUID(),
    { [movingLayer.id]: 1, [document.workLayerId]: 1 },
    forward,
    inverse,
  );
  assert.equal(applied.resultVersions[movingLayer.id], 2);
  assert.equal(applied.resultVersions[document.workLayerId], 2);
  await resetSession();
  const persisted = await db.query(
    `select
      (select name from public.lukas_drawing_layers where id=$1) custom_name,
      (select canvas_id from public.lukas_drawing_layers where id=$1) custom_canvas,
      (select sort_order from public.lukas_drawing_layers where id=$1) custom_order,
      (select name from public.lukas_drawing_layers where id=$2) work_name,
      (select canvas_id from public.lukas_drawing_layers where id=$2) work_canvas,
      (select sort_order from public.lukas_drawing_layers where id=$2) work_order`,
    [movingLayer.id, document.workLayerId],
  );
  assert.deepEqual(persisted.rows, [
    {
      custom_name: updatedCustom.name,
      custom_canvas: document.canvasId,
      custom_order: 40,
      work_name: updatedWork.name,
      work_canvas: secondaryCanvas.id,
      work_order: 41,
    },
  ]);
});

test("ungrouped layer deletion stays on the generic P2 structure authority", async () => {
  const document = await createDocument("Generic layer deletion regression");
  const canvas = {
    id: randomUUID(),
    pageId: document.pageId,
    name: "Generic model",
    spaceKind: "model",
    widthMillimeters: 100,
    heightMillimeters: 100,
    background: null,
    sortOrder: 10,
    version: 1,
  };
  const layer = {
    id: randomUUID(),
    name: "Generic work",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: canvas.id,
    sortOrder: 40,
    version: 1,
  };
  const layerDelete = {
    type: "mutate_structure",
    actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 1 }],
  };
  const layerRestore = {
    type: "mutate_structure",
    actions: [{ kind: "put_layer", entity: layer, baseVersion: null }],
  };

  await resetSession();
  const phase = await db.query(
    `select private.lukas_drawing_dxf_import_phase(
      '{}'::jsonb,$1::jsonb,$2::jsonb
    ) phase`,
    [JSON.stringify(layerDelete), JSON.stringify(layerRestore)],
  );
  assert.equal(phase.rows[0].phase, null);

  await applyOperationWithId(
    document,
    randomUUID(),
    {},
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_canvas", entity: canvas, baseVersion: null },
        { kind: "put_layer", entity: layer, baseVersion: null },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_layer", id: layer.id, baseVersion: 1 },
        { kind: "delete_canvas", id: canvas.id, baseVersion: 1 },
      ],
    },
  );
  const deleted = await applyOperationWithId(
    document,
    randomUUID(),
    { [layer.id]: 1, [canvas.id]: 1 },
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_layer", id: layer.id, baseVersion: 1 },
        { kind: "delete_canvas", id: canvas.id, baseVersion: 1 },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_canvas", entity: canvas, baseVersion: null },
        { kind: "put_layer", entity: layer, baseVersion: null },
      ],
    },
  );

  assert.equal(deleted.resultVersions[layer.id], null);
  assert.equal(deleted.resultVersions[canvas.id], null);
  await resetSession();
  const remaining = await db.query(
    `select
      (select count(*)::integer from public.lukas_drawing_layers where id=$1) layer_count,
      (select count(*)::integer from public.lukas_drawing_canvases where id=$2) canvas_count`,
    [layer.id, canvas.id],
  );
  assert.deepEqual(remaining.rows, [{ layer_count: 0, canvas_count: 0 }]);
});

test("grouped finalization cannot attest an ordinary preexisting layer", async () => {
  const document = await createDocument("DXF ordinary layer then finalize");
  const layerInput = {
    id: randomUUID(),
    name: "ORDINARY-DXF-LAYER",
    visible: true,
    locked: false,
    canvasId: document.canvasId,
    sortOrder: 45,
    version: 1,
  };
  await applyTypedOperationWithId(
    document,
    randomUUID(),
    "add_layer",
    { [layerInput.id]: 1 },
    { type: "add_layer", layer: layerInput },
    {},
  );
  const layer = { ...layerInput, systemKind: "custom" };
  const group = historyGroup(randomUUID(), 1, 2);
  const attestFinalization = (...input) =>
    attestDxfPlan(document, dxfFile, {
      operations: [
        sourceOperation(document, historyGroup(group.id, 0, 2), layer.id),
        operationInput(...input),
      ],
    });
  await assertSqlState(
    attestFinalization(
      document,
      randomUUID(),
      { [layer.id]: 1 },
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [
            {
              kind: "put_layer",
              entity: { ...layer, visible: false, locked: true },
              baseVersion: 1,
            },
          ],
        },
        group,
      ),
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [{ kind: "put_layer", entity: layer, baseVersion: 2 }],
        },
        group,
      ),
    ),
    ["P1C01"],
  );
  assert.deepEqual(await canonicalLayer(document, layer.id), layer);
});

test("freezing and frozen rooms reject new grouped operation application", async () => {
  for (const freezeState of ["freezing", "frozen"]) {
    const document = await createDocument(`DXF ${freezeState} apply fence`);
    const requestId = await beginFreeze(document);
    if (freezeState === "frozen") {
      const completed = await completeFreeze(document, requestId, []);
      assert.equal(completed.rows[0].value.state, "frozen");
    }
    const layer = {
      id: randomUUID(),
      name: `Blocked ${freezeState} layer`,
      visible: true,
      locked: false,
      systemKind: "custom",
      canvasId: document.canvasId,
      sortOrder: 50,
      version: 1,
    };
    const group = historyGroup(randomUUID(), 0, 2);
    const forward = groupedPayload(
      {
        type: "mutate_structure",
        actions: [{ kind: "put_layer", entity: layer, baseVersion: null }],
      },
      group,
    );
    const inverse = groupedPayload(
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 1 }],
      },
      group,
    );

    await assertSqlState(
      applyLayerImportFixture(document, randomUUID(), {}, forward, inverse),
      ["P3F02"],
    );
    await resetSession();
    const persisted = await db.query(
      `select
        (select count(*)::integer from public.lukas_drawing_layers
          where id=$1) layer_count,
        (select count(*)::integer from public.lukas_drawing_operations
          where revision_id=$2) operation_count`,
      [layer.id, document.revisionId],
    );
    assert.deepEqual(persisted.rows, [{ layer_count: 0, operation_count: 0 }]);
  }
});

test("freeze leases reject incomplete groups and fence later grouped appends", async () => {
  const incompleteDocument = await createDocument("DXF incomplete lease fence");
  const incompleteLayer = {
    id: randomUUID(),
    name: "Incomplete lease layer",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: incompleteDocument.canvasId,
    sortOrder: 55,
    version: 1,
  };
  const incompleteGroup = historyGroup(randomUUID(), 0, 2);
  await applyLayerImportFixture(
    incompleteDocument,
    randomUUID(),
    {},
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_layer", entity: incompleteLayer, baseVersion: null },
        ],
      },
      incompleteGroup,
    ),
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_layer", id: incompleteLayer.id, baseVersion: 1 },
        ],
      },
      incompleteGroup,
    ),
    { prefixOnly: true },
  );
  await resetSession();
  await assertSqlState(
    db.query(
      `select private.lukas_drawing_collaboration_acquire_freeze_lease(
        $1,$2,$3,$4,30,decode('01','hex'),0
      )`,
      [projectId, incompleteDocument.revisionId, randomUUID(), randomUUID()],
    ),
    ["P3F01"],
  );

  const leasedDocument = await createDocument("DXF active lease append fence");
  await resetSession();
  await db.query(
    `select private.lukas_drawing_collaboration_acquire_freeze_lease(
      $1,$2,$3,$4,30,decode('01','hex'),0
    )`,
    [projectId, leasedDocument.revisionId, randomUUID(), randomUUID()],
  );
  const leasedLayer = {
    id: randomUUID(),
    name: "Leased layer",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: leasedDocument.canvasId,
    sortOrder: 55,
    version: 1,
  };
  const leasedGroup = historyGroup(randomUUID(), 0, 1);
  await assertSqlState(
    applyLayerImportFixture(
      leasedDocument,
      randomUUID(),
      {},
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [
            { kind: "put_layer", entity: leasedLayer, baseVersion: null },
          ],
        },
        leasedGroup,
      ),
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [
            { kind: "delete_layer", id: leasedLayer.id, baseVersion: 1 },
          ],
        },
        leasedGroup,
      ),
    ),
    ["P3F03"],
  );
});

test("freezing and frozen rooms reject direct grouped operation append", async () => {
  for (const freezeState of ["freezing", "frozen"]) {
    const document = await createDocument(`DXF ${freezeState} append fence`);
    const requestId = await beginFreeze(document);
    if (freezeState === "frozen") await completeFreeze(document, requestId, []);
    const layerId = randomUUID();
    const group = historyGroup(randomUUID(), 0, 2);
    const forward = groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_layer",
            entity: {
              id: layerId,
              name: `Direct ${freezeState} layer`,
              visible: true,
              locked: false,
              systemKind: "custom",
              canvasId: document.canvasId,
              sortOrder: 60,
              version: 1,
            },
            baseVersion: null,
          },
        ],
      },
      group,
    );
    const inverse = groupedPayload(
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_layer", id: layerId, baseVersion: 1 }],
      },
      group,
    );

    await resetSession();
    await db.query(
      "select pg_catalog.set_config('request.jwt.claims',$1,false)",
      [
        JSON.stringify({
          role: "authenticated",
          sub: OWNER,
          is_anonymous: false,
          app_metadata: {},
        }),
      ],
    );
    await assertSqlState(
      db.query(
        `insert into public.lukas_drawing_operations(
          revision_id,project_id,sequence,client_operation_id,operation_type,
          base_versions,forward,inverse,result_versions,actor_id
        ) values(
          $1,$2,1,$3,'mutate_structure','{}'::jsonb,
          $4::jsonb,$5::jsonb,$6::jsonb,$7
        )`,
        [
          document.revisionId,
          projectId,
          randomUUID(),
          JSON.stringify(forward),
          JSON.stringify(inverse),
          JSON.stringify({ [layerId]: 1 }),
          OWNER,
        ],
      ),
      ["P3F02"],
    );
    assert.equal((await operationManifest(document)).length, 0);
  }
});

test("freezing and frozen rooms reject privileged grouped ledger rewrites", async () => {
  for (const freezeState of ["freezing", "frozen"]) {
    const document = await createDocument(`DXF ${freezeState} rewrite fence`);
    const layer = {
      id: randomUUID(),
      name: `Immutable ${freezeState} layer`,
      visible: true,
      locked: false,
      systemKind: "custom",
      canvasId: document.canvasId,
      sortOrder: 65,
      version: 1,
    };
    const group = historyGroup(randomUUID(), 0, 1);
    const created = await applyLayerImportFixture(
      document,
      randomUUID(),
      {},
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [{ kind: "put_layer", entity: layer, baseVersion: null }],
        },
        group,
      ),
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 1 }],
        },
        group,
      ),
    );
    const requestId = await beginFreeze(document);
    if (freezeState === "frozen")
      await completeFreeze(
        document,
        requestId,
        await operationManifest(document),
      );

    await setPrivilegedAuthenticatedClaims();
    await db.exec("begin");
    try {
      await db.query(
        "select pg_catalog.set_config('private.lukas_drawing_p2_operation_rewrite',$1,true)",
        [created.operationId],
      );
      await assertSqlState(
        db.query(
          `update public.lukas_drawing_operations
           set inverse=pg_catalog.jsonb_set(inverse,'{actions,0,baseVersion}','2')
           where id=$1`,
          [created.operationId],
        ),
        ["P1C01", "P3F02"],
      );
    } finally {
      await db.exec("rollback");
    }
    await resetSession();
    const stored = await db.query(
      `select inverse->'actions'->0->>'baseVersion' base_version
       from public.lukas_drawing_operations where id=$1`,
      [created.operationId],
    );
    assert.equal(stored.rows[0].base_version, "1");
  }
});

test("freeze completion rechecks group completeness after a racing append", async () => {
  const document = await createDocument("DXF freeze completion race");
  const requestId = await beginFreeze(document);
  const layer = {
    id: randomUUID(),
    name: "Racing partial DXF layer",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: document.canvasId,
    sortOrder: 70,
    version: 1,
  };
  const group = historyGroup(randomUUID(), 0, 2);
  const forward = groupedPayload(
    {
      type: "mutate_structure",
      actions: [{ kind: "put_layer", entity: layer, baseVersion: null }],
    },
    group,
  );
  const inverse = groupedPayload(
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 1 }],
    },
    group,
  );

  await resetSession();
  await db.exec(
    "alter table public.lukas_drawing_operations disable trigger lukas_drawing_dxf_history_group_append_guard",
  );
  try {
    await applyLayerImportFixture(
      document,
      randomUUID(),
      {},
      forward,
      inverse,
      { prefixOnly: true },
    );
  } finally {
    await resetSession();
    await db.exec(
      "alter table public.lukas_drawing_operations enable trigger lukas_drawing_dxf_history_group_append_guard",
    );
  }
  assert.equal(await dxfGroupsComplete(document), false);

  await assertSqlState(
    completeFreeze(document, requestId, await operationManifest(document)),
    ["P3F01"],
  );
  await resetSession();
  const state = await db.query(
    "select freeze_state from private.lukas_drawing_collaboration_states where revision_id=$1",
    [document.revisionId],
  );
  assert.equal(state.rows[0].freeze_state, "freezing");
});

test("exact direct grouped undo cannot claim a layer mutation that never happened", async () => {
  const document = await createDocument(
    "DXF direct layer history state binding",
  );
  const layer = {
    id: randomUUID(),
    name: "DIRECT-LAYER",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: document.canvasId,
    sortOrder: 20,
    version: 1,
  };
  const group = historyGroup(randomUUID(), 0, 1);
  const originalOperationId = randomUUID();
  const originalForward = groupedPayload(
    {
      type: "mutate_structure",
      actions: [{ kind: "put_layer", entity: layer, baseVersion: null }],
    },
    group,
  );
  const originalInverse = groupedPayload(
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 1 }],
    },
    group,
  );
  await applyLayerImportFixture(
    document,
    originalOperationId,
    {},
    originalForward,
    originalInverse,
  );

  // Undo the trailing source phase first, so the layer is the exact next
  // history member and the forged mutation reaches the deeper layer checks.
  const sourceOriginal = (await operationManifest(document)).at(-1);
  await applyOperationWithId(
    document,
    randomUUID(),
    Object.fromEntries(Object.entries(sourceOriginal.resultVersions)),
    sourceOriginal.inverse,
    sourceOriginal.forward,
    {
      historyAction: "undo",
      originalOperationId: sourceOriginal.clientOperationId,
    },
  );

  const directOperation = {
    clientOperationId: randomUUID(),
    baseVersions: { [layer.id]: 1 },
    forward: originalInverse,
    inverse: originalForward,
    resultVersions: { [layer.id]: null },
    historyAction: "undo",
    originalOperationId,
  };
  await setPrivilegedAuthenticatedClaims();
  await assertSqlState(insertDirectOperation(document, directOperation), [
    "P1C01",
  ]);
  await setPrivilegedAuthenticatedClaims();
  await assertSqlState(
    insertDirectOperation(document, {
      ...directOperation,
      resultVersions: {
        ...directOperation.resultVersions,
        [randomUUID()]: 1,
      },
    }),
    ["P1C01"],
  );
  assert.deepEqual(await canonicalLayer(document, layer.id), layer);
  assert.equal(await dxfGroupsComplete(document), false);

  await setPrivilegedAuthenticatedClaims();
  const stateTriggerName = "lukas_drawing_operations_dxf_history_state_guard";
  const stateTriggerExists = (
    await db.query(
      `select exists(
        select 1 from pg_catalog.pg_trigger
        where tgrelid='public.lukas_drawing_operations'::regclass
          and tgname=$1 and not tgisinternal
      ) value`,
      [stateTriggerName],
    )
  ).rows[0].value;
  await db.exec(
    "alter table public.lukas_drawing_operations disable trigger lukas_drawing_dxf_history_group_append_guard",
  );
  await db.exec(
    "alter table public.lukas_drawing_operations disable trigger lukas_drawing_operation_authority_guard",
  );
  if (stateTriggerExists)
    await db.exec(
      `alter table public.lukas_drawing_operations disable trigger ${stateTriggerName}`,
    );
  try {
    await insertDirectOperation(document, directOperation);
    await setPrivilegedAuthenticatedClaims();
    await insertDirectOperation(document, {
      baseVersions: {},
      forward: {
        type: "mutate_structure",
        actions: [],
        note: layer.id,
      },
      inverse: { type: "mutate_structure", actions: [] },
      resultVersions: {},
    });
    await setPrivilegedAuthenticatedClaims();
    await insertDirectOperation(document, {
      baseVersions: {},
      forward: {
        type: "mutate_structure",
        actions: [{ kind: "put_layer", entity: layer, baseVersion: null }],
      },
      inverse: {
        type: "mutate_structure",
        actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 1 }],
      },
      resultVersions: { [layer.id]: 1 },
    });
  } finally {
    await db.exec(
      "alter table public.lukas_drawing_operations enable trigger lukas_drawing_dxf_history_group_append_guard",
    );
    if (stateTriggerExists)
      await db.exec(
        `alter table public.lukas_drawing_operations enable trigger ${stateTriggerName}`,
      );
    await db.exec(
      "alter table public.lukas_drawing_operations enable trigger lukas_drawing_operation_authority_guard",
    );
  }
  assert.equal(await dxfGroupsComplete(document), false);

  await resetSession();
  await db.query(
    `insert into private.lukas_drawing_collaboration_states(
      revision_id,project_id,schema_version,yjs_state,yjs_sha256,
      base_operation_sequence,store_generation,byte_size,persisted_at
    ) values(
      $1,$2,1,decode('01','hex'),
      pg_catalog.encode(extensions.digest(decode('01','hex'),'sha256'),'hex'),
      0,1,1,pg_catalog.now()
    )`,
    [document.revisionId, projectId],
  );
  await assertSqlState(
    db.query(
      `select private.lukas_drawing_collaboration_begin_freeze(
        $1,$2,$3,decode('01','hex'),0
      ) value`,
      [projectId, document.revisionId, randomUUID()],
    ),
    ["P3F01"],
  );
});

test("a privileged empty grouped payload fails at the provenance boundary", async () => {
  const document = await createDocument("DXF empty grouped payload");
  const group = historyGroup(randomUUID(), 0, 1);
  const payload = groupedPayload(
    { type: "mutate_structure", actions: [] },
    group,
  );
  await setPrivilegedAuthenticatedClaims();
  await assertSqlState(
    insertDirectOperation(document, {
      baseVersions: {},
      forward: payload,
      inverse: payload,
      resultVersions: {},
    }),
    ["P1C01"],
  );
  assert.equal((await operationManifest(document)).length, 0);
});

test("a privileged fake later operation cannot bridge a history version gap", async () => {
  const document = await createDocument("DXF history version gap");
  const layer = {
    id: randomUUID(),
    name: "VERSION-GAP",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: document.canvasId,
    sortOrder: 25,
    version: 1,
  };
  const group = historyGroup(randomUUID(), 0, 1);
  await applyLayerImportFixture(
    document,
    randomUUID(),
    {},
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [{ kind: "put_layer", entity: layer, baseVersion: null }],
      },
      group,
    ),
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 1 }],
      },
      group,
    ),
  );

  await resetSession();
  await db.exec("alter table public.lukas_drawing_layers disable trigger user");
  try {
    await db.query(
      `update public.lukas_drawing_layers
       set name='FORGED-GAP',version=3 where id=$1`,
      [layer.id],
    );
  } finally {
    await db.exec(
      "alter table public.lukas_drawing_layers enable trigger user",
    );
  }
  await setPrivilegedAuthenticatedClaims();
  await assertSqlState(
    insertDirectOperation(document, {
      operationType: "update_layer",
      baseVersions: { [layer.id]: 2 },
      forward: {
        type: "update_layer",
        layerId: layer.id,
        patch: { name: "FORGED-GAP" },
      },
      inverse: {
        type: "update_layer",
        layerId: layer.id,
        patch: { name: layer.name },
      },
      resultVersions: { [layer.id]: 3 },
    }),
    ["P1C01"],
  );
  assert.equal(await dxfGroupsComplete(document), false);
});

test("two privileged direct ordinary operations cannot bridge a history version gap", async () => {
  const document = await createDocument("DXF multi-operation history gap");
  const layer = {
    id: randomUUID(),
    name: "MULTI-GAP",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: document.canvasId,
    sortOrder: 26,
    version: 1,
  };
  const group = historyGroup(randomUUID(), 0, 1);
  await applyLayerImportFixture(
    document,
    randomUUID(),
    {},
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [{ kind: "put_layer", entity: layer, baseVersion: null }],
      },
      group,
    ),
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 1 }],
      },
      group,
    ),
  );

  await setPrivilegedAuthenticatedClaims();
  await db.query(
    `update public.lukas_drawing_layers
     set name='MULTI-GAP-2',version=2 where id=$1`,
    [layer.id],
  );
  await db.query(
    `update public.lukas_drawing_layers
     set name='MULTI-GAP-3',version=3 where id=$1`,
    [layer.id],
  );

  await assertSqlState(
    (async () => {
      await insertDirectOperation(document, {
        operationType: "update_layer",
        baseVersions: { [layer.id]: 1 },
        forward: {
          type: "update_layer",
          layerId: layer.id,
          patch: { name: "MULTI-GAP-2" },
        },
        inverse: {
          type: "update_layer",
          layerId: layer.id,
          patch: { name: layer.name },
        },
        resultVersions: { [layer.id]: 2 },
      });
      await insertDirectOperation(document, {
        operationType: "update_layer",
        baseVersions: { [layer.id]: 2 },
        forward: {
          type: "update_layer",
          layerId: layer.id,
          patch: { name: "MULTI-GAP-3" },
        },
        inverse: {
          type: "update_layer",
          layerId: layer.id,
          patch: { name: "MULTI-GAP-2" },
        },
        resultVersions: { [layer.id]: 3 },
      });
    })(),
    ["P1C01"],
  );
  assert.equal(await dxfGroupsComplete(document), false);
});

test("grouped layer history rejects an undo targeting another valid layer", async () => {
  const document = await createDocument("DXF grouped layer target binding");
  const unrelatedLayer = {
    id: randomUUID(),
    name: "UNRELATED-LAYER",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: document.canvasId,
    sortOrder: 20,
    version: 1,
  };
  await applyOperationWithId(
    document,
    randomUUID(),
    {},
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_layer", entity: unrelatedLayer, baseVersion: null },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_layer", id: unrelatedLayer.id, baseVersion: 1 },
      ],
    },
  );

  const originalLayer = {
    ...unrelatedLayer,
    id: randomUUID(),
    name: "ORIGINAL-LAYER",
    sortOrder: 30,
  };
  const group = historyGroup(randomUUID(), 0, 1);
  const originalOperationId = randomUUID();
  await applyLayerImportFixture(
    document,
    originalOperationId,
    {},
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_layer", entity: originalLayer, baseVersion: null },
        ],
      },
      group,
    ),
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_layer", id: originalLayer.id, baseVersion: 1 },
        ],
      },
      group,
    ),
  );

  // Undo the trailing source phase first, so the layer is the exact next
  // history member and the forged mutation reaches the deeper layer checks.
  const sourceOriginal = (await operationManifest(document)).at(-1);
  await applyOperationWithId(
    document,
    randomUUID(),
    Object.fromEntries(Object.entries(sourceOriginal.resultVersions)),
    sourceOriginal.inverse,
    sourceOriginal.forward,
    {
      historyAction: "undo",
      originalOperationId: sourceOriginal.clientOperationId,
    },
  );

  const forgedForward = groupedPayload(
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_layer", id: unrelatedLayer.id, baseVersion: 1 },
      ],
    },
    group,
  );
  const forgedInverse = groupedPayload(
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_layer", entity: unrelatedLayer, baseVersion: null },
      ],
    },
    group,
  );
  await assertSqlState(
    applyOperationWithId(
      document,
      randomUUID(),
      { [unrelatedLayer.id]: 1 },
      forgedForward,
      forgedInverse,
      { historyAction: "undo", originalOperationId },
    ),
    ["P1C01"],
  );

  await resetSession();
  await db.query(
    "select pg_catalog.set_config('request.jwt.claims',$1,false)",
    [
      JSON.stringify({
        role: "authenticated",
        sub: OWNER,
        is_anonymous: false,
        app_metadata: {},
      }),
    ],
  );
  const directOperationId = randomUUID();
  const insertForgedHistory = () =>
    db.query(
      `insert into public.lukas_drawing_operations(
        revision_id,project_id,sequence,client_operation_id,operation_type,
        base_versions,forward,inverse,result_versions,actor_id,
        history_action,original_operation_id
      ) values(
        $1,$2,(
          select coalesce(max(sequence),0)+1
          from public.lukas_drawing_operations where revision_id=$1
        ),$3,'mutate_structure',$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,
        'undo',$9
      )`,
      [
        document.revisionId,
        projectId,
        directOperationId,
        JSON.stringify({ [unrelatedLayer.id]: 1 }),
        JSON.stringify(forgedForward),
        JSON.stringify(forgedInverse),
        JSON.stringify({ [unrelatedLayer.id]: null }),
        OWNER,
        originalOperationId,
      ],
    );
  await assertSqlState(insertForgedHistory(), ["P1C01"]);
  assert.equal(await dxfGroupsComplete(document), false);

  await resetSession();
  await db.query(
    "select pg_catalog.set_config('request.jwt.claims',$1,false)",
    [
      JSON.stringify({
        role: "authenticated",
        sub: OWNER,
        is_anonymous: false,
        app_metadata: {},
      }),
    ],
  );
  await db.exec(
    "alter table public.lukas_drawing_operations disable trigger lukas_drawing_dxf_history_group_append_guard",
  );
  await db.exec(
    "alter table public.lukas_drawing_operations disable trigger lukas_drawing_operations_dxf_history_state_guard",
  );
  await db.exec(
    "alter table public.lukas_drawing_operations disable trigger lukas_drawing_operation_authority_guard",
  );
  try {
    await insertForgedHistory();
  } finally {
    await db.exec(
      "alter table public.lukas_drawing_operations enable trigger lukas_drawing_dxf_history_group_append_guard",
    );
    await db.exec(
      "alter table public.lukas_drawing_operations enable trigger lukas_drawing_operations_dxf_history_state_guard",
    );
    await db.exec(
      "alter table public.lukas_drawing_operations enable trigger lukas_drawing_operation_authority_guard",
    );
  }
  assert.equal(await dxfGroupsComplete(document), false);
  assert.deepEqual(
    await canonicalLayer(document, unrelatedLayer.id),
    unrelatedLayer,
  );
});

test("grouped layer history rejects an undo with another valid phase", async () => {
  const document = await createDocument("DXF grouped phase binding");
  const layer = {
    id: randomUUID(),
    name: "PHASE-LAYER",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: document.canvasId,
    sortOrder: 20,
    version: 1,
  };
  const finalizedLayer = { ...layer, visible: false, locked: true };
  const group = historyGroup(randomUUID(), 0, 1);
  const originalOperationId = randomUUID();
  await applyLayerImportFixture(
    document,
    originalOperationId,
    { [layer.id]: 1 },
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_layer", entity: finalizedLayer, baseVersion: 1 },
        ],
      },
      group,
    ),
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [{ kind: "put_layer", entity: layer, baseVersion: 2 }],
      },
      group,
    ),
  );

  await assertSqlState(
    applyOperationWithId(
      document,
      randomUUID(),
      { [layer.id]: 2 },
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 2 }],
        },
        group,
      ),
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [
            {
              kind: "put_layer",
              entity: { ...finalizedLayer, version: 2 },
              baseVersion: null,
            },
          ],
        },
        group,
      ),
      { historyAction: "undo", originalOperationId },
    ),
    ["P1C01"],
  );
  assert.deepEqual(await canonicalLayer(document, layer.id), {
    ...finalizedLayer,
    version: 2,
  });
});

test("grouped compound history rejects an undo targeting another valid object-source pair", async () => {
  const document = await createDocument("DXF grouped compound target binding");
  const unrelatedObject = circleObject(document, { name: "Unrelated circle" });
  const unrelatedSource = dxfSource(document, unrelatedObject.id, {
    entityKey: "entities:unrelated",
  });
  await putObjectAndSource(document, unrelatedObject, unrelatedSource);

  const originalObject = circleObject(document, { name: "Original circle" });
  const originalSource = dxfSource(document, originalObject.id, {
    entityKey: "entities:original",
  });
  const group = historyGroup(randomUUID(), 0, 1);
  const originalOperationId = randomUUID();
  await applyAttestedOperationWithId(
    document,
    originalOperationId,
    {},
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_object", entity: originalObject, baseVersion: null },
          { kind: "put_source", entity: originalSource, baseVersion: null },
        ],
      },
      group,
    ),
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_source", id: originalSource.id, baseVersion: 1 },
          { kind: "delete_object", id: originalObject.id, baseVersion: 1 },
        ],
      },
      group,
    ),
  );

  await assertSqlState(
    applyOperationWithId(
      document,
      randomUUID(),
      { [unrelatedObject.id]: 1, [unrelatedSource.id]: 1 },
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [
            {
              kind: "delete_source",
              id: unrelatedSource.id,
              baseVersion: 1,
            },
            {
              kind: "delete_object",
              id: unrelatedObject.id,
              baseVersion: 1,
            },
          ],
        },
        group,
      ),
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [
            {
              kind: "put_object",
              entity: unrelatedObject,
              baseVersion: null,
            },
            {
              kind: "put_source",
              entity: unrelatedSource,
              baseVersion: null,
            },
          ],
        },
        group,
      ),
      { historyAction: "undo", originalOperationId },
    ),
    ["P1C01"],
  );
  await setPrivilegedAuthenticatedClaims();
  await assertSqlState(
    insertDirectOperation(document, {
      baseVersions: {
        [unrelatedObject.id]: 1,
        [unrelatedSource.id]: 1,
      },
      forward: groupedPayload(
        {
          type: "mutate_structure",
          actions: [
            {
              kind: "delete_source",
              id: unrelatedSource.id,
              baseVersion: 1,
            },
            {
              kind: "delete_object",
              id: unrelatedObject.id,
              baseVersion: 1,
            },
          ],
        },
        group,
      ),
      inverse: groupedPayload(
        {
          type: "mutate_structure",
          actions: [
            {
              kind: "put_object",
              entity: unrelatedObject,
              baseVersion: null,
            },
            {
              kind: "put_source",
              entity: unrelatedSource,
              baseVersion: null,
            },
          ],
        },
        group,
      ),
      resultVersions: {
        [unrelatedObject.id]: null,
        [unrelatedSource.id]: null,
      },
      historyAction: "undo",
      originalOperationId,
    }),
    ["P1C01"],
  );
  assert.deepEqual(
    await canonicalObjectSource(
      document,
      unrelatedObject.id,
      unrelatedSource.id,
    ),
    { object: unrelatedObject, source: unrelatedSource },
  );
});

test("exact direct grouped compound history cannot omit object or source mutations", async () => {
  const document = await createDocument("DXF direct compound state binding");
  const object = circleObject(document);
  const source = dxfSource(document, object.id);
  const group = historyGroup(randomUUID(), 0, 1);
  const originalOperationId = randomUUID();
  const originalForward = groupedPayload(
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_object", entity: object, baseVersion: null },
        { kind: "put_source", entity: source, baseVersion: null },
      ],
    },
    group,
  );
  const originalInverse = groupedPayload(
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_source", id: source.id, baseVersion: 1 },
        { kind: "delete_object", id: object.id, baseVersion: 1 },
      ],
    },
    group,
  );
  await applyAttestedOperationWithId(
    document,
    originalOperationId,
    {},
    originalForward,
    originalInverse,
  );
  const exactUndo = {
    baseVersions: { [object.id]: 1, [source.id]: 1 },
    forward: originalInverse,
    inverse: originalForward,
    resultVersions: { [object.id]: null, [source.id]: null },
    historyAction: "undo",
    originalOperationId,
  };

  await setPrivilegedAuthenticatedClaims();
  await assertSqlState(insertDirectOperation(document, exactUndo), ["P1C01"]);
  assert.deepEqual(
    await canonicalObjectSource(document, object.id, source.id),
    { object, source },
  );

  await setPrivilegedAuthenticatedClaims();
  await db.exec("begin");
  try {
    await db.exec(
      "alter table public.lukas_drawing_operations disable trigger lukas_drawing_operation_authority_guard",
    );
    const placeholder = await insertDirectOperation(document, {
      baseVersions: {},
      forward: { type: "mutate_structure", actions: [] },
      inverse: { type: "mutate_structure", actions: [] },
      resultVersions: {},
    });
    await db.exec(
      "alter table public.lukas_drawing_operations enable trigger lukas_drawing_operation_authority_guard",
    );
    const placeholderId = placeholder.rows[0].id;
    await db.query(
      "select pg_catalog.set_config('private.lukas_drawing_p2_operation_rewrite',$1,true)",
      [placeholderId],
    );
    await assertSqlState(
      db.query(
        `update public.lukas_drawing_operations set
          base_versions=$2::jsonb,forward=$3::jsonb,inverse=$4::jsonb,
          result_versions=$5::jsonb,history_action='undo',
          original_operation_id=$6
         where id=$1`,
        [
          placeholderId,
          JSON.stringify(exactUndo.baseVersions),
          JSON.stringify(exactUndo.forward),
          JSON.stringify(exactUndo.inverse),
          JSON.stringify(exactUndo.resultVersions),
          originalOperationId,
        ],
      ),
      ["P1C01"],
    );
  } finally {
    await db.exec("rollback");
  }
  assert.deepEqual(
    await canonicalObjectSource(document, object.id, source.id),
    { object, source },
  );
  assert.equal(await dxfGroupsComplete(document), true);
});

test("DXF history groups fence partial import, undo, redo, and a second undo", async () => {
  const document = await createDocument("DXF grouped history lifecycle");
  const groupId = randomUUID();
  const count = 3;
  const groups = [0, 1, 2].map((index) => historyGroup(groupId, index, count));
  const layer = {
    id: randomUUID(),
    name: "DXF-GROUPED",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: document.canvasId,
    sortOrder: 30,
    version: 1,
  };
  const finalLayer = { ...layer, visible: false, locked: true };
  const object = circleObject(document, { layerId: layer.id });
  const source = dxfSource(document, object.id, {
    sourceLayer: layer.name,
  });
  const originalIds = [randomUUID(), randomUUID(), randomUUID()];
  const layerCreateForward = groupedPayload(
    {
      type: "mutate_structure",
      actions: [{ kind: "put_layer", entity: layer, baseVersion: null }],
    },
    groups[0],
  );
  const layerCreateInverse = groupedPayload(
    {
      type: "mutate_structure",
      actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 1 }],
    },
    groups[0],
  );
  const objectCreateForward = groupedPayload(
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_object", entity: object, baseVersion: null },
        { kind: "put_source", entity: source, baseVersion: null },
      ],
    },
    groups[1],
  );
  const objectCreateInverse = groupedPayload(
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_source", id: source.id, baseVersion: 1 },
        { kind: "delete_object", id: object.id, baseVersion: 1 },
      ],
    },
    groups[1],
  );
  const layerFinalizeForward = groupedPayload(
    {
      type: "mutate_structure",
      actions: [{ kind: "put_layer", entity: finalLayer, baseVersion: 1 }],
    },
    groups[2],
  );
  const layerFinalizeInverse = groupedPayload(
    {
      type: "mutate_structure",
      actions: [{ kind: "put_layer", entity: layer, baseVersion: 2 }],
    },
    groups[2],
  );

  const assertUnrelatedRejected = async (label) => {
    const unrelatedObject = circleObject(document);
    const unrelatedSource = dxfSource(document, unrelatedObject.id);
    await assertSqlState(
      putObjectAndSource(document, unrelatedObject, unrelatedSource),
      ["P1C01"],
    );
    await resetSession();
    assert.equal(
      (
        await db.query(
          "select count(*)::integer count from public.lukas_drawing_objects where id=$1",
          [unrelatedObject.id],
        )
      ).rows[0].count,
      0,
      label,
    );
  };

  await attestDxfPlan(document, dxfFile, {
    operations: [
      operationInput(
        document,
        originalIds[0],
        {},
        layerCreateForward,
        layerCreateInverse,
      ),
      operationInput(
        document,
        originalIds[1],
        {},
        objectCreateForward,
        objectCreateInverse,
      ),
      operationInput(
        document,
        originalIds[2],
        { [layer.id]: 1 },
        layerFinalizeForward,
        layerFinalizeInverse,
      ),
    ],
  });

  await applyOperationWithId(
    document,
    originalIds[0],
    {},
    layerCreateForward,
    layerCreateInverse,
  );
  assert.equal(await dxfGroupsComplete(document), false);
  await assertUnrelatedRejected("initial index 0 fences unrelated work");

  await setSession("authenticated", OWNER);
  await assertSqlState(
    db.query("select public.lukas_drawing_request_review($1) value", [
      document.revisionId,
    ]),
    ["P1C01"],
  );
  await resetSession();
  await db.query(
    `insert into private.lukas_drawing_collaboration_states(
      revision_id,project_id,schema_version,yjs_state,yjs_sha256,
      base_operation_sequence,store_generation,byte_size,persisted_at
    ) values(
      $1,$2,1,decode('01','hex'),
      pg_catalog.encode(extensions.digest(decode('01','hex'),'sha256'),'hex'),
      0,1,1,pg_catalog.now()
    )`,
    [document.revisionId, projectId],
  );
  const freezeRequestId = randomUUID();
  await assertSqlState(
    db.query(
      `select private.lukas_drawing_collaboration_begin_freeze(
        $1,$2,$3,decode('01','hex'),0
      ) value`,
      [projectId, document.revisionId, freezeRequestId],
    ),
    ["P3F01"],
  );

  await assertSqlState(
    applyOperationWithId(
      document,
      randomUUID(),
      { [layer.id]: 1 },
      layerFinalizeForward,
      layerFinalizeInverse,
    ),
    ["P1C01"],
  );
  const duplicateLayer = { ...layer, id: randomUUID(), name: "DUPLICATE" };
  await assertSqlState(
    applyOperationWithId(
      document,
      randomUUID(),
      {},
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [
            { kind: "put_layer", entity: duplicateLayer, baseVersion: null },
          ],
        },
        groups[0],
      ),
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [
            {
              kind: "delete_layer",
              id: duplicateLayer.id,
              baseVersion: 1,
            },
          ],
        },
        groups[0],
      ),
    ),
    ["P1C01"],
  );
  await assertSqlState(
    applyOperationWithId(
      document,
      randomUUID(),
      {},
      objectCreateForward,
      objectCreateInverse,
      { actorId: EDITOR },
    ),
    ["P1C01"],
  );

  await applyOperationWithId(
    document,
    originalIds[1],
    {},
    objectCreateForward,
    objectCreateInverse,
  );
  assert.equal(await dxfGroupsComplete(document), false);
  await assertUnrelatedRejected("initial index 1 fences unrelated work");
  await applyOperationWithId(
    document,
    originalIds[2],
    { [layer.id]: 1 },
    layerFinalizeForward,
    layerFinalizeInverse,
  );
  assert.equal(await dxfGroupsComplete(document), true);

  const completeLayer = await canonicalLayer(document, layer.id);
  await assertSqlState(
    applyOperationWithId(
      document,
      randomUUID(),
      { [layer.id]: 2 },
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_layer",
            entity: { ...layer, version: 2 },
            baseVersion: 2,
          },
        ],
      },
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_layer",
            entity: completeLayer,
            baseVersion: 3,
          },
        ],
      },
      { historyAction: "undo", originalOperationId: originalIds[2] },
    ),
    ["P1C01"],
  );
  assert.deepEqual(await canonicalLayer(document, layer.id), completeLayer);

  let currentLayer = await canonicalLayer(document, layer.id);
  await applyOperationWithId(
    document,
    randomUUID(),
    { [layer.id]: 2 },
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_layer",
            entity: { ...layer, version: 2 },
            baseVersion: 2,
          },
        ],
      },
      groups[2],
    ),
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_layer",
            entity: currentLayer,
            baseVersion: 3,
          },
        ],
      },
      groups[2],
    ),
    { historyAction: "undo", originalOperationId: originalIds[2] },
  );
  assert.equal(await dxfGroupsComplete(document), false);
  await assertUnrelatedRejected("partial undo index 2 fences unrelated work");

  let current = await canonicalObjectSource(document, object.id, source.id);
  await applyOperationWithId(
    document,
    randomUUID(),
    { [object.id]: 1, [source.id]: 1 },
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_source", id: source.id, baseVersion: 1 },
          { kind: "delete_object", id: object.id, baseVersion: 1 },
        ],
      },
      groups[1],
    ),
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_object", entity: current.object, baseVersion: null },
          { kind: "put_source", entity: current.source, baseVersion: null },
        ],
      },
      groups[1],
    ),
    { historyAction: "undo", originalOperationId: originalIds[1] },
  );
  assert.equal(await dxfGroupsComplete(document), false);
  await assertUnrelatedRejected("partial undo index 1 fences unrelated work");

  currentLayer = await canonicalLayer(document, layer.id);
  await applyOperationWithId(
    document,
    randomUUID(),
    { [layer.id]: 3 },
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 3 }],
      },
      groups[0],
    ),
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_layer", entity: currentLayer, baseVersion: null },
        ],
      },
      groups[0],
    ),
    { historyAction: "undo", originalOperationId: originalIds[0] },
  );
  assert.equal(await dxfGroupsComplete(document), true);

  await applyOperationWithId(
    document,
    randomUUID(),
    {},
    layerCreateForward,
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 5 }],
      },
      groups[0],
    ),
    { historyAction: "redo", originalOperationId: originalIds[0] },
  );
  assert.equal(await dxfGroupsComplete(document), false);
  await assertUnrelatedRejected("partial redo index 0 fences unrelated work");

  await applyOperationWithId(
    document,
    randomUUID(),
    {},
    objectCreateForward,
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_source", id: source.id, baseVersion: 3 },
          { kind: "delete_object", id: object.id, baseVersion: 3 },
        ],
      },
      groups[1],
    ),
    { historyAction: "redo", originalOperationId: originalIds[1] },
  );
  assert.equal(await dxfGroupsComplete(document), false);
  await assertUnrelatedRejected("partial redo index 1 fences unrelated work");

  currentLayer = await canonicalLayer(document, layer.id);
  await applyOperationWithId(
    document,
    randomUUID(),
    { [layer.id]: 5 },
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_layer",
            entity: { ...finalLayer, version: 5 },
            baseVersion: 5,
          },
        ],
      },
      groups[2],
    ),
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_layer",
            entity: currentLayer,
            baseVersion: 6,
          },
        ],
      },
      groups[2],
    ),
    { historyAction: "redo", originalOperationId: originalIds[2] },
  );
  assert.equal(await dxfGroupsComplete(document), true);

  currentLayer = await canonicalLayer(document, layer.id);
  await applyOperationWithId(
    document,
    randomUUID(),
    { [layer.id]: 6 },
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_layer",
            entity: { ...layer, version: 6 },
            baseVersion: 6,
          },
        ],
      },
      groups[2],
    ),
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_layer",
            entity: currentLayer,
            baseVersion: 7,
          },
        ],
      },
      groups[2],
    ),
    { historyAction: "undo", originalOperationId: originalIds[2] },
  );
  assert.equal(await dxfGroupsComplete(document), false);
  await assertUnrelatedRejected(
    "second partial undo index 2 fences unrelated work",
  );

  current = await canonicalObjectSource(document, object.id, source.id);
  await applyOperationWithId(
    document,
    randomUUID(),
    { [object.id]: 3, [source.id]: 3 },
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_source", id: source.id, baseVersion: 3 },
          { kind: "delete_object", id: object.id, baseVersion: 3 },
        ],
      },
      groups[1],
    ),
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_object", entity: current.object, baseVersion: null },
          { kind: "put_source", entity: current.source, baseVersion: null },
        ],
      },
      groups[1],
    ),
    { historyAction: "undo", originalOperationId: originalIds[1] },
  );
  assert.equal(await dxfGroupsComplete(document), false);
  await assertUnrelatedRejected(
    "second partial undo index 1 fences unrelated work",
  );

  currentLayer = await canonicalLayer(document, layer.id);
  await applyOperationWithId(
    document,
    randomUUID(),
    { [layer.id]: 7 },
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 7 }],
      },
      groups[0],
    ),
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_layer", entity: currentLayer, baseVersion: null },
        ],
      },
      groups[0],
    ),
    { historyAction: "undo", originalOperationId: originalIds[0] },
  );
  assert.equal(await dxfGroupsComplete(document), true);

  await resetSession();
  const frozen = await db.query(
    `select private.lukas_drawing_collaboration_begin_freeze(
      $1,$2,$3,decode('01','hex'),0
    ) value`,
    [projectId, document.revisionId, freezeRequestId],
  );
  assert.equal(frozen.rows[0].value.state, "freezing");

  const reviewDocument = await createDocument("DXF complete group review");
  const reviewObject = circleObject(reviewDocument);
  const reviewSource = dxfSource(reviewDocument, reviewObject.id);
  const reviewGroup = historyGroup(randomUUID(), 0, 1);
  await applyAttestedOperationWithId(
    reviewDocument,
    randomUUID(),
    {},
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_object", entity: reviewObject, baseVersion: null },
          { kind: "put_source", entity: reviewSource, baseVersion: null },
        ],
      },
      reviewGroup,
    ),
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_source", id: reviewSource.id, baseVersion: 1 },
          { kind: "delete_object", id: reviewObject.id, baseVersion: 1 },
        ],
      },
      reviewGroup,
    ),
  );
  assert.equal(await dxfGroupsComplete(reviewDocument), true);
  await setSession("authenticated", OWNER);
  const reviewed = await db.query(
    "select public.lukas_drawing_request_review($1) value",
    [reviewDocument.revisionId],
  );
  assert.equal(reviewed.rows[0].value.subjectVersion, 1);
});

test("completed grouped imports remain valid after ordinary layer and object edits", async () => {
  const document = await createDocument("DXF grouped import ordinary edits");
  const groupId = randomUUID();
  const layer = {
    id: randomUUID(),
    name: "EDITABLE-DXF",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: document.canvasId,
    sortOrder: 20,
    version: 1,
  };
  const object = circleObject(document, { layerId: layer.id });
  const source = dxfSource(document, object.id, { sourceLayer: layer.name });
  const layerGroup = historyGroup(groupId, 0, 2);
  const sourceGroup = historyGroup(groupId, 1, 2);
  const operations = [
    operationInput(
      document,
      randomUUID(),
      {},
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [{ kind: "put_layer", entity: layer, baseVersion: null }],
        },
        layerGroup,
      ),
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 1 }],
        },
        layerGroup,
      ),
    ),
    operationInput(
      document,
      randomUUID(),
      {},
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [
            { kind: "put_object", entity: object, baseVersion: null },
            { kind: "put_source", entity: source, baseVersion: null },
          ],
        },
        sourceGroup,
      ),
      groupedPayload(
        {
          type: "mutate_structure",
          actions: [
            { kind: "delete_source", id: source.id, baseVersion: 1 },
            { kind: "delete_object", id: object.id, baseVersion: 1 },
          ],
        },
        sourceGroup,
      ),
    ),
  ];
  await attestDxfPlan(document, dxfFile, { operations });
  for (const operation of operations)
    await applyPlanOperation(document, operation);
  await applyTypedOperationWithId(
    document,
    randomUUID(),
    "update_layer",
    { [layer.id]: 1 },
    {
      type: "update_layer",
      layerId: layer.id,
      patch: { name: "EDITED-DXF" },
    },
    {
      type: "update_layer",
      layerId: layer.id,
      patch: { name: layer.name },
    },
  );
  await applyTypedOperationWithId(
    document,
    randomUUID(),
    "update_objects",
    { [object.id]: 1 },
    {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: "Edited circle" } }],
    },
    {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: object.name } }],
    },
  );
  assert.equal(await dxfGroupsComplete(document), true);

  const editedObject = { ...object, name: "Edited circle", version: 2 };
  const deleteOperationId = randomUUID();
  await applyTypedOperationWithId(
    document,
    deleteOperationId,
    "mutate_objects_with_references",
    { [object.id]: 2, [source.id]: 1 },
    {
      type: "mutate_objects_with_references",
      objectAction: "delete",
      objects: [editedObject],
      actions: [{ kind: "delete_source", id: source.id, baseVersion: 1 }],
    },
    {
      type: "mutate_objects_with_references",
      objectAction: "restore",
      objects: [{ ...editedObject, version: 4 }],
      actions: [{ kind: "put_source", entity: source, baseVersion: null }],
    },
  );
  assert.equal(await dxfGroupsComplete(document), true);

  await applyTypedOperationWithId(
    document,
    randomUUID(),
    "mutate_objects_with_references",
    { [object.id]: 3 },
    {
      type: "mutate_objects_with_references",
      objectAction: "restore",
      objects: [{ ...editedObject, version: 4 }],
      actions: [{ kind: "put_source", entity: source, baseVersion: null }],
    },
    {
      type: "mutate_objects_with_references",
      objectAction: "delete",
      objects: [{ ...editedObject, version: 4 }],
      actions: [{ kind: "delete_source", id: source.id, baseVersion: 3 }],
    },
    { historyAction: "undo", originalOperationId: deleteOperationId },
  );
  assert.equal(await dxfGroupsComplete(document), true);
});

test("the actual INSERT adapter plan persists raw BLOCK-child source lineage", async () => {
  const document = await createDocument("DXF adapter persistence");
  const sourceFileId = randomUUID();
  const plan = await buildDrawingDxfImportPlan({
    bytes: flattenedInsertDxf(),
    revisionId: document.revisionId,
    canvasId: document.canvasId,
    sourceFileId,
    createdAt: "2026-09-02T04:00:00.000Z",
  });
  assert.equal(plan.report.blocking.length, 0);
  assert.equal(plan.sources.length, 1);
  assert.equal(plan.sources[0].sourceLayer, "0");
  await insertFile({
    id: sourceFileId,
    project: projectId,
    kind: "dxf",
    sha256: plan.sourceSha256,
  });
  await attestDxfPlan(
    document,
    { id: sourceFileId, sha256: plan.sourceSha256 },
    plan,
  );

  for (const operation of plan.operations)
    await applyOperationWithId(
      document,
      operation.clientOperationId,
      operation.baseVersions,
      operation.forward,
      operation.inverse,
      { attest: false },
    );

  await resetSession();
  const persisted = await db.query(
    `select s.dxf_source_layer,l.name layer_name,o.object_type,
      o.status object_status,s.status source_status
     from public.lukas_drawing_object_sources s
     join public.lukas_drawing_objects o on o.id=s.object_id
     join public.lukas_drawing_layers l on l.id=o.layer_id
     where s.id=$1`,
    [plan.sources[0].id],
  );
  assert.deepEqual(persisted.rows, [
    {
      dxf_source_layer: "0",
      layer_name: "BLOCKS",
      object_type: "line",
      object_status: "active",
      source_status: "active",
    },
  ]);
});

test("DXF source insert reload, strict JSON, retry, and direct DML authority", async () => {
  const document = await createDocument("DXF strict source");
  const object = circleObject(document);
  const source = dxfSource(document, object.id);
  const operationId = randomUUID();
  const first = await putObjectAndSource(document, object, source, operationId);
  const retry = await applyOperationWithId(
    document,
    operationId,
    {},
    first.forward,
    first.inverse,
  );
  assert.deepEqual(retry, first.result);
  assert.equal(first.result.resultVersions[object.id], 1);
  assert.equal(first.result.resultVersions[source.id], 1);

  await assertSqlState(
    applyOperationWithId(
      document,
      operationId,
      {},
      {
        ...first.forward,
        actions: [
          first.forward.actions[0],
          {
            ...first.forward.actions[1],
            entity: { ...source, handle: "BEEF" },
          },
        ],
      },
      first.inverse,
    ),
    ["P1C01"],
  );

  await resetSession();
  const loaded = await db.query(
    `select private.lukas_drawing_source_json($1,$2,$3,true) source,
      dxf_entity_key,dxf_entity_type,dxf_source_layer,dxf_handle,
      dxf_unit_code,dxf_unit_source,dxf_importer_version
     from public.lukas_drawing_object_sources where id=$1`,
    [source.id, document.revisionId, projectId],
  );
  assert.deepEqual(loaded.rows, [
    {
      source,
      dxf_entity_key: source.entityKey,
      dxf_entity_type: source.entityType,
      dxf_source_layer: source.sourceLayer,
      dxf_handle: source.handle,
      dxf_unit_code: source.unitCode,
      dxf_unit_source: source.unitSource,
      dxf_importer_version: source.importerVersion,
    },
  ]);

  for (const invalid of [
    { ...source, pdfPageNumber: 1 },
    { ...source, extra: true },
    { ...source, handle: "1a2b" },
    { ...source, unitCode: 3 },
    { ...source, entityType: "SPLINE" },
  ]) {
    const validity = await db.query(
      `select private.lukas_drawing_structure_action_valid(
        jsonb_build_object('kind','put_source','entity',$1::jsonb,'baseVersion',null),$2
      ) valid`,
      [JSON.stringify(invalid), document.revisionId],
    );
    assert.equal(validity.rows[0].valid, false);
  }

  await setSession("authenticated", VIEWER);
  const visible = await db.query(
    "select count(*)::integer count from public.lukas_drawing_object_sources where id=$1",
    [source.id],
  );
  assert.equal(visible.rows[0].count, 1);
  await assertSqlState(
    db.query(
      `insert into public.lukas_drawing_object_sources(
        id,object_id,revision_id,project_id,source_file_id,source_sha256,
        source_kind,dxf_entity_key,dxf_entity_type,dxf_source_layer,
        dxf_unit_code,dxf_unit_source,dxf_importer_version,created_by,updated_by
      ) values($1,$2,$3,$4,$5,$6,'dxf_entity','entities:1','LINE','0',4,
        'declared',1,$7,$7)`,
      [
        randomUUID(),
        object.id,
        document.revisionId,
        projectId,
        dxfFile.id,
        DXF_SHA,
        VIEWER,
      ],
    ),
    ["42501"],
  );
  await assertSqlState(
    db.query(
      "update public.lukas_drawing_object_sources set dxf_handle='AB' where id=$1",
      [source.id],
    ),
    ["42501"],
  );
  await assertSqlState(
    db.query("delete from public.lukas_drawing_object_sources where id=$1", [
      source.id,
    ]),
    ["42501"],
  );
});

test("wrong kind, project, SHA, mutable file, and mixed payload fail atomically", async () => {
  const document = await createDocument("DXF file identity failures");
  const cases = [
    { sourceFileId: pdfFile.id, sourceSha256: pdfFile.sha256 },
    { sourceFileId: foreignDxfFile.id, sourceSha256: foreignDxfFile.sha256 },
    { sourceFileId: dxfFile.id, sourceSha256: "0".repeat(64) },
    { sourceFileId: mutableDxfFile.id, sourceSha256: mutableDxfFile.sha256 },
    {
      sourceFileId: dxfFile.id,
      sourceSha256: dxfFile.sha256,
      pdfPageNumber: 1,
    },
  ];
  for (const override of cases) {
    const object = circleObject(document);
    const source = dxfSource(document, object.id, override);
    await assertSqlState(putObjectAndSource(document, object, source), [
      "P1C01",
      "P1R01",
      "23514",
    ]);
    await resetSession();
    const absent = await db.query(
      "select count(*)::integer count from public.lukas_drawing_objects where id=$1",
      [object.id],
    );
    assert.equal(absent.rows[0].count, 0);
  }
});

test("put object plus source is atomic and its exact inverse deletes source before object", async () => {
  const document = await createDocument("DXF atomic source graph");
  const object = circleObject(document);
  const source = dxfSource(document, object.id);
  const originalOperationId = randomUUID();
  const created = await putObjectAndSource(
    document,
    object,
    source,
    originalOperationId,
  );

  await resetSession();
  const stored = await db.query(
    "select inverse from public.lukas_drawing_operations where id=$1",
    [created.result.operationId],
  );
  assert.deepEqual(
    stored.rows[0].inverse.actions.map((action) => action.kind),
    ["delete_source", "delete_object"],
  );
  const canonical = await db.query(
    `select
      private.lukas_drawing_structure_entity_json(
        'object',$1,$2,$3
      ) object,
      private.lukas_drawing_source_json($4,$2,$3,true) source`,
    [object.id, document.revisionId, projectId, source.id],
  );
  assert.deepEqual(canonical.rows[0].object, object);
  assert.deepEqual(canonical.rows[0].source, source);

  await assertSqlState(
    applyOperationWithId(
      document,
      randomUUID(),
      { [object.id]: 1 },
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_object", id: object.id, baseVersion: 1 }],
      },
      {
        type: "mutate_structure",
        actions: [{ kind: "put_object", entity: object, baseVersion: null }],
      },
    ),
    ["P1C01", "P1R01"],
  );

  await assertSqlState(addSource(document, dxfSource(document, object.id)), [
    "P1C01",
  ]);

  const deleted = await applyOperationWithId(
    document,
    randomUUID(),
    { [object.id]: 1, [source.id]: 1 },
    created.inverse,
    {
      historyGroup: created.forward.historyGroup,
      type: "mutate_structure",
      actions: [
        { kind: "put_object", entity: object, baseVersion: null },
        { kind: "put_source", entity: source, baseVersion: null },
      ],
    },
    { historyAction: "undo", originalOperationId },
  );
  assert.equal(deleted.resultVersions[object.id], null);
  assert.equal(deleted.resultVersions[source.id], null);
  await resetSession();
  const rows = await db.query(
    `select
      (select status from public.lukas_drawing_objects where id=$1) object_status,
      (select status from public.lukas_drawing_object_sources where id=$2) source_status`,
    [object.id, source.id],
  );
  assert.deepEqual(rows.rows, [
    { object_status: "deleted", source_status: "deleted" },
  ]);

  const [layerCreate] = await operationManifest(document);
  const layer = await canonicalLayer(document, object.layerId);
  await applyOperationWithId(
    document,
    randomUUID(),
    { [layer.id]: 1 },
    layerCreate.inverse,
    layerCreate.forward,
    {
      historyAction: "undo",
      originalOperationId: layerCreate.clientOperationId,
    },
  );
  assert.equal(await dxfGroupsComplete(document), true);
  await applyOperationWithId(
    document,
    randomUUID(),
    {},
    layerCreate.forward,
    groupedPayload(
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_layer", id: layer.id, baseVersion: 3 }],
      },
      layerCreate.forward.historyGroup,
    ),
    {
      historyAction: "redo",
      originalOperationId: layerCreate.clientOperationId,
    },
  );

  const redoInverse = {
    historyGroup: created.forward.historyGroup,
    type: "mutate_structure",
    actions: [
      { kind: "delete_source", id: source.id, baseVersion: 3 },
      { kind: "delete_object", id: object.id, baseVersion: 3 },
    ],
  };
  const redone = await applyOperationWithId(
    document,
    randomUUID(),
    {},
    created.forward,
    redoInverse,
    { historyAction: "redo", originalOperationId },
  );
  assert.equal(redone.resultVersions[object.id], 3);
  assert.equal(redone.resultVersions[source.id], 3);
  await resetSession();
  const active = await db.query(
    `select
      (select status from public.lukas_drawing_objects where id=$1) object_status,
      (select version from public.lukas_drawing_objects where id=$1) object_version,
      (select status from public.lukas_drawing_object_sources where id=$2) source_status,
      (select version from public.lukas_drawing_object_sources where id=$2) source_version`,
    [object.id, source.id],
  );
  assert.deepEqual(active.rows, [
    {
      object_status: "active",
      object_version: 3,
      source_status: "active",
      source_version: 3,
    },
  ]);

  const repeatedUndo = await applyOperationWithId(
    document,
    randomUUID(),
    { [object.id]: 3, [source.id]: 3 },
    {
      historyGroup: created.forward.historyGroup,
      type: "mutate_structure",
      actions: [
        { kind: "delete_source", id: source.id, baseVersion: 3 },
        { kind: "delete_object", id: object.id, baseVersion: 3 },
      ],
    },
    {
      historyGroup: created.forward.historyGroup,
      type: "mutate_structure",
      actions: [
        {
          kind: "put_object",
          entity: { ...object, version: 3 },
          baseVersion: null,
        },
        {
          kind: "put_source",
          entity: { ...source, version: 3 },
          baseVersion: null,
        },
      ],
    },
    { historyAction: "undo", originalOperationId },
  );
  assert.equal(repeatedUndo.resultVersions[object.id], null);
  assert.equal(repeatedUndo.resultVersions[source.id], null);
});

test("an edited DXF object deletes only with its current canonical inverse", async () => {
  const document = await createDocument("DXF edit then delete");
  const object = circleObject(document);
  const source = dxfSource(document, object.id);
  await putObjectAndSource(document, object, source);
  const editedName = "Edited DXF circle";
  const edited = await applyTypedOperationWithId(
    document,
    randomUUID(),
    "update_objects",
    { [object.id]: 1 },
    {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: editedName } }],
    },
    {
      type: "update_objects",
      updates: [{ objectId: object.id, patch: { name: object.name } }],
    },
  );
  assert.equal(edited.resultVersions[object.id], 2);

  await resetSession();
  const current = (
    await db.query(
      `select
        private.lukas_drawing_structure_entity_json(
          'object',$1,$2,$3
        ) object,
        private.lukas_drawing_source_json($4,$2,$3,true) source`,
      [object.id, document.revisionId, projectId, source.id],
    )
  ).rows[0];
  assert.equal(current.object.name, editedName);
  assert.equal(current.object.version, 2);

  const deleteForward = {
    type: "mutate_structure",
    actions: [
      { kind: "delete_source", id: source.id, baseVersion: 1 },
      { kind: "delete_object", id: object.id, baseVersion: 2 },
    ],
  };
  await assertSqlState(
    applyOperationWithId(
      document,
      randomUUID(),
      { [object.id]: 2, [source.id]: 1 },
      deleteForward,
      {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_object",
            entity: { ...current.object, name: object.name },
            baseVersion: null,
          },
          { kind: "put_source", entity: current.source, baseVersion: null },
        ],
      },
    ),
    ["P1C01"],
  );
  const deleted = await applyOperationWithId(
    document,
    randomUUID(),
    { [object.id]: 2, [source.id]: 1 },
    deleteForward,
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_object", entity: current.object, baseVersion: null },
        { kind: "put_source", entity: current.source, baseVersion: null },
      ],
    },
  );
  assert.equal(deleted.resultVersions[object.id], null);
  assert.equal(deleted.resultVersions[source.id], null);
});

test("checkpoint restore and approved clones preserve exact DXF lineage", async () => {
  const checkpointDocument = await createDocument("DXF checkpoint restore");
  const checkpointObject = circleObject(checkpointDocument);
  const checkpointSource = dxfSource(checkpointDocument, checkpointObject.id);
  await putObjectAndSource(
    checkpointDocument,
    checkpointObject,
    checkpointSource,
  );
  await setSession("authenticated", OWNER);
  const reviewRow = await db.query(
    "select public.lukas_drawing_request_review($1) value",
    [checkpointDocument.revisionId],
  );
  const review = reviewRow.rows[0].value;
  await resetSession();
  const frozen = await db.query(
    "select canonical_json,sha256 from public.lukas_drawing_snapshots where id=$1",
    [review.snapshotId],
  );
  assert.deepEqual(frozen.rows[0].canonical_json.sources, [checkpointSource]);
  await recordDecision(
    REVIEWER,
    checkpointDocument,
    review,
    "rejected",
    "restore DXF checkpoint",
  );
  await applyOperationWithId(
    checkpointDocument,
    randomUUID(),
    { [checkpointSource.id]: 1 },
    {
      type: "mutate_structure",
      actions: [
        { kind: "delete_source", id: checkpointSource.id, baseVersion: 1 },
      ],
    },
    {
      type: "mutate_structure",
      actions: [
        { kind: "put_source", entity: checkpointSource, baseVersion: null },
      ],
    },
  );
  await setSession("authenticated", OWNER);
  const restored = await db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'restore_checkpoint','{}'::jsonb,$3::jsonb,$4::jsonb
    ) value`,
    [
      checkpointDocument.revisionId,
      randomUUID(),
      JSON.stringify({
        type: "restore_checkpoint",
        checkpointId: review.snapshotId,
        actions: [
          { kind: "put_source", entity: checkpointSource, baseVersion: null },
        ],
      }),
      JSON.stringify({
        type: "restore_checkpoint",
        checkpointId: review.snapshotId,
        actions: [
          { kind: "delete_source", id: checkpointSource.id, baseVersion: 3 },
        ],
      }),
    ],
  );
  assert.equal(restored.rows[0].value.resultVersions[checkpointSource.id], 3);
  await resetSession();
  const immutable = await db.query(
    `select s.status,s.version,x.canonical_json,x.sha256
     from public.lukas_drawing_object_sources s
     cross join public.lukas_drawing_snapshots x
     where s.id=$1 and x.id=$2`,
    [checkpointSource.id, review.snapshotId],
  );
  assert.equal(immutable.rows[0].status, "active");
  assert.equal(immutable.rows[0].version, 3);
  assert.deepEqual(
    immutable.rows[0].canonical_json,
    frozen.rows[0].canonical_json,
  );
  assert.equal(immutable.rows[0].sha256, frozen.rows[0].sha256);

  const approvedDocument = await createDocument("DXF approved clone");
  const approvedObject = circleObject(approvedDocument);
  const approvedSource = dxfSource(approvedDocument, approvedObject.id);
  await putObjectAndSource(approvedDocument, approvedObject, approvedSource);
  await setSession("authenticated", OWNER);
  const approvedReview = (
    await db.query("select public.lukas_drawing_request_review($1) value", [
      approvedDocument.revisionId,
    ])
  ).rows[0].value;

  const deny = () =>
    applyOperationWithId(
      approvedDocument,
      randomUUID(),
      { [approvedSource.id]: 1 },
      {
        type: "mutate_structure",
        actions: [
          { kind: "delete_source", id: approvedSource.id, baseVersion: 1 },
        ],
      },
      {
        type: "mutate_structure",
        actions: [
          { kind: "put_source", entity: approvedSource, baseVersion: null },
        ],
      },
    );
  await assertSqlState(deny(), ["P1C01", "P1R01"]);
  await recordDecision(
    REVIEWER,
    approvedDocument,
    approvedReview,
    "reviewed",
    "DXF reviewed",
  );
  await assertSqlState(deny(), ["P1C01", "P1R01"]);
  await recordDecision(
    APPROVER,
    approvedDocument,
    approvedReview,
    "approved",
    "DXF approved",
  );
  await assertSqlState(deny(), ["P1C01", "P1R01"]);

  await setSession("authenticated", OWNER);
  const template = (
    await db.query(
      "select public.lukas_drawing_create_from_template($1,'DXF template clone',null,$2) value",
      [approvedDocument.revisionId, randomUUID()],
    )
  ).rows[0].value;
  const child = (
    await db.query(
      "select public.lukas_drawing_restore_approved_snapshot($1,$2) value",
      [approvedDocument.revisionId, randomUUID()],
    )
  ).rows[0].value;
  await resetSession();
  const clones = await db.query(
    `select s.revision_id,s.source_file_id,s.source_sha256,s.source_kind,
      s.dxf_entity_key,s.dxf_entity_type,s.dxf_source_layer,s.dxf_handle,
      s.dxf_unit_code,s.dxf_unit_source,s.dxf_importer_version,
      o.lineage_id
     from public.lukas_drawing_object_sources s
     join public.lukas_drawing_objects o on o.id=s.object_id
     where s.revision_id in($1,$2) and s.status='active'
     order by s.revision_id`,
    [template.revisionId, child.revisionId],
  );
  assert.equal(clones.rows.length, 2);
  for (const clone of clones.rows) {
    assert.equal(clone.source_file_id, dxfFile.id);
    assert.equal(clone.source_sha256, DXF_SHA);
    assert.equal(clone.source_kind, "dxf_entity");
    assert.equal(clone.dxf_entity_key, approvedSource.entityKey);
    assert.equal(clone.dxf_entity_type, approvedSource.entityType);
    assert.equal(clone.dxf_source_layer, approvedSource.sourceLayer);
    assert.equal(clone.dxf_handle, approvedSource.handle);
    assert.equal(clone.dxf_unit_code, approvedSource.unitCode);
    assert.equal(clone.dxf_unit_source, approvedSource.unitSource);
    assert.equal(clone.dxf_importer_version, approvedSource.importerVersion);
    assert.equal(clone.lineage_id, approvedObject.id);
  }
});

test("BOQ anchor JSON is exact for DXF and byte-compatible for PDF and IFC", async () => {
  const document = await createDocument("DXF BOQ anchor payload");
  const object = circleObject(document);
  const dxf = dxfSource(document, object.id);
  await putObjectAndSource(document, object, dxf);
  const pdf = {
    id: randomUUID(),
    objectId: object.id,
    revisionId: document.revisionId,
    sourceFileId: pdfFile.id,
    sourceSha256: PDF_SHA,
    sourceKind: "pdf_region",
    pdfPageNumber: 1,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    version: 1,
  };
  const ifc = {
    id: randomUUID(),
    objectId: object.id,
    revisionId: document.revisionId,
    sourceFileId: ifcFile.id,
    sourceSha256: IFC_SHA,
    sourceKind: "ifc_element",
    ifcGlobalId: "0Q2gXl1Hn3fQ9A2W4k6M8P",
    elementId: "42",
    camera: null,
    version: 1,
  };
  await addSource(document, pdf);
  await addSource(document, ifc);
  await resetSession();
  const anchors = await db.query(
    `select id,private.lukas_drawing_p6_source_anchor_json(
      id,revision_id,project_id
    ) anchor from public.lukas_drawing_object_sources
    where id in($1,$2,$3) order by id`,
    [dxf.id, pdf.id, ifc.id],
  );
  const byId = new Map(anchors.rows.map((row) => [row.id, row.anchor]));
  assert.deepEqual(byId.get(dxf.id), {
    id: dxf.id,
    sourceFileId: dxf.sourceFileId,
    sourceSha256: dxf.sourceSha256,
    sourceKind: dxf.sourceKind,
    pdfPageNumber: null,
    x: null,
    y: null,
    width: null,
    height: null,
    elementId: null,
    ifcGlobalId: null,
    camera: null,
    entityKey: dxf.entityKey,
    entityType: dxf.entityType,
    sourceLayer: dxf.sourceLayer,
    handle: dxf.handle,
    unitCode: dxf.unitCode,
    unitSource: dxf.unitSource,
    importerVersion: dxf.importerVersion,
    version: 1,
  });
  for (const source of [pdf, ifc])
    assert.deepEqual(byId.get(source.id), {
      id: source.id,
      sourceFileId: source.sourceFileId,
      sourceSha256: source.sourceSha256,
      sourceKind: source.sourceKind,
      pdfPageNumber:
        source.sourceKind === "pdf_region" ? source.pdfPageNumber : null,
      x: source.sourceKind === "pdf_region" ? source.x : null,
      y: source.sourceKind === "pdf_region" ? source.y : null,
      width: source.sourceKind === "pdf_region" ? source.width : null,
      height: source.sourceKind === "pdf_region" ? source.height : null,
      elementId: source.sourceKind === "ifc_element" ? source.elementId : null,
      ifcGlobalId:
        source.sourceKind === "ifc_element" ? source.ifcGlobalId : null,
      camera: null,
      version: 1,
    });

  for (const source of [pdf, ifc])
    await applyOperationWithId(
      document,
      randomUUID(),
      { [source.id]: 1 },
      {
        type: "mutate_structure",
        actions: [{ kind: "delete_source", id: source.id, baseVersion: 1 }],
      },
      {
        type: "mutate_structure",
        actions: [{ kind: "put_source", entity: source, baseVersion: null }],
      },
    );

  await setSession("authenticated", OWNER);
  const review = (
    await db.query("select public.lukas_drawing_request_review($1) value", [
      document.revisionId,
    ])
  ).rows[0].value;
  await recordDecision(
    REVIEWER,
    document,
    review,
    "reviewed",
    "DXF BOQ reviewed",
  );
  await recordDecision(
    APPROVER,
    document,
    review,
    "approved",
    "DXF BOQ approved",
  );
  await resetSession();
  const identity = (
    await db.query(
      `select o.lineage_id,o.version object_version,
        pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
          private.lukas_drawing_p6_canonical_json(pg_catalog.jsonb_build_object(
            'geometry',snapshot_object.value->'geometry',
            'id',snapshot_object.value->'id','name',snapshot_object.value->'name',
            'version',snapshot_object.value->'version'
          )),'UTF8'),'sha256'),'hex') fingerprint
       from public.lukas_drawing_objects o
       join public.lukas_drawing_snapshots snapshot
         on snapshot.revision_id=o.revision_id and snapshot.sha256=$2
       cross join lateral pg_catalog.jsonb_array_elements(
         snapshot.canonical_json->'objects'
       ) snapshot_object(value)
       where o.id=$1 and snapshot_object.value->>'id'=o.id::text`,
      [object.id, review.snapshotSha256],
    )
  ).rows[0];
  const quantityLinkId = randomUUID();
  await setSession("service_role", OWNER);
  await db.query(
    `select private.lukas_drawing_insert_quantity_link(
      $1,$2,$3,$4,'count',$5,$6,$7,$8,1,'EA','P4_MEASUREMENT_V1'
    )`,
    [
      OWNER,
      quantityLinkId,
      document.revisionId,
      object.id,
      review.snapshotSha256,
      identity.lineage_id,
      identity.object_version,
      identity.fingerprint,
    ],
  );

  const priceFile = await insertFile({
    project: projectId,
    kind: "other",
    sha256: "9".repeat(64),
  });
  const priceBookId = randomUUID();
  const resourceId = randomUUID();
  const boqVersionId = randomUUID();
  const sectionId = randomUUID();
  const lineId = randomUUID();
  await resetSession();
  await db.query(
    `insert into public.lukas_qto_price_books(
      id,project_id,name,version_label,effective_date,currency,rights_basis,
      license_note,source_file_id,source_sha256,created_by
    ) values($1,$2,'DXF unit prices','1','2026-09-02','KRW','customer_owned',
      'Dedicated DXF PGlite proof',$3,$4,$5)`,
    [priceBookId, projectId, priceFile.id, priceFile.sha256, OWNER],
  );
  await db.query(
    `insert into public.lukas_qto_price_resources(
      id,project_id,price_book_id,resource_code,resource_type,resource_name,
      specification,unit,unit_price_krw,created_by
    ) values($1,$2,$3,'DXF-EA','material','DXF item','','EA',100,$4)`,
    [resourceId, projectId, priceBookId, OWNER],
  );
  await db.query(
    `insert into public.lukas_qto_boq_versions(
      id,project_id,version_no,title,status,calculation_policy,quantity_scale,
      price_book_id,engine_version,created_by
    ) values($1,$2,1,'DXF BOQ','draft','general_half_away',6,$3,
      'VERIFIED-BOQ-1.1',$4)`,
    [boqVersionId, projectId, priceBookId, OWNER],
  );
  await setSession("authenticated", OWNER);
  await db.query(
    `insert into public.lukas_qto_boq_sections(
      id,project_id,version_id,parent_id,code,name,sort_order,created_by
    ) values($1,$2,$3,null,'DXF','DXF',0,$4)`,
    [sectionId, projectId, boqVersionId, OWNER],
  );
  await db.query(
    `insert into public.lukas_qto_boq_lines(
      id,project_id,version_id,section_id,item_code,item_name,specification,
      unit,signed_adjustment,adjustment_reason,sort_order,created_by
    ) values($1,$2,$3,$4,'DXF-001','DXF item','','EA',0,'',0,$5)`,
    [lineId, projectId, boqVersionId, sectionId, OWNER],
  );
  await db.query(
    `insert into public.lukas_qto_boq_rate_components(
      id,project_id,version_id,line_id,resource_id,coefficient,created_by
    ) values($1,$2,$3,$4,$5,1,$6)`,
    [randomUUID(), projectId, boqVersionId, lineId, resourceId, OWNER],
  );
  await setSession("authenticated", OWNER);
  await db.query(
    `select public.lukas_drawing_put_boq_link($1,$2,$3,$4,1,null)`,
    [randomUUID(), quantityLinkId, boqVersionId, lineId],
  );
  const rpc = (
    await db.query("select public.lukas_qto_boq_v1_1_input($1) value", [
      boqVersionId,
    ])
  ).rows[0].value;
  const parsed = parseVerifiedBoqV1_1RpcInput(rpc);
  const parsedDxf = parsed.databaseInput.drawingLinks[0].source.anchors.find(
    (anchor) => anchor.sourceKind === "dxf_entity",
  );
  assert.deepEqual(parsedDxf, byId.get(dxf.id));
  const calculation = calculateVerifiedBoqV1_1(parsed.input);
  assert.equal(calculation.status, "calculated");
  assert.equal(calculation.lines.length, 1);
  assert.equal(calculation.lines[0].finalQuantity, "1");
  assert.equal(calculation.directCostKrw, "100");
});
