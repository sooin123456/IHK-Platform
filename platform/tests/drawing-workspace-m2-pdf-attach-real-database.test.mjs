import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const databaseUrl =
  process.env.M2_PDF_ATTACH_REAL_POSTGRES_DATABASE_URL ??
  process.env.M1_REAL_POSTGRES_DATABASE_URL;
const required = process.env.M2_PDF_ATTACH_REAL_POSTGRES_REQUIRED === "1";
const roles = Object.freeze([
  "anon",
  "authenticated",
  "service_role",
  "lukas_drawing_collaboration",
]);
const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrationSuffix =
  "_drawing_workspace_m2_pdf_primary_attach_authority.sql";

function quoteIdentifier(value) {
  assert.match(value, /^[a-z][a-z0-9_]{0,62}$/);
  return `"${value}"`;
}

function isolatedUrl(source, databaseName) {
  const url = new URL(source);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function migrationEntries() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const matches = names.filter((name) => name.endsWith(migrationSuffix));
  assert.equal(matches.length, 1, "exactly one M2 PDF attach migration");
  return { names, m2Name: matches[0] };
}

async function bootstrapDatabase(sql, { includeM2 = true } = {}) {
  await sql.unsafe(`
    create publication supabase_realtime;
    create schema auth;
    create schema extensions;
    create schema private;
    create schema storage;
    create extension pgcrypto with schema extensions;
    alter default privileges in schema public
      grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public
      grant all on sequences to anon,authenticated,service_role;
    alter default privileges in schema public
      grant all on functions to anon,authenticated,service_role;
    create table auth.users(
      id uuid primary key,
      email text,
      email_confirmed_at timestamptz,
      is_anonymous boolean not null default false,
      raw_app_meta_data jsonb not null default '{}'::jsonb,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable set search_path='' as $$
      select (nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable set search_path='' as $$
      select coalesce(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
    $$;
    create table storage.buckets(
      id text primary key,name text not null,public boolean not null default false,
      file_size_limit bigint,allowed_mime_types text[]
    );
    create table storage.objects(
      id uuid primary key default extensions.gen_random_uuid(),
      bucket_id text not null references storage.buckets(id),name text not null
    );
    create function storage.foldername(text) returns text[] language sql immutable as $$
      select pg_catalog.string_to_array($1,'/')
    $$;
    grant usage on schema auth,storage to anon,authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt(),storage.foldername(text)
      to anon,authenticated,service_role;
  `);
  const { names, m2Name } = await migrationEntries();
  for (const name of names) {
    if (!includeM2 && name === m2Name) continue;
    await sql.unsafe(
      await readFile(new URL(name, migrationsDirectory), "utf8"),
    );
  }
}

