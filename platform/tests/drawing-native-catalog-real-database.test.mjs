import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:net";
import postgres from "postgres";
import {
  listNativeDrawingTemplateKeys,
  buildNativeDrawingTemplate,
} from "../app/lukas/lib/drawing-native-templates.ts";
import {
  listNativeDrawingSymbols,
  nativeAssetCanonicalJson,
} from "../app/lukas/lib/drawing-native-symbols.ts";
import * as Y from "yjs";
import {
  createPostgresDrawingCollaborationDatabase,
  createDrawingCollaborationStorage,
} from "../collaboration/src/storage.ts";
import {
  initializeDrawingCollaborationDocument,
  reconcileNativeDrawingOperations,
  createDrawingCollaborationServer,
  validatePersistedDrawingState,
} from "../collaboration/src/server.ts";
import { createDrawingFreezeCoordinator } from "../collaboration/src/freeze.ts";
import {
  drawingCollaborationOperationFromSnapshotOutcome,
  DRAWING_COLLABORATION_SERVER_ORIGIN,
} from "../app/lukas/lib/drawing-collaboration-protocol.ts";
import { appendDrawingCollaborationOperation } from "../app/lukas/lib/drawing-collaboration-yjs.ts";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const outputProfiles = JSON.parse(
  await readFile(
    new URL("./fixtures/drawing-output-profiles.json", import.meta.url),
    "utf8",
  ),
);
const q = (value) => `'${value.replaceAll("'", "''")}'`;

async function bootstrap(sql) {
  await sql.unsafe(`
    create role anon nologin; create role authenticated nologin;
    create role service_role nologin bypassrls;
    create publication supabase_realtime;
    create schema auth; create schema extensions; create schema private; create schema storage;
    create extension pgcrypto with schema extensions;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
    alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,
      is_anonymous boolean not null default false,raw_app_meta_data jsonb not null default '{}',
      raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable set search_path='' as $$
      select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable set search_path='' as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}') $$;
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default extensions.gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null);
    create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
    grant usage on schema auth,storage to anon,authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt(),storage.foldername(text) to anon,authenticated,service_role;
  `);
  for (const name of (await readdir(migrations))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const readFreezeContract =
      () => sql`select oid::text,proowner::text,proacl::text,proargnames,
      proallargtypes::text,proargmodes::text,prosecdef,provolatile,proconfig
      from pg_catalog.pg_proc where oid='private.lukas_drawing_collaboration_read_freeze(uuid,uuid)'::regprocedure`;
    const before = name.endsWith("_drawing_released_freeze_recovery.sql")
      ? await readFreezeContract()
      : null;
    await sql.unsafe(await readFile(new URL(name, migrations), "utf8"));
    if (before)
      assert.deepEqual(
        await readFreezeContract(),
        before,
        "recovery migration preserves function identity, result contract and ACL",
      );
  }
}

