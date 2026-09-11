import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createApprovedNativeDwgResaveRevision } from "./drawing-native-dwg-resave-jobs-database.mjs";

const imageId = "sha256:" + "c".repeat(64);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const session = (sql, role, actor, callback, jwtRole = role) =>
  sql.begin(async (tx) => {
    assert.ok(["authenticated", "service_role", "anon"].includes(role));
    await tx.unsafe(`set local role "${role}"`);
    await tx`select set_config('request.jwt.claims',${JSON.stringify({ role: jwtRole, sub: actor, is_anonymous: false })},true)`;
    await tx`select set_config('statement_timeout','10000',true)`;
    return callback(tx);
  });
const denied = (promise, code) =>
  assert.rejects(promise, (e) => {
    assert.equal(e.code, code, e.message);
    return true;
  });

const asRole = (tx, role, actor, fn) =>
  tx.savepoint(async (sp) => {
    const [before] =
      await sp`select current_user role,current_setting('request.jwt.claims',true) claims`;
    assert.ok(
      ["postgres", "authenticated", "service_role"].includes(before.role),
    );
    assert.ok(["authenticated", "service_role"].includes(role));
    await sp.unsafe(`set local role "${role}"`);
    await sp`select set_config('request.jwt.claims',${JSON.stringify({ role, sub: actor, is_anonymous: false })},true)`;
    const result = await fn(sp);
    await sp.unsafe(`set local role "${before.role}"`);
    await sp`select set_config('request.jwt.claims',${before.claims ?? ""},true)`;
    return result;
  });

