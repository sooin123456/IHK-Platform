import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrations = new URL("../supabase/migrations/", import.meta.url);

const ids = Object.freeze({
  actor: "7b000000-0000-4000-8000-000000000001",
  organization: "7b000000-0000-4000-8000-000000000002",
  project: "7b000000-0000-4000-8000-000000000003",
  source: "7b000000-0000-4000-8000-000000000004",
  document: "7b000000-0000-4000-8000-000000000005",
  revision: "7b000000-0000-4000-8000-000000000006",
  request: "7b000000-0000-4000-8000-000000000007",
  duplicateRequest: "7b000000-0000-4000-8000-000000000008",
});
const sourceSha256 = "a".repeat(64);
const converterSha256 = "b".repeat(64);
const wrongConverterSha256 = "c".repeat(64);
const sourceStoragePath = `projects/${ids.project}/uploads/model.ifc`;

async function oneMigration(suffix) {
  const matches = (await readdir(migrations)).filter((name) =>
    name.endsWith(suffix),
  );
  assert.equal(matches.length, 1, `one migration owns ${suffix}`);
  return readFile(new URL(matches[0], migrations), "utf8");
}

async function optionalMigration(suffix) {
  const matches = (await readdir(migrations)).filter((name) =>
    name.endsWith(suffix),
  );
  assert.ok(matches.length <= 1, `at most one migration owns ${suffix}`);
  return matches[0] ? readFile(new URL(matches[0], migrations), "utf8") : null;
}

