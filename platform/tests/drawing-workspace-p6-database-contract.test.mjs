import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

import { calculateVerifiedBoq } from "../app/lukas/lib/verified-boq.server.ts";
import {
  applyP6CurrentAuthority,
  p6Ids,
  p6LegacyInput,
  p6MaterialPayload,
  p6OpeningFingerprint,
  p6SeedBoq11Draft,
  p6SetSession,
  p6SeedPopulatedAuthority,
  p6Sha,
  p6SpaceFingerprint,
  p6WallFingerprint,
  readP6Migration,
} from "./fixtures/drawing-workspace-p6-database-fixtures.mjs";

const adversarialIds = Object.freeze({
  quantityWrong: "66000000-0000-4000-8000-000000000011",
  quantityWrong2: "66000000-0000-4000-8000-000000000012",
  quantityWrong3: "66000000-0000-4000-8000-000000000013",
  quantityWrong4: "66000000-0000-4000-8000-000000000014",
  quantityWrong5: "66000000-0000-4000-8000-000000000015",
  overBoqLink: "66000000-0000-4000-8000-000000000016",
  quantityOpening: "66000000-0000-4000-8000-000000000017",
  quantityOwner: "66000000-0000-4000-8000-000000000018",
  quantityStaff: "66000000-0000-4000-8000-000000000019",
  unusedMaterialPlan: "67000000-0000-4000-8000-000000000006",
});

async function assertSqlState(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    return true;
  });
}

const preservedQueries = Object.freeze({
  drawing: `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)::text value
    from (select * from public.lukas_drawing_objects) x`,
  snapshots: `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)::text value
    from (select * from public.lukas_drawing_snapshots) x`,
  drawingApprovals: `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)::text value
    from (select * from public.lukas_drawing_revision_approvals) x`,
  boqVersions: `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)::text value from (
    select id,project_id,version_no,title,status,calculation_policy,quantity_scale,
      price_book_id,supersedes_id,engine_version,result_sha256,direct_cost_krw,
      line_count,created_by,submitted_at,approved_at,created_at
    from public.lukas_qto_boq_versions) x`,
  boqLines: `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)::text value
    from (select * from public.lukas_qto_boq_lines) x`,
  boqComponents: `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)::text value
    from (select * from public.lukas_qto_boq_rate_components) x`,
  boqMappings: `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)::text value
    from (select * from public.lukas_qto_boq_quantity_mappings) x`,
  boqApprovals: `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)::text value
    from (select * from public.lukas_qto_boq_approvals) x`,
  files: `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)::text value
    from (select * from public.lukas_qto_files) x`,
  materialPlans: `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)::text value
    from (select * from public.lukas_qto_material_plans) x`,
  materialTransactions: `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)::text value
    from (select * from public.lukas_qto_material_transactions) x`,
  carbon: `select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id)::text value
    from (select * from public.lukas_qto_carbon_factors) x`,
});

async function snapshotAuthority(db) {
  const entries = await Promise.all(
    Object.entries(preservedQueries).map(async ([name, sql]) => {
      const result = await db.query(sql);
      return [name, result.rows[0].value];
    }),
  );
  return Object.fromEntries(entries);
}

