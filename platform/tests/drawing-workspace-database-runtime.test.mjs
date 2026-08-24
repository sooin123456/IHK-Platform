import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const OWNER = "00000000-0000-4000-8000-000000000001";
const REVIEWER = "00000000-0000-4000-8000-000000000002";
const PROJECT = "10000000-0000-4000-8000-000000000001";
const PDF = "20000000-0000-4000-8000-000000000001";
const PDF_SHA = "a".repeat(64);
const STYLE = { stroke: "#112233", strokeWidth: 1, fill: null };

let db;

const migration = () =>
  readFile(
    new URL(
      "../supabase/migrations/20260824110000_drawing_workspace_core.sql",
      import.meta.url,
    ),
    "utf8",
  );

async function asActor(actor) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
}

async function createDocument(title = randomUUID()) {
  await asActor(OWNER);
  const result = await db.query(
    "select public.lukas_drawing_create_document($1,$2,$3,true) result",
    [PROJECT, PDF, title],
  );
  return result.rows[0].result;
}

async function applyOperation(revisionId, operationType, baseVersions, forward, inverse) {
  const result = await db.query(
    `select public.lukas_drawing_apply_operation($1,$2,$3,$4,$5,$6) result`,
    [revisionId, randomUUID(), operationType, baseVersions, forward, inverse],
  );
  return result.rows[0].result;
}

const circleObject = (id, layerId, overrides = {}) => ({
  id,
  layerId,
  geometry: { type: "circle", center: { x: 10, y: 20 }, radius: 5 },
  style: STYLE,
  version: 1,
  ...overrides,
});