test(
  "native catalog authority, full graph clone, replay and output profile persist in isolated PostgreSQL",
  { timeout: 180000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "native-catalog-db-"));
    const port = await new Promise((resolve) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const value = server.address().port;
        server.close(() => resolve(value));
      });
    });
    let sql,
      worker,
      bridgeDatabase,
      bridgeRuntime,
      started = false;
    try {
      execFileSync(
        "initdb",
        [
          "-D",
          directory,
          "-U",
          "postgres",
          "--auth=trust",
          "--no-locale",
          "--encoding=UTF8",
        ],
        { stdio: "ignore" },
      );
      execFileSync(
        "pg_ctl",
        [
          "-D",
          directory,
          "-l",
          join(directory, "server.log"),
          "-o",
          `-h 127.0.0.1 -p ${port} -k ${directory} -c wal_level=logical`,
          "-w",
          "start",
        ],
        { stdio: "ignore" },
      );
      started = true;
      sql = postgres(`postgres://postgres@127.0.0.1:${port}/postgres`, {
        max: 1,
        onnotice: () => {},
      });
      worker = postgres(`postgres://postgres@127.0.0.1:${port}/postgres`, {
        max: 1,
        onnotice: () => {},
      });
      await bootstrap(sql);
      const profileFailures = [];
      for (const fixture of outputProfiles) {
        const [{ valid }] =
          await sql`select private.lukas_drawing_output_profile_valid(${sql.json(fixture.profile)},${fixture.widthMillimeters}::numeric,${fixture.heightMillimeters}::numeric) valid`;
        if (valid !== fixture.valid)
          profileFailures.push({
            name: fixture.name,
            expected: fixture.valid,
            actual: valid,
          });
      }
      assert.deepEqual(
        profileFailures,
        [],
        "all shared profile admission cases agree",
      );
      for (const paper of ["한".repeat(256), "📐".repeat(128)])
        assert.equal(
          (
            await sql`select private.lukas_drawing_output_profile_valid(${sql.json({ paper, orientation: "landscape", widthMillimeters: 297, heightMillimeters: 210, scaleDenominator: 50 })},14850,10500) valid`
          )[0].valid,
          false,
          "paper respects existing 255 UTF-16-unit name bound",
        );
      const owner = randomUUID(),
        editor = randomUUID(),
        viewer = randomUUID(),
        outsider = randomUUID(),
        project = randomUUID();
      await sql`insert into auth.users(id,email,email_confirmed_at) values(${owner},'owner@native.test',now()),(${editor},'editor@native.test',now()),(${viewer},'viewer@native.test',now()),(${outsider},'outsider@native.test',now())`;
      const run = (actor, query, db = sql, role = "authenticated") =>
        db.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: actor, role, is_anonymous: false })},true)`;
          return tx.unsafe(query);
        });
      await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: owner, role: "authenticated" })},true)`;
        await tx`insert into public.lukas_qto_projects(id,owner_id,name) values(${project},${owner},'Native isolated project')`;
      });
      const [{ organization_id: organization }] =
        await sql`select organization_id from public.lukas_qto_projects where id=${project}`;
      await sql`insert into public.lukas_qto_organization_members(organization_id,user_id,role) values(${organization},${editor},'member'),(${organization},${viewer},'member')`;
      await sql`insert into public.lukas_qto_project_members(project_id,user_id,role) values(${project},${editor},'estimator'),(${project},${viewer},'viewer')`;
      // Builtins remain available with only the base drawing feature and zero paid library access.
      await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: owner, role: "authenticated" })},true)`;
        await tx`insert into public.lukas_qto_organization_entitlement_versions(organization_id,version_no,plan,seat_limit,project_limit,library_version_limit,features,reason,request_id,request_sha256,created_by)
        values(${organization},2,'free',10,10,1,${tx.json({ drawing_workspace: true, organization_library: false, realtime_collaboration: true, ifc_workspace: false, quantity_lineage: false })},'Native base feature fixture',${randomUUID()},${"e".repeat(64)},${owner})`;
      });
      const list = (kind) =>
        `select * from public.lukas_drawing_list_native_assets('${project}',${q(kind)})`;
      assert.equal(
        (
          await sql`select private.lukas_drawing_output_profile_valid(${sql.json({ paper: "A3", orientation: null, widthMillimeters: 297, heightMillimeters: 420, scaleDenominator: 50 })},14850,21000) valid`
        )[0].valid,
        false,
        "null orientation must not select portrait through SQL NULL",
      );
      const profile = {
        paper: "A3",
        orientation: "landscape",
        widthMillimeters: 420,
        heightMillimeters: 297,
        scaleDenominator: 50,
      };
      for (const key of Object.keys(profile)) {
        for (const bad of [
          { ...profile, [key]: null },
          Object.fromEntries(
            Object.entries(profile).filter(([field]) => field !== key),
          ),
        ])
          assert.equal(
            (
              await sql`select private.lukas_drawing_output_profile_valid(${sql.json(bad)},21000,14850) valid`
            )[0].valid,
            false,
            `profile requires non-null ${key}`,
          );
      }
      assert.equal(
        (
          await sql`select private.lukas_drawing_output_profile_valid(${sql.json({ ...profile, extra: true })},21000,14850) valid`
        )[0].valid,
        false,
        "profile rejects unknown fields",
      );
      const templates = await run(editor, list("workspace_template"));
      const symbols = await run(editor, list("block"));
      assert.equal(templates.length, 4);
      assert.equal(symbols.length, 24);
      for (const entry of [...templates, ...symbols]) {
        const authored =
          entry.kind === "block"
            ? listNativeDrawingSymbols().find((x) => x.key === entry.key)
            : buildNativeDrawingTemplate(entry.key);
        assert.deepEqual(entry.definition, authored);
        assert.equal(
          entry.artifactSha256,
          createHash("sha256")
            .update(nativeAssetCanonicalJson(authored))
            .digest("hex"),
        );
        const [{ digest }] =
          await sql`select encode(extensions.digest(${sql.json(authored)}::jsonb::text,'sha256'),'hex') digest`;
        assert.equal(entry.contentSha256, digest);
      }
      assert.deepEqual(
        Array.from(await run(viewer, list("block"))),
        Array.from(symbols),
        "Viewer can browse native symbols without write authority",
      );
      await assert.rejects(
        sql.begin(async (tx) => {
          await tx.unsafe("set local role authenticated");
          await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: viewer, role: "authenticated", is_anonymous: true })},true)`;
          return tx.unsafe(list("block"));
        }),
        "anonymous sessions cannot browse catalog despite a project membership",
      );
      for (const actor of [outsider, null])
        await assert.rejects(run(actor, list("workspace_template")));
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [priv] =
          await sql`select has_table_privilege(${role},'private.lukas_drawing_native_assets','SELECT,INSERT,UPDATE,DELETE') allowed`;
        assert.equal(priv.allowed, false);
      }
      await assert.rejects(
        sql`update private.lukas_drawing_native_assets set definition='{}'`,
      );
      const request = randomUUID();
      const importSql = (
        key,
        requestId = request,
        revision = null,
        kind = "workspace_template",
      ) =>
        `select public.lukas_drawing_import_native_asset('${project}',${revision ? q(revision) : "null"},${q(kind)},${q(key)},1,'${requestId}') value`;
      const results = await Promise.all([
        run(editor, importSql("measured-plan")),
        run(editor, importSql("measured-plan"), worker),
      ]);
      assert.deepEqual(results[0][0].value, results[1][0].value);
      await assert.rejects(run(editor, importSql("office-layout")));
      for (const actor of [viewer, outsider, null])
        await assert.rejects(
          run(actor, importSql("measured-plan", randomUUID())),
        );
      const first = results[0][0].value;
      const imported = [first];
      for (const key of listNativeDrawingTemplateKeys().filter(
        (x) => x !== "measured-plan",
      ))
        imported.push(
          (await run(editor, importSql(key, randomUUID())))[0].value,
        );
      for (let i = 0; i < imported.length; i++) {
        const result = imported[i];
        const [{ snapshot }] =
          await sql`select private.lukas_drawing_p2_canonical_snapshot(${result.revisionId},true) snapshot`;
        const definition = templates.find(
          (x) =>
            x.key ===
            (i === 0
              ? "measured-plan"
              : listNativeDrawingTemplateKeys().filter(
                  (x) => x !== "measured-plan",
                )[i - 1]),
        ).definition;
        for (const kind of [
          "pages",
          "canvases",
          "layers",
          "styles",
          "blocks",
          "objects",
          "blockInstances",
          "propertySchemas",
          "propertyValues",
          "tables",
        ]) {
          assert.equal(
            snapshot[kind].length,
            Object.keys(definition.structure[kind]).length,
            kind,
          );
          for (const entity of snapshot[kind])
            assert.ok(
              !definition.structure[kind][entity.id],
              `fresh ${kind} ID`,
            );
        }
        assert.deepEqual(snapshot.canvases[0].outputProfile, {
          paper: "A3",
          orientation: "landscape",
          widthMillimeters: 420,
          heightMillimeters: 297,
          scaleDenominator: 50,
        });
        assert.equal(snapshot.canvases[0].widthMillimeters, 21000);
        assert.equal(snapshot.canvases[0].heightMillimeters, 14850);
        for (const opening of snapshot.objects.filter(
          (x) => x.type === "opening",
        ))
          assert.ok(
            snapshot.objects.some(
              (x) => x.id === opening.geometry.hostWallId && x.type === "wall",
            ),
          );
        for (const object of snapshot.objects)
          assert.equal(object.lineageId, object.id);
        for (const instance of snapshot.blockInstances) {
          assert.equal(instance.lineageId, instance.id);
          assert.ok(snapshot.blocks.some((b) => b.id === instance.blockId));
        }
        for (const value of snapshot.propertyValues) {
          assert.ok(
            snapshot.propertySchemas.some((s) => s.id === value.schemaId),
          );
          if (value.objectId)
            assert.ok(snapshot.objects.some((o) => o.id === value.objectId));
          if (value.blockInstanceId)
            assert.ok(
              snapshot.blockInstances.some(
                (o) => o.id === value.blockInstanceId,
              ),
            );
        }
        for (const block of snapshot.blocks)
          for (const primitive of block.primitives)
            if (primitive.styleId)
              assert.ok(
                snapshot.styles.some((s) => s.id === primitive.styleId),
              );
        for (const table of snapshot.tables) {
          for (const column of table.columns)
            if (column.kind === "property")
              assert.ok(
                snapshot.propertySchemas.some(
                  (s) => s.id === column.propertySchemaId,
                ),
              );
          for (const row of table.rows) {
            for (const columnId of Object.keys(row.cells))
              assert.ok(table.columns.some((c) => c.id === columnId));
            if (row.objectId)
              assert.ok(snapshot.objects.some((o) => o.id === row.objectId));
            if (row.blockInstanceId)
              assert.ok(
                snapshot.blockInstances.some(
                  (o) => o.id === row.blockInstanceId,
                ),
              );
          }
        }
        for (const layer of snapshot.layers)
          assert.equal(
            layer.locked,
            Object.values(definition.structure.layers).find(
              (x) => x.name === layer.name,
            ).locked,
          );
        await sql`select private.lukas_drawing_p4_assert_semantic_graph(${result.revisionId})`;
      }
      const symbolRequest = randomUUID();
      const symbolCall = importSql(
        "door-single-900",
        symbolRequest,
        first.revisionId,
        "block",
      );
      const symbol = (await run(editor, symbolCall))[0].value;
      assert.deepEqual((await run(editor, symbolCall))[0].value, symbol);
      assert.deepEqual(
        (
          await sql`select primitives from public.lukas_drawing_blocks where id=${symbol.targetEntityId}`
        )[0].primitives,
        listNativeDrawingSymbols().find((x) => x.key === "door-single-900")
          .primitives,
      );
      const [operation] =
        await sql`select forward from public.lukas_drawing_operations where revision_id=${first.revisionId} and forward->'actions'->0->'entity'->>'id'=${symbol.targetEntityId}`;
      assert.equal(
        operation.forward.actions[0].kind,
        "put_block",
        "native symbols use peer-replayable operations",
      );
      const nativeRange = `select * from private.lukas_drawing_collaboration_native_operations('${project}','${first.revisionId}',0)`;
      const nativeRows = await run(
        null,
        nativeRange,
        sql,
        "lukas_drawing_collaboration",
      );
      assert.equal(
        nativeRows.length,
        1,
        "range contains committed native symbol operation",
      );
      assert.equal(
        nativeRows[0].operation.forward.actions[0].entity.id,
        symbol.targetEntityId,
      );
      for (const role of ["anon", "authenticated", "service_role"])
        await assert.rejects(run(editor, nativeRange, sql, role));
      await assert.rejects(
        run(
          null,
          `select * from private.lukas_drawing_collaboration_native_operations('${randomUUID()}','${first.revisionId}',0)`,
          sql,
          "lukas_drawing_collaboration",
        ),
      );
      await assert.rejects(
        run(
          null,
          `select * from private.lukas_drawing_collaboration_native_operations('${project}','${first.revisionId}',-1)`,
          sql,
          "lukas_drawing_collaboration",
        ),
      );
      const nativeOperation = nativeRows[0].operation;
      const storedNative = (
        await sql`select private.lukas_drawing_structure_entity_json('block',${symbol.targetEntityId},${first.revisionId},${project}) entity`
      )[0].entity;
      const restoreNative = {
        type: "mutate_structure",
        actions: [
          { kind: "put_block", entity: storedNative, baseVersion: null },
        ],
      };
      await run(
        editor,
        `select public.lukas_drawing_apply_operation('${first.revisionId}','${randomUUID()}','mutate_structure',${q(JSON.stringify({ [symbol.targetEntityId]: 1 }))}::jsonb,${q(JSON.stringify(nativeOperation.inverse))}::jsonb,${q(JSON.stringify(restoreNative))}::jsonb)`,
      );
      const restoredInverse = {
        type: "mutate_structure",
        actions: [
          { kind: "delete_block", id: symbol.targetEntityId, baseVersion: 3 },
        ],
      };
      await run(
        editor,
        `select public.lukas_drawing_apply_operation('${first.revisionId}','${randomUUID()}','mutate_structure','{}'::jsonb,${q(JSON.stringify(restoreNative))}::jsonb,${q(JSON.stringify(restoredInverse))}::jsonb)`,
      );
      assert.equal(
        (await run(null, nativeRange, sql, "lukas_drawing_collaboration"))
          .length,
        1,
        "later client recreation is not native import authority",
      );
      const [{ canvas }] =
        await sql`select private.lukas_drawing_structure_entity_json('canvas',id,revision_id,project_id) canvas from public.lukas_drawing_canvases where revision_id=${first.revisionId}`;
      const mutateCanvas = async (before, after) =>
        run(
          editor,
          `select public.lukas_drawing_apply_operation('${first.revisionId}','${randomUUID()}','mutate_structure',${q(JSON.stringify({ [before.id]: before.version }))}::jsonb,${q(JSON.stringify({ type: "mutate_structure", actions: [{ kind: "put_canvas", baseVersion: before.version, entity: after }] }))}::jsonb,${q(JSON.stringify({ type: "mutate_structure", actions: [{ kind: "put_canvas", baseVersion: before.version + 1, entity: before }] }))}::jsonb) value`,
        );
      const changed = { ...canvas, name: "A3 output persisted" };
      assert.equal(
        (
          await sql`select private.lukas_drawing_structure_action_valid(${sql.json({ kind: "put_canvas", baseVersion: canvas.version, entity: changed })},${first.revisionId}) valid`
        )[0].valid,
        true,
        JSON.stringify(changed),
      );
      await mutateCanvas(canvas, changed);
      assert.deepEqual(
        (
          await sql`select output_profile from public.lukas_drawing_canvases where id=${canvas.id}`
        )[0].output_profile,
        canvas.outputProfile,
      );
      const current = { ...changed, version: canvas.version + 1 };
      for (const profile of [
        { ...canvas.outputProfile, scaleDenominator: 0 },
        { ...canvas.outputProfile, extra: true },
        { ...canvas.outputProfile, widthMillimeters: 421 },
        null,
      ])
        await assert.rejects(
          mutateCanvas(current, { ...current, outputProfile: profile }),
        );
      const absent = { ...current };
      delete absent.outputProfile;
      await mutateCanvas(current, absent);
      const [without] =
        await sql`select private.lukas_drawing_p2_canonical_snapshot(${first.revisionId},true) snapshot, private.lukas_drawing_p2_canonical_snapshot_pre_output_profile(${first.revisionId},true) legacy`;
      assert.deepEqual(
        without.snapshot,
        without.legacy,
        "absent profiles preserve exact legacy canonical bytes",
      );
      await mutateCanvas(
        { ...absent, version: current.version + 1 },
        {
          ...absent,
          version: current.version + 1,
          outputProfile: canvas.outputProfile,
        },
      );
      for (const fixture of outputProfiles.filter((x) => x.valid)) {
        const [{ before }] =
          await sql`select private.lukas_drawing_structure_entity_json('canvas',id,revision_id,project_id) before from public.lukas_drawing_canvases where id=${canvas.id}`;
        await mutateCanvas(before, {
          ...before,
          widthMillimeters: fixture.widthMillimeters,
          heightMillimeters: fixture.heightMillimeters,
          outputProfile: fixture.profile,
        });
        const [{ stored }] =
          await sql`select private.lukas_drawing_p2_canonical_snapshot(${first.revisionId},true)->'canvases'->0 stored`;
        assert.deepEqual(
          stored.outputProfile,
          fixture.profile,
          `${fixture.name}: stored canonical profile`,
        );
        assert.equal(
          stored.widthMillimeters,
          fixture.widthMillimeters,
          `${fixture.name}: model width roundtrip`,
        );
        assert.equal(
          stored.heightMillimeters,
          fixture.heightMillimeters,
          `${fixture.name}: model height roundtrip`,
        );
      }
      const [{ lastProfile }] =
        await sql`select private.lukas_drawing_structure_entity_json('canvas',id,revision_id,project_id) "lastProfile" from public.lukas_drawing_canvases where id=${canvas.id}`;
      await mutateCanvas(lastProfile, {
        ...lastProfile,
        widthMillimeters: canvas.widthMillimeters,
        heightMillimeters: canvas.heightMillimeters,
        outputProfile: canvas.outputProfile,
      });
      const [{ validBeforeDenials }] =
        await sql`select private.lukas_drawing_structure_entity_json('canvas',id,revision_id,project_id) "validBeforeDenials" from public.lukas_drawing_canvases where id=${canvas.id}`;
      for (const fixture of outputProfiles.filter((x) => !x.valid))
        await assert.rejects(
          mutateCanvas(validBeforeDenials, {
            ...validBeforeDenials,
            widthMillimeters: fixture.widthMillimeters,
            heightMillimeters: fixture.heightMillimeters,
            outputProfile: fixture.profile,
          }),
          fixture.name,
        );
      assert.deepEqual(
        (
          await sql`select private.lukas_drawing_structure_entity_json('canvas',id,revision_id,project_id) canvas from public.lukas_drawing_canvases where id=${canvas.id}`
        )[0].canvas,
        validBeforeDenials,
        "rejected profile operations cannot poison stored canvas",
      );
      const extraCanvas = {
        ...canvas,
        id: randomUUID(),
        name: "Second profiled canvas",
        sortOrder: 1,
        version: 1,
      };
      const extraLayer = {
        id: randomUUID(),
        canvasId: extraCanvas.id,
        name: "Additional work layer",
        visible: true,
        locked: false,
        systemKind: "custom",
        sortOrder: 0,
        version: 1,
      };
      await run(
        editor,
        `select public.lukas_drawing_apply_operation('${first.revisionId}','${randomUUID()}','mutate_structure','{}'::jsonb,${q(
          JSON.stringify({
            type: "mutate_structure",
            actions: [
              { kind: "put_canvas", baseVersion: null, entity: extraCanvas },
              { kind: "put_layer", baseVersion: null, entity: extraLayer },
            ],
          }),
        )}::jsonb,${q(
          JSON.stringify({
            type: "mutate_structure",
            actions: [
              { kind: "delete_layer", id: extraLayer.id, baseVersion: 1 },
              { kind: "delete_canvas", id: extraCanvas.id, baseVersion: 1 },
            ],
          }),
        )}::jsonb)`,
      );
      assert.deepEqual(
        (
          await sql`select output_profile from public.lukas_drawing_canvases where id=${extraCanvas.id}`
        )[0].output_profile,
        canvas.outputProfile,
        "put_canvas insert persists profile",
      );
      const [{ before }] =
        await sql`select count(*)::int before from public.lukas_drawing_library_imports`;
      // Force failure after graph creation; the enclosing RPC must roll all changes back.
      await sql.unsafe(
        `create function private.native_test_receipt_failure() returns trigger language plpgsql as $$ begin raise exception 'native receipt rollback probe'; end $$;create trigger aaa_native_test_receipt_failure before insert on public.lukas_drawing_library_imports for each row execute function private.native_test_receipt_failure()`,
      );
      const [{ documents }] =
        await sql`select count(*)::int documents from public.lukas_drawing_documents`;
      await assert.rejects(
        run(editor, importSql("office-layout", randomUUID())),
        /rollback probe/,
      );
      assert.equal(
        (
          await sql`select count(*)::int count from public.lukas_drawing_documents`
        )[0].count,
        documents,
      );
      assert.equal(
        (
          await sql`select count(*)::int count from public.lukas_drawing_library_imports`
        )[0].count,
        before,
      );
      await sql.unsafe(
        "drop trigger aaa_native_test_receipt_failure on public.lukas_drawing_library_imports;drop function private.native_test_receipt_failure()",
      );
      const [counts] =
        await sql`select (select count(*) from public.lukas_drawing_revision_approvals)::int approvals,(select count(*) from public.lukas_drawing_object_sources)::int sources`;
      assert.deepEqual(counts, { approvals: 0, sources: 0 });
      // An unset optional property is JSON null, not a missing SQL column.
      await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: editor, role: "authenticated" })},true)`;
        await tx`update public.lukas_drawing_property_schemas set required=false,version=version+1 where id=(select schema_id from public.lukas_drawing_property_values where revision_id=${first.revisionId} limit 1)`;
        await tx`update public.lukas_drawing_property_values set value='null'::jsonb,version=version+1 where id=(select id from public.lukas_drawing_property_values where revision_id=${first.revisionId} limit 1)`;
      });
      await assert.rejects(
        sql`update public.lukas_drawing_library_versions set native_asset_key='office-layout' where source_kind='platform_native'`,
      );
      await assert.rejects(
        sql`update public.lukas_drawing_library_versions set status='deprecated',deprecated_at=now() where source_kind='platform_native'`,
      );
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [access] =
          await sql`select has_function_privilege(${role},'private.lukas_drawing_clone_catalog_graph(jsonb,uuid,uuid,text)','EXECUTE') clone,has_function_privilege(${role},'private.lukas_drawing_catalog_rows(jsonb,text)','EXECUTE') rows`;
        assert.deepEqual(access, { clone: false, rows: false });
      }
      const reviewer = randomUUID(),
        approver = randomUUID();
      await sql`insert into auth.users(id,email,email_confirmed_at) values(${reviewer},'review@native.test',now()),(${approver},'approve@native.test',now())`;
      await sql`insert into public.lukas_qto_organization_members(organization_id,user_id,role) values(${organization},${reviewer},'member'),(${organization},${approver},'member')`;
      await sql`insert into public.lukas_qto_project_members(project_id,user_id,role) values(${project},${reviewer},'reviewer'),(${project},${approver},'approver')`;
      await run(
        editor,
        `select public.lukas_drawing_request_review('${first.revisionId}')`,
      );
      assert.deepEqual(
        (await run(editor, symbolCall))[0].value,
        symbol,
        "committed symbol receipt replays during review",
      );
      const [subject] =
        await sql`select r.version,s.sha256 from public.lukas_drawing_revisions r join public.lukas_drawing_snapshots s on s.revision_id=r.id and s.revision_version=r.version where r.id=${first.revisionId}`;
      for (const [actor, decision] of [
        [reviewer, "reviewed"],
        [approver, "approved"],
      ])
        await run(
          actor,
          `select public.lukas_drawing_record_revision_decision('${first.revisionId}',${subject.version},'${subject.sha256}','${decision}','Native fixture approval')`,
        );
      await assert.rejects(
        run(
          editor,
          importSql("window-600", randomUUID(), first.revisionId, "block"),
        ),
        /draft/,
      );
      await assert.rejects(
        run(
          editor,
          `update public.lukas_drawing_canvases set output_profile=null,version=version+1 where id='${canvas.id}'`,
        ),
      );
      await assert.rejects(
        run(
          editor,
          `delete from public.lukas_drawing_canvases where id='${canvas.id}'`,
        ),
      );
      const restored = (
        await run(
          editor,
          `select public.lukas_drawing_restore_approved_snapshot('${first.revisionId}','${randomUUID()}') value`,
        )
      )[0].value;
      assert.deepEqual(
        (
          await sql`select output_profile from public.lukas_drawing_canvases where revision_id=${restored.revisionId}`
        )[0].output_profile,
        canvas.outputProfile,
        "approved restore retains profile",
      );
      await assert.rejects(
        run(
          owner,
          `select public.lukas_drawing_create_library_draft('${organization}','workspace_template','Company example','${first.revisionId}',null,null)`,
        ),
        "company gate remains active",
      );
      await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: owner, role: "authenticated" })},true)`;
        await tx`insert into public.lukas_qto_organization_entitlement_versions(organization_id,version_no,plan,seat_limit,project_limit,library_version_limit,features,reason,request_id,request_sha256,created_by)
        values(${organization},3,'team',10,10,1,${tx.json({ drawing_workspace: true, organization_library: true, realtime_collaboration: true, ifc_workspace: false, quantity_lineage: false })},'Company clone fixture',${randomUUID()},${"f".repeat(64)},${owner})`;
      });
      const company = (
        await run(
          owner,
          `select public.lukas_drawing_create_library_draft('${organization}','workspace_template','Company example','${first.revisionId}',null,null) value`,
        )
      )[0].value;
      await run(
        owner,
        `select public.lukas_drawing_publish_library_version('${organization}','${company.versionId}')`,
      );
      const companyClone = (
        await run(
          editor,
          `select public.lukas_drawing_import_library_version('${organization}','${company.versionId}','${project}',null,'${randomUUID()}') value`,
        )
      )[0].value;
      assert.deepEqual(
        (
          await sql`select output_profile from public.lukas_drawing_canvases where revision_id=${companyClone.revisionId}`
        )[0].output_profile,
        canvas.outputProfile,
        "approved company fullgraph clone retains profile",
      );
      assert.equal(
        (
          await sql`select count(*)::int count from public.lukas_drawing_property_values where revision_id=${companyClone.revisionId} and value='null'::jsonb`
        )[0].count,
        1,
        "approved company clone preserves unset JSON property values",
      );
      const [replayBefore] =
        await sql`select (select count(*) from public.lukas_drawing_operations where revision_id=${first.revisionId})::int operations,(select count(*) from public.lukas_drawing_library_imports)::int receipts`;
      assert.deepEqual(
        (await run(editor, symbolCall))[0].value,
        symbol,
        "committed symbol receipt replays after approval",
      );
      await assert.rejects(
        run(
          editor,
          importSql("window-600", symbolRequest, first.revisionId, "block"),
        ),
        /does not match/,
      );
      assert.deepEqual(
        (
          await sql`select (select count(*) from public.lukas_drawing_operations where revision_id=${first.revisionId})::int operations,(select count(*) from public.lukas_drawing_library_imports)::int receipts`
        )[0],
        replayBefore,
        "approved replay cannot mutate operations or receipts",
      );
      // Reproduce the actual live-room boundary: base 0, native operation 1 absent,
      // browser placement operation 2 present. Use the real freeze and review RPCs.
      bridgeDatabase = createPostgresDrawingCollaborationDatabase(
        `postgres://postgres@127.0.0.1:${port}/postgres`,
      );
      const bridgeTemplate = (
        await run(editor, importSql("office-layout", randomUUID()))
      )[0].value;
      const bridgeScope = {
        projectId: project,
        revisionId: bridgeTemplate.revisionId,
      };
      const bridgeRoom = `drawing:${project}:${bridgeTemplate.revisionId}`;
      const document = new Y.Doc();
      await initializeDrawingCollaborationDocument(document, {
        ...bridgeScope,
        bootstrap: () => bridgeDatabase.bootstrapService(bridgeScope),
      });
      const bridgeRequest = randomUUID(),
        bridgeCall = importSql(
          "door-single-800",
          bridgeRequest,
          bridgeTemplate.revisionId,
          "block",
        );
      const bridgeSymbol = (await run(editor, bridgeCall))[0].value;
      const instanceId = randomUUID(),
        placementId = randomUUID();
      const [{ id: bridgeLayer }] =
        await sql`select id from public.lukas_drawing_layers where revision_id=${bridgeTemplate.revisionId} and system_kind='work' limit 1`;
      const placement = {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_block_instance",
            baseVersion: null,
            entity: {
              id: instanceId,
              lineageId: instanceId,
              blockId: bridgeSymbol.targetEntityId,
              layerId: bridgeLayer,
              name: "Native placement",
              origin: { x: 100, y: 100 },
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              version: 1,
            },
          },
        ],
      };
      const placementInverse = {
        type: "mutate_structure",
        actions: [
          { kind: "delete_block_instance", id: instanceId, baseVersion: 1 },
        ],
      };
      await run(
        editor,
        `select public.lukas_drawing_apply_operation('${bridgeTemplate.revisionId}','${placementId}','mutate_structure','{}'::jsonb,${q(JSON.stringify(placement))}::jsonb,${q(JSON.stringify(placementInverse))}::jsonb)`,
      );
      const [placed] = await bridgeDatabase.lookupOperations(
        bridgeTemplate.revisionId,
        [placementId],
      );
      appendDrawingCollaborationOperation(document, {
        ...drawingCollaborationOperationFromSnapshotOutcome({
          ...placed,
          historyAction: undefined,
          originalOperationId: undefined,
        }),
        createdAt: "2026-09-05T00:00:00.000Z",
      });
      document.getMap("operationStatus").set(placementId, {
        operationId: placementId,
        status: "acked",
        authoritativeSequence: 2,
        resultVersions: placed.resultVersions,
      });
      const coordinator = createDrawingFreezeCoordinator({
        database: bridgeDatabase.freeze,
        setInterval: () => 1,
        clearInterval: () => {},
      });
      const requestFrozen = async (frozen) =>
        run(
          editor,
          `select public.lukas_drawing_request_collaborative_review('${bridgeTemplate.revisionId}','${frozen.freezeRequestId}','${frozen.manifestSha256}',${frozen.manifestCount},${frozen.baseOperationSequence},${frozen.subjectRevisionVersion},${q(frozen.stateVectorBase64)},${q(JSON.stringify(frozen.operationStatuses))}::jsonb,${q(JSON.stringify(frozen.operations))}::jsonb) value`,
        );
      const failedFreeze = randomUUID();
      const incomplete = await coordinator.freeze({
        document,
        roomName: bridgeRoom,
        requestId: failedFreeze,
      });
      assert.equal(incomplete.baseOperationSequence, 0);
      assert.equal(incomplete.manifestCount, 1);
      await assert.rejects(
        requestFrozen(incomplete),
        (error) => error.code === "P3F01" && error.message.includes("manifest"),
      );
      assert.equal(
        (
          await sql`select status from public.lukas_drawing_revisions where id=${bridgeTemplate.revisionId}`
        )[0].status,
        "draft",
      );
      await assert.rejects(
        run(
          editor,
          importSql(
            "window-600",
            randomUUID(),
            bridgeTemplate.revisionId,
            "block",
          ),
        ),
        "freeze still denies new native writes",
      );
      assert.deepEqual(
        (await run(editor, bridgeCall))[0].value,
        bridgeSymbol,
        "frozen native retry remains read-only",
      );
      await coordinator.release({
        document,
        roomName: bridgeRoom,
        requestId: failedFreeze,
      });
      coordinator.dispose();
      const released = await bridgeDatabase.freeze.readFreeze(bridgeScope);
      assert.equal(released.state, "released");
      assert.equal(
        released.requestId,
        failedFreeze,
        "released request survives lease deletion",
      );
      const leaseCount = async (scope) =>
        (
          await sql`select count(*)::int count from private.lukas_drawing_collaboration_freeze_leases where project_id=${scope.projectId} and revision_id=${scope.revisionId}`
        )[0].count;
      assert.equal(await leaseCount(bridgeScope), 0);
      const persistedRelease = await bridgeDatabase.loadService(bridgeScope);
      const freshDocument = new Y.Doc();
      const freshCoordinator = createDrawingFreezeCoordinator({
        database: bridgeDatabase.freeze,
        setInterval: () => 1,
        clearInterval: () => {},
      });
      const beforeRecovery = (
        await sql`select private.lukas_drawing_p2_canonical_snapshot(${bridgeScope.revisionId},true) snapshot`
      )[0].snapshot;
      try {
        Y.applyUpdate(freshDocument, persistedRelease.yjsState);
        const beforeBytes = Y.encodeStateAsUpdate(freshDocument);
        const recovered = await freshCoordinator.reconcileLoaded({
          document: freshDocument,
          roomName: bridgeRoom,
        });
        assert.equal(recovered.freezeState, "released");
        assert.equal(recovered.freezeRequestId, failedFreeze);
        assert.equal(
          freshDocument.getMap("serverMeta").get("freezeRequestId"),
          failedFreeze,
        );
        assert.deepEqual(
          freshDocument.getArray("operations").toJSON(),
          document.getArray("operations").toJSON(),
        );
        assert.deepEqual(
          freshDocument.getArray("operationOrder").toJSON(),
          document.getArray("operationOrder").toJSON(),
        );
        assert.deepEqual(
          Y.encodeStateAsUpdate(freshDocument),
          beforeBytes,
          "fresh persisted release recovery does not rewrite document identity",
        );
        assert.deepEqual(
          (
            await sql`select private.lukas_drawing_p2_canonical_snapshot(${bridgeScope.revisionId},true) snapshot`
          )[0].snapshot,
          beforeRecovery,
          "recovery cannot alter canonical objects or operation identities",
        );
        assert.equal(await leaseCount(bridgeScope), 0);
      } finally {
        freshCoordinator.dispose();
        freshDocument.destroy();
      }

      const preparation = {
        ...bridgeScope,
        requestId: randomUUID(),
        ownerToken: randomUUID(),
        leaseMs: 30000,
      };
      await bridgeDatabase.freeze.acquireFreezeLease(preparation);
      const preparing = await bridgeDatabase.freeze.readFreeze(bridgeScope);
      assert.equal(preparing.state, "freezing");
      assert.equal(
        preparing.requestId,
        preparation.requestId,
        "new preparation B wins over released A",
      );
      await assert.rejects(
        bridgeDatabase.freeze.releaseFreezeLease({
          ...preparation,
          ownerToken: randomUUID(),
        }),
        (error) => error.code === "P3F03",
      );
      await assert.rejects(
        bridgeDatabase.freeze.acquireFreezeLease({
          ...preparation,
          ownerToken: randomUUID(),
        }),
        (error) => error.code === "P3F03",
      );
      await bridgeDatabase.freeze.releaseFreezeLease(preparation);
      const cancelled = await bridgeDatabase.freeze.readFreeze(bridgeScope);
      assert.equal(cancelled.state, "released");
      assert.equal(
        cancelled.requestId,
        failedFreeze,
        "cancel B restores released A",
      );

      const activeScope = {
        projectId: project,
        revisionId: companyClone.revisionId,
      };
      const activePreparation = {
        ...activeScope,
        requestId: randomUUID(),
        ownerToken: randomUUID(),
        leaseMs: 30000,
      };
      await bridgeDatabase.freeze.acquireFreezeLease(activePreparation);
      assert.equal(
        (await bridgeDatabase.freeze.readFreeze(activeScope)).requestId,
        activePreparation.requestId,
      );
      await bridgeDatabase.freeze.releaseFreezeLease(activePreparation);
      const activeAfterCancel =
        await bridgeDatabase.freeze.readFreeze(activeScope);
      assert.equal(activeAfterCancel.state, "active");
      assert.equal(activeAfterCancel.requestId, null);
      assert.equal(await leaseCount(activeScope), 0);

      await bridgeDatabase.freeze.acquireFreezeLease(preparation);
      // Test-only time control on this isolated fixture's lease; production expiry rules stay intact.
      await sql`update private.lukas_drawing_collaboration_freeze_leases set lease_expires_at=clock_timestamp()-interval '1 second' where project_id=${project} and revision_id=${bridgeScope.revisionId} and owner_token=${preparation.ownerToken}`;
      const expired = await bridgeDatabase.freeze.readFreeze(bridgeScope);
      assert.equal(expired.state, "freezing");
      assert.equal(
        expired.requestId,
        preparation.requestId,
        "expired lease keeps its existing recovery fence",
      );
      assert.ok(expired.leaseExpiresAtMs < Date.now());
      await assert.rejects(
        bridgeDatabase.freeze.renewFreezeLease(preparation),
        (error) => error.code === "P3F03",
      );
      await assert.rejects(
        bridgeDatabase.freeze.releaseFreezeLease(preparation),
        (error) => error.code === "P3F03",
      );
      const takeover = { ...preparation, ownerToken: randomUUID() };
      await bridgeDatabase.freeze.acquireFreezeLease(takeover);
      const taken = await bridgeDatabase.freeze.readFreeze(bridgeScope);
      assert.equal(taken.state, "freezing");
      assert.equal(taken.requestId, preparation.requestId);
      assert.equal(taken.ownerToken, takeover.ownerToken);
      await assert.rejects(
        bridgeDatabase.freeze.releaseFreezeLease(preparation),
        (error) => error.code === "P3F03",
      );
      await bridgeDatabase.freeze.releaseFreezeLease(takeover);
      assert.equal(
        (await bridgeDatabase.freeze.readFreeze(bridgeScope)).requestId,
        failedFreeze,
      );
      assert.equal(await leaseCount(bridgeScope), 0);
      for (const role of ["anon", "authenticated", "service_role"]) {
        assert.equal(
          (
            await sql`select has_function_privilege(${role},'private.lukas_drawing_collaboration_read_freeze(uuid,uuid)','EXECUTE') allowed`
          )[0].allowed,
          false,
        );
        await assert.rejects(
          run(
            editor,
            `select * from private.lukas_drawing_collaboration_read_freeze('${project}','${bridgeScope.revisionId}')`,
            sql,
            role,
          ),
          (error) => error.code === "42501",
        );
      }
      assert.equal(
        (
          await sql`select has_function_privilege('lukas_drawing_collaboration','private.lukas_drawing_collaboration_read_freeze(uuid,uuid)','EXECUTE') allowed`
        )[0].allowed,
        true,
      );
      console.log(
        "Released recovery DB: persisted fresh Yjs recovery, lease priority/cancel/expiry and private ACL verified",
      );
      const repairing = createDrawingFreezeCoordinator({
        database: bridgeDatabase.freeze,
        setInterval: () => 1,
        clearInterval: () => {},
        reconcile: async (doc) => {
          await reconcileNativeDrawingOperations(
            doc,
            bridgeDatabase.nativeOperations,
          );
        },
      });
      const repaired = await repairing.freeze({
        document,
        roomName: bridgeRoom,
        requestId: randomUUID(),
      });
      const frozenRead = await bridgeDatabase.freeze.readFreeze(bridgeScope);
      assert.equal(frozenRead.state, "frozen");
      assert.equal(frozenRead.requestId, repaired.freezeRequestId);
      assert.deepEqual(
        repaired.operations.map((o) => o.sequence),
        [1, 2],
      );
      assert.deepEqual(
        repaired.operations.map((o) => o.forward.actions[0].kind),
        ["put_block", "put_block_instance"],
      );
      assert.equal(
        repaired.baseOperationSequence,
        0,
        "bridge cannot rebase away missing client work",
      );
      const committed = (await requestFrozen(repaired))[0].value;
      const committedRead = await bridgeDatabase.freeze.readFreeze(bridgeScope);
      assert.equal(committedRead.state, "frozen");
      assert.equal(committedRead.requestId, repaired.freezeRequestId);
      assert.equal(committedRead.reviewCommitted, true);
      assert.equal(
        (
          await sql`select status from public.lukas_drawing_revisions where id=${bridgeTemplate.revisionId}`
        )[0].status,
        "review_requested",
      );
      assert.deepEqual(
        (await requestFrozen(repaired))[0].value,
        committed,
        "collaborative review replay remains exact",
      );
      await assert.rejects(
        bridgeDatabase.nativeOperations(bridgeScope, 0),
        "reviewed rooms cannot acquire new native envelopes",
      );
      repairing.dispose();
      document.destroy();
      const runtimeTemplate = (
        await run(editor, importSql("office-layout", randomUUID()))
      )[0].value;
      const runtimeRoom = `drawing:${project}:${runtimeTemplate.revisionId}`;
      bridgeRuntime = createDrawingCollaborationServer({
        config: {
          port: 0,
          supabaseUrl: "http://127.0.0.1",
          databaseUrl: "postgres://unused",
          allowedOrigins: new Set(["http://127.0.0.1"]),
          internalSecret: "i".repeat(32),
          freezeSecret: "f".repeat(32),
          authorizationIntervalMs: 30000,
          debounceMs: 10,
          maxDebounceMs: 20,
        },
        verifyToken: async () => ({
          userId: editor,
          email: null,
          expiresAtMs: Date.now() + 60000,
        }),
        authorize: bridgeDatabase.authorize,
        storage: {
          ...createDrawingCollaborationStorage({
            database: bridgeDatabase,
            validateState: validatePersistedDrawingState,
          }),
          close: undefined,
        },
        setInterval: () => 1,
        clearInterval: () => {},
      });
      const bridgeContext = await bridgeRuntime.hooks.authenticate({
        token: "local-test",
        origin: "http://127.0.0.1",
        roomName: runtimeRoom,
      });
      const live = await bridgeRuntime.hocuspocus.createDocument(
        runtimeRoom,
        new Request("http://127.0.0.1"),
        "native-bridge",
        { readOnly: false, isAuthenticated: true },
        bridgeContext,
      );
      live.addDirectConnection();
      assert.equal(live.getArray("operationOrder").length, 0);
      await run(
        editor,
        importSql(
          "door-single-800",
          randomUUID(),
          runtimeTemplate.revisionId,
          "block",
        ),
      );
      await bridgeRuntime.runReconciliationCheck();
      assert.equal(
        live.getArray("operationOrder").length,
        1,
        "periodic runtime bridge reaches the live room",
      );
      await bridgeRuntime.hocuspocus.storeDocumentHooks(
        live,
        {
          document: live,
          documentName: runtimeRoom,
          instance: bridgeRuntime.hocuspocus,
          clientsCount: 1,
          lastContext: bridgeContext,
          lastTransactionOrigin: DRAWING_COLLABORATION_SERVER_ORIGIN,
        },
        true,
      );
      await run(
        editor,
        importSql(
          "window-600",
          randomUUID(),
          runtimeTemplate.revisionId,
          "block",
        ),
      );
      const runtimeFrozen = await bridgeRuntime.applyFreezeRequest(
        JSON.stringify({
          action: "freeze",
          roomName: runtimeRoom,
          freezeRequestId: randomUUID(),
        }),
        "f".repeat(32),
      );
      assert.deepEqual(
        runtimeFrozen.operations.map((o) => o.sequence),
        [1, 2],
        "freeze callback bridges the next native operation without waiting for polling",
      );
      live.removeDirectConnection();
      await bridgeRuntime.stop();
      bridgeRuntime = null;
      console.log(
        "Native bridge DB: missing-sequence freeze rejected; repaired manifest [1,2] reviewed exactly once",
      );
      await sql.begin(async (tx) => {
        await tx.unsafe("set local role authenticated");
        await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: owner, role: "authenticated", app_metadata: { role: "hangil_staff" } })},true)`;
        await tx`select public.lukas_qto_set_organization_entitlement(${organization},'team',10,10,1,null,${tx.json({ drawing_workspace: false, organization_library: true, realtime_collaboration: true, ifc_workspace: false, quantity_lineage: false })},'Native ancestry does not consume company quota',${randomUUID()})`;
      });
      await assert.rejects(
        run(editor, list("workspace_template")),
        "base drawing feature is still required",
      );
      await assert.rejects(
        run(editor, importSql("office-layout", randomUUID())),
        "base drawing feature is still required",
      );
      await assert.rejects(
        run(
          null,
          `select * from private.lukas_drawing_collaboration_native_operations('${project}','${companyClone.revisionId}',0)`,
          sql,
          "lukas_drawing_collaboration",
        ),
      );
      console.log(
        "Native DB: 4 templates, 24 symbols, catalog digests, authority, concurrency, full graph and profile verified",
      );
    } finally {
      if (bridgeRuntime) await bridgeRuntime.stop();
      if (bridgeDatabase) await bridgeDatabase.close();
      if (worker) await worker.end();
      if (sql) await sql.end();
      if (started)
        execFileSync("pg_ctl", ["-D", directory, "-m", "fast", "-w", "stop"], {
          stdio: "ignore",
        });
      await rm(directory, { recursive: true, force: true });
    }
  },
);
