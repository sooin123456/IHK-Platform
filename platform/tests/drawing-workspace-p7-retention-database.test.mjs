import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import postgres from "postgres";

import { calculateVerifiedBoq } from "../app/lukas/lib/verified-boq.server.ts";
import {
  applyP6AuthorityFixture,
  p6Ids,
  p6LegacyInput,
  p6SeedPopulatedAuthority,
  p6SetSession,
  readP6Migration,
} from "./fixtures/drawing-workspace-p6-database-fixtures.mjs";

const migrations = new URL("../supabase/migrations/", import.meta.url);

async function migration() {
  const matches = (await readdir(migrations)).filter((name) =>
    name.endsWith("_drawing_workspace_retention_restore.sql"),
  );
  assert.equal(matches.length, 1, "exactly one Task 5 forward migration");
  return readFile(new URL(matches[0], migrations), "utf8");
}

async function exportLineageMigrations() {
  const matches = (await readdir(migrations)).filter(
    (name) =>
      name.endsWith("_drawing_export_revision_lineage.sql") ||
      name.endsWith("_drawing_export_approved_snapshot_required.sql"),
  );
  assert.equal(
    matches.length,
    2,
    "drawing export lineage and approved-snapshot migrations are present",
  );
  return Promise.all(
    matches.sort().map((name) => readFile(new URL(name, migrations), "utf8")),
  );
}

async function applyExportLineageMigrations(db) {
  for (const sql of await exportLineageMigrations()) await db.exec(sql);
}

test("retention migration replaces project deletion with guarded archive authority", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /alter table public\.lukas_qto_projects[\s\S]*archived_at/i,
  );
  assert.match(sql, /deletion_requested_at/i);
  assert.match(sql, /purge_after/i);
  assert.match(sql, /drop policy if exists "project owners delete projects"/i);
  assert.match(
    sql,
    /revoke delete on table public\.lukas_qto_projects from authenticated,service_role/i,
  );
  assert.match(sql, /before update or delete on public\.lukas_qto_projects/i);
  assert.match(sql, /lukas_qto_archive_project/i);
  assert.match(sql, /lukas_qto_request_project_deletion/i);
  assert.match(sql, /lukas_qto_list_retention_projects/i);
});

