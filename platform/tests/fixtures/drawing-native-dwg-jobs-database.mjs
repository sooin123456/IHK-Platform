import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { proveNativeDwgSourceAuthority } from "./drawing-native-dwg-source-database.mjs";

const USER_FUNCTIONS = Object.freeze([
  "public.lukas_drawing_request_native_dwg_export(jsonb,uuid)",
  "public.lukas_drawing_native_dwg_export_status(jsonb,uuid)",
  "public.lukas_drawing_native_dwg_download_descriptor(jsonb,uuid,text)",
]);
const SERVICE_FUNCTIONS = Object.freeze([
  "public.lukas_drawing_claim_native_dwg_export(text,integer)",
  "public.lukas_drawing_stage_native_dwg_export(uuid,integer,uuid,text,jsonb)",
  "public.lukas_drawing_settle_native_dwg_upload(uuid,integer,uuid)",
  "public.lukas_drawing_publish_native_dwg_export(uuid,integer,uuid)",
  "public.lukas_drawing_fail_native_dwg_export(uuid,integer,uuid,text,boolean)",
]);
const TABLES = Object.freeze([
  "lukas_drawing_native_dwg_jobs",
  "lukas_drawing_native_dwg_attempts",
  "lukas_drawing_native_dwg_artifacts",
  "lukas_drawing_native_dwg_exports",
]);

async function asRole(tx, role, actorId, callback, options = {}) {
  return tx.savepoint(async (sp) => {
    await sp.unsafe(`set local role "${role}"`);
    await sp`select pg_catalog.set_config(
      'request.jwt.claims',${JSON.stringify({
        role,
        sub: actorId ?? undefined,
        is_anonymous: options.anonymous ?? false,
        app_metadata: options.appMetadata ?? {},
      })},true
    )`;
    const result = await callback(sp);
    await sp.unsafe("reset role");
    await sp`select pg_catalog.set_config('request.jwt.claims','{}',true)`;
    return result;
  });
}

const asActor = (tx, actorId, callback, options) =>
  asRole(tx, "authenticated", actorId, callback, options);
const asService = (tx, callback) => asRole(tx, "service_role", null, callback);

async function assertDatabaseError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    assert.doesNotMatch(
      error.message,
      /canonical_json|select |storage_path|projects\/[0-9a-f-]+\//i,
    );
    return true;
  });
}

const requestJob = (tx, actorId, request, requestId, options) =>
  asActor(tx, actorId, (sp) => sp`
    select public.lukas_drawing_request_native_dwg_export(
      ${sp.json(request)}::jsonb,${requestId}::uuid
    ) value
  `, options);
const jobStatus = (tx, actorId, request, jobId = null, options) =>
  asActor(tx, actorId, (sp) => sp`
    select public.lukas_drawing_native_dwg_export_status(
      ${sp.json(request)}::jsonb,${jobId}::uuid
    ) value
  `, options);
const descriptor = (tx, actorId, request, jobId, kind) =>
  asActor(tx, actorId, (sp) => sp`
    select public.lukas_drawing_native_dwg_download_descriptor(
      ${sp.json(request)}::jsonb,${jobId}::uuid,${kind}
    ) value
  `);
const claim = (tx, build, leaseSeconds = 900) =>
  asService(tx, (sp) => sp`
    select public.lukas_drawing_claim_native_dwg_export(
      ${build},${leaseSeconds}
    ) value
  `);
const stage = (tx, claimValue, structureSha256, artifacts) =>
  asService(tx, (sp) => sp`
    select public.lukas_drawing_stage_native_dwg_export(
      ${claimValue.jobId}::uuid,${claimValue.attempt}::integer,
      ${claimValue.leaseToken}::uuid,${structureSha256},
      ${sp.json(artifacts)}::jsonb
    ) value
  `);
const settle = (tx, claimValue) =>
  asService(tx, (sp) => sp`
    select public.lukas_drawing_settle_native_dwg_upload(
      ${claimValue.jobId}::uuid,${claimValue.attempt}::integer,
      ${claimValue.leaseToken}::uuid
    ) value
  `);
const publish = (tx, claimValue) =>
  asService(tx, (sp) => sp`
    select public.lukas_drawing_publish_native_dwg_export(
      ${claimValue.jobId}::uuid,${claimValue.attempt}::integer,
      ${claimValue.leaseToken}::uuid
    ) value
  `);
const fail = (tx, claimValue, errorCode, retryable) =>
  asService(tx, (sp) => sp`
    select public.lukas_drawing_fail_native_dwg_export(
      ${claimValue.jobId}::uuid,${claimValue.attempt}::integer,
      ${claimValue.leaseToken}::uuid,${errorCode},${retryable}
    ) value
  `);

