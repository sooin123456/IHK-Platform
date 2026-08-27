import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import postgres from "postgres";

import { calculateVerifiedBoq } from "../app/lukas/lib/verified-boq.server.ts";
import {
  applyP6CurrentAuthority,
  p6Ids,
  p6LegacyInput,
  p6MaterialPayload,
  p6SeedBoq11Draft,
  p6SeedPopulatedAuthority,
  p6Sha,
  p6WallFingerprint,
  readP6Migration,
} from "./fixtures/drawing-workspace-p6-database-fixtures.mjs";

const databaseUrl = process.env.P6_REAL_POSTGRES_DATABASE_URL;
const required = process.env.P6_REAL_POSTGRES_REQUIRED === "1";
const roles = Object.freeze(["anon", "authenticated", "service_role"]);
const overLinkId = "66000000-0000-4000-8000-000000000010";

function quoteIdentifier(value) {
  assert.match(value, /^[a-z][a-z0-9_]{0,62}$/);
  return `"${value}"`;
}

function isolatedUrl(source, databaseName) {
  const url = new URL(source);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function adapter(sql) {
  return {
    async exec(text) {
      return sql.unsafe(text);
    },
    async query(text, parameters = []) {
      return { rows: [...(await sql.unsafe(text, parameters))] };
    },
  };
}

async function assertSqlState(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    return true;
  });
}