async function setupFailedV1() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema auth;
    create schema private;
    create schema extensions;
    create schema storage;
    create extension pgcrypto with schema extensions;
    create role anon;
    create role authenticated;
    create role service_role;

    create table auth.users(id uuid primary key);
    create table public.lukas_qto_projects(
      id uuid primary key,
      organization_id uuid not null
    );
    create table public.lukas_qto_files(
      id uuid primary key,
      project_id uuid not null references public.lukas_qto_projects(id)
        on delete cascade,
      uploaded_by uuid not null references auth.users(id),
      kind text not null,
      storage_path text not null unique,
      original_filename text not null,
      content_type text,
      byte_size bigint not null,
      sha256 text not null,
      immutable boolean not null,
      created_at timestamptz not null default pg_catalog.clock_timestamp(),
      unique(id,project_id,sha256)
    );
    create table public.lukas_drawing_documents(
      id uuid primary key,
      project_id uuid not null references public.lukas_qto_projects(id)
        on delete cascade,
      source_file_id uuid,
      unique(id,project_id)
    );
    create table public.lukas_drawing_revisions(
      id uuid primary key,
      document_id uuid not null,
      project_id uuid not null references public.lukas_qto_projects(id)
        on delete cascade,
      status text not null,
      version bigint not null default 1,
      unique(id,project_id),
      foreign key(document_id,project_id)
        references public.lukas_drawing_documents(id,project_id)
        on delete cascade
    );
    create table public.lukas_drawing_object_sources(
      id uuid primary key,
      revision_id uuid not null,
      project_id uuid not null references public.lukas_qto_projects(id)
        on delete cascade,
      source_file_id uuid not null,
      source_sha256 text not null,
      status text not null default 'active',
      source_kind text not null default 'ifc_element'
    );
    create table public.lukas_qto_retention_events(
      id uuid primary key default extensions.gen_random_uuid(),
      organization_id uuid not null,
      project_id uuid not null,
      event_type text not null,
      request_id uuid not null,
      request_sha256 text not null,
      hold_id uuid,
      releases_event_id uuid,
      purge_after timestamptz,
      reason text not null,
      evidence jsonb not null default '{}'::jsonb,
      actor_id uuid,
      created_at timestamptz not null default pg_catalog.clock_timestamp()
    );
    create unique index retention_service_request
      on public.lukas_qto_retention_events(request_id)
      where actor_id is null;
    create table storage.objects(
      bucket_id text not null,
      name text not null,
      primary key(bucket_id,name)
    );

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select pg_catalog.jsonb_build_object(
        'role',coalesce(
          nullif(current_setting('request.jwt.claim.role',true),''),
          'service_role'
        )
      )
    $$;
    create function private.lukas_qto_project_role(p_project_id uuid)
    returns text language sql stable security invoker set search_path='' as $$
      select case when p_project_id='${ids.project}'::uuid then 'owner'::text end
    $$;
    create function private.lukas_drawing_workspace_capability(uuid)
    returns text language sql stable as $$ select 'editor'::text $$;
    create function private.lukas_drawing_request_review(uuid)
    returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function private.lukas_qto_project_retention_dependencies(uuid)
    returns jsonb language sql stable as $$
      select pg_catalog.jsonb_build_object(
        'approvedDrawingRevisions',0,'drawingRevisionApprovals',0,
        'drawingIssueApprovals',0,'approvedBoqVersions',0,
        'drawingQuantityLinks',0,'drawingBoqLinks',0,
        'drawingMaterialLinks',0,'materialTransactions',0,
        'publishedLibraryVersions',0,'libraryImports',0,'immutableFiles',1
      )
    $$;
    create function private.test_project_retention_guard()
    returns trigger language plpgsql security invoker set search_path='' as $$
    begin
      if current_user=pg_catalog.pg_get_userbyid(
          (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
        ) and pg_catalog.current_setting(
          'app.lukas_retention_purge_project',true
        )=old.id::text then
        return old;
      end if;
      raise exception 'Projects must use retention authority';
    end
    $$;
    create trigger project_retention_guard
      before delete on public.lukas_qto_projects
      for each row execute function private.test_project_retention_guard();

    create function public.lukas_qto_purge_project(uuid,uuid,uuid,text)
    returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.lukas_qto_finalize_project_purge(
      uuid,uuid,uuid,text,uuid,text
    ) returns jsonb language sql as $$ select '{}'::jsonb $$;

    insert into auth.users values('${ids.actor}');
    insert into public.lukas_qto_projects values(
      '${ids.project}','${ids.organization}'
    );
  `);
  for (const suffix of [
    "_drawing_ifc_immutable_derivatives.sql",
    "_drawing_ifc_derivative_revision_binding.sql",
    "_drawing_ifc_derivative_ready_publication_authority.sql",
    "_drawing_ifc_derivative_job_authority.sql",
    "_drawing_ifc_derivative_retention_closure.sql",
  ]) {
    await db.exec(await oneMigration(suffix));
  }
  await db.exec(`
    insert into public.lukas_qto_files(
      id,project_id,uploaded_by,kind,storage_path,original_filename,
      content_type,byte_size,sha256,immutable
    ) values(
      '${ids.source}','${ids.project}','${ids.actor}','ifc',
      '${sourceStoragePath}','model.ifc','application/x-step',1234,
      '${sourceSha256}',true
    );
    insert into public.lukas_drawing_documents(
      id,project_id,source_file_id
    ) values('${ids.document}','${ids.project}','${ids.source}');
    insert into public.lukas_drawing_revisions(
      id,document_id,project_id,status,version
    ) values('${ids.revision}','${ids.document}','${ids.project}','draft',1);
  `);

  await db.exec("set role service_role");
  const claim = (
    await db.query(
      "select * from public.lukas_drawing_claim_ifc_derivative_job(300)",
    )
  ).rows[0];
  const failed = await db.query(
    `select public.lukas_drawing_fail_ifc_derivative_job(
      $1::uuid,$2::uuid,$3::bigint,false,'conversion_failed',
      'converter v1 rejected this model'
    ) as state`,
    [claim.job_id, claim.lease_token, claim.derivative_version],
  );
  assert.equal(failed.rows[0].state, "failed");
  await db.exec("reset role");

  for (const suffix of [
    "_drawing_ifc_derivative_audited_requeue.sql",
    "_drawing_ifc_derivative_requeue_replay.sql",
  ]) {
    const upgrade = await optionalMigration(suffix);
    if (upgrade) await db.exec(upgrade);
  }
  return { db, failedClaim: claim };
}

async function useRole(db, role, actor = null) {
  assert.ok(["anon", "authenticated", "service_role"].includes(role));
  await db.exec(`reset role; set role ${role}`);
  await db.query(
    `select pg_catalog.set_config('request.jwt.claim.role',$1,false),
      pg_catalog.set_config('request.jwt.claim.sub',$2,false)`,
    [role, actor ?? ""],
  );
}

async function requeue(db, jobId, requestId = ids.request) {
  const result = await db.query(
    `select public.lukas_drawing_requeue_failed_ifc_derivative_job(
      $1::uuid,$2::uuid,$3::uuid,$4::text,$5::bigint,$6::text,$7::uuid,$8::text
    ) as result`,
    [
      jobId,
      ids.project,
      ids.source,
      sourceSha256,
      1,
      converterSha256,
      requestId,
      "converter version upgrade",
    ],
  );
  return result.rows[0].result;
}

async function loadJobId(db) {
  const result = await db.query(
    `select id from public.lukas_drawing_ifc_derivative_jobs
      where source_file_id=$1::uuid and source_sha256=$2::text`,
    [ids.source, sourceSha256],
  );
  return result.rows[0].id;
}

test("service requeue advances failed v1 once and appends immutable audit evidence", async () => {
  const { db, failedClaim } = await setupFailedV1();
  try {
    const jobId = await loadJobId(db);
    const sourceBefore = (
      await db.query(
        `select id,project_id,storage_path,byte_size,sha256,immutable
        from public.lukas_qto_files where id=$1::uuid`,
        [ids.source],
      )
    ).rows[0];
    const derivativeBefore = (
      await db.query(
        `select id,project_id,source_file_id,source_sha256,version,status,
          manifest_json,manifest_storage_path,geometry_storage_path,created_by
        from public.lukas_drawing_ifc_derivatives
        where source_file_id=$1::uuid and version=1`,
        [ids.source],
      )
    ).rows[0];
    const revisionBefore = (
      await db.query(
        `select id,document_id,project_id,status,version
        from public.lukas_drawing_revisions where id=$1::uuid`,
        [ids.revision],
      )
    ).rows[0];

    await useRole(db, "service_role");
    let first;
    await assert.doesNotReject(async () => {
      first = await requeue(db, jobId);
    }, "service authority must be able to audit and queue generation 2");
    assert.equal(first.status, "queued");
    assert.equal(first.jobId, jobId);
    assert.equal(first.generation, 2);
    assert.equal(first.targetVersion, 2);
    assert.equal(first.converterSha256, converterSha256);
    assert.equal(first.requestId, ids.request);
    assert.deepEqual(
      await requeue(db, jobId),
      first,
      "request replay is idempotent",
    );
    await assert.rejects(
      requeue(db, jobId, ids.duplicateRequest),
      /already requeued|terminal failed job|request conflict/i,
    );
    await assert.rejects(
      db.query(
        `select public.lukas_drawing_fail_ifc_derivative_job(
          $1::uuid,$2::uuid,$3::bigint,false,'stale_worker','stale lease'
        )`,
        [
          failedClaim.job_id,
          failedClaim.lease_token,
          failedClaim.derivative_version,
        ],
      ),
      /stale|unavailable/i,
    );

    await useRole(db, "authenticated", ids.actor);
    await assert.rejects(requeue(db, jobId), /permission denied/i);
    await useRole(db, "anon");
    await assert.rejects(requeue(db, jobId), /permission denied/i);
    await db.exec("reset role");

    const job = (
      await db.query(
        `select status,generation,converter_sha256,attempt_count,
          claimed_version,lease_token,lease_expires_at,last_error_code
        from public.lukas_drawing_ifc_derivative_jobs where id=$1::uuid`,
        [jobId],
      )
    ).rows[0];
    assert.deepEqual(job, {
      status: "queued",
      generation: 2,
      converter_sha256: converterSha256,
      attempt_count: 0,
      claimed_version: null,
      lease_token: null,
      lease_expires_at: null,
      last_error_code: null,
    });
    const events = (
      await db.query(
        `select job_id,project_id,source_file_id,source_sha256,request_id,
          from_generation,to_generation,failed_derivative_version,
          target_derivative_version,target_converter_sha256,reason
        from public.lukas_drawing_ifc_derivative_requeue_events`,
      )
    ).rows;
    assert.deepEqual(events, [
      {
        job_id: jobId,
        project_id: ids.project,
        source_file_id: ids.source,
        source_sha256: sourceSha256,
        request_id: ids.request,
        from_generation: 1,
        to_generation: 2,
        failed_derivative_version: 1,
        target_derivative_version: 2,
        target_converter_sha256: converterSha256,
        reason: "converter version upgrade",
      },
    ]);
    await assert.rejects(
      db.query(
        `update public.lukas_drawing_ifc_derivative_requeue_events
        set reason='rewritten' where request_id=$1::uuid`,
        [ids.request],
      ),
      /append-only|immutable/i,
    );
    assert.deepEqual(
      (
        await db.query(
          `select id,project_id,storage_path,byte_size,sha256,immutable
          from public.lukas_qto_files where id=$1::uuid`,
          [ids.source],
        )
      ).rows[0],
      sourceBefore,
    );
    assert.deepEqual(
      (
        await db.query(
          `select id,project_id,source_file_id,source_sha256,version,status,
            manifest_json,manifest_storage_path,geometry_storage_path,created_by
          from public.lukas_drawing_ifc_derivatives
          where source_file_id=$1::uuid and version=1`,
          [ids.source],
        )
      ).rows[0],
      derivativeBefore,
    );
    assert.deepEqual(
      (
        await db.query(
          `select id,document_id,project_id,status,version
          from public.lukas_drawing_revisions where id=$1::uuid`,
          [ids.revision],
        )
      ).rows[0],
      revisionBefore,
    );
    assert.equal(
      (
        await db.query(
          `select count(*)::int as count
          from public.lukas_drawing_ifc_derivatives`,
        )
      ).rows[0].count,
      1,
      "requeue must not manufacture a pending or duplicate artifact",
    );
  } finally {
    await db.close();
  }
});

test("committed requeue replay survives later purge preparation", async () => {
  const { db } = await setupFailedV1();
  try {
    const jobId = await loadJobId(db);
    await useRole(db, "service_role");
    const first = await requeue(db, jobId);

    await db.exec("reset role");
    await db.query(
      `insert into public.lukas_qto_retention_events(
        organization_id,project_id,event_type,request_id,request_sha256,reason
      ) values($1::uuid,$2::uuid,'purge_storage_ready',$3::uuid,$4::text,$5::text)`,
      [
        ids.organization,
        ids.project,
        ids.duplicateRequest,
        "d".repeat(64),
        "purge prepared after committed requeue",
      ],
    );

    await useRole(db, "service_role");
    assert.deepEqual(
      await requeue(db, jobId),
      first,
      "response-loss replay must return the committed decision",
    );
    await assert.rejects(
      requeue(db, jobId, ids.duplicateRequest),
      /blocked by project purge/i,
      "a new request may not start after purge preparation",
    );
  } finally {
    await db.close();
  }
});

test("committed requeue replay rejects nullable identity payloads", async () => {
  const { db } = await setupFailedV1();
  try {
    const jobId = await loadJobId(db);
    await useRole(db, "service_role");
    await requeue(db, jobId);

    for (const [label, payload] of [
      ["job", [null, ids.project, ids.source, sourceSha256]],
      ["source", [jobId, ids.project, null, sourceSha256]],
      ["source SHA", [jobId, ids.project, ids.source, null]],
    ]) {
      await assert.rejects(
        db.query(
          `select public.lukas_drawing_requeue_failed_ifc_derivative_job(
            $1::uuid,$2::uuid,$3::uuid,$4::text,$5::bigint,$6::text,
            $7::uuid,$8::text
          )`,
          [
            ...payload,
            1,
            converterSha256,
            ids.request,
            "converter version upgrade",
          ],
        ),
        /request conflict/i,
        `${label} identity must not borrow a committed request decision`,
      );
    }
  } finally {
    await db.close();
  }
});

test("only the requested converter can claim generation 2 without a parallel lease", async () => {
  const { db } = await setupFailedV1();
  try {
    const jobId = await loadJobId(db);
    await useRole(db, "service_role");
    await assert.doesNotReject(() => requeue(db, jobId));
    await assert.rejects(
      db.query(
        "select * from public.lukas_drawing_claim_ifc_derivative_job(300)",
      ),
      /permission denied|does not exist|converter identity/i,
    );
    const wrong = await db.query(
      `select *
      from public.lukas_drawing_claim_ifc_derivative_job_for_converter(
        $1::text,300
      )`,
      [wrongConverterSha256],
    );
    assert.deepEqual(wrong.rows, []);
    const matching = await db.query(
      `select *
      from public.lukas_drawing_claim_ifc_derivative_job_for_converter(
        $1::text,300
      )`,
      [converterSha256],
    );
    assert.equal(matching.rows.length, 1);
    assert.equal(matching.rows[0].job_id, jobId);
    assert.equal(matching.rows[0].generation, 2);
    assert.equal(matching.rows[0].derivative_version, 2);
    assert.equal(matching.rows[0].converter_sha256, converterSha256);
    const parallel = await db.query(
      `select *
      from public.lukas_drawing_claim_ifc_derivative_job_for_converter(
        $1::text,300
      )`,
      [converterSha256],
    );
    assert.deepEqual(parallel.rows, []);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query(
          `select count(*)::int as count
          from public.lukas_drawing_ifc_derivatives`,
        )
      ).rows[0].count,
      1,
      "claiming a lease must keep failed v1 as the only artifact evidence",
    );
  } finally {
    await db.close();
  }
});

test("requeue generation 2 publishes ready evidence and completes without rewriting failed v1", async () => {
  const { db } = await setupFailedV1();
  try {
    const jobId = await loadJobId(db);
    const sourceBefore = (
      await db.query(
        `select storage_path,byte_size,sha256,immutable
        from public.lukas_qto_files where id=$1::uuid`,
        [ids.source],
      )
    ).rows[0];
    await useRole(db, "service_role");
    await requeue(db, jobId);
    const claim = (
      await db.query(
        `select *
        from public.lukas_drawing_claim_ifc_derivative_job_for_converter(
          $1::text,300
        )`,
        [converterSha256],
      )
    ).rows[0];
    assert.equal(claim.derivative_version, 2);
    assert.equal(claim.generation, 2);

    const manifestSha256 = "d".repeat(64);
    const geometrySha256 = "e".repeat(64);
    const prefix = `projects/${ids.project}/ifc-derivatives/${sourceSha256}/v2`;
    const manifest = {
      schemaVersion: 1,
      source: { fileId: ids.source, sha256: sourceSha256 },
      geometry: { sha256: geometrySha256 },
      elements: [],
    };
    const published = await db.query(
      `select public.lukas_drawing_publish_leased_ifc_derivative_ready(
        $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::bigint,$7::jsonb,
        $8::text,$9::bigint,$10::text,$11::text,$12::bigint,$13::text,$14::uuid
      ) as id`,
      [
        claim.job_id,
        claim.lease_token,
        ids.project,
        ids.source,
        sourceSha256,
        claim.derivative_version,
        JSON.stringify(manifest),
        `${prefix}/${manifestSha256}.json`,
        256,
        manifestSha256,
        `${prefix}/${geometrySha256}.glb`,
        128,
        geometrySha256,
        ids.actor,
      ],
    );
    const derivativeId = published.rows[0].id;
    const completed = await db.query(
      `select public.lukas_drawing_complete_ifc_derivative_job(
        $1::uuid,$2::uuid,$3::bigint,$4::uuid
      ) as state`,
      [claim.job_id, claim.lease_token, claim.derivative_version, derivativeId],
    );
    assert.equal(completed.rows[0].state, "completed");
    await db.exec("reset role");

    assert.deepEqual(
      (
        await db.query(
          `select storage_path,byte_size,sha256,immutable
          from public.lukas_qto_files where id=$1::uuid`,
          [ids.source],
        )
      ).rows[0],
      sourceBefore,
    );
    assert.deepEqual(
      (
        await db.query(
          `select version,status,manifest_sha256,geometry_sha256
          from public.lukas_drawing_ifc_derivatives
          where source_file_id=$1::uuid order by version`,
          [ids.source],
        )
      ).rows,
      [
        {
          version: 1,
          status: "failed",
          manifest_sha256: null,
          geometry_sha256: null,
        },
        {
          version: 2,
          status: "ready",
          manifest_sha256: manifestSha256,
          geometry_sha256: geometrySha256,
        },
      ],
    );
    assert.deepEqual(
      (
        await db.query(
          `select status,generation,target_version,claimed_version,
            converter_sha256,last_error_code
          from public.lukas_drawing_ifc_derivative_jobs where id=$1::uuid`,
          [jobId],
        )
      ).rows[0],
      {
        status: "completed",
        generation: 2,
        target_version: 2,
        claimed_version: 2,
        converter_sha256: converterSha256,
        last_error_code: null,
      },
    );
  } finally {
    await db.close();
  }
});
