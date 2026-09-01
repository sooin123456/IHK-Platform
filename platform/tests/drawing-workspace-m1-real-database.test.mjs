import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const databaseUrl = process.env.M1_REAL_POSTGRES_DATABASE_URL;
const required = process.env.M1_REAL_POSTGRES_REQUIRED === "1";

if (!databaseUrl) {
  test(
    "M1 real PostgreSQL proves Editor operations, idempotency, starter provenance, and binding authority",
    { skip: required ? false : "M1 real PostgreSQL gate is UNEXECUTED" },
    () => assert.fail("M1_REAL_POSTGRES_DATABASE_URL is required"),
  );
} else {
  const appRoles = Object.freeze([
    "anon",
    "authenticated",
    "service_role",
    "lukas_drawing_collaboration",
  ]);
  const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
  const sha = (value) => value.repeat(64);

  function quoteIdentifier(value) {
    assert.match(value, /^[a-z][a-z0-9_]{0,62}$/);
    return `"${value}"`;
  }

  function isolatedUrl(source, databaseName) {
    const url = new URL(source);
    url.pathname = `/${databaseName}`;
    return url.toString();
  }

  async function assertSqlState(promise, expected) {
    const codes = Array.isArray(expected) ? expected : [expected];
    await assert.rejects(promise, (error) => {
      assert.ok(codes.includes(error.code), `${error.code}: ${error.message}`);
      return true;
    });
  }

  async function attemptCleanup(errors, label, operation) {
    try {
      await operation();
    } catch (error) {
      errors.push(new Error(`M1 cleanup failed: ${label}`, { cause: error }));
    }
  }

  async function session(sql, role, actorId, callback, options = {}) {
    assert.ok(appRoles.includes(role));
    return sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${quoteIdentifier(role)}`);
      await tx`select pg_catalog.set_config(
        'request.jwt.claims',${JSON.stringify({
          role,
          sub: actorId ?? undefined,
          is_anonymous: options.anonymous ?? false,
          app_metadata: options.staff ? { role: "hangil_staff" } : {},
        })},true
      )`;
      return callback(tx);
    });
  }

  async function bootstrapDatabase(sql) {
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
        id uuid primary key,email text,email_confirmed_at timestamptz,
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
    const names = (await readdir(migrationsDirectory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of names)
      await sql.unsafe(await readFile(new URL(name, migrationsDirectory), "utf8"));
  }

  async function createDocument(
    sql, role, actorId, projectId, title, requestId, libraryVersionId = null,
  ) {
    const [row] = await session(sql, role, actorId, (tx) => tx`
      select public.lukas_drawing_create_document_idempotent(
        ${projectId}::uuid,null::uuid,${title},true,${requestId}::uuid,
        ${libraryVersionId}::uuid
      ) value
    `);
    return row.value;
  }

  async function createLegacyDocument(sql, actorId, projectId, title) {
    const [row] = await session(sql, "authenticated", actorId, (tx) => tx`
      select public.lukas_drawing_create_document(
        ${projectId}::uuid,null::uuid,${title},true
      ) value
    `);
    return row.value;
  }

  async function insertBinding(sql, role, actorId, binding, options) {
    return session(
      sql,
      role,
      actorId,
      (tx) => tx`
        insert into public.lukas_drawing_estimate_bindings(
          id,project_id,drawing_revision_id,boq_version_id,created_by
        ) values(
          ${binding.id}::uuid,${binding.projectId}::uuid,
          ${binding.revisionId}::uuid,${binding.boqVersionId}::uuid,
          ${actorId}::uuid
        ) returning id
      `,
      options,
    );
  }

  function fixtureIds() {
    return {
      users: Object.fromEntries([
        "owner", "editor", "viewer", "reviewer", "approver", "anonymous", "outsider",
      ].map((name) => [name, randomUUID()])),
      organization: randomUUID(),
      project: randomUUID(),
      foreignProject: randomUUID(),
      purgeProject: randomUUID(),
      entitlement: randomUUID(),
      entitlementRequest: randomUUID(),
      files: Array.from({ length: 3 }, () => randomUUID()),
      priceBooks: Array.from({ length: 3 }, () => randomUUID()),
      boqs: Array.from({ length: 10 }, () => randomUUID()),
      bindings: Array.from({ length: 12 }, () => randomUUID()),
      documents: [],
      revisions: [],
    };
  }

  async function seedFixture(sql, ids) {
    await sql.begin(async (tx) => {
      await tx`select pg_catalog.set_config(
        'request.jwt.claims',${JSON.stringify({
          role: "authenticated",sub: ids.users.owner,is_anonymous: false,app_metadata: {},
        })},true
      )`;
      for (const [name, id] of Object.entries(ids.users))
        await tx`
          insert into auth.users(id,email,email_confirmed_at,is_anonymous)
          values(${id}::uuid,${`${name}-${id}@m1.example.test`},
            pg_catalog.clock_timestamp(),${name === "anonymous"})
        `;
      await tx`
        insert into public.lukas_qto_organizations(id,name,owner_id)
        values(${ids.organization}::uuid,'M1 isolated organization',${ids.users.owner}::uuid)
      `;
      for (const [name, id] of Object.entries(ids.users)) {
        if (name === "outsider") continue;
        await tx`
          insert into public.lukas_qto_organization_members(
            organization_id,user_id,role,library_access
          ) values(${ids.organization}::uuid,${id}::uuid,
            ${name === "owner" ? "owner" : "member"},true)
        `;
      }
      await tx`
        insert into public.lukas_qto_organization_entitlement_versions(
          id,organization_id,version_no,plan,seat_limit,project_limit,
          library_version_limit,features,reason,request_id,request_sha256,created_by
        ) values(${ids.entitlement}::uuid,${ids.organization}::uuid,2,'enterprise',100,100,
          1000,${tx.json({
            drawing_workspace: true,organization_library: true,
            realtime_collaboration: true,ifc_workspace: true,quantity_lineage: true,
          })}::jsonb,'M1 real database fixture',${ids.entitlementRequest}::uuid,
          ${sha("e")},${ids.users.owner}::uuid)
      `;
      for (const [id, name] of [
        [ids.project, "M1 authority project"],
        [ids.foreignProject, "M1 foreign project"],
        [ids.purgeProject, "M1 purge project"],
      ])
        await tx`
          insert into public.lukas_qto_projects(
            id,organization_id,owner_id,name,description
          ) values(${id}::uuid,${ids.organization}::uuid,${ids.users.owner}::uuid,
            ${name},'M1 isolated real PostgreSQL fixture')
        `;
      for (const [actor, role] of [
        [ids.users.editor, "estimator"],
        [ids.users.viewer, "viewer"],
        [ids.users.reviewer, "reviewer"],
        [ids.users.approver, "approver"],
        [ids.users.anonymous, "estimator"],
      ])
        await tx`
          insert into public.lukas_qto_project_members(project_id,user_id,role)
          values(${ids.project}::uuid,${actor}::uuid,${role})
        `;
      for (const [index, projectId] of [
        ids.project,ids.foreignProject,ids.purgeProject,
      ].entries()) {
        await tx`
          insert into public.lukas_qto_files(
            id,project_id,uploaded_by,kind,storage_path,original_filename,
            content_type,byte_size,sha256,immutable
          ) values(${ids.files[index]}::uuid,${projectId}::uuid,${ids.users.owner}::uuid,
            'other',${`m1/${projectId}/price-book.bin`},'price-book.bin',
            'application/octet-stream',1,${sha(String(index + 1))},true)
        `;
        await tx`
          insert into public.lukas_qto_price_books(
            id,project_id,name,version_label,effective_date,currency,rights_basis,
            license_note,source_file_id,source_sha256,created_by
          ) values(${ids.priceBooks[index]}::uuid,${projectId}::uuid,
            ${`M1 prices ${index}`},'1','2026-08-31','KRW','customer_owned',
            'M1 isolated real PostgreSQL fixture',${ids.files[index]}::uuid,
            ${sha(String(index + 1))},${ids.users.owner}::uuid)
        `;
      }
      for (let index = 0; index < ids.boqs.length; index += 1) {
        const projectId = index < 8 ? ids.project
          : index === 8 ? ids.foreignProject : ids.purgeProject;
        const priceBookId = index < 8 ? ids.priceBooks[0]
          : index === 8 ? ids.priceBooks[1] : ids.priceBooks[2];
        await tx`
          insert into public.lukas_qto_boq_versions(
            id,project_id,version_no,title,status,calculation_policy,
            quantity_scale,price_book_id,engine_version,created_by
          ) values(${ids.boqs[index]}::uuid,${projectId}::uuid,
            ${index < 8 ? index + 1 : 1},${`M1 draft BOQ ${index}`},'draft',
            'general_half_away',6,${priceBookId}::uuid,'VERIFIED-BOQ-1.0',
            ${ids.users.owner}::uuid)
        `;
      }
    });
  }

  async function scaffoldStarter(tx, ids, starter, suffix) {
    const [created] = await tx`
      select public.lukas_drawing_create_document_idempotent(
        ${ids.project}::uuid,null::uuid,${`Starter ${suffix}`},true,
        ${randomUUID()}::uuid,${starter.versionId}::uuid
      ) value
    `;
    const result = created.value;
    for (const [index, name] of starter.canonicalPayload.layers.entries())
      await tx`
        insert into public.lukas_drawing_layers(
          id,page_id,canvas_id,revision_id,project_id,name,sort_order,
          visible,locked,system_kind,version,created_by
        ) values(${randomUUID()}::uuid,${result.pageId}::uuid,${result.canvasId}::uuid,
          ${result.revisionId}::uuid,${ids.project}::uuid,${name},${index + 2},
          true,false,'custom',1,${ids.users.owner}::uuid)
      `;
    const appliesTo = [
      "line","polyline","rectangle","circle","text","dimension","wall",
      "opening","space","area","grid","arc","block_instance",
    ];
    const schemaIds = {};
    for (const [name, valueType, enumOptions] of [
      ["적산 분류", "enum", starter.canonicalPayload.categories],
      ["품목 코드", "text", []],
      ["근거 상태", "enum", starter.canonicalPayload.evidenceKinds],
      ["공종", "text", []],
      ["근거 사유", "text", []],
    ]) {
      schemaIds[name] = randomUUID();
      await tx`
        insert into public.lukas_drawing_property_schemas(
          id,revision_id,project_id,name,value_type,enum_options,applies_to,
          required,version,created_by
        ) values(${schemaIds[name]}::uuid,${result.revisionId}::uuid,
          ${ids.project}::uuid,${name},${valueType},${tx.json(enumOptions)}::jsonb,
          ${tx.json(appliesTo)}::jsonb,false,1,${ids.users.owner}::uuid)
      `;
    }
    const columns = starter.canonicalPayload.table.columns.map((name, index) => ({
      id: randomUUID(),
      name,
      kind: index < 2 ? "property" : "text",
      propertySchemaId: index === 0 ? schemaIds["적산 분류"]
        : index === 1 ? schemaIds["품목 코드"] : null,
    }));
    await tx`
      insert into public.lukas_drawing_tables(
        id,revision_id,project_id,name,columns_json,rows_json,version,created_by
      ) values(${randomUUID()}::uuid,${result.revisionId}::uuid,${ids.project}::uuid,
        '기본 내역',${tx.json(columns)}::jsonb,'[]'::jsonb,1,
        ${ids.users.owner}::uuid)
    `;
    return result;
  }

  async function provePrivilegeMatrix(sql, ids) {
    const tableMatrix = {
      anon: {
        select: false,insert: false,update: false,delete: false,
        truncate: false,references: false,trigger: false,
      },
      authenticated: {
        select: true,insert: true,update: false,delete: false,
        truncate: false,references: false,trigger: false,
      },
      service_role: {
        select: true,insert: false,update: false,delete: false,
        truncate: false,references: false,trigger: false,
      },
    };
    for (const [role, expected] of Object.entries(tableMatrix)) {
      const [actual] = await sql`
        select
          pg_catalog.has_table_privilege(${role},
            'public.lukas_drawing_estimate_bindings','SELECT') "select",
          pg_catalog.has_table_privilege(${role},
            'public.lukas_drawing_estimate_bindings','INSERT') "insert",
          pg_catalog.has_table_privilege(${role},
            'public.lukas_drawing_estimate_bindings','UPDATE') "update",
          pg_catalog.has_table_privilege(${role},
            'public.lukas_drawing_estimate_bindings','DELETE') "delete",
          pg_catalog.has_table_privilege(${role},
            'public.lukas_drawing_estimate_bindings','TRUNCATE') "truncate",
          pg_catalog.has_table_privilege(${role},
            'public.lukas_drawing_estimate_bindings','REFERENCES') "references",
          pg_catalog.has_table_privilege(${role},
            'public.lukas_drawing_estimate_bindings','TRIGGER') "trigger"
      `;
      assert.deepEqual(actual, expected, role);
      const [privateCatalog] = await sql`
        select
          pg_catalog.has_table_privilege(${role},
            'private.lukas_drawing_platform_starters','SELECT') "select",
          pg_catalog.has_table_privilege(${role},
            'private.lukas_drawing_platform_starters','INSERT') "insert",
          pg_catalog.has_table_privilege(${role},
            'private.lukas_drawing_platform_starters','UPDATE') "update",
          pg_catalog.has_table_privilege(${role},
            'private.lukas_drawing_platform_starters','DELETE') "delete",
          pg_catalog.has_table_privilege(${role},
            'private.lukas_drawing_platform_starters','TRUNCATE') "truncate",
          pg_catalog.has_table_privilege(${role},
            'private.lukas_drawing_platform_starters','REFERENCES') "references",
          pg_catalog.has_table_privilege(${role},
            'private.lukas_drawing_platform_starters','TRIGGER') "trigger"
      `;
      assert.deepEqual(privateCatalog, {
        select: false,insert: false,update: false,delete: false,
        truncate: false,references: false,trigger: false,
      }, `${role} private starter catalog`);
    }
    const denied = [
      "private.lukas_drawing_document_creation_result(uuid)",
      "private.lukas_drawing_estimate_binding_guard()",
      "private.lukas_drawing_platform_starter_guard()",
    ];
    const checked = [
      "private.lukas_drawing_create_document_idempotent(uuid,uuid,text,boolean,uuid,uuid)",
      "private.lukas_drawing_list_platform_starters(uuid,uuid)",
      "private.lukas_drawing_ensure_platform_starter_version(uuid,uuid,text,bigint)",
      "private.lukas_drawing_record_platform_starter_import(uuid,uuid,uuid,uuid,uuid,uuid)",
      "public.lukas_drawing_create_document_idempotent(uuid,uuid,text,boolean,uuid,uuid)",
      "public.lukas_drawing_list_platform_starters(uuid,uuid)",
      "public.lukas_drawing_ensure_platform_starter_version(uuid,uuid,text,bigint)",
      "public.lukas_drawing_record_platform_starter_import(uuid,uuid,uuid,uuid,uuid,uuid)",
    ];
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const signature of denied) {
        const [row] = await sql`
          select pg_catalog.has_function_privilege(${role},${signature},'EXECUTE') allowed
        `;
        assert.equal(row.allowed, false, `${role} ${signature}`);
      }
      for (const signature of checked) {
        const [row] = await sql`
          select pg_catalog.has_function_privilege(${role},${signature},'EXECUTE') allowed
        `;
        assert.equal(row.allowed, role !== "anon", `${role} ${signature}`);
      }
    }
    for (const role of ["anon", "authenticated", "service_role"])
      await assertSqlState(
        session(sql, role, role === "anon" ? null : ids.users.owner,
          (tx) => tx`select * from private.lukas_drawing_platform_starters`),
        "42501",
      );
    for (const role of ["anon", "authenticated", "service_role"])
      await assertSqlState(
        session(sql, role, role === "anon" ? null : ids.users.owner,
          (tx) => tx`select private.lukas_drawing_document_creation_result(${randomUUID()}::uuid)`),
        "42501",
      );
    for (const role of ["authenticated", "service_role"])
      await assertSqlState(
        session(sql, role, ids.users.outsider, (tx) => tx`
          select private.lukas_drawing_ensure_platform_starter_version(
            ${ids.organization}::uuid,${ids.project}::uuid,'interior-basic',1)
        `),
        "P1R01",
      );
  }

  async function proveCreationConcurrencyAndIdentity(owner, workerA, workerB, ids) {
    const requestId = randomUUID();
    const [first, second] = await Promise.all([
      createDocument(workerA, "authenticated", ids.users.editor, ids.project,
        "Concurrent M1 drawing", requestId),
      createDocument(workerB, "authenticated", ids.users.editor, ids.project,
        "Concurrent M1 drawing", requestId),
    ]);
    assert.deepEqual(first, second);
    ids.documents.push(first.documentId);
    ids.revisions.push(first.revisionId);
    const [count] = await owner`
      select pg_catalog.count(*)::integer count
      from public.lukas_drawing_documents
      where project_id=${ids.project}::uuid and created_by=${ids.users.editor}::uuid
        and creation_request_id=${requestId}::uuid
    `;
    assert.equal(count.count, 1);
    await assertSqlState(
      createDocument(workerA, "authenticated", ids.users.editor, ids.project,
        "Changed M1 drawing", requestId),
      "P1C01",
    );
    await assertSqlState(
      createDocument(workerA, "authenticated", ids.users.editor, ids.project,
        "Concurrent M1 drawing", requestId, randomUUID()),
      "P1C01",
    );

    for (const [label, actor] of [
      ["Editor", ids.users.editor],
      ["Admin", ids.users.owner],
    ]) {
      const legacy = await createLegacyDocument(owner, actor, ids.project,
        `${label} legacy identity attack`);
      ids.documents.push(legacy.documentId);
      ids.revisions.push(legacy.revisionId);
      const forgedRequest = randomUUID();
      const forgedSha = sha("a");
      await assertSqlState(
        session(owner, "authenticated", actor, async (tx) => {
          await tx`select pg_catalog.set_config('lukas.drawing_creation_identity',
            ${`${legacy.documentId}:${forgedRequest}:${forgedSha}`},true)`;
          return tx`
            update public.lukas_drawing_documents set
              creation_request_id=${forgedRequest}::uuid,
              creation_request_sha256=${forgedSha}
            where id=${legacy.documentId}::uuid
          `;
        }),
        "P1C01",
      );
      await assertSqlState(
        session(owner, "authenticated", actor, (tx) => tx`
          insert into public.lukas_drawing_documents(
            id,project_id,title,created_by,creation_request_id,creation_request_sha256
          ) values(${randomUUID()}::uuid,${ids.project}::uuid,${`${label} forged insert`},
            ${actor}::uuid,${forgedRequest}::uuid,${forgedSha})
        `),
        ["42501", "P1C01"],
      );
      const checkedRequest = randomUUID();
      const checked = await createDocument(owner, "authenticated", actor, ids.project,
        `${label} checked identity`, checkedRequest);
      ids.documents.push(checked.documentId);
      ids.revisions.push(checked.revisionId);
      assert.deepEqual(
        await createDocument(owner, "authenticated", actor, ids.project,
          `${label} checked identity`, checkedRequest),
        checked,
      );
      const [stored] = await owner`
        select creation_request_id,creation_request_sha256
        from public.lukas_drawing_documents where id=${checked.documentId}::uuid
      `;
      for (const mutation of [
        { request: null, digest: null },
        { request: randomUUID(), digest: sha("b") },
      ])
        await assertSqlState(
          session(owner, "authenticated", actor, async (tx) => {
            await tx`select pg_catalog.set_config('lukas.drawing_creation_identity',
              ${`${checked.documentId}:${mutation.request ?? ""}:${mutation.digest ?? ""}`},true)`;
            return tx`
              update public.lukas_drawing_documents set
                creation_request_id=${mutation.request}::uuid,
                creation_request_sha256=${mutation.digest}
              where id=${checked.documentId}::uuid
            `;
          }),
          "P1C01",
        );
      const [unchanged] = await owner`
        select creation_request_id,creation_request_sha256
        from public.lukas_drawing_documents where id=${checked.documentId}::uuid
      `;
      assert.deepEqual(unchanged, stored);
    }
    return first;
  }

  async function proveAuthenticatedEditorOperationBoundary(owner, ids, document) {
    const editor = ids.users.editor;
    const pageId = randomUUID();
    const canvasId = randomUUID();
    const layerId = randomUUID();
    const objectId = randomUUID();
    const page = {
      id: pageId,
      revisionId: document.revisionId,
      name: "Editor page",
      sortOrder: 1,
      version: 1,
    };
    const canvas = {
      id: canvasId,
      pageId,
      name: "Editor paper",
      spaceKind: "paper",
      widthMillimeters: 420,
      heightMillimeters: 297,
      background: null,
      sortOrder: 0,
      version: 1,
    };
    const layer = {
      id: layerId,
      name: "Editor work",
      visible: true,
      locked: false,
      systemKind: "custom",
      canvasId,
      sortOrder: 0,
      version: 1,
    };
    const updatedPage = { ...page, name: "Editor page updated" };

    const [directPrivileges] = await owner`
      select
        pg_catalog.has_table_privilege(
          'authenticated','public.lukas_drawing_pages','INSERT,UPDATE,DELETE'
        ) pages,
        pg_catalog.has_table_privilege(
          'authenticated','public.lukas_drawing_objects','INSERT,UPDATE,DELETE'
        ) objects
    `;
    assert.deepEqual(
      directPrivileges,
      { pages: false, objects: false },
      "drawing mutations stay operation-only",
    );

    const apply = (baseVersions, forward, inverse) =>
      session(
        owner,
        "authenticated",
        editor,
        (tx) => tx`
        select public.lukas_drawing_apply_operation(
          ${document.revisionId}::uuid,${randomUUID()}::uuid,
          'mutate_structure',${tx.json(baseVersions)}::jsonb,
          ${tx.json({ type: "mutate_structure", actions: forward })}::jsonb,
          ${tx.json({ type: "mutate_structure", actions: inverse })}::jsonb
        ) value
      `,
      );

    await apply(
      {},
      [
        { kind: "put_page", entity: page, baseVersion: null },
        { kind: "put_canvas", entity: canvas, baseVersion: null },
        { kind: "put_layer", entity: layer, baseVersion: null },
      ],
      [
        { kind: "delete_layer", id: layerId, baseVersion: 1 },
        { kind: "delete_canvas", id: canvasId, baseVersion: 1 },
        { kind: "delete_page", id: pageId, baseVersion: 1 },
      ],
    );
    await assertSqlState(
      session(
        owner,
        "authenticated",
        editor,
        (tx) => tx`
        update public.lukas_drawing_pages
        set name='Forbidden direct page update' where id=${pageId}::uuid
      `,
      ),
      "42501",
    );
    await assertSqlState(
      session(
        owner,
        "authenticated",
        editor,
        (tx) => tx`
        delete from public.lukas_drawing_pages where id=${pageId}::uuid
      `,
      ),
      "42501",
    );
    await apply(
      { [pageId]: 1 },
      [{ kind: "put_page", entity: updatedPage, baseVersion: 1 }],
      [{ kind: "put_page", entity: page, baseVersion: 2 }],
    );
    const [rpcUpdatedPage] = await owner`
      select name,version::integer version
      from public.lukas_drawing_pages where id=${pageId}::uuid
    `;
    assert.deepEqual(rpcUpdatedPage, { name: updatedPage.name, version: 2 });
    await apply(
      { [pageId]: 2, [canvasId]: 1, [layerId]: 1 },
      [
        { kind: "delete_layer", id: layerId, baseVersion: 1 },
        { kind: "delete_canvas", id: canvasId, baseVersion: 1 },
        { kind: "delete_page", id: pageId, baseVersion: 2 },
      ],
      [
        {
          kind: "put_page",
          entity: { ...updatedPage, version: 2 },
          baseVersion: null,
        },
        { kind: "put_canvas", entity: canvas, baseVersion: null },
        { kind: "put_layer", entity: layer, baseVersion: null },
      ],
    );
    const [rpcDeletedPage] = await owner`
      select pg_catalog.count(*)::integer count
      from public.lukas_drawing_pages where id=${pageId}::uuid
    `;
    assert.equal(rpcDeletedPage.count, 0);

    const object = {
      id: objectId,
      name: "Editor object",
      layerId: document.workLayerId,
      geometry: { type: "line", start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
      style: { stroke: "#112233", strokeWidth: 1, fill: null },
      version: 1,
    };
    const [added] = await session(
      owner,
      "authenticated",
      editor,
      (tx) => tx`
      select public.lukas_drawing_apply_operation(
        ${document.revisionId}::uuid,${randomUUID()}::uuid,'add_objects',
        '{}'::jsonb,
        ${tx.json({ type: "add_objects", objects: [object] })}::jsonb,
        ${tx.json({ type: "delete_objects", objectIds: [objectId] })}::jsonb
      ) value
    `,
    );
    assert.equal(added.value.resultVersions[objectId], 1);

    await assertSqlState(
      session(
        owner,
        "authenticated",
        editor,
        (tx) => tx`
        update public.lukas_drawing_objects
        set name='Forbidden direct object update'
        where id=${objectId}::uuid
      `,
      ),
      "42501",
    );
    const [updated] = await session(
      owner,
      "authenticated",
      editor,
      (tx) => tx`
      select public.lukas_drawing_apply_operation(
        ${document.revisionId}::uuid,${randomUUID()}::uuid,'update_objects',
        ${tx.json({ [objectId]: 1 })}::jsonb,
        ${tx.json({
          type: "update_objects",
          updates: [{ objectId, patch: { name: "Editor object updated" } }],
        })}::jsonb,
        ${tx.json({
          type: "update_objects",
          updates: [{ objectId, patch: { name: object.name } }],
        })}::jsonb
      ) value
    `,
    );
    assert.equal(updated.value.resultVersions[objectId], 2);
    const [updatedObject] = await owner`
      select name,version::integer version,updated_by,status
      from public.lukas_drawing_objects where id=${objectId}::uuid
    `;
    assert.deepEqual(updatedObject, {
      name: "Editor object updated",
      version: 2,
      updated_by: editor,
      status: "active",
    });
    await assertSqlState(
      session(
        owner,
        "authenticated",
        editor,
        (tx) => tx`
        delete from public.lukas_drawing_objects
        where id=${objectId}::uuid
      `,
      ),
      "42501",
    );
    const [deleted] = await session(
      owner,
      "authenticated",
      editor,
      (tx) => tx`
      select public.lukas_drawing_apply_operation(
        ${document.revisionId}::uuid,${randomUUID()}::uuid,'delete_objects',
        ${tx.json({ [objectId]: 2 })}::jsonb,
        ${tx.json({ type: "delete_objects", objectIds: [objectId] })}::jsonb,
        ${tx.json({
          type: "add_objects",
          objects: [{ ...object, name: "Editor object updated", version: 4 }],
        })}::jsonb
      ) value
    `,
    );
    assert.equal(deleted.value.resultVersions[objectId], null);
    const [deletedObject] = await owner`
      select name,version::integer version,status
      from public.lukas_drawing_objects where id=${objectId}::uuid
    `;
    assert.deepEqual(deletedObject, {
      name: "Editor object updated",
      version: 3,
      status: "deleted",
    });
  }

  async function proveBindingAndPurge(owner, ids, concurrentDocument) {
    const deniedDocument = await createDocument(owner, "authenticated", ids.users.owner,
      ids.project, "Denied binding target", randomUUID());
    ids.documents.push(deniedDocument.documentId);
    ids.revisions.push(deniedDocument.revisionId);
    const deniedBinding = {
      id: ids.bindings[0],projectId: ids.project,
      revisionId: deniedDocument.revisionId,boqVersionId: ids.boqs[0],
    };
    for (const denied of [
      { role: "anon", actor: null },
      { role: "authenticated", actor: ids.users.anonymous, options: { anonymous: true } },
      { role: "authenticated", actor: ids.users.outsider },
      { role: "authenticated", actor: ids.users.viewer },
      { role: "authenticated", actor: ids.users.reviewer },
      { role: "authenticated", actor: ids.users.approver },
    ])
      await assertSqlState(
        insertBinding(owner, denied.role, denied.actor,
          { ...deniedBinding, id: randomUUID() }, denied.options),
        "42501",
      );

    const editorBinding = {
      id: ids.bindings[1],projectId: ids.project,
      revisionId: concurrentDocument.revisionId,boqVersionId: ids.boqs[1],
    };
    assert.equal((await insertBinding(owner, "authenticated", ids.users.editor,
      editorBinding))[0].id, editorBinding.id);
    const adminDocument = await createDocument(owner, "authenticated", ids.users.owner,
      ids.project, "Admin binding target", randomUUID());
    ids.documents.push(adminDocument.documentId);
    ids.revisions.push(adminDocument.revisionId);
    const adminBinding = {
      id: ids.bindings[2],projectId: ids.project,
      revisionId: adminDocument.revisionId,boqVersionId: ids.boqs[2],
    };
    assert.equal((await insertBinding(owner, "authenticated", ids.users.owner,
      adminBinding))[0].id, adminBinding.id);
    await assertSqlState(
      insertBinding(owner, "service_role", null,
        { ...deniedBinding, id: randomUUID() }),
      "42501",
    );
    const foreignDocument = await createDocument(
      owner,"authenticated",ids.users.owner,ids.foreignProject,
      "Foreign-project composite identity",randomUUID(),
    );
    ids.documents.push(foreignDocument.documentId);
    ids.revisions.push(foreignDocument.revisionId);
    for (const mismatch of [
      {
        id: ids.bindings[3],revisionId: deniedDocument.revisionId,
        boqVersionId: ids.boqs[8],
      },
      {
        id: ids.bindings[5],revisionId: foreignDocument.revisionId,
        boqVersionId: ids.boqs[0],
      },
    ])
      await assertSqlState(
        owner`
          insert into public.lukas_drawing_estimate_bindings(
            id,project_id,drawing_revision_id,boq_version_id,created_by
          ) values(${mismatch.id}::uuid,${ids.project}::uuid,
            ${mismatch.revisionId}::uuid,${mismatch.boqVersionId}::uuid,
            ${ids.users.owner}::uuid)
        `,
        "23503",
      );
    for (const [role, actor] of [
      ["authenticated", ids.users.editor],
      ["authenticated", ids.users.owner],
      ["service_role", null],
    ]) {
      await assertSqlState(
        session(owner, role, actor, (tx) => tx`
          update public.lukas_drawing_estimate_bindings
          set created_at=pg_catalog.clock_timestamp()
          where id=${editorBinding.id}::uuid
        `),
        ["42501", "P1C01"],
      );
      await assertSqlState(
        session(owner, role, actor, (tx) => tx`
          delete from public.lukas_drawing_estimate_bindings
          where id=${editorBinding.id}::uuid
        `),
        ["42501", "P1C01"],
      );
    }
    for (const [role, actor] of [
      ["authenticated", ids.users.owner],
      ["service_role", null],
    ])
      await assertSqlState(
        session(owner, role, actor, (tx) => tx`
          delete from public.lukas_qto_projects where id=${ids.project}::uuid
        `),
        ["42501", "P7R03"],
      );

    const purgeDocument = await createDocument(owner, "authenticated", ids.users.owner,
      ids.purgeProject, "Purge binding target", randomUUID());
    ids.documents.push(purgeDocument.documentId);
    ids.revisions.push(purgeDocument.revisionId);
    await insertBinding(owner, "authenticated", ids.users.owner, {
      id: ids.bindings[4],projectId: ids.purgeProject,
      revisionId: purgeDocument.revisionId,boqVersionId: ids.boqs[9],
    });
    const [purgeLayer] = await owner`
      select id from public.lukas_drawing_layers
      where revision_id=${purgeDocument.revisionId}::uuid
      order by sort_order,id limit 1
    `;
    const [purgePage] = await owner`
      select id from public.lukas_drawing_pages
      where revision_id=${purgeDocument.revisionId}::uuid
      order by sort_order,id limit 1
    `;
    assert.ok(purgeLayer?.id, "purge fixture layer is required");
    assert.ok(purgePage?.id, "purge fixture page is required");
    await assertSqlState(
      owner.begin(async (tx) => {
        await tx`select pg_catalog.set_config(
          'request.jwt.claims','{"role":"service_role"}',true
        )`;
        await tx`select pg_catalog.set_config(
          'app.lukas_retention_purge_project',${ids.purgeProject},true
        )`;
        return tx`
          delete from public.lukas_drawing_estimate_bindings
          where id=${ids.bindings[4]}::uuid
        `;
      }),
      "P1C01",
    );
    await assertSqlState(
      owner.begin(async (tx) => {
        await tx`select pg_catalog.set_config(
          'request.jwt.claims','{"role":"service_role"}',true
        )`;
        await tx`select pg_catalog.set_config(
          'app.lukas_retention_purge_project',${ids.purgeProject},true
        )`;
        return tx`
          delete from public.lukas_drawing_layers
          where id=${purgeLayer.id}::uuid
        `;
      }),
      "P0001",
    );
    await assertSqlState(
      owner.begin(async (tx) => {
        await tx`select pg_catalog.set_config(
          'request.jwt.claims','{"role":"service_role"}',true
        )`;
        await tx`select pg_catalog.set_config(
          'app.lukas_retention_purge_project',${ids.purgeProject},true
        )`;
        return tx`
          delete from public.lukas_drawing_pages
          where id=${purgePage.id}::uuid
        `;
      }),
      "P0001",
    );
    await owner.begin(async (tx) => {
      const [draftGuardSecurity] = await tx`
        select p.prosecdef security_definer
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname='private'
          and p.proname='lukas_drawing_draft_child_guard'
      `;
      assert.deepEqual(draftGuardSecurity, { security_definer: false });
      const guardOwners = await tx`
        select c.relname,current_user,
          pg_catalog.pg_get_userbyid(c.relowner) table_owner
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public'
          and c.relname in(
            'lukas_drawing_pages','lukas_drawing_layers',
            'lukas_drawing_estimate_bindings'
          )
        order by c.relname
      `;
      assert.deepEqual(
        guardOwners.map(({ relname }) => relname),
        [
          "lukas_drawing_estimate_bindings","lukas_drawing_layers",
          "lukas_drawing_pages",
        ],
      );
      assert.deepEqual(
        guardOwners.map(({ relname,current_user,table_owner }) => ({
          relname,current_user,table_owner,
        })),
        guardOwners.map(({ relname,current_user }) => ({
          relname,current_user,table_owner:current_user,
        })),
      );
      await tx.unsafe(`
        create temporary table m1_nested_purge_probe(
          layer_id uuid primary key
        ) on commit drop;
        create temporary table m1_nested_binding_probe(
          binding_id uuid primary key
        ) on commit drop;
        create temporary table m1_nested_draft_probe(
          page_id uuid primary key
        ) on commit drop;
        create function pg_temp.m1_nested_purge_delete()
        returns trigger language plpgsql set search_path='' as $m1$
        begin
          delete from public.lukas_drawing_layers where id=old.layer_id;
          return old;
        end
        $m1$;
        create trigger m1_nested_purge_delete
        before delete on m1_nested_purge_probe
        for each row execute function pg_temp.m1_nested_purge_delete();
        create function pg_temp.m1_nested_binding_delete()
        returns trigger language plpgsql set search_path='' as $m1$
        begin
          delete from public.lukas_drawing_estimate_bindings
          where id=old.binding_id;
          return old;
        end
        $m1$;
        create trigger m1_nested_binding_delete
        before delete on m1_nested_binding_probe
        for each row execute function pg_temp.m1_nested_binding_delete();
        create function pg_temp.m1_nested_draft_delete()
        returns trigger language plpgsql set search_path='' as $m1$
        begin
          delete from public.lukas_drawing_pages where id=old.page_id;
          return old;
        end
        $m1$;
        create trigger m1_nested_draft_delete
        before delete on m1_nested_draft_probe
        for each row execute function pg_temp.m1_nested_draft_delete();
      `);
      await tx`
        insert into m1_nested_purge_probe(layer_id)
        values(${purgeLayer.id}::uuid)
      `;
      await tx`
        insert into m1_nested_binding_probe(binding_id)
        values(${ids.bindings[4]}::uuid)
      `;
      await tx`
        insert into m1_nested_draft_probe(page_id)
        values(${purgePage.id}::uuid)
      `;
      await tx`select pg_catalog.set_config(
        'app.lukas_retention_purge_project',${ids.purgeProject},true
      )`;
      await assertSqlState(
        tx.savepoint((sp) => sp`
          delete from m1_nested_purge_probe where layer_id=${purgeLayer.id}::uuid
        `),
        "P0001",
      );
      await assertSqlState(
        tx.savepoint((sp) => sp`
          delete from m1_nested_binding_probe
          where binding_id=${ids.bindings[4]}::uuid
        `),
        "P1C01",
      );
      await assertSqlState(
        tx.savepoint((sp) => sp`
          delete from m1_nested_draft_probe
          where page_id=${purgePage.id}::uuid
        `),
        "P0001",
      );
      const [attackResidue] = await tx`
        select
          (select pg_catalog.count(*)::integer
           from public.lukas_drawing_layers where id=${purgeLayer.id}::uuid) layers,
          (select pg_catalog.count(*)::integer
           from public.lukas_drawing_estimate_bindings
           where id=${ids.bindings[4]}::uuid) bindings,
          (select pg_catalog.count(*)::integer
           from public.lukas_drawing_pages where id=${purgePage.id}::uuid) pages,
          (select pg_catalog.count(*)::integer
           from public.lukas_qto_projects where id=${ids.purgeProject}::uuid) projects
      `;
      assert.deepEqual(
        attackResidue,
        { layers: 1, bindings: 1, pages: 1, projects: 1 },
      );
    });
    await session(owner, "authenticated", ids.users.owner, async (tx) => {
      await tx`
        select public.lukas_qto_set_retention_policy(
          ${ids.organization}::uuid,0,365,'M1 purge policy',${randomUUID()}::uuid)
      `;
      await tx`
        select public.lukas_qto_request_project_deletion(
          ${ids.organization}::uuid,${ids.purgeProject}::uuid,
          'M1 draft-only purge',${randomUUID()}::uuid)
      `;
    });
    const [ready] = await session(owner, "service_role", null, (tx) => tx`
      select public.lukas_qto_purge_project(
        ${ids.organization}::uuid,${ids.purgeProject}::uuid,
        ${randomUUID()}::uuid,'M1 service purge') value
    `);
    assert.equal(ready.value.status, "STORAGE_REQUIRED");
    assert.equal(Number(ready.value.dependencies.immutableFiles), 1);
    const [purged] = await session(owner, "service_role", null, (tx) => tx`
      select public.lukas_qto_finalize_project_purge(
        ${ids.organization}::uuid,${ids.purgeProject}::uuid,
        ${ready.value.eventId}::uuid,${ready.value.manifestSha256},
        ${randomUUID()}::uuid,'M1 storage verified absent') value
    `);
    assert.equal(purged.value.status, "PURGED");
    const [counts] = await owner`
      select
        (select pg_catalog.count(*)::integer from public.lukas_qto_projects
          where id=${ids.purgeProject}::uuid) projects,
        (select pg_catalog.count(*)::integer from public.lukas_drawing_estimate_bindings
          where id=${ids.bindings[4]}::uuid) bindings,
        (select pg_catalog.count(*)::integer from public.lukas_drawing_pages
          where id=${purgePage.id}::uuid) pages
    `;
    assert.deepEqual(counts, { projects: 0, bindings: 0, pages: 0 });
  }

  async function proveStarterRollback(owner, ids) {
    const rollback = new Error("M1 starter fixture rollback");
    try {
      await owner.begin(async (tx) => {
        await tx`select pg_catalog.set_config(
          'request.jwt.claims',${JSON.stringify({
            role: "authenticated",sub: ids.users.owner,
            is_anonymous: false,app_metadata: {},
          })},true
        )`;
        const before = await tx`
          select key,version,canonical_payload::text payload,content_sha256,
            pg_catalog.encode(extensions.digest(
              pg_catalog.convert_to(canonical_payload::text,'UTF8'),'sha256'
            ),'hex') recomputed
          from private.lukas_drawing_platform_starters order by key
        `;
        assert.deepEqual(
          before.map(({ key, version }) => ({ key, version: Number(version) })),
          [
            { key: "apartment-remodel", version: 1 },
            { key: "commercial-interior", version: 1 },
            { key: "demolition-restoration", version: 1 },
            { key: "interior-basic", version: 1 },
          ],
        );
        for (const starter of before)
          assert.equal(starter.content_sha256, starter.recomputed);
        const [firstEnsure] = await tx`
          select public.lukas_drawing_ensure_platform_starter_version(
            ${ids.organization}::uuid,${ids.project}::uuid,'interior-basic',1) value
        `;
        const [secondEnsure] = await tx`
          select public.lukas_drawing_ensure_platform_starter_version(
            ${ids.organization}::uuid,${ids.project}::uuid,'interior-basic',1) value
        `;
        assert.deepEqual(secondEnsure.value, firstEnsure.value);
        const starter = firstEnsure.value;
        const duplicateRegistry = randomUUID();
        await tx`
          insert into public.lukas_drawing_library_entries(
            id,organization_id,kind,name,created_by
          ) values(${duplicateRegistry}::uuid,${ids.organization}::uuid,
            'workspace_template','M1 duplicate starter index probe',
            ${ids.users.owner}::uuid)
        `;
        await assertSqlState(
          tx.savepoint((sp) => sp`
            insert into public.lukas_drawing_library_versions(
              id,registry_id,organization_id,version_no,status,canonical_payload,
              content_sha256,source_kind,platform_starter_key,
              platform_starter_version,created_by
            ) values(${randomUUID()}::uuid,${duplicateRegistry}::uuid,
              ${ids.organization}::uuid,1,'draft',
              ${tx.json(starter.canonicalPayload)}::jsonb,${starter.contentSha256},
              'platform_starter','interior-basic',1,${ids.users.owner}::uuid)
          `),
          "23505",
        );
        const target = await scaffoldStarter(tx, ids, starter, "one");
        const changedTarget = await scaffoldStarter(tx, ids, starter, "two");
        const requestId = randomUUID();
        const [firstImport] = await tx`
          select public.lukas_drawing_record_platform_starter_import(
            ${ids.organization}::uuid,${starter.versionId}::uuid,
            ${ids.project}::uuid,${target.documentId}::uuid,
            ${target.revisionId}::uuid,${requestId}::uuid) value
        `;
        const [retry] = await tx`
          select public.lukas_drawing_record_platform_starter_import(
            ${ids.organization}::uuid,${starter.versionId}::uuid,
            ${ids.project}::uuid,${target.documentId}::uuid,
            ${target.revisionId}::uuid,${requestId}::uuid) value
        `;
        assert.deepEqual(retry.value, firstImport.value);
        const [count] = await tx`
          select pg_catalog.count(*)::integer count
          from public.lukas_drawing_library_imports
          where imported_by=${ids.users.owner}::uuid and client_request_id=${requestId}::uuid
        `;
        assert.equal(count.count, 1);
        await assertSqlState(
          tx.savepoint((sp) => sp`
            select public.lukas_drawing_record_platform_starter_import(
              ${ids.organization}::uuid,${starter.versionId}::uuid,
              ${ids.project}::uuid,${changedTarget.documentId}::uuid,
              ${changedTarget.revisionId}::uuid,${requestId}::uuid)
          `),
          "P1C01",
        );
        const after = await tx`
          select key,version,canonical_payload::text payload,content_sha256,
            pg_catalog.encode(extensions.digest(
              pg_catalog.convert_to(canonical_payload::text,'UTF8'),'sha256'
            ),'hex') recomputed
          from private.lukas_drawing_platform_starters order by key
        `;
        assert.deepEqual(after, before);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    const [residue] = await owner`
      select
        (select pg_catalog.count(*)::integer
         from public.lukas_drawing_library_versions
         where organization_id=${ids.organization}::uuid
           and source_kind='platform_starter') versions,
        (select pg_catalog.count(*)::integer
         from public.lukas_drawing_library_imports
         where organization_id=${ids.organization}::uuid) imports
    `;
    assert.deepEqual(residue, { versions: 0, imports: 0 });
  }

  test(
    "M1 real PostgreSQL proves Editor operations, idempotency, starter provenance, and binding authority",
    { timeout: 180_000 },
    async () => {
      const { default: postgres } = await import("postgres");
      const databaseName = `m1_${process.pid}_${randomBytes(6).toString("hex")}`;
      const admin = postgres(databaseUrl, { max: 1, prepare: false });
      const ids = fixtureIds();
      const projectIds = [ids.project, ids.foreignProject, ids.purgeProject];
      const roleState = [];
      let owner;
      let workerA;
      let workerB;
      let schemaReady = false;
      let databaseCleanupIntent = false;
      let primaryError;
      const cleanupErrors = [];
      try {
        const [{ current_user: currentUser }] = await admin`select current_user`;
        for (const role of appRoles) {
          const state = { role, dropIntent: false, revokeIntent: false };
          roleState.push(state);
          const [existing] = await admin`
            select exists(select 1 from pg_catalog.pg_roles where rolname=${role}) present
          `;
          if (!existing.present) {
            state.dropIntent = true;
            await admin.unsafe(
              `create role ${quoteIdentifier(role)} nologin${role === "service_role" ? " bypassrls" : ""}`,
            );
          }
          const [membership] = await admin`
            select pg_catalog.pg_has_role(${currentUser},${role},'MEMBER') member
          `;
          if (!membership.member) {
            state.revokeIntent = true;
            await admin.unsafe(
              `grant ${quoteIdentifier(role)} to ${quoteIdentifier(currentUser)}`,
            );
          }
        }
        const [databasePreflight] = await admin`
          select exists(
            select 1 from pg_catalog.pg_database where datname=${databaseName}
          ) present
        `;
        assert.equal(databasePreflight.present, false, "isolated database name collision");
        databaseCleanupIntent = true;
        await admin.unsafe(`create database ${quoteIdentifier(databaseName)}`);
        const targetUrl = isolatedUrl(databaseUrl, databaseName);
        owner = postgres(targetUrl, { max: 1, prepare: false });
        workerA = postgres(targetUrl, { max: 1, prepare: false });
        workerB = postgres(targetUrl, { max: 1, prepare: false });
        await bootstrapDatabase(owner);
        schemaReady = true;
        const [[authority], [sessionA], [sessionB]] = await Promise.all([
          owner`
            select current_user,
              pg_catalog.pg_get_userbyid(c.relowner) table_owner
            from pg_catalog.pg_class c
            join pg_catalog.pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relname='lukas_qto_projects'
          `,
          workerA`select pg_catalog.pg_backend_pid() pid`,
          workerB`select pg_catalog.pg_backend_pid() pid`,
        ]);
        assert.equal(authority.current_user, authority.table_owner);
        assert.notEqual(sessionA.pid, sessionB.pid);
        await seedFixture(owner, ids);
        await provePrivilegeMatrix(owner, ids);
        const concurrent = await proveCreationConcurrencyAndIdentity(
          owner,workerA,workerB,ids,
        );
        await proveAuthenticatedEditorOperationBoundary(owner, ids, concurrent);
        await proveBindingAndPurge(owner, ids, concurrent);
        await proveStarterRollback(owner, ids);
      } catch (error) {
        primaryError = error;
      } finally {
        try {
          if (owner && schemaReady) {
            for (const projectId of projectIds)
              await attemptCleanup(
                cleanupErrors,
                `delete project fixture ${projectId}`,
                () => owner.begin(async (tx) => {
                  await tx`select pg_catalog.set_config(
                    'app.lukas_retention_purge_project',${projectId},true
                  )`;
                  await tx`
                    delete from public.lukas_qto_projects where id=${projectId}::uuid
                  `;
                }),
              );
            await attemptCleanup(cleanupErrors, "verify zero fixture rows", async () => {
              const [residue] = await owner`
                select
                  (select pg_catalog.count(*)::integer from public.lukas_qto_projects
                   where id=any(${projectIds}::uuid[])) projects,
                  (select pg_catalog.count(*)::integer from public.lukas_drawing_documents
                   where project_id=any(${projectIds}::uuid[])) documents,
                  (select pg_catalog.count(*)::integer
                   from public.lukas_drawing_estimate_bindings
                   where project_id=any(${projectIds}::uuid[])) bindings,
                  (select pg_catalog.count(*)::integer from public.lukas_qto_boq_versions
                   where project_id=any(${projectIds}::uuid[])) boqs
              `;
              assert.deepEqual(
                residue,
                { projects: 0, documents: 0, bindings: 0, boqs: 0 },
              );
            });
          }
        } finally {
          try {
            for (const [label, client] of [
              ["table-owner connection", owner],
              ["concurrency connection A", workerA],
              ["concurrency connection B", workerB],
            ])
              if (client)
                await attemptCleanup(
                  cleanupErrors,label,() => client.end({ timeout: 5 }),
                );
          } finally {
            try {
              if (databaseCleanupIntent) {
                await attemptCleanup(cleanupErrors, "terminate isolated database sessions", () => admin`
                  select pg_catalog.pg_terminate_backend(pid)
                  from pg_catalog.pg_stat_activity
                  where datname=${databaseName} and pid<>pg_catalog.pg_backend_pid()
                `);
                await attemptCleanup(cleanupErrors, "drop isolated database", () =>
                  admin.unsafe(`drop database if exists ${quoteIdentifier(databaseName)}`),
                );
              }
            } finally {
              try {
                for (const state of roleState.reverse()) {
                  if (state.revokeIntent)
                    await attemptCleanup(
                      cleanupErrors,
                      `revoke temporary membership ${state.role}`,
                      () => admin.unsafe(`
                        do $m1_cleanup$
                        begin
                          if exists(
                            select 1 from pg_catalog.pg_roles
                            where rolname='${state.role}'
                          ) then
                            execute pg_catalog.format(
                              'revoke %I from %I','${state.role}',current_user
                            );
                          end if;
                        end
                        $m1_cleanup$
                      `),
                    );
                  if (state.dropIntent)
                    await attemptCleanup(
                      cleanupErrors,
                      `drop temporary role ${state.role}`,
                      () => admin.unsafe(`drop role if exists ${quoteIdentifier(state.role)}`),
                    );
                }
              } finally {
                await attemptCleanup(
                  cleanupErrors,"admin connection",() => admin.end({ timeout: 5 }),
                );
              }
            }
          }
        }
      }
      if (primaryError) {
        if (cleanupErrors.length)
          throw new AggregateError(
            [primaryError, ...cleanupErrors],
            "M1 real PostgreSQL proof and cleanup both failed",
          );
        throw primaryError;
      }
      if (cleanupErrors.length)
        throw new AggregateError(
          cleanupErrors,
          "M1 real PostgreSQL cleanup failed",
        );
    },
  );
}
