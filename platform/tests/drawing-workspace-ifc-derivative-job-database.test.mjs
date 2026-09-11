import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrations = new URL("../supabase/migrations/", import.meta.url);

const ids = Object.freeze({
  actor: "72000000-0000-4000-8000-000000000001",
  outsider: "72000000-0000-4000-8000-000000000002",
  project: "72000000-0000-4000-8000-000000000003",
  source: "72000000-0000-4000-8000-000000000004",
  pdf: "72000000-0000-4000-8000-000000000005",
});
const sourceSha256 = "a".repeat(64);
const pdfSha256 = "b".repeat(64);
const sourceStoragePath = `${ids.actor}/${ids.project}/source-uploads/model.ifc`;

async function oneMigration(suffix) {
  const names = (await readdir(migrations)).filter((name) =>
    name.endsWith(suffix),
  );
  assert.equal(names.length, 1, `one forward migration owns ${suffix}`);
  return readFile(new URL(names[0], migrations), "utf8");
}

const derivativeMigration = () =>
  oneMigration("_drawing_ifc_immutable_derivatives.sql");
const bindingMigration = () =>
  oneMigration("_drawing_ifc_derivative_revision_binding.sql");
const publicationMigration = () =>
  oneMigration("_drawing_ifc_derivative_ready_publication_authority.sql");
const jobMigration = () =>
  oneMigration("_drawing_ifc_derivative_job_authority.sql");

