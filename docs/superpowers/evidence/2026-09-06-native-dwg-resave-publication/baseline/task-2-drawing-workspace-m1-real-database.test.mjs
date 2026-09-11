import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { proveCanonicalCollaborationSocketInitialization } from "./fixtures/drawing-collaboration-canonical-initialization.mjs";
import { proveDwgSourceIngestionAuthority } from "./fixtures/drawing-dwg-source-ingestion-database.mjs";
import { proveNativeDwgExportJobAuthority } from "./fixtures/drawing-native-dwg-jobs-database.mjs";
import { proveNativeDwgImportJobAuthority } from "./fixtures/drawing-native-dwg-import-jobs-database.mjs";
import { proveNativeDwgCanonicalImportAuthority } from "./fixtures/drawing-native-dwg-canonical-import-database.mjs";
import { proveNativeDwgResaveJobAuthority } from "./fixtures/drawing-native-dwg-resave-jobs-database.mjs";
import { proveNativeDwgImportPipeline } from "./fixtures/drawing-native-dwg-import-pipeline.mjs";
import { proveFreshNativeDwgCanonicalPipeline } from "./fixtures/drawing-native-dwg-canonical-pipeline.mjs";

const databaseUrl = process.env.M1_REAL_POSTGRES_DATABASE_URL;
const required = process.env.M1_REAL_POSTGRES_REQUIRED === "1";
const nativeDwgImportPipelineRequired =
  process.env.M1_NATIVE_DWG_IMPORT_PIPELINE_REQUIRED === "1";