export async function proveNativeDwgExportJobAuthority({ owner, ids }) {
  await proveNativeDwgSourceAuthority({
    owner,
    ids,
    onApprovedSource: async ({
      request,
      payload,
      tx,
      createApprovedNativeScope,
    }) => {
      const editorRequestId = randomUUID();
      const [accepted] = await requestJob(
        tx, ids.users.editor, request, editorRequestId,
      );
      assert.equal(accepted.value.accepted, true);
      assert.equal(accepted.value.requestId, editorRequestId);
      assert.match(accepted.value.jobId, /^[0-9a-f-]{36}$/);
      const [replayed] = await requestJob(
        tx, ids.users.editor, request, editorRequestId,
      );
      assert.deepEqual(replayed.value, accepted.value);
      const [canonicalUuidReplay] = await requestJob(
        tx,
        ids.users.editor,
        {
          ...request,
          projectId: request.projectId.toUpperCase(),
          documentId: request.documentId.toUpperCase(),
          revisionId: request.revisionId.toUpperCase(),
          canvasId: request.canvasId.toUpperCase(),
        },
        editorRequestId,
      );
      assert.deepEqual(canonicalUuidReplay.value, accepted.value);
      const secondApproved = await createApprovedNativeScope("office-layout");
      await assertDatabaseError(
        requestJob(
          tx,
          ids.users.editor,
          secondApproved.scope,
          editorRequestId,
        ),
        "PNJ02",
      );

      for (const invalidScope of [
        null,
        { ...request, extra: true },
        { ...request, projectId: null },
        { ...request, revisionVersion: 0 },
        { ...request, revisionVersion: 1.5 },
        { ...request, revisionVersion: 9007199254740992 },
        { ...request, snapshotSha256: "A".repeat(64) },
      ])
        await assertDatabaseError(
          requestJob(tx, ids.users.editor, invalidScope, randomUUID()),
          "PNJ01",
        );
      await assertDatabaseError(
        requestJob(tx, ids.users.editor, request, null),
        "PNJ01",
      );
      for (const mismatch of [
        { projectId: ids.foreignProject },
        { documentId: randomUUID() },
        { revisionId: randomUUID() },
        { revisionVersion: request.revisionVersion + 1 },
        { canvasId: randomUUID() },
        { snapshotSha256: "f".repeat(64) },
      ])
        await assertDatabaseError(
          requestJob(
            tx, ids.users.editor, { ...request, ...mismatch }, randomUUID(),
          ),
          "PNJ01",
        );
      await assertDatabaseError(
        requestJob(tx, ids.users.anonymous, request, randomUUID(), {
          anonymous: true,
        }),
        "PNJ01",
      );
      await assertDatabaseError(
        asRole(tx, "anon", null, (sp) => sp`
          select public.lukas_drawing_request_native_dwg_export(
            ${sp.json(request)}::jsonb,${randomUUID()}::uuid
          )
        `),
        "42501",
      );

      for (const table of TABLES) {
        for (const role of ["anon", "authenticated", "service_role"]) {
          const [privilege] = await tx`
            select pg_catalog.has_table_privilege(
              ${role},${`public.${table}`},'SELECT,INSERT,UPDATE,DELETE'
            ) allowed
          `;
          assert.equal(privilege.allowed, false, `${role} ${table}`);
        }
        const [rls] = await tx`
          select c.relrowsecurity enabled,c.relforcerowsecurity forced
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relname=${table}
        `;
        assert.deepEqual(rls, { enabled: true, forced: true });
      }
      for (const signature of USER_FUNCTIONS)
        for (const role of ["anon", "authenticated", "service_role"]) {
          const [privilege] = await tx`
            select pg_catalog.has_function_privilege(
              ${role},${signature},'EXECUTE'
            ) allowed
          `;
          assert.equal(privilege.allowed, role === "authenticated");
        }
      for (const signature of SERVICE_FUNCTIONS)
        for (const role of ["anon", "authenticated", "service_role"]) {
          const [privilege] = await tx`
            select pg_catalog.has_function_privilege(
              ${role},${signature},'EXECUTE'
            ) allowed
          `;
          assert.equal(privilege.allowed, role === "service_role");
        }

      const writerBuild = "1".repeat(64);
      const otherBuild = "2".repeat(64);
      const structureSha256 = "3".repeat(64);
      const artifactMetadata = [
        { kind: "dwg", sha256: "4".repeat(64), byteSize: 1024 },
        { kind: "source_manifest", sha256: "5".repeat(64), byteSize: 2048 },
        { kind: "authority", sha256: "6".repeat(64), byteSize: 3072 },
        { kind: "report", sha256: "7".repeat(64), byteSize: 4096 },
      ];
      await assertDatabaseError(claim(tx, writerBuild, null), "PNJ03");
      const [queuedAfterNullLease] = await tx`
        select status,attempt_count from public.lukas_drawing_native_dwg_jobs
        where id=${accepted.value.jobId}::uuid
      `;
      assert.deepEqual(queuedAfterNullLease, {
        status: "queued",
        attempt_count: 0,
      });
      const [firstClaim] = await claim(tx, writerBuild);
      assert.equal(firstClaim.value.jobId, accepted.value.jobId);
      assert.equal(firstClaim.value.attempt, 1);
      assert.equal(firstClaim.value.writerBuildSha256, writerBuild);
      assert.deepEqual(firstClaim.value.source.request, request);
      assert.deepEqual(firstClaim.value.source.payload, payload);
      const [beforeInvalidFailures] = await tx`
        select status,attempt_count,lease_token,lease_expires_at,
          last_error_code,updated_at
        from public.lukas_drawing_native_dwg_jobs
        where id=${accepted.value.jobId}::uuid
      `;
      for (const invalidAttempt of [null, 0, 4]) {
        await assertDatabaseError(
          fail(
            tx,
            { ...firstClaim.value, attempt: invalidAttempt },
            "conversion_failed",
            false,
          ),
          "PNJ03",
        );
      }
      const [afterInvalidFailures] = await tx`
        select status,attempt_count,lease_token,lease_expires_at,
          last_error_code,updated_at
        from public.lukas_drawing_native_dwg_jobs
        where id=${accepted.value.jobId}::uuid
      `;
      assert.deepEqual(afterInvalidFailures, beforeInvalidFailures);
      const [firstFailure] = await fail(
        tx, firstClaim.value, "conversion_failed", true,
      );
      assert.equal(firstFailure.value, "retry_wait");
      await tx`
        update public.lukas_drawing_native_dwg_jobs
        set next_attempt_at=pg_catalog.clock_timestamp()-interval '1 second'
        where id=${accepted.value.jobId}::uuid
      `;
      const [wrongBuildClaim] = await claim(tx, otherBuild);
      assert.equal(wrongBuildClaim.value, null);
      const [secondClaim] = await claim(tx, writerBuild);
      assert.equal(secondClaim.value.attempt, 2);
      const [secondPaths] = await stage(
        tx, secondClaim.value, structureSha256, artifactMetadata,
      );
      assert.equal(secondPaths.value.length, 4);
      const [secondFailure] = await fail(
        tx, secondClaim.value, "upload_failed", true,
      );
      assert.equal(secondFailure.value, "retry_wait");
      await tx`
        update public.lukas_drawing_native_dwg_jobs
        set next_attempt_at=pg_catalog.clock_timestamp()-interval '1 second'
        where id=${accepted.value.jobId}::uuid
      `;
      const [thirdClaim] = await claim(tx, writerBuild);
      assert.equal(thirdClaim.value.attempt, 3);
      const [retainedOpen] = await tx`
        select pg_catalog.count(*)::integer count
        from public.lukas_drawing_native_dwg_attempts
        where job_id=${accepted.value.jobId}::uuid and upload_state='open'
      `;
      assert.equal(retainedOpen.count, 1);
      const [staleFailure] = await fail(
        tx, secondClaim.value, "publication_failed", false,
      );
      assert.equal(staleFailure.value, "stale");
      await assertDatabaseError(
        stage(tx, secondClaim.value, structureSha256, artifactMetadata),
        "PNJ03",
      );
      const [closedOldAttempt] = await settle(tx, secondClaim.value);
      assert.equal(closedOldAttempt.value, "closed");

      for (const [badStructure, badArtifacts] of [
        ["A".repeat(64), artifactMetadata],
        [structureSha256, artifactMetadata.slice(0, 3)],
        [structureSha256, artifactMetadata.map((item, index) =>
          index === 3 ? { ...item, kind: "authority" } : item)],
        [structureSha256, artifactMetadata.map((item, index) =>
          index === 0 ? { ...item, path: "forged" } : item)],
        [structureSha256, artifactMetadata.map((item, index) =>
          index === 0 ? { ...item, byteSize: 104857601 } : item)],
        [structureSha256, artifactMetadata.map((item, index) =>
          index === 0 ? { ...item, sha256: "B".repeat(64) } : item)],
      ])
        await assertDatabaseError(
          stage(tx, thirdClaim.value, badStructure, badArtifacts),
          "PNJ04",
        );

      const [paths] = await stage(
        tx, thirdClaim.value, structureSha256, artifactMetadata,
      );
      const filenames = {
        dwg: "native.dwg",
        source_manifest: "source-manifest.json",
        authority: "authority.json",
        report: "native-report.json",
      };
      assert.deepEqual(paths.value, artifactMetadata.map((artifact) => ({
        ...artifact,
        path: `projects/${ids.project}/native-dwg/${accepted.value.jobId}/3/${artifact.sha256}/${filenames[artifact.kind]}`,
      })));
      const [stageReplay] = await stage(
        tx, thirdClaim.value, structureSha256, artifactMetadata,
      );
      assert.deepEqual(stageReplay.value, paths.value);
      await assertDatabaseError(
        stage(tx, thirdClaim.value, "8".repeat(64), artifactMetadata),
        "PNJ04",
      );
      await assertDatabaseError(
        stage(
          tx,
          thirdClaim.value,
          structureSha256,
          artifactMetadata.map((item, index) => index === 0
            ? { ...item, sha256: "9".repeat(64) }
            : item),
        ),
        "PNJ04",
      );
      await assertDatabaseError(publish(tx, thirdClaim.value), "PNJ03");
      const [settled] = await settle(tx, thirdClaim.value);
      assert.equal(settled.value, "closed");
      const [settleReplay] = await settle(tx, thirdClaim.value);
      assert.equal(settleReplay.value, "closed");
      const [receipt] = await publish(tx, thirdClaim.value);
      assert.deepEqual(receipt.value, {
        jobId: accepted.value.jobId,
        attempt: 3,
        qualification: "experimental-unqualified",
        source: request,
        writerBuildSha256: writerBuild,
        structureSha256,
        artifacts: artifactMetadata,
        createdAt: receipt.value.createdAt,
      });
      assert.match(receipt.value.createdAt, /^\d{4}-\d\d-\d\dT/);
      const [publishReplay] = await publish(tx, thirdClaim.value);
      assert.deepEqual(publishReplay.value, receipt.value);
      const [lateFailure] = await fail(
        tx, thirdClaim.value, "publication_failed", false,
      );
      assert.equal(lateFailure.value, "stale");

      const [expiryAccepted] = await requestJob(
        tx,
        ids.users.owner,
        secondApproved.scope,
        randomUUID(),
      );
      const [expiryFirst] = await claim(tx, writerBuild);
      assert.equal(expiryFirst.value.jobId, expiryAccepted.value.jobId);
      await tx`
        update public.lukas_drawing_native_dwg_jobs
        set lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second'
        where id=${expiryAccepted.value.jobId}::uuid
      `;
      await assertDatabaseError(
        stage(tx, expiryFirst.value, structureSha256, artifactMetadata),
        "PNJ03",
      );
      await assertDatabaseError(publish(tx, expiryFirst.value), "PNJ03");
      const [expiredFailure] = await fail(
        tx,
        expiryFirst.value,
        "conversion_failed",
        true,
      );
      assert.equal(expiredFailure.value, "stale");
      const [expirySecond] = await claim(tx, writerBuild);
      assert.equal(expirySecond.value.attempt, 2);
      await assertDatabaseError(publish(tx, expiryFirst.value), "PNJ03");
      await tx`
        update public.lukas_drawing_native_dwg_jobs
        set lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second'
        where id=${expiryAccepted.value.jobId}::uuid
      `;
      const [expiryThird] = await claim(tx, writerBuild);
      assert.equal(expiryThird.value.attempt, 3);
      await tx`
        update public.lukas_drawing_native_dwg_jobs
        set lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second'
        where id=${expiryAccepted.value.jobId}::uuid
      `;
      const [afterThirdExpiry] = await claim(tx, writerBuild);
      assert.equal(afterThirdExpiry.value, null);
      const [terminalExpiry] = await tx`
        select status,attempt_count,last_error_code
        from public.lukas_drawing_native_dwg_jobs
        where id=${expiryAccepted.value.jobId}::uuid
      `;
      assert.deepEqual(terminalExpiry, {
        status: "failed",
        attempt_count: 3,
        last_error_code: "lease_expired",
      });

      for (const actor of [ids.users.owner, ids.users.editor, ids.users.viewer]) {
        const [status] = await jobStatus(
          tx, actor, request, accepted.value.jobId,
        );
        assert.equal(status.value.status, "completed");
        assert.equal(status.value.attemptCount, 3);
        assert.deepEqual(status.value.receipt, receipt.value);
      }
      for (const [actor, kind] of [
        [ids.users.owner, "dwg"],
        [ids.users.editor, "source_manifest"],
        [ids.users.viewer, "report"],
      ]) {
        const [download] = await descriptor(
          tx, actor, request, accepted.value.jobId, kind,
        );
        const artifact = paths.value.find((item) => item.kind === kind);
        assert.deepEqual(download.value, {
          jobId: accepted.value.jobId,
          kind,
          bucket: "lukas-qto",
          path: artifact.path,
          sha256: artifact.sha256,
          byteSize: artifact.byteSize,
        });
      }
      await assertDatabaseError(
        descriptor(tx, ids.users.owner, request, accepted.value.jobId, "exe"),
        "PNJ01",
      );

      await tx`
        insert into public.lukas_qto_project_members(project_id,user_id,role)
        values(${ids.project}::uuid,${ids.users.quickOwner}::uuid,'viewer')
      `;
      const quickRequestId = randomUUID();
      const [quickAccepted] = await requestJob(
        tx, ids.users.quickOwner, request, quickRequestId,
      );
      await tx`
        delete from public.lukas_qto_project_members
        where project_id=${ids.project}::uuid
          and user_id=${ids.users.quickOwner}::uuid
      `;
      await assertDatabaseError(
        requestJob(tx, ids.users.quickOwner, request, quickRequestId),
        "PNJ01",
      );
      await assertDatabaseError(
        jobStatus(
          tx, ids.users.quickOwner, request, quickAccepted.value.jobId,
        ),
        "PNJ01",
      );
      await assertDatabaseError(
        descriptor(
          tx,
          ids.users.quickOwner,
          request,
          accepted.value.jobId,
          "dwg",
        ),
        "PNJ01",
      );

      const [eligibleAfterRevokedHead] = await requestJob(
        tx,
        ids.users.owner,
        secondApproved.scope,
        randomUUID(),
      );
      const [claimAfterRevokedHead] = await claim(tx, writerBuild);
      assert.equal(
        claimAfterRevokedHead.value.jobId,
        eligibleAfterRevokedHead.value.jobId,
      );
      const [revokedHeadState] = await tx`
        select status,last_error_code
        from public.lukas_drawing_native_dwg_jobs
        where id=${quickAccepted.value.jobId}::uuid
      `;
      assert.deepEqual(revokedHeadState, {
        status: "failed",
        last_error_code: "source_unavailable",
      });
      const [eligibleStopped] = await fail(
        tx,
        claimAfterRevokedHead.value,
        "conversion_failed",
        false,
      );
      assert.equal(eligibleStopped.value, "failed");

      await tx`
        insert into public.lukas_qto_project_members(project_id,user_id,role)
        values(${ids.project}::uuid,${ids.users.quickOwner}::uuid,'viewer')
      `;
      const [revokedBeforeStage] = await requestJob(
        tx,
        ids.users.quickOwner,
        secondApproved.scope,
        randomUUID(),
      );
      const [revokedStageClaim] = await claim(tx, writerBuild);
      assert.equal(revokedStageClaim.value.jobId, revokedBeforeStage.value.jobId);
      await tx`
        delete from public.lukas_qto_project_members
        where project_id=${ids.project}::uuid
          and user_id=${ids.users.quickOwner}::uuid
      `;
      await assertDatabaseError(
        stage(
          tx,
          revokedStageClaim.value,
          structureSha256,
          artifactMetadata,
        ),
        "PNJ03",
      );
      await tx`
        update public.lukas_drawing_native_dwg_jobs
        set lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second'
        where id=${revokedBeforeStage.value.jobId}::uuid
      `;
      const [afterRevokedStageClaim] = await claim(tx, writerBuild);
      assert.equal(afterRevokedStageClaim.value, null);
      const [revokedStageState] = await tx`
        select status,last_error_code
        from public.lukas_drawing_native_dwg_jobs
        where id=${revokedBeforeStage.value.jobId}::uuid
      `;
      assert.deepEqual(revokedStageState, {
        status: "failed",
        last_error_code: "source_unavailable",
      });

      await tx`
        insert into public.lukas_qto_project_members(project_id,user_id,role)
        values(${ids.project}::uuid,${ids.users.quickOwner}::uuid,'viewer')
      `;
      const [revokedBeforePublish] = await requestJob(
        tx,
        ids.users.quickOwner,
        secondApproved.scope,
        randomUUID(),
      );
      const [revokedPublishClaim] = await claim(tx, writerBuild);
      assert.equal(
        revokedPublishClaim.value.jobId,
        revokedBeforePublish.value.jobId,
      );
      const [revokedPublishPaths] = await stage(
        tx,
        revokedPublishClaim.value,
        structureSha256,
        artifactMetadata,
      );
      assert.equal(revokedPublishPaths.value.length, 4);
      const [revokedPublishSettled] = await settle(
        tx,
        revokedPublishClaim.value,
      );
      assert.equal(revokedPublishSettled.value, "closed");
      await tx`
        delete from public.lukas_qto_project_members
        where project_id=${ids.project}::uuid
          and user_id=${ids.users.quickOwner}::uuid
      `;
      await assertDatabaseError(
        publish(tx, revokedPublishClaim.value),
        "PNJ03",
      );
      await tx`
        update public.lukas_drawing_native_dwg_jobs
        set lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second'
        where id=${revokedBeforePublish.value.jobId}::uuid
      `;
      const [afterRevokedPublishClaim] = await claim(tx, writerBuild);
      assert.equal(afterRevokedPublishClaim.value, null);
      const [revokedPublishState] = await tx`
        select status,last_error_code
        from public.lukas_drawing_native_dwg_jobs
        where id=${revokedBeforePublish.value.jobId}::uuid
      `;
      assert.deepEqual(revokedPublishState, {
        status: "failed",
        last_error_code: "source_unavailable",
      });

      const activeAcceptances = [];
      for (const actor of [ids.users.owner, ids.users.viewer]) {
        const requestId = randomUUID();
        const [row] = await requestJob(tx, actor, request, requestId);
        activeAcceptances.push({ actor, requestId, value: row.value });
      }
      for (let index = 0; index < 3; index += 1) {
        const requestId = randomUUID();
        const [row] = await requestJob(
          tx, ids.users.owner, request, requestId,
        );
        activeAcceptances.push({
          actor: ids.users.owner, requestId, value: row.value,
        });
      }
      await assertDatabaseError(
        requestJob(tx, ids.users.owner, request, randomUUID()),
        "PNJ05",
      );
      const [capacityReplay] = await requestJob(
        tx,
        activeAcceptances[0].actor,
        request,
        activeAcceptances[0].requestId,
      );
      assert.deepEqual(capacityReplay.value, activeAcceptances[0].value);
      const [retainedUploadClaim] = await claim(tx, writerBuild);
      assert.equal(
        retainedUploadClaim.value.jobId,
        activeAcceptances[0].value.jobId,
      );
      const [retainedUploadPaths] = await stage(
        tx,
        retainedUploadClaim.value,
        structureSha256,
        artifactMetadata,
      );
      assert.equal(retainedUploadPaths.value.length, 4);
      const [openUploadEvidence] = await tx`
        select pg_catalog.count(*)::integer count
        from public.lukas_drawing_native_dwg_attempts
        where project_id=${ids.project}::uuid and upload_state='open'
      `;
      assert.equal(openUploadEvidence.count, 1);

      const nativeObjectPath = paths.value[0].path;
      const nativeObjectId = randomUUID();
      const ordinaryId = randomUUID();
      const ordinaryPath = `projects/${ids.project}/ordinary/${randomUUID()}`;
      const [ordinaryInserted] = await asActor(tx, ids.users.owner, (sp) => sp`
        insert into storage.objects(id,bucket_id,name)
        values(${ordinaryId}::uuid,'lukas-qto',${ordinaryPath}) returning id,name
      `);
      assert.deepEqual(ordinaryInserted, { id: ordinaryId, name: ordinaryPath });
      const [ordinaryVisible] = await asActor(tx, ids.users.owner, (sp) => sp`
        select name from storage.objects where id=${ordinaryId}::uuid
      `);
      assert.equal(ordinaryVisible.name, ordinaryPath);
      await tx`
        insert into storage.objects(id,bucket_id,name)
        values(${nativeObjectId}::uuid,'lukas-qto',${nativeObjectPath})
      `;
      const [hidden] = await asActor(tx, ids.users.owner, (sp) => sp`
        select pg_catalog.count(*)::integer count from storage.objects
        where id=${nativeObjectId}::uuid
      `);
      assert.equal(hidden.count, 0);
      await assertDatabaseError(
        asActor(tx, ids.users.owner, (sp) => sp`
          insert into storage.objects(id,bucket_id,name)
          values(${randomUUID()}::uuid,'lukas-qto',${paths.value[1].path})
        `),
        "42501",
      );
      const filteredMove = await asActor(tx, ids.users.owner, (sp) => sp`
        update storage.objects set name=${paths.value[2].path}
        where id=${ordinaryId}::uuid returning id
      `);
      assert.equal(filteredMove.length, 0);
      const [unchangedOrdinary] = await tx`
        select name from storage.objects where id=${ordinaryId}::uuid
      `;
      assert.equal(unchangedOrdinary.name, ordinaryPath);

      // Test-only adversarial permissive policy: the production restrictive
      // policy must still win for both the old and new native prefix identity.
      await tx.unsafe(`
        create policy "M1 test permits project storage update"
        on storage.objects for update to authenticated
        using (
          bucket_id='lukas-qto'
          and name like 'projects/${ids.project}/%'
        )
        with check (
          bucket_id='lukas-qto'
          and name like 'projects/${ids.project}/%'
        )
      `);
      try {
        const ordinaryRenamedPath = `${ordinaryPath}-renamed`;
        const [ordinaryRenamed] = await asActor(
          tx,
          ids.users.owner,
          (sp) => sp`
            update storage.objects set name=${ordinaryRenamedPath}
            where id=${ordinaryId}::uuid returning id,name
          `,
        );
        assert.deepEqual(ordinaryRenamed, {
          id: ordinaryId,
          name: ordinaryRenamedPath,
        });
        await assertDatabaseError(
          asActor(tx, ids.users.owner, (sp) => sp`
            update storage.objects set name=${paths.value[2].path}
            where id=${ordinaryId}::uuid
          `),
          "42501",
        );
        const nativeMoveOut = await asActor(tx, ids.users.owner, (sp) => sp`
          update storage.objects set name=${ordinaryPath}
          where id=${nativeObjectId}::uuid returning id
        `);
        assert.equal(nativeMoveOut.length, 0);
        const [storageState] = await tx`
          select
            (select name from storage.objects
              where id=${ordinaryId}::uuid) ordinary_name,
            (select name from storage.objects
              where id=${nativeObjectId}::uuid) native_name
        `;
        assert.deepEqual(storageState, {
          ordinary_name: ordinaryRenamedPath,
          native_name: nativeObjectPath,
        });
      } finally {
        await tx.unsafe(`
          drop policy "M1 test permits project storage update"
          on storage.objects
        `);
      }
      const deleted = await asActor(tx, ids.users.owner, (sp) => sp`
        delete from storage.objects where id=${nativeObjectId}::uuid returning id
      `);
      assert.equal(deleted.length, 0);

      for (const [table, predicate] of [
        ["lukas_drawing_native_dwg_jobs", `id='${accepted.value.jobId}'::uuid`],
        ["lukas_drawing_native_dwg_attempts", `job_id='${accepted.value.jobId}'::uuid`],
        ["lukas_drawing_native_dwg_artifacts", `job_id='${accepted.value.jobId}'::uuid`],
        ["lukas_drawing_native_dwg_exports", `job_id='${accepted.value.jobId}'::uuid`],
      ])
        await assertDatabaseError(
          tx.savepoint((sp) =>
            sp.unsafe(`delete from public.${table} where ${predicate}`)
          ),
          "42501",
        );
      await assertDatabaseError(
        tx.savepoint((sp) => sp`
          update public.lukas_drawing_native_dwg_artifacts
          set sha256=${"8".repeat(64)}
          where job_id=${accepted.value.jobId}::uuid
        `),
        "42501",
      );
      await assertDatabaseError(
        tx.savepoint((sp) => sp`
          update public.lukas_drawing_native_dwg_exports
          set structure_sha256=${"9".repeat(64)}
          where job_id=${accepted.value.jobId}::uuid
        `),
        "42501",
      );

      const purgeProbeRollback = new Error("M1 native purge refusal rollback");
      await assert.rejects(
        tx.savepoint(async (sp) => {
          const [deletion] = await asActor(
            sp,
            ids.users.owner,
            (actorTx) => actorTx`
              select (public.lukas_qto_request_project_deletion(
                ${ids.organization}::uuid,${ids.project}::uuid,
                'M1 native dependency refusal',${randomUUID()}::uuid
              )).id id
            `,
          );
          await sp.unsafe(`
            alter table public.lukas_qto_retention_events
            disable trigger lukas_qto_retention_events_append_only
          `);
          await sp`
            update public.lukas_qto_retention_events
            set purge_after=pg_catalog.now()-interval '1 second'
            where id=${deletion.id}::uuid
          `;
          await sp.unsafe(`
            alter table public.lukas_qto_retention_events
            enable trigger lukas_qto_retention_events_append_only
          `);
          const [held] = await asService(sp, (serviceTx) => serviceTx`
            select public.lukas_qto_purge_project(
              ${ids.organization}::uuid,${ids.project}::uuid,
              ${randomUUID()}::uuid,'M1 native dependency probe'
            ) value
          `);
          assert.equal(held.value.status, "HELD");
          assert.equal(held.value.reason, "protected_dependencies");
          assert.equal(Number(held.value.dependencies.nativeDwgJobs), 11);
          assert.equal(Number(held.value.dependencies.nativeDwgArtifacts), 16);
          assert.equal(Number(held.value.dependencies.nativeDwgOpenUploads), 1);
          throw purgeProbeRollback;
        }),
        (error) => error === purgeProbeRollback,
      );

      const [personal] = await asActor(
        tx,
        ids.users.quickOwner,
        (sp) => sp`
          select public.lukas_drawing_ensure_personal_project() value
        `,
      );
      const purgeReadyProject = personal.value.projectId;
      const purgeReadyOrganization = personal.value.organizationId;
      const purgeReadyFileId = randomUUID();
      const purgeReadyStorageId = randomUUID();
      const purgeReadyPath =
        `projects/${purgeReadyProject}/files/${purgeReadyFileId}`;
      await tx`
        insert into public.lukas_qto_files(
          id,project_id,uploaded_by,kind,storage_path,original_filename,
          content_type,byte_size,sha256,immutable
        ) values(
          ${purgeReadyFileId}::uuid,${purgeReadyProject}::uuid,
          ${ids.users.quickOwner}::uuid,'other',${purgeReadyPath},
          'purge-ready.bin','application/octet-stream',1,
          ${"a".repeat(64)},true
        )
      `;
      await tx`
        insert into storage.objects(id,bucket_id,name)
        values(
          ${purgeReadyStorageId}::uuid,'lukas-qto',${purgeReadyPath}
        )
      `;
      await asActor(tx, ids.users.quickOwner, async (sp) => {
        await sp`
          select public.lukas_qto_set_retention_policy(
            ${purgeReadyOrganization}::uuid,0,365,
            'M1 unprotected purge policy',${randomUUID()}::uuid
          )
        `;
        await sp`
          select public.lukas_qto_request_project_deletion(
            ${purgeReadyOrganization}::uuid,${purgeReadyProject}::uuid,
            'M1 unprotected project purge',${randomUUID()}::uuid
          )
        `;
      });
      const [purgeReady] = await asService(tx, (sp) => sp`
        select public.lukas_qto_purge_project(
          ${purgeReadyOrganization}::uuid,${purgeReadyProject}::uuid,
          ${randomUUID()}::uuid,'M1 prepare unprotected project'
        ) value
      `);
      assert.equal(purgeReady.value.status, "STORAGE_REQUIRED");
      assert.equal(Number(purgeReady.value.dependencies.nativeDwgJobs), 0);
      assert.equal(
        Number(purgeReady.value.dependencies.nativeDwgOpenUploads),
        0,
      );
      await tx`
        delete from storage.objects where id=${purgeReadyStorageId}::uuid
      `;
      const orphanNativeStorageId = randomUUID();
      const orphanNativePath =
        `projects/${purgeReadyProject}/native-dwg/unregistered/native.dwg`;
      await tx`
        insert into storage.objects(id,bucket_id,name)
        values(
          ${orphanNativeStorageId}::uuid,'lukas-qto',${orphanNativePath}
        )
      `;
      await assertDatabaseError(
        asService(tx, (sp) => sp`
          select public.lukas_qto_finalize_project_purge(
            ${purgeReadyOrganization}::uuid,${purgeReadyProject}::uuid,
            ${purgeReady.value.eventId}::uuid,
            ${purgeReady.value.manifestSha256},${randomUUID()}::uuid,
            'M1 native prefix absence proof'
          )
        `),
        "P7R09",
      );
      const [prefixGuardResidue] = await tx`
        select
          (select pg_catalog.count(*)::integer
           from public.lukas_qto_projects
           where id=${purgeReadyProject}::uuid) projects,
          (select pg_catalog.count(*)::integer
           from storage.objects
           where id=${orphanNativeStorageId}::uuid) native_objects
      `;
      assert.deepEqual(prefixGuardResidue, { projects: 1, native_objects: 1 });

      const [dependencies] = await tx`
        select private.lukas_qto_project_retention_dependencies(
          ${ids.project}::uuid
        ) value
      `;
      assert.equal(Number(dependencies.value.nativeDwgJobs), 11);
      assert.equal(Number(dependencies.value.nativeDwgArtifacts), 16);
      assert.equal(Number(dependencies.value.nativeDwgOpenUploads), 1);
      const retainedArtifacts = await tx`
        select * from private.lukas_qto_project_retention_storage_files(
          ${ids.project}::uuid
        ) where path like ${`projects/${ids.project}/native-dwg/%`}
        order by path
      `;
      assert.equal(retainedArtifacts.length, 16);
      assert.equal(
        retainedArtifacts.some((item) => item.path === secondPaths.value[0].path),
        true,
      );
      assert.equal(
        retainedArtifacts.some((item) => item.path === paths.value[0].path),
        true,
      );
    },
  });
}
