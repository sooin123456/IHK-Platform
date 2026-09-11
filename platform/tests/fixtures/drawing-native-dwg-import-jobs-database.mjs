import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

const image = `sha256:${"a".repeat(64)}`;
const otherImage = `sha256:${"b".repeat(64)}`;
const digest = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const tables = ["jobs", "attempts", "results"].map(
  (suffix) => `lukas_drawing_native_dwg_import_${suffix}`,
);
const session = (sql, role, actor, callback, claims = {}) =>
  sql.begin(async (tx) => {
    assert.ok(["anon", "authenticated", "service_role"].includes(role));
    await tx.unsafe(`set local role "${role}"`);
    await tx`select set_config('request.jwt.claims',${JSON.stringify({ role, sub: actor, is_anonymous: false, ...claims })},true)`;
    return callback(tx);
  });
const rejected = (promise, code) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    return true;
  });

// Every assertion exercises PostgreSQL authority: removing validation, grants,
// locking, evidence guards, or retry bounds must change these observable outcomes.
export async function proveNativeDwgImportJobAuthority({
  owner,
  workerA,
  workerB,
  ids,
  registerProject = () => {},
}) {
  const projectId = randomUUID();
  registerProject(projectId); // Register cleanup before any durable setup can fail.
  const actor = ids.users.editor;
  const verificationId = randomUUID();
  const sourceHash = "d".repeat(64);
  const path = `${ids.users.owner}/${projectId}/source-uploads/${verificationId}.dwg`;
  await owner`insert into public.lukas_qto_projects(id,organization_id,owner_id,name)
    values(${projectId}::uuid,${ids.organization}::uuid,${ids.users.owner}::uuid,'Native DWG analysis proof')`;
  await owner`insert into public.lukas_qto_project_members(project_id,user_id,role) values
    (${projectId}::uuid,${actor}::uuid,'estimator'),
    (${projectId}::uuid,${ids.users.viewer}::uuid,'viewer'),
    (${projectId}::uuid,${ids.users.anonymous}::uuid,'estimator')`;
  await owner`insert into public.lukas_qto_verified_uploads(id,actor_id,project_id,kind,storage_path,original_filename,content_type,byte_size,sha256,dwg_header_version)
    values(${verificationId}::uuid,${actor}::uuid,${projectId}::uuid,'dwg',${path},'analysis.dwg','application/octet-stream',8,${sourceHash},'AC1032')`;
  const [file] = await session(
    owner,
    "service_role",
    null,
    (tx) =>
      tx`select public.lukas_qto_finalize_verified_upload(${verificationId}::uuid,${actor}::uuid,${projectId}::uuid) value`,
  );
  const [document] = await session(
    owner,
    "authenticated",
    actor,
    (tx) =>
      tx`select public.lukas_drawing_create_document_idempotent(${projectId}::uuid,null::uuid,'Analysis target',true,${randomUUID()}::uuid,null::uuid) value`,
  );
  const [canvas] =
    await owner`select id from public.lukas_drawing_canvases where revision_id=${document.value.revisionId}::uuid`;
  const scope = {
    projectId,
    documentId: document.value.documentId,
    revisionId: document.value.revisionId,
    canvasId: canvas.id,
    sourceFileId: file.value.fileId,
    sourceSha256: sourceHash,
    unitOverride: null,
  };
  const request = (
    who = actor,
    value = scope,
    requestId = randomUUID(),
    claims,
  ) =>
    session(
      owner,
      "authenticated",
      who,
      (tx) =>
        tx`select public.lukas_drawing_request_native_dwg_import(${tx.json(value)}::jsonb,${requestId}::uuid) value`,
      claims,
    ).then(([row]) => row.value);
  const status = (jobId, who = actor, value = scope) =>
    session(
      owner,
      "authenticated",
      who,
      (tx) =>
        tx`select public.lukas_drawing_native_dwg_import_status(${tx.json(value)}::jsonb,${jobId}::uuid) value`,
    ).then(([row]) => row.value);
  const result = (jobId, who = actor) =>
    session(
      owner,
      "authenticated",
      who,
      (tx) =>
        tx`select public.lukas_drawing_native_dwg_import_result(${tx.json(scope)}::jsonb,${jobId}::uuid) value`,
    ).then(([row]) => row.value);
  const claim = (sql = owner, reader = image, seconds = 300) =>
    session(
      sql,
      "service_role",
      null,
      (tx) =>
        tx`select public.lukas_drawing_claim_native_dwg_import(${reader},${seconds}::integer) value`,
    ).then(([row]) => row.value);
  const report = {
    schemaVersion: "1hk-dwg-import/1",
    qualification: "experimental-unqualified",
    source: { sha256: sourceHash, byteSize: 8, headerVersion: "AC1032" },
    engine: { name: "ACadSharp", version: "3.7.1" },
    coordinateSystem: "WCS_NATIVE_UNITS",
    unitCode: 4,
    modelSpaceHandle: "1F",
    layers: [],
    entities: [],
    coverage: {
      modelSpaceEntities: 0,
      importedEntities: 0,
      unsupportedEntities: 0,
      nonModelSpaceEntities: 0,
    },
    unsupported: [],
    readerNotificationCount: 0,
  };
  const reportText = JSON.stringify(report);
  const complete = (
    c,
    text = reportText,
    hash = digest(text),
    reader = c.readerImageId,
  ) =>
    session(
      owner,
      "service_role",
      null,
      (tx) =>
        tx`select public.lukas_drawing_complete_native_dwg_import(${c.jobId}::uuid,${c.attemptNumber}::integer,${c.leaseToken}::uuid,${reader},${text},${hash}) value`,
    ).then(([row]) => row.value);
  const fail = (c, code = "reader_failed", retryable = true) =>
    session(
      owner,
      "service_role",
      null,
      (tx) =>
        tx`select public.lukas_drawing_fail_native_dwg_import(${c.jobId}::uuid,${c.attemptNumber}::integer,${c.leaseToken}::uuid,${code},${retryable}) value`,
    ).then(([row]) => row.value);
  const expire = (jobId) =>
    owner`update public.lukas_drawing_native_dwg_import_jobs set lease_expires_at=clock_timestamp()-interval '1 second',next_attempt_at=clock_timestamp()-interval '1 second' where id=${jobId}::uuid`;
  const ready = (jobId) =>
    owner`update public.lukas_drawing_native_dwg_import_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id=${jobId}::uuid`;

  // RED starts here against an empty migration: missing request RPC (42883).
  const requestId = randomUUID();
  const accepted = await request(actor, scope, requestId);
  assert.deepEqual(Object.keys(accepted), ["jobId"]);
  assert.deepEqual(await request(actor, scope, requestId), accepted);
  await rejected(
    request(actor, { ...scope, unitOverride: 4 }, requestId),
    "PNI02",
  );
  for (const who of [ids.users.viewer, ids.users.outsider, ids.users.anonymous])
    await rejected(request(who), "PNI01");
  await rejected(
    request(actor, scope, randomUUID(), { is_anonymous: true }),
    "PNI01",
  );
  for (const invalid of [
    { ...scope, extra: true },
    { ...scope, unitOverride: 3 },
    { ...scope, sourceSha256: "e".repeat(64) },
    { ...scope, canvasId: randomUUID() },
    { ...scope, projectId: ids.foreignProject },
  ])
    await rejected(request(actor, invalid), "PNI01");
  assert.equal(await status(randomUUID()), null);
  assert.equal(await status(accepted.jobId, ids.users.owner), null);
  for (const field of ["deleted_at", "banned_until"]) {
    await owner.unsafe(
      `update auth.users set ${field}=clock_timestamp()+interval '1 hour' where id=$1::uuid`,
      [actor],
    );
    await rejected(request(), "PNI01");
    await rejected(status(accepted.jobId), "PNI01");
    await owner.unsafe(
      `update auth.users set ${field}=null where id=$1::uuid`,
      [actor],
    );
  }
  await owner`update public.lukas_qto_verified_uploads set consumed_file_id=null,consumed_at=null where id=${verificationId}::uuid`;
  await rejected(request(), "PNI01");
  await owner`update public.lukas_qto_verified_uploads set consumed_file_id=${scope.sourceFileId}::uuid,consumed_at=clock_timestamp() where id=${verificationId}::uuid`;
  const otherFileId = randomUUID();
  await owner`insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,storage_path,original_filename,content_type,byte_size,sha256,immutable)
    values(${otherFileId}::uuid,${projectId}::uuid,${actor}::uuid,'other',${`${path}.other`},'other.bin','application/octet-stream',8,${sourceHash},true)`;
  await rejected(
    request(actor, { ...scope, sourceFileId: otherFileId }),
    "PNI01",
  );
  await rejected(result(accepted.jobId), "PNI01");
  assert.deepEqual(await status(accepted.jobId), {
    jobId: accepted.jobId,
    status: "queued",
    attemptCount: 0,
    failureCode: null,
    receipt: null,
  });

  const userFunctions = [
    "request_native_dwg_import(jsonb,uuid)",
    "native_dwg_import_status(jsonb,uuid)",
    "native_dwg_import_result(jsonb,uuid)",
  ];
  const serviceFunctions = [
    "claim_native_dwg_import(text,integer)",
    "complete_native_dwg_import(uuid,integer,uuid,text,text,text)",
    "fail_native_dwg_import(uuid,integer,uuid,text,boolean)",
  ];
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const fn of [...userFunctions, ...serviceFunctions]) {
      const [grant] =
        await owner`select has_function_privilege(${role},${`public.lukas_drawing_${fn}`},'EXECUTE') allowed`;
      assert.equal(
        grant.allowed,
        role ===
          (userFunctions.includes(fn) ? "authenticated" : "service_role"),
      );
    }
    for (const table of tables)
      for (const privilege of [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
      ]) {
        const [grant] =
          await owner`select has_table_privilege(${role},${`public.${table}`},${privilege}) allowed`;
        assert.equal(grant.allowed, false);
      }
  }
  const security =
    await owner`select relrowsecurity enabled,relforcerowsecurity forced from pg_class where relname=any(${tables}::text[])`;
  assert.equal(security.length, 3);
  for (const row of security)
    assert.deepEqual(row, { enabled: true, forced: true });
  const functions =
    await owner`select n.nspname,p.proname,p.prosecdef,p.proconfig,
    exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') public_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname like 'lukas_drawing_native_dwg_import_%')
      or (n.nspname='public' and p.proname=any(${[...userFunctions, ...serviceFunctions].map((fn) => `lukas_drawing_${fn.split("(")[0]}`)}::text[]))`;
  assert.equal(functions.length, 12);
  for (const fn of functions) {
    assert.equal(fn.public_execute, false);
    assert.ok(fn.proconfig.includes('search_path=""'));
    if (fn.nspname === "public") assert.equal(fn.prosecdef, true);
    else
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [grant] =
          await owner`select has_function_privilege(${role},p.oid,'EXECUTE') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=${fn.proname}`;
        assert.equal(grant.allowed, false);
      }
  }
  await rejected(
    session(
      owner,
      "service_role",
      null,
      (tx) =>
        tx`select public.lukas_drawing_claim_native_dwg_import(${image},300)`,
      { role: "authenticated" },
    ),
    "PNI01",
  );
  await rejected(
    owner.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims','{"role":"service_role"}',true)`;
      return tx`select public.lukas_drawing_claim_native_dwg_import(${image},300)`;
    }),
    "PNI01",
  );
  for (const [reader, seconds] of [
    ["latest", 300],
    [image, 179],
    [image, 901],
    [image, null],
  ])
    await rejected(claim(owner, reader, seconds), "PNI01");

  // Consumed verification may expire; its immutable identity remains valid.
  await owner`update public.lukas_qto_verified_uploads set created_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' where id=${verificationId}::uuid`;
  await owner.begin(async (tx) => {
    await tx`select id from public.lukas_qto_projects where id=${projectId}::uuid for update`;
    assert.equal(await claim(workerA), null);
  });
  await owner.begin(async (tx) => {
    await tx`select id from public.lukas_drawing_native_dwg_import_jobs where id=${accepted.jobId}::uuid for update`;
    assert.equal(await claim(workerB), null);
  });
  const pair = await Promise.all([claim(workerA), claim(workerB)]);
  assert.equal(pair.filter(Boolean).length, 1);
  const first = pair.find(Boolean);
  assert.equal(first.jobId, accepted.jobId);
  assert.equal(first.attemptNumber, 1);
  assert.equal(first.actorId, actor);
  assert.deepEqual(first.scope, scope);
  assert.deepEqual(first.source, {
    verificationId,
    fileId: scope.sourceFileId,
    bucket: "lukas-qto",
    path,
    sha256: sourceHash,
    byteSize: 8,
    headerVersion: "AC1032",
  });
  await rejected(complete(first, reportText, "0".repeat(64)), "PNI04");
  await rejected(complete(first, " ".repeat(33554433)), "PNI04");
  for (const invalid of [
    "[]",
    "{",
    JSON.stringify({ ...report, engine: { name: "ACadSharp", version: "0" } }),
    JSON.stringify({ ...report, source: { ...report.source, byteSize: 9 } }),
    JSON.stringify({
      ...report,
      source: { ...report.source, headerVersion: "AC1024" },
    }),
    JSON.stringify({
      ...report,
      source: { ...report.source, sha256: "e".repeat(64) },
    }),
    JSON.stringify({ ...report, qualification: "qualified" }),
    JSON.stringify({ ...report, coordinateSystem: "WCS_X_RIGHT_Y_UP" }),
  ])
    await rejected(complete(first, invalid), "PNI04");
  await rejected(
    complete(first, reportText, digest(reportText), otherImage),
    "PNI03",
  );
  await expire(first.jobId);
  await rejected(complete(first), "PNI03");
  assert.equal(await claim(owner, otherImage), null);
  const second = await claim();
  assert.equal(second.attemptNumber, 2);
  assert.notEqual(second.leaseToken, first.leaseToken);
  await rejected(fail(first), "PNI03");
  const receipt = await complete(second);
  assert.deepEqual(receipt, {
    jobId: accepted.jobId,
    attemptNumber: 2,
    readerImageId: image,
    reportSha256: digest(reportText),
    reportByteSize: Buffer.byteLength(reportText),
    source: {
      verificationId,
      fileId: scope.sourceFileId,
      sha256: sourceHash,
      byteSize: 8,
      headerVersion: "AC1032",
    },
    qualification: "experimental-unqualified",
    persistenceAuthority: "not-issued",
  });
  assert.deepEqual(await complete(second), receipt);
  await rejected(complete(second, `${reportText} `), "PNI03");
  await rejected(complete({ ...second, leaseToken: randomUUID() }), "PNI03");
  assert.deepEqual(await result(second.jobId), { receipt, reportText });
  await rejected(result(second.jobId, ids.users.owner), "PNI01");
  assert.deepEqual(await status(second.jobId), {
    jobId: second.jobId,
    status: "analyzed",
    attemptCount: 2,
    failureCode: null,
    receipt,
  });
  const rollback = new Error("Native analysis authority probe rollback");
  for (const boundary of ["entitlement", "archive", "deletion", "review"]) {
    await assert.rejects(
      owner.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims',${JSON.stringify({ role: "authenticated", sub: ids.users.owner, is_anonymous: false })},true)`;
        if (boundary === "entitlement") {
          await tx`insert into public.lukas_qto_organization_entitlement_versions(id,organization_id,version_no,plan,seat_limit,project_limit,library_version_limit,features,reason,request_id,request_sha256,created_by)
          values(${randomUUID()}::uuid,${ids.organization}::uuid,10000,'enterprise',100,100,1000,'{"drawing_workspace":false,"organization_library":true,"realtime_collaboration":true,"ifc_workspace":true,"quantity_lineage":true}'::jsonb,'Analysis entitlement revocation',${randomUUID()}::uuid,${"e".repeat(64)},${ids.users.owner}::uuid)`;
        } else if (boundary === "archive") {
          await tx`select public.lukas_qto_archive_project(${ids.organization}::uuid,${projectId}::uuid,'Analysis archive boundary',${randomUUID()}::uuid)`;
        } else if (boundary === "deletion") {
          await tx`select public.lukas_qto_request_project_deletion(${ids.organization}::uuid,${projectId}::uuid,'Analysis deletion boundary',${randomUUID()}::uuid)`;
        } else {
          await tx`select set_config('request.jwt.claims',${JSON.stringify({ role: "authenticated", sub: actor, is_anonymous: false })},true)`;
          await tx`select public.lukas_drawing_request_review(${scope.revisionId}::uuid)`;
        }
        await tx.unsafe("set local role authenticated");
        await tx`select set_config('request.jwt.claims',${JSON.stringify({ role: "authenticated", sub: actor, is_anonymous: false })},true)`;
        await rejected(
          tx.savepoint(
            (sp) =>
              sp`select public.lukas_drawing_request_native_dwg_import(${sp.json(scope)}::jsonb,${randomUUID()}::uuid)`,
          ),
          "PNI01",
        );
        await rejected(
          tx.savepoint(
            (sp) =>
              sp`select public.lukas_drawing_native_dwg_import_result(${sp.json(scope)}::jsonb,${second.jobId}::uuid)`,
          ),
          "PNI01",
        );
        throw rollback;
      }),
      (error) => error === rollback,
    );
  }

  // Owner diagnostics cannot mutate identities or erase retained evidence.
  for (const table of tables)
    await rejected(
      owner.unsafe(
        `delete from public.${table} where project_id='${projectId}'::uuid`,
      ),
      "42501",
    );
  await rejected(
    owner`update public.lukas_drawing_native_dwg_import_jobs set scope='{}'::jsonb where id=${first.jobId}::uuid`,
    "42501",
  );
  await rejected(
    owner`update public.lukas_drawing_native_dwg_import_attempts set reader_image_id=${otherImage} where job_id=${first.jobId}::uuid`,
    "42501",
  );
  await rejected(
    owner`update public.lukas_drawing_native_dwg_import_results set report_text='{}' where job_id=${first.jobId}::uuid`,
    "42501",
  );
  await rejected(
    owner`update public.lukas_drawing_native_dwg_import_attempts set outcome='failed' where job_id=${first.jobId}::uuid and attempt_number=2`,
    "42501",
  );
  await assert.rejects(
    owner`delete from public.lukas_drawing_documents where id=${scope.documentId}::uuid`,
  );
  await assert.rejects(
    owner`delete from public.lukas_qto_files where id=${scope.sourceFileId}::uuid`,
  );
  assert.deepEqual(await result(second.jobId), { receipt, reportText });

  const retry = await request();
  for (let attempt = 1; attempt <= 3; attempt++) {
    const current = await claim();
    assert.equal(current.attemptNumber, attempt);
    await rejected(fail(current, "raw exception secret"), "PNI01");
    const failed = await fail(current);
    assert.deepEqual(failed, {
      jobId: retry.jobId,
      status: attempt === 3 ? "failed" : "retry_wait",
    });
    if (attempt < 3) {
      const [delay] =
        await owner`select extract(epoch from (next_attempt_at-clock_timestamp()))::float8 seconds from public.lukas_drawing_native_dwg_import_jobs where id=${retry.jobId}::uuid`;
      assert.ok(
        delay.seconds > attempt * 30 - 5 && delay.seconds <= attempt * 30,
      );
      assert.equal(await claim(), null);
      await ready(retry.jobId);
    }
  }
  assert.equal(await claim(), null);

  const revoked = await request();
  const revokedClaim = await claim();
  await owner`update public.lukas_qto_project_members set role='viewer' where project_id=${projectId}::uuid and user_id=${actor}::uuid`;
  await rejected(complete(revokedClaim), "PNI03");
  await rejected(status(second.jobId), "PNI01");
  await rejected(result(second.jobId), "PNI01");
  await expire(revoked.jobId);
  assert.equal(await claim(), null);
  const [revokedState] =
    await owner`select status from public.lukas_drawing_native_dwg_import_jobs where id=${revoked.jobId}::uuid`;
  assert.equal(revokedState.status, "failed");
  await owner`update public.lukas_qto_project_members set role='estimator' where project_id=${projectId}::uuid and user_id=${actor}::uuid`;

  const frozen = await request();
  const frozenClaim = await claim();
  await owner`insert into private.lukas_drawing_collaboration_freeze_leases(revision_id,project_id,request_id,owner_token,subject_revision_version,lease_expires_at)
    values(${scope.revisionId}::uuid,${projectId}::uuid,${randomUUID()}::uuid,${randomUUID()}::uuid,1,clock_timestamp()+interval '5 minutes')`;
  await rejected(request(), "PNI01");
  await rejected(complete(frozenClaim), "PNI03");
  assert.deepEqual(await fail(frozenClaim), {
    jobId: frozen.jobId,
    status: "failed",
  });
  await owner`delete from private.lukas_drawing_collaboration_freeze_leases where revision_id=${scope.revisionId}::uuid`;

  const duplicateId = randomUUID();
  await owner`insert into public.lukas_qto_verified_uploads(id,actor_id,project_id,kind,storage_path,original_filename,content_type,byte_size,sha256,dwg_header_version,consumed_file_id,consumed_at)
    values(${duplicateId}::uuid,${actor}::uuid,${projectId}::uuid,'dwg',${`${path}.duplicate`},'duplicate.dwg','application/octet-stream',8,${sourceHash},'AC1032',${scope.sourceFileId}::uuid,clock_timestamp())`;
  await rejected(request(), "PNI01");
  await rejected(result(second.jobId), "PNI01");
  await owner`delete from public.lukas_qto_verified_uploads where id=${duplicateId}::uuid`;
  const missingSource = await request();
  const missingClaim = await claim();
  await owner`update public.lukas_qto_verified_uploads set dwg_header_version='AC1024' where id=${verificationId}::uuid`;
  await rejected(request(actor, scope, requestId), "PNI01");
  await rejected(complete(missingClaim), "PNI03");
  assert.deepEqual(await fail(missingClaim), {
    jobId: missingSource.jobId,
    status: "failed",
  });
  await owner`update public.lukas_qto_verified_uploads set dwg_header_version='AC1032' where id=${verificationId}::uuid`;
  const expired = await request();
  for (let i = 1; i <= 3; i++) {
    const c = await claim();
    assert.equal(c.attemptNumber, i);
    await expire(c.jobId);
  }
  assert.equal(await claim(), null);
  assert.equal((await status(expired.jobId)).status, "failed");
  const outcomes =
    await owner`select outcome from public.lukas_drawing_native_dwg_import_attempts where job_id=${expired.jobId}::uuid order by attempt_number`;
  assert.deepEqual(Array.from(outcomes), [
    { outcome: "expired" },
    { outcome: "expired" },
    { outcome: "expired" },
  ]);

  const active = [];
  for (let i = 0; i < 5; i++) active.push(await request());
  await rejected(request(), "PNI05");
  assert.deepEqual(await request(actor, scope, requestId), accepted);
  for (const job of active) {
    const c = await claim();
    assert.ok(active.some((item) => item.jobId === c.jobId));
    await fail(c, "worker_interrupted", false);
  }
  const [unchanged] =
    await owner`select (select count(*)::integer from public.lukas_drawing_objects where project_id=${projectId}::uuid) objects,(select count(*)::integer from public.lukas_drawing_object_sources where project_id=${projectId}::uuid) sources,(select count(*)::integer from public.lukas_drawing_revision_approvals where project_id=${projectId}::uuid) approvals`;
  assert.deepEqual(unchanged, { objects: 0, sources: 0, approvals: 0 });
  return projectId;
}
