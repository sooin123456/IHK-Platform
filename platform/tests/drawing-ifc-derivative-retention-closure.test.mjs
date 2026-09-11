import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrations = new URL("../supabase/migrations/", import.meta.url);

const ids = Object.freeze({
  actor: "7a000000-0000-4000-8000-000000000001",
  organization: "7a000000-0000-4000-8000-000000000002",
  project: "7a000000-0000-4000-8000-000000000003",
  source: "7a000000-0000-4000-8000-000000000004",
  document: "7a000000-0000-4000-8000-000000000005",
  revision: "7a000000-0000-4000-8000-000000000006",
  deletionEvent: "7a000000-0000-4000-8000-000000000007",
  purgeRequest: "7a000000-0000-4000-8000-000000000008",
  finalizeRequest: "7a000000-0000-4000-8000-000000000009",
  secondSource: "7a000000-0000-4000-8000-00000000000a",
});
const sourceSha256 = "a".repeat(64);
const manifestSha256 = "d".repeat(64);
const geometrySha256 = "e".repeat(64);
const sourcePath = `projects/${ids.project}/uploads/model.ifc`;
const prefix = `projects/${ids.project}/ifc-derivatives/${sourceSha256}/v1`;
const manifestPath = `${prefix}/${manifestSha256}.json`;
const geometryPath = `${prefix}/${geometrySha256}.glb`;

async function retentionClosureMigration() {
  const matches = (await readdir(migrations)).filter((name) =>
    name.endsWith("_drawing_ifc_derivative_retention_closure.sql"),
  );
  assert.equal(matches.length, 1, "one forward migration owns IFC retention");
  return readFile(new URL(matches[0], migrations), "utf8");
}

async function oneMigration(suffix) {
  const matches = (await readdir(migrations)).filter((name) =>
    name.endsWith(suffix),
  );
  assert.equal(matches.length, 1, `one migration owns ${suffix}`);
  return readFile(new URL(matches[0], migrations), "utf8");
}

async function runtimeDatabase() {
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
        'role',coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')
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
  ]) {
    await db.exec(await oneMigration(suffix));
  }
  await db.exec(await retentionClosureMigration());
  await db.exec(`
    insert into public.lukas_qto_files(
      id,project_id,uploaded_by,kind,storage_path,original_filename,
      content_type,byte_size,sha256,immutable
    ) values(
      '${ids.source}','${ids.project}','${ids.actor}','ifc','${sourcePath}',
      'model.ifc','application/x-step',1234,'${sourceSha256}',true
    );
  `);
  return db;
}

async function claimAndPublishReady(db) {
  await db.exec("set role service_role");
  const claim = (
    await db.query(
      "select * from public.lukas_drawing_claim_ifc_derivative_job(300)",
    )
  ).rows[0];
  const manifest = {
    schemaVersion: 1,
    source: { fileId: ids.source, sha256: sourceSha256 },
    geometry: { sha256: geometrySha256 },
    elements: [],
  };
  const published = await db.query(
    `select public.lukas_drawing_publish_leased_ifc_derivative_ready(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
    ) as id`,
    [
      claim.job_id,
      claim.lease_token,
      ids.project,
      ids.source,
      sourceSha256,
      claim.derivative_version,
      manifest,
      manifestPath,
      256,
      manifestSha256,
      geometryPath,
      128,
      geometrySha256,
      ids.actor,
    ],
  );
  const derivativeId = published.rows[0].id;
  const completed = await db.query(
    `select public.lukas_drawing_complete_ifc_derivative_job(
      $1,$2,$3,$4
    ) as state`,
    [claim.job_id, claim.lease_token, claim.derivative_version, derivativeId],
  );
  assert.equal(completed.rows[0].state, "completed");
  await db.exec("reset role");
  return { claim, derivativeId, manifest };
}