async function setupDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema auth;
    create schema private;
    create schema extensions;
    create extension pgcrypto with schema extensions;
    create role anon;
    create role authenticated;
    create role service_role;

    create table auth.users(id uuid primary key);
    create table public.lukas_qto_projects(id uuid primary key);
    create table public.lukas_qto_files(
      id uuid primary key,
      project_id uuid not null references public.lukas_qto_projects(id),
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
      id uuid primary key,project_id uuid not null,source_file_id uuid,
      unique(id,project_id)
    );
    create table public.lukas_drawing_revisions(
      id uuid primary key,document_id uuid not null,project_id uuid not null,
      status text not null,version bigint not null default 1,
      unique(id,project_id)
    );
    create table public.lukas_drawing_object_sources(
      id uuid primary key,revision_id uuid not null,project_id uuid not null,
      source_file_id uuid not null,source_sha256 text not null,
      status text not null default 'active',
      source_kind text not null default 'ifc_element'
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create function private.lukas_qto_project_role(p_project_id uuid)
    returns text language sql stable security invoker set search_path='' as $$
      select case
        when p_project_id='${ids.project}'::uuid
          and (select auth.uid())='${ids.actor}'::uuid
        then 'owner'::text
      end
    $$;
    create function private.lukas_drawing_workspace_capability(uuid)
    returns text language sql stable as $$ select 'editor'::text $$;
    create function private.lukas_drawing_request_review(uuid)
    returns jsonb language sql as $$ select '{}'::jsonb $$;

    insert into auth.users values('${ids.actor}'),('${ids.outsider}');
    insert into public.lukas_qto_projects values('${ids.project}');
  `);
  await db.exec(await derivativeMigration());
  await db.exec(await bindingMigration());
  await db.exec(await publicationMigration());
  await db.exec(`
    insert into public.lukas_qto_files(
      id,project_id,uploaded_by,kind,storage_path,original_filename,
      content_type,byte_size,sha256,immutable
    ) values(
      '${ids.source}','${ids.project}','${ids.actor}','ifc',
      '${sourceStoragePath}','model.ifc','application/x-step',1234,
      '${sourceSha256}',true
    ),(
      '${ids.pdf}','${ids.project}','${ids.actor}','pdf',
      '${ids.actor}/${ids.project}/source-uploads/sheet.pdf','sheet.pdf',
      'application/pdf',2345,'${pdfSha256}',true
    );
  `);
  await db.exec(await jobMigration());
  return db;
}

async function claim(db, leaseSeconds = 300) {
  const result = await db.query(
    `select * from public.lukas_drawing_claim_ifc_derivative_job(${leaseSeconds})`,
  );
  return result.rows[0] ?? null;
}

async function fail(db, claimRow, retryable, code = "converter_failed") {
  const result = await db.query(
    `select public.lukas_drawing_fail_ifc_derivative_job(
      '${claimRow.job_id}','${claimRow.lease_token}',
      ${claimRow.derivative_version},${retryable},'${code}',
      E'  private\\nparser\\tdetail  '
    ) as state`,
  );
  return result.rows[0].state;
}

test("job authority migration keeps locks and every mutation behind service RPCs", async () => {
  const sql = await jobMigration();
  assert.match(sql, /for update skip locked/i);
  assert.match(
    sql,
    /revoke all on table public\.lukas_drawing_ifc_derivative_jobs[\s\S]*public,anon,authenticated,service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.lukas_drawing_claim_ifc_derivative_job[\s\S]*to service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.lukas_drawing_ifc_derivative_job_status[\s\S]*to authenticated/i,
  );
  assert.doesNotMatch(
    sql,
    /insert into public\.lukas_drawing_ifc_derivatives[\s\S]*'pending'/i,
  );
});

test("migration backfills and future inserts enqueue exactly one immutable IFC job", async () => {
  const db = await setupDatabase();
  const backfill = await db.query(`
    select source_file_id,status,source_storage_path,source_byte_size,
      source_sha256,requested_by
    from public.lukas_drawing_ifc_derivative_jobs
  `);
  assert.deepEqual(backfill.rows, [
    {
      source_file_id: ids.source,
      status: "queued",
      source_storage_path: sourceStoragePath,
      source_byte_size: 1234,
      source_sha256: sourceSha256,
      requested_by: ids.actor,
    },
  ]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int as count from public.lukas_drawing_ifc_derivatives",
      )
    ).rows[0].count,
    0,
  );

  const secondSource = "72000000-0000-4000-8000-000000000006";
  await db.exec(`
    insert into public.lukas_qto_files(
      id,project_id,uploaded_by,kind,storage_path,original_filename,
      byte_size,sha256,immutable
    ) values(
      '${secondSource}','${ids.project}','${ids.actor}','ifc',
      '${ids.actor}/${ids.project}/source-uploads/model-2.ifc','model-2.ifc',
      3456,'${"c".repeat(64)}',true
    );
  `);
  const counts = await db.query(`
    select source_file_id,count(*)::int as count
    from public.lukas_drawing_ifc_derivative_jobs
    group by source_file_id order by source_file_id
  `);
  assert.deepEqual(counts.rows, [
    { source_file_id: ids.source, count: 1 },
    { source_file_id: secondSource, count: 1 },
  ]);

  await assert.rejects(
    db.exec(`
      insert into public.lukas_drawing_ifc_derivative_jobs(
        project_id,source_file_id,source_sha256,source_storage_path,
        source_byte_size,requested_by
      ) values(
        '${ids.project}','${ids.pdf}','${pdfSha256}',
        '${ids.actor}/${ids.project}/source-uploads/sheet.pdf',2345,'${ids.actor}'
      )
    `),
    /immutable IFC source/i,
  );
  await db.close();
});

test("only service claims one live lease with exact source identity and next version", async () => {
  const db = await setupDatabase();
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select * from public.lukas_drawing_ifc_derivative_jobs"),
    /permission denied/i,
  );
  await assert.rejects(claim(db), /permission denied/i);
  await db.exec("reset role; set role authenticated");
  await assert.rejects(
    db.query("select * from public.lukas_drawing_ifc_derivative_jobs"),
    /permission denied/i,
  );
  await assert.rejects(claim(db), /permission denied/i);
  await db.exec("reset role; set role service_role");
  await assert.rejects(
    db.query("select * from public.lukas_drawing_ifc_derivative_jobs"),
    /permission denied/i,
  );
  await assert.rejects(claim(db, 29), /between 30 and 900 seconds/i);
  await db.exec("reset role");
  await db.exec(`
    insert into public.lukas_drawing_ifc_derivatives(
      project_id,source_file_id,source_sha256,version,
      schema_version,status,created_by
    ) values(
      '${ids.project}','${ids.source}','${sourceSha256}',1,
      1,'failed','${ids.actor}'
    )
  `);
  await db.exec("set role service_role");

  const [first, second] = await Promise.all([claim(db), claim(db)]);
  const claimed = [first, second].filter(Boolean);
  assert.equal(claimed.length, 1);
  assert.deepEqual(
    {
      project_id: claimed[0].project_id,
      source_file_id: claimed[0].source_file_id,
      source_storage_path: claimed[0].source_storage_path,
      source_byte_size: claimed[0].source_byte_size,
      source_sha256: claimed[0].source_sha256,
      requested_by: claimed[0].requested_by,
      derivative_version: claimed[0].derivative_version,
      attempt_count: claimed[0].attempt_count,
    },
    {
      project_id: ids.project,
      source_file_id: ids.source,
      source_storage_path: sourceStoragePath,
      source_byte_size: 1234,
      source_sha256: sourceSha256,
      requested_by: ids.actor,
      derivative_version: 2,
      attempt_count: 1,
    },
  );
  assert.match(claimed[0].lease_token, /^[0-9a-f-]{36}$/);

  await db.exec("reset role");
  const source = await db.query(`
    select storage_path,byte_size,sha256,kind,immutable
    from public.lukas_qto_files where id='${ids.source}'
  `);
  assert.deepEqual(source.rows, [
    {
      storage_path: sourceStoragePath,
      byte_size: 1234,
      sha256: sourceSha256,
      kind: "ifc",
      immutable: true,
    },
  ]);
  await db.close();
});

test("expired leases reclaim the same version and reject the stale token", async () => {
  const db = await setupDatabase();
  await db.exec("set role service_role");
  const first = await claim(db, 30);
  await db.exec("reset role");
  await db.exec(`
    update public.lukas_drawing_ifc_derivative_jobs
    set lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second'
    where id='${first.job_id}'
  `);
  await db.exec("set role service_role");
  const reclaimed = await claim(db, 30);
  assert.equal(reclaimed.job_id, first.job_id);
  assert.equal(reclaimed.derivative_version, first.derivative_version);
  assert.notEqual(reclaimed.lease_token, first.lease_token);
  assert.equal(reclaimed.attempt_count, 2);
  await assert.rejects(fail(db, first, false), /lease identity/i);
  await db.exec("reset role");
  await db.close();
});

test("retry backoff is idempotent and max attempts append one failed derivative", async () => {
  const db = await setupDatabase();
  await db.exec("set role service_role");
  let current = await claim(db);
  assert.equal(await fail(db, current, true), "retry_wait");
  assert.equal(await fail(db, current, true), "retry_wait");

  for (const expectedAttempt of [2, 3]) {
    await db.exec("reset role");
    await db.exec(`
      update public.lukas_drawing_ifc_derivative_jobs
      set next_attempt_at=pg_catalog.clock_timestamp()-interval '1 second'
      where id='${current.job_id}'
    `);
    await db.exec("set role service_role");
    current = await claim(db);
    assert.equal(current.attempt_count, expectedAttempt);
    assert.equal(current.derivative_version, 1);
    assert.equal(
      await fail(db, current, true),
      expectedAttempt === 3 ? "failed" : "retry_wait",
    );
  }
  assert.equal(await fail(db, current, true), "failed");
  await db.exec("reset role");
  const terminal = await db.query(`
    select job.status,job.attempt_count,job.last_error_code,
      job.last_error_message,derivative.status as derivative_status,
      derivative.version as derivative_version
    from public.lukas_drawing_ifc_derivative_jobs job
    join public.lukas_drawing_ifc_derivatives derivative
      on derivative.project_id=job.project_id
     and derivative.source_file_id=job.source_file_id
     and derivative.source_sha256=job.source_sha256
     and derivative.version=job.claimed_version
  `);
  assert.deepEqual(terminal.rows, [
    {
      status: "failed",
      attempt_count: 3,
      last_error_code: "converter_failed",
      last_error_message: "private parser detail",
      derivative_status: "failed",
      derivative_version: 1,
    },
  ]);
  await db.close();
});

test("non-retryable failure bounds errors without mutating source evidence", async () => {
  const db = await setupDatabase();
  await db.exec("set role service_role");
  const current = await claim(db);
  const message = `customer\n${"x".repeat(700)}`;
  const failed = await db.query(
    `select public.lukas_drawing_fail_ifc_derivative_job(
      $1,$2,$3,$4,$5,$6
    ) as state`,
    [
      current.job_id,
      current.lease_token,
      current.derivative_version,
      false,
      "BAD CODE!DROP",
      message,
    ],
  );
  assert.equal(failed.rows[0].state, "failed");
  await db.exec("reset role");
  const evidence = await db.query(`
    select job.last_error_code,
      pg_catalog.char_length(job.last_error_message)::int as message_length,
      job.last_error_message ~ '[[:cntrl:]]' as has_control,
      source.storage_path,source.byte_size,source.sha256,
      source.kind,source.immutable
    from public.lukas_drawing_ifc_derivative_jobs job
    join public.lukas_qto_files source on source.id=job.source_file_id
    where job.id='${current.job_id}'
  `);
  assert.deepEqual(evidence.rows, [
    {
      last_error_code: "bad_code_drop",
      message_length: 500,
      has_control: false,
      storage_path: sourceStoragePath,
      byte_size: 1234,
      sha256: sourceSha256,
      kind: "ifc",
      immutable: true,
    },
  ]);
  await assert.rejects(
    db.exec(`
      update public.lukas_drawing_ifc_derivatives set status='pending'
      where source_file_id='${ids.source}' and version=1
    `),
    /immutable/i,
  );
  await db.close();
});

test("completion needs the exact ready derivative and reconciles response loss", async () => {
  const db = await setupDatabase();
  await db.exec("set role service_role");
  const current = await claim(db);
  const derivativeId = "72000000-0000-4000-8000-000000000007";
  await assert.rejects(
    db.query(`select public.lukas_drawing_complete_ifc_derivative_job(
      '${current.job_id}','${current.lease_token}',1,'${derivativeId}'
    )`),
    /ready derivative/i,
  );
  await db.exec("reset role");
  const manifestSha = "d".repeat(64);
  const geometrySha = "e".repeat(64);
  const prefix = `projects/${ids.project}/ifc-derivatives/${sourceSha256}/v1`;
  await db.exec(`
    insert into public.lukas_drawing_ifc_derivatives(
      id,project_id,source_file_id,source_sha256,version,schema_version,status,
      manifest_json,manifest_storage_path,manifest_byte_size,manifest_sha256,
      geometry_storage_path,geometry_byte_size,geometry_sha256,created_by
    ) values(
      '${derivativeId}','${ids.project}','${ids.source}','${sourceSha256}',1,1,'ready',
      '{"schemaVersion":1,"source":{"fileId":"${ids.source}","sha256":"${sourceSha256}"},"geometry":{"sha256":"${geometrySha}"},"elements":[]}',
      '${prefix}/${manifestSha}.json',256,'${manifestSha}',
      '${prefix}/${geometrySha}.glb',128,'${geometrySha}','${ids.actor}'
    )
  `);
  await db.exec("set role service_role");
  assert.equal(await fail(db, current, true), "completed");
  const complete = () =>
    db.query(`select public.lukas_drawing_complete_ifc_derivative_job(
      '${current.job_id}','${current.lease_token}',1,'${derivativeId}'
    ) as state`);
  assert.equal((await complete()).rows[0].state, "completed");
  assert.equal((await complete()).rows[0].state, "completed");
  await db.exec("reset role");
  await db.close();
});

test("member status RPC returns no job secret and hides sources from outsiders", async () => {
  const db = await setupDatabase();
  await db.exec(`
    set request.jwt.claim.sub='${ids.actor}';
    set role authenticated;
  `);
  const visible = await db.query(`
    select public.lukas_drawing_ifc_derivative_job_status(
      '${ids.source}','${sourceSha256}'
    ) as status
  `);
  assert.deepEqual(Object.keys(visible.rows[0].status).sort(), [
    "attemptCount",
    "availableAt",
    "errorCode",
    "state",
    "updatedAt",
  ]);
  assert.equal(visible.rows[0].status.state, "queued");
  assert.equal(visible.rows[0].status.attemptCount, 0);
  assert.equal(JSON.stringify(visible.rows[0].status).includes("lease"), false);
  assert.equal(
    JSON.stringify(visible.rows[0].status).includes("source-uploads"),
    false,
  );
  assert.equal(
    JSON.stringify(visible.rows[0].status).includes("detail"),
    false,
  );

  const noJob = await db.query(`
    select public.lukas_drawing_ifc_derivative_job_status(
      '${ids.pdf}','${pdfSha256}'
    ) as status
  `);
  assert.equal(noJob.rows[0].status, null);
  await db.exec(`
    reset role;
    set request.jwt.claim.sub='${ids.outsider}';
    set role authenticated;
  `);
  const hidden = await db.query(`
    select public.lukas_drawing_ifc_derivative_job_status(
      '${ids.source}','${sourceSha256}'
    ) as status
  `);
  assert.equal(hidden.rows[0].status, null);
  await db.exec("reset role; set role anon");
  await assert.rejects(
    db.query(`select public.lukas_drawing_ifc_derivative_job_status(
      '${ids.source}','${sourceSha256}'
    )`),
    /permission denied/i,
  );
  await db.exec("reset role");
  await db.close();
});