async function session(
  sql,
  role,
  userId,
  callback,
  { anonymous = false, staff = false } = {},
) {
  assert.ok(roles.includes(role));
  return sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${quoteIdentifier(role)}`);
    await tx`select pg_catalog.set_config(
      'request.jwt.claim.sub',${userId ?? ""},true
    )`;
    await tx`select pg_catalog.set_config(
      'request.jwt.claims',${JSON.stringify({
        sub: userId ?? undefined,
        is_anonymous: anonymous,
        app_metadata: staff ? { role: "hangil_staff" } : {},
      })},true
    )`;
    return callback(tx);
  });
}

async function insertQuantity(sql, snapshotSha) {
  return session(
    sql,
    "service_role",
    p6Ids.maker,
    (tx) => tx`
    select (private.lukas_drawing_insert_quantity_link(
      ${p6Ids.maker}::uuid,${p6Ids.quantityLink}::uuid,
      ${p6Ids.revision}::uuid,${p6Ids.wall}::uuid,'length',
      ${snapshotSha}::text,${p6Ids.wall}::uuid,1,
      ${p6WallFingerprint},5,'m','P4_MEASUREMENT_V1'
    )).*
  `,
  );
}

async function putBoqLink(
  sql,
  factor,
  {
    actor = p6Ids.maker,
    anonymous = false,
    baseVersion = null,
    id = p6Ids.boqLink,
  } = {},
) {
  return session(
    sql,
    "authenticated",
    actor,
    (tx) => tx`
      select (public.lukas_drawing_put_boq_link(
        ${id}::uuid,${p6Ids.quantityLink}::uuid,${p6Ids.boq11}::uuid,
        ${p6Ids.boq11Line}::uuid,${factor}::numeric,${baseVersion}::bigint
      )).*
    `,
    { anonymous },
  );
}

async function boqInput(sql, actor = p6Ids.maker, anonymous = false) {
  return session(
    sql,
    "authenticated",
    actor,
    (tx) => tx`
      select public.lukas_qto_boq_v1_1_input(${p6Ids.boq11}::uuid) value
    `,
    { anonymous },
  );
}

async function finalize(sql, inputSha, resultSha = p6Sha.result) {
  return session(
    sql,
    "service_role",
    p6Ids.maker,
    (tx) => tx`
    select private.lukas_qto_finalize_boq_v1_1(
      ${p6Ids.maker}::uuid,${p6Ids.boq11}::uuid,${inputSha},${resultSha},
      ${p6Sha.manifest},6250,1
    ) value
  `,
  );
}

async function materialHandoff(sql) {
  const payload = p6MaterialPayload();
  return session(
    sql,
    "service_role",
    p6Ids.maker,
    (tx) => tx`
    select private.lukas_drawing_insert_material_handoff(
      ${p6Ids.maker}::uuid,${p6Ids.boq11}::uuid,${p6Sha.result},
      ${p6Ids.manifestFile}::uuid,${p6Sha.manifest},
      ${tx.json(payload.plans)}::jsonb,${tx.json(payload.links)}::jsonb
    ) value
  `,
  );
}

async function readCounts(sql, role, actor, { anonymous = false } = {}) {
  return session(
    sql,
    role,
    actor,
    (tx) => tx`select
      (select pg_catalog.count(*)::int from public.lukas_drawing_quantity_links) quantities,
      (select pg_catalog.count(*)::int from public.lukas_drawing_boq_links) boq_links,
      (select pg_catalog.count(*)::int from public.lukas_drawing_material_links) material_links`,
    { anonymous },
  );
}

async function snapshotP0P5(sql) {
  const [snapshot] = await sql`
    select pg_catalog.jsonb_build_object(
      'snapshot',(select canonical_json::text from public.lukas_drawing_snapshots where id=${p6Ids.snapshot}::uuid),
      'legacyBoq',(select pg_catalog.jsonb_build_object(
        'status',status,'engine',engine_version,'result',result_sha256,
        'cost',direct_cost_krw,'lines',line_count
      ) from public.lukas_qto_boq_versions where id=${p6Ids.legacyApprovedBoq}::uuid),
      'files',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(id,project_id,sha256,byte_size) order by id) from public.lukas_qto_files),
      'plans',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) order by id) from public.lukas_qto_material_plans p),
      'transactions',(select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by id) from public.lukas_qto_material_transactions x),
      'projects',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(id,owner_id) order by id) from public.lukas_qto_projects)
    )::text value
  `;
  return snapshot.value;
}

test(
  "P6 real PostgreSQL gate is configured",
  { skip: !required || Boolean(databaseUrl) },
  () => {
    throw new Error("P6 real PostgreSQL gate is UNEXECUTED");
  },
);

test(
  "P6 real PostgreSQL proves isolated upgrade, RLS, races, immutability, and indexes",
  { skip: databaseUrl ? false : "P6 real PostgreSQL gate is UNEXECUTED" },
  async () => {
    const admin = postgres(databaseUrl, { max: 1, prepare: false });
    const databaseName = `p6_task_${process.pid}_${randomBytes(6).toString("hex")}`;
    const databaseIdentifier = quoteIdentifier(databaseName);
    const createdRoles = [];
    const grantedMemberships = [];
    const clients = [];
    let databaseCreated = false;
    const openClient = () => {
      const client = postgres(isolatedUrl(databaseUrl, databaseName), {
        max: 1,
        prepare: false,
      });
      clients.push(client);
      return client;
    };

    try {
      const existing = await admin`
        select rolname from pg_catalog.pg_roles
        where rolname in ('anon','authenticated','service_role')
      `;
      const existingNames = new Set(existing.map((row) => row.rolname));
      for (const role of roles) {
        if (!existingNames.has(role)) {
          await admin.unsafe(
            `create role ${quoteIdentifier(role)} nologin${
              role === "service_role" ? " bypassrls" : ""
            }`,
          );
          createdRoles.push(role);
        }
        const [membership] = await admin`
          select pg_catalog.pg_has_role(
            current_user,${role},'MEMBER'
          ) member
        `;
        if (!membership.member) {
          await admin.unsafe(`grant ${quoteIdentifier(role)} to current_user`);
          grantedMemberships.push(role);
        }
      }

      await admin.unsafe(`create database ${databaseIdentifier}`);
      databaseCreated = true;
      const owner = openClient();
      const ownerAdapter = adapter(owner);
      await applyP6CurrentAuthority(ownerAdapter, {
        createRoles: false,
        optIn: true,
      });
      const legacyResult = calculateVerifiedBoq(p6LegacyInput);
      const seed = await p6SeedPopulatedAuthority(ownerAdapter, legacyResult);
      const before = await snapshotP0P5(owner);
      await owner.unsafe(await readP6Migration());
      assert.equal(await snapshotP0P5(owner), before);
      assert.equal(
        (
          await owner`
            select result_sha256 from public.lukas_qto_boq_versions
            where id=${p6Ids.legacyApprovedBoq}::uuid
          `
        )[0].result_sha256,
        legacyResult.canonicalSha256,
      );
      await p6SeedBoq11Draft(ownerAdapter);

      const serviceA = openClient();
      const serviceB = openClient();
      const makerA = openClient();
      const makerB = openClient();
      const roleClient = openClient();
      await insertQuantity(serviceA, seed.snapshotSha256);

      await assertSqlState(boqInput(roleClient, p6Ids.maker, true), "P6A01");
      await assertSqlState(boqInput(roleClient, null), "P6A01");
      for (const actor of [
        p6Ids.outsider,
        p6Ids.otherMaker,
        p6Ids.viewer,
        p6Ids.commenter,
        p6Ids.reviewer,
      ])
        await assertSqlState(putBoqLink(roleClient, "0.4", { actor }), "P6A01");

      const exactRace = await Promise.all([
        putBoqLink(makerA, "0.4"),
        putBoqLink(makerB, "0.4"),
      ]);
      assert.equal(exactRace[0][0].id, p6Ids.boqLink);
      assert.deepEqual(exactRace[1][0], exactRace[0][0]);
      await assertSqlState(
        putBoqLink(roleClient, "0.4", { actor: p6Ids.otherMaker }),
        "P6O01",
      );
      await assertSqlState(
        putBoqLink(makerA, "0.7", { id: overLinkId }),
        "P6B04",
      );

      const mismatchedRace = await Promise.allSettled([
        putBoqLink(makerA, "0.1", { id: p6Ids.secondBoqLink }),
        putBoqLink(makerB, "0.2", { id: p6Ids.secondBoqLink }),
      ]);
      assert.equal(
        mismatchedRace.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const mismatchFailure = mismatchedRace.find(
        (result) => result.status === "rejected",
      );
      assert.equal(mismatchFailure.reason.code, "P6O01");
      const mismatchWinner = mismatchedRace.find(
        (result) => result.status === "fulfilled",
      ).value[0];
      await session(
        makerA,
        "authenticated",
        p6Ids.maker,
        (tx) => tx`
        select public.lukas_drawing_delete_boq_link(
          ${p6Ids.secondBoqLink}::uuid,${mismatchWinner.version}
        )
      `,
      );

      const updateRace = await Promise.allSettled([
        putBoqLink(makerA, "0.5", { baseVersion: 1 }),
        putBoqLink(makerB, "0.6", { baseVersion: 1 }),
      ]);
      assert.equal(
        updateRace.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        updateRace.find((result) => result.status === "rejected").reason.code,
        "P6O01",
      );
      await putBoqLink(makerA, "1", { baseVersion: 2 });
      const [inputRow] = await boqInput(makerA);
      const submissionRace = await Promise.all([
        finalize(serviceA, inputRow.value.inputStateSha256),
        finalize(serviceB, inputRow.value.inputStateSha256),
      ]);
      assert.deepEqual(submissionRace[1][0], submissionRace[0][0]);
      await assertSqlState(
        finalize(serviceA, inputRow.value.inputStateSha256, p6Sha.other),
        "P6O01",
      );
      await assertSqlState(putBoqLink(makerA, "1"), "P6O01");

      await assertSqlState(
        session(
          makerA,
          "authenticated",
          p6Ids.maker,
          (tx) => tx`
          select public.lukas_qto_decide_boq(
            ${p6Ids.boq11}::uuid,'approved','maker'
          )
        `,
        ),
        "P6A01",
      );
      await assertSqlState(
        session(
          roleClient,
          "authenticated",
          p6Ids.reviewer,
          (tx) => tx`
            select public.lukas_qto_decide_boq(
              ${p6Ids.boq11}::uuid,'approved','anonymous reviewer'
            )
          `,
          { anonymous: true },
        ),
        "P6A01",
      );
      await session(
        roleClient,
        "authenticated",
        p6Ids.reviewer,
        (tx) => tx`
          select public.lukas_qto_decide_boq(
            ${p6Ids.boq11}::uuid,'approved','independent reviewer'
          )
        `,
      );
      const firstMaterial = await materialHandoff(serviceA);
      assert.deepEqual(firstMaterial[0].value, { insertedOrReplayed: 1 });
      assert.deepEqual((await materialHandoff(serviceB))[0], firstMaterial[0]);

      for (const actor of [
        p6Ids.maker,
        p6Ids.reviewer,
        p6Ids.viewer,
        p6Ids.commenter,
      ]) {
        const [counts] = await readCounts(roleClient, "authenticated", actor);
        assert.deepEqual(counts, {
          quantities: 1,
          boq_links: 1,
          material_links: 1,
        });
      }
      for (const [actor, options] of [
        [p6Ids.outsider, {}],
        [p6Ids.maker, { anonymous: true }],
        [null, {}],
      ]) {
        const [counts] = await readCounts(
          roleClient,
          "authenticated",
          actor,
          options,
        );
        assert.deepEqual(counts, {
          quantities: 0,
          boq_links: 0,
          material_links: 0,
        });
      }
      await assertSqlState(readCounts(roleClient, "anon", null), "42501");
      assert.deepEqual(
        (await readCounts(serviceA, "service_role", p6Ids.maker))[0],
        { quantities: 1, boq_links: 1, material_links: 1 },
      );

      await assertSqlState(
        session(
          serviceA,
          "service_role",
          p6Ids.maker,
          (tx) => tx`
          update public.lukas_drawing_quantity_links set raw_quantity=4
          where id=${p6Ids.quantityLink}::uuid
        `,
        ),
        "42501",
      );
      await assertSqlState(
        session(
          serviceA,
          "service_role",
          p6Ids.maker,
          (tx) => tx`
          update public.lukas_drawing_material_links
          set derived_design_quantity=9 where id=${p6Ids.materialLink}::uuid
        `,
        ),
        "42501",
      );
      await assertSqlState(
        owner`
          update public.lukas_drawing_quantity_links set raw_quantity=4
          where id=${p6Ids.quantityLink}::uuid
        `,
        "P6Q02",
      );
      await assertSqlState(
        owner`
          update public.lukas_drawing_material_links
          set derived_design_quantity=9 where id=${p6Ids.materialLink}::uuid
        `,
        "P6M02",
      );
      await assertSqlState(
        owner`
          update public.lukas_drawing_boq_links set allocation_factor=.9
          where id=${p6Ids.boqLink}::uuid
        `,
        "P6O01",
      );

      await owner.unsafe("set enable_seqscan=off");
      try {
        const explainQuantity = await owner`
          explain (format json,costs off)
          select * from public.lukas_drawing_quantity_links
          where project_id=${p6Ids.project}::uuid
            and drawing_revision_id=${p6Ids.revision}::uuid
            and drawing_object_id=${p6Ids.wall}::uuid
        `;
        assert.match(
          JSON.stringify(explainQuantity),
          /lukas_drawing_quantity_links_object_idx/,
        );
        const explainBoq = await owner`
          explain (format json,costs off)
          select * from public.lukas_drawing_boq_links
          where project_id=${p6Ids.project}::uuid
            and quantity_link_id=${p6Ids.quantityLink}::uuid
        `;
        assert.match(
          JSON.stringify(explainBoq),
          /lukas_drawing_boq_links_source_idx/,
        );
        const explainMaterial = await owner`
          explain (format json,costs off)
          select * from public.lukas_drawing_material_links
          where project_id=${p6Ids.project}::uuid
            and material_plan_id=${p6Ids.materialPlan}::uuid
        `;
        assert.match(
          JSON.stringify(explainMaterial),
          /lukas_drawing_material_links_plan_idx/,
        );
      } finally {
        await owner.unsafe("reset enable_seqscan");
      }

      const catalog = await owner`select
        pg_catalog.has_function_privilege(
          'anon','public.lukas_drawing_put_boq_link(uuid,uuid,uuid,uuid,numeric,bigint)','execute'
        ) anon_put,
        pg_catalog.has_function_privilege(
          'authenticated','private.lukas_drawing_p6_measure(jsonb,text,jsonb)','execute'
        ) helper_execute,
        (select prosecdef from pg_catalog.pg_proc
          where oid='public.lukas_qto_decide_boq(uuid,text,text)'::pg_catalog.regprocedure
        ) decision_definer,
        (select proconfig from pg_catalog.pg_proc
          where oid='public.lukas_qto_decide_boq(uuid,text,text)'::pg_catalog.regprocedure
        ) decision_config`;
      assert.deepEqual(catalog[0], {
        anon_put: false,
        helper_execute: false,
        decision_definer: true,
        decision_config: ['search_path=""'],
      });
    } finally {
      let cleanupFailure = null;
      const clean = async (operation) => {
        try {
          await operation();
        } catch (error) {
          cleanupFailure ??= error;
        }
      };
      for (const client of clients.reverse()) {
        await clean(() => client.end({ timeout: 5 }));
      }
      if (databaseCreated) {
        await clean(
          () => admin`
          select pg_catalog.pg_terminate_backend(pid)
          from pg_catalog.pg_stat_activity
          where datname=${databaseName} and pid<>pg_catalog.pg_backend_pid()
        `,
        );
        await clean(() => admin.unsafe(`drop database ${databaseIdentifier}`));
      }
      for (const role of grantedMemberships.reverse())
        await clean(() =>
          admin.unsafe(`revoke ${quoteIdentifier(role)} from current_user`),
        );
      for (const role of createdRoles.reverse())
        await clean(() => admin.unsafe(`drop role ${quoteIdentifier(role)}`));
      await clean(() => admin.end({ timeout: 5 }));
      if (cleanupFailure) throw cleanupFailure;
    }
  },
);