async function makeDeletionEligible(db) {
  await db.exec(`
    insert into public.lukas_qto_retention_events(
      id,organization_id,project_id,event_type,request_id,request_sha256,
      purge_after,reason,actor_id
    ) values(
      '${ids.deletionEvent}','${ids.organization}','${ids.project}',
      'deletion_requested','${ids.deletionEvent}','${"f".repeat(64)}',
      pg_catalog.clock_timestamp()-interval '1 day','delete','${ids.actor}'
    );
  `);
}

async function preparePurge(db, requestId = ids.purgeRequest) {
  await db.exec("set role service_role");
  const result = await db.query(
    `select public.lukas_qto_purge_project($1,$2,$3,$4) as result`,
    [ids.organization, ids.project, requestId, "retention purge"],
  );
  await db.exec("reset role");
  return result.rows[0].result;
}

function functionDefinition(sql, qualifiedName) {
  const start = sql.indexOf(`function ${qualifiedName}`);
  assert.notEqual(start, -1, `missing ${qualifiedName}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated ${qualifiedName}`);
  return sql.slice(start, end + 4);
}

function assertExactRetentionDeleteGuard(definition) {
  assert.match(definition, /tg_op\s*=\s*'DELETE'/i);
  assert.match(definition, /pg_catalog\.pg_trigger_depth\(\)\s*>\s*1/i);
  assert.match(definition, /'app\.lukas_retention_purge_project'\s*,\s*true/i);
  assert.match(definition, /=\s*old\.project_id::text/i);
  assert.match(
    definition,
    /current_user\s*=\s*pg_catalog\.pg_get_userbyid\([\s\S]*?tg_relid[\s\S]*?\)/i,
  );
  assert.match(
    definition,
    /not exists\s*\([\s\S]*?from public\.lukas_qto_projects[\s\S]*?old\.project_id[\s\S]*?\)/i,
  );
  assert.match(definition, /then\s+return old/i);
}

test("IFC retention migration keeps one canonical artifact manifest and project-first locks", async () => {
  const sql = await retentionClosureMigration();
  const files = functionDefinition(
    sql,
    "private.lukas_qto_project_retention_storage_files",
  );
  assert.match(files, /from public\.lukas_qto_files/i);
  assert.match(
    files,
    /manifest_storage_path[\s\S]*manifest_sha256[\s\S]*manifest_byte_size/i,
  );
  assert.match(
    files,
    /geometry_storage_path[\s\S]*geometry_sha256[\s\S]*geometry_byte_size/i,
  );
  assert.match(files, /status\s*=\s*'ready'/i);

  for (const name of [
    "public.lukas_qto_purge_project",
    "public.lukas_qto_finalize_project_purge",
    "public.lukas_drawing_publish_ifc_derivative_ready",
    "public.lukas_drawing_complete_ifc_derivative_job",
    "public.lukas_drawing_fail_ifc_derivative_job",
  ]) {
    const definition = functionDefinition(sql, name);
    const projectLock = definition.search(
      /from public\.lukas_qto_projects[\s\S]*?for update/i,
    );
    const jobLock = definition.search(
      /from public\.lukas_drawing_ifc_derivative_jobs[\s\S]*?for update/i,
    );
    assert.ok(projectLock >= 0, `${name} must lock the project`);
    assert.ok(
      jobLock > projectLock,
      `${name} must lock jobs after the project`,
    );
  }
  const claim = functionDefinition(
    sql,
    "public.lukas_drawing_claim_ifc_derivative_job",
  );
  const claimProjectLock = claim.search(
    /from public\.lukas_qto_projects[\s\S]*?for update/i,
  );
  const claimJobLock = claim.search(/for update skip locked/i);
  assert.ok(claimProjectLock >= 0, "claim must lock the project");
  assert.ok(
    claimJobLock > claimProjectLock,
    "claim must lock its job after the project",
  );
  assert.match(
    claim,
    /where\s*\(\s*\([\s\S]*?status in \('queued','retry_wait'\)[\s\S]*?\)\s*or\s*\([\s\S]*?status='processing'[\s\S]*?\)\s*\)\s*and not exists/i,
    "purge-ready filtering must cover queued and processing candidates",
  );
  assert.match(
    sql,
    /event_type\s*=\s*'purge_storage_ready'[\s\S]*IFC derivative publication is blocked/i,
  );
  const leasedPublish = functionDefinition(
    sql,
    "public.lukas_drawing_publish_leased_ifc_derivative_ready",
  );
  const leasedProjectLock = leasedPublish.search(
    /from public\.lukas_qto_projects[\s\S]*?for update/i,
  );
  const leasedJobLock = leasedPublish.search(
    /from public\.lukas_drawing_ifc_derivative_jobs[\s\S]*?for update/i,
  );
  assert.ok(leasedProjectLock >= 0);
  assert.ok(leasedJobLock > leasedProjectLock);
  assert.match(leasedPublish, /lease_token is distinct from p_lease_token/i);
  assert.match(
    leasedPublish,
    /lease_expires_at[\s\S]*pg_catalog\.clock_timestamp\(\)/i,
  );
  assert.match(leasedPublish, /v_job\.status\s*<>\s*'processing'/i);
  const compatibilityPublish = functionDefinition(
    sql,
    "public.lukas_drawing_publish_ifc_derivative_ready",
  );
  assert.doesNotMatch(
    compatibilityPublish,
    /insert into public\.lukas_drawing_ifc_derivatives/i,
    "the tokenless compatibility RPC must be replay-only",
  );
  assert.doesNotMatch(
    sql,
    /drop function public\.lukas_qto_(?:purge_project|finalize_project_purge)/i,
  );
});

