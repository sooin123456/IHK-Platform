import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrationSuffix =
  "_drawing_workspace_m2_pdf_primary_attach_authority.sql";

const foundationSql = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create role lukas_drawing_collaboration nologin;
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
`;

async function migrationEntries() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const matches = names.filter((name) => name.endsWith(migrationSuffix));
  assert.equal(matches.length, 1, "exactly one M2 PDF attach migration");
  return { names, m2Name: matches[0] };
}

async function freshDatabase({ includeM2 = true } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(foundationSql);
  const { names, m2Name } = await migrationEntries();
  for (const name of names) {
    if (!includeM2 && name === m2Name) continue;
    await db.exec(await readFile(new URL(name, migrationsDirectory), "utf8"));
  }
  return db;
}

async function setSession(db, role, actorId) {
  assert.ok(["anon", "authenticated", "service_role"].includes(role));
  await db.exec("reset role");
  await db.exec(`set role ${role}`);
  await db.query(
    "select pg_catalog.set_config('request.jwt.claims',$1,false)",
    [
      JSON.stringify({
        role,
        sub: actorId ?? undefined,
        is_anonymous: false,
        app_metadata: {},
      }),
    ],
  );
}

async function resetSession(db) {
  await db.exec("reset role");
  await db.query("select pg_catalog.set_config('request.jwt.claims','',false)");
}

async function assertSqlState(promise, code, message) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    if (message) assert.match(error.message, message);
    return true;
  });
}

async function createProject(db, actorId, name) {
  await setSession(db, "authenticated", actorId);
  const result = await db.query(
    `insert into public.lukas_qto_projects(
      owner_id,name,description,contact_name,contact_phone,workflow_status
    ) values($1,$2,'','','','inquiry_received')
    returning id,organization_id`,
    [actorId, name],
  );
  return result.rows[0];
}

async function insertFile(
  db,
  {
    id = randomUUID(),
    projectId,
    actorId,
    kind = "pdf",
    immutable = true,
    storagePath = `${actorId}/${projectId}/source-uploads/${id}`,
    includeStorageObject = true,
  },
) {
  const sha256 = id.replaceAll("-", "").padEnd(64, "0").slice(0, 64);
  await resetSession(db);
  await db.query(
    `insert into public.lukas_qto_files(
      id,project_id,uploaded_by,kind,storage_path,original_filename,
      content_type,byte_size,sha256,immutable
    ) values($1,$2,$3,$4,$5,$6,$7,17,$8,$9)`,
    [
      id,
      projectId,
      actorId,
      kind,
      storagePath,
      `${id}.${kind}`,
      kind === "pdf" ? "application/pdf" : "application/octet-stream",
      sha256,
      immutable,
    ],
  );
  if (includeStorageObject)
    await db.query(
      `insert into storage.objects(id,bucket_id,name)
       values($1,'lukas-qto',$2)`,
      [randomUUID(), storagePath],
    );
  return { id, sha256, immutable, kind, storagePath };
}

async function createDocument(db, actorId, projectId, title) {
  await setSession(db, "authenticated", actorId);
  const result = await db.query(
    `select public.lukas_drawing_create_document_idempotent(
      $1,null,$2,true,$3,null
    ) value`,
    [projectId, title, randomUUID()],
  );
  return result.rows[0].value;
}

async function createSourcedDocument(
  db,
  actorId,
  projectId,
  sourceFileId,
  title,
) {
  await setSession(db, "authenticated", actorId);
  const result = await db.query(
    `select public.lukas_drawing_create_document_idempotent(
      $1,$2,$3,false,$4,null
    ) value`,
    [projectId, sourceFileId, title, randomUUID()],
  );
  return result.rows[0].value;
}

async function attach(db, actorId, document, fileId, requestId) {
  await setSession(db, "authenticated", actorId);
  const result = await db.query(
    `select public.lukas_drawing_attach_source($1,$2,$3,$4,$5) value`,
    [
      document.documentId,
      document.revisionId,
      document.canvasId,
      fileId,
      requestId,
    ],
  );
  return result.rows[0].value;
}

async function putCanvasBackground(db, actorId, document, file) {
  await resetSession(db);
  const current = await db.query(
    `select private.lukas_drawing_structure_entity_json(
      'canvas',$1,$2,d.project_id
    ) entity
    from public.lukas_drawing_documents d where d.id=$3`,
    [document.canvasId, document.revisionId, document.documentId],
  );
  const before = current.rows[0].entity;
  const after = {
    ...before,
    background: {
      sourceFileId: file.id,
      sourceSha256: file.sha256,
      pdfPageNumber: 1,
      calibration: null,
    },
  };
  await setSession(db, "authenticated", actorId);
  await db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'mutate_structure',$3::jsonb,$4::jsonb,$5::jsonb
    )`,
    [
      document.revisionId,
      randomUUID(),
      JSON.stringify({ [document.canvasId]: before.version }),
      JSON.stringify({
        type: "mutate_structure",
        actions: [
          {
            kind: "put_canvas",
            entity: after,
            baseVersion: before.version,
          },
        ],
      }),
      JSON.stringify({
        type: "mutate_structure",
        actions: [
          {
            kind: "put_canvas",
            entity: before,
            baseVersion: before.version + 1,
          },
        ],
      }),
    ],
  );
}

