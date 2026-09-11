import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

export async function proveApprovedNativeDwgResaveSource({
  owner,
  ids,
  scope,
  approved,
}) {
  const [revision] =
    await owner`select version from public.lukas_drawing_revisions where id=${scope.revisionId}::uuid`;
  const [snapshot] =
    await owner`select sha256,canonical_json from public.lukas_drawing_snapshots where revision_id=${scope.revisionId}::uuid and revision_version=${revision.version}::bigint`;
  const request = {
    projectId: scope.projectId,
    documentId: scope.documentId,
    revisionId: scope.revisionId,
    revisionVersion: Number(revision.version),
    canvasId: scope.canvasId,
    snapshotSha256: snapshot?.sha256 ?? "0".repeat(64),
  };
  const call = (
    actor = ids.users.editor,
    input = request,
    role = "authenticated",
    anonymous = false,
  ) =>
    owner.begin(async (tx) => {
      assert.ok(["authenticated", "anon", "service_role"].includes(role));
      await tx.unsafe(`set local role "${role}"`);
      await tx`select set_config('request.jwt.claims',${JSON.stringify({ role, sub: actor, is_anonymous: anonymous })},true)`;
      const [row] =
        await tx`select public.lukas_qto_drawing_native_dwg_resave_source(${tx.json(input)}) value`;
      return row.value;
    });
  const denied = (promise, code = "PNR01") =>
    assert.rejects(promise, (e) => {
      assert.equal(e.code, code, e.message);
      if (code === "PNR01")
        assert.equal(e.message, "Approved DWG resave source is unavailable");
      return true;
    });
  if (!approved) {
    await denied(call());
    return;
  }
  const payload = await call();
  for (const role of [
    "anon",
    "authenticated",
    "service_role",
    "lukas_drawing_collaboration",
  ]) {
    const [privileges] = await owner`select
      has_function_privilege(${role},'private.lukas_drawing_native_dwg_resave_source_for_actor(uuid,jsonb)','EXECUTE') private_execute,
      has_function_privilege(${role},'public.lukas_qto_drawing_native_dwg_resave_source(jsonb)','EXECUTE') public_execute`;
    assert.deepEqual(privileges, {
      private_execute: false,
      public_execute: role === "authenticated",
    });
  }
  assert.deepEqual(Object.keys(payload).sort(), ["analysis", "approved"]);
  assert.equal(payload.approved.snapshot.sha256, request.snapshotSha256);
  assert.equal(payload.analysis.scope.sourceFileId, scope.sourceFileId);
  assert.deepEqual(Object.keys(payload.analysis.result.receipt.source).sort(), [
    "byteSize",
    "fileId",
    "headerVersion",
    "sha256",
    "verificationId",
  ]);
  // Imported revisions must remain ineligible for the original source-free branch.
  await denied(
    owner.begin(async (tx) => {
      await tx.unsafe("set local role authenticated");
      await tx`select set_config('request.jwt.claims',${JSON.stringify({ role: "authenticated", sub: ids.users.editor, is_anonymous: false })},true)`;
      return tx`select public.lukas_qto_drawing_native_dwg_source(${request.projectId}::uuid,${request.documentId}::uuid,${request.revisionId}::uuid,${request.revisionVersion}::bigint,${request.canvasId}::uuid,${request.snapshotSha256})`;
    }),
    "PND01",
  );
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    resolve: {
      alias: { "~": fileURLToPath(new URL("../../app", import.meta.url)) },
    },
    server: { middlewareMode: true },
  });
  try {
    const { projectApprovedNativeDrawingDwgResaveSource } =
      await vite.ssrLoadModule(
        "/app/lukas/lib/drawing-native-dwg-resave-source.server.ts",
      );
    const result = await projectApprovedNativeDrawingDwgResaveSource(
      request,
      payload,
    );
    assert.equal(result.selectedEdits.request, null);
    assert.deepEqual(
      result.bindings.map((b) => b.objectId).sort(),
      snapshot.canonical_json.objects.map((o) => o.id).sort(),
    );
    assert.deepEqual(
      result.bindings.map((b) => b.handle),
      ["4A", "4B", "4C", "4D", "4E"],
    );
    assert.equal(result.selectedEdits.persistenceAuthority, "not-issued");
  } finally {
    await vite.close();
  }
  await denied(call(ids.users.outsider));
  assert.equal(
    (await call(ids.users.viewer)).approved.snapshot.sha256,
    request.snapshotSha256,
  );
  await denied(call(null));
  await denied(call(ids.users.editor, request, "authenticated", true));
  await denied(call(null, request, "anon"), "42501");
  await denied(call(null, request, "service_role"), "42501");
  for (const patch of [
    { projectId: randomUUID() },
    { documentId: randomUUID() },
    { canvasId: randomUUID() },
    { revisionId: randomUUID() },
    { revisionVersion: request.revisionVersion + 1 },
    { snapshotSha256: "f".repeat(64) },
    { extra: true },
  ])
    await denied(call(ids.users.editor, { ...request, ...patch }));
  const sourceId = snapshot.canonical_json.sources[0].id;
  // Poison evidence only inside this disposable fixture's rolled-back owner
  // transaction. Bypass write guards so the read contract itself is tested.
  const corruptions = [
    (tx) =>
      tx`update public.lukas_qto_projects set archived_at=clock_timestamp(),archived_by=${ids.users.owner}::uuid,retention_event_id=${randomUUID()}::uuid where id=${scope.projectId}::uuid`,
    (tx) =>
      tx`update public.lukas_qto_projects set archived_at=clock_timestamp(),archived_by=${ids.users.owner}::uuid,retention_event_id=${randomUUID()}::uuid,deletion_requested_at=clock_timestamp(),deletion_requested_by=${ids.users.owner}::uuid,purge_after=clock_timestamp()+interval '1 day' where id=${scope.projectId}::uuid`,
    (tx) =>
      tx`delete from public.lukas_qto_project_members where project_id=${scope.projectId}::uuid and user_id=${ids.users.editor}::uuid`,
    (tx) =>
      tx`update public.lukas_drawing_object_sources set status='deleted' where id=${sourceId}::uuid`,
    (tx) =>
      tx`update public.lukas_drawing_object_sources set dwg_entity_json=jsonb_set(dwg_entity_json,'{handle}','"FFFF"') where id=${sourceId}::uuid`,
    (tx) =>
      tx`update public.lukas_qto_verified_uploads set dwg_header_version='AC9999' where consumed_file_id=${scope.sourceFileId}::uuid`,
    (tx) =>
      tx`update public.lukas_drawing_native_dwg_import_results set reader_image_id=${"sha256:" + "f".repeat(64)} where job_id=${payload.analysis.result.receipt.jobId}::uuid`,
    (tx) =>
      tx`update public.lukas_drawing_snapshots set canonical_json=jsonb_set(canonical_json,'{operationSequence}','999') where revision_id=${request.revisionId}::uuid and revision_version=${request.revisionVersion}::bigint`,
    (tx) =>
      tx`update public.lukas_drawing_documents set source_file_id=${scope.sourceFileId}::uuid,source_sha256=${"f".repeat(64)} where id=${request.documentId}::uuid`,
  ];
  for (const corrupt of corruptions)
    await denied(
      owner.begin(async (tx) => {
        await tx.unsafe("set local session_replication_role=replica");
        await corrupt(tx);
        await tx.unsafe("set local role authenticated");
        await tx`select set_config('request.jwt.claims',${JSON.stringify({ role: "authenticated", sub: ids.users.editor, is_anonymous: false })},true)`;
        return tx`select public.lukas_qto_drawing_native_dwg_resave_source(${tx.json(request)})`;
      }),
    );
  for (const field of ["banned_until", "deleted_at"]) {
    await owner
      .begin(async (tx) => {
        await tx.unsafe(
          `update auth.users set ${field}=clock_timestamp()+interval '1 day' where id=$1::uuid`,
          [ids.users.editor],
        );
        const [row] =
          await tx`select private.lukas_drawing_native_dwg_resave_source_for_actor(${ids.users.editor}::uuid,${tx.json(request)}) value`;
        assert.equal(row.value, null);
        throw Object.assign(new Error("rollback probe"), {
          rollbackProbe: true,
        });
      })
      .catch((e) => {
        if (!e.rollbackProbe) throw e;
      });
  }
  const [preserved] =
    await owner`select sha256,canonical_json::text snapshot_text from public.lukas_drawing_snapshots where revision_id=${request.revisionId}::uuid and revision_version=${request.revisionVersion}::bigint`;
  assert.equal(preserved.sha256, request.snapshotSha256);
  assert.equal(
    preserved.snapshot_text,
    payload.approved.snapshot.canonicalJsonText,
  );
  const [file] =
    await owner`select sha256 from public.lukas_qto_files where id=${scope.sourceFileId}::uuid`;
  assert.equal(file.sha256, scope.sourceSha256);
  const plan =
    await owner`explain (analyze,buffers,format json) select private.lukas_drawing_native_dwg_resave_source_for_actor(${ids.users.editor}::uuid,${owner.json(request)})`;
  console.info("Approved DWG resave RPC accepted", {
    revisionId: request.revisionId,
    objects: 5,
    executionMilliseconds: plan[0]["QUERY PLAN"][0]["Execution Time"],
  });
}