async function session(sql, role, actorId, callback) {
  assert.ok(["authenticated", "service_role"].includes(role));
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${quoteIdentifier(role)}`);
    await tx`select pg_catalog.set_config(
      'request.jwt.claims',${JSON.stringify({
        role,
        sub: actorId,
        is_anonymous: false,
        app_metadata: {},
      })},true
    )`;
    return callback(tx);
  });
}

async function assertSqlState(promise, code, message) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    if (message) assert.match(error.message, message);
    return true;
  });
}

async function seedUsersAndProject(sql) {
  const ownerId = randomUUID();
  const editorId = randomUUID();
  await sql`
    insert into auth.users(id,email,email_confirmed_at,is_anonymous)
    values
      (${ownerId}::uuid,'owner@example.com',clock_timestamp(),false),
      (${editorId}::uuid,'editor@example.com',clock_timestamp(),false)
  `;
  const [project] = await session(
    sql,
    "authenticated",
    ownerId,
    (tx) => tx`
    insert into public.lukas_qto_projects(
      owner_id,name,description,contact_name,contact_phone,workflow_status
    ) values(
      ${ownerId}::uuid,'M2 PDF real PostgreSQL','','','',
      'inquiry_received'
    ) returning id
  `,
  );
  await sql`
    insert into public.lukas_qto_project_members(project_id,user_id,role)
    values(${project.id}::uuid,${editorId}::uuid,'estimator')
  `;
  return { ownerId, editorId, projectId: project.id };
}

async function insertPdf(sql, projectId, actorId, { storagePath } = {}) {
  const id = randomUUID();
  const sha256 = id.replaceAll("-", "").padEnd(64, "0").slice(0, 64);
  const resolvedStoragePath =
    storagePath ?? `${actorId}/${projectId}/source-uploads/${id}`;
  await sql`
    insert into public.lukas_qto_files(
      id,project_id,uploaded_by,kind,storage_path,original_filename,
      content_type,byte_size,sha256,immutable
    ) values(
      ${id}::uuid,${projectId}::uuid,${actorId}::uuid,'pdf',
      ${resolvedStoragePath},${`${id}.pdf`},
      'application/pdf',17,${sha256},true
    )
  `;
  await sql`
    insert into storage.objects(id,bucket_id,name)
    values(${randomUUID()}::uuid,'lukas-qto',${resolvedStoragePath})
  `;
  return { id, sha256, storagePath: resolvedStoragePath };
}

async function createDocument(sql, actorId, projectId, title) {
  const requestId = randomUUID();
  const [row] = await session(
    sql,
    "authenticated",
    actorId,
    (tx) => tx`
    select public.lukas_drawing_create_document_idempotent(
      ${projectId}::uuid,null::uuid,${title},true,${requestId}::uuid,null::uuid
    ) value
  `,
  );
  return row.value;
}

async function attach(sql, actorId, document, fileId, requestId) {
  const [row] = await session(
    sql,
    "authenticated",
    actorId,
    (tx) => tx`
    select public.lukas_drawing_attach_source(
      ${document.documentId}::uuid,${document.revisionId}::uuid,
      ${document.canvasId}::uuid,${fileId}::uuid,${requestId}::uuid
    ) value
  `,
  );
  return row.value;
}

async function applyCanvasBackground(
  sql,
  actorId,
  document,
  background,
  { historyAction = null, originalOperationId = null } = {},
) {
  const [current] = await sql`
    select private.lukas_drawing_structure_entity_json(
      'canvas',${document.canvasId}::uuid,${document.revisionId}::uuid,
      d.project_id
    ) entity
    from public.lukas_drawing_documents d
    where d.id=${document.documentId}::uuid
  `;
  const before = current.entity;
  const after = { ...before, background };
  return session(
    sql,
    "authenticated",
    actorId,
    (tx) => tx`
      select public.lukas_drawing_apply_operation(
        ${document.revisionId}::uuid,${randomUUID()}::uuid,
        'mutate_structure',
        ${tx.json({ [document.canvasId]: before.version })}::jsonb,
        ${tx.json({
          type: "mutate_structure",
          actions: [
            {
              kind: "put_canvas",
              entity: after,
              baseVersion: before.version,
            },
          ],
        })}::jsonb,
        ${tx.json({
          type: "mutate_structure",
          actions: [
            {
              kind: "put_canvas",
              entity: before,
              baseVersion: before.version + 1,
            },
          ],
        })}::jsonb,
        ${historyAction}::text,${originalOperationId}::uuid
      ) value
    `,
  );
}

async function ensureRoles(admin) {
  const state = [];
  const [{ current_user: currentUser }] = await admin`select current_user`;
  for (const role of roles) {
    const item = { role, created: false, granted: false };
    state.push(item);
    const [existing] = await admin`
      select exists(
        select 1 from pg_catalog.pg_roles where rolname=${role}
      ) present
    `;
    if (!existing.present) {
      await admin.unsafe(
        `create role ${quoteIdentifier(role)} nologin${
          role === "service_role" ? " bypassrls" : ""
        }`,
      );
      item.created = true;
    }
    const [membership] = await admin`
      select pg_catalog.pg_has_role(${currentUser},${role},'MEMBER') member
    `;
    if (!membership.member) {
      await admin.unsafe(
        `grant ${quoteIdentifier(role)} to ${quoteIdentifier(currentUser)}`,
      );
      item.granted = true;
    }
  }
  return state;
}

test(
  "M2 PDF attach real PostgreSQL gate is configured",
  { skip: !required || Boolean(databaseUrl) },
  () => assert.fail("M2_PDF_ATTACH_REAL_POSTGRES_DATABASE_URL is required"),
);

test(
  "M2 PDF attach real PostgreSQL proves migrations, locks, privileges, and preflight",
  {
    skip: databaseUrl
      ? false
      : "M2 PDF attach real PostgreSQL gate is UNEXECUTED",
    timeout: 180_000,
  },
  async () => {
    const { default: postgres } = await import("postgres");
    const suffix = `${process.pid}_${randomBytes(5).toString("hex")}`;
    const databaseNames = [`m2_attach_${suffix}`, `m2_preflight_${suffix}`];
    const admin = postgres(databaseUrl, { max: 1, prepare: false });
    const clients = [];
    let roleState = [];
    let primaryError;
    const cleanupErrors = [];
    const cleanup = async (label, operation) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(
          new Error(`M2 cleanup failed: ${label}`, { cause: error }),
        );
      }
    };
    const open = (databaseName) => {
      const client = postgres(isolatedUrl(databaseUrl, databaseName), {
        max: 1,
        prepare: false,
      });
      clients.push(client);
      return client;
    };

    try {
      roleState = await ensureRoles(admin);
      for (const name of databaseNames)
        await admin.unsafe(`create database ${quoteIdentifier(name)}`);

      const owner = open(databaseNames[0]);
      const workerA = open(databaseNames[0]);
      const workerB = open(databaseNames[0]);
      await bootstrapDatabase(owner);
      const fixture = await seedUsersAndProject(owner);
      const primaryFile = await insertPdf(
        owner,
        fixture.projectId,
        fixture.ownerId,
      );
      const secondFile = await insertPdf(
        owner,
        fixture.projectId,
        fixture.ownerId,
      );
      const contestedFile = await insertPdf(
        owner,
        fixture.projectId,
        fixture.ownerId,
      );
      const legacyFile = await insertPdf(
        owner,
        fixture.projectId,
        fixture.ownerId,
        {
          storagePath: `${fixture.ownerId}/${fixture.projectId}/legacy/${randomUUID()}`,
        },
      );
      const document = await createDocument(
        owner,
        fixture.editorId,
        fixture.projectId,
        "Real PostgreSQL attach",
      );
      const requestId = randomUUID();
      const [fileBefore] = await owner`
        select sha256,immutable from public.lukas_qto_files
        where id=${primaryFile.id}::uuid
      `;

      const [first, retry] = await Promise.all([
        attach(workerA, fixture.editorId, document, primaryFile.id, requestId),
        attach(workerB, fixture.editorId, document, primaryFile.id, requestId),
      ]);
      assert.deepEqual(retry, first);
      assert.deepEqual(Object.keys(first).sort(), [
        "canvasId",
        "documentId",
        "documentUpdatedAt",
        "operationId",
        "operationSequence",
        "resultVersions",
        "revisionId",
        "sourceFileId",
        "sourceSha256",
      ]);
      assert.equal(first.sourceSha256, primaryFile.sha256);

      const [authority] = await owner`
        select
          d.source_file_id "documentFile",
          d.source_sha256 "documentSha",
          c.background_source_file_id "canvasFile",
          c.background_source_sha256 "canvasSha",
          c.background_pdf_page "pdfPage",
          c.version::integer "canvasVersion",
          (select pg_catalog.count(*)::integer
           from public.lukas_drawing_operations o
           where o.revision_id=${document.revisionId}::uuid
             and o.client_operation_id=${requestId}::uuid) operations,
          (select pg_catalog.count(*)::integer
           from private.lukas_drawing_source_attach_requests l
           where l.actor_id=${fixture.editorId}::uuid
             and l.client_request_id=${requestId}::uuid) ledger
        from public.lukas_drawing_documents d
        join public.lukas_drawing_canvases c
          on c.id=${document.canvasId}::uuid
        where d.id=${document.documentId}::uuid
      `;
      assert.deepEqual(authority, {
        documentFile: primaryFile.id,
        documentSha: primaryFile.sha256,
        canvasFile: primaryFile.id,
        canvasSha: primaryFile.sha256,
        pdfPage: 1,
        canvasVersion: 2,
        operations: 1,
        ledger: 1,
      });
      const [fileAfter] = await owner`
        select sha256,immutable from public.lukas_qto_files
        where id=${primaryFile.id}::uuid
      `;
      assert.deepEqual(fileAfter, fileBefore);
      await assertSqlState(
        attach(workerA, fixture.editorId, document, secondFile.id, requestId),
        "P1C01",
        /request ID does not match/i,
      );
      await session(
        owner,
        "authenticated",
        fixture.editorId,
        (tx) => tx`
        update public.lukas_drawing_documents set title='Renamed after attach'
        where id=${document.documentId}::uuid
      `,
      );
      await assertSqlState(
        session(
          owner,
          "authenticated",
          fixture.editorId,
          (tx) => tx`
          update public.lukas_drawing_documents
          set source_file_id=null,source_sha256=null
          where id=${document.documentId}::uuid
        `,
        ),
        "P1C01",
        /source identity is immutable/i,
      );
      await assertSqlState(
        applyCanvasBackground(owner, fixture.editorId, document, null, {
          historyAction: "undo",
          originalOperationId: requestId,
        }),
        "P1C01",
        /canvas source identity is immutable/i,
      );
      const operationTarget = await createDocument(
        owner,
        fixture.editorId,
        fixture.projectId,
        "Generic operation attach denied",
      );
      await assertSqlState(
        applyCanvasBackground(owner, fixture.editorId, operationTarget, {
          sourceFileId: secondFile.id,
          sourceSha256: secondFile.sha256,
          pdfPageNumber: 1,
          calibration: null,
        }),
        "P1C01",
        /canvas source identity is immutable/i,
      );
      const [operationPreserved] = await owner`
        select
          d.source_file_id "documentFile",
          c.background_source_file_id "canvasFile",
          c.version::integer "canvasVersion"
        from public.lukas_drawing_documents d
        join public.lukas_drawing_canvases c
          on c.id=${operationTarget.canvasId}::uuid
        where d.id=${operationTarget.documentId}::uuid
      `;
      assert.deepEqual(operationPreserved, {
        documentFile: null,
        canvasFile: null,
        canvasVersion: 1,
      });

      const legacyTarget = await createDocument(
        owner,
        fixture.ownerId,
        fixture.projectId,
        "Legacy immutable storage",
      );
      await owner.unsafe(
        "grant select,update,delete on storage.objects to authenticated",
      );
      await owner.unsafe("alter table storage.objects enable row level security");
      const beforeAttachDelete = await session(
        owner,
        "authenticated",
        fixture.ownerId,
        (tx) => tx`
          delete from storage.objects
          where bucket_id='lukas-qto' and name=${legacyFile.storagePath}
          returning id
        `,
      );
      assert.equal(beforeAttachDelete.length, 0);
      await attach(
        owner,
        fixture.ownerId,
        legacyTarget,
        legacyFile.id,
        randomUUID(),
      );
      const afterAttachDelete = await session(
        owner,
        "authenticated",
        fixture.ownerId,
        (tx) => tx`
          delete from storage.objects
          where bucket_id='lukas-qto' and name=${legacyFile.storagePath}
          returning id
        `,
      );
      assert.equal(afterAttachDelete.length, 0);
      const [legacyBytes] = await owner`
        select pg_catalog.count(*)::integer count
        from storage.objects
        where bucket_id='lukas-qto' and name=${legacyFile.storagePath}
      `;
      assert.equal(legacyBytes.count, 1);

      const raceA = await createDocument(
        owner,
        fixture.ownerId,
        fixture.projectId,
        "Source race A",
      );
      const raceB = await createDocument(
        owner,
        fixture.ownerId,
        fixture.projectId,
        "Source race B",
      );
      const race = await Promise.allSettled([
        attach(workerA, fixture.ownerId, raceA, contestedFile.id, randomUUID()),
        attach(workerB, fixture.ownerId, raceB, contestedFile.id, randomUUID()),
      ]);
      assert.equal(
        race.filter((item) => item.status === "fulfilled").length,
        1,
      );
      const rejected = race.find((item) => item.status === "rejected");
      assert.equal(rejected.reason.code, "P1C01");

      const [boundary] = await owner`
        select
          pg_catalog.has_function_privilege(
            'authenticated',
            'public.lukas_drawing_attach_source(uuid,uuid,uuid,uuid,uuid)',
            'execute'
          ) "authenticatedPublic",
          pg_catalog.has_function_privilege(
            'service_role',
            'public.lukas_drawing_attach_source(uuid,uuid,uuid,uuid,uuid)',
            'execute'
          ) "servicePublic",
          pg_catalog.has_function_privilege(
            'anon',
            'public.lukas_drawing_attach_source(uuid,uuid,uuid,uuid,uuid)',
            'execute'
          ) "anonPublic",
          pg_catalog.has_function_privilege(
            'authenticated',
            'private.lukas_drawing_attach_source(uuid,uuid,uuid,uuid,uuid)',
            'execute'
          ) "authenticatedPrivate",
          pg_catalog.has_function_privilege(
            'authenticated',
            'private.lukas_drawing_storage_object_is_immutable_pdf(text,text)',
            'execute'
          ) "authenticatedStorageGuard",
          pg_catalog.has_function_privilege(
            'anon',
            'private.lukas_drawing_storage_object_is_immutable_pdf(text,text)',
            'execute'
          ) "anonStorageGuard",
          pg_catalog.has_table_privilege(
            'authenticated',
            'private.lukas_drawing_source_attach_requests',
            'select,insert,update,delete'
          ) "authenticatedLedger",
          pg_catalog.has_table_privilege(
            'authenticated',
            'private.lukas_drawing_source_attach_leases',
            'select,insert,update,delete'
          ) "authenticatedLease",
          exists(
            select 1 from pg_catalog.pg_publication_tables
            where pubname='supabase_realtime' and schemaname='public'
              and tablename='lukas_drawing_documents'
          ) "documentsRealtime"
      `;
      assert.deepEqual(boundary, {
        authenticatedPublic: true,
        servicePublic: true,
        anonPublic: false,
        authenticatedPrivate: false,
        authenticatedStorageGuard: true,
        anonStorageGuard: false,
        authenticatedLedger: false,
        authenticatedLease: false,
        documentsRealtime: true,
      });

      const preflight = open(databaseNames[1]);
      await bootstrapDatabase(preflight, { includeM2: false });
      const inconsistent = await seedUsersAndProject(preflight);
      const preflightFile = await insertPdf(
        preflight,
        inconsistent.projectId,
        inconsistent.ownerId,
      );
      const preflightDocument = await createDocument(
        preflight,
        inconsistent.ownerId,
        inconsistent.projectId,
        "Preflight evidence",
      );
      await preflight.unsafe(
        "alter table public.lukas_drawing_canvases disable trigger user",
      );
      await preflight`
        update public.lukas_drawing_canvases set
          background_source_file_id=${preflightFile.id}::uuid,
          background_source_sha256=${preflightFile.sha256},
          background_pdf_page=1
        where id=${preflightDocument.canvasId}::uuid
      `;
      await preflight.unsafe(
        "alter table public.lukas_drawing_canvases enable trigger user",
      );
      const { m2Name } = await migrationEntries();
      const m2Sql = await readFile(
        new URL(m2Name, migrationsDirectory),
        "utf8",
      );
      await assertSqlState(
        preflight.unsafe(m2Sql),
        "P1C01",
        /Drawing source attach preflight failed/i,
      );
      await preflight.unsafe("rollback");
      const [preserved] = await preflight`
        select d.source_file_id "documentFile",
          c.background_source_file_id "canvasFile",
          c.background_source_sha256 "canvasSha"
        from public.lukas_drawing_documents d
        join public.lukas_drawing_canvases c
          on c.id=${preflightDocument.canvasId}::uuid
        where d.id=${preflightDocument.documentId}::uuid
      `;
      assert.deepEqual(preserved, {
        documentFile: null,
        canvasFile: preflightFile.id,
        canvasSha: preflightFile.sha256,
      });
    } catch (error) {
      primaryError = error;
    } finally {
      for (const client of clients)
        await cleanup("database connection", () => client.end({ timeout: 5 }));
      for (const name of databaseNames) {
        await cleanup(
          `terminate ${name}`,
          () => admin`
          select pg_catalog.pg_terminate_backend(pid)
          from pg_catalog.pg_stat_activity
          where datname=${name} and pid<>pg_catalog.pg_backend_pid()
        `,
        );
        await cleanup(`drop ${name}`, () =>
          admin.unsafe(`drop database if exists ${quoteIdentifier(name)}`),
        );
      }
      for (const state of roleState.reverse()) {
        if (state.granted)
          await cleanup(`revoke ${state.role}`, () =>
            admin.unsafe(
              `revoke ${quoteIdentifier(state.role)} from current_user`,
            ),
          );
        if (state.created)
          await cleanup(`drop ${state.role}`, () =>
            admin.unsafe(`drop role if exists ${quoteIdentifier(state.role)}`),
          );
      }
      await cleanup("admin connection", () => admin.end({ timeout: 5 }));
    }
    if (primaryError) {
      if (cleanupErrors.length)
        throw new AggregateError(
          [primaryError, ...cleanupErrors],
          "M2 proof and cleanup both failed",
        );
      throw primaryError;
    }
    if (cleanupErrors.length)
      throw new AggregateError(cleanupErrors, "M2 cleanup failed");
  },
);
