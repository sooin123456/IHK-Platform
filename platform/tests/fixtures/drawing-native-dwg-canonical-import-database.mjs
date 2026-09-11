import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  applyDrawingCommand,
  createDrawingDocumentState,
  undoDrawingCommandUnit,
  redoDrawingCommandUnit,
} from "../../app/lukas/lib/drawing-commands.ts";
import { parseVerifiedBoqV1_1RpcInput } from "../../app/lukas/lib/drawing-quantity-lineage.server.ts";
import { proveApprovedNativeDwgResaveSource } from "./drawing-native-dwg-resave-source-database.mjs";

const session = (sql, role, actor, callback) =>
  sql.begin(async (tx) => {
    assert.ok(["authenticated", "service_role"].includes(role));
    await tx.unsafe(`set local role "${role}"`);
    await tx`select set_config('request.jwt.claims',${JSON.stringify({ role, sub: actor, is_anonymous: false })},true)`;
    return callback(tx);
  });
const denied = (promise, code) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    return true;
  });

// A missing authority check would persist invented lineage or permit replay of
// changed operations. All probes below execute real PostgreSQL transactions.
export async function proveNativeDwgCanonicalImportAuthority({
  owner,
  workerA,
  workerB,
  ids,
  registerProject,
}) {
  const projectId = randomUUID();
  registerProject(projectId);
  const actor = ids.users.editor,
    verificationId = randomUUID();
  const report = JSON.parse(
    await readFile(
      new URL(
        "../../../docs/superpowers/evidence/2026-09-06-native-dwg-import-projection/accepted-code/native-import.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  // A declared layer-state variant forces all three import phases in this SQL proof.
  report.layers.find((layer) => layer.name === "QA_TEXT").visible = false;
  report.layers.find((layer) => layer.name === "QA_TEXT").locked = true;
  const reportText = JSON.stringify(report);
  const reportSha256 = createHash("sha256").update(reportText).digest("hex");
  await owner`insert into public.lukas_qto_projects(id,organization_id,owner_id,name) values(${projectId}::uuid,${ids.organization}::uuid,${ids.users.owner}::uuid,'Native canonical proof')`;
  await owner`insert into public.lukas_qto_project_members(project_id,user_id,role) values(${projectId}::uuid,${actor}::uuid,'estimator'),(${projectId}::uuid,${ids.users.viewer}::uuid,'viewer')`;
  await owner`insert into public.lukas_qto_project_members(project_id,user_id,role) values(${projectId}::uuid,${ids.users.reviewer}::uuid,'reviewer'),(${projectId}::uuid,${ids.users.approver}::uuid,'approver')`;
  await owner`insert into public.lukas_qto_verified_uploads(id,actor_id,project_id,kind,storage_path,original_filename,content_type,byte_size,sha256,dwg_header_version) values(${verificationId}::uuid,${actor}::uuid,${projectId}::uuid,'dwg',${`${ids.users.owner}/${projectId}/source-uploads/${verificationId}.dwg`},'canonical.dwg','application/octet-stream',${report.source.byteSize},${report.source.sha256},${report.source.headerVersion})`;
  const [file] = await session(
    owner,
    "service_role",
    null,
    (tx) =>
      tx`select public.lukas_qto_finalize_verified_upload(${verificationId}::uuid,${actor}::uuid,${projectId}::uuid) value`,
  );
  const [doc] = await session(
    owner,
    "authenticated",
    actor,
    (tx) =>
      tx`select public.lukas_drawing_create_document_idempotent(${projectId}::uuid,null::uuid,'Canonical native target',true,${randomUUID()}::uuid,null::uuid) value`,
  );
  const [canvas] =
    await owner`select id from public.lukas_drawing_canvases where revision_id=${doc.value.revisionId}::uuid`;
  const scope = {
    projectId,
    documentId: doc.value.documentId,
    revisionId: doc.value.revisionId,
    canvasId: canvas.id,
    sourceFileId: file.value.fileId,
    sourceSha256: report.source.sha256,
    unitOverride: null,
  };
  const [requested] = await session(
    owner,
    "authenticated",
    actor,
    (tx) =>
      tx`select public.lukas_drawing_request_native_dwg_import(${tx.json(scope)},${randomUUID()}::uuid) value`,
  );
  const jobId = requested.value.jobId;
  const [claimed] = await session(
    owner,
    "service_role",
    null,
    (tx) =>
      tx`select public.lukas_drawing_claim_native_dwg_import(${"sha256:" + "a".repeat(64)},300) value`,
  );
  assert.equal(claimed.value.jobId, jobId);
  const c = claimed.value;
  const [completed] = await session(
    owner,
    "service_role",
    null,
    (tx) =>
      tx`select public.lukas_drawing_complete_native_dwg_import(${jobId}::uuid,${c.attemptNumber},${c.leaseToken}::uuid,${c.readerImageId},${reportText},${reportSha256}) value`,
  );
  const context = (who = actor, include = false) =>
    session(
      owner,
      "authenticated",
      who,
      (tx) =>
        tx`select public.lukas_drawing_native_dwg_import_context(${jobId}::uuid,${include}) value`,
    ).then(([r]) => r.value);
  // RED: this RPC does not exist before the canonical migration.
  assert.deepEqual(await context(), {
    scope,
    status: {
      jobId,
      status: "analyzed",
      attemptCount: 1,
      failureCode: null,
      receipt: completed.value,
    },
    result: null,
  });
  assert.deepEqual((await context(actor, true)).result, {
    receipt: completed.value,
    reportText,
  });
  for (const who of [ids.users.owner, ids.users.viewer, ids.users.outsider])
    await denied(context(who, true), "PNI01");
  const { buildNativeDrawingDwgImportPlan } = await import(
    "../../app/lukas/lib/drawing-native-dwg-import-plan.server.ts"
  );
  const plan = buildNativeDrawingDwgImportPlan({
    report,
    expectedSource: report.source,
    revisionId: scope.revisionId,
    canvasId: scope.canvasId,
    sourceFileId: scope.sourceFileId,
    analysisJobId: jobId,
    reportSha256,
  });
  const attest = (
    operations = plan.operations,
    who = null,
    role = "service_role",
  ) =>
    session(
      owner,
      role,
      who,
      (tx) =>
        tx`select public.lukas_drawing_attest_dwg_import_plan(${jobId}::uuid,${tx.json(operations)}) value`,
    ).then(([r]) => r.value);
  const apply = (op, who = actor) =>
    session(
      owner,
      "authenticated",
      who,
      (tx) =>
        tx`select public.lukas_drawing_apply_operation(${scope.revisionId}::uuid,${op.clientOperationId}::uuid,${op.type},${tx.json(op.baseVersions)},${tx.json(op.forward)},${tx.json(op.inverse)},${op.historyAction ?? null},${op.originalOperationId ?? null}::uuid) value`,
    ).then(([r]) => r.value);
  // Global handle coverage is insufficient: each source must belong to the
  // object directly before it in the atomic phase the executor will apply.
  const swapped = structuredClone(plan.operations);
  const swappedPhase = swapped.find((op) =>
    op.forward.actions.some((action) => action.kind === "put_source"),
  );
  [swappedPhase.forward.actions[1], swappedPhase.forward.actions[3]] = [
    swappedPhase.forward.actions[3],
    swappedPhase.forward.actions[1],
  ];
  swappedPhase.inverse.actions = [...swappedPhase.forward.actions]
    .reverse()
    .map((action) => ({
      kind: action.kind.replace("put_", "delete_"),
      id: action.entity.id,
      baseVersion: 1,
    }));
  await denied(attest(swapped), "P1C01");
  const [afterSwapped] = await owner`
    select count(*)::integer issued
    from private.lukas_drawing_dxf_plan_attestations
    where revision_id=${scope.revisionId}::uuid
  `;
  assert.equal(afterSwapped.issued, 0);
  // Synchronize on PostgreSQL's actual blocking graph: attestation has reached
  // the revision lock before this transaction commits a newly acquired freeze.
  const [[blocker], [waiter]] = await Promise.all([
    owner`select pg_backend_pid() pid`,
    workerA`select pg_backend_pid() pid`,
  ]);
  let waitingAttestation;
  try {
    await owner.begin(async (tx) => {
      await tx`select id from public.lukas_drawing_revisions where id=${scope.revisionId}::uuid for update`;
      waitingAttestation = session(
        workerA,
        "service_role",
        null,
        async (sp) => {
          await sp`select set_config('statement_timeout','10000',true)`;
          return sp`select public.lukas_drawing_attest_dwg_import_plan(${jobId}::uuid,${sp.json(plan.operations)}) value`;
        },
      ).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      const deadline = Date.now() + 5000;
      let blocked = false;
      do {
        const [locks] = await workerB`
          select ${blocker.pid}::integer=any(pg_blocking_pids(${waiter.pid}::integer)) blocked
        `;
        blocked = locks.blocked;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      } while (!blocked && Date.now() < deadline);
      assert.equal(
        blocked,
        true,
        "Attestation must be blocked on the held revision lock",
      );
      await tx`insert into private.lukas_drawing_collaboration_freeze_leases(revision_id,project_id,request_id,owner_token,subject_revision_version,lease_expires_at)
        values(${scope.revisionId}::uuid,${projectId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,1,clock_timestamp()+interval '5 minutes')`;
    });
    const outcome = await waitingAttestation;
    assert.equal(
      outcome.error?.code,
      "PNI01",
      "Attestation must recheck authority after the blocking freeze commits",
    );
    const [afterFreeze] = await owner`
      select count(*)::integer issued from private.lukas_drawing_dxf_plan_attestations
      where revision_id=${scope.revisionId}::uuid
    `;
    assert.equal(afterFreeze.issued, 0);
  } finally {
    if (waitingAttestation) await waitingAttestation;
    await owner`delete from private.lukas_drawing_collaboration_freeze_leases where revision_id=${scope.revisionId}::uuid`;
  }
  for (const mutation of [
    (ops) => {
      ops[0].inverse.actions[0].id = randomUUID();
    },
    (ops) => {
      ops.at(-1).forward.actions[0].entity.locked = false;
    },
    (ops) => {
      const op = ops.find((op) => op.forward.actions[0].kind === "put_object");
      op.forward.actions.splice(0, 2);
      op.inverse.actions.splice(-2);
    },
    (ops) => {
      const ss = ops
        .flatMap((op) => op.forward.actions)
        .filter((a) => a.kind === "put_source");
      ss[1].entity.handle = ss[0].entity.handle;
    },
  ]) {
    const bad = structuredClone(plan.operations);
    mutation(bad);
    await denied(attest(bad), "P1C01");
  }
  await denied(attest(plan.operations, actor, "authenticated"), "42501");
  for (const [key, value] of [
    ["analysisJobId", randomUUID()],
    ["reportSha256", "f".repeat(64)],
    ["handle", "FFFF"],
    ["handle", "04A"],
    ["handle", "4a"],
    ["ownerHandle", "FF"],
    ["layerHandle", "FF"],
    ["sourceLayer", "Invented"],
    ["unitCode", 6],
    ["unitSource", "user_selected"],
    ["sourceFileId", randomUUID()],
    ["extra", true],
    ["reportSha256", null],
  ]) {
    const bad = structuredClone(plan.operations);
    const source = bad
      .flatMap((op) => op.forward.actions)
      .find((a) => a.kind === "put_source").entity;
    source[key] = value;
    await denied(attest(bad), "P1C01");
  }
  const receipt = await attest();
  assert.deepEqual(receipt, {
    planId: plan.operations[0].forward.historyGroup.id,
    planCount: plan.operations.length,
    alreadyAppliedCount: 0,
  });
  assert.deepEqual(await attest(), receipt);
  await denied(
    owner`update private.lukas_drawing_dxf_plan_attestations set analysis_job_id=null where revision_id=${scope.revisionId}::uuid`,
    "42501",
  );
  await denied(
    owner`delete from private.lukas_drawing_dxf_plan_attestations where revision_id=${scope.revisionId}::uuid`,
    "42501",
  );
  const changed = structuredClone(plan.operations);
  changed[0].forward.actions[0].entity.name = "Changed";
  await denied(attest(changed), "P1C01");
  await denied(apply(plan.operations[0], ids.users.viewer), "P1R01");
  await denied(apply(plan.operations[0], ids.users.owner), "P1C01");
  const changedOperation = structuredClone(plan.operations[0]);
  changedOperation.forward.actions[0].entity.sortOrder += 1;
  await denied(apply(changedOperation), "P1C01");
  const [initial] =
    await owner`select private.lukas_drawing_p2_canonical_snapshot(${scope.revisionId}::uuid,true) value`;
  let state = createDrawingDocumentState({
    revisionId: scope.revisionId,
    structure: Object.fromEntries(
      [
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
      ].map((key) => [
        key,
        Object.fromEntries(
          (initial.value[key] ?? []).map((value) => [value.id, value]),
        ),
      ]),
    ),
  });
  for (let index = 0; index < plan.operations.length; index++) {
    const op = plan.operations[index];
    const applied = applyDrawingCommand(
      state,
      {
        type: "mutate_structure",
        actorId: actor,
        actions: op.forward.actions,
        historyGroup: op.forward.historyGroup,
      },
      { createId: () => op.clientOperationId, now: () => op.createdAt },
    );
    state = applied.state;
    await apply(plan.operations[index]);
    assert.equal((await attest()).alreadyAppliedCount, index + 1);
    if (index === 0)
      await assert.rejects(
        session(
          owner,
          "authenticated",
          actor,
          (tx) =>
            tx`select public.lukas_drawing_request_review(${scope.revisionId}::uuid)`,
        ),
      );
  }
  const [fresh] =
    await workerA`select private.lukas_drawing_p2_canonical_snapshot(${scope.revisionId}::uuid,true) value`;
  assert.equal(fresh.value.sources.length, 5);
  await proveApprovedNativeDwgResaveSource({
    owner,
    ids,
    scope,
    approved: false,
  });
  assert.deepEqual(fresh.value.sources.map((s) => s.handle).sort(), [
    "4A",
    "4B",
    "4C",
    "4D",
    "4E",
  ]);
  for (const source of fresh.value.sources) {
    assert.equal(source.sourceKind, "dwg_entity");
    assert.equal(source.analysisJobId, jobId);
    assert.equal(source.reportSha256, reportSha256);
  }
  const [sqlAnchor] = await workerA`
    select object_id,private.lukas_drawing_p6_source_anchor_json(
      id,revision_id,project_id
    ) anchor
    from public.lukas_drawing_object_sources
    where id=${fresh.value.sources[0].id}::uuid
  `;
  const lineId = randomUUID(),
    sectionId = randomUUID(),
    priceBookId = randomUUID();
  const parsedBoq = parseVerifiedBoqV1_1RpcInput({
    inputStateSha256: "0".repeat(64),
    input: {
      versionId: randomUUID(),
      projectId,
      engineVersion: "VERIFIED-BOQ-1.1",
      calculationPolicy: "general_half_away",
      quantityScale: 3,
      lines: [
        {
          id: lineId,
          sectionId,
          section: {
            id: sectionId,
            parentId: null,
            code: "DWG",
            name: "Native DWG",
            sortOrder: 0,
          },
          itemCode: "DWG-001",
          itemName: "Native object",
          specification: "",
          unit: "EA",
          adjustment: "0",
          reason: "",
          sortOrder: 0,
        },
      ],
      drawingLinks: [
        {
          id: randomUUID(),
          line: lineId,
          factor: "1",
          version: 1,
          source: {
            id: randomUUID(),
            revisionId: scope.revisionId,
            revisionVersion: 1,
            snapshotSha256: "1".repeat(64),
            objectId: sqlAnchor.object_id,
            lineageId: randomUUID(),
            objectVersion: 1,
            fingerprint: "2".repeat(64),
            kind: "count",
            rawQuantity: "1",
            unit: "EA",
            rule: "P4_MEASUREMENT_V1",
            anchors: [sqlAnchor.anchor],
            issues: [],
          },
        },
      ],
      legacyMappings: [],
      legacyExclusions: [],
      components: [],
      priceBook: {
        id: priceBookId,
        name: "Native DWG proof",
        versionLabel: "1",
        fileId: scope.sourceFileId,
        sha256: report.source.sha256,
        effectiveDate: "2026-09-06",
        currency: "KRW",
        rightsBasis: "customer_owned",
        licenseNote: "fixture",
      },
    },
  });
  assert.deepEqual(
    parsedBoq.databaseInput.drawingLinks[0].source.anchors[0],
    sqlAnchor.anchor,
  );
  const [unchanged] =
    await workerB`select sha256 from public.lukas_qto_files where id=${scope.sourceFileId}::uuid`;
  assert.equal(unchanged.sha256, report.source.sha256);
  await denied(
    session(
      owner,
      "authenticated",
      actor,
      (tx) =>
        tx`update public.lukas_drawing_object_sources set dwg_entity_json='{}' where revision_id=${scope.revisionId}::uuid`,
    ),
    "42501",
  );
  await owner`insert into private.lukas_drawing_collaboration_freeze_leases(revision_id,project_id,request_id,owner_token,subject_revision_version,lease_expires_at) values(${scope.revisionId}::uuid,${projectId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,1,clock_timestamp()+interval '5 minutes')`;
  await denied(context(), "PNI01");
  await denied(attest(), "PNI01");
  await owner`delete from private.lukas_drawing_collaboration_freeze_leases where revision_id=${scope.revisionId}::uuid`;
  const env = { createId: randomUUID, now: () => new Date().toISOString() };
  const undone = undoDrawingCommandUnit(state, actor, env);
  assert.ok(!("kind" in undone), JSON.stringify(undone));
  assert.equal(undone.applied.length, 3);
  for (const { operation } of undone.applied) await apply(operation);
  const [deleted] =
    await owner`select count(*)::integer n from public.lukas_drawing_object_sources where revision_id=${scope.revisionId}::uuid and status='active'`;
  assert.equal(deleted.n, 0);
  const redone = redoDrawingCommandUnit(undone.state, actor, env);
  assert.ok(!("kind" in redone), JSON.stringify(redone));
  for (const { operation } of redone.applied) await apply(operation);
  const [restored] =
    await owner`select private.lukas_drawing_p2_canonical_snapshot(${scope.revisionId}::uuid,true) value`;
  assert.equal(restored.value.sources.length, 5);
  assert.equal(restored.value.sources[0].analysisJobId, jobId);
  // A new ordinary source cannot use the reference rewrite route, even if its
  // report identity is otherwise real and its owning object already exists.
  const anchor = restored.value.sources[0];
  const owning = {
    ...redone.state.structure.objects[anchor.objectId],
    id: randomUUID(),
    layerId: initial.value.layers.find((layer) => layer.systemKind === "work")
      .id,
    version: 1,
  };
  await apply({
    clientOperationId: randomUUID(),
    type: "add_objects",
    baseVersions: {},
    forward: { type: "add_objects", objects: [owning] },
    inverse: { type: "delete_objects", objectIds: [owning.id] },
  });
  await apply({
    clientOperationId: randomUUID(),
    type: "delete_objects",
    baseVersions: { [owning.id]: 1 },
    forward: { type: "delete_objects", objectIds: [owning.id] },
    inverse: { type: "add_objects", objects: [{ ...owning, version: 3 }] },
  });
  const invented = {
    ...anchor,
    id: randomUUID(),
    objectId: owning.id,
    version: 1,
  };
  await assert.rejects(
    apply({
      clientOperationId: randomUUID(),
      type: "mutate_objects_with_references",
      baseVersions: { [owning.id]: 2 },
      forward: {
        type: "mutate_objects_with_references",
        objectAction: "restore",
        objects: [{ ...owning, version: 3 }],
        actions: [{ kind: "put_source", entity: invented, baseVersion: null }],
      },
      inverse: {
        type: "mutate_objects_with_references",
        objectAction: "delete",
        objects: [{ ...owning, version: 3 }],
        actions: [{ kind: "delete_source", id: invented.id, baseVersion: 1 }],
      },
    }),
    (error) => {
      assert.equal(error.code, "P1C01");
      assert.equal(
        error.message,
        "DXF reference rewrite requires a server plan",
      );
      return true;
    },
  );
  const [secondRequested] = await session(
    owner,
    "authenticated",
    actor,
    (tx) =>
      tx`select public.lukas_drawing_request_native_dwg_import(${tx.json(scope)},${randomUUID()}::uuid) value`,
  );
  const [secondClaimed] = await session(
    owner,
    "service_role",
    null,
    (tx) =>
      tx`select public.lukas_drawing_claim_native_dwg_import(${"sha256:" + "a".repeat(64)},300) value`,
  );
  const second = secondClaimed.value;
  assert.equal(second.jobId, secondRequested.value.jobId);
  await session(
    owner,
    "service_role",
    null,
    (tx) =>
      tx`select public.lukas_drawing_complete_native_dwg_import(${second.jobId}::uuid,${second.attemptNumber},${second.leaseToken}::uuid,${second.readerImageId},${reportText},${reportSha256})`,
  );
  const secondPlan = buildNativeDrawingDwgImportPlan({
    report,
    expectedSource: report.source,
    revisionId: scope.revisionId,
    canvasId: scope.canvasId,
    sourceFileId: scope.sourceFileId,
    analysisJobId: second.jobId,
    reportSha256,
  });
  await denied(
    session(
      owner,
      "service_role",
      null,
      (tx) =>
        tx`select public.lukas_drawing_attest_dwg_import_plan(${second.jobId}::uuid,${tx.json(secondPlan.operations)})`,
    ),
    "P1C01",
  );
  const [checkpointReview] = await session(
    owner,
    "authenticated",
    actor,
    (tx) =>
      tx`select public.lukas_drawing_request_review(${scope.revisionId}::uuid) value`,
  );
  const [checkpoint] =
    await owner`select canonical_json,sha256,revision_version from public.lukas_drawing_snapshots where id=${checkpointReview.value.snapshotId}::uuid`;
  await session(
    owner,
    "authenticated",
    ids.users.reviewer,
    (tx) =>
      tx`select public.lukas_drawing_record_revision_decision(${scope.revisionId}::uuid,${checkpoint.revision_version}::bigint,${checkpoint.sha256},'rejected','Checkpoint source restore proof')`,
  );
  await apply({
    clientOperationId: randomUUID(),
    type: "mutate_structure",
    baseVersions: { [anchor.id]: anchor.version },
    forward: {
      type: "mutate_structure",
      actions: [
        { kind: "delete_source", id: anchor.id, baseVersion: anchor.version },
      ],
    },
    inverse: {
      type: "mutate_structure",
      actions: [{ kind: "put_source", entity: anchor, baseVersion: null }],
    },
  });
  const checkpointRestored = await apply({
    clientOperationId: randomUUID(),
    type: "restore_checkpoint",
    baseVersions: {},
    forward: {
      type: "restore_checkpoint",
      checkpointId: checkpointReview.value.snapshotId,
      actions: [{ kind: "put_source", entity: anchor, baseVersion: null }],
    },
    inverse: {
      type: "restore_checkpoint",
      checkpointId: checkpointReview.value.snapshotId,
      actions: [
        {
          kind: "delete_source",
          id: anchor.id,
          baseVersion: anchor.version + 2,
        },
      ],
    },
  });
  assert.equal(
    checkpointRestored.resultVersions[anchor.id],
    anchor.version + 2,
  );
  const [checkpointAfter] =
    await workerA`select canonical_json,sha256 from public.lukas_drawing_snapshots where id=${checkpointReview.value.snapshotId}::uuid`;
  assert.deepEqual(checkpointAfter, {
    canonical_json: checkpoint.canonical_json,
    sha256: checkpoint.sha256,
  });
  const [review] = await session(
    owner,
    "authenticated",
    actor,
    (tx) =>
      tx`select public.lukas_drawing_request_review(${scope.revisionId}::uuid) value`,
  );
  await denied(context(), "PNI01");
  await denied(attest(), "PNI01");
  const [snapshot] =
    await owner`select canonical_json,sha256,revision_version from public.lukas_drawing_snapshots where id=${review.value.snapshotId}::uuid`;
  assert.equal(snapshot.canonical_json.sources.length, 5);
  for (const [who, decision] of [
    [ids.users.reviewer, "reviewed"],
    [ids.users.approver, "approved"],
  ])
    await session(
      owner,
      "authenticated",
      who,
      (tx) =>
        tx`select public.lukas_drawing_record_revision_decision(${scope.revisionId}::uuid,${snapshot.revision_version}::bigint,${snapshot.sha256},${decision},'Native lineage proof')`,
    );
  await proveApprovedNativeDwgResaveSource({
    owner,
    ids,
    scope,
    approved: true,
  });
  for (const method of ["template", "restore"]) {
    const cloneRequestId = randomUUID();
    const cloneCall = () =>
      session(owner, "authenticated", actor, (tx) =>
        method === "template"
          ? tx`select public.lukas_drawing_create_from_template(${scope.revisionId}::uuid,'Native clone',null::uuid,${cloneRequestId}::uuid) value`
          : tx`select public.lukas_drawing_restore_approved_snapshot(${scope.revisionId}::uuid,${cloneRequestId}::uuid) value`,
      );
    const [clone] = await cloneCall();
    assert.deepEqual((await cloneCall())[0].value, clone.value);
    const [copy] =
      await workerB`select private.lukas_drawing_p2_canonical_snapshot(${clone.value.revisionId}::uuid,true) value`;
    assert.equal(copy.value.sources.length, 5, method);
    for (const source of copy.value.sources) {
      assert.equal(source.analysisJobId, jobId);
      assert.equal(source.reportSha256, reportSha256);
      assert.notEqual(source.revisionId, scope.revisionId);
    }
    const locked = copy.value.layers.find((layer) => layer.name === "QA_TEXT");
    assert.equal(locked.visible, false);
    assert.equal(locked.locked, true);
    assert.equal(locked.version, 2);
    const cloneScope = {
      ...scope,
      documentId: copy.value.revision.documentId,
      revisionId: clone.value.revisionId,
      canvasId: copy.value.canvases[0].id,
    };
    await proveApprovedNativeDwgResaveSource({
      owner,
      ids,
      scope: cloneScope,
      approved: false,
    });
    const [cloneReview] = await session(
      owner,
      "authenticated",
      actor,
      (tx) =>
        tx`select public.lukas_drawing_request_review(${cloneScope.revisionId}::uuid) value`,
    );
    const [cloneSnapshot] =
      await owner`select sha256,revision_version from public.lukas_drawing_snapshots where id=${cloneReview.value.snapshotId}::uuid`;
    for (const [who, decision] of [
      [ids.users.reviewer, "reviewed"],
      [ids.users.approver, "approved"],
    ])
      await session(
        owner,
        "authenticated",
        who,
        (tx) =>
          tx`select public.lukas_drawing_record_revision_decision(${cloneScope.revisionId}::uuid,${cloneSnapshot.revision_version}::bigint,${cloneSnapshot.sha256},${decision},'Approved clone resave proof')`,
      );
    await proveApprovedNativeDwgResaveSource({
      owner,
      ids,
      scope: cloneScope,
      approved: true,
    });
  }
  for (const [table, code] of [
    ["lukas_drawing_template_clone_requests", "P1C01"],
    ["lukas_drawing_snapshot_restore_requests", "P3S01"],
  ]) {
    await denied(
      owner.unsafe(`delete from private.${table} where project_id=$1::uuid`, [
        projectId,
      ]),
      code,
    );
    await denied(
      owner.begin(async (tx) => {
        await tx`select set_config('app.lukas_retention_purge_project',${randomUUID()},true)`;
        return tx.unsafe(
          `delete from private.${table} where project_id=$1::uuid`,
          [projectId],
        );
      }),
      code,
    );
    await denied(
      owner.begin(async (tx) => {
        await tx`select set_config('app.lukas_retention_purge_project',${projectId},true)`;
        return tx.unsafe(
          `delete from private.${table} where project_id=$1::uuid`,
          [projectId],
        );
      }),
      code,
    );
  }
  // The generalized executor and locked clone staging must retain DXF behavior.
  const { buildDrawingDxfImportPlan } = await import(
    "../../app/lukas/lib/drawing-dxf-import-plan.server.ts"
  );
  const dxfBytes = new TextEncoder().encode(
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
      "LOCKED_DXF",
      "70",
      "4",
      "62",
      "-7",
      "0",
      "ENDTAB",
      "0",
      "ENDSEC",
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "LINE",
      "5",
      "AB",
      "8",
      "LOCKED_DXF",
      "10",
      "0",
      "20",
      "0",
      "11",
      "100",
      "21",
      "0",
      "0",
      "ENDSEC",
      "0",
      "EOF",
      "",
    ].join("\n"),
  );
  const dxfHash = createHash("sha256").update(dxfBytes).digest("hex"),
    dxfFile = randomUUID();
  await owner`insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,storage_path,original_filename,content_type,byte_size,sha256,immutable) values(${dxfFile}::uuid,${projectId}::uuid,${actor}::uuid,'dxf',${`${projectId}/${dxfFile}.dxf`},'locked.dxf','application/dxf',${dxfBytes.length},${dxfHash},true)`;
  const [dxfDoc] = await session(
    owner,
    "authenticated",
    actor,
    (tx) =>
      tx`select public.lukas_drawing_create_document_idempotent(${projectId}::uuid,null::uuid,'DXF regression target',true,${randomUUID()}::uuid,null::uuid) value`,
  );
  const [dxfCanvas] =
    await owner`select id from public.lukas_drawing_canvases where revision_id=${dxfDoc.value.revisionId}::uuid`;
  const dxfPlan = await buildDrawingDxfImportPlan({
    bytes: dxfBytes,
    revisionId: dxfDoc.value.revisionId,
    canvasId: dxfCanvas.id,
    sourceFileId: dxfFile,
    createdAt: "2026-09-06T00:00:00.000Z",
  });
  assert.equal(dxfPlan.operations.length, 3);
  const attestDxf = () =>
    session(
      owner,
      "service_role",
      null,
      (tx) =>
        tx`select public.lukas_drawing_attest_dxf_import_plan(${actor}::uuid,${projectId}::uuid,${dxfDoc.value.revisionId}::uuid,${dxfCanvas.id}::uuid,${dxfFile}::uuid,${dxfHash},${tx.json(dxfPlan.operations)}) value`,
    ).then(([r]) => r.value);
  await attestDxf();
  for (const op of dxfPlan.operations)
    await session(
      owner,
      "authenticated",
      actor,
      (tx) =>
        tx`select public.lukas_drawing_apply_operation(${op.revisionId}::uuid,${op.clientOperationId}::uuid,${op.type},${tx.json(op.baseVersions)},${tx.json(op.forward)},${tx.json(op.inverse)},null::text,null::uuid)`,
    );
  assert.equal((await attestDxf()).alreadyAppliedCount, 3);
  const [dxfReview] = await session(
    owner,
    "authenticated",
    actor,
    (tx) =>
      tx`select public.lukas_drawing_request_review(${dxfDoc.value.revisionId}::uuid) value`,
  );
  const [dxfSnapshot] =
    await owner`select sha256,revision_version from public.lukas_drawing_snapshots where id=${dxfReview.value.snapshotId}::uuid`;
  for (const [who, decision] of [
    [ids.users.reviewer, "reviewed"],
    [ids.users.approver, "approved"],
  ])
    await session(
      owner,
      "authenticated",
      who,
      (tx) =>
        tx`select public.lukas_drawing_record_revision_decision(${dxfDoc.value.revisionId}::uuid,${dxfSnapshot.revision_version}::bigint,${dxfSnapshot.sha256},${decision},'DXF regression proof')`,
    );
  const [dxfClone] = await session(
    owner,
    "authenticated",
    actor,
    (tx) =>
      tx`select public.lukas_drawing_create_from_template(${dxfDoc.value.revisionId}::uuid,'Locked DXF clone',null::uuid,${randomUUID()}::uuid) value`,
  );
  const [dxfCopy] =
    await workerB`select private.lukas_drawing_p2_canonical_snapshot(${dxfClone.value.revisionId}::uuid,true) value`;
  assert.equal(dxfCopy.value.sources[0].sourceKind, "dxf_entity");
  assert.equal(dxfCopy.value.sources[0].handle, "AB");
  const dxfLayer = dxfCopy.value.layers.find(
    (layer) => layer.name === "LOCKED_DXF",
  );
  assert.equal(dxfLayer.locked, true);
  assert.equal(dxfLayer.visible, false);
  assert.equal(dxfLayer.version, 2);
  // Frozen override selection agrees with the native projector: supported
  // declared units remain declared even when the caller selected the same unit.
  for (const unitCode of [4, 0]) {
    const [unitDoc] = await session(
      owner,
      "authenticated",
      actor,
      (tx) =>
        tx`select public.lukas_drawing_create_document_idempotent(${projectId}::uuid,null::uuid,'Unit authority target',true,${randomUUID()}::uuid,null::uuid) value`,
    );
    const [unitCanvas] =
      await owner`select id from public.lukas_drawing_canvases where revision_id=${unitDoc.value.revisionId}::uuid`;
    const unitScope = {
      ...scope,
      documentId: unitDoc.value.documentId,
      revisionId: unitDoc.value.revisionId,
      canvasId: unitCanvas.id,
      unitOverride: 4,
    };
    const unitReport = { ...report, unitCode },
      unitText = JSON.stringify(unitReport),
      unitHash = createHash("sha256").update(unitText).digest("hex");
    const [unitRequested] = await session(
      owner,
      "authenticated",
      actor,
      (tx) =>
        tx`select public.lukas_drawing_request_native_dwg_import(${tx.json(unitScope)},${randomUUID()}::uuid) value`,
    );
    const [unitClaimed] = await session(
      owner,
      "service_role",
      null,
      (tx) =>
        tx`select public.lukas_drawing_claim_native_dwg_import(${"sha256:" + "a".repeat(64)},300) value`,
    );
    const unitJob = unitClaimed.value;
    assert.equal(unitJob.jobId, unitRequested.value.jobId);
    await session(
      owner,
      "service_role",
      null,
      (tx) =>
        tx`select public.lukas_drawing_complete_native_dwg_import(${unitJob.jobId}::uuid,${unitJob.attemptNumber},${unitJob.leaseToken}::uuid,${unitJob.readerImageId},${unitText},${unitHash})`,
    );
    const unitPlan = buildNativeDrawingDwgImportPlan({
      report: unitReport,
      expectedSource: report.source,
      ...unitScope,
      analysisJobId: unitJob.jobId,
      reportSha256: unitHash,
      unitOverride: { code: 4, label: "mm" },
    });
    assert.equal(
      unitPlan.sources[0].unitSource,
      unitCode === 4 ? "declared" : "user_selected",
    );
    await session(
      owner,
      "service_role",
      null,
      (tx) =>
        tx`select public.lukas_drawing_attest_dwg_import_plan(${unitJob.jobId}::uuid,${tx.json(unitPlan.operations)})`,
    );
  }
  return { projectId, scope, jobId, plan };
}