// These are database authority proofs; literal output metadata is not native/Storage evidence.
// Removing the durable open-session fence or accepting changed metadata must fail these assertions.
export async function proveNativeDwgResavePublicationAuthority({
  owner,
  workerA,
  workerB,
  ids,
  imported,
}) {
  const { editedScope: scope } = await createApprovedNativeDwgResaveRevision({
    owner,
    ids,
    imported,
  });
  const actor = ids.users.editor;
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
    const { buildNativeDrawingDwgResaveAttestation: build } =
      await vite.ssrLoadModule(
        "/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts",
      );
    const core = await vite.ssrLoadModule(
      "/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts",
    );
    const [source] = await session(
      owner,
      "authenticated",
      actor,
      (tx) =>
        tx`select public.lukas_qto_drawing_native_dwg_resave_source(${tx.json(scope)}) value`,
    );
    const attestation = await build(scope, source.value, imageId);
    const metadata = [
      { kind: "dwg", sha256: hash("AC1024database-proof"), byteSize: 19 },
      {
        kind: "edit_request",
        sha256: attestation.request.sha256,
        byteSize: attestation.request.byteSize,
      },
      {
        kind: "authority",
        sha256: attestation.authority.sha256,
        byteSize: attestation.authority.byteSize,
      },
      { kind: "report", sha256: hash("database-proof"), byteSize: 14 },
    ];
    const service = (callback, sql = owner, jwtRole = "service_role") =>
      session(sql, "service_role", null, callback, jwtRole).then(
        ([r]) => r.value,
      );
    const admit = () =>
      service(
        (tx) =>
          tx`select public.lukas_drawing_admit_native_dwg_resave(${actor}::uuid,${tx.json(scope)},${randomUUID()}::uuid,${tx.json(attestation)}) value`,
      );
    const claim = (sql = owner) =>
      service(
        (tx) =>
          tx`select public.lukas_drawing_claim_native_dwg_resave(${imageId},300) value`,
        sql,
      );
    const stage = (c, m = metadata, sql = owner) =>
      service(
        (tx) =>
          tx`select public.lukas_drawing_stage_native_dwg_resave(${c.jobId}::uuid,${c.attemptNumber},${c.leaseToken}::uuid,${tx.json(m)}) value`,
        sql,
      );
    const close = (c) =>
      service(
        (tx) =>
          tx`select public.lukas_drawing_close_native_dwg_resave_upload(${c.jobId}::uuid,${c.attemptNumber},${c.leaseToken}::uuid) value`,
      );
    const publish = (c, sql = owner) =>
      service(
        (tx) =>
          tx`select public.lukas_drawing_publish_native_dwg_resave(${c.jobId}::uuid,${c.attemptNumber},${c.leaseToken}::uuid) value`,
        sql,
      );
    const job = await admit();
    const c = await claim();
    assert.equal(c.jobId, job.jobId);
    const staged = await stage(c);
    assert.equal(staged.uploadState, "open");
    assert.deepEqual(await stage(c), staged);
    await denied(
      stage(
        c,
        metadata.map((m, i) =>
          i === 0 ? { ...m, sha256: "a".repeat(64) } : m,
        ),
      ),
      "PNR12",
    );
    await denied(publish(c), "PNR13");
    assert.deepEqual(await close(c), {
      jobId: c.jobId,
      attemptNumber: 1,
      leaseToken: c.leaseToken,
      uploadState: "closed",
    });
    assert.equal((await stage(c)).uploadState, "closed");
    const receipt = await publish(c);
    assert.equal(receipt.schemaVersion, "1hk-dwg-resave-receipt/1");
    assert.equal(receipt.attemptNumber, 1);
    assert.deepEqual(receipt.scope, scope);
    assert.deepEqual(receipt.artifacts, metadata);
    assert.deepEqual(
      core.validateNativeDrawingDwgResaveReceipt(receipt, c, metadata),
      receipt,
    );
    assert.deepEqual(await publish(c), receipt);

    const readReceipt = (id = c.jobId, who = ids.users.viewer, s = scope) =>
      session(
        owner,
        "authenticated",
        who,
        (tx) =>
          tx`select public.lukas_drawing_native_dwg_resave_receipt(${tx.json(s)},${id}::uuid) value`,
      ).then(([r]) => r.value);
    const descriptor = (id, kind, who = ids.users.viewer, s = scope) =>
      session(
        owner,
        "authenticated",
        who,
        (tx) =>
          tx`select public.lukas_drawing_native_dwg_resave_download_descriptor(${tx.json(s)},${id}::uuid,${kind}) value`,
      ).then(([r]) => r.value);
    const status = (id = null, who = actor, s = scope) =>
      session(
        owner,
        "authenticated",
        who,
        (tx) =>
          tx`select public.lukas_drawing_native_dwg_resave_status(${tx.json(s)},${id}::uuid) value`,
      ).then(([r]) => r.value);
    const cancel = (c, sql = owner) =>
      session(
        sql,
        "authenticated",
        actor,
        (tx) =>
          tx`select public.lukas_drawing_cancel_native_dwg_resave(${tx.json(scope)},${c.jobId}::uuid) value`,
      ).then(([r]) => r.value);
    const ack = (c) =>
      service(
        (tx) =>
          tx`select public.lukas_drawing_ack_native_dwg_resave_cancel(${c.jobId}::uuid,${c.attemptNumber},${c.leaseToken}::uuid) value`,
      );
    const fail = (c, code = "upload_failed", retryable = true) =>
      service(
        (tx) =>
          tx`select public.lukas_drawing_fail_native_dwg_resave(${c.jobId}::uuid,${c.attemptNumber},${c.leaseToken}::uuid,${code},${retryable}) value`,
      );
    const expire = (c) =>
      owner`update public.lukas_drawing_native_dwg_resave_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${c.jobId}::uuid`;
    const start = async () => {
      const j = await admit();
      const claimValue = await claim();
      assert.equal(claimValue.jobId, j.jobId);
      return claimValue;
    };
    const original =
      await owner`select source from public.lukas_drawing_native_dwg_import_jobs where id=${imported.jobId}::uuid`;
    const snapshots =
      await owner`select * from public.lukas_drawing_snapshots where revision_id=${scope.revisionId}::uuid`;
    assert.deepEqual(await readReceipt(), receipt);
    assert.equal((await status()).status, "completed");
    await denied(status(randomUUID()), "PNR11");
    const emptyScope = (
      await createApprovedNativeDwgResaveRevision({ owner, ids, imported })
    ).editedScope;
    assert.equal(await status(null, actor, emptyScope), null);
    await denied(status(null, ids.users.outsider, emptyScope), "PNR11");
    for (const [i, kind] of [
      "dwg",
      "edit_request",
      "authority",
      "report",
    ].entries()) {
      const d = await descriptor(c.jobId, kind);
      assert.deepEqual(d, {
        jobId: c.jobId,
        attemptNumber: 1,
        kind,
        bucket: "lukas-qto",
        path: staged.artifacts[i].path,
        sha256: metadata[i].sha256,
        byteSize: metadata[i].byteSize,
      });
    }
    await denied(readReceipt(c.jobId, ids.users.outsider), "PNR11");
    await denied(
      readReceipt(c.jobId, actor, {
        ...scope,
        revisionVersion: scope.revisionVersion + 1,
      }),
      "PNR11",
    );
    await denied(descriptor(c.jobId, "source_manifest"), "PNR11");
    await denied(publish({ ...c, leaseToken: randomUUID() }), "PNR13");
    // Committed receipts remain exact even when the original lease has elapsed.
    const rollback = Symbol("rolled back publication corruption");
    const probe = async (fn) => {
      try {
        await owner.begin(async (tx) => {
          await fn(tx);
          throw rollback;
        });
      } catch (e) {
        if (e !== rollback) throw e;
      }
    };
    const asService = (tx, fn) => asRole(tx, "service_role", null, fn);
    await probe(async (tx) => {
      await tx`set local session_replication_role=replica`;
      await tx`update public.lukas_drawing_native_dwg_resave_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${c.jobId}::uuid`;
      await tx`update public.lukas_drawing_native_dwg_resave_attempts set lease_expires_at=clock_timestamp()-interval '1 second' where job_id=${c.jobId}::uuid`;
      await tx`set local session_replication_role=origin`;
      const [r] = await asService(
        tx,
        (sp) =>
          sp`select public.lukas_drawing_publish_native_dwg_resave(${c.jobId}::uuid,1,${c.leaseToken}::uuid) value`,
      );
      assert.deepEqual(r.value, receipt);
    });

    const open = await start();
    await denied(close(open), "PNR13");
    for (const invalid of [
      null,
      {},
      metadata.slice(1),
      [metadata[1], metadata[0], metadata[2], metadata[3]],
      metadata.map((m, i) => (i === 1 ? { ...m, sha256: "0".repeat(64) } : m)),
      metadata.map((m, i) =>
        i === 2 ? { ...m, byteSize: m.byteSize + 1 } : m,
      ),
      metadata.map((m, i) => (i === 0 ? { ...m, path: "private" } : m)),
      metadata.map((m, i) => (i === 0 ? { ...m, byteSize: 209715201 } : m)),
      metadata.map((m, i) => (i === 0 ? { ...m, byteSize: 5 } : m)),
      metadata.map((m, i) => (i === 3 ? { ...m, byteSize: 1.5 } : m)),
      ...[209715201, 2097153, 67108865, 1048577].map((limit, index) =>
        metadata.map((m, i) => (i === index ? { ...m, byteSize: limit } : m)),
      ),
    ])
      await denied(stage(open, invalid), "PNR11");
    await stage(open);
    await denied(fail(open), "PNR13");
    await denied(ack(open), "PNR13");
    await denied(
      owner`update public.lukas_drawing_native_dwg_resave_jobs set status='failed' where id=${open.jobId}::uuid`,
      "PNR13",
    );
    await denied(
      owner`update public.lukas_drawing_native_dwg_resave_attempts set outcome='failed',finished_at=clock_timestamp() where job_id=${open.jobId}::uuid`,
      "PNR13",
    );
    await expire(open);
    assert.equal(await claim(workerA), null);
    assert.equal((await status(open.jobId)).status, "processing");
    await cancel(open);
    assert.equal(
      await claim(workerB),
      null,
      "expired cancellation with open upload is unchanged",
    );
    assert.equal((await status(open.jobId)).status, "cancel_requested");
    await denied(ack(open), "PNR13");
    await close(open);
    assert.equal((await ack(open)).status, "cancelled");
    assert.deepEqual(await close(open), {
      jobId: open.jobId,
      attemptNumber: 1,
      leaseToken: open.leaseToken,
      uploadState: "closed",
    });
    await denied(publish(open), "PNR13");
    await denied(readReceipt(open.jobId), "PNR11");
    await denied(
      owner`update public.lukas_drawing_native_dwg_resave_attempts set upload_state='open',upload_closed_at=null where job_id=${open.jobId}::uuid`,
      "PNR11",
    );

    const retry = await start();
    await stage(retry);
    await close(retry);
    assert.equal((await fail(retry)).status, "retry_wait");
    await owner`update public.lukas_drawing_native_dwg_resave_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id=${retry.jobId}::uuid`;
    const retry2 = await claim();
    assert.equal(retry2.jobId, retry.jobId);
    assert.equal(retry2.attemptNumber, 2);
    await probe(async (tx) => {
      await tx`set local session_replication_role=replica`;
      await tx`update public.lukas_drawing_native_dwg_resave_attempts set upload_state='open',upload_closed_at=null,outcome=null,finished_at=null where job_id=${retry.jobId}::uuid and attempt_number=1`;
      await tx`set local session_replication_role=origin`;
      await denied(
        asService(
          tx,
          (sp) =>
            sp`select public.lukas_drawing_fail_native_dwg_resave(${retry2.jobId}::uuid,2,${retry2.leaseToken}::uuid,'upload_failed',true)`,
        ),
        "PNR13",
      );
      await tx`update public.lukas_drawing_native_dwg_resave_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${retry2.jobId}::uuid`;
      const [unchanged] = await asService(
        tx,
        (sp) =>
          sp`select public.lukas_drawing_claim_native_dwg_resave(${imageId},300) value`,
      );
      assert.equal(
        unchanged.value,
        null,
        "a historical open attempt fences reclamation of the current attempt",
      );
      await asRole(
        tx,
        "authenticated",
        actor,
        (sp) =>
          sp`select public.lukas_drawing_cancel_native_dwg_resave(${sp.json(scope)},${retry2.jobId}::uuid)`,
      );
      await denied(
        asService(
          tx,
          (sp) =>
            sp`select public.lukas_drawing_ack_native_dwg_resave_cancel(${retry2.jobId}::uuid,2,${retry2.leaseToken}::uuid)`,
        ),
        "PNR13",
      );
    });
    await close(retry); // Historical exact-token close never targets the replacement.
    await denied(stage(retry), "PNR13");
    const secondMetadata = metadata.map((m, i) =>
      i === 0 ? { ...m, sha256: hash("AC1024second-output") } : m,
    );
    await stage(retry2, secondMetadata);
    await close(retry2);
    const receipt2 = await publish(retry2);
    assert.equal(receipt2.attemptNumber, 2);
    assert.deepEqual(receipt2.artifacts, secondMetadata);
    assert.deepEqual(await readReceipt(retry.jobId), receipt2);
    assert.equal((await descriptor(retry.jobId, "dwg")).attemptNumber, 2);
    await denied(publish(retry), "PNR13");
    assert.deepEqual(await publish(retry2), receipt2);

    // Independent client project-lock barriers explicitly choose each winner.
    const [[ownerPid], [aPid], [bPid]] = await Promise.all([
      owner`select pg_backend_pid() pid`,
      workerA`select pg_backend_pid() pid`,
      workerB`select pg_backend_pid() pid`,
    ]);
    const blockedBy = async (tx, waiter, blocker) => {
      const deadline = Date.now() + 5000;
      let blocked = false;
      do {
        const [r] =
          await tx`select ${blocker}::integer=any(pg_blocking_pids(${waiter}::integer)) blocked`;
        blocked = r.blocked;
      } while (!blocked && Date.now() < deadline);
      assert.equal(
        blocked,
        true,
        "independent client reached explicit project lock barrier",
      );
    };
    const settle = (p) =>
      p.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    for (const cancelFirst of [true, false]) {
      const race = await start();
      await stage(race);
      await close(race);
      let first, second;
      await owner.begin(async (tx) => {
        await tx`select id from public.lukas_qto_projects where id=${scope.projectId}::uuid for update`;
        first = settle(
          cancelFirst ? cancel(race, workerA) : publish(race, workerA),
        );
        await blockedBy(tx, aPid.pid, ownerPid.pid);
        second = settle(
          cancelFirst ? publish(race, workerB) : cancel(race, workerB),
        );
        await blockedBy(tx, bPid.pid, aPid.pid);
      });
      const [one, two] = await Promise.all([first, second]);
      assert.equal(one.error, undefined);
      if (cancelFirst) {
        assert.equal(two.error?.code, "PNR13");
        await ack(race);
      } else {
        assert.equal(two.value.status, "completed");
        assert.deepEqual(await readReceipt(race.jobId), one.value);
      }
    }

    const revoked = await start();
    await stage(revoked);
    await owner`delete from public.lukas_qto_project_members where project_id=${scope.projectId}::uuid and user_id=${actor}::uuid`;
    await denied(stage(revoked), "PNR11");
    await denied(readReceipt(c.jobId, actor), "PNR11");
    await denied(descriptor(c.jobId, "dwg", actor), "PNR11");
    await close(revoked);
    await denied(publish(revoked), "PNR11");
    assert.equal((await fail(revoked)).status, "failed");
    await owner`insert into public.lukas_qto_project_members(project_id,user_id,role) values(${scope.projectId}::uuid,${actor}::uuid,'estimator')`;
    const tamper = await start();
    await stage(tamper);
    await close(tamper);
    for (const mutate of [
      (tx) =>
        tx`update public.lukas_drawing_native_dwg_import_jobs set source=jsonb_set(source,'{path}','"changed/private.dwg"') where id=${imported.jobId}::uuid`,
      (tx) =>
        tx`update public.lukas_drawing_snapshots set canonical_json=jsonb_set(canonical_json,'{operationSequence}','99999') where revision_id=${scope.revisionId}::uuid`,
    ])
      await probe(async (tx) => {
        await tx`set local session_replication_role=replica`;
        await mutate(tx);
        await tx`set local session_replication_role=origin`;
        await denied(
          asService(
            tx,
            (sp) =>
              sp`select public.lukas_drawing_publish_native_dwg_resave(${tamper.jobId}::uuid,1,${tamper.leaseToken}::uuid)`,
          ),
          "PNR11",
        );
      });
    assert.equal(
      (await fail(tamper, "publication_failed", false)).status,
      "failed",
    );

    for (const suffix of ["artifacts", "exports"]) {
      const table = "public.lukas_drawing_native_dwg_resave_" + suffix;
      const [rls] =
        await owner`select relrowsecurity,relforcerowsecurity from pg_class where oid=${table}::regclass`;
      assert.deepEqual(rls, {
        relrowsecurity: true,
        relforcerowsecurity: true,
      });
      for (const role of [
        "anon",
        "authenticated",
        "service_role",
        "lukas_drawing_collaboration",
      ]) {
        const [g] =
          await owner`select has_table_privilege(${role},${table},'SELECT,INSERT,UPDATE,DELETE') allowed`;
        assert.equal(g.allowed, false);
      }
      await denied(
        owner.unsafe("delete from " + table + " where job_id=$1::uuid", [
          c.jobId,
        ]),
        "PNR11",
      );
      await denied(
        owner.unsafe(
          "update " + table + " set attempt_number=2 where job_id=$1::uuid",
          [c.jobId],
        ),
        "PNR11",
      );
    }
    for (const [signature, expected] of [
      [
        "public.lukas_drawing_stage_native_dwg_resave(uuid,integer,uuid,jsonb)",
        true,
      ],
      [
        "public.lukas_drawing_close_native_dwg_resave_upload(uuid,integer,uuid)",
        true,
      ],
      [
        "public.lukas_drawing_publish_native_dwg_resave(uuid,integer,uuid)",
        true,
      ],
      ["public.lukas_drawing_native_dwg_resave_receipt(jsonb,uuid)", false],
      [
        "public.lukas_drawing_native_dwg_resave_download_descriptor(jsonb,uuid,text)",
        false,
      ],
    ])
      for (const role of [
        "anon",
        "authenticated",
        "service_role",
        "lukas_drawing_collaboration",
      ]) {
        const [g] =
          await owner`select has_function_privilege(${role},${signature},'EXECUTE') allowed`;
        assert.equal(
          g.allowed,
          expected ? role === "service_role" : role === "authenticated",
        );
      }
    await denied(
      service(
        (tx) =>
          tx`select public.lukas_drawing_publish_native_dwg_resave(${c.jobId}::uuid,1,${c.leaseToken}::uuid) value`,
        owner,
        "authenticated",
      ),
      "PNR11",
    );
    assert.deepEqual(
      await owner`select source from public.lukas_drawing_native_dwg_import_jobs where id=${imported.jobId}::uuid`,
      original,
    );
    assert.deepEqual(
      await owner`select * from public.lukas_drawing_snapshots where revision_id=${scope.revisionId}::uuid`,
      snapshots,
    );
    const [deps] =
      await owner`select private.lukas_qto_project_retention_dependencies(${scope.projectId}::uuid) value`;
    const allArtifacts =
      await owner`select path,sha256,byte_size from public.lukas_drawing_native_dwg_resave_artifacts where project_id=${scope.projectId}::uuid order by path`;
    const manifest =
      await owner`select * from private.lukas_qto_project_retention_storage_files(${scope.projectId}::uuid) where path like ${`projects/${scope.projectId}/native-dwg-resave/%`} order by path`;
    assert.deepEqual(
      manifest,
      allArtifacts,
      "retention includes every staged attempt, including failed and cancelled uploads",
    );
    assert.equal(
      Number(deps.value.nativeDwgResaveArtifacts),
      allArtifacts.length,
    );

    const storageId = randomUUID(),
      ordinaryId = randomUUID();
    const ordinaryPath = `projects/${scope.projectId}/ordinary/${ordinaryId}`;
    await owner`insert into storage.objects(id,bucket_id,name) values(${storageId}::uuid,'lukas-qto',${staged.artifacts[0].path})`;
    await session(
      owner,
      "authenticated",
      ids.users.owner,
      (tx) =>
        tx`insert into storage.objects(id,bucket_id,name) values(${ordinaryId}::uuid,'lukas-qto',${ordinaryPath})`,
    );
    for (const role of ["authenticated", "anon"]) {
      const hidden = await session(
        owner,
        role,
        ids.users.owner,
        (tx) => tx`select id from storage.objects where id=${storageId}::uuid`,
      );
      assert.equal(hidden.length, 0);
      await denied(
        session(
          owner,
          role,
          ids.users.owner,
          (tx) =>
            tx`insert into storage.objects(id,bucket_id,name) values(${randomUUID()}::uuid,'lukas-qto',${staged.artifacts[1].path})`,
        ),
        "42501",
      );
      const deleted = await session(
        owner,
        role,
        ids.users.owner,
        (tx) =>
          tx`delete from storage.objects where id=${storageId}::uuid returning id`,
      );
      assert.equal(deleted.length, 0);
    }
    await probe(async (tx) => {
      await tx.unsafe(
        'create policy "publication fixture permits update" on storage.objects for update to authenticated using (true) with check (true)',
      );
      const asOwner = (fn) => asRole(tx, "authenticated", ids.users.owner, fn);
      assert.equal(
        (
          await asOwner(
            (sp) =>
              sp`update storage.objects set name=${ordinaryPath + "-renamed"} where id=${ordinaryId}::uuid returning id`,
          )
        ).length,
        1,
      );
      await denied(
        asOwner(
          (sp) =>
            sp`update storage.objects set name=${staged.artifacts[2].path} where id=${ordinaryId}::uuid`,
        ),
        "42501",
      );
      assert.equal(
        (
          await asOwner(
            (sp) =>
              sp`update storage.objects set name=${ordinaryPath + "-escaped"} where id=${storageId}::uuid returning id`,
          )
        ).length,
        0,
      );
    });
    await owner`delete from storage.objects where id in (${storageId}::uuid,${ordinaryId}::uuid)`;

    const retained = await start();
    await stage(retained);
    // Retention probes remove earlier, unrelated protection only in a rolled-back
    // corruption transaction, so the open-upload predicate itself must deny deletion.
    await probe(async (tx) => {
      await tx`set local session_replication_role=replica`;
      await tx`update public.lukas_drawing_revisions set status='draft',review_requested_at=null,approved_at=null where project_id=${scope.projectId}::uuid`;
      await tx`delete from public.lukas_drawing_revision_approvals where project_id=${scope.projectId}::uuid`;
      await tx`delete from public.lukas_drawing_issue_approvals where project_id=${scope.projectId}::uuid`;
      await tx`update public.lukas_qto_boq_versions set status='draft' where project_id=${scope.projectId}::uuid`;
      for (const table of [
        "lukas_drawing_quantity_links",
        "lukas_drawing_boq_links",
        "lukas_drawing_material_links",
        "lukas_qto_material_transactions",
        "lukas_drawing_library_imports",
      ])
        await tx.unsafe(
          "delete from public." + table + " where project_id=$1::uuid",
          [scope.projectId],
        );
      await tx`delete from public.lukas_drawing_library_versions where source_project_id=${scope.projectId}::uuid`;
      await tx`set local session_replication_role=origin`;
      const asOwner = (fn) => asRole(tx, "authenticated", ids.users.owner, fn);
      const [deletion] = await asOwner(
        (sp) =>
          sp`select (public.lukas_qto_request_project_deletion(${ids.organization}::uuid,${scope.projectId}::uuid,'Publication retention proof',${randomUUID()}::uuid)).id id`,
      );
      await tx`set local session_replication_role=replica`;
      await tx`update public.lukas_qto_retention_events set purge_after=now()-interval '1 second' where id=${deletion.id}::uuid`;
      await tx`set local session_replication_role=origin`;
      const purge = () =>
        asService(
          tx,
          (sp) =>
            sp`select public.lukas_qto_purge_project(${ids.organization}::uuid,${scope.projectId}::uuid,${randomUUID()}::uuid,'Publication retention proof') value`,
        ).then(([r]) => r.value);
      let held = await purge();
      assert.equal(held.reason, "active_native_dwg_jobs");
      assert.equal(Number(held.dependencies.nativeDwgResaveOpenUploads), 1);
      // Deliberately emulate historical corruption to prove the independent open
      // attempt blocker remains even when no job status counts as active.
      await tx`set local session_replication_role=replica`;
      await tx`update public.lukas_drawing_native_dwg_resave_jobs set status='failed' where id=${retained.jobId}::uuid`;
      await tx`set local session_replication_role=origin`;
      held = await purge();
      assert.equal(held.reason, "native_dwg_uploads_open");
      await denied(
        asService(
          tx,
          (sp) =>
            sp`select public.lukas_qto_finalize_project_purge(${ids.organization}::uuid,${scope.projectId}::uuid,${randomUUID()}::uuid,${"a".repeat(64)},${randomUUID()}::uuid,'Publication open finalization proof')`,
        ),
        "P7R08",
      );
      await asService(
        tx,
        (sp) =>
          sp`select public.lukas_drawing_close_native_dwg_resave_upload(${retained.jobId}::uuid,1,${retained.leaseToken}::uuid)`,
      );
      const ready = await purge();
      assert.equal(ready.status, "STORAGE_REQUIRED");
      assert.ok(
        ready.files.some((f) => f.path.includes("/native-dwg-resave/")),
      );
      await tx`set local session_replication_role=replica`;
      await tx`update public.lukas_drawing_native_dwg_resave_jobs set status='processing' where id=${retained.jobId}::uuid`;
      await tx`set local session_replication_role=origin`;
      await denied(
        asService(
          tx,
          (sp) =>
            sp`select public.lukas_qto_finalize_project_purge(${ids.organization}::uuid,${scope.projectId}::uuid,${ready.eventId}::uuid,${ready.manifestSha256},${randomUUID()}::uuid,'Publication active finalization proof')`,
        ),
        "P7R08",
      );
      await tx`set local session_replication_role=replica`;
      await tx`update public.lukas_drawing_native_dwg_resave_jobs set status='failed' where id=${retained.jobId}::uuid`;
      await tx`set local session_replication_role=origin`;
      const orphanPath = `projects/${scope.projectId}/native-dwg-resave/unregistered/leftover.dwg`;
      await tx`insert into storage.objects(id,bucket_id,name) values(${randomUUID()}::uuid,'lukas-qto',${orphanPath})`;
      await denied(
        asService(
          tx,
          (sp) =>
            sp`select public.lukas_qto_finalize_project_purge(${ids.organization}::uuid,${scope.projectId}::uuid,${ready.eventId}::uuid,${ready.manifestSha256},${randomUUID()}::uuid,'Publication whole prefix proof')`,
        ),
        "P7R09",
      );
      await tx`delete from storage.objects where name=${orphanPath}`;
      const [purged] = await asService(
        tx,
        (sp) =>
          sp`select public.lukas_qto_finalize_project_purge(${ids.organization}::uuid,${scope.projectId}::uuid,${ready.eventId}::uuid,${ready.manifestSha256},${randomUUID()}::uuid,'Publication exact finalization proof') value`,
      );
      assert.equal(purged.value.status, "PURGED");
      for (const table of ["jobs", "attempts", "artifacts", "exports"]) {
        const [residue] = await tx.unsafe(
          "select count(*)::integer n from public.lukas_drawing_native_dwg_resave_" +
            table +
            " where project_id=$1::uuid",
          [scope.projectId],
        );
        assert.equal(residue.n, 0);
      }
    });
    await close(retained);
    await fail(retained, "publication_failed", false);
    assert.deepEqual(
      await owner`select source from public.lukas_drawing_native_dwg_import_jobs where id=${imported.jobId}::uuid`,
      original,
    );
    assert.deepEqual(
      await owner`select * from public.lukas_drawing_snapshots where revision_id=${scope.revisionId}::uuid`,
      snapshots,
    );
    console.log(
      "Resave publication database: real compiler identities, stage/retry/receipt identity, open fences, historical close, cancel/publish lock barriers, revocation/tamper, grants/immutability and complete staged retention manifest passed",
    );
  } finally {
    await vite.close();
  }
}
