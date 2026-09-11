import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  applyDrawingCommand,
  createDrawingDocumentState,
  redoDrawingCommandUnit,
  undoDrawingCommandUnit,
} from "../../app/lukas/lib/drawing-commands.ts";
import { prepareNativeDrawingDwgProjectImport } from "../../app/lukas/lib/drawing-native-dwg-import-source.server.ts";

const TRANSPORT_QUALIFICATION =
  "direct-postgresql-role-session-loopback-not-postgrest-jwt-or-supabase-storage";
const operationColumns =
  "project_id,revision_id,client_operation_id,operation_type,base_versions,forward,inverse,result_versions,actor_id,history_action,original_operation_id,sequence";
const sourceUrl = new URL(
  "../../../docs/superpowers/evidence/2026-09-06-native-dwg-import-projection/accepted-code/synthetic-source.dwg",
  import.meta.url,
);

const session = (sql, role, actor, callback) =>
  sql.begin(async (tx) => {
    assert.ok(["authenticated", "service_role"].includes(role));
    await tx.unsafe(`set local role "${role}"`);
    await tx`select set_config('request.jwt.claims',${JSON.stringify({ role, sub: actor, is_anonymous: false })},true)`;
    return callback(tx);
  });

function workspaceState(revisionId, snapshot) {
  const keys = [
    "pages",
    "canvases",
    "layers",
    "objects",
    "sources",
    "styles",
    "blocks",
    "blockInstances",
    "propertySchemas",
    "propertyValues",
    "tables",
  ];
  return createDrawingDocumentState({
    revisionId,
    structure: Object.fromEntries(
      keys.map((key) => [
        key,
        Object.fromEntries(
          (snapshot[key] ?? []).map((value) => [value.id, value]),
        ),
      ]),
    ),
  });
}