async function forceCanvasBackground(db, actorId, document, file) {
  await resetSession(db);
  await db.exec(
    "alter table public.lukas_drawing_canvases disable trigger lukas_drawing_canvases_source_identity_guard",
  );
  try {
    await putCanvasBackground(db, actorId, document, file);
  } finally {
    await resetSession(db);
    await db.exec(
      "alter table public.lukas_drawing_canvases enable trigger lukas_drawing_canvases_source_identity_guard",
    );
  }
}

async function undoAttachedCanvasBackground(
  db,
  actorId,
  document,
  originalOperationId,
) {
  await resetSession(db);
  const current = await db.query(
    `select private.lukas_drawing_structure_entity_json(
      'canvas',$1,$2,d.project_id
    ) entity
    from public.lukas_drawing_documents d where d.id=$3`,
    [document.canvasId, document.revisionId, document.documentId],
  );
  const before = current.rows[0].entity;
  const after = { ...before, background: null };
  await setSession(db, "authenticated", actorId);
  return db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'mutate_structure',$3::jsonb,$4::jsonb,$5::jsonb,'undo',$6
    )`,
    [
      document.revisionId,
      randomUUID(),
      JSON.stringify({ [document.canvasId]: before.version }),
      JSON.stringify({
        type: "mutate_structure",
        actions: [
          {
            kind: "put_canvas",
            entity: after,
            baseVersion: before.version,
          },
        ],
      }),
      JSON.stringify({
        type: "mutate_structure",
        actions: [
          {
            kind: "put_canvas",
            entity: before,
            baseVersion: before.version + 1,
          },
        ],
      }),
      originalOperationId,
    ],
  );
}

async function deleteAttachedCanvas(db, actorId, document) {
  await resetSession(db);
  const canvasResult = await db.query(
    `select private.lukas_drawing_structure_entity_json(
      'canvas',$1,$2,d.project_id
    ) entity
    from public.lukas_drawing_documents d where d.id=$3`,
    [document.canvasId, document.revisionId, document.documentId],
  );
  const layerResult = await db.query(
    `select private.lukas_drawing_structure_entity_json(
      'layer',l.id,$1,l.project_id
    ) entity
    from public.lukas_drawing_layers l
    where l.canvas_id=$2 order by l.sort_order,l.id`,
    [document.revisionId, document.canvasId],
  );
  const canvas = canvasResult.rows[0].entity;
  const layers = layerResult.rows.map((row) => row.entity);
  const forward = [
    ...layers.map((layer) => ({
      kind: "delete_layer",
      id: layer.id,
      baseVersion: layer.version,
    })),
    {
      kind: "delete_canvas",
      id: canvas.id,
      baseVersion: canvas.version,
    },
  ];
  const inverse = [
    { kind: "put_canvas", entity: canvas, baseVersion: null },
    ...layers.toReversed().map((layer) => ({
      kind: "put_layer",
      entity: layer,
      baseVersion: null,
    })),
  ];
  await setSession(db, "authenticated", actorId);
  return db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'mutate_structure',$3::jsonb,$4::jsonb,$5::jsonb
    )`,
    [
      document.revisionId,
      randomUUID(),
      JSON.stringify(
        Object.fromEntries(
          [canvas, ...layers].map((entity) => [entity.id, entity.version]),
        ),
      ),
      JSON.stringify({ type: "mutate_structure", actions: forward }),
      JSON.stringify({ type: "mutate_structure", actions: inverse }),
    ],
  );
}