test("every IFC evidence delete guard requires the exact trusted nested purge cascade", async () => {
  const sql = await retentionClosureMigration();
  for (const name of [
    "private.lukas_drawing_revision_ifc_derivative_immutable_guard",
    "private.lukas_drawing_ifc_derivative_immutable_guard",
    "private.lukas_drawing_ifc_source_retention_delete_guard",
    "private.lukas_drawing_ifc_derivative_job_retention_delete_guard",
  ]) {
    assertExactRetentionDeleteGuard(functionDefinition(sql, name));
  }
  assert.match(
    sql,
    /lukas_drawing_revision_ifc_derivatives_project_fkey[\s\S]*on delete cascade/i,
  );
  assert.match(
    sql,
    /lukas_drawing_ifc_derivatives_project_id_fkey[\s\S]*on delete cascade/i,
  );
  assert.doesNotMatch(sql, /disable trigger|drop trigger/i);
});

test("IFC purge guard mutation checks reject every weakened conjunction", async () => {
  const sql = await retentionClosureMigration();
  const guard = functionDefinition(
    sql,
    "private.lukas_drawing_ifc_derivative_job_retention_delete_guard",
  );
  const mutations = [
    guard.replace(/tg_op\s*=\s*'DELETE'/i, "tg_op='UPDATE'"),
    guard.replace(/pg_catalog\.pg_trigger_depth\(\)\s*>\s*1/i, "true"),
    guard.replace(
      /app\.lukas_retention_purge_project/i,
      "app.lukas_retention_purge_project_other",
    ),
    guard.replace(/=\s*old\.project_id::text/i, "<>old.project_id::text"),
    guard.replace(
      /current_user\s*=\s*pg_catalog\.pg_get_userbyid\([\s\S]*?tg_relid[\s\S]*?\)/i,
      "current_user=current_user",
    ),
    guard.replace(/not exists\s*\(/i, "exists("),
  ];
  for (const [index, weakened] of mutations.entries()) {
    assert.notEqual(weakened, guard, "mutation must alter the guard");
    assert.throws(
      () => assertExactRetentionDeleteGuard(weakened),
      `mutation ${index} must weaken a required predicate`,
    );
  }
});

test("PGlite purge manifests source and ready IFC bytes, rejects prefix orphans, then cascades all evidence", async () => {
  const db = await runtimeDatabase();
  const { derivativeId } = await claimAndPublishReady(db);
  const bindingId = "7a000000-0000-4000-8000-00000000000b";
  await db.exec(`
    insert into public.lukas_drawing_documents(id,project_id,source_file_id)
    values('${ids.document}','${ids.project}','${ids.source}');
    insert into public.lukas_drawing_revisions(
      id,document_id,project_id,status,version
    ) values('${ids.revision}','${ids.document}','${ids.project}','draft',1);
    insert into public.lukas_drawing_revision_ifc_derivatives(
      id,revision_id,revision_version,project_id,source_file_id,source_sha256,
      derivative_id,derivative_version,manifest_sha256,geometry_sha256,created_by
    ) values(
      '${bindingId}','${ids.revision}',1,'${ids.project}','${ids.source}',
      '${sourceSha256}','${derivativeId}',1,'${manifestSha256}',
      '${geometrySha256}','${ids.actor}'
    );
    insert into storage.objects(bucket_id,name) values
      ('lukas-qto','${sourcePath}'),
      ('lukas-qto','${manifestPath}'),
      ('lukas-qto','${geometryPath}'),
      ('lukas-qto','projects/${ids.project}/ifc-derivatives/partial/orphan.glb');
  `);
  await makeDeletionEligible(db);

  const ready = await preparePurge(db);
  assert.equal(ready.status, "STORAGE_REQUIRED");
  assert.deepEqual(ready.files, [
    { path: manifestPath, sha256: manifestSha256, byteSize: 256 },
    { path: geometryPath, sha256: geometrySha256, byteSize: 128 },
    { path: sourcePath, sha256: sourceSha256, byteSize: 1234 },
  ]);
  assert.match(ready.manifestSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(await preparePurge(db), ready, "prepare remains idempotent");

  await db.exec("set role service_role");
  const finalize = () =>
    db.query(
      `select public.lukas_qto_finalize_project_purge(
        $1,$2,$3,$4,$5,$6
      ) as result`,
      [
        ids.organization,
        ids.project,
        ready.eventId,
        ready.manifestSha256,
        ids.finalizeRequest,
        "storage confirmed",
      ],
    );
  await db.exec("reset role");
  await db.exec(`
    insert into public.lukas_qto_files(
      id,project_id,uploaded_by,kind,storage_path,original_filename,
      byte_size,sha256,immutable
    ) values(
      '${ids.secondSource}','${ids.project}','${ids.actor}','other',
      'projects/${ids.project}/uploads/late.txt','late.txt',12,
      '${"c".repeat(64)}',true
    )
  `);
  await db.exec("set role service_role");
  await assert.rejects(finalize(), /storage manifest changed/i);
  await db.exec("reset role");
  await db.exec(
    `delete from public.lukas_qto_files where id='${ids.secondSource}'`,
  );
  await db.exec("set role service_role");
  await assert.rejects(finalize(), /Storage deletion is incomplete/i);
  await db.exec("reset role");
  for (const file of ready.files) {
    await db.query(
      "delete from storage.objects where bucket_id='lukas-qto' and name=$1",
      [file.path],
    );
  }
  await db.exec("set role service_role");
  await assert.rejects(
    finalize(),
    /IFC derivative Storage deletion is incomplete/i,
  );
  await db.exec("reset role");
  await db.exec(`
    delete from storage.objects
    where bucket_id='lukas-qto'
      and name='projects/${ids.project}/ifc-derivatives/partial/orphan.glb'
  `);
  await db.exec("set role service_role");
  const purged = await finalize();
  assert.equal(purged.rows[0].result.status, "PURGED");
  const replay = await finalize();
  assert.deepEqual(replay.rows[0].result, purged.rows[0].result);
  await db.exec("reset role");

  const remaining = await db.query(`
    select
      (select count(*)::int from public.lukas_qto_projects
        where id='${ids.project}') projects,
      (select count(*)::int from public.lukas_qto_files
        where project_id='${ids.project}') files,
      (select count(*)::int from public.lukas_drawing_ifc_derivative_jobs
        where project_id='${ids.project}') jobs,
      (select count(*)::int from public.lukas_drawing_ifc_derivatives
        where project_id='${ids.project}') derivatives,
      (select count(*)::int from public.lukas_drawing_revision_ifc_derivatives
        where project_id='${ids.project}') bindings
  `);
  assert.deepEqual(remaining.rows, [
    { projects: 0, files: 0, jobs: 0, derivatives: 0, bindings: 0 },
  ]);
  await db.close();
});

test("PGlite active jobs hold purge and every ordinary IFC evidence delete stays denied", async () => {
  const db = await runtimeDatabase();
  await makeDeletionEligible(db);
  const held = await preparePurge(db);
  assert.equal(held.status, "HELD");
  assert.equal(held.reason, "active_ifc_derivative_jobs");
  const events = await db.query(`
    select event_type,evidence->>'activeIfcDerivativeJobs' active_jobs
    from public.lukas_qto_retention_events
    where request_id='${ids.purgeRequest}'
  `);
  assert.deepEqual(events.rows, [
    { event_type: "purge_denied", active_jobs: "1" },
  ]);

  await assert.rejects(
    db.exec(
      `delete from public.lukas_drawing_ifc_derivative_jobs where project_id='${ids.project}'`,
    ),
    /only be deleted by project retention purge/i,
  );
  await assert.rejects(
    db.exec(`delete from public.lukas_qto_files where id='${ids.source}'`),
    /only be deleted by project retention purge/i,
  );
  const remaining = await db.query(`
    select
      (select count(*)::int from public.lukas_qto_files
        where id='${ids.source}') files,
      (select count(*)::int from public.lukas_drawing_ifc_derivative_jobs
        where project_id='${ids.project}') jobs
  `);
  assert.deepEqual(remaining.rows, [{ files: 1, jobs: 1 }]);
  await db.close();
});

test("PGlite purge-ready blocks new IFC bytes and new publication while preserving response-loss idempotency", async () => {
  const db = await runtimeDatabase();
  const { claim, derivativeId, manifest } = await claimAndPublishReady(db);
  await makeDeletionEligible(db);
  const ready = await preparePurge(db);
  assert.equal(ready.status, "STORAGE_REQUIRED");

  await db.exec("set role service_role");
  const publish = (nextManifest, nextGeometryPath, nextGeometrySha) =>
    db.query(
      `select public.lukas_drawing_publish_ifc_derivative_ready(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
      ) as id`,
      [
        ids.project,
        ids.source,
        sourceSha256,
        1,
        nextManifest,
        manifestPath,
        256,
        manifestSha256,
        nextGeometryPath,
        128,
        nextGeometrySha,
        ids.actor,
      ],
    );
  assert.equal(
    (await publish(manifest, geometryPath, geometrySha256)).rows[0].id,
    derivativeId,
    "exact publication replay stays idempotent",
  );
  await assert.rejects(
    publish(
      { ...manifest, geometry: { sha256: "c".repeat(64) } },
      `${prefix}/${"c".repeat(64)}.glb`,
      "c".repeat(64),
    ),
    /publication is blocked by project purge/i,
  );
  const complete = () =>
    db.query(
      `select public.lukas_drawing_complete_ifc_derivative_job(
        $1,$2,$3,$4
      ) as state`,
      [claim.job_id, claim.lease_token, 1, derivativeId],
    );
  assert.equal(
    (await complete()).rows[0].state,
    "completed",
    "completed response replay stays idempotent",
  );
  await db.exec("reset role");

  await assert.rejects(
    db.exec(`
      insert into public.lukas_qto_files(
        id,project_id,uploaded_by,kind,storage_path,original_filename,
        byte_size,sha256,immutable
      ) values(
        '${ids.secondSource}','${ids.project}','${ids.actor}','ifc',
        'projects/${ids.project}/uploads/late.ifc','late.ifc',22,
        '${"b".repeat(64)}',true
      )
    `),
    /enqueue is blocked by project purge/i,
  );
  const noLateRows = await db.query(`
    select
      (select count(*)::int from public.lukas_qto_files
        where id='${ids.secondSource}') files,
      (select count(*)::int from public.lukas_drawing_ifc_derivative_jobs
        where source_file_id='${ids.secondSource}') jobs,
      (select count(*)::int from public.lukas_drawing_ifc_derivatives
        where project_id='${ids.project}') derivatives
  `);
  assert.deepEqual(noLateRows.rows, [{ files: 0, jobs: 0, derivatives: 1 }]);

  await db.exec(`
    update public.lukas_drawing_ifc_derivative_jobs
    set status='queued',attempt_count=0,claimed_version=null,
      lease_token=null,lease_expires_at=null,last_error_code=null,
      last_error_message=null
    where id='${claim.job_id}'
  `);
  await db.exec("set role service_role");
  const noClaim = await db.query(
    "select * from public.lukas_drawing_claim_ifc_derivative_job(300)",
  );
  assert.deepEqual(
    noClaim.rows,
    [],
    "purge-ready projects cannot be reclaimed",
  );
  assert.equal(
    (await publish(manifest, geometryPath, geometrySha256)).rows[0].id,
    derivativeId,
    "exact publication replay does not depend on mutable queue state",
  );
  await db.exec("reset role");
  await db.exec(`
    update public.lukas_drawing_ifc_derivative_jobs
    set status='processing',attempt_count=1,claimed_version=1,
      lease_token='${claim.lease_token}',
      lease_expires_at=pg_catalog.clock_timestamp()+interval '5 minutes',
      last_error_code=null,last_error_message=null
    where id='${claim.job_id}'
  `);
  await db.exec("set role service_role");
  await assert.rejects(complete(), /completion is blocked by project purge/i);
  await assert.rejects(
    db.query(
      `select public.lukas_drawing_fail_ifc_derivative_job(
        $1,$2,$3,false,'late_failure','late failure'
      )`,
      [claim.job_id, claim.lease_token, 1],
    ),
    /failure is blocked by project purge/i,
  );
  await db.exec("reset role");

  await assert.rejects(
    db.exec(
      `update public.lukas_drawing_ifc_derivatives set status='failed' where id='${derivativeId}'`,
    ),
    /immutable/i,
  );
  await assert.rejects(
    db.exec(
      `delete from public.lukas_drawing_ifc_derivatives where id='${derivativeId}'`,
    ),
    /immutable/i,
  );
  await db.close();
});

test("PGlite retains existing retention and IFC RPC signatures and grants", async () => {
  const db = await runtimeDatabase();
  const signatures = await db.query(`
    select
      pg_catalog.to_regprocedure(
        'public.lukas_qto_purge_project(uuid,uuid,uuid,text)'
      ) is not null purge_signature,
      pg_catalog.to_regprocedure(
        'public.lukas_qto_finalize_project_purge(uuid,uuid,uuid,text,uuid,text)'
      ) is not null finalize_signature,
      pg_catalog.to_regprocedure(
        'public.lukas_drawing_publish_ifc_derivative_ready(uuid,uuid,text,bigint,jsonb,text,bigint,text,text,bigint,text,uuid)'
      ) is not null publish_signature,
      pg_catalog.to_regprocedure(
        'public.lukas_drawing_complete_ifc_derivative_job(uuid,uuid,bigint,uuid)'
      ) is not null complete_signature,
      pg_catalog.to_regprocedure(
        'public.lukas_drawing_publish_leased_ifc_derivative_ready(uuid,uuid,uuid,uuid,text,bigint,jsonb,text,bigint,text,text,bigint,text,uuid)'
      ) is not null leased_publish_signature,
      pg_catalog.has_function_privilege(
        'authenticated','public.lukas_qto_purge_project(uuid,uuid,uuid,text)','EXECUTE'
      ) authenticated_purge,
      pg_catalog.has_function_privilege(
        'service_role','public.lukas_qto_purge_project(uuid,uuid,uuid,text)','EXECUTE'
      ) service_purge,
      pg_catalog.has_function_privilege(
        'authenticated','public.lukas_drawing_publish_ifc_derivative_ready(uuid,uuid,text,bigint,jsonb,text,bigint,text,text,bigint,text,uuid)','EXECUTE'
      ) authenticated_publish,
      pg_catalog.has_function_privilege(
        'service_role','public.lukas_drawing_publish_ifc_derivative_ready(uuid,uuid,text,bigint,jsonb,text,bigint,text,text,bigint,text,uuid)','EXECUTE'
      ) service_publish,
      pg_catalog.has_function_privilege(
        'authenticated','public.lukas_drawing_publish_leased_ifc_derivative_ready(uuid,uuid,uuid,uuid,text,bigint,jsonb,text,bigint,text,text,bigint,text,uuid)','EXECUTE'
      ) authenticated_leased_publish,
      pg_catalog.has_function_privilege(
        'service_role','public.lukas_drawing_publish_leased_ifc_derivative_ready(uuid,uuid,uuid,uuid,text,bigint,jsonb,text,bigint,text,text,bigint,text,uuid)','EXECUTE'
      ) service_leased_publish
  `);
  assert.deepEqual(signatures.rows, [
    {
      purge_signature: true,
      finalize_signature: true,
      publish_signature: true,
      complete_signature: true,
      leased_publish_signature: true,
      authenticated_purge: false,
      service_purge: true,
      authenticated_publish: false,
      service_publish: true,
      authenticated_leased_publish: false,
      service_leased_publish: true,
    },
  ]);
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query(
      `select public.lukas_qto_purge_project(
        '${ids.organization}','${ids.project}','${ids.purgeRequest}','denied'
      )`,
    ),
    /permission denied/i,
  );
  await db.exec("reset role");
  await db.close();
});

test("PGlite replacement fail RPC preserves retry backoff and terminal evidence", async () => {
  const db = await runtimeDatabase();
  await db.exec("set role service_role");
  const first = (
    await db.query(
      "select * from public.lukas_drawing_claim_ifc_derivative_job(300)",
    )
  ).rows[0];
  const fail = (claim, retryable) =>
    db.query(
      `select public.lukas_drawing_fail_ifc_derivative_job(
        $1,$2,$3,$4,'converter_failed',E'private\\nerror'
      ) as state`,
      [claim.job_id, claim.lease_token, claim.derivative_version, retryable],
    );
  assert.equal((await fail(first, true)).rows[0].state, "retry_wait");
  assert.equal(
    (await fail(first, true)).rows[0].state,
    "retry_wait",
    "fail replay stays idempotent",
  );
  await db.exec("reset role");
  await db.exec(`
    update public.lukas_drawing_ifc_derivative_jobs
    set next_attempt_at=pg_catalog.clock_timestamp()-interval '1 second'
    where id='${first.job_id}'
  `);
  await db.exec("set role service_role");
  const second = (
    await db.query(
      "select * from public.lukas_drawing_claim_ifc_derivative_job(300)",
    )
  ).rows[0];
  assert.equal(second.attempt_count, 2);
  assert.equal(second.derivative_version, first.derivative_version);
  assert.equal((await fail(second, false)).rows[0].state, "failed");
  await db.exec("reset role");
  const terminal = await db.query(`
    select job.status,job.last_error_code,job.last_error_message,
      derivative.status derivative_status
    from public.lukas_drawing_ifc_derivative_jobs job
    join public.lukas_drawing_ifc_derivatives derivative
      on derivative.project_id=job.project_id
     and derivative.source_file_id=job.source_file_id
     and derivative.version=job.claimed_version
    where job.id='${first.job_id}'
  `);
  assert.deepEqual(terminal.rows, [
    {
      status: "failed",
      last_error_code: "converter_failed",
      last_error_message: "private error",
      derivative_status: "failed",
    },
  ]);
  await db.close();
});

test("PGlite replacement claim RPC bounds a final expired lease", async () => {
  const db = await runtimeDatabase();
  await db.exec("set role service_role");
  let current = (
    await db.query(
      "select * from public.lukas_drawing_claim_ifc_derivative_job(30)",
    )
  ).rows[0];
  for (const nextAttempt of [2, 3]) {
    await db.exec("reset role");
    await db.exec(`
      update public.lukas_drawing_ifc_derivative_jobs
      set lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second'
      where id='${current.job_id}'
    `);
    await db.exec("set role service_role");
    current = (
      await db.query(
        "select * from public.lukas_drawing_claim_ifc_derivative_job(30)",
      )
    ).rows[0];
    assert.equal(current.attempt_count, nextAttempt);
    assert.equal(current.derivative_version, 1);
  }
  await db.exec("reset role");
  await db.exec(`
    update public.lukas_drawing_ifc_derivative_jobs
    set lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second'
    where id='${current.job_id}'
  `);
  await db.exec("set role service_role");
  const none = await db.query(
    "select * from public.lukas_drawing_claim_ifc_derivative_job(30)",
  );
  assert.deepEqual(none.rows, []);
  await db.exec("reset role");
  const bounded = await db.query(`
    select job.status,job.attempt_count,derivative.status derivative_status
    from public.lukas_drawing_ifc_derivative_jobs job
    join public.lukas_drawing_ifc_derivatives derivative
      on derivative.project_id=job.project_id
     and derivative.source_file_id=job.source_file_id
     and derivative.version=job.claimed_version
    where job.id='${current.job_id}'
  `);
  assert.deepEqual(bounded.rows, [
    { status: "failed", attempt_count: 3, derivative_status: "failed" },
  ]);
  await db.close();
});

test("PGlite leased publication rejects stale and expired worker identities", async () => {
  const db = await runtimeDatabase();
  await db.exec("set role service_role");
  const claim = (
    await db.query(
      "select * from public.lukas_drawing_claim_ifc_derivative_job(300)",
    )
  ).rows[0];
  const manifest = {
    schemaVersion: 1,
    source: { fileId: ids.source, sha256: sourceSha256 },
    geometry: { sha256: geometrySha256 },
    elements: [],
  };
  const publish = (leaseToken) =>
    db.query(
      `select public.lukas_drawing_publish_leased_ifc_derivative_ready(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
      ) as id`,
      [
        claim.job_id,
        leaseToken,
        ids.project,
        ids.source,
        sourceSha256,
        1,
        manifest,
        manifestPath,
        256,
        manifestSha256,
        geometryPath,
        128,
        geometrySha256,
        ids.actor,
      ],
    );
  await assert.rejects(
    publish("7a000000-0000-4000-8000-0000000000ff"),
    /lease identity is stale/i,
  );
  await db.exec("reset role");
  assert.equal(
    (
      await db.query(
        "select count(*)::int count from public.lukas_drawing_ifc_derivatives",
      )
    ).rows[0].count,
    0,
  );
  await db.exec(`
    update public.lukas_drawing_ifc_derivative_jobs
    set lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second'
    where id='${claim.job_id}'
  `);
  await db.exec("set role service_role");
  await assert.rejects(publish(claim.lease_token), /lease identity is stale/i);
  await db.exec("reset role");
  await db.exec(`
    update public.lukas_drawing_ifc_derivative_jobs
    set lease_expires_at=pg_catalog.clock_timestamp()+interval '5 minutes'
    where id='${claim.job_id}'
  `);
  await db.exec("set role service_role");
  const ready = await publish(claim.lease_token);
  assert.match(ready.rows[0].id, /^[0-9a-f-]{36}$/);
  await db.exec("reset role");
  await db.close();
});