async function addObject(ids, object) {
  return applyOperation(
    ids.revisionId,
    "add_objects",
    {},
    { type: "add_objects", objects: [object] },
    { type: "delete_objects", objectIds: [object.id] },
  );
}

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable set search_path = '' as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;
    grant usage on schema private to authenticated, service_role;

    create table public.lukas_qto_projects(
      id uuid primary key,
      owner_id uuid not null references auth.users(id)
    );
    create table public.lukas_qto_project_members(
      project_id uuid not null references public.lukas_qto_projects(id),
      user_id uuid not null references auth.users(id),
      role text not null,
      primary key(project_id, user_id)
    );
    create table public.lukas_qto_files(
      id uuid primary key,
      project_id uuid not null references public.lukas_qto_projects(id),
      uploaded_by uuid not null references auth.users(id),
      kind text not null,
      sha256 text not null,
      immutable boolean not null default true,
      unique(id, project_id, sha256)
    );
    create table public.lukas_drawing_issues(
      id uuid primary key,
      project_id uuid not null references public.lukas_qto_projects(id),
      unique(id, project_id)
    );
    create function private.lukas_qto_project_role(p_project_id uuid)
    returns text language sql stable security definer set search_path = '' as $$
      select case
        when p.owner_id = (select auth.uid()) then 'owner'
        else (select m.role from public.lukas_qto_project_members m
          where m.project_id = p.id and m.user_id = (select auth.uid()))
      end
      from public.lukas_qto_projects p where p.id = p_project_id
    $$;
    revoke all on function private.lukas_qto_project_role(uuid) from public, anon;
    grant execute on function private.lukas_qto_project_role(uuid)
      to authenticated, service_role;
    grant select on public.lukas_qto_projects, public.lukas_qto_project_members,
      public.lukas_qto_files, public.lukas_drawing_issues to authenticated;
  `);
  await db.exec(await migration());
  await db.query("insert into auth.users(id) values ($1),($2)", [OWNER, REVIEWER]);
  await db.query(
    "insert into public.lukas_qto_projects(id,owner_id) values ($1,$2)",
    [PROJECT, OWNER],
  );
  await db.query(
    `insert into public.lukas_qto_project_members(project_id,user_id,role)
     values ($1,$2,'reviewer')`,
    [PROJECT, REVIEWER],
  );
  await db.query(
    `insert into public.lukas_qto_files(id,project_id,uploaded_by,kind,sha256)
     values ($1,$2,$3,'pdf',$4)`,
    [PDF, PROJECT, OWNER, PDF_SHA],
  );
});

after(async () => {
  await db?.close();
});

test("runtime migration rejects malformed domain and inverse JSON", async (t) => {
  await t.test("geometry with a missing mandatory key", async () => {
    const ids = await createDocument();
    const object = circleObject(randomUUID(), ids.workLayerId, {
      geometry: { type: "circle", radius: 5 },
    });
    await assert.rejects(
      addObject(ids, object),
      /Drawing operation domain JSON is invalid/,
    );
  });

  await t.test("empty style", async () => {
    const ids = await createDocument();
    const object = circleObject(randomUUID(), ids.workLayerId, { style: {} });
    await assert.rejects(
      addObject(ids, object),
      /Drawing operation domain JSON is invalid/,
    );
  });

  await t.test("Konva-shaped and mismatched inverse payloads", async () => {
    const ids = await createDocument();
    const object = circleObject(randomUUID(), ids.workLayerId);
    await assert.rejects(
      applyOperation(
        ids.revisionId,
        "add_objects",
        {},
        { type: "add_objects", objects: [object] },
        { type: "delete_objects", attrs: { id: object.id } },
      ),
      /inverse payload is invalid/i,
    );
    await assert.rejects(
      applyOperation(
        ids.revisionId,
        "add_objects",
        {},
        { type: "add_objects", objects: [object] },
        { type: "update_layer", layerId: ids.workLayerId, patch: { visible: false } },
      ),
      /inverse payload is invalid/i,
    );
  });
});

test("runtime migration rejects incomplete PDF evidence", async () => {
  const ids = await createDocument();
  const object = circleObject(randomUUID(), ids.workLayerId);
  await addObject(ids, object);
  await assert.rejects(
    db.query(
      `insert into public.lukas_drawing_object_sources(
        object_id,revision_id,project_id,source_file_id,source_sha256,
        source_kind,created_by
      ) values ($1,$2,$3,$4,$5,'pdf_region',$6)`,
      [object.id, ids.revisionId, PROJECT, PDF, PDF_SHA, OWNER],
    ),
    /check constraint/i,
  );
});

test("runtime add_objects rejects an existing soft-deleted ID", async () => {
  const ids = await createDocument();
  const object = circleObject(randomUUID(), ids.workLayerId);
  await addObject(ids, object);
  await applyOperation(
    ids.revisionId,
    "delete_objects",
    { [object.id]: 1 },
    { type: "delete_objects", objectIds: [object.id] },
    { type: "add_objects", objects: [object] },
  );
  await assert.rejects(addObject(ids, object), /Drawing object already exists/);
});

test("runtime operation retry is idempotent with a validated inverse", async () => {
  const ids = await createDocument();
  const object = circleObject(randomUUID(), ids.workLayerId);
  const clientOperationId = randomUUID();
  const parameters = [
    ids.revisionId,
    clientOperationId,
    "add_objects",
    {},
    { type: "add_objects", objects: [object] },
    { type: "delete_objects", objectIds: [object.id] },
  ];
  const first = await db.query(
    "select public.lukas_drawing_apply_operation($1,$2,$3,$4,$5,$6) result",
    parameters,
  );
  const retry = await db.query(
    "select public.lukas_drawing_apply_operation($1,$2,$3,$4,$5,$6) result",
    parameters,
  );
  assert.deepEqual(retry.rows[0].result, first.rows[0].result);
  const count = await db.query(
    `select count(*)::int count from public.lukas_drawing_operations
     where revision_id=$1 and client_operation_id=$2`,
    [ids.revisionId, clientOperationId],
  );
  assert.equal(count.rows[0].count, 1);
});

test("runtime review freeze rejects inserts into the locked revision", async () => {
  const ids = await createDocument();
  const review = await db.query(
    "select public.lukas_drawing_request_review($1) result",
    [ids.revisionId],
  );
  await db.exec("reset role");
  const hash = await db.query(
    `select s.sha256,
      encode(extensions.digest(convert_to(s.canonical_json::text,'UTF8'),'sha256'),'hex') recomputed
     from public.lukas_drawing_snapshots s where s.id=$1`,
    [review.rows[0].result.snapshotId],
  );
  assert.equal(hash.rows[0].sha256, hash.rows[0].recomputed);
  await asActor(REVIEWER);
  await db.query(
    `select public.lukas_drawing_record_revision_decision(
      $1,$2,$3,'approved','runtime fixture'
    )`,
    [
      ids.revisionId,
      review.rows[0].result.subjectVersion,
      review.rows[0].result.snapshotSha256,
    ],
  );
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [OWNER]);
  await assert.rejects(
    db.query(
      `insert into public.lukas_drawing_pages(
        revision_id,project_id,name,page_number,width_mm,height_mm
      ) values ($1,$2,'late page',2,420,297)`,
      [ids.revisionId, PROJECT],
    ),
    /drawing revision is immutable/i,
  );
});