async function deleteAttachedPageWithSibling(db, actorId, document) {
  const siblingPage = {
    id: randomUUID(),
    revisionId: document.revisionId,
    name: "Sibling page",
    sortOrder: 1,
    version: 1,
  };
  const siblingCanvas = {
    id: randomUUID(),
    pageId: siblingPage.id,
    name: "Sibling paper",
    spaceKind: "paper",
    widthMillimeters: 420,
    heightMillimeters: 297,
    background: null,
    sortOrder: 0,
    version: 1,
  };
  const siblingLayer = {
    id: randomUUID(),
    name: "Sibling work",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: siblingCanvas.id,
    sortOrder: 0,
    version: 1,
  };
  await setSession(db, "authenticated", actorId);
  await db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'mutate_structure','{}'::jsonb,$3::jsonb,$4::jsonb
    )`,
    [
      document.revisionId,
      randomUUID(),
      JSON.stringify({
        type: "mutate_structure",
        actions: [
          { kind: "put_page", entity: siblingPage, baseVersion: null },
          { kind: "put_canvas", entity: siblingCanvas, baseVersion: null },
          { kind: "put_layer", entity: siblingLayer, baseVersion: null },
        ],
      }),
      JSON.stringify({
        type: "mutate_structure",
        actions: [
          { kind: "delete_layer", id: siblingLayer.id, baseVersion: 1 },
          { kind: "delete_canvas", id: siblingCanvas.id, baseVersion: 1 },
          { kind: "delete_page", id: siblingPage.id, baseVersion: 1 },
        ],
      }),
    ],
  );

  await resetSession(db);
  const [pageResult, canvasResult, layerResult] = await Promise.all([
    db.query(
      `select private.lukas_drawing_structure_entity_json(
        'page',$1,$2,d.project_id
      ) entity from public.lukas_drawing_documents d where d.id=$3`,
      [document.pageId, document.revisionId, document.documentId],
    ),
    db.query(
      `select private.lukas_drawing_structure_entity_json(
        'canvas',$1,$2,d.project_id
      ) entity from public.lukas_drawing_documents d where d.id=$3`,
      [document.canvasId, document.revisionId, document.documentId],
    ),
    db.query(
      `select private.lukas_drawing_structure_entity_json(
        'layer',l.id,$1,l.project_id
      ) entity from public.lukas_drawing_layers l
      where l.canvas_id=$2 order by l.sort_order,l.id`,
      [document.revisionId, document.canvasId],
    ),
  ]);
  const page = pageResult.rows[0].entity;
  const canvas = canvasResult.rows[0].entity;
  const layers = layerResult.rows.map((row) => row.entity);
  const baseVersions = Object.fromEntries(
    [page, canvas, ...layers].map((entity) => [entity.id, entity.version]),
  );
  const forward = [
    ...layers.map((layer) => ({
      kind: "delete_layer",
      id: layer.id,
      baseVersion: layer.version,
    })),
    { kind: "delete_canvas", id: canvas.id, baseVersion: canvas.version },
    { kind: "delete_page", id: page.id, baseVersion: page.version },
  ];
  const inverse = [
    { kind: "put_page", entity: page, baseVersion: null },
    { kind: "put_canvas", entity: canvas, baseVersion: null },
    ...layers.toReversed().map((layer) => ({
      kind: "put_layer",
      entity: layer,
      baseVersion: null,
    })),
  ];
  await setSession(db, "authenticated", actorId);
  return db.query(
    `select public.lukas_drawing_apply_operation(
      $1,$2,'mutate_structure',$3::jsonb,$4::jsonb,$5::jsonb
    )`,
    [
      document.revisionId,
      randomUUID(),
      JSON.stringify(baseVersions),
      JSON.stringify({ type: "mutate_structure", actions: forward }),
      JSON.stringify({ type: "mutate_structure", actions: inverse }),
    ],
  );
}

async function createLatestBlankRevision(db, actorId, projectId, documentId) {
  await resetSession(db);
  await db.query(
    "select pg_catalog.set_config('request.jwt.claims',$1,false)",
    [
      JSON.stringify({
        role: "authenticated",
        sub: actorId,
        is_anonymous: false,
        app_metadata: {},
      }),
    ],
  );
  const revision = await db.query(
    `insert into public.lukas_drawing_revisions(
      document_id,project_id,sequence,status,version,created_by
    ) select $1,$2,pg_catalog.max(sequence)+1,'draft',1,$3
      from public.lukas_drawing_revisions where document_id=$1
      returning id`,
    [documentId, projectId, actorId],
  );
  const revisionId = revision.rows[0].id;
  const page = await db.query(
    `insert into public.lukas_drawing_pages(
      revision_id,project_id,name,page_number,sort_order,width_mm,height_mm
    ) values($1,$2,'Page 1',1,0,420,297) returning id`,
    [revisionId, projectId],
  );
  const pageId = page.rows[0].id;
  const canvasId = randomUUID();
  const canvas = await db.query(
    `insert into public.lukas_drawing_canvases(
      id,page_id,revision_id,project_id,name,space_kind,width_mm,height_mm,
      sort_order,version,created_by
    ) values($1,$2,$3,$4,'Paper','paper',420,297,0,1,$5) returning id`,
    [canvasId, pageId, revisionId, projectId, actorId],
  );
  assert.equal(canvas.rows[0].id, canvasId);
  await db.query(
    `insert into public.lukas_drawing_layers(
      page_id,canvas_id,revision_id,project_id,name,sort_order,visible,
      locked,system_kind,version,created_by
    ) values
      ($1,$2,$3,$4,'Source',0,true,true,'source',1,$5),
      ($1,$2,$3,$4,'Work',1,true,false,'work',1,$5)`,
    [pageId, canvasId, revisionId, projectId, actorId],
  );
  return { documentId, revisionId, pageId, canvasId };
}

async function seedAuthority(db) {
  const users = {
    owner: randomUUID(),
    editor: randomUUID(),
    viewer: randomUUID(),
    otherOwner: randomUUID(),
  };
  await resetSession(db);
  await db.query(
    `insert into auth.users(id,email,email_confirmed_at,is_anonymous)
     values($1,'owner@example.com',clock_timestamp(),false),
       ($2,'editor@example.com',clock_timestamp(),false),
       ($3,'viewer@example.com',clock_timestamp(),false),
       ($4,'other@example.com',clock_timestamp(),false)`,
    [users.owner, users.editor, users.viewer, users.otherOwner],
  );
  const project = await createProject(db, users.owner, "M2 PDF attach");
  const otherProject = await createProject(
    db,
    users.otherOwner,
    "M2 other project",
  );
  await resetSession(db);
  await db.query(
    `insert into public.lukas_qto_project_members(project_id,user_id,role)
     values($1,$2,'estimator'),($1,$3,'viewer')`,
    [project.id, users.editor, users.viewer],
  );
  const files = {
    pdf: await insertFile(db, {
      projectId: project.id,
      actorId: users.owner,
    }),
    otherPdf: await insertFile(db, {
      projectId: project.id,
      actorId: users.owner,
    }),
    rollbackPdf: await insertFile(db, {
      projectId: project.id,
      actorId: users.owner,
    }),
    mutablePdf: await insertFile(db, {
      projectId: project.id,
      actorId: users.owner,
      immutable: false,
    }),
    ifc: await insertFile(db, {
      projectId: project.id,
      actorId: users.owner,
      kind: "ifc",
    }),
    foreignPdf: await insertFile(db, {
      projectId: otherProject.id,
      actorId: users.otherOwner,
    }),
    legacyPdf: await insertFile(db, {
      projectId: project.id,
      actorId: users.owner,
      storagePath: `${users.owner}/${project.id}/legacy/${randomUUID()}.pdf`,
    }),
    missingPdf: await insertFile(db, {
      projectId: project.id,
      actorId: users.owner,
      includeStorageObject: false,
    }),
  };
  return { users, project, otherProject, files };
}

test("M2 PDF attach is exact, one-shot, operation-backed, and rollback-safe", async () => {
  const db = await freshDatabase();
  try {
    const { users, project, files } = await seedAuthority(db);
    const document = await createDocument(
      db,
      users.editor,
      project.id,
      "Attach target",
    );
    const requestId = randomUUID();
    await resetSession(db);
    const fileBefore = await db.query(
      `select pg_catalog.to_jsonb(f) value
       from public.lukas_qto_files f where f.id=$1`,
      [files.pdf.id],
    );

    const first = await attach(
      db,
      users.editor,
      document,
      files.pdf.id,
      requestId,
    );
    const retry = await attach(
      db,
      users.editor,
      document,
      files.pdf.id,
      requestId,
    );
    assert.deepEqual(retry, first);
    assert.deepEqual(
      {
        documentId: first.documentId,
        revisionId: first.revisionId,
        canvasId: first.canvasId,
        sourceFileId: first.sourceFileId,
        sourceSha256: first.sourceSha256,
        hasUpdatedAt:
          typeof first.documentUpdatedAt === "string" &&
          first.documentUpdatedAt.length > 0,
      },
      {
        documentId: document.documentId,
        revisionId: document.revisionId,
        canvasId: document.canvasId,
        sourceFileId: files.pdf.id,
        sourceSha256: files.pdf.sha256,
        hasUpdatedAt: true,
      },
    );

    await resetSession(db);
    const evidence = await db.query(
      `select
        d.source_file_id "documentFile",d.source_sha256 "documentSha",
        c.background_source_file_id "canvasFile",
        c.background_source_sha256 "canvasSha",c.background_pdf_page "pdfPage",
        c.calibration,c.version "canvasVersion",
        o.client_operation_id "operationRequest",o.operation_type "operationType",
        o.base_versions "baseVersions",o.forward,o.inverse,
        o.result_versions "resultVersions",
        l.request_sha256 "requestSha",l.result_json "ledgerResult",
        (select pg_catalog.count(*)::integer
          from public.lukas_drawing_operations x
          where x.revision_id=d.id) bogus
      from public.lukas_drawing_documents d
      join public.lukas_drawing_revisions r on r.document_id=d.id
      join public.lukas_drawing_canvases c on c.id=$2
      join public.lukas_drawing_operations o
        on o.revision_id=r.id and o.client_operation_id=$3
      join private.lukas_drawing_source_attach_requests l
        on l.actor_id=$4 and l.client_request_id=$3
      where d.id=$1`,
      [document.documentId, document.canvasId, requestId, users.editor],
    );
    assert.equal(evidence.rows.length, 1);
    const row = evidence.rows[0];
    assert.equal(row.documentFile, files.pdf.id);
    assert.equal(row.documentSha, files.pdf.sha256);
    assert.equal(row.canvasFile, files.pdf.id);
    assert.equal(row.canvasSha, files.pdf.sha256);
    assert.equal(row.pdfPage, 1);
    assert.equal(row.calibration, null);
    assert.equal(row.canvasVersion, 2);
    assert.equal(row.operationRequest, requestId);
    assert.equal(row.operationType, "mutate_structure");
    assert.deepEqual(row.baseVersions, { [document.canvasId]: 1 });
    assert.deepEqual(row.resultVersions, { [document.canvasId]: 2 });
    assert.equal(row.forward.type, "mutate_structure");
    assert.equal(row.forward.actions[0].kind, "put_canvas");
    assert.equal(
      row.forward.actions[0].entity.background.sourceSha256,
      files.pdf.sha256,
    );
    assert.equal(row.inverse.actions[0].entity.background, null);
    assert.equal(row.inverse.actions[0].baseVersion, 2);
    assert.match(row.requestSha, /^[0-9a-f]{64}$/);
    assert.deepEqual(row.ledgerResult, first);

    const fileAfter = await db.query(
      `select pg_catalog.to_jsonb(f) value
       from public.lukas_qto_files f where f.id=$1`,
      [files.pdf.id],
    );
    assert.deepEqual(fileAfter.rows[0].value, fileBefore.rows[0].value);

    await assertSqlState(
      undoAttachedCanvasBackground(
        db,
        users.editor,
        document,
        requestId,
      ),
      "P1C01",
      /canvas source identity is immutable/i,
    );
    await resetSession(db);
    const undoPreserved = await db.query(
      `select d.source_file_id "documentFile",
        c.background_source_file_id "canvasFile",c.version "canvasVersion"
       from public.lukas_drawing_documents d
       join public.lukas_drawing_canvases c on c.id=$2
       where d.id=$1`,
      [document.documentId, document.canvasId],
    );
    assert.deepEqual(undoPreserved.rows[0], {
      documentFile: files.pdf.id,
      canvasFile: files.pdf.id,
      canvasVersion: 2,
    });

    await assertSqlState(
      deleteAttachedCanvas(db, users.editor, document),
      "P1R01",
      /Default paper canvas is immutable/i,
    );
    await resetSession(db);
    await db.exec(
      "alter table public.lukas_drawing_canvases disable trigger lukas_drawing_canvases_guard",
    );
    try {
      await assertSqlState(
        deleteAttachedCanvas(db, users.editor, document),
        "P1C01",
        /canvas source identity is immutable/i,
      );
    } finally {
      await resetSession(db);
      await db.exec(
        "alter table public.lukas_drawing_canvases enable trigger lukas_drawing_canvases_guard",
      );
    }
    await resetSession(db);
    const deletePreserved = await db.query(
      `select
        (select pg_catalog.count(*)::integer
          from public.lukas_drawing_canvases where id=$1) canvases,
        (select pg_catalog.count(*)::integer
          from public.lukas_drawing_layers where canvas_id=$1) layers`,
      [document.canvasId],
    );
    assert.deepEqual(deletePreserved.rows[0], { canvases: 1, layers: 2 });

    await assertSqlState(
      deleteAttachedPageWithSibling(db, users.editor, document),
      "P1C01",
      /canvas source identity is immutable/i,
    );
    await resetSession(db);
    const pageDeletePreserved = await db.query(
      `select
        d.source_file_id "documentFile",
        (select pg_catalog.count(*)::integer
          from public.lukas_drawing_pages p
          where p.revision_id=$2) pages,
        (select pg_catalog.count(*)::integer
          from public.lukas_drawing_canvases c where c.id=$3) source_canvases,
        (select pg_catalog.count(*)::integer
          from private.lukas_drawing_source_attach_requests l
          where l.document_id=d.id) ledger
       from public.lukas_drawing_documents d where d.id=$1`,
      [document.documentId, document.revisionId, document.canvasId],
    );
    assert.deepEqual(pageDeletePreserved.rows[0], {
      documentFile: files.pdf.id,
      pages: 2,
      source_canvases: 1,
      ledger: 1,
    });

    await assertSqlState(
      attach(db, users.editor, document, files.otherPdf.id, requestId),
      "P1C01",
      /request ID does not match/i,
    );

    const direct = await createDocument(
      db,
      users.editor,
      project.id,
      "Direct attach denied",
    );
    await setSession(db, "authenticated", users.editor);
    await assertSqlState(
      db.query(
        `update public.lukas_drawing_documents
         set source_file_id=$1,source_sha256=$2 where id=$3`,
        [files.otherPdf.id, files.otherPdf.sha256, direct.documentId],
      ),
      "P1C01",
      /source identity is immutable/i,
    );

    await resetSession(db);
    await db.query(
      "select pg_catalog.set_config('request.jwt.claims',$1,false)",
      [
        JSON.stringify({
          role: "authenticated",
          sub: users.editor,
          is_anonymous: false,
          app_metadata: {},
        }),
      ],
    );
    await assertSqlState(
      db.query(
        `insert into public.lukas_drawing_pages(
          revision_id,project_id,name,page_number,sort_order,width_mm,height_mm,
          background_source_file_id,background_source_sha256,background_pdf_page
        ) values($1,$2,'Injected legacy page',2,1,420,297,$3,$4,1)`,
        [
          direct.revisionId,
          project.id,
          files.otherPdf.id,
          files.otherPdf.sha256,
        ],
      ),
      "P1C01",
      /Legacy drawing page canvas columns are read-only/i,
    );
    await resetSession(db);
    const directPages = await db.query(
      `select pg_catalog.count(*)::integer count
       from public.lukas_drawing_pages where revision_id=$1`,
      [direct.revisionId],
    );
    assert.equal(directPages.rows[0].count, 1);

    await setSession(db, "authenticated", users.editor);
    await db.query(
      `update public.lukas_drawing_documents set title='Renamed after attach'
       where id=$1`,
      [document.documentId],
    );
    await assertSqlState(
      db.query(
        `update public.lukas_drawing_documents
         set source_file_id=null,source_sha256=null where id=$1`,
        [document.documentId],
      ),
      "P1C01",
      /source identity is immutable/i,
    );
    await db.query(
      "select pg_catalog.set_config('private.lukas_drawing_source_attach',$1,false)",
      [`${document.documentId}:${files.otherPdf.id}:${files.otherPdf.sha256}`],
    );
    await assertSqlState(
      db.query(
        `update public.lukas_drawing_documents
         set source_file_id=$1,source_sha256=$2 where id=$3`,
        [files.otherPdf.id, files.otherPdf.sha256, document.documentId],
      ),
      "P1C01",
      /source identity is immutable/i,
    );

    await resetSession(db);
    await assertSqlState(
      db.query(
        `update private.lukas_drawing_source_attach_requests
         set request_sha256=$1 where actor_id=$2 and client_request_id=$3`,
        ["f".repeat(64), users.editor, requestId],
      ),
      "P1C01",
      /append-only/i,
    );
    await assertSqlState(
      db.query(
        `delete from private.lukas_drawing_source_attach_requests
         where actor_id=$1 and client_request_id=$2`,
        [users.editor, requestId],
      ),
      "P1C01",
      /append-only/i,
    );

    const privileges = await db.query(`select
      pg_catalog.has_function_privilege(
        'authenticated','public.lukas_drawing_attach_source(uuid,uuid,uuid,uuid,uuid)','execute'
      ) authenticated_public,
      pg_catalog.has_function_privilege(
        'service_role','public.lukas_drawing_attach_source(uuid,uuid,uuid,uuid,uuid)','execute'
      ) service_public,
      pg_catalog.has_function_privilege(
        'anon','public.lukas_drawing_attach_source(uuid,uuid,uuid,uuid,uuid)','execute'
      ) anon_public,
      pg_catalog.has_function_privilege(
        'authenticated','private.lukas_drawing_attach_source(uuid,uuid,uuid,uuid,uuid)','execute'
      ) authenticated_private,
      pg_catalog.has_table_privilege(
        'authenticated','private.lukas_drawing_source_attach_requests','select,insert,update,delete'
      ) authenticated_ledger,
      pg_catalog.has_table_privilege(
        'authenticated','private.lukas_drawing_source_attach_leases','select,insert,update,delete'
      ) authenticated_lease`);
    assert.deepEqual(privileges.rows[0], {
      authenticated_public: true,
      service_public: true,
      anon_public: false,
      authenticated_private: false,
      authenticated_ledger: false,
      authenticated_lease: false,
    });
    const publication = await db.query(
      `select pg_catalog.count(*)::integer count
       from pg_catalog.pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public'
         and tablename='lukas_drawing_documents'`,
    );
    assert.equal(publication.rows[0].count, 1);

    const sameSource = await createDocument(
      db,
      users.owner,
      project.id,
      "Duplicate source",
    );
    await assertSqlState(
      attach(db, users.owner, sameSource, files.pdf.id, randomUUID()),
      "P1C01",
      /already attached in this project/i,
    );

    const viewerTarget = await createDocument(
      db,
      users.owner,
      project.id,
      "Viewer denied",
    );
    await assertSqlState(
      attach(db, users.viewer, viewerTarget, files.otherPdf.id, randomUUID()),
      "P1R01",
    );
    const crossProject = await createDocument(
      db,
      users.owner,
      project.id,
      "Cross project denied",
    );
    await assertSqlState(
      attach(db, users.owner, crossProject, files.foreignPdf.id, randomUUID()),
      "P1R01",
    );
    const mutable = await createDocument(
      db,
      users.owner,
      project.id,
      "Mutable denied",
    );
    await assertSqlState(
      attach(db, users.owner, mutable, files.mutablePdf.id, randomUUID()),
      "P1R01",
    );
    const nonPdf = await createDocument(
      db,
      users.owner,
      project.id,
      "IFC denied",
    );
    await assertSqlState(
      attach(db, users.owner, nonPdf, files.ifc.id, randomUUID()),
      "P1R01",
    );
    const missingStorage = await createDocument(
      db,
      users.owner,
      project.id,
      "Missing storage denied",
    );
    await assertSqlState(
      attach(
        db,
        users.owner,
        missingStorage,
        files.missingPdf.id,
        randomUUID(),
      ),
      "P1R01",
    );

    const legacyStorage = await createDocument(
      db,
      users.owner,
      project.id,
      "Legacy storage protected",
    );
    await resetSession(db);
    await db.exec(
      "grant select,update,delete on storage.objects to authenticated",
    );
    await db.exec("alter table storage.objects enable row level security");
    await setSession(db, "authenticated", users.owner);
    const deniedStorageDelete = await db.query(
      `delete from storage.objects
       where bucket_id='lukas-qto' and name=$1 returning id`,
      [files.legacyPdf.storagePath],
    );
    assert.equal(deniedStorageDelete.rows.length, 0);
    const deniedStorageRename = await db.query(
      `update storage.objects set name=name||'-renamed'
       where bucket_id='lukas-qto' and name=$1 returning id`,
      [files.legacyPdf.storagePath],
    );
    assert.equal(deniedStorageRename.rows.length, 0);
    await resetSession(db);
    const storedLegacyBytes = await db.query(
      `select pg_catalog.count(*)::integer count from storage.objects
       where bucket_id='lukas-qto' and name=$1`,
      [files.legacyPdf.storagePath],
    );
    assert.equal(storedLegacyBytes.rows[0].count, 1);
    await attach(
      db,
      users.owner,
      legacyStorage,
      files.legacyPdf.id,
      randomUUID(),
    );
    await setSession(db, "authenticated", users.owner);
    const deniedAfterAttach = await db.query(
      `delete from storage.objects
       where bucket_id='lukas-qto' and name=$1 returning id`,
      [files.legacyPdf.storagePath],
    );
    assert.equal(deniedAfterAttach.rows.length, 0);
    await assertSqlState(
      attach(
        db,
        users.owner,
        { ...nonPdf, revisionId: randomUUID() },
        files.otherPdf.id,
        randomUUID(),
      ),
      "P1R01",
    );
    await assertSqlState(
      attach(
        db,
        users.owner,
        { ...nonPdf, canvasId: randomUUID() },
        files.otherPdf.id,
        randomUUID(),
      ),
      "P1R01",
    );

    const nonLatest = await createDocument(
      db,
      users.owner,
      project.id,
      "Non-latest denied",
    );
    await resetSession(db);
    await db.query(
      `insert into public.lukas_drawing_revisions(
        document_id,project_id,sequence,status,version,created_by
      ) values($1,$2,2,'draft',1,$3)`,
      [nonLatest.documentId, project.id, users.owner],
    );
    await assertSqlState(
      attach(db, users.owner, nonLatest, files.otherPdf.id, randomUUID()),
      "P1R01",
    );

    const approved = await createDocument(
      db,
      users.owner,
      project.id,
      "Approved denied",
    );
    await resetSession(db);
    await db.exec(
      "alter table public.lukas_drawing_revisions disable trigger user",
    );
    await db.query(
      `update public.lukas_drawing_revisions set
        status='approved',review_requested_at=clock_timestamp(),
        approved_at=clock_timestamp() where id=$1`,
      [approved.revisionId],
    );
    await db.exec(
      "alter table public.lukas_drawing_revisions enable trigger user",
    );
    await assertSqlState(
      attach(db, users.owner, approved, files.otherPdf.id, randomUUID()),
      "P1R01",
    );

    const background = await createDocument(
      db,
      users.owner,
      project.id,
      "Existing background denied",
    );
    await assertSqlState(
      putCanvasBackground(db, users.owner, background, files.otherPdf),
      "P1C01",
      /canvas source identity is immutable/i,
    );
    await forceCanvasBackground(db, users.owner, background, files.otherPdf);
    await assertSqlState(
      attach(db, users.owner, background, files.rollbackPdf.id, randomUUID()),
      "P1C01",
      /background/i,
    );

    const historicalBackground = await createDocument(
      db,
      users.owner,
      project.id,
      "Historical background denied",
    );
    await forceCanvasBackground(
      db,
      users.owner,
      historicalBackground,
      files.otherPdf,
    );
    const latestBlank = await createLatestBlankRevision(
      db,
      users.owner,
      project.id,
      historicalBackground.documentId,
    );
    await assertSqlState(
      attach(db, users.owner, latestBlank, files.rollbackPdf.id, randomUUID()),
      "P1C01",
      /background/i,
    );

    const approvedHistory = await createDocument(
      db,
      users.owner,
      project.id,
      "Approved history denied",
    );
    await resetSession(db);
    await db.exec(
      "alter table public.lukas_drawing_revisions disable trigger user",
    );
    await db.query(
      `update public.lukas_drawing_revisions set
        status='approved',review_requested_at=clock_timestamp(),
        approved_at=clock_timestamp() where id=$1`,
      [approvedHistory.revisionId],
    );
    await db.exec(
      "alter table public.lukas_drawing_revisions enable trigger user",
    );
    const afterApproval = await createLatestBlankRevision(
      db,
      users.owner,
      project.id,
      approvedHistory.documentId,
    );
    await assertSqlState(
      attach(
        db,
        users.owner,
        afterApproval,
        files.rollbackPdf.id,
        randomUUID(),
      ),
      "P1R01",
    );

    const rollback = await createDocument(
      db,
      users.owner,
      project.id,
      "Rollback proof",
    );
    const rollbackRequest = randomUUID();
    await resetSession(db);
    await db.exec(`
      create function private.test_m2_reject_document_source()
      returns trigger language plpgsql set search_path='' as $$
      begin
        if new.source_file_id is distinct from old.source_file_id then
          raise exception using errcode='P1C01',message='Injected attach rollback';
        end if;
        return new;
      end
      $$;
      create trigger zz_test_m2_reject_document_source
      before update on public.lukas_drawing_documents
      for each row execute function private.test_m2_reject_document_source();
    `);
    await assertSqlState(
      attach(db, users.owner, rollback, files.rollbackPdf.id, rollbackRequest),
      "P1C01",
      /Injected attach rollback/i,
    );
    await resetSession(db);
    await db.exec(`
      drop trigger zz_test_m2_reject_document_source
        on public.lukas_drawing_documents;
      drop function private.test_m2_reject_document_source();
    `);
    const rolledBack = await db.query(
      `select
        d.source_file_id "documentFile",
        c.background_source_file_id "canvasFile",c.version "canvasVersion",
        (select pg_catalog.count(*)::integer
          from public.lukas_drawing_operations o
          where o.revision_id=$2 and o.client_operation_id=$3) operations,
        (select pg_catalog.count(*)::integer
          from private.lukas_drawing_source_attach_requests l
          where l.actor_id=$4 and l.client_request_id=$3) ledger
      from public.lukas_drawing_documents d
      join public.lukas_drawing_canvases c on c.id=$5
      where d.id=$1`,
      [
        rollback.documentId,
        rollback.revisionId,
        rollbackRequest,
        users.owner,
        rollback.canvasId,
      ],
    );
    assert.deepEqual(rolledBack.rows[0], {
      documentFile: null,
      canvasFile: null,
      canvasVersion: 1,
      operations: 0,
      ledger: 0,
    });

    await resetSession(db);
    await db.query(
      "select pg_catalog.set_config('app.lukas_retention_purge_project',$1,false)",
      [project.id],
    );
    await db.exec(
      "alter table public.lukas_qto_projects disable trigger lukas_qto_projects_retention_guard",
    );
    try {
      await db.query("delete from public.lukas_qto_projects where id=$1", [
        project.id,
      ]);
    } finally {
      await db.exec(
        "alter table public.lukas_qto_projects enable trigger lukas_qto_projects_retention_guard",
      );
    }
    const purged = await db.query(
      `select
        (select pg_catalog.count(*)::integer
          from public.lukas_qto_projects where id=$1) projects,
        (select pg_catalog.count(*)::integer
          from public.lukas_drawing_documents where project_id=$1) documents,
        (select pg_catalog.count(*)::integer
          from private.lukas_drawing_source_attach_requests
          where project_id=$1) attach_requests`,
      [project.id],
    );
    assert.deepEqual(purged.rows[0], {
      projects: 0,
      documents: 0,
      attach_requests: 0,
    });
  } finally {
    await db.close();
  }
});

test("M2 migration preflight rejects and preserves source-null/background-nonnull history", async () => {
  const db = await freshDatabase({ includeM2: false });
  try {
    const { users, project, files } = await seedAuthority(db);
    const document = await createDocument(
      db,
      users.owner,
      project.id,
      "Inconsistent preflight fixture",
    );
    await putCanvasBackground(db, users.owner, document, files.pdf);
    const { m2Name } = await migrationEntries();
    const sql = await readFile(new URL(m2Name, migrationsDirectory), "utf8");
    await resetSession(db);
    await assertSqlState(
      db.exec(sql),
      "P1C01",
      /Drawing source attach preflight failed/i,
    );
    await db.exec("rollback");
    const preserved = await db.query(
      `select d.source_file_id "documentFile",
        c.background_source_file_id "canvasFile",
        c.background_source_sha256 "canvasSha"
       from public.lukas_drawing_documents d
       join public.lukas_drawing_canvases c on c.id=$2
       where d.id=$1`,
      [document.documentId, document.canvasId],
    );
    assert.deepEqual(preserved.rows[0], {
      documentFile: null,
      canvasFile: files.pdf.id,
      canvasSha: files.pdf.sha256,
    });
  } finally {
    await db.close();
  }
});

test("M2 migration preserves a canonical existing IFC drawing", async () => {
  const db = await freshDatabase({ includeM2: false });
  try {
    const { users, project, files } = await seedAuthority(db);
    const document = await createSourcedDocument(
      db,
      users.owner,
      project.id,
      files.ifc.id,
      "Existing IFC drawing",
    );
    const { m2Name } = await migrationEntries();
    await resetSession(db);
    await db.exec(await readFile(new URL(m2Name, migrationsDirectory), "utf8"));
    const preserved = await db.query(
      `select d.source_file_id "documentFile",d.source_sha256 "documentSha",
        p.background_source_file_id "pageFile",
        c.background_source_file_id "canvasFile"
       from public.lukas_drawing_documents d
       join public.lukas_drawing_revisions r on r.document_id=d.id
       join public.lukas_drawing_pages p on p.revision_id=r.id
       join public.lukas_drawing_canvases c on c.page_id=p.id
       where d.id=$1`,
      [document.documentId],
    );
    assert.deepEqual(preserved.rows[0], {
      documentFile: files.ifc.id,
      documentSha: files.ifc.sha256,
      pageFile: null,
      canvasFile: null,
    });
  } finally {
    await db.close();
  }
});

test("M2 migration preflight rejects and preserves mismatched document and canvas sources", async () => {
  const db = await freshDatabase({ includeM2: false });
  try {
    const { users, project, files } = await seedAuthority(db);
    const document = await createDocument(
      db,
      users.owner,
      project.id,
      "Mismatched source preflight fixture",
    );
    await setSession(db, "authenticated", users.owner);
    await db.query(
      `update public.lukas_drawing_documents
       set source_file_id=$1,source_sha256=$2 where id=$3`,
      [files.pdf.id, files.pdf.sha256, document.documentId],
    );
    await putCanvasBackground(db, users.owner, document, files.otherPdf);
    const { m2Name } = await migrationEntries();
    const sql = await readFile(new URL(m2Name, migrationsDirectory), "utf8");
    await resetSession(db);
    await assertSqlState(
      db.exec(sql),
      "P1C01",
      /Drawing source attach preflight failed/i,
    );
    await db.exec("rollback");
    const preserved = await db.query(
      `select d.source_file_id "documentFile",d.source_sha256 "documentSha",
        c.background_source_file_id "canvasFile",
        c.background_source_sha256 "canvasSha"
       from public.lukas_drawing_documents d
       join public.lukas_drawing_canvases c on c.id=$2
       where d.id=$1`,
      [document.documentId, document.canvasId],
    );
    assert.deepEqual(preserved.rows[0], {
      documentFile: files.pdf.id,
      documentSha: files.pdf.sha256,
      canvasFile: files.otherPdf.id,
      canvasSha: files.otherPdf.sha256,
    });
  } finally {
    await db.close();
  }
});

test("M2 migration remains valid when the realtime publication is absent", async () => {
  const db = await freshDatabase({ includeM2: false });
  try {
    await db.exec("drop publication supabase_realtime");
    const { m2Name } = await migrationEntries();
    await db.exec(await readFile(new URL(m2Name, migrationsDirectory), "utf8"));
    const installed = await db.query(`select
      pg_catalog.to_regprocedure(
        'public.lukas_drawing_attach_source(uuid,uuid,uuid,uuid,uuid)'
      )::text rpc,
      exists(
        select 1 from pg_catalog.pg_publication
        where pubname='supabase_realtime'
      ) publication`);
    assert.deepEqual(installed.rows[0], {
      rpc: "lukas_drawing_attach_source(uuid,uuid,uuid,uuid,uuid)",
      publication: false,
    });
  } finally {
    await db.close();
  }
});