function operationQuery(sql, actor) {
  const filters = new Map();
  let ids;
  const query = {
    select(columns) {
      assert.equal(columns, operationColumns);
      return query;
    },
    eq(column, value) {
      assert.ok(["project_id", "revision_id"].includes(column));
      filters.set(column, value);
      return query;
    },
    in(column, values) {
      assert.equal(column, "client_operation_id");
      ids = values;
      return query;
    },
    order(column, options) {
      assert.equal(column, "sequence");
      assert.deepEqual(options, { ascending: true });
      return query;
    },
    async limit(limit) {
      try {
        assert.ok(Number.isSafeInteger(limit) && limit > 0);
        assert.equal(filters.size, 2);
        assert.ok(Array.isArray(ids) && ids.length > 0);
        const rows = await session(
          sql,
          "authenticated",
          actor,
          (tx) => tx`
          select project_id,revision_id,client_operation_id,operation_type,
            base_versions,forward,inverse,result_versions,actor_id,
            history_action,original_operation_id,sequence
          from public.lukas_drawing_operations
          where project_id=${filters.get("project_id")}::uuid
            and revision_id=${filters.get("revision_id")}::uuid
            and client_operation_id=any(${ids}::uuid[])
          order by sequence asc
          limit ${limit}
        `,
        );
        return {
          data: rows.map((row) => ({
            ...row,
            sequence: Number(row.sequence),
          })),
          error: null,
        };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
  return query;
}

function createPreparationClient(sql, actor) {
  return {
    auth: {
      async getUser() {
        return {
          data: { user: { id: actor, is_anonymous: false } },
          error: null,
        };
      },
    },
    async rpc(name, args) {
      try {
        assert.equal(name, "lukas_drawing_native_dwg_import_context");
        const [row] = await session(
          sql,
          "authenticated",
          actor,
          (tx) => tx`
          select public.lukas_drawing_native_dwg_import_context(
            ${args.p_job_id}::uuid,${args.p_include_result}
          ) value
        `,
        );
        return { data: row.value, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    from(table) {
      assert.equal(table, "lukas_drawing_operations");
      return operationQuery(sql, actor);
    },
  };
}

function createAttestationClient(sql) {
  return {
    async rpc(name, args) {
      try {
        assert.equal(name, "lukas_drawing_attest_dwg_import_plan");
        const [row] = await session(
          sql,
          "service_role",
          null,
          (tx) => tx`
          select public.lukas_drawing_attest_dwg_import_plan(
            ${args.p_job_id}::uuid,${tx.json(args.p_operations)}::jsonb
          ) value
        `,
        );
        return { data: row.value, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  };
}

async function applyOperation(sql, actor, revisionId, operation) {
  const [row] = await session(
    sql,
    "authenticated",
    actor,
    (tx) => tx`
    select public.lukas_drawing_apply_operation(
      ${revisionId}::uuid,${operation.clientOperationId}::uuid,
      ${operation.type},${tx.json(operation.baseVersions)}::jsonb,
      ${tx.json(operation.forward)}::jsonb,${tx.json(operation.inverse)}::jsonb,
      ${operation.historyAction ?? null},
      ${operation.originalOperationId ?? null}::uuid
    ) value
  `,
  );
  return row.value;
}

function applyPlannedOperation(state, actor, operation) {
  return applyDrawingCommand(
    state,
    {
      type: "mutate_structure",
      actorId: actor,
      actions: operation.forward.actions,
      historyGroup: operation.forward.historyGroup,
    },
    {
      createId: () => operation.clientOperationId,
      now: () => operation.createdAt,
    },
  ).state;
}

export async function proveFreshNativeDwgCanonicalPipeline({
  owner,
  workerA,
  workerB,
  ids,
  scope,
  jobId,
}) {
  const actor = ids.users.editor;
  const client = createPreparationClient(owner, actor);
  const loadAdminClient = async () => ({
    default: createAttestationClient(workerA),
  });
  const input = {
    projectId: scope.projectId,
    revisionId: scope.revisionId,
    canvasId: scope.canvasId,
    jobId,
    actorId: actor,
  };
  const [initial] = await owner`
    select private.lukas_drawing_p2_canonical_snapshot(
      ${scope.revisionId}::uuid,true
    ) value
  `;
  let state = workspaceState(scope.revisionId, initial.value);

  const prepared = await prepareNativeDrawingDwgProjectImport(
    client,
    input,
    loadAdminClient,
  );
  assert.equal(prepared.persistenceAuthority, "operation-attested");
  assert.equal(prepared.canonicalReceipts.length, 0);
  assert.equal(prepared.sources.length, 5);
  assert.equal(prepared.operations.length >= 2, true);

  state = applyPlannedOperation(state, actor, prepared.operations[0]);
  await applyOperation(owner, actor, scope.revisionId, prepared.operations[0]);
  const prefix = await prepareNativeDrawingDwgProjectImport(
    createPreparationClient(owner, actor),
    input,
    loadAdminClient,
  );
  assert.deepEqual(prefix.operations, prepared.operations);
  assert.equal(prefix.canonicalReceipts.length, 1);
  assert.equal(
    prefix.canonicalReceipts[0].clientOperationId,
    prepared.operations[0].clientOperationId,
  );

  for (const operation of prepared.operations.slice(1)) {
    state = applyPlannedOperation(state, actor, operation);
    await applyOperation(owner, actor, scope.revisionId, operation);
  }
  const replay = await prepareNativeDrawingDwgProjectImport(
    createPreparationClient(owner, actor),
    input,
    loadAdminClient,
  );
  assert.deepEqual(replay.operations, prepared.operations);
  assert.equal(replay.canonicalReceipts.length, prepared.operations.length);
  assert.ok(
    replay.canonicalReceipts.every(({ operationSha256 }) =>
      /^[0-9a-f]{64}$/.test(operationSha256),
    ),
  );

  const imported = await workerA`
    select private.lukas_drawing_p2_canonical_snapshot(
      ${scope.revisionId}::uuid,true
    ) value
  `;
  assert.equal(imported[0].value.objects.length, 5);
  assert.equal(imported[0].value.sources.length, 5);
  assert.deepEqual(
    imported[0].value.sources.map(({ handle }) => handle).sort(),
    ["4A", "4B", "4C", "4D", "4E"],
  );
  for (const source of imported[0].value.sources) {
    assert.equal(source.sourceKind, "dwg_entity");
    assert.equal(source.analysisJobId, jobId);
    assert.equal(source.reportSha256, prepared.sources[0].reportSha256);
    assert.equal(source.sourceFileId, scope.sourceFileId);
    assert.equal(source.sourceSha256, scope.sourceSha256);
  }

  const undoImport = undoDrawingCommandUnit(state, actor, {
    createId: randomUUID,
    now: () => new Date().toISOString(),
  });
  assert.equal("kind" in undoImport, false, JSON.stringify(undoImport));
  assert.equal(undoImport.applied.length, prepared.operations.length);
  for (const { operation } of undoImport.applied)
    await applyOperation(owner, actor, scope.revisionId, operation);
  const [removed] = await owner`
    select count(*)::integer count
    from public.lukas_drawing_object_sources
    where revision_id=${scope.revisionId}::uuid and status='active'
  `;
  assert.equal(removed.count, 0);

  const redoImport = redoDrawingCommandUnit(undoImport.state, actor, {
    createId: randomUUID,
    now: () => new Date().toISOString(),
  });
  assert.equal("kind" in redoImport, false, JSON.stringify(redoImport));
  assert.equal(redoImport.applied.length, prepared.operations.length);
  for (const { operation } of redoImport.applied)
    await applyOperation(owner, actor, scope.revisionId, operation);
  state = redoImport.state;

  const lineSource = prepared.sources.find(({ handle }) => handle === "4A");
  assert.ok(lineSource);
  const object = state.structure.objects[lineSource.objectId];
  const editedName = `${object.name} edited`;
  const edit = applyDrawingCommand(
    state,
    {
      type: "update_objects",
      actorId: actor,
      updates: [
        {
          objectId: object.id,
          baseVersion: object.version,
          patch: { name: editedName },
        },
      ],
    },
    { createId: randomUUID, now: () => new Date().toISOString() },
  );
  await applyOperation(owner, actor, scope.revisionId, edit.operation);

  const undoEdit = undoDrawingCommandUnit(edit.state, actor, {
    createId: randomUUID,
    now: () => new Date().toISOString(),
  });
  assert.equal("kind" in undoEdit, false, JSON.stringify(undoEdit));
  assert.equal(undoEdit.applied.length, 1);
  await applyOperation(
    owner,
    actor,
    scope.revisionId,
    undoEdit.applied[0].operation,
  );
  const redoEdit = redoDrawingCommandUnit(undoEdit.state, actor, {
    createId: randomUUID,
    now: () => new Date().toISOString(),
  });
  assert.equal("kind" in redoEdit, false, JSON.stringify(redoEdit));
  assert.equal(redoEdit.applied.length, 1);
  await applyOperation(
    owner,
    actor,
    scope.revisionId,
    redoEdit.applied[0].operation,
  );

  const [checkpoint] = await session(
    owner,
    "authenticated",
    actor,
    (tx) => tx`
      select public.lukas_drawing_collaboration_bootstrap(
        ${scope.revisionId}::uuid
      ) value
    `,
  );
  assert.equal(checkpoint.value.capability, "editor");
  assert.equal(checkpoint.value.canWrite, true);
  assert.equal(
    checkpoint.value.canonicalJson.objects.find(({ id }) => id === object.id)
      .name,
    editedName,
  );
  assert.equal(checkpoint.value.canonicalJson.sources.length, 5);

  const [review] = await session(
    owner,
    "authenticated",
    actor,
    (tx) => tx`
      select public.lukas_drawing_request_review(
        ${scope.revisionId}::uuid
      ) value
    `,
  );
  const [snapshot] = await workerB`
    select canonical_json,sha256
    from public.lukas_drawing_snapshots
    where id=${review.value.snapshotId}::uuid
  `;
  assert.equal(snapshot.canonical_json.sources.length, 5);
  assert.equal(
    snapshot.canonical_json.objects.find(({ id }) => id === object.id).name,
    editedName,
  );

  const sourceBytes = await readFile(sourceUrl);
  const originalSourceSha256 = createHash("sha256")
    .update(sourceBytes)
    .digest("hex");
  const [storedFile] = await workerB`
    select sha256 from public.lukas_qto_files
    where id=${scope.sourceFileId}::uuid
  `;
  assert.equal(originalSourceSha256, scope.sourceSha256);
  assert.equal(storedFile.sha256, originalSourceSha256);

  return {
    transportQualification: TRANSPORT_QUALIFICATION,
    jobId,
    planId: prepared.requestId,
    persistenceAuthority: "operation-attested",
    sourceSha256: originalSourceSha256,
    reportSha256: prepared.sources[0].reportSha256,
    nativeHandles: prepared.sources.map(({ handle }) => handle).sort(),
    objectCount: prepared.objects.length,
    sourceCount: prepared.sources.length,
    planCount: prepared.operations.length,
    recoveredPrefixCount: prefix.canonicalReceipts.length,
    recoveredReceiptCount: replay.canonicalReceipts.length,
    groupedUndoCount: undoImport.applied.length,
    groupedRedoCount: redoImport.applied.length,
    editUndoCount: undoEdit.applied.length,
    editRedoCount: redoEdit.applied.length,
    checkpointOperationSequence: Number(checkpoint.value.operationSequence),
    snapshotSha256: snapshot.sha256,
  };
}