if (!databaseUrl) {
  test(
    "M1 real PostgreSQL proves Editor operations, idempotency, starter provenance, and binding authority",
    {
      skip: required || nativeDwgImportPipelineRequired
        ? false : "M1 real PostgreSQL gate is UNEXECUTED",
    },
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

  async function captureSqlError(promise) {
    let captured;
    try {
      await promise;
    } catch (error) {
      captured = error;
    }
    assert.ok(captured, "Expected PostgreSQL operation to fail");
    return captured;
  }

  async function attemptCleanup(errors, label, operation) {
    try {
      await operation();
    } catch (error) {
      errors.push(new Error(`M1 cleanup failed: ${label}`, { cause: error }));
    }
  }

  async function proveRuntimeCanAssumeCollaborationRole(sql) {
    await sql.begin(async (tx) => {
      const [{ session_user: sessionUser }] = await tx`select session_user`;
      assert.equal(sessionUser, "postgres");
      const [membership] = await tx`
        select exists(
          select 1
          from pg_catalog.pg_auth_members membership
          join pg_catalog.pg_roles member on member.oid=membership.member
          join pg_catalog.pg_roles granted on granted.oid=membership.roleid
          where member.rolname=session_user
            and granted.rolname='lukas_drawing_collaboration'
            and membership.set_option
            and not membership.inherit_option
        ) exact_runtime_membership
      `;
      assert.deepEqual(membership, { exact_runtime_membership: true });
      await tx.unsafe("set local role lukas_drawing_collaboration");
      const [{ current_user: currentUser }] = await tx`select current_user`;
      assert.equal(currentUser, "lukas_drawing_collaboration");
    });
  }

  async function proveCollaborationRoleBoundary(sql) {
    const [role] = await sql`
      select
        not rolcanlogin nologin,
        not rolinherit noinherit,
        not exists(
          select 1
          from pg_catalog.pg_class relation
          join pg_catalog.pg_namespace namespace
            on namespace.oid=relation.relnamespace
          where namespace.nspname in ('public','private')
            and relation.relkind in ('r','p')
            and (
              pg_catalog.has_table_privilege(
                'lukas_drawing_collaboration',relation.oid,'SELECT'
              )
              or pg_catalog.has_table_privilege(
                'lukas_drawing_collaboration',relation.oid,'INSERT'
              )
              or pg_catalog.has_table_privilege(
                'lukas_drawing_collaboration',relation.oid,'UPDATE'
              )
              or pg_catalog.has_table_privilege(
                'lukas_drawing_collaboration',relation.oid,'DELETE'
              )
              or pg_catalog.has_table_privilege(
                'lukas_drawing_collaboration',relation.oid,'TRUNCATE'
              )
              or pg_catalog.has_table_privilege(
                'lukas_drawing_collaboration',relation.oid,'REFERENCES'
              )
              or pg_catalog.has_table_privilege(
                'lukas_drawing_collaboration',relation.oid,'TRIGGER'
              )
            )
        ) no_table_privileges
      from pg_catalog.pg_roles
      where rolname='lukas_drawing_collaboration'
    `;
    assert.deepEqual(role, {
      nologin: true,
      noinherit: true,
      no_table_privileges: true,
    });
    const applicationRoleAssumptions = await sql`
      select member.rolname role, membership.set_option set_option
      from pg_catalog.pg_auth_members membership
      join pg_catalog.pg_roles member on member.oid=membership.member
      join pg_catalog.pg_roles granted on granted.oid=membership.roleid
      where granted.rolname='lukas_drawing_collaboration'
        and member.rolname in ('anon','authenticated','service_role')
      order by member.rolname
    `;
    assert.deepEqual(Array.from(applicationRoleAssumptions), []);
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

  async function provePrimitiveMeasurementParity(sql) {
    const measure = async (geometry, kind) => {
      const encoded = sql.json(geometry);
      const [transport] = await sql`
        select pg_catalog.jsonb_typeof(${encoded}::jsonb) geometry_type,
          ${kind}::text kind
      `;
      assert.deepEqual(transport, { geometry_type: "object", kind });
      const [row] = await sql`
        select private.lukas_drawing_p6_measure(
          ${encoded}::jsonb,${kind},null::jsonb
        )::numeric(29,12) value
      `;
      return row.value;
    };
    const [authority] = await sql`
      select pg_catalog.pg_get_functiondef(
        'private.lukas_drawing_p6_measure(jsonb,text,jsonb)'::regprocedure
      ) definition
    `;
    assert.match(authority.definition, /v_type in \('wall','grid','line'\)/);
    assert.equal(
      await measure(
        { type: "line", start: { x: 0, y: 0 }, end: { x: 300, y: 400 } },
        "length",
      ),
      "0.500000000000",
    );
    assert.equal(
      await measure(
        {
          type: "polyline",
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 0 },
          ],
          closed: true,
        },
        "length",
      ),
      "0.004828428000",
    );
    const rectangle = {
      type: "rectangle",
      origin: { x: 10, y: 20 },
      width: 200,
      height: 100,
      rotation: 30,
    };
    assert.equal(await measure(rectangle, "length"), "0.600000000000");
    assert.equal(await measure(rectangle, "area"), "0.020000000000");
    const circle = {
      type: "circle",
      center: { x: 0, y: 0 },
      radius: 30,
    };
    assert.equal(await measure(circle, "length"), "0.188495559000");
    assert.equal(await measure(circle, "area"), "0.002827433388");
    assert.equal(await measure(circle, "count"), "1.000000000000");
  }

  async function proveCalibratedPdfQuantityAuthority(owner, ids) {
    const document = await createDocument(
      owner,
      "authenticated",
      ids.users.editor,
      ids.project,
      "M1 calibrated PDF quantity authority",
      randomUUID(),
    );
    ids.documents.push(document.documentId);
    ids.revisions.push(document.revisionId);
    const sourceFileId = randomUUID();
    const sourceSha256 = sha("9");
    const sourceStoragePath = `m1/${ids.project}/calibrated.pdf`;
    await owner`
      insert into public.lukas_qto_files(
        id,project_id,uploaded_by,kind,storage_path,original_filename,
        content_type,byte_size,sha256,immutable
      ) values(
        ${sourceFileId}::uuid,${ids.project}::uuid,${ids.users.editor}::uuid,
        'pdf',${sourceStoragePath},'calibrated.pdf',
        'application/pdf',1,${sourceSha256},true
      )
    `;
    await owner`
      insert into storage.objects(id,bucket_id,name)
      values(${randomUUID()}::uuid,'lukas-qto',${sourceStoragePath})
    `;
    const calibration = {
      normalizedStart: { x: 0, y: 0 },
      normalizedEnd: { x: 1, y: 0 },
      realLengthMillimeters: 10_000,
      millimetersPerNormalizedUnit: 10_000,
    };
    await session(owner, "authenticated", ids.users.editor, (tx) => tx`
      select public.lukas_drawing_attach_source(
        ${document.documentId}::uuid,${document.revisionId}::uuid,
        ${document.canvasId}::uuid,${sourceFileId}::uuid,${randomUUID()}::uuid
      )
    `);
    const [storedCanvas] = await owner`
      select private.lukas_drawing_structure_entity_json(
        'canvas',${document.canvasId}::uuid,${document.revisionId}::uuid,
        ${ids.project}::uuid
      ) entity
    `;
    const calibratedCanvas = {
      ...storedCanvas.entity,
      widthMillimeters: 100,
      heightMillimeters: 100,
      background: {
        ...storedCanvas.entity.background,
        calibration,
      },
    };
    await session(owner, "authenticated", ids.users.editor, (tx) => tx`
      select public.lukas_drawing_apply_operation(
        ${document.revisionId}::uuid,${randomUUID()}::uuid,'mutate_structure',
        ${tx.json({ [document.canvasId]: storedCanvas.entity.version })}::jsonb,
        ${tx.json({
          type: "mutate_structure",
          actions: [{
            kind: "put_canvas",
            entity: calibratedCanvas,
            baseVersion: storedCanvas.entity.version,
          }],
        })}::jsonb,
        ${tx.json({
          type: "mutate_structure",
          actions: [{
            kind: "put_canvas",
            entity: storedCanvas.entity,
            baseVersion: storedCanvas.entity.version + 1,
          }],
        })}::jsonb
      )
    `);
    const objectId = randomUUID();
    const drawingObject = {
      id: objectId,
      name: "Calibrated five metre line",
      layerId: document.workLayerId,
      geometry: {
        type: "line",
        start: { x: 10, y: 50 },
        end: { x: 60, y: 50 },
      },
      style: { stroke: "#112233", strokeWidth: 1, fill: null },
      version: 1,
    };
    await session(owner, "authenticated", ids.users.editor, (tx) => tx`
      select public.lukas_drawing_apply_operation(
        ${document.revisionId}::uuid,${randomUUID()}::uuid,'add_objects',
        '{}'::jsonb,
        ${tx.json({ type: "add_objects", objects: [drawingObject] })}::jsonb,
        ${tx.json({ type: "delete_objects", objectIds: [objectId] })}::jsonb
      )
    `);
    await session(owner, "authenticated", ids.users.editor, (tx) => tx`
      select public.lukas_drawing_request_review(${document.revisionId}::uuid)
    `);
    const [subject] = await owner`
      select r.version,s.sha256 snapshot_sha256
      from public.lukas_drawing_revisions r
      join public.lukas_drawing_snapshots s
        on s.revision_id=r.id and s.project_id=r.project_id
          and s.revision_version=r.version
      where r.id=${document.revisionId}::uuid
    `;
    await session(owner, "authenticated", ids.users.reviewer, (tx) => tx`
      select public.lukas_drawing_record_revision_decision(
        ${document.revisionId}::uuid,${subject.version}::bigint,
        ${subject.snapshot_sha256},'reviewed','Calibrated PDF authority review'
      )
    `);
    await session(owner, "authenticated", ids.users.approver, (tx) => tx`
      select public.lukas_drawing_record_revision_decision(
        ${document.revisionId}::uuid,${subject.version}::bigint,
        ${subject.snapshot_sha256},'approved','Calibrated PDF authority approval'
      )
    `);
    const [identity] = await owner`
      select o.lineage_id,o.version::integer version,
        pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
          private.lukas_drawing_p6_canonical_json(pg_catalog.jsonb_build_object(
            'geometry',snapshot_object.value->'geometry',
            'id',snapshot_object.value->'id',
            'name',snapshot_object.value->'name',
            'version',snapshot_object.value->'version'
          )),'UTF8'),'sha256'),'hex') fingerprint
      from public.lukas_drawing_objects o
      join public.lukas_drawing_snapshots s
        on s.revision_id=o.revision_id and s.sha256=${subject.snapshot_sha256}
      cross join lateral pg_catalog.jsonb_array_elements(
        s.canonical_json->'objects'
      ) snapshot_object
      where o.id=${objectId}::uuid
        and snapshot_object.value->>'id'=o.id::text
    `;
    const insertQuantity = (tx, id, snapshotSha256, rawQuantity) => tx`
        select (private.lukas_drawing_insert_quantity_link(
          ${ids.users.owner}::uuid,${id}::uuid,${document.revisionId}::uuid,
          ${objectId}::uuid,'length',${snapshotSha256},
          ${identity.lineage_id}::uuid,${identity.version}::bigint,
          ${identity.fingerprint},${rawQuantity}::numeric,'m','P4_MEASUREMENT_V1'
        )).*
      `;
    const serviceTransaction = (callback) => owner.begin(async (tx) => {
      await tx.unsafe("set local role service_role");
      await tx`select pg_catalog.set_config(
        'request.jwt.claims',${JSON.stringify({
          role: "service_role",
          sub: ids.users.owner,
          is_anonymous: false,
          app_metadata: {},
        })},true
      )`;
      return callback(tx);
    });
    const rawError = await captureSqlError(serviceTransaction((tx) =>
      insertQuantity(
        tx,randomUUID(),subject.snapshot_sha256,"0.050000000000",
      ),
    ));
    assert.equal(rawError.code, "P6Q01");
    const shaError = await captureSqlError(serviceTransaction((tx) =>
      insertQuantity(tx,randomUUID(),sha("f"),"5.000000000000"),
    ));
    assert.equal(shaError.code, "P6Q03");
    const rollbackProof = new Error("rollback calibrated quantity proof");
    await assert.rejects(
      serviceTransaction(async (tx) => {
        const [quantity] = await insertQuantity(
          tx,randomUUID(),subject.snapshot_sha256,"5.000000000000",
        );
        assert.equal(quantity.raw_quantity, "5.000000000000");
        throw rollbackProof;
      }),
      (error) => error === rollbackProof,
    );
    await assert.rejects(
      owner.begin(async (tx) => {
        await tx`select pg_catalog.set_config(
          'request.jwt.claims',${JSON.stringify({
            role: "authenticated",
            sub: ids.users.editor,
            is_anonymous: false,
            app_metadata: {},
          })},true
        )`;
        return tx`
          update public.lukas_drawing_canvases
          set calibration=pg_catalog.jsonb_set(
            calibration,'{millimetersPerNormalizedUnit}','100'::jsonb
          ),version=version+1
          where id=${document.canvasId}::uuid
        `;
      }),
      /immutable/i,
    );
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
        grant all on sequences to anon,authenticated,service_role;
      alter default privileges in schema public
        grant all on functions to anon,authenticated,service_role;
      create table auth.users(
        id uuid primary key,email text,email_confirmed_at timestamptz,
        deleted_at timestamptz,banned_until timestamptz,
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
      alter table storage.objects enable row level security;
      grant select,insert,update,delete on storage.objects
        to anon,authenticated,service_role;
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
        "quickOwner",
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
    const dataApiTableMatrix = {
      "public.lukas_qto_projects": {
        select: true,insert: true,update: true,delete: false,
      },
      "public.lukas_qto_files": {
        select: true,insert: true,update: false,delete: true,
      },
      "public.lukas_qto_reviews": {
        select: true,insert: true,update: false,delete: false,
      },
      "public.lukas_qto_shares": {
        select: true,insert: true,update: true,delete: true,
      },
      "public.profiles": {
        select: true,insert: false,update: true,delete: true,
      },
      "public.payments": {
        select: true,insert: false,update: false,delete: false,
      },
    };
    for (const [table, expectedDml] of Object.entries(dataApiTableMatrix)) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [actual] = await sql`
          select
            pg_catalog.has_table_privilege(${role},${table},'SELECT') "select",
            pg_catalog.has_table_privilege(${role},${table},'INSERT') "insert",
            pg_catalog.has_table_privilege(${role},${table},'UPDATE') "update",
            pg_catalog.has_table_privilege(${role},${table},'DELETE') "delete",
            pg_catalog.has_table_privilege(${role},${table},'TRUNCATE') "truncate",
            pg_catalog.has_table_privilege(${role},${table},'REFERENCES') "references",
            pg_catalog.has_table_privilege(${role},${table},'TRIGGER') "trigger"
        `;
        assert.deepEqual(
          actual,
          role === "anon"
            ? {
                select: false,insert: false,update: false,delete: false,
                truncate: false,references: false,trigger: false,
              }
            : {
                ...expectedDml,
                truncate: false,references: false,trigger: false,
              },
          `${role} ${table}`,
        );
      }
    }
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
      "private.lukas_drawing_request_collaborative_review(uuid,uuid,text,integer,bigint,jsonb)",
    ];
    const serviceOnly = [
      "private.lukas_drawing_revision_approval_guard()",
      "private.lukas_drawing_record_revision_decision(uuid,bigint,text,text,text)",
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
      "public.lukas_drawing_record_revision_decision(uuid,bigint,text,text,text)",
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
      for (const signature of serviceOnly) {
        const [row] = await sql`
          select pg_catalog.has_function_privilege(${role},${signature},'EXECUTE') allowed
        `;
        assert.equal(
          row.allowed,
          role === "service_role",
          `${role} ${signature}`,
        );
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

  async function provePersonalProjectConcurrency(owner, workerA, workerB, ids) {
    const ensure = (sql) => session(
      sql,
      "authenticated",
      ids.users.quickOwner,
      (tx) => tx`
        select public.lukas_drawing_ensure_personal_project() value
      `,
    );
    const [[first], [second]] = await Promise.all([
      ensure(workerA),
      ensure(workerB),
    ]);
    assert.deepEqual(second.value, first.value);
    const [retry] = await ensure(workerA);
    assert.deepEqual(retry.value, first.value);
    const [state] = await owner`
      select
        (select pg_catalog.count(*)::integer
         from private.lukas_drawing_personal_projects mapping
         where mapping.user_id=${ids.users.quickOwner}::uuid) mappings,
        (select pg_catalog.count(*)::integer
         from public.lukas_qto_projects project
         where project.owner_id=${ids.users.quickOwner}::uuid) projects,
        (select pg_catalog.count(*)::integer
         from public.lukas_qto_organizations organization
         where organization.owner_id=${ids.users.quickOwner}::uuid
           and organization.is_personal) personal_organizations
    `;
    assert.deepEqual(state, {
      mappings: 1,
      projects: 1,
      personal_organizations: 1,
    });
    return first.value;
  }

  async function proveStagedRevisionDecision(owner, ids, document) {
    const [originalDocument] = await owner`
      select title,source_file_id,source_sha256,creation_request_id,creation_request_sha256
      from public.lukas_drawing_documents where id=${document.documentId}::uuid
    `;
    const namedTitle = "Named draft with preserved creation identity";
    const rename = (actor, expectedTitle, title) => session(
      owner, "authenticated", actor, (tx) => tx`
        update public.lukas_drawing_documents set title=${title}
        where id=${document.documentId}::uuid and project_id=${ids.project}::uuid
          and title=${expectedTitle}
        returning id,title,source_file_id,source_sha256,creation_request_id,creation_request_sha256
      `,
    );
    assert.equal((await rename(ids.users.viewer, originalDocument.title, "Viewer forged rename")).length, 0);
    const named = await rename(ids.users.editor, originalDocument.title, namedTitle);
    assert.deepEqual(Array.from(named), [{ ...originalDocument, id: document.documentId, title: namedTitle }]);
    assert.equal((await rename(ids.users.editor, originalDocument.title, "Stale rename")).length, 0);
    await session(owner, "authenticated", ids.users.editor, (tx) => tx`
      select public.lukas_drawing_request_review(${document.revisionId}::uuid)
    `);
    assert.equal((await rename(ids.users.editor, namedTitle, "Frozen rename")).length, 0);
    await assertSqlState(owner`
      update public.lukas_drawing_documents set title='Bypass RLS frozen rename'
      where id=${document.documentId}::uuid
    `, "P0001");
    const [frozenTitle] = await owner`
      select title from public.lukas_drawing_documents where id=${document.documentId}::uuid
    `;
    assert.equal(frozenTitle.title, namedTitle);
    const [subject] = await owner`
      select r.version,r.status,s.sha256 snapshot_sha256
      from public.lukas_drawing_revisions r
      join public.lukas_drawing_snapshots s
        on s.revision_id=r.id and s.project_id=r.project_id
          and s.revision_version=r.version
      where r.id=${document.revisionId}::uuid
    `;
    assert.equal(subject.status, "review_requested");
    const decideRevision = (
      revisionId,
      actorId,
      decision,
      note,
      options = {},
    ) =>
      session(owner, "authenticated", actorId, (tx) => tx`
        select public.lukas_drawing_record_revision_decision(
          ${revisionId}::uuid,${subject.version}::bigint,
          ${subject.snapshot_sha256},${decision},${note}
        )
      `, options);
    const decide = (actorId, decision, note, options = {}) =>
      decideRevision(document.revisionId, actorId, decision, note, options);

    const foreignError = await captureSqlError(
      decide(ids.users.outsider, "reviewed", "foreign target"),
    );
    const missingError = await captureSqlError(
      decideRevision(
        randomUUID(),
        ids.users.outsider,
        "reviewed",
        "missing target",
      ),
    );
    assert.deepEqual(
      { code: foreignError.code, message: foreignError.message },
      { code: missingError.code, message: missingError.message },
    );
    assert.equal(foreignError.code, "P1R01");

    await assertSqlState(
      decide(ids.users.approver, "reviewed", "approver cannot review"),
      "P1R01",
    );

    await owner`
      update public.lukas_qto_project_members set role='reviewer'
      where project_id=${ids.project}::uuid
        and user_id=${ids.users.anonymous}::uuid
    `;
    try {
      await assertSqlState(
        decide(
          ids.users.anonymous,
          "reviewed",
          "anonymous reviewer cannot decide",
          { anonymous: true },
        ),
        "P1R01",
      );
    } finally {
      await owner`
        update public.lukas_qto_project_members set role='estimator'
        where project_id=${ids.project}::uuid
          and user_id=${ids.users.anonymous}::uuid
      `;
    }

    await owner`
      update public.lukas_qto_project_members set role='reviewer'
      where project_id=${ids.project}::uuid
        and user_id=${ids.users.editor}::uuid
    `;
    try {
      await assertSqlState(
        decide(ids.users.editor, "reviewed", "maker cannot review"),
        "P1R01",
      );
    } finally {
      await owner`
        update public.lukas_qto_project_members set role='estimator'
        where project_id=${ids.project}::uuid
          and user_id=${ids.users.editor}::uuid
      `;
    }

    const appendEntitlement = (versionNo, drawingWorkspace) =>
      owner.begin(async (tx) => {
        await tx`select pg_catalog.set_config(
          'request.jwt.claims',${JSON.stringify({
            role: "authenticated",
            sub: ids.users.owner,
            is_anonymous: false,
            app_metadata: {},
          })},true
        )`;
        return tx`
          insert into public.lukas_qto_organization_entitlement_versions(
            id,organization_id,version_no,plan,seat_limit,project_limit,
            library_version_limit,features,reason,request_id,request_sha256,
            created_by
          ) values(
            ${randomUUID()}::uuid,${ids.organization}::uuid,${versionNo},
            'enterprise',100,100,1000,${tx.json({
              drawing_workspace: drawingWorkspace,
              organization_library: true,
              realtime_collaboration: true,
              ifc_workspace: true,
              quantity_lineage: true,
            })}::jsonb,${`M1 decision entitlement ${versionNo}`},
            ${randomUUID()}::uuid,${sha(String(versionNo))},
            ${ids.users.owner}::uuid
          )
        `;
      });
    await appendEntitlement(3, false);
    await assertSqlState(
      decide(ids.users.reviewer, "reviewed", "disabled entitlement"),
      "P1R01",
    );
    await appendEntitlement(4, true);

    await session(owner, "authenticated", ids.users.reviewer, (tx) => tx`
      select public.lukas_drawing_record_revision_decision(
        ${document.revisionId}::uuid,${subject.version}::bigint,
        ${subject.snapshot_sha256},'reviewed','M1 independent review'
      )
    `);
    const [reviewed] = await owner`
      select status,version from public.lukas_drawing_revisions
      where id=${document.revisionId}::uuid
    `;
    assert.deepEqual(reviewed, {
      status: "reviewed",
      version: subject.version,
    });
    await assertSqlState(
      decide(ids.users.reviewer, "approved", "reviewer cannot approve"),
      "P1R01",
    );
    await session(owner, "authenticated", ids.users.approver, (tx) => tx`
      select public.lukas_drawing_record_revision_decision(
        ${document.revisionId}::uuid,${subject.version}::bigint,
        ${subject.snapshot_sha256},'approved','M1 independent approval'
      )
    `);
    const [approved] = await owner`
      select status,version from public.lukas_drawing_revisions
      where id=${document.revisionId}::uuid
    `;
    assert.deepEqual(approved, {
      status: "approved",
      version: subject.version,
    });

    const rejectedDocument = await createDocument(
      owner,
      "authenticated",
      ids.users.editor,
      ids.project,
      "M1 approver rejection",
      randomUUID(),
    );
    ids.documents.push(rejectedDocument.documentId);
    ids.revisions.push(rejectedDocument.revisionId);
    await session(owner, "authenticated", ids.users.editor, (tx) => tx`
      select public.lukas_drawing_request_review(
        ${rejectedDocument.revisionId}::uuid
      )
    `);
    const [rejectedSubject] = await owner`
      select r.version,s.sha256 snapshot_sha256
      from public.lukas_drawing_revisions r
      join public.lukas_drawing_snapshots s
        on s.revision_id=r.id and s.project_id=r.project_id
          and s.revision_version=r.version
      where r.id=${rejectedDocument.revisionId}::uuid
    `;
    const decideRejected = (actorId, decision, note) =>
      session(owner, "authenticated", actorId, (tx) => tx`
        select public.lukas_drawing_record_revision_decision(
          ${rejectedDocument.revisionId}::uuid,
          ${rejectedSubject.version}::bigint,
          ${rejectedSubject.snapshot_sha256},${decision},${note}
        )
      `);
    await decideRejected(ids.users.reviewer, "reviewed", "review stage");
    await assertSqlState(
      decideRejected(ids.users.outsider, "rejected", "outsider rejection"),
      "P1R01",
    );
    await assertSqlState(
      decideRejected(ids.users.reviewer, "rejected", "reviewer too late"),
      "P1R01",
    );
    await decideRejected(ids.users.approver, "rejected", "return to draft");
    const [rejected] = await owner`
      select status,version,review_requested_at,approved_at
      from public.lukas_drawing_revisions
      where id=${rejectedDocument.revisionId}::uuid
    `;
    assert.deepEqual(rejected, {
      status: "draft",
      version: (BigInt(rejectedSubject.version) + 1n).toString(),
      review_requested_at: null,
      approved_at: null,
    });
  }

  async function proveCanonicalCollaborationInitialization(owner, workerA, workerB, ids) {
    // These opaque bytes test the SQL boundary only; server tests validate Yjs semantics.
    const candidateA = Buffer.from([0x31, 0x01]);
    const candidateB = Buffer.from([0x31, 0x02]);
    const makeDocument = async (title) => {
      const document = await createDocument(owner, "authenticated", ids.users.editor,
        ids.project, `M1 canonical initialization ${title}`, randomUUID());
      ids.documents.push(document.documentId);
      ids.revisions.push(document.revisionId);
      return document;
    };
    const snapshot = async (revisionId) => {
      const [row] = await owner`
        select graph->>'operationSequence' sequence,
          pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(graph::text,'UTF8'),'sha256'),'hex') sha256
        from (select private.lukas_drawing_p2_canonical_snapshot(
          ${revisionId}::uuid,true
        ) graph) canonical
      `;
      return row;
    };
    const initialize = (sql, document, base, bytes = candidateA, options = {}) =>
      // A collaboration connection carries a verified user ID, but no end-user JWT.
      session(sql, options.role ?? "lukas_drawing_collaboration", null, (tx) =>
        options.service ? tx`
          select * from private.lukas_drawing_collaboration_service_initialize_state(
            ${options.projectId ?? ids.project}::uuid,${document.revisionId}::uuid,
            ${bytes}::bytea,${base.sequence}::bigint,${base.sha256}::text
          )
        ` : tx`
          select * from private.lukas_drawing_collaboration_initialize_state(
            ${options.userId === undefined ? ids.users.viewer : options.userId}::uuid,
            ${options.projectId ?? ids.project}::uuid,${document.revisionId}::uuid,
            ${bytes}::bytea,${base.sequence}::bigint,${base.sha256}::text
          )
        `);
    const readState = async (document) => (await owner`
      select * from private.lukas_drawing_collaboration_states
      where revision_id=${document.revisionId}::uuid
    `)[0];
    const viewerDocument = await makeDocument("Viewer first load");
    const viewerBase = await snapshot(viewerDocument.revisionId);
    const [viewerState] = await initialize(owner, viewerDocument, viewerBase);
    assert.deepEqual(viewerState.yjs_state, candidateA);
    assert.equal(Number(viewerState.store_generation), 1);
    assert.equal(viewerState.schema_version, 1);
    assert.equal(viewerState.project_id, ids.project);
    assert.equal(viewerState.revision_id, viewerDocument.revisionId);
    assert.equal(viewerState.yjs_sha256, createHash("sha256").update(candidateA).digest("hex"));
    assert.equal(viewerState.byte_size, candidateA.length);
    assert.equal(viewerState.base_operation_sequence, viewerBase.sequence);
    assert.equal(viewerState.freeze_state, "active");
    for (const key of ["freeze_request_id", "freeze_owner_token",
      "freeze_owner_request_id", "freeze_owner_lease_expires_at", "frozen_at",
      "frozen_base_operation_sequence", "frozen_subject_revision_version",
      "frozen_yjs_state_vector", "frozen_operation_statuses", "review_committed_at",
      "accepted_manifest_sha256", "accepted_operation_count"])
      assert.equal(viewerState[key], null, `initial ${key}`);
    assert.deepEqual(await readState(viewerDocument), viewerState);
    await assertSqlState(session(owner, "lukas_drawing_collaboration", null, (tx) => tx`
      select * from private.lukas_drawing_collaboration_store_state(
        ${ids.users.viewer}::uuid,${ids.project}::uuid,${viewerDocument.revisionId}::uuid,
        1::smallint,${candidateB}::bytea,${viewerBase.sequence}::bigint,
        ${viewerState.store_generation}::bigint,${viewerState.yjs_sha256}
      )
    `), "P3A02");

    const signatures = [
      "private.lukas_drawing_collaboration_initialize_state_core(uuid,uuid,bytea,bigint,text,boolean)",
      "private.lukas_drawing_collaboration_initialize_state(uuid,uuid,uuid,bytea,bigint,text)",
      "private.lukas_drawing_collaboration_service_initialize_state(uuid,uuid,bytea,bigint,text)",
    ];
    for (const [index, signature] of signatures.entries()) {
      const [definition] = await owner`
        select p.prosecdef security_definer,
          p.proconfig @> array['search_path=""']::text[] empty_search_path,
          not exists(select 1 from pg_catalog.aclexplode(p.proacl) acl
            where acl.grantee=0 and acl.privilege_type='EXECUTE') public_denied
        from pg_catalog.pg_proc p where p.oid=${signature}::regprocedure
      `;
      assert.deepEqual(definition, {
        security_definer: true, empty_search_path: true, public_denied: true,
      });
      for (const role of appRoles) {
        const [privilege] = await owner`
          select pg_catalog.has_function_privilege(${role},${signature},'EXECUTE') allowed
        `;
        assert.equal(privilege.allowed, index > 0 && role === "lukas_drawing_collaboration",
          `${role} execute ${signature}`);
      }
    }
    await assertSqlState(session(owner, "lukas_drawing_collaboration", null, (tx) => tx`
      select * from private.lukas_drawing_collaboration_initialize_state_core(
        ${ids.project}::uuid,${viewerDocument.revisionId}::uuid,${candidateA}::bytea,
        ${viewerBase.sequence}::bigint,${viewerBase.sha256},true
      )
    `), "42501");
    for (const role of ["anon", "authenticated", "service_role"])
      for (const service of [false, true])
        await assertSqlState(initialize(owner, viewerDocument, viewerBase, candidateA,
          { role, service }), "42501");
    for (const userId of [ids.users.outsider, null])
      await assertSqlState(initialize(owner, viewerDocument, viewerBase, candidateA,
        { userId }), "P3A01");
    await assertSqlState(initialize(owner, viewerDocument, viewerBase, candidateA,
      { projectId: ids.foreignProject }), "P3A01");
    for (const service of [false, true])
      await assertSqlState(initialize(owner, { revisionId: randomUUID() }, viewerBase,
        candidateA, { service }), "P3A01");

    const invalidDocument = await makeDocument("invalid candidate");
    const validBase = await snapshot(invalidDocument.revisionId);
    for (const service of [false, true]) {
      for (const [bytes, base] of [
        [null, validBase], [Buffer.alloc(0), validBase],
        [Buffer.alloc(8388609), validBase],
        [candidateA, { ...validBase, sequence: null }],
        [candidateA, { ...validBase, sequence: -1 }],
        [candidateA, { ...validBase, sha256: null }],
        [candidateA, { ...validBase, sha256: "A".repeat(64) }],
        [candidateA, { ...validBase, sha256: "a".repeat(63) }],
        [candidateA, { ...validBase, sha256: "g".repeat(64) }],
      ]) await assertSqlState(initialize(owner, invalidDocument, base, bytes,
        { service }), "P3S01");
      await assertSqlState(initialize(owner, invalidDocument,
        { ...validBase, sha256: "0".repeat(64) }, candidateA, { service }), "P3S04");
      await assertSqlState(initialize(owner, invalidDocument,
        { ...validBase, sequence: BigInt(validBase.sequence) + 1n }, candidateA,
        { service }), "P3S04");
    }
    assert.equal(await readState(invalidDocument), undefined);

    const concurrent = await makeDocument("concurrent winner");
    const concurrentBase = await snapshot(concurrent.revisionId);
    const [[{ pid: backendA }], [{ pid: backendB }]] = await Promise.all([
      workerA`select pg_catalog.pg_backend_pid() pid`,
      workerB`select pg_catalog.pg_backend_pid() pid`,
    ]);
    assert.notEqual(backendA, backendB);
    let contenders;
    try {
      await owner.begin(async (barrier) => {
        await barrier`
          select id from public.lukas_drawing_revisions
          where id=${concurrent.revisionId}::uuid and project_id=${ids.project}::uuid
          for update
        `;
        // Both calls must reach the revision lock before either can insert.
        contenders = Promise.all([
          initialize(workerA, concurrent, concurrentBase, candidateA),
          initialize(workerB, concurrent, concurrentBase, candidateB, { service: true }),
        ]);
        contenders.catch(() => {});
        const deadline = Date.now() + 10_000;
        for (;;) {
          const [{ waiting }] = await barrier`
            select pg_catalog.count(*)::integer waiting from pg_catalog.pg_stat_activity
            where pid in (${backendA},${backendB}) and wait_event_type='Lock'
              and pg_catalog.cardinality(pg_catalog.pg_blocking_pids(pid))>0
          `;
          if (waiting === 2) break;
          assert.ok(Date.now() < deadline, "both initializers must wait at revision barrier");
        }
      });
      const [[first], [second]] = await contenders;
      assert.deepEqual(first, second);
      assert.ok(first.yjs_state.equals(candidateA) || first.yjs_state.equals(candidateB));
      assert.equal(Number(first.store_generation), 1);
      assert.equal(first.persisted_at.getTime(), second.persisted_at.getTime());
      assert.equal(first.yjs_sha256, second.yjs_sha256);
      assert.equal(first.base_operation_sequence, concurrentBase.sequence);
      assert.deepEqual(await readState(concurrent), first);
      // Even an invalid losing candidate is ignored once canonical state exists.
      for (const service of [false, true]) {
        const [existing] = await initialize(owner, concurrent,
          { sequence: -1, sha256: null }, null, { service });
        assert.deepEqual(existing, first);
      }
    } finally {
      if (contenders) await contenders.catch(() => {});
    }

    const approved = await makeDocument("approved reader");
    await session(owner, "authenticated", ids.users.editor, (tx) => tx`
      select public.lukas_drawing_request_review(${approved.revisionId}::uuid)
    `);
    const [subject] = await owner`
      select r.version,s.sha256 from public.lukas_drawing_revisions r
      join public.lukas_drawing_snapshots s on s.revision_id=r.id
        and s.project_id=r.project_id and s.revision_version=r.version
      where r.id=${approved.revisionId}::uuid
    `;
    for (const [actor, decision] of [[ids.users.reviewer, "reviewed"],
      [ids.users.approver, "approved"]])
      await session(owner, "authenticated", actor, (tx) => tx`
        select public.lukas_drawing_record_revision_decision(
          ${approved.revisionId}::uuid,${subject.version}::bigint,
          ${subject.sha256},${decision},'M1 canonical initialization'
        )
      `);
    const approvedBase = await snapshot(approved.revisionId);
    assert.equal(await readState(approved), undefined);
    await assertSqlState(initialize(owner, approved, approvedBase, candidateA,
      { service: true }), "P3A02");
    const [approvedState] = await initialize(owner, approved, approvedBase);
    assert.equal(approvedState.freeze_state, "active");
    for (const service of [false, true]) {
      const [existing] = await initialize(owner, approved,
        { sequence: null, sha256: null }, null, { service });
      assert.deepEqual(existing, approvedState);
    }
    const [approvedRevision] = await owner`
      select status,version from public.lukas_drawing_revisions
      where id=${approved.revisionId}::uuid
    `;
    assert.deepEqual(approvedRevision, { status: "approved", version: subject.version });

    const leased = await makeDocument("pre-acquired lease");
    const leasedBase = await snapshot(leased.revisionId);
    await session(owner, "lukas_drawing_collaboration", null, (tx) => tx`
      select private.lukas_drawing_collaboration_acquire_freeze_lease(
        ${ids.project}::uuid,${leased.revisionId}::uuid,${randomUUID()}::uuid,
        ${randomUUID()}::uuid,300,null::bytea,null::bigint
      )
    `);
    const readLease = async () => (await owner`
      select * from private.lukas_drawing_collaboration_freeze_leases
      where revision_id=${leased.revisionId}::uuid
    `)[0];
    const originalLease = await readLease();
    const [leasedState] = await initialize(owner, leased, leasedBase, candidateA,
      { service: true });
    assert.equal(leasedState.freeze_state, "active");
    assert.equal(leasedState.freeze_request_id, null);
    assert.equal(leasedState.freeze_owner_token, null);
    assert.deepEqual(await readLease(), originalLease);
    const [leasedRetry] = await initialize(owner, leased, leasedBase, candidateB);
    assert.deepEqual(leasedRetry, leasedState);
    assert.deepEqual(await readLease(), originalLease);
    await assertSqlState(session(owner, "lukas_drawing_collaboration", null, (tx) => tx`
      select * from private.lukas_drawing_collaboration_service_store_state(
        ${ids.project}::uuid,${leased.revisionId}::uuid,1::smallint,
        ${candidateB}::bytea,${leasedBase.sequence}::bigint,
        ${leasedState.store_generation}::bigint,${leasedState.yjs_sha256}
      )
    `), "P3F03");

    // SQL-only frozen fixture: preserve every column, including audit timestamps.
    await owner`
      update private.lukas_drawing_collaboration_states
      set freeze_state='frozen',freeze_request_id=${randomUUID()}::uuid,
        accepted_manifest_sha256=${"a".repeat(64)},accepted_operation_count=0,
        frozen_base_operation_sequence=${viewerBase.sequence}::bigint,
        frozen_at=pg_catalog.now(),frozen_subject_revision_version=1
      where revision_id=${viewerDocument.revisionId}::uuid
    `;
    const frozenState = await readState(viewerDocument);
    for (const service of [false, true]) {
      const [existing] = await initialize(owner, viewerDocument,
        { sequence: -1, sha256: null }, null, { service });
      assert.deepEqual(existing, frozenState);
    }
    assert.deepEqual(await readState(viewerDocument), frozenState);
  }

  async function proveCollaborationServiceStoreSuccess(owner, ids, document) {
    const unfencedSignature =
      "private.lukas_drawing_collaboration_service_store_state_unfenced(uuid,uuid,smallint,bytea,bigint,bigint,text)";
    const fencedSignature =
      "private.lukas_drawing_collaboration_service_store_state(uuid,uuid,smallint,bytea,bigint,bigint,text)";
    await assertSqlState(
      session(
        owner,
        "authenticated",
        ids.users.anonymous,
        (tx) => tx`
          select public.lukas_drawing_collaboration_bootstrap(
            ${document.revisionId}::uuid
          )
        `,
        { anonymous: true },
      ),
      "P3A01",
    );
    for (const role of [
      "anon", "authenticated", "service_role", "lukas_drawing_collaboration",
    ]) {
      const [unfenced] = await owner`
        select pg_catalog.has_function_privilege(
          ${role},${unfencedSignature},'EXECUTE'
        ) allowed
      `;
      assert.equal(unfenced.allowed, false, `${role} unfenced store`);
    }
    for (const role of ["anon", "authenticated", "service_role"]) {
      const [fenced] = await owner`
        select pg_catalog.has_function_privilege(
          ${role},${fencedSignature},'EXECUTE'
        ) allowed
      `;
      assert.equal(fenced.allowed, false, `${role} fenced store`);
    }
    const [collaborationFenced] = await owner`
      select pg_catalog.has_function_privilege(
        'lukas_drawing_collaboration',${fencedSignature},'EXECUTE'
      ) allowed
    `;
    assert.equal(collaborationFenced.allowed, true);
    const [definition] = await owner`
      select p.prosecdef security_definer,
        p.proconfig @> array['search_path=""']::text[] has_empty_search_path
      from pg_catalog.pg_proc p
      where p.oid=${unfencedSignature}::regprocedure
    `;
    assert.equal(definition.security_definer, true);
    assert.equal(definition.has_empty_search_path, true);
    const [sequence] = await owner`
      select coalesce(max(o.sequence),0::bigint) sequence
      from public.lukas_drawing_operations o
    where o.project_id=${ids.project}::uuid
      and o.revision_id=${document.revisionId}::uuid
    `;
    await assertSqlState(
      session(
        owner,
        "lukas_drawing_collaboration",
        null,
        (tx) => tx`
          select * from private.lukas_drawing_collaboration_service_store_state(
            ${ids.project}::uuid,${document.revisionId}::uuid,1::smallint,
            ${Buffer.from([0x30])}::bytea,
            ${BigInt(sequence.sequence) + 1n}::bigint,0::bigint,null
          )
        `,
      ),
      "P3S01",
    );
    const initialState = Buffer.from([0x31, 0x48, 0x4b]);
    const initialSha256 = createHash("sha256").update(initialState).digest("hex");
    const [initial] = await session(
      owner,
      "lukas_drawing_collaboration",
      null,
      (tx) => tx`
        select * from private.lukas_drawing_collaboration_service_store_state(
          ${ids.project}::uuid,${document.revisionId}::uuid,1::smallint,
          ${initialState}::bytea,${sequence.sequence}::bigint,0::bigint,null
        )
      `,
    );
    assert.equal(initial.revision_id, document.revisionId);
    assert.equal(initial.project_id, ids.project);
    assert.equal(Number(initial.base_operation_sequence), Number(sequence.sequence));
    assert.equal(Number(initial.store_generation), 1);
    assert.equal(initial.yjs_sha256, initialSha256);
    assert.deepEqual(Buffer.from(initial.yjs_state), initialState);
    assert.equal(Number(initial.byte_size), initialState.byteLength);

    const updatedState = Buffer.from([0x31, 0x48, 0x4b, 0x32]);
    const updatedSha256 = createHash("sha256").update(updatedState).digest("hex");
    const [updated] = await session(
      owner,
      "lukas_drawing_collaboration",
      null,
      (tx) => tx`
        select * from private.lukas_drawing_collaboration_service_store_state(
          ${ids.project}::uuid,${document.revisionId}::uuid,1::smallint,
          ${updatedState}::bytea,${sequence.sequence}::bigint,
          ${initial.store_generation}::bigint,${initial.yjs_sha256}
        )
      `,
    );
    assert.equal(Number(updated.store_generation), 2);
    assert.equal(updated.yjs_sha256, updatedSha256);
    assert.deepEqual(Buffer.from(updated.yjs_state), updatedState);
    const [persisted] = await owner`
      select yjs_state,yjs_sha256,store_generation,base_operation_sequence,byte_size
      from private.lukas_drawing_collaboration_states
      where project_id=${ids.project}::uuid
        and revision_id=${document.revisionId}::uuid
    `;
    assert.equal(Number(persisted.store_generation), 2);
    assert.equal(Number(persisted.base_operation_sequence), Number(sequence.sequence));
    assert.equal(persisted.yjs_sha256, updatedSha256);
    assert.equal(Number(persisted.byte_size), updatedState.byteLength);
    assert.deepEqual(Buffer.from(persisted.yjs_state), updatedState);
  }

  async function proveCollaborativeReviewedRetry(owner, ids, document) {
    const requestId = randomUUID();
    const ownerToken = randomUUID();
    const initialState = Buffer.from([0]);
    const frozenState = Buffer.from([1, 2, 3]);
    const manifest = [];
    const manifestSha256 = createHash("sha256")
      .update(JSON.stringify(manifest))
      .digest("hex");
    const stateVectorBase64 = "AQ==";
    const operationStatuses = [];
    const subjectVersion = 1;

    await session(
      owner,
      "lukas_drawing_collaboration",
      null,
      (tx) => tx`
        select * from private.lukas_drawing_collaboration_service_store_state(
          ${ids.project}::uuid,${document.revisionId}::uuid,1::smallint,
          ${initialState}::bytea,0::bigint,0::bigint,null
        )
      `,
    );
    await session(
      owner,
      "lukas_drawing_collaboration",
      null,
      async (tx) => {
        await tx`
          select private.lukas_drawing_collaboration_acquire_freeze_lease(
            ${ids.project}::uuid,${document.revisionId}::uuid,
            ${requestId}::uuid,${ownerToken}::uuid,30,
            ${initialState}::bytea,0::bigint
          )
        `;
        await tx`
          select private.lukas_drawing_collaboration_begin_freeze(
            ${ids.project}::uuid,${document.revisionId}::uuid,
            ${requestId}::uuid,${frozenState}::bytea,0::bigint,
            ${ownerToken}::uuid
          )
        `;
        await tx`
          select private.lukas_drawing_collaboration_complete_freeze(
            ${ids.project}::uuid,${document.revisionId}::uuid,
            ${requestId}::uuid,${frozenState}::bytea,
            ${tx.json(manifest)}::jsonb,${manifestSha256},0,0::bigint,
            ${stateVectorBase64},${tx.json(operationStatuses)}::jsonb,
            ${ownerToken}::uuid
          )
        `;
      },
    );
    const requestReview = () =>
      session(owner, "authenticated", ids.users.editor, (tx) => tx`
        select public.lukas_drawing_request_collaborative_review(
          ${document.revisionId}::uuid,${requestId}::uuid,
          ${manifestSha256},0,0::bigint,${subjectVersion}::bigint,
          ${stateVectorBase64},${tx.json(operationStatuses)}::jsonb,
          ${tx.json(manifest)}::jsonb
        ) value
      `);
    const [first] = await requestReview();
    assert.equal(first.value.freezeRequestId, requestId);
    await session(owner, "authenticated", ids.users.reviewer, (tx) => tx`
      select public.lukas_drawing_record_revision_decision(
        ${document.revisionId}::uuid,${first.value.subjectVersion}::bigint,
        ${first.value.snapshotSha256},'reviewed','M3 staged review'
      )
    `);
    const [reviewedRetry] = await requestReview();
    assert.deepEqual(reviewedRetry.value, first.value);
    await session(owner, "authenticated", ids.users.approver, (tx) => tx`
      select public.lukas_drawing_record_revision_decision(
        ${document.revisionId}::uuid,${first.value.subjectVersion}::bigint,
        ${first.value.snapshotSha256},'approved','M3 final approval'
      )
    `);
    const [approvedRetry] = await requestReview();
    assert.deepEqual(approvedRetry.value, first.value);
  }

  async function proveEntitlementOffLegacyReview(owner, ids) {
    const document = await createDocument(
      owner,
      "authenticated",
      ids.users.editor,
      ids.project,
      "M3 HTTP-only review after collaboration downgrade",
      randomUUID(),
    );
    ids.documents.push(document.documentId);
    ids.revisions.push(document.revisionId);
    await session(
      owner,
      "lukas_drawing_collaboration",
      null,
      (tx) => tx`
        select * from private.lukas_drawing_collaboration_service_store_state(
          ${ids.project}::uuid,${document.revisionId}::uuid,1::smallint,
          ${Buffer.from([0])}::bytea,0::bigint,0::bigint,null
        )
      `,
    );
    await owner.begin(async (tx) => {
      await tx`select pg_catalog.set_config(
        'request.jwt.claims',${JSON.stringify({
          role: "authenticated",
          sub: ids.users.owner,
          is_anonymous: false,
          app_metadata: {},
        })},true
      )`;
      await tx`
        insert into public.lukas_qto_organization_entitlement_versions(
          id,organization_id,version_no,plan,seat_limit,project_limit,
          library_version_limit,features,reason,request_id,request_sha256,
          created_by
        ) values(
          ${randomUUID()}::uuid,${ids.organization}::uuid,5,'enterprise',
          100,100,1000,${tx.json({
            drawing_workspace: true,
            organization_library: true,
            realtime_collaboration: false,
            ifc_workspace: true,
            quantity_lineage: true,
          })}::jsonb,'M3 HTTP-only review entitlement',${randomUUID()}::uuid,
          ${sha("5")},${ids.users.owner}::uuid
        )
      `;
    });

    const objectId = randomUUID();
    const [applied] = await session(
      owner,
      "authenticated",
      ids.users.editor,
      (tx) => tx`
        select public.lukas_drawing_apply_operation(
          ${document.revisionId}::uuid,${randomUUID()}::uuid,'add_objects',
          '{}'::jsonb,
          ${tx.json({
            type: "add_objects",
            objects: [
              {
                id: objectId,
                name: "HTTP-only entitlement object",
                layerId: document.workLayerId,
                geometry: {
                  type: "circle",
                  center: { x: 10, y: 10 },
                  radius: 5,
                },
                style: { stroke: "#112233", strokeWidth: 1, fill: null },
                version: 1,
              },
            ],
          })}::jsonb,
          ${tx.json({ type: "delete_objects", objectIds: [objectId] })}::jsonb
        ) value
      `,
    );
    assert.equal(Number(applied.value.sequence), 1);

    const [checkpoint] = await session(
      owner,
      "authenticated",
      ids.users.editor,
      (tx) => tx`
        select public.lukas_drawing_collaboration_bootstrap(
          ${document.revisionId}::uuid
        ) value
      `,
    );
    assert.equal(Number(checkpoint.value.operationSequence), 1);
    assert.equal(checkpoint.value.capability, "editor");
    assert.equal(checkpoint.value.canWrite, true);
    assert.ok(
      checkpoint.value.canonicalJson.objects.some(
        (object) => object.id === objectId,
      ),
    );

    const [review] = await session(
      owner,
      "authenticated",
      ids.users.editor,
      (tx) => tx`
        select public.lukas_drawing_request_review(
          ${document.revisionId}::uuid
        ) value
      `,
    );
    assert.equal(review.value.subjectVersion, 1);
    assert.equal(Number(review.value.operationSequence), 1);
    const [revision] = await owner`
      select status from public.lukas_drawing_revisions
      where id=${document.revisionId}::uuid
    `;
    assert.equal(revision.status, "review_requested");
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

  async function proveRequiredPropertyBlankReviewGuard(owner, ids) {
    const document = await createDocument(
      owner,
      "authenticated",
      ids.users.editor,
      ids.project,
      "M2 required property blank guard",
      randomUUID(),
    );
    ids.documents.push(document.documentId);
    ids.revisions.push(document.revisionId);
    const [reviewPrivileges] = await owner`
      select
        pg_catalog.has_function_privilege(
          'authenticated',
          'private.lukas_drawing_request_review(uuid)',
          'execute'
        ) authenticated_private,
        pg_catalog.has_function_privilege(
          'service_role',
          'private.lukas_drawing_request_review(uuid)',
          'execute'
        ) service_private,
        pg_catalog.has_function_privilege(
          'authenticated',
          'public.lukas_drawing_request_review(uuid)',
          'execute'
        ) authenticated_public
    `;
    assert.deepEqual(reviewPrivileges, {
      authenticated_private: false,
      service_private: false,
      authenticated_public: true,
    });
    await assertSqlState(
      session(owner, "authenticated", ids.users.editor, (tx) => tx`
        select private.lukas_drawing_request_review(${document.revisionId}::uuid)
      `),
      "42501",
    );
    const objectId = randomUUID();
    const schemaId = randomUUID();
    const valueId = randomUUID();
    const object = {
      id: objectId,
      name: "Required property target",
      layerId: document.workLayerId,
      geometry: {
        type: "rectangle",
        origin: { x: 0, y: 0 },
        width: 100,
        height: 100,
        rotation: 0,
      },
      style: { stroke: "#112233", strokeWidth: 1, fill: null },
      version: 1,
    };
    await session(owner, "authenticated", ids.users.editor, (tx) => tx`
      select public.lukas_drawing_apply_operation(
        ${document.revisionId}::uuid,${randomUUID()}::uuid,'add_objects',
        '{}'::jsonb,
        ${tx.json({ type: "add_objects", objects: [object] })}::jsonb,
        ${tx.json({ type: "delete_objects", objectIds: [objectId] })}::jsonb
      )
    `);
    const schema = {
      id: schemaId,
      revisionId: document.revisionId,
      name: "Required mark",
      valueType: "text",
      enumOptions: [],
      appliesTo: ["rectangle"],
      required: true,
      version: 1,
    };
    const blankValue = {
      id: valueId,
      schemaId,
      objectId,
      blockInstanceId: null,
      value: "\n\t",
      version: 1,
    };
    await session(owner, "authenticated", ids.users.editor, (tx) => tx`
      select public.lukas_drawing_apply_operation(
        ${document.revisionId}::uuid,${randomUUID()}::uuid,'mutate_structure',
        '{}'::jsonb,
        ${tx.json({
          type: "mutate_structure",
          actions: [
            { kind: "put_property_schema", entity: schema, baseVersion: null },
            { kind: "put_property_value", entity: blankValue, baseVersion: null },
          ],
        })}::jsonb,
        ${tx.json({
          type: "mutate_structure",
          actions: [
            { kind: "delete_property_value", id: valueId, baseVersion: 1 },
            { kind: "delete_property_schema", id: schemaId, baseVersion: 1 },
          ],
        })}::jsonb
      )
    `);
    const blankError = await captureSqlError(
      session(owner, "authenticated", ids.users.editor, (tx) => tx`
        select public.lukas_drawing_request_review(${document.revisionId}::uuid)
      `),
    );
    assert.deepEqual(
      { code: blankError.code, message: blankError.message },
      {
        code: "P1C01",
        message: "Required drawing property values are incomplete",
      },
    );
    const [afterRejectedReview] = await owner`
      select r.status,v.value,v.version::integer value_version
      from public.lukas_drawing_revisions r
      join public.lukas_drawing_property_values v
        on v.revision_id=r.id and v.id=${valueId}::uuid
      where r.id=${document.revisionId}::uuid
    `;
    assert.deepEqual(afterRejectedReview, {
      status: "draft",
      value: "\n\t",
      value_version: 1,
    });
    const completeValue = { ...blankValue, value: "A-01" };
    await session(owner, "authenticated", ids.users.editor, (tx) => tx`
      select public.lukas_drawing_apply_operation(
        ${document.revisionId}::uuid,${randomUUID()}::uuid,'mutate_structure',
        ${tx.json({ [valueId]: 1 })}::jsonb,
        ${tx.json({
          type: "mutate_structure",
          actions: [
            { kind: "put_property_value", entity: completeValue, baseVersion: 1 },
          ],
        })}::jsonb,
        ${tx.json({
          type: "mutate_structure",
          actions: [
            { kind: "put_property_value", entity: blankValue, baseVersion: 2 },
          ],
        })}::jsonb
      )
    `);
    await session(owner, "authenticated", ids.users.editor, (tx) => tx`
      select public.lukas_drawing_request_review(${document.revisionId}::uuid)
    `);
    const [revision] = await owner`
      select status from public.lukas_drawing_revisions
      where id=${document.revisionId}::uuid
    `;
    assert.equal(revision.status, "review_requested");
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
      let nativeDwgImportPipelineEvidence;
      let primaryError;
      const cleanupErrors = [];
      try {
        const [{ current_user: currentUser }] = await admin`select current_user`;
        await proveRuntimeCanAssumeCollaborationRole(admin);
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
        await provePrimitiveMeasurementParity(owner);
        await proveCollaborationRoleBoundary(owner);
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
        await proveCanonicalCollaborationInitialization(owner, workerA, workerB, ids);
        await proveCanonicalCollaborationSocketInitialization({
          owner,targetUrl,ids,createDocument,
        });
        projectIds.push(await proveDwgSourceIngestionAuthority({
          owner,workerA,workerB,ids,
        }));
        await provePrivilegeMatrix(owner, ids);
        const personalProject = await provePersonalProjectConcurrency(
          owner,workerA,workerB,ids,
        );
        projectIds.push(personalProject.projectId);
        const concurrent = await proveCreationConcurrencyAndIdentity(
          owner,workerA,workerB,ids,
        );
        await proveCalibratedPdfQuantityAuthority(owner, ids);
        await proveCollaborationServiceStoreSuccess(owner, ids, concurrent);
        await proveAuthenticatedEditorOperationBoundary(owner, ids, concurrent);
        await proveRequiredPropertyBlankReviewGuard(owner, ids);
        await proveBindingAndPurge(owner, ids, concurrent);
        await proveStarterRollback(owner, ids);
        await proveNativeDwgExportJobAuthority({ owner, ids });
        if (nativeDwgImportPipelineRequired) {
          nativeDwgImportPipelineEvidence = await proveNativeDwgImportPipeline({
            owner,workerA,workerB,ids,
            registerProject: (projectId) => projectIds.push(projectId),
            dockerPath: process.env.NATIVE_DWG_DOCKER_PATH,
            dockerHost: process.env.NATIVE_DWG_DOCKER_HOST,
            readerImageId: process.env.NATIVE_DWG_READER_IMAGE_ID,
            afterAnalysis: proveFreshNativeDwgCanonicalPipeline,
          });
          assert.deepEqual(
            {
              analysis: nativeDwgImportPipelineEvidence.persistenceAuthority,
              canonical:
                nativeDwgImportPipelineEvidence.canonicalProof
                  .persistenceAuthority,
              sameJob:
                nativeDwgImportPipelineEvidence.jobId ===
                nativeDwgImportPipelineEvidence.canonicalProof.jobId,
              sameSource:
                nativeDwgImportPipelineEvidence.sourceSha256 ===
                nativeDwgImportPipelineEvidence.canonicalProof.sourceSha256,
            },
            {
              analysis: "not-issued",
              canonical: "operation-attested",
              sameJob: true,
              sameSource: true,
            },
          );
        }
        const imported = await proveNativeDwgCanonicalImportAuthority({
          owner,workerA,workerB,ids,
          registerProject: (projectId) => projectIds.push(projectId),
        });
        const otherImported = await proveNativeDwgCanonicalImportAuthority({
          owner,workerA,workerB,ids,
          registerProject: (projectId) => projectIds.push(projectId),
        });
        await proveNativeDwgResaveJobAuthority({ owner, workerA, workerB, ids, imported, otherImported });
        await proveNativeDwgImportJobAuthority({
          owner,workerA,workerB,ids,
          registerProject: (projectId) => projectIds.push(projectId),
        });
        const reviewDocument = await createDocument(
          owner,
          "authenticated",
          ids.users.editor,
          ids.project,
          "M1 staged review",
          randomUUID(),
        );
        ids.documents.push(reviewDocument.documentId);
        ids.revisions.push(reviewDocument.revisionId);
        await proveStagedRevisionDecision(owner, ids, reviewDocument);
        const collaborativeReviewDocument = await createDocument(
          owner,
          "authenticated",
          ids.users.editor,
          ids.project,
          "M3 collaborative staged retry",
          randomUUID(),
        );
        ids.documents.push(collaborativeReviewDocument.documentId);
        ids.revisions.push(collaborativeReviewDocument.revisionId);
        await proveCollaborativeReviewedRetry(
          owner,
          ids,
          collaborativeReviewDocument,
        );
        await proveEntitlementOffLegacyReview(owner, ids);
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
                  (select pg_catalog.count(*)::integer from public.lukas_drawing_objects
                   where project_id=any(${projectIds}::uuid[])) objects,
                  (select pg_catalog.count(*)::integer from public.lukas_drawing_operations
                   where project_id=any(${projectIds}::uuid[])) operations,
                  (select pg_catalog.count(*)::integer
                   from public.lukas_drawing_object_sources
                   where project_id=any(${projectIds}::uuid[])) object_sources,
                  (select pg_catalog.count(*)::integer
                   from public.lukas_drawing_revision_approvals
                   where project_id=any(${projectIds}::uuid[])) approvals,
                  (select pg_catalog.count(*)::integer
                   from public.lukas_drawing_estimate_bindings
                   where project_id=any(${projectIds}::uuid[])) bindings,
                  (select pg_catalog.count(*)::integer from public.lukas_qto_boq_versions
                   where project_id=any(${projectIds}::uuid[])) boqs
              `;
              assert.deepEqual(
                residue,
                {
                  projects: 0, documents: 0, objects: 0, operations: 0,
                  object_sources: 0, approvals: 0, bindings: 0, boqs: 0,
                },
              );
              for (const suffix of ["jobs", "attempts", "results"]) {
                const table = `public.lukas_drawing_native_dwg_import_${suffix}`;
                const [exists] = await owner`select to_regclass(${table}) present`;
                if (exists.present) {
                  const [analysisResidue] = await owner.unsafe(
                    `select count(*)::integer count from ${table} where project_id=any($1::uuid[])`,
                    [projectIds],
                  );
                  assert.equal(analysisResidue.count, 0);
                }
              }
              for (const table of [
                "public.lukas_drawing_native_dwg_resave_jobs",
                "public.lukas_drawing_native_dwg_resave_attempts",
                "private.lukas_drawing_dxf_plan_attestations",
                "private.lukas_drawing_template_clone_requests",
                "private.lukas_drawing_snapshot_restore_requests",
              ]) {
                const [ledgerResidue] = await owner.unsafe(
                  `select count(*)::integer count from ${table} where project_id=any($1::uuid[])`,
                  [projectIds],
                );
                assert.equal(ledgerResidue.count, 0, table);
              }
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
      if (nativeDwgImportPipelineRequired)
        process.stdout.write(`${JSON.stringify({
          event: "m1_native_dwg_import_pipeline_proof_passed",
          evidence: { ...nativeDwgImportPipelineEvidence, databaseResidue: 0 },
        })}\n`);
    },
  );
}
