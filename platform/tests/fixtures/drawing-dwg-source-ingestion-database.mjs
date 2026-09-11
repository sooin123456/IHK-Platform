import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const ROLES = new Set(["authenticated", "service_role"]);

function quoteRole(role) {
  assert.ok(ROLES.has(role));
  return `"${role}"`;
}

async function asRole(sql, role, actorId, callback) {
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${quoteRole(role)}`);
    await tx`select pg_catalog.set_config(
      'request.jwt.claims',${JSON.stringify({
        role,
        sub: actorId ?? undefined,
        is_anonymous: false,
        app_metadata: {},
      })},true
    )`;
    const result = await callback(tx);
    await tx.unsafe("reset role");
    await tx`select pg_catalog.set_config('request.jwt.claims','{}',true)`;
    return result;
  });
}

const finalize = (sql, verificationId, actorId, projectId) =>
  asRole(sql, "service_role", null, async (tx) => {
    const [row] = await tx`
      select public.lukas_qto_finalize_verified_upload(
        ${verificationId}::uuid,${actorId}::uuid,${projectId}::uuid
      ) value
    `;
    return row.value;
  });

async function assertDatabaseError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    assert.doesNotMatch(error.message, /select |storage_path|source-uploads\//i);
    return true;
  });
}

export async function proveDwgSourceIngestionAuthority({
  owner,
  workerA,
  workerB,
  ids,
}) {
  const projectId = randomUUID();
  await owner`
    insert into public.lukas_qto_projects(
      id,organization_id,owner_id,name,description
    ) values(
      ${projectId}::uuid,${ids.organization}::uuid,${ids.users.owner}::uuid,
      'M1 DWG source authority','Marked-local first-class DWG ingestion proof'
    )
  `;
  await owner`
    insert into public.lukas_qto_project_members(project_id,user_id,role)
    values
      (${projectId}::uuid,${ids.users.editor}::uuid,'estimator'),
      (${projectId}::uuid,${ids.users.viewer}::uuid,'viewer'),
      (${projectId}::uuid,${ids.users.anonymous}::uuid,'estimator')
  `;

  const path = (verificationId) =>
    `${ids.users.owner}/${projectId}/source-uploads/${verificationId}.dwg`;
  const insertEvidence = ({
    actorId,
    id = randomUUID(),
    kind = "dwg",
    sha256 = "a".repeat(64),
    version = "AC1032",
  }) => owner`
    insert into public.lukas_qto_verified_uploads(
      id,actor_id,project_id,kind,storage_path,original_filename,
      content_type,byte_size,sha256,dwg_header_version
    ) values(
      ${id}::uuid,${actorId}::uuid,${projectId}::uuid,${kind},
      ${path(id)},${`${id}.${kind}`},'application/octet-stream',8,
      ${sha256},${version}
    )
  `;

  for (const evidence of [
    { actorId: ids.users.owner, version: null },
    { actorId: ids.users.owner, version: "AC10" },
    { actorId: ids.users.owner, kind: "pdf", version: "AC1032" },
  ])
    await assertDatabaseError(insertEvidence(evidence), "23514");

  const ownerVerificationId = randomUUID();
  await insertEvidence({
    actorId: ids.users.owner,
    id: ownerVerificationId,
    sha256: "1".repeat(64),
    version: "AC1015",
  });
  const ownerFile = await finalize(
    owner,
    ownerVerificationId,
    ids.users.owner,
    projectId,
  );
  assert.equal(ownerFile.kind, "dwg");
  assert.equal(ownerFile.dwgHeaderVersion, "AC1015");
  assert.equal(ownerFile.previousFileId, null);
  await owner`
    update public.lukas_qto_verified_uploads
    set created_at=pg_catalog.clock_timestamp()-interval '2 hours',
      expires_at=pg_catalog.clock_timestamp()-interval '1 hour'
    where id=${ownerVerificationId}::uuid
  `;
  assert.deepEqual(
    await finalize(owner, ownerVerificationId, ids.users.owner, projectId),
    ownerFile,
  );

  const editorVerificationId = randomUUID();
  await insertEvidence({
    actorId: ids.users.editor,
    id: editorVerificationId,
    sha256: "2".repeat(64),
    version: "AC1024",
  });
  const editorFile = await finalize(
    owner,
    editorVerificationId,
    ids.users.editor,
    projectId,
  );
  assert.equal(editorFile.dwgHeaderVersion, "AC1024");
  const editorReplay = await finalize(
    owner,
    editorVerificationId,
    ids.users.editor,
    projectId,
  );
  assert.deepEqual(editorReplay, editorFile);

  for (const actorId of [ids.users.viewer, ids.users.outsider, ids.users.anonymous]) {
    const verificationId = randomUUID();
    await insertEvidence({ actorId, id: verificationId });
    await assertDatabaseError(
      finalize(owner, verificationId, actorId, projectId),
      "P8U04",
    );
    const [pending] = await owner`
      select consumed_file_id from public.lukas_qto_verified_uploads
      where id=${verificationId}::uuid
    `;
    assert.equal(pending.consumed_file_id, null);
  }

  await owner`
    update public.lukas_qto_project_members set role='viewer'
    where project_id=${projectId}::uuid and user_id=${ids.users.editor}::uuid
  `;
  await assertDatabaseError(
    finalize(owner, editorVerificationId, ids.users.editor, projectId),
    "P8U04",
  );
  const [consumedAfterRevocation] = await owner`
    select consumed_file_id from public.lukas_qto_verified_uploads
    where id=${editorVerificationId}::uuid
  `;
  assert.equal(consumedAfterRevocation.consumed_file_id, editorFile.fileId);
  await owner`
    update public.lukas_qto_project_members set role='estimator'
    where project_id=${projectId}::uuid and user_id=${ids.users.editor}::uuid
  `;

  await assertDatabaseError(
    asRole(owner, "authenticated", ids.users.editor, (tx) => tx`
      select public.lukas_drawing_create_document_idempotent(
        ${projectId}::uuid,${editorFile.fileId}::uuid,
        'Raw DWG must remain unavailable',false,${randomUUID()}::uuid,null::uuid
      )
    `),
    "P1R01",
  );
  const [rawWorkspace] = await owner`
    select pg_catalog.count(*)::integer count
    from public.lukas_drawing_documents
    where project_id=${projectId}::uuid and source_file_id=${editorFile.fileId}::uuid
  `;
  assert.equal(rawWorkspace.count, 0);

  const sharedVerificationId = randomUUID();
  await insertEvidence({
    actorId: ids.users.editor,
    id: sharedVerificationId,
    sha256: "3".repeat(64),
  });
  const [sharedA, sharedB] = await Promise.all([
    finalize(workerA, sharedVerificationId, ids.users.editor, projectId),
    finalize(workerB, sharedVerificationId, ids.users.editor, projectId),
  ]);
  assert.deepEqual(sharedB, sharedA);

  const distinctVerificationA = randomUUID();
  const distinctVerificationB = randomUUID();
  await insertEvidence({
    actorId: ids.users.editor,
    id: distinctVerificationA,
    sha256: "4".repeat(64),
    version: "AC1027",
  });
  await insertEvidence({
    actorId: ids.users.editor,
    id: distinctVerificationB,
    sha256: "4".repeat(64),
    version: "AC1032",
  });
  const [distinctA, distinctB] = await Promise.all([
    finalize(workerA, distinctVerificationA, ids.users.editor, projectId),
    finalize(workerB, distinctVerificationB, ids.users.editor, projectId),
  ]);
  assert.notEqual(distinctA.fileId, distinctB.fileId);
  assert.equal(distinctA.dwgHeaderVersion, "AC1027");
  assert.equal(distinctB.dwgHeaderVersion, "AC1032");
  assert.equal(distinctA.previousFileId, null);
  assert.equal(distinctB.previousFileId, null);

  const [authority] = await owner`
    select
      (select pg_catalog.count(*)::integer
       from public.lukas_qto_file_revisions
       where project_id=${projectId}::uuid) revisions,
      (select pg_catalog.count(*)::integer
       from public.lukas_qto_files
       where project_id=${projectId}::uuid and kind='dwg' and immutable) immutable_dwgs,
      (select pg_catalog.count(*)::integer
       from public.lukas_qto_verified_uploads
       where project_id=${projectId}::uuid and consumed_file_id is not null) consumed
  `;
  assert.deepEqual(authority, {
    consumed: 5,
    immutable_dwgs: 5,
    revisions: 0,
  });
  return projectId;
}