test("policy, hold, lifecycle, and restore evidence are append-only organization records", async () => {
  const sql = await migration();
  for (const table of [
    "lukas_qto_retention_policy_versions",
    "lukas_qto_retention_events",
    "lukas_qto_restore_runs",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`, "i"));
    assert.match(
      sql,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `revoke all on table public\\.${table} from anon,authenticated,service_role`,
        "i",
      ),
    );
  }
  assert.match(
    sql,
    /before update or delete on public\.lukas_qto_retention_policy_versions/i,
  );
  assert.match(
    sql,
    /before update or delete on public\.lukas_qto_retention_events/i,
  );
  assert.match(
    sql,
    /before update or delete on public\.lukas_qto_restore_runs/i,
  );
  assert.match(sql, /legal_hold_placed/i);
  assert.match(sql, /legal_hold_released/i);
  assert.match(
    sql,
    /private\.lukas_qto_organization_role\(organization_id\) is not null/i,
  );
  assert.doesNotMatch(sql, /to authenticated\s+using\s*\(\s*true\s*\)/i);
});

test("trusted purge is service-only and proves expiry, holds, and protected dependencies", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /create or replace function public\.lukas_qto_purge_project/i,
  );
  assert.match(sql, /security definer set search_path=''/i);
  assert.match(sql, /auth\.jwt\(\)->>'role'[^;]*service_role/i);
  assert.match(sql, /purge_after/i);
  assert.match(sql, /legal_hold_placed/i);
  assert.match(sql, /legal_hold_released/i);
  for (const dependency of [
    "lukas_drawing_revision_approvals",
    "lukas_drawing_quantity_links",
    "lukas_drawing_boq_links",
    "lukas_drawing_material_links",
    "lukas_drawing_library_versions",
    "lukas_qto_files",
  ])
    assert.match(sql, new RegExp(dependency, "i"));
  const protectedEvidence = sql.slice(
    sql.indexOf("v_protected:="),
    sql.indexOf("v_status:=", sql.indexOf("v_protected:=")),
  );
  assert.doesNotMatch(
    protectedEvidence,
    /immutableFiles/i,
    "ordinary immutable source bytes remain evidenced but do not create an endless hold",
  );
  assert.match(
    sql,
    /create unique index[^;]*retention_events_service_request[^;]*where actor_id is null/i,
  );
  assert.match(
    sql,
    /create unique index[^;]*retention_events_hold_release[^;]*where releases_event_id is not null/i,
  );
  assert.match(
    sql,
    /create unique index[^;]*retention_events_hold_identity[^;]*organization_id,project_id,hold_id[^;]*where event_type='legal_hold_placed'/i,
  );
  assert.match(
    sql,
    /lukas_qto_place_legal_hold[\s\S]*pg_advisory_xact_lock[\s\S]*request_sha256<>v_sha/i,
  );
  assert.match(
    sql,
    /lukas_qto_release_legal_hold[\s\S]*pg_advisory_xact_lock[\s\S]*request_sha256<>v_sha/i,
  );
  assert.match(
    sql,
    /lukas_qto_purge_project[\s\S]*pg_advisory_xact_lock[\s\S]*actor_id is null[\s\S]*request_sha256<>v_sha/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.lukas_qto_purge_project[\s\S]*to service_role/i,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.lukas_qto_purge_project[\s\S]*to authenticated/i,
  );
});

test("restore records bind provider identity, database, storage, Yjs, approval, and lineage evidence", async () => {
  const sql = await migration();
  for (const column of [
    "provider_backup_id",
    "provider_restore_project_ref",
    "provider_restore_created_at",
    "schema_sha256",
    "database_sha256",
    "storage_sha256",
    "yjs_sha256",
    "approval_sha256",
    "lineage_sha256",
    "rpo_seconds",
    "rto_seconds",
  ])
    assert.match(sql, new RegExp(`${column} `, "i"));
  assert.match(
    sql,
    /create or replace function public\.lukas_qto_record_restore_run/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.lukas_qto_record_restore_run[\s\S]*to service_role/i,
  );
});

const runtimeIds = Object.freeze({
  organization: "73000000-0000-4000-8000-000000000001",
  otherOrganization: "73000000-0000-4000-8000-000000000002",
  emptyProject: "73000000-0000-4000-8000-000000000003",
  policyRequest: "73000000-0000-4000-8000-000000000004",
  archiveRequest: "73000000-0000-4000-8000-000000000005",
  deleteRequest: "73000000-0000-4000-8000-000000000006",
  emptyDeleteRequest: "73000000-0000-4000-8000-000000000007",
  hold: "73000000-0000-4000-8000-000000000008",
  holdRequest: "73000000-0000-4000-8000-000000000009",
  releaseRequest: "73000000-0000-4000-8000-00000000000a",
  purgeHeldRequest: "73000000-0000-4000-8000-00000000000b",
  purgeRequest: "73000000-0000-4000-8000-00000000000c",
  organizationOnlyProject: "73000000-0000-4000-8000-00000000000d",
  storageProject: "73000000-0000-4000-8000-00000000000e",
  storageFile: "73000000-0000-4000-8000-00000000000f",
  storageDeleteRequest: "73000000-0000-4000-8000-000000000010",
  storageReadyRequest: "73000000-0000-4000-8000-000000000011",
  storageFinalizeRequest: "73000000-0000-4000-8000-000000000012",
  exportRequest: "73000000-0000-4000-8000-000000000013",
  restoreRequest: "73000000-0000-4000-8000-000000000014",
  restoreRehearsal: "73000000-0000-4000-8000-000000000015",
});

async function runtimeDatabase({ applyExportLineage = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await applyP6AuthorityFixture(db);
  await db.exec(await readP6Migration());
  await db.exec(`
    create table public.lukas_qto_organizations(
      id uuid primary key,name text not null,owner_id uuid not null references auth.users(id),
      is_personal boolean not null default false,created_at timestamptz not null default now()
    );
    create table public.lukas_qto_organization_members(
      organization_id uuid not null references public.lukas_qto_organizations(id),
      user_id uuid not null references auth.users(id),role text not null,
      created_at timestamptz not null default now(),primary key(organization_id,user_id)
    );
    alter table public.lukas_qto_projects add column organization_id uuid;
    create function private.lukas_qto_organization_role(p_organization_id uuid)
    returns text language sql stable security definer set search_path='' as $$
      select case when (select auth.jwt()->'app_metadata'->>'role')='hangil_staff' then 'staff'
        when o.owner_id=(select auth.uid()) then 'owner'
        else (select m.role from public.lukas_qto_organization_members m
          where m.organization_id=o.id and m.user_id=(select auth.uid())) end
      from public.lukas_qto_organizations o where o.id=p_organization_id
    $$;
    create function private.lukas_drawing_p2_canonical_snapshot(
      p_revision_id uuid,p_include_instance_lineage boolean
    ) returns jsonb language sql stable security invoker set search_path='' as $$
      select pg_catalog.jsonb_build_object(
        'schemaVersion',2,
        'revision',pg_catalog.jsonb_build_object(
          'id',r.id,'documentId',r.document_id,'projectId',r.project_id,
          'version',r.version
        ),
        'includeInstanceLineage',p_include_instance_lineage,
        'operationSequence',coalesce((
          select pg_catalog.max(s.operation_sequence)
          from public.lukas_drawing_snapshots s where s.revision_id=r.id
        ),0)
      )
      from public.lukas_drawing_revisions r where r.id=p_revision_id
    $$;
    create table public.lukas_drawing_issue_approvals(
      id uuid primary key,project_id uuid not null,decision text not null
    );
    create table public.lukas_drawing_library_versions(
      id uuid primary key,source_project_id uuid not null,status text not null
    );
    create table public.lukas_drawing_library_imports(
      id uuid primary key,project_id uuid not null
    );
    create table public.lukas_qto_download_events(
      id bigint generated always as identity primary key,
      user_id uuid not null constraint lukas_qto_download_events_user_id_fkey
        references auth.users(id) on delete cascade,
      release_version text not null,
      release_sha256 text not null,
      downloaded_at timestamptz not null default now()
    );
    grant execute on function private.lukas_qto_organization_role(uuid) to authenticated,service_role;
  `);
  await db.exec(await migration());
  if (applyExportLineage) await applyExportLineageMigrations(db);
  await p6SeedPopulatedAuthority(db, calculateVerifiedBoq(p6LegacyInput));
  await p6SetSession(db, null);
  await db.query(
    `insert into public.lukas_qto_organizations(id,name,owner_id) values
      ($1,'1HK',$2),($3,'Other',$4)`,
    [
      runtimeIds.organization,
      p6Ids.owner,
      runtimeIds.otherOrganization,
      p6Ids.otherOwner,
    ],
  );
  await db.query(
    `insert into public.lukas_qto_organization_members(organization_id,user_id,role)
      values($1,$2,'owner'),($3,$4,'owner')`,
    [
      runtimeIds.organization,
      p6Ids.owner,
      runtimeIds.otherOrganization,
      p6Ids.otherOwner,
    ],
  );
  await db.query(
    `update public.lukas_qto_projects set organization_id=case when id=$1::uuid then $2::uuid else $3::uuid end`,
    [p6Ids.project, runtimeIds.organization, runtimeIds.otherOrganization],
  );
  await db.query(
    `insert into public.lukas_qto_projects(id,owner_id,name,description,organization_id)
      values($1,$2,'Empty','purge fixture',$3),
        ($4,$5,'Organization only','not a project membership',$3)`,
    [
      runtimeIds.emptyProject,
      p6Ids.owner,
      runtimeIds.organization,
      runtimeIds.organizationOnlyProject,
      p6Ids.otherOwner,
    ],
  );
  return db;
}

async function drawingCheckpoint(db) {
  const {
    rows: [checkpoint],
  } = await db.query(
    `select
      (graph->>'operationSequence')::bigint "operationCheckpoint",
      pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(graph::text,'UTF8'),'sha256'
      ),'hex') "checkpointSha256"
    from (
      select private.lukas_drawing_p2_canonical_snapshot($1::uuid,true) graph
    ) current_checkpoint`,
    [p6Ids.revision],
  );
  return checkpoint;
}

test("PGlite archives and holds approved project evidence through exact organization RPCs", async (context) => {
  const db = await runtimeDatabase();
  context.after(() => db.close());
  await p6SetSession(db, null, p6Ids.owner);
  const { rows: organizationProjects } = await db.query(
    `select id from public.lukas_qto_list_retention_projects($1)`,
    [runtimeIds.organization],
  );
  assert.ok(
    organizationProjects.some(
      (project) => project.id === runtimeIds.organizationOnlyProject,
    ),
  );
  await db.query(
    `select (public.lukas_qto_set_retention_policy($1,0,2555,'company policy',$2)).id`,
    [runtimeIds.organization, runtimeIds.policyRequest],
  );
  await db.query(
    `select (public.lukas_qto_archive_project($1,$2,'archive approved project',$3)).id`,
    [runtimeIds.organization, p6Ids.project, runtimeIds.archiveRequest],
  );
  const {
    rows: [requested],
  } = await db.query(
    `select (public.lukas_qto_request_project_deletion($1,$2,'requested by admin',$3)).evidence as evidence`,
    [runtimeIds.organization, p6Ids.project, runtimeIds.deleteRequest],
  );
  assert.equal(requested.evidence.approvedEvidence, true);
  const {
    rows: [project],
  } = await db.query(
    `select archived_at is not null archived,deletion_requested_at is not null requested,
      purge_after>now() held from public.lukas_qto_projects where id=$1`,
    [p6Ids.project],
  );
  assert.deepEqual(project, { archived: true, requested: true, held: true });
  await assert.rejects(
    db.query(`delete from public.lukas_qto_projects where id=$1`, [
      p6Ids.project,
    ]),
    /must be archived and purged/i,
  );
  await assert.rejects(
    db.query(
      `update public.lukas_qto_retention_events set reason='changed' where project_id=$1`,
      [p6Ids.project],
    ),
    /append-only/i,
  );
  await p6SetSession(db, null, p6Ids.otherOwner);
  const {
    rows: [crossRole],
  } = await db.query(
    `select auth.uid() actor,private.lukas_qto_organization_role($1) role`,
    [runtimeIds.organization],
  );
  assert.deepEqual(crossRole, { actor: p6Ids.otherOwner, role: null });
  await assert.rejects(
    db.query(`select public.lukas_qto_archive_project($1,$2,'cross org',$3)`, [
      runtimeIds.organization,
      p6Ids.project,
      crypto.randomUUID(),
    ]),
    /authority denied/i,
  );
  await assert.rejects(
    db.query(`select * from public.lukas_qto_list_retention_projects($1)`, [
      runtimeIds.organization,
    ]),
    /authority denied/i,
  );
});

test("PGlite preserves immutable manifest until Storage deletion is proven", async (context) => {
  const db = await runtimeDatabase();
  context.after(() => db.close());
  await db.exec(`
    create schema if not exists storage;
    create table storage.objects(bucket_id text not null,name text not null);
    alter table public.lukas_qto_files drop constraint lukas_qto_files_project_id_fkey;
    alter table public.lukas_qto_files add constraint lukas_qto_files_project_id_fkey
      foreign key(project_id) references public.lukas_qto_projects(id) on delete cascade;
  `);
  await db.query(
    `insert into public.lukas_qto_projects(id,owner_id,name,description,organization_id)
      values($1,$2,'Storage purge','two phase fixture',$3)`,
    [runtimeIds.storageProject, p6Ids.owner, runtimeIds.organization],
  );
  const path = "storage-purge/source.pdf";
  const sha = "7".repeat(64);
  await db.query(
    `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,storage_path,
      original_filename,content_type,byte_size,sha256,immutable)
      values($1,$2,$3,'pdf',$4,'source.pdf','application/pdf',42,$5,true)`,
    [runtimeIds.storageFile, runtimeIds.storageProject, p6Ids.owner, path, sha],
  );
  await db.query(
    `insert into storage.objects(bucket_id,name) values('lukas-qto',$1)`,
    [path],
  );
  await p6SetSession(db, null, p6Ids.owner);
  await db.query(
    `select public.lukas_qto_set_retention_policy($1,0,2555,'storage cleanup',$2)`,
    [runtimeIds.organization, crypto.randomUUID()],
  );
  await db.query(
    `select public.lukas_qto_request_project_deletion($1,$2,'storage fixture',$3)`,
    [
      runtimeIds.organization,
      runtimeIds.storageProject,
      runtimeIds.storageDeleteRequest,
    ],
  );
  await db.exec(
    `select pg_catalog.set_config('request.jwt.claims','{"role":"service_role"}',false)`,
  );
  const {
    rows: [ready],
  } = await db.query(
    `select public.lukas_qto_purge_project($1,$2,$3,'two phase purge') result`,
    [
      runtimeIds.organization,
      runtimeIds.storageProject,
      runtimeIds.storageReadyRequest,
    ],
  );
  assert.equal(ready.result.status, "STORAGE_REQUIRED");
  assert.deepEqual(ready.result.files, [{ path, sha256: sha, byteSize: 42 }]);
  await assert.rejects(
    db.query(
      `select public.lukas_qto_finalize_project_purge($1,$2,$3,$4,$5,'storage confirmed')`,
      [
        runtimeIds.organization,
        runtimeIds.storageProject,
        ready.result.eventId,
        ready.result.manifestSha256,
        runtimeIds.storageFinalizeRequest,
      ],
    ),
    /Storage deletion is incomplete/i,
  );
  await db.query(
    `delete from storage.objects where bucket_id='lukas-qto' and name=$1`,
    [path],
  );
  const {
    rows: [purged],
  } = await db.query(
    `select public.lukas_qto_finalize_project_purge($1,$2,$3,$4,$5,'storage confirmed') result`,
    [
      runtimeIds.organization,
      runtimeIds.storageProject,
      ready.result.eventId,
      ready.result.manifestSha256,
      runtimeIds.storageFinalizeRequest,
    ],
  );
  assert.equal(purged.result.status, "PURGED");
  const {
    rows: [evidence],
  } = await db.query(
    `select evidence from public.lukas_qto_retention_events where id=$1`,
    [ready.result.eventId],
  );
  assert.deepEqual(evidence.evidence.files, [
    { path, sha256: sha, byteSize: 42 },
  ]);
});

test("PGlite export evidence is exact, idempotent, append-only, and cross-org denied", async (context) => {
  const db = await runtimeDatabase();
  context.after(() => db.close());
  const sha = "8".repeat(64);
  await p6SetSession(db, null, p6Ids.owner);
  const checkpoint = await drawingCheckpoint(db);
  const {
    rows: [first],
  } = await db.query(
    `select public.lukas_qto_record_drawing_export(
      $1,'drawing_pdf',$2,128,$3,$4,$5,$6,$7,$8)`,
    [
      p6Ids.project,
      sha,
      runtimeIds.exportRequest,
      p6Ids.document,
      p6Ids.revision,
      7,
      checkpoint.operationCheckpoint,
      checkpoint.checkpointSha256,
    ],
  );
  const {
    rows: [retry],
  } = await db.query(
    `select public.lukas_qto_record_drawing_export(
      $1,'drawing_pdf',$2,128,$3,$4,$5,$6,$7,$8)`,
    [
      p6Ids.project,
      sha,
      runtimeIds.exportRequest,
      p6Ids.document,
      p6Ids.revision,
      7,
      checkpoint.operationCheckpoint,
      checkpoint.checkpointSha256,
    ],
  );
  assert.deepEqual(retry, first);
  const {
    rows: [evidence],
  } = await db.query(
    `select workspace_id,revision_id,revision_version,operation_checkpoint,
      checkpoint_sha256,revision_snapshot_sha256,
      artifact_sha256,artifact_byte_size
      from public.lukas_qto_export_events where request_id=$1`,
    [runtimeIds.exportRequest],
  );
  const {
    rows: [{ sha256: snapshotSha256 }],
  } = await db.query(
    `select sha256 from public.lukas_drawing_snapshots
      where revision_id=$1 and revision_version=7`,
    [p6Ids.revision],
  );
  assert.deepEqual(evidence, {
    workspace_id: p6Ids.document,
    revision_id: p6Ids.revision,
    revision_version: 7,
    operation_checkpoint: checkpoint.operationCheckpoint,
    checkpoint_sha256: checkpoint.checkpointSha256,
    revision_snapshot_sha256: snapshotSha256,
    artifact_sha256: sha,
    artifact_byte_size: 128,
  });
  await assert.rejects(
    db.query(
      `select public.lukas_qto_record_drawing_export(
        $1,'drawing_pdf',$2,129,$3,$4,$5,$6,$7,$8)`,
      [
        p6Ids.project,
        sha,
        runtimeIds.exportRequest,
        p6Ids.document,
        p6Ids.revision,
        7,
        checkpoint.operationCheckpoint,
        checkpoint.checkpointSha256,
      ],
    ),
    /identity was reused/i,
  );
  await assert.rejects(
    db.query(
      `select public.lukas_qto_record_drawing_export(
        $1,'drawing_png',$2,128,$3,$4,$5,$6,$7,$8)`,
      [
        p6Ids.project,
        sha,
        crypto.randomUUID(),
        p6Ids.document,
        p6Ids.revision,
        8,
        checkpoint.operationCheckpoint,
        checkpoint.checkpointSha256,
      ],
    ),
    /drawing export lineage is invalid/i,
  );
  await assert.rejects(
    db.query(
      `select public.lukas_qto_record_drawing_export(
        $1,'drawing_svg',$2,128,$3,$4,$5,$6,$7,$8)`,
      [
        p6Ids.project,
        sha,
        crypto.randomUUID(),
        p6Ids.otherDocument,
        p6Ids.revision,
        7,
        checkpoint.operationCheckpoint,
        checkpoint.checkpointSha256,
      ],
    ),
    /drawing export lineage is invalid/i,
  );
  await assert.rejects(
    db.query(`delete from public.lukas_qto_export_events where request_id=$1`, [
      runtimeIds.exportRequest,
    ]),
    /append-only/i,
  );
  for (const artifactType of [
    "boq_template_csv",
    "suggestion_feedback_json",
    "ids_bcfzip",
  ])
    await db.query(
      `select public.lukas_qto_record_project_export($1,$2,$3,128,$4)`,
      [p6Ids.project, artifactType, sha, crypto.randomUUID()],
    );
  await p6SetSession(db, null, p6Ids.otherOwner);
  await assert.rejects(
    db.query(
      `select public.lukas_qto_record_project_export($1,'ids_bcfzip',$2,128,$3)`,
      [p6Ids.project, sha, crypto.randomUUID()],
    ),
    /authority denied/i,
  );
});

test("PGlite drawing export refuses an unapproved revision and records no receipt", async (context) => {
  const db = await runtimeDatabase();
  context.after(() => db.close());
  const requestId = crypto.randomUUID();
  const sha = "c".repeat(64);
  await p6SetSession(db, null, p6Ids.owner);
  const checkpoint = await drawingCheckpoint(db);
  await db.query(
    `delete from public.lukas_drawing_revision_approvals
      where revision_id=$1 and subject_version=7 and decision='approved'`,
    [p6Ids.revision],
  );
  await assert.rejects(
    db.query(
      `select public.lukas_qto_record_drawing_export(
        $1,'drawing_pdf',$2,64,$3,$4,$5,7,$6,$7)`,
      [
        p6Ids.project,
        sha,
        requestId,
        p6Ids.document,
        p6Ids.revision,
        checkpoint.operationCheckpoint,
        checkpoint.checkpointSha256,
      ],
    ),
    /approved snapshot is required/i,
  );
  const {
    rows: [{ count }],
  } = await db.query(
    `select count(*)::int count from public.lukas_qto_export_events
      where request_id=$1`,
    [requestId],
  );
  assert.equal(count, 0);
});

test("PGlite preserves non-drawing export idempotency across the lineage migration", async (context) => {
  const db = await runtimeDatabase({ applyExportLineage: false });
  context.after(() => db.close());
  const requestId = crypto.randomUUID();
  const sha = "9".repeat(64);
  await p6SetSession(db, null, p6Ids.owner);
  await db.query(
    `select public.lukas_qto_record_project_export($1,'ids_bcfzip',$2,64,$3)`,
    [p6Ids.project, sha, requestId],
  );
  await applyExportLineageMigrations(db);
  await db.query(
    `select public.lukas_qto_record_project_export($1,'ids_bcfzip',$2,64,$3)`,
    [p6Ids.project, sha, requestId],
  );
  const {
    rows: [{ count }],
  } = await db.query(
    `select count(*)::int count from public.lukas_qto_export_events
      where request_id=$1`,
    [requestId],
  );
  assert.equal(count, 1);
});

test("PGlite preserves a pre-migration five-field drawing retry through v2", async (context) => {
  const db = await runtimeDatabase({ applyExportLineage: false });
  context.after(() => db.close());
  const requestId = crypto.randomUUID();
  const sha = "7".repeat(64);
  await p6SetSession(db, null, p6Ids.owner);
  await db.query(
    `select public.lukas_qto_record_project_export(
      $1,'drawing_svg',$2,64,$3)`,
    [p6Ids.project, sha, requestId],
  );
  await applyExportLineageMigrations(db);
  const checkpoint = await drawingCheckpoint(db);
  await db.query(
    `select public.lukas_qto_record_drawing_export(
      $1,'drawing_svg',$2,64,$3,$4,$5,7,$6,$7)`,
    [
      p6Ids.project,
      sha,
      requestId,
      p6Ids.document,
      p6Ids.revision,
      checkpoint.operationCheckpoint,
      checkpoint.checkpointSha256,
    ],
  );
  const {
    rows: [evidence],
  } = await db.query(
    `select count(*)::int count,
      pg_catalog.bool_or(workspace_id is not null) has_lineage
      from public.lukas_qto_export_events where request_id=$1`,
    [requestId],
  );
  assert.deepEqual(evidence, { count: 1, has_lineage: false });
});

test("PGlite drawing v2 rejects anonymous authenticated owners and stale checkpoints", async (context) => {
  const db = await runtimeDatabase();
  context.after(() => db.close());
  const sha = "6".repeat(64);
  await p6SetSession(db, null, p6Ids.owner);
  const checkpoint = await drawingCheckpoint(db);
  await p6SetSession(db, "authenticated", p6Ids.owner, { anonymous: true });
  await assert.rejects(
    db.query(
      `select public.lukas_qto_record_drawing_export(
        $1,'drawing_pdf',$2,64,$3,$4,$5,7,$6,$7)`,
      [
        p6Ids.project,
        sha,
        crypto.randomUUID(),
        p6Ids.document,
        p6Ids.revision,
        checkpoint.operationCheckpoint,
        checkpoint.checkpointSha256,
      ],
    ),
    /authority denied/i,
  );
  await p6SetSession(db, null, p6Ids.owner);
  for (const stale of [
    {
      operationCheckpoint: checkpoint.operationCheckpoint + 1,
      checkpointSha256: checkpoint.checkpointSha256,
    },
    {
      operationCheckpoint: checkpoint.operationCheckpoint,
      checkpointSha256: "5".repeat(64),
    },
    {
      operationCheckpoint: checkpoint.operationCheckpoint,
      checkpointSha256: null,
    },
  ])
    await assert.rejects(
      db.query(
        `select public.lukas_qto_record_drawing_export(
          $1,'drawing_png',$2,64,$3,$4,$5,7,$6,$7)`,
        [
          p6Ids.project,
          sha,
          crypto.randomUUID(),
          p6Ids.document,
          p6Ids.revision,
          stale.operationCheckpoint,
          stale.checkpointSha256,
        ],
      ),
      /drawing export (?:checkpoint|evidence) is invalid/i,
    );
});

test("PGlite retries an existing version-fixed export after the live revision advances", async (context) => {
  const db = await runtimeDatabase();
  context.after(() => db.close());
  const requestId = crypto.randomUUID();
  const sha = "a".repeat(64);
  await p6SetSession(db, null, p6Ids.owner);
  const checkpoint = await drawingCheckpoint(db);
  await db.query(
    `select public.lukas_qto_record_drawing_export(
      $1,'drawing_svg',$2,64,$3,$4,$5,7,$6,$7)`,
    [
      p6Ids.project,
      sha,
      requestId,
      p6Ids.document,
      p6Ids.revision,
      checkpoint.operationCheckpoint,
      checkpoint.checkpointSha256,
    ],
  );
  await db.exec(`
    alter table public.lukas_drawing_revisions disable trigger user;
    update public.lukas_drawing_revisions set version=8
      where id='${p6Ids.revision}'::uuid;
    alter table public.lukas_drawing_revisions enable trigger user;
  `);
  await db.query(
    `select public.lukas_qto_record_drawing_export(
      $1,'drawing_svg',$2,64,$3,$4,$5,7,$6,$7)`,
    [
      p6Ids.project,
      sha,
      requestId,
      p6Ids.document,
      p6Ids.revision,
      checkpoint.operationCheckpoint,
      checkpoint.checkpointSha256,
    ],
  );
  const {
    rows: [{ count, revision_version: revisionVersion }],
  } = await db.query(
    `select count(*)::int count,max(revision_version)::int revision_version
      from public.lukas_qto_export_events where request_id=$1`,
    [requestId],
  );
  assert.equal(count, 1);
  assert.equal(revisionVersion, 7);
});

test("PGlite preserves Revit download evidence as append-only after Task 5", async (context) => {
  const db = await runtimeDatabase();
  context.after(() => db.close());
  await p6SetSession(db, null, p6Ids.owner);
  await assert.rejects(
    db.query(
      `select public.lukas_qto_record_revit_download(null,'2026.8.28',$1)`,
      ["A".repeat(64)],
    ),
    /service authority/i,
  );
  await db.exec(
    `select pg_catalog.set_config('request.jwt.claims','{"role":"service_role"}',false)`,
  );
  await db.query(
    `select public.lukas_qto_record_revit_download(null,'2026.8.28',$1)`,
    ["A".repeat(64)],
  );
  await db.query(
    `insert into public.lukas_qto_download_events(user_id,release_version,release_sha256)
      values($1,'2026.8.28',$2)`,
    [p6Ids.owner, "A".repeat(64)],
  );
  await assert.rejects(
    db.exec(
      `update public.lukas_qto_download_events set release_version='changed'`,
    ),
    /append-only/i,
  );
  await assert.rejects(
    db.exec(`delete from public.lukas_qto_download_events`),
    /append-only/i,
  );
  const {
    rows: [{ nullable, delete_action: deleteAction }],
  } = await db.query(`
    select not a.attnotnull nullable,con.confdeltype delete_action
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class c on c.oid=con.conrelid
    join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attname='user_id'
    where c.relname='lukas_qto_download_events'
      and con.conname='lukas_qto_download_events_user_id_fkey'
  `);
  assert.equal(nullable, true);
  assert.equal(deleteAction, "n");
  const {
    rows: [{ count: anonymousCount }],
  } = await db.query(
    `select count(*)::int count from public.lukas_qto_download_events
      where user_id is null`,
  );
  assert.equal(anonymousCount, 1);
});

test("PGlite restore recording retries one request and permits a new rehearsal", async (context) => {
  const db = await runtimeDatabase();
  context.after(() => db.close());
  await db.exec(
    `select pg_catalog.set_config('request.jwt.claims','{"role":"service_role"}',false)`,
  );
  const args = [
    runtimeIds.organization,
    "a".repeat(20),
    "backup-one",
    "2026-08-28T01:00:00Z",
    "b".repeat(20),
    "2026-08-28T01:05:00Z",
    "c".repeat(40),
    ...Array.from({ length: 7 }, (_, index) => String(index + 1).repeat(64)),
    300,
    600,
    "PASS",
  ];
  const call = (requestId, status = args[16]) =>
    db.query(
      `select (public.lukas_qto_record_restore_run(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)).id id`,
      [...args.slice(0, 16), status, requestId],
    );
  const {
    rows: [first],
  } = await call(runtimeIds.restoreRequest);
  const {
    rows: [retry],
  } = await call(runtimeIds.restoreRequest);
  assert.deepEqual(retry, first);
  await assert.rejects(
    call(runtimeIds.restoreRequest, "NOT MET"),
    /identity was reused/i,
  );
  const {
    rows: [rehearsal],
  } = await call(runtimeIds.restoreRehearsal);
  assert.notEqual(rehearsal.id, first.id);
});

test("PGlite legal hold blocks trusted purge until release and empty dependency proof", async (context) => {
  const db = await runtimeDatabase();
  context.after(() => db.close());
  await p6SetSession(db, null, p6Ids.owner);
  await db.query(
    `select public.lukas_qto_set_retention_policy($1,0,2555,'immediate empty cleanup',$2)`,
    [runtimeIds.organization, runtimeIds.policyRequest],
  );
  await db.query(
    `select public.lukas_qto_request_project_deletion($1,$2,'empty fixture',$3)`,
    [
      runtimeIds.organization,
      runtimeIds.emptyProject,
      runtimeIds.emptyDeleteRequest,
    ],
  );
  const {
    rows: [firstHold],
  } = await db.query(
    `select public.lukas_qto_place_legal_hold($1,$2,$3,'investigation',$4)`,
    [
      runtimeIds.organization,
      runtimeIds.emptyProject,
      runtimeIds.hold,
      runtimeIds.holdRequest,
    ],
  );
  const {
    rows: [retriedHold],
  } = await db.query(
    `select public.lukas_qto_place_legal_hold($1,$2,$3,'investigation',$4)`,
    [
      runtimeIds.organization,
      runtimeIds.emptyProject,
      runtimeIds.hold,
      runtimeIds.holdRequest,
    ],
  );
  assert.deepEqual(retriedHold, firstHold);
  await assert.rejects(
    db.query(
      `select public.lukas_qto_place_legal_hold($1,$2,$3,'different request',$4)`,
      [
        runtimeIds.organization,
        runtimeIds.emptyProject,
        runtimeIds.hold,
        crypto.randomUUID(),
      ],
    ),
  );
  const {
    rows: [{ count: placedCount }],
  } = await db.query(
    `select count(*)::int count from public.lukas_qto_retention_events
      where organization_id=$1 and project_id=$2 and hold_id=$3
        and event_type='legal_hold_placed'`,
    [runtimeIds.organization, runtimeIds.emptyProject, runtimeIds.hold],
  );
  assert.equal(placedCount, 1);
  const {
    rows: [{ id: placedEventId }],
  } = await db.query(
    `select id
       from public.lukas_qto_retention_events
      where request_id = $1`,
    [runtimeIds.holdRequest],
  );
  await db.query(
    `insert into public.lukas_qto_retention_events(organization_id,project_id,
      event_type,request_id,request_sha256,reason,evidence,actor_id,created_at)
      select $1,$2,'purge_denied',gen_random_uuid(),repeat('a',64),'feed filler',
        '{"status":"retention_not_expired"}'::jsonb,$3,
        now()+pg_catalog.make_interval(secs=>g)
      from generate_series(1,101) g`,
    [runtimeIds.organization, runtimeIds.emptyProject, p6Ids.owner],
  );
  const { rows: feed } = await db.query(
    `select id from public.lukas_qto_retention_events
      where organization_id=$1 order by created_at desc,id desc limit 100`,
    [runtimeIds.organization],
  );
  assert.equal(
    feed.some((event) => event.id === placedEventId),
    false,
  );
  const { rows: activeHolds } = await db.query(
    `select id from public.lukas_qto_list_active_legal_holds($1)`,
    [runtimeIds.organization],
  );
  assert.equal(
    activeHolds.some((event) => event.id === placedEventId),
    true,
  );
  await assert.rejects(
    db.query(
      `select public.lukas_qto_place_legal_hold($1,$2,$3,'different',$4)`,
      [
        runtimeIds.organization,
        runtimeIds.emptyProject,
        runtimeIds.hold,
        runtimeIds.holdRequest,
      ],
    ),
    /identity was reused/i,
  );
  await db.exec(
    `select pg_catalog.set_config('request.jwt.claims','{"role":"service_role"}',false)`,
  );
  const {
    rows: [held],
  } = await db.query(
    `select public.lukas_qto_purge_project($1,$2,$3,'scheduled purge') result`,
    [
      runtimeIds.organization,
      runtimeIds.emptyProject,
      runtimeIds.purgeHeldRequest,
    ],
  );
  assert.equal(held.result.reason, "legal_hold_active");
  const {
    rows: [heldRetry],
  } = await db.query(
    `select public.lukas_qto_purge_project($1,$2,$3,'scheduled purge') result`,
    [
      runtimeIds.organization,
      runtimeIds.emptyProject,
      runtimeIds.purgeHeldRequest,
    ],
  );
  assert.deepEqual(heldRetry.result, held.result);
  await assert.rejects(
    db.query(
      `select public.lukas_qto_purge_project($1,$2,$3,'different purge')`,
      [
        runtimeIds.organization,
        runtimeIds.emptyProject,
        runtimeIds.purgeHeldRequest,
      ],
    ),
    /identity was reused/i,
  );
  await p6SetSession(db, null, p6Ids.owner);
  const {
    rows: [firstRelease],
  } = await db.query(
    `select public.lukas_qto_release_legal_hold($1,$2,$3,'hold cleared',$4)`,
    [
      runtimeIds.organization,
      runtimeIds.emptyProject,
      runtimeIds.hold,
      runtimeIds.releaseRequest,
    ],
  );
  const {
    rows: [retriedRelease],
  } = await db.query(
    `select public.lukas_qto_release_legal_hold($1,$2,$3,'hold cleared',$4)`,
    [
      runtimeIds.organization,
      runtimeIds.emptyProject,
      runtimeIds.hold,
      runtimeIds.releaseRequest,
    ],
  );
  assert.deepEqual(retriedRelease, firstRelease);
  await db.exec(
    `select pg_catalog.set_config('request.jwt.claims','{"role":"service_role"}',false)`,
  );
  const {
    rows: [purged],
  } = await db.query(
    `select public.lukas_qto_purge_project($1,$2,$3,'scheduled purge') result`,
    [runtimeIds.organization, runtimeIds.emptyProject, runtimeIds.purgeRequest],
  );
  assert.equal(purged.result.status, "PURGED");
  const {
    rows: [purgedRetry],
  } = await db.query(
    `select public.lukas_qto_purge_project($1,$2,$3,'scheduled purge') result`,
    [runtimeIds.organization, runtimeIds.emptyProject, runtimeIds.purgeRequest],
  );
  assert.deepEqual(purgedRetry.result, purged.result);
  const {
    rows: [remaining],
  } = await db.query(
    `select count(*)::int count from public.lukas_qto_projects where id=$1`,
    [runtimeIds.emptyProject],
  );
  assert.equal(remaining.count, 0);
});

const realPostgresUrl = process.env.P7_REAL_POSTGRES_DATABASE_URL;
const realPostgresRequired = process.env.P7_REAL_POSTGRES_REQUIRED === "1";

if (!realPostgresUrl) {
  test(
    "real PostgreSQL proves retention RLS, grants, and invoker guards",
    { skip: !realPostgresRequired },
    () => assert.fail("P7_REAL_POSTGRES_DATABASE_URL is required"),
  );
} else {
  test("real PostgreSQL proves retention RLS, grants, and invoker guards", async () => {
    const sql = postgres(realPostgresUrl, { max: 1, prepare: false });
    try {
      const tables = await sql`
        select c.relname,c.relrowsecurity,
          pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') can_select,
          pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT') can_insert,
          pg_catalog.has_table_privilege('authenticated',c.oid,'UPDATE') can_update,
          pg_catalog.has_table_privilege('authenticated',c.oid,'DELETE') can_delete
        from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname in (
          'lukas_qto_retention_policy_versions','lukas_qto_retention_events',
          'lukas_qto_restore_runs','lukas_qto_export_events') order by c.relname`;
      assert.equal(tables.length, 4);
      for (const row of tables) {
        assert.equal(row.relrowsecurity, true, row.relname);
        assert.equal(row.can_select, true, row.relname);
        assert.equal(row.can_insert, false, row.relname);
        assert.equal(row.can_update, false, row.relname);
        assert.equal(row.can_delete, false, row.relname);
      }
      const [project] = await sql`
        select pg_catalog.has_table_privilege(
          'authenticated','public.lukas_qto_projects','DELETE') can_delete`;
      assert.equal(project.can_delete, false);
      const [downloadEvents] = await sql`
        select
          pg_catalog.has_table_privilege('authenticated',
            'public.lukas_qto_download_events','INSERT') authenticated_insert,
          pg_catalog.has_table_privilege('service_role',
            'public.lukas_qto_download_events','INSERT') service_insert,
          pg_catalog.has_table_privilege('service_role',
            'public.lukas_qto_download_events','UPDATE') service_update,
          pg_catalog.has_table_privilege('service_role',
            'public.lukas_qto_download_events','DELETE') service_delete`;
      assert.deepEqual(downloadEvents, {
        authenticated_insert: false,
        service_insert: false,
        service_update: false,
        service_delete: false,
      });
      const [functions] = await sql`
        select
          pg_catalog.has_function_privilege('authenticated',
            'public.lukas_qto_purge_project(uuid,uuid,uuid,text)','EXECUTE') authenticated_purge,
          pg_catalog.has_function_privilege('service_role',
            'public.lukas_qto_purge_project(uuid,uuid,uuid,text)','EXECUTE') service_purge,
          pg_catalog.has_function_privilege('authenticated',
            'public.lukas_qto_record_restore_run(uuid,text,text,timestamptz,text,timestamptz,text,text,text,text,text,text,text,text,bigint,bigint,text,uuid)','EXECUTE') authenticated_restore,
          pg_catalog.has_function_privilege('service_role',
            'public.lukas_qto_record_restore_run(uuid,text,text,timestamptz,text,timestamptz,text,text,text,text,text,text,text,text,bigint,bigint,text,uuid)','EXECUTE') service_restore`;
      assert.deepEqual(functions, {
        authenticated_purge: false,
        service_purge: true,
        authenticated_restore: false,
        service_restore: true,
      });
      const triggers = await sql`
        select p.prosecdef security_definer from pg_catalog.pg_trigger t
        join pg_catalog.pg_proc p on p.oid=t.tgfoid
        where t.tgname in('lukas_qto_retention_policy_versions_append_only',
          'lukas_qto_retention_events_append_only','lukas_qto_restore_runs_append_only',
          'lukas_qto_export_events_append_only','lukas_qto_download_events_append_only',
          'lukas_qto_projects_retention_guard')`;
      assert.equal(triggers.length, 6);
      for (const trigger of triggers)
        assert.equal(trigger.security_definer, false);

      const [scope] = await sql`
        select p.id project_id,p.organization_id,o.owner_id
        from public.lukas_qto_projects p
        join public.lukas_qto_organizations o on o.id=p.organization_id
        order by p.created_at,p.id limit 1`;
      assert.ok(
        scope,
        "real PostgreSQL execution gate needs one retained project",
      );
      const outsider = crypto.randomUUID();
      const claims = (role, sub) =>
        JSON.stringify({ role, sub, is_anonymous: false, app_metadata: {} });
      const asRole = (role, jwt, operation) =>
        sql.begin(async (transaction) => {
          await transaction.unsafe(`set local role ${role}`);
          await transaction`select pg_catalog.set_config('request.jwt.claims',${jwt},true)`;
          return operation(transaction);
        });
      const hidden = await asRole(
        "authenticated",
        claims("authenticated", outsider),
        (transaction) => transaction`
          select id from public.lukas_qto_projects where id=${scope.project_id}`,
      );
      assert.equal(
        hidden.length,
        0,
        "cross-org project SELECT must be hidden by RLS",
      );
      await assert.rejects(
        asRole(
          "authenticated",
          claims("authenticated", outsider),
          (transaction) =>
            transaction`select * from public.lukas_qto_list_retention_projects(${scope.organization_id})`,
        ),
        /authority denied/i,
      );
      await assert.rejects(
        asRole(
          "authenticated",
          claims("authenticated", scope.owner_id),
          (transaction) => transaction`
            delete from public.lukas_qto_projects where id=${scope.project_id}`,
        ),
        /permission denied|must be archived and purged/i,
      );
      await assert.rejects(
        asRole(
          "service_role",
          claims("service_role", outsider),
          (transaction) => transaction`
            select public.lukas_qto_purge_project(
              ${crypto.randomUUID()},${scope.project_id},${crypto.randomUUID()},'cross org execution gate')`,
        ),
        /target is unavailable/i,
      );
    } finally {
      await sql.end();
    }
  });
}