async function createAuthority({ optIn = false, populated = false } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await applyP6CurrentAuthority(db, { optIn });
    const legacyResult = calculateVerifiedBoq(p6LegacyInput);
    const seed = populated
      ? await p6SeedPopulatedAuthority(db, legacyResult)
      : null;
    const before = populated ? await snapshotAuthority(db) : null;
    await db.exec(await readP6Migration());
    return { db, legacyResult, seed, before };
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function insertWallQuantity(db, seed, overrides = {}) {
  const values = {
    actorId: p6Ids.maker,
    id: p6Ids.quantityLink,
    revisionId: p6Ids.revision,
    objectId: p6Ids.wall,
    kind: "length",
    snapshotSha256: seed.snapshotSha256,
    lineageId: p6Ids.wall,
    objectVersion: 1,
    fingerprint: p6WallFingerprint,
    rawQuantity: "5",
    unit: "m",
    rule: "P4_MEASUREMENT_V1",
    ...overrides,
  };
  return db.query(
    `select (private.lukas_drawing_insert_quantity_link(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
    )).*`,
    [
      values.actorId,
      values.id,
      values.revisionId,
      values.objectId,
      values.kind,
      values.snapshotSha256,
      values.lineageId,
      values.objectVersion,
      values.fingerprint,
      values.rawQuantity,
      values.unit,
      values.rule,
    ],
  );
}

async function putBoqLink(db, overrides = {}) {
  const values = {
    id: p6Ids.boqLink,
    quantityLinkId: p6Ids.quantityLink,
    versionId: p6Ids.boq11,
    lineId: p6Ids.boq11Line,
    factor: "0.4",
    baseVersion: null,
    ...overrides,
  };
  return db.query(
    `select (public.lukas_drawing_put_boq_link($1,$2,$3,$4,$5,$6)).*`,
    [
      values.id,
      values.quantityLinkId,
      values.versionId,
      values.lineId,
      values.factor,
      values.baseVersion,
    ],
  );
}

async function readBoqInput(db) {
  const result = await db.query(
    `select public.lukas_qto_boq_v1_1_input($1) value`,
    [p6Ids.boq11],
  );
  return result.rows[0].value;
}

async function insertMaterialHandoff(db, overrides = {}) {
  const payload = p6MaterialPayload();
  const values = {
    actorId: p6Ids.maker,
    versionId: p6Ids.boq11,
    resultSha256: p6Sha.result,
    manifestFileId: p6Ids.manifestFile,
    manifestSha256: p6Sha.manifest,
    plans: payload.plans,
    links: payload.links,
    ...overrides,
  };
  return db.query(
    `select private.lukas_drawing_insert_material_handoff(
      $1,$2,$3,$4,$5,$6::jsonb,$7::jsonb
    ) value`,
    [
      values.actorId,
      values.versionId,
      values.resultSha256,
      values.manifestFileId,
      values.manifestSha256,
      JSON.stringify(values.plans),
      JSON.stringify(values.links),
    ],
  );
}

async function approveBoq11(db, seed) {
  await p6SetSession(db, "service_role", p6Ids.maker);
  await insertWallQuantity(db, seed);
  await p6SeedBoq11Draft(db);
  await p6SetSession(db, "authenticated", p6Ids.maker);
  await putBoqLink(db, { factor: "1" });
  const input = await readBoqInput(db);
  await p6SetSession(db, "service_role", p6Ids.maker);
  await db.query(
    `select private.lukas_qto_finalize_boq_v1_1($1,$2,$3,$4,$5,$6,$7)`,
    [
      p6Ids.maker,
      p6Ids.boq11,
      input.inputStateSha256,
      p6Sha.result,
      p6Sha.manifest,
      "6250",
      1,
    ],
  );
  await p6SetSession(db, "authenticated", p6Ids.reviewer);
  await db.query(
    `select public.lukas_qto_decide_boq($1,'approved','checked')`,
    [p6Ids.boq11],
  );
  return input;
}

test("P6 applies over both real current-authority default-privilege states", async (t) => {
  for (const optIn of [false, true]) {
    await t.test(optIn ? "hardened defaults" : "legacy defaults", async () => {
      const { db } = await createAuthority({ optIn });
      try {
        const tables = await db.query(
          `select relname from pg_catalog.pg_class
           where relname in (
             'lukas_drawing_boq_links',
             'lukas_drawing_material_links',
             'lukas_drawing_quantity_links'
           ) order by relname`,
        );
        assert.deepEqual(
          tables.rows.map((row) => row.relname),
          [
            "lukas_drawing_boq_links",
            "lukas_drawing_material_links",
            "lukas_drawing_quantity_links",
          ],
        );
        const indexes = await db.query(
          `select indexname from pg_catalog.pg_indexes
           where indexname in (
             'lukas_drawing_boq_links_source_idx',
             'lukas_drawing_material_links_plan_idx',
             'lukas_drawing_quantity_links_object_idx'
           ) order by indexname`,
        );
        assert.equal(indexes.rows.length, 3);
      } finally {
        await db.close();
      }
    });
  }
});

test("P6 preserves a populated P0-P5 authority byte-for-byte and legacy BOQ replay", async () => {
  const { db, before, legacyResult } = await createAuthority({
    populated: true,
  });
  try {
    assert.deepEqual(await snapshotAuthority(db), before);
    assert.deepEqual(calculateVerifiedBoq(p6LegacyInput), legacyResult);
    const version = await db.query(
      `select engine_version,status,result_sha256,direct_cost_krw,line_count
       from public.lukas_qto_boq_versions where id=$1`,
      [p6Ids.legacyApprovedBoq],
    );
    assert.deepEqual(version.rows[0], {
      engine_version: "VERIFIED-BOQ-1.0",
      status: "approved",
      result_sha256: legacyResult.canonicalSha256,
      direct_cost_krw: `${legacyResult.directCostKrw}.000000`,
      line_count: legacyResult.lines.length,
    });
  } finally {
    await db.close();
  }
});

test("quantity authority rejects stale identity and proves exact immutable replay", async () => {
  const { db, seed } = await createAuthority({ populated: true });
  try {
    await p6SetSession(db, "service_role", p6Ids.maker);
    const inserted = await insertWallQuantity(db, seed);
    assert.equal(inserted.rows[0].raw_quantity, "5.000000000000");
    assert.deepEqual(
      (await insertWallQuantity(db, seed)).rows[0],
      inserted.rows[0],
    );
    const opening = await insertWallQuantity(db, seed, {
      id: adversarialIds.quantityOpening,
      objectId: p6Ids.opening,
      kind: "area",
      lineageId: p6Ids.opening,
      fingerprint: p6OpeningFingerprint,
      rawQuantity: "1.89",
      unit: "m2",
    });
    assert.equal(opening.rows[0].raw_quantity, "1.890000000000");
    await p6SetSession(db, "service_role", p6Ids.owner);
    const ownerQuantity = await insertWallQuantity(db, seed, {
      actorId: p6Ids.owner,
      id: adversarialIds.quantityOwner,
      objectId: p6Ids.space,
      kind: "area",
      lineageId: p6Ids.space,
      fingerprint: p6SpaceFingerprint,
      rawQuantity: "12",
      unit: "m2",
    });
    assert.equal(ownerQuantity.rows[0].created_by, p6Ids.owner);
    await p6SetSession(db, "service_role", p6Ids.outsider, { staff: true });
    const staffQuantity = await insertWallQuantity(db, seed, {
      actorId: p6Ids.outsider,
      id: adversarialIds.quantityStaff,
      objectId: p6Ids.space,
      kind: "count",
      lineageId: p6Ids.space,
      fingerprint: p6SpaceFingerprint,
      rawQuantity: "1",
      unit: "EA",
    });
    assert.equal(staffQuantity.rows[0].created_by, p6Ids.outsider);
    for (const status of ["draft", "review_requested"]) {
      await p6SetSession(db, null, p6Ids.maker);
      await db.query(
        `update public.lukas_drawing_revisions set status=$2 where id=$1`,
        [p6Ids.revision, status],
      );
      await p6SetSession(db, "service_role", p6Ids.maker);
      await assertSqlState(insertWallQuantity(db, seed), "P6Q03");
    }
    await p6SetSession(db, null, p6Ids.maker);
    await db.query(
      `update public.lukas_drawing_revisions set status='superseded' where id=$1`,
      [p6Ids.revision],
    );
    await p6SetSession(db, "service_role", p6Ids.maker);
    assert.equal(
      (await insertWallQuantity(db, seed)).rows[0].id,
      p6Ids.quantityLink,
    );
    await p6SetSession(db, null, p6Ids.maker);
    await db.query(
      `update public.lukas_drawing_revisions set status='approved' where id=$1`,
      [p6Ids.revision],
    );
    await db.query(
      `update public.lukas_drawing_revision_approvals set decision='rejected' where id=$1`,
      [p6Ids.drawingApproval],
    );
    await p6SetSession(db, "service_role", p6Ids.maker);
    await assertSqlState(insertWallQuantity(db, seed), "P6Q03");
    await p6SetSession(db, null, p6Ids.maker);
    await db.query(
      `delete from public.lukas_drawing_revision_approvals where id=$1`,
      [p6Ids.drawingApproval],
    );
    await p6SetSession(db, "service_role", p6Ids.maker);
    await assertSqlState(insertWallQuantity(db, seed), "P6Q03");
    await p6SetSession(db, null, p6Ids.maker);
    await db.query(
      `insert into public.lukas_drawing_revision_approvals(
        id,revision_id,project_id,subject_version,snapshot_sha256,
        decision,note,decided_by,created_at
      ) values($1,$2,$3,7,$4,'approved','checked',$5,'2026-08-04T00:00:00Z')`,
      [
        p6Ids.drawingApproval,
        p6Ids.revision,
        p6Ids.project,
        seed.snapshotSha256,
        p6Ids.reviewer,
      ],
    );
    await p6SetSession(db, "service_role", p6Ids.maker);
    await assertSqlState(
      insertWallQuantity(db, seed, { rawQuantity: "4" }),
      "P6Q01",
    );
    await assertSqlState(
      insertWallQuantity(db, seed, {
        kind: "count",
        rawQuantity: "1",
        unit: "EA",
      }),
      "P6O01",
    );
    await assertSqlState(
      insertWallQuantity(db, seed, {
        id: adversarialIds.quantityWrong,
        snapshotSha256: p6Sha.other,
      }),
      "P6Q03",
    );
    await assertSqlState(
      insertWallQuantity(db, seed, {
        id: adversarialIds.quantityWrong2,
        fingerprint: p6Sha.other,
      }),
      "P6Q03",
    );
    await assertSqlState(
      insertWallQuantity(db, seed, {
        id: adversarialIds.quantityWrong3,
        rule: "P4_MEASUREMENT_V0",
      }),
      "P6Q03",
    );
    await assertSqlState(
      insertWallQuantity(db, seed, {
        id: adversarialIds.quantityWrong4,
        unit: "m2",
      }),
      "P6U01",
    );
    await assertSqlState(
      insertWallQuantity(db, seed, {
        id: adversarialIds.quantityWrong5,
        rawQuantity: "5.000000000001",
      }),
      "P6Q01",
    );
    await assertSqlState(
      insertWallQuantity(db, seed, {
        id: adversarialIds.quantityWrong,
        actorId: p6Ids.outsider,
      }),
      "P6Q03",
    );

    await p6SetSession(db, null, p6Ids.maker);
    await db.query(
      `update public.lukas_drawing_snapshots set schema_version=1 where id=$1`,
      [p6Ids.snapshot],
    );
    await p6SetSession(db, "service_role", p6Ids.maker);
    await assertSqlState(
      insertWallQuantity(db, seed, { id: adversarialIds.quantityWrong }),
      "P6Q03",
    );
    await p6SetSession(db, null, p6Ids.maker);
    await db.query(
      `update public.lukas_drawing_snapshots set schema_version=2 where id=$1`,
      [p6Ids.snapshot],
    );
    await db.query(
      `update public.lukas_drawing_revisions set version=8 where id=$1`,
      [p6Ids.revision],
    );
    await p6SetSession(db, "service_role", p6Ids.maker);
    await assertSqlState(
      insertWallQuantity(db, seed, { id: adversarialIds.quantityWrong }),
      "P6Q03",
    );
    await p6SetSession(db, null, p6Ids.maker);
    await db.query(
      `update public.lukas_drawing_revisions set version=7 where id=$1`,
      [p6Ids.revision],
    );

    await p6SetSession(db, "service_role", p6Ids.maker);
    await assertSqlState(
      db.query(
        `update public.lukas_drawing_quantity_links set raw_quantity=4 where id=$1`,
        [p6Ids.quantityLink],
      ),
      "42501",
    );
    await assertSqlState(
      db.query(`delete from public.lukas_drawing_quantity_links where id=$1`, [
        p6Ids.quantityLink,
      ]),
      "42501",
    );
    await p6SetSession(db, null, p6Ids.maker);
    await assertSqlState(
      db.query(
        `update public.lukas_drawing_quantity_links set raw_quantity=4 where id=$1`,
        [p6Ids.quantityLink],
      ),
      "P6Q02",
    );
    await assertSqlState(
      db.query(`delete from public.lukas_drawing_quantity_links where id=$1`, [
        p6Ids.quantityLink,
      ]),
      "P6Q02",
    );
  } finally {
    await db.close();
  }
});

test("BOQ 1.1 authority enforces session, OCC, allocation, hash, and review boundaries", async () => {
  const { db, seed } = await createAuthority({ populated: true });
  try {
    await p6SetSession(db, "service_role", p6Ids.maker);
    await insertWallQuantity(db, seed);
    await p6SeedBoq11Draft(db);

    await p6SetSession(db, "authenticated", p6Ids.anonymous, {
      anonymous: true,
    });
    await assertSqlState(putBoqLink(db), "P6A01");
    await p6SetSession(db, "authenticated", p6Ids.outsider);
    await assertSqlState(putBoqLink(db), "P6A01");
    for (const actor of [p6Ids.viewer, p6Ids.reviewer]) {
      await p6SetSession(db, "authenticated", actor);
      await assertSqlState(putBoqLink(db), "P6A01");
    }

    await p6SetSession(db, "authenticated", p6Ids.maker);
    const first = (await putBoqLink(db)).rows[0];
    assert.equal(first.version, 1);
    assert.equal(first.allocation_factor, "0.400000000");
    assert.deepEqual((await putBoqLink(db)).rows[0], first);
    await assertSqlState(putBoqLink(db, { factor: "0.5" }), "P6O01");
    await assertSqlState(
      putBoqLink(db, { factor: "0.5", baseVersion: 99 }),
      "P6O01",
    );
    const updated = (await putBoqLink(db, { factor: "0.5", baseVersion: 1 }))
      .rows[0];
    assert.equal(updated.version, 2);
    await assertSqlState(
      putBoqLink(db, {
        id: adversarialIds.overBoqLink,
        factor: "0.500000001",
      }),
      "P6B04",
    );
    await p6SetSession(db, "authenticated", p6Ids.otherMaker);
    await assertSqlState(putBoqLink(db), "P6O01");
    await p6SetSession(db, "authenticated", p6Ids.anonymous, {
      anonymous: true,
    });
    await assertSqlState(readBoqInput(db), "P6A01");

    await p6SetSession(db, "authenticated", p6Ids.maker);
    const originalHash = (await readBoqInput(db)).inputStateSha256;
    await p6SetSession(db, null, p6Ids.maker);
    await db.query(
      `update public.lukas_qto_boq_lines set item_name='Changed' where id=$1`,
      [p6Ids.boq11Line],
    );
    await p6SetSession(db, "authenticated", p6Ids.maker);
    assert.notEqual((await readBoqInput(db)).inputStateSha256, originalHash);
    await p6SetSession(db, null, p6Ids.maker);
    await db.query(
      `update public.lukas_qto_boq_lines set item_name='Drawing wall' where id=$1`,
      [p6Ids.boq11Line],
    );
    await db.query(
      `update public.lukas_qto_price_resources set resource_name='Changed' where id=$1`,
      [p6Ids.materialResource],
    );
    await p6SetSession(db, "authenticated", p6Ids.maker);
    assert.notEqual((await readBoqInput(db)).inputStateSha256, originalHash);
    await p6SetSession(db, null, p6Ids.maker);
    await db.query(
      `update public.lukas_qto_price_resources set resource_name='Gypsum board' where id=$1`,
      [p6Ids.materialResource],
    );
    await db.query(
      `update public.lukas_drawing_object_sources set element_id='changed' where id=$1`,
      [p6Ids.objectSource],
    );
    await p6SetSession(db, "authenticated", p6Ids.maker);
    assert.notEqual((await readBoqInput(db)).inputStateSha256, originalHash);
    await p6SetSession(db, null, p6Ids.maker);
    await db.query(
      `update public.lukas_drawing_object_sources set element_id=null where id=$1`,
      [p6Ids.objectSource],
    );
    await p6SetSession(db, "authenticated", p6Ids.maker);
    assert.equal((await readBoqInput(db)).inputStateSha256, originalHash);

    await p6SetSession(db, "service_role", p6Ids.maker);
    await assertSqlState(
      db.query(
        `select private.lukas_qto_finalize_boq_v1_1($1,$2,$3,$4,$5,$6,$7)`,
        [
          p6Ids.maker,
          p6Ids.boq11,
          p6Sha.other,
          p6Sha.result,
          p6Sha.manifest,
          "6250",
          1,
        ],
      ),
      "P6C01",
    );
    await assertSqlState(
      db.query(
        `select private.lukas_qto_finalize_boq_v1_1($1,$2,$3,$4,$5,$6,$7)`,
        [
          p6Ids.maker,
          p6Ids.boq11,
          originalHash,
          p6Sha.result,
          p6Sha.manifest,
          "6250",
          1,
        ],
      ),
      "P6B04",
    );

    await p6SetSession(db, "authenticated", p6Ids.maker);
    const exact = (await putBoqLink(db, { factor: "1", baseVersion: 2 }))
      .rows[0];
    assert.equal(exact.version, 3);
    const finalInput = await readBoqInput(db);
    await p6SetSession(db, "service_role", p6Ids.maker);
    const finalParameters = [
      p6Ids.maker,
      p6Ids.boq11,
      finalInput.inputStateSha256,
      p6Sha.result,
      p6Sha.manifest,
      "6250",
      1,
    ];
    const finalized = await db.query(
      `select private.lukas_qto_finalize_boq_v1_1($1,$2,$3,$4,$5,$6,$7) value`,
      finalParameters,
    );
    assert.equal(finalized.rows[0].value.resultSha256, p6Sha.result);
    assert.deepEqual(
      (
        await db.query(
          `select private.lukas_qto_finalize_boq_v1_1($1,$2,$3,$4,$5,$6,$7) value`,
          finalParameters,
        )
      ).rows[0],
      finalized.rows[0],
    );
    await assertSqlState(
      db.query(
        `select private.lukas_qto_finalize_boq_v1_1($1,$2,$3,$4,$5,$6,$7)`,
        finalParameters.with(3, p6Sha.other),
      ),
      "P6O01",
    );
    await p6SetSession(db, null, p6Ids.maker);
    await db.query(
      `update public.lukas_drawing_object_sources set element_id='post-submit' where id=$1`,
      [p6Ids.objectSource],
    );
    await p6SetSession(db, "service_role", p6Ids.maker);
    await assertSqlState(
      db.query(
        `select private.lukas_qto_finalize_boq_v1_1($1,$2,$3,$4,$5,$6,$7)`,
        finalParameters,
      ),
      "P6O01",
    );
    await p6SetSession(db, "authenticated", p6Ids.reviewer);
    await assertSqlState(
      db.query(`select public.lukas_qto_decide_boq($1,'approved','stale')`, [
        p6Ids.boq11,
      ]),
      "P6C01",
    );
    await p6SetSession(db, null, p6Ids.maker);
    await db.query(
      `update public.lukas_drawing_object_sources set element_id=null where id=$1`,
      [p6Ids.objectSource],
    );

    await p6SetSession(db, "authenticated", p6Ids.maker);
    await assertSqlState(putBoqLink(db, { factor: "1" }), "P6O01");
    await assertSqlState(
      db.query(`select public.lukas_qto_decide_boq($1,'approved','maker')`, [
        p6Ids.boq11,
      ]),
      "P6A01",
    );
    await p6SetSession(db, "authenticated", p6Ids.reviewer, {
      anonymous: true,
    });
    await assertSqlState(
      db.query(
        `select public.lukas_qto_decide_boq($1,'approved','anonymous')`,
        [p6Ids.boq11],
      ),
      "P6A01",
    );
    await p6SetSession(db, "authenticated", p6Ids.reviewer);
    await db.query(
      `select public.lukas_qto_decide_boq($1,'approved','checked')`,
      [p6Ids.boq11],
    );
    const approved = await db.query(
      `select status,input_state_sha256,result_sha256,manifest_sha256,
        submitted_at is not null submitted,approved_at is not null approved
       from public.lukas_qto_boq_versions where id=$1`,
      [p6Ids.boq11],
    );
    assert.deepEqual(approved.rows[0], {
      status: "approved",
      input_state_sha256: finalInput.inputStateSha256,
      result_sha256: p6Sha.result,
      manifest_sha256: p6Sha.manifest,
      submitted: true,
      approved: true,
    });
    await p6SetSession(db, null, p6Ids.maker);
    await assertSqlState(
      db.query(
        `update public.lukas_drawing_boq_links set allocation_factor=.9 where id=$1`,
        [p6Ids.boqLink],
      ),
      "P6O01",
    );
    await assertSqlState(
      db.query(`delete from public.lukas_drawing_boq_links where id=$1`, [
        p6Ids.boqLink,
      ]),
      "P6O01",
    );
  } finally {
    await db.close();
  }
});

test("material handoff independently verifies approval, ancestry, totals, and replay", async () => {
  const { db, seed } = await createAuthority({ populated: true });
  try {
    await approveBoq11(db, seed);
    const payload = p6MaterialPayload();

    await p6SetSession(db, "authenticated", p6Ids.maker);
    await assertSqlState(insertMaterialHandoff(db), "42501");
    await p6SetSession(db, "service_role", p6Ids.outsider);
    await assertSqlState(
      insertMaterialHandoff(db, { actorId: p6Ids.outsider }),
      "P6A01",
    );
    await p6SetSession(db, "service_role", p6Ids.maker);
    await assertSqlState(
      insertMaterialHandoff(db, { resultSha256: p6Sha.other }),
      "P6M01",
    );
    await assertSqlState(
      insertMaterialHandoff(db, { manifestSha256: p6Sha.other }),
      "P6M01",
    );
    await assertSqlState(
      insertMaterialHandoff(db, { versionId: p6Ids.legacyApprovedBoq }),
      "P6M01",
    );
    await assertSqlState(insertMaterialHandoff(db, { plans: [] }), "P6M01");

    const extraKeyPlans = structuredClone(payload.plans);
    extraKeyPlans[0].unexpected = true;
    await assertSqlState(
      insertMaterialHandoff(db, { plans: extraKeyPlans }),
      "P6M01",
    );
    const badDecimalPlans = structuredClone(payload.plans);
    badDecimalPlans[0].designQuantity = "10.0";
    await assertSqlState(
      insertMaterialHandoff(db, { plans: badDecimalPlans }),
      "P6M01",
    );
    const badUuidPlans = structuredClone(payload.plans);
    badUuidPlans[0].materialResourceId = "64000000-0000-4000-8000-00000000000A";
    await assertSqlState(
      insertMaterialHandoff(db, { plans: badUuidPlans }),
      "P6M01",
    );
    const wrongComponentLinks = structuredClone(payload.links);
    wrongComponentLinks[0].boqRateComponentId = p6Ids.component;
    await assertSqlState(
      insertMaterialHandoff(db, { links: wrongComponentLinks }),
      "P6M01",
    );
    const wrongTotalLinks = structuredClone(payload.links);
    wrongTotalLinks[0].derivedDesignQuantity = "9";
    await assertSqlState(
      insertMaterialHandoff(db, { links: wrongTotalLinks }),
      "P6M01",
    );
    const unusedPlans = structuredClone(payload.plans);
    unusedPlans.push({
      ...structuredClone(payload.plans[0]),
      id: adversarialIds.unusedMaterialPlan,
    });
    await assertSqlState(
      insertMaterialHandoff(db, { plans: unusedPlans }),
      "P6M01",
    );

    await p6SetSession(db, null, p6Ids.maker);
    await db.query(
      `update public.lukas_qto_files set storage_path='p6/not-a-manifest.json' where id=$1`,
      [p6Ids.manifestFile],
    );
    await p6SetSession(db, "service_role", p6Ids.maker);
    await assertSqlState(insertMaterialHandoff(db), "P6M01");
    await p6SetSession(db, null, p6Ids.maker);
    await db.query(
      `update public.lukas_qto_files set storage_path=$2 where id=$1`,
      [p6Ids.manifestFile, `p6/boq-manifests/${p6Sha.manifest}.manifest.json`],
    );
    await p6SetSession(db, "service_role", p6Ids.maker);
    const inserted = await insertMaterialHandoff(db);
    assert.deepEqual(inserted.rows[0].value, { insertedOrReplayed: 1 });
    assert.deepEqual(
      (await insertMaterialHandoff(db)).rows[0],
      inserted.rows[0],
    );

    const changedPlans = structuredClone(payload.plans);
    changedPlans[0].designQuantity = "11";
    changedPlans[0].requiredQuantity = "11";
    await assertSqlState(
      insertMaterialHandoff(db, { plans: changedPlans }),
      "P6O01",
    );
    const changedLinks = structuredClone(payload.links);
    changedLinks[0].derivedDesignQuantity = "9";
    await assertSqlState(
      insertMaterialHandoff(db, { links: changedLinks }),
      "P6O01",
    );

    const authority = await db.query(
      `select p.project_id,p.material_code,p.material_name,p.specification,p.unit,
        p.design_quantity,p.allowance_rate,p.required_quantity,p.rule_id,
        p.required_by,p.source_file_id,p.source_sha256,p.baseline_factor_id,
        p.source_artifact_id,p.source_group_key,p.created_by,
        l.boq_version_id,l.boq_line_id,l.boq_rate_component_id,
        l.material_resource_id,l.boq_result_sha256,l.derived_design_quantity,
        l.material_rule_version,l.created_by link_created_by
       from public.lukas_qto_material_plans p
       join public.lukas_drawing_material_links l on l.material_plan_id=p.id
       where p.id=$1`,
      [p6Ids.materialPlan],
    );
    assert.deepEqual(authority.rows[0], {
      project_id: p6Ids.project,
      material_code: "M-001",
      material_name: "Gypsum board",
      specification: "12.5T",
      unit: "m2",
      design_quantity: "5.000000",
      allowance_rate: "0.000000",
      required_quantity: "5.000000",
      rule_id: "P6_MATERIAL_HANDOFF_V1",
      required_by: null,
      source_file_id: p6Ids.manifestFile,
      source_sha256: p6Sha.manifest,
      baseline_factor_id: null,
      source_artifact_id: null,
      source_group_key: null,
      created_by: p6Ids.maker,
      boq_version_id: p6Ids.boq11,
      boq_line_id: p6Ids.boq11Line,
      boq_rate_component_id: p6Ids.boq11Component,
      material_resource_id: p6Ids.materialResource,
      boq_result_sha256: p6Sha.result,
      derived_design_quantity: "5.000000000",
      material_rule_version: "P6_MATERIAL_HANDOFF_V1",
      link_created_by: p6Ids.maker,
    });

    await assertSqlState(
      db.query(
        `update public.lukas_drawing_material_links set derived_design_quantity=9 where id=$1`,
        [p6Ids.materialLink],
      ),
      "42501",
    );
    await p6SetSession(db, null, p6Ids.maker);
    await assertSqlState(
      db.query(
        `update public.lukas_drawing_material_links set derived_design_quantity=9 where id=$1`,
        [p6Ids.materialLink],
      ),
      "P6M02",
    );
    await assertSqlState(
      db.query(`delete from public.lukas_drawing_material_links where id=$1`, [
        p6Ids.materialLink,
      ]),
      "P6M02",
    );
  } finally {
    await db.close();
  }
});

test("P6 catalog proves fixed grants, search paths, triggers, and indexes", async (t) => {
  const { db } = await createAuthority();
  try {
    const tables = await db.query(
      `select c.relname from pg_catalog.pg_class c
       where c.relnamespace='public'::pg_catalog.regnamespace
         and c.relkind='r' and c.relname like 'lukas_drawing_%_links'
         and c.relname<>'lukas_drawing_object_issue_links'
       order by c.relname`,
    );
    assert.deepEqual(
      tables.rows.map((row) => row.relname),
      [
        "lukas_drawing_boq_links",
        "lukas_drawing_material_links",
        "lukas_drawing_quantity_links",
      ],
    );
    const acl = await db.query(`select
      pg_catalog.has_table_privilege('authenticated','public.lukas_drawing_quantity_links','select') auth_select,
      pg_catalog.has_table_privilege('authenticated','public.lukas_drawing_quantity_links','insert') auth_insert,
      pg_catalog.has_table_privilege('service_role','public.lukas_drawing_quantity_links','insert') service_insert,
      pg_catalog.has_table_privilege('service_role','public.lukas_drawing_quantity_links','update') service_update,
      pg_catalog.has_table_privilege('anon','public.lukas_drawing_quantity_links','select') anon_select,
      pg_catalog.has_function_privilege('authenticated','public.lukas_drawing_put_boq_link(uuid,uuid,uuid,uuid,numeric,bigint)','execute') auth_put,
      pg_catalog.has_function_privilege('anon','public.lukas_drawing_put_boq_link(uuid,uuid,uuid,uuid,numeric,bigint)','execute') anon_put,
      pg_catalog.has_function_privilege('service_role','private.lukas_drawing_insert_quantity_link(uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,numeric,text,text)','execute') service_quantity,
      pg_catalog.has_function_privilege('authenticated','private.lukas_drawing_p6_measure(jsonb,text,jsonb)','execute') auth_helper,
      pg_catalog.has_function_privilege('service_role','private.lukas_drawing_p6_measure(jsonb,text,jsonb)','execute') service_helper`);
    assert.deepEqual(acl.rows[0], {
      auth_select: true,
      auth_insert: false,
      service_insert: true,
      service_update: false,
      anon_select: false,
      auth_put: true,
      anon_put: false,
      service_quantity: true,
      auth_helper: false,
      service_helper: false,
    });

    const functions = await db.query(
      `select n.nspname,p.proname,p.prosecdef,p.proconfig,
        pg_catalog.pg_get_functiondef(p.oid) definition
       from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
       where (n.nspname,p.proname) in (
        ('private','lukas_drawing_insert_quantity_link'),
        ('public','lukas_drawing_put_boq_link'),
        ('public','lukas_drawing_delete_boq_link'),
        ('public','lukas_qto_boq_v1_1_input'),
        ('private','lukas_qto_finalize_boq_v1_1'),
        ('private','lukas_drawing_insert_material_handoff'),
        ('public','lukas_qto_decide_boq')
       ) order by n.nspname,p.proname`,
    );
    assert.equal(functions.rows.length, 7);
    for (const fn of functions.rows) {
      assert.equal(fn.prosecdef, true, `${fn.nspname}.${fn.proname}`);
      assert.deepEqual(fn.proconfig, ['search_path=""']);
    }
    assert.doesNotMatch(
      functions.rows.find(
        (fn) => fn.proname === "lukas_drawing_insert_material_handoff",
      ).definition,
      /on conflict do nothing/i,
    );

    const triggers = await db.query(
      `select tgname from pg_catalog.pg_trigger
       where not tgisinternal and tgname in (
        'lukas_drawing_quantity_links_immutable',
        'lukas_drawing_material_links_immutable',
        'lukas_drawing_boq_links_status_guard'
       ) order by tgname`,
    );
    assert.equal(triggers.rows.length, 3);
    const indexes = await db.query(
      `select indexname,indexdef from pg_catalog.pg_indexes
       where indexname in (
        'lukas_drawing_quantity_links_object_idx',
        'lukas_drawing_quantity_links_lineage_idx',
        'lukas_drawing_boq_links_source_idx',
        'lukas_drawing_material_links_plan_idx',
        'lukas_drawing_material_links_resource_idx'
       ) order by indexname`,
    );
    assert.equal(indexes.rows.length, 5);
    assert.match(
      indexes.rows.find(
        (index) => index.indexname === "lukas_drawing_boq_links_source_idx",
      ).indexdef,
      /\(project_id, quantity_link_id, boq_version_id\)$/,
    );
    const policies = await db.query(
      `select pg_catalog.count(*)::int count,
        pg_catalog.count(*) filter(where not polpermissive)::int restrictive
       from pg_catalog.pg_policy where polrelid in (
         'public.lukas_drawing_quantity_links'::pg_catalog.regclass,
         'public.lukas_drawing_boq_links'::pg_catalog.regclass,
         'public.lukas_drawing_material_links'::pg_catalog.regclass
       )`,
    );
    assert.deepEqual(policies.rows[0], { count: 6, restrictive: 3 });
    t.diagnostic(
      "PGlite proves executable SQL and catalog shape; real RLS and lock/concurrency semantics are NOT PROVEN by this test.",
    );
  } finally {
    await db.close();
  }
});

test("P6 SQL measurement matches every exact P4 golden boundary", async () => {
  const { db } = await createAuthority();
  const measure = async (geometry, kind, objects = null) => {
    const result = await db.query(
      `select private.lukas_drawing_p6_measure(
         $1::jsonb,$2,$3::jsonb
       )::numeric(29,12) value`,
      [JSON.stringify(geometry), kind, objects && JSON.stringify(objects)],
    );
    return result.rows[0].value;
  };
  const semantic = (geometry) => ({ ...geometry, semanticVersion: 1 });
  const wall = semantic({
    type: "wall",
    start: { x: 0, y: 0 },
    end: { x: 3000, y: 4000 },
    thicknessMillimeters: 200,
    heightMillimeters: 3000,
  });
  try {
    assert.equal(await measure(wall, "length"), "5.000000000000");
    assert.equal(
      await measure(
        semantic({
          type: "grid",
          start: { x: 0, y: 0 },
          end: { x: 1, y: 1 },
        }),
        "length",
      ),
      "0.001414214000",
    );
    assert.equal(
      await measure(
        semantic({
          ...wall,
          start: { x: 8_999_995_000, y: 8_999_995_000 },
          end: { x: 8_999_998_000, y: 8_999_999_000 },
        }),
        "length",
      ),
      "5.000000000000",
    );
    const halfArea = semantic({
      type: "area",
      boundary: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
    });
    assert.equal(await measure(halfArea, "area"), "0.000000500000");
    assert.equal(await measure(halfArea, "length"), "0.003414214000");
    assert.equal(
      await measure(
        semantic({
          type: "area",
          boundary: [
            { x: 0, y: 0 },
            { x: 0.000001, y: 0 },
            { x: 0, y: 1 },
          ],
        }),
        "area",
      ),
      "0.000000000001",
    );
    assert.equal(
      await measure(
        semantic({
          type: "area",
          boundary: [
            { x: 0, y: 0 },
            { x: 0.000001, y: 0 },
            { x: 0.000002, y: 0.000001 },
          ],
        }),
        "length",
      ),
      "0.000000005000",
    );
    const rectangle = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 500 },
      { x: 0, y: 500 },
    ];
    for (const boundary of [rectangle, [...rectangle].reverse()]) {
      const space = semantic({
        type: "space",
        boundary,
        number: "101",
        finishes: { floor: null, wall: null, ceiling: null },
      });
      assert.equal(await measure(space, "length"), "3.000000000000");
      assert.equal(await measure(space, "area"), "0.500000000000");
    }
    for (const [sweep, expected] of [
      [90, "1.570796327000"],
      [-90, "1.570796327000"],
      [180, "3.141592654000"],
      [-180, "3.141592654000"],
      [360, "6.283185307000"],
      [-360, "6.283185307000"],
    ])
      assert.equal(
        await measure(
          semantic({
            type: "arc",
            center: { x: 0, y: 0 },
            radius: 1000,
            startAngleDegrees: -45,
            sweepAngleDegrees: sweep,
          }),
          "length",
        ),
        expected,
      );
    const opening = semantic({
      type: "opening",
      hostWallId: p6Ids.wall,
      offsetMillimeters: 2500,
      widthMillimeters: 900,
      heightMillimeters: 2100,
      sillHeightMillimeters: 0,
      openingKind: "door",
    });
    const snapshotObjects = [{ id: p6Ids.wall, type: "wall", geometry: wall }];
    assert.equal(
      await measure(opening, "area", snapshotObjects),
      "1.890000000000",
    );
    await assert.rejects(
      measure(opening, "area"),
      (error) => error.code === "P6Q01",
    );
    assert.equal(
      await measure(
        { type: "circle", center: { x: 0, y: 0 }, radius: 10 },
        "count",
      ),
      "1.000000000000",
    );
    await assert.rejects(
      measure({ type: "circle", center: { x: 0, y: 0 }, radius: 10 }, "length"),
      (error) => error.code === "P6Q01",
    );
    await assertSqlState(
      measure(
        semantic({
          type: "grid",
          start: { x: 0, y: 0 },
          end: { x: 0.0000001, y: 1 },
        }),
        "length",
      ),
      "P6Q01",
    );
    await assertSqlState(
      measure(
        semantic({
          type: "grid",
          start: { x: 0, y: 0 },
          end: { x: 9_000_000_000.000001, y: 1 },
        }),
        "length",
      ),
      "P6Q01",
    );
  } finally {
    await db.close();
  }
});
