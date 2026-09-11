import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrls = [
  new URL(
    "../supabase/migrations/20260902080000_material_blank_specification_contract.sql",
    import.meta.url,
  ),
  new URL(
    "../supabase/migrations/20260902080100_material_blank_specification_validate.sql",
    import.meta.url,
  ),
];

test("material plan specifications allow bounded blanks and normalize legacy padding", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema if not exists public;
      create table public.lukas_qto_material_plans(
        id integer primary key,
        specification text not null
          check (char_length(trim(specification)) between 1 and 200)
      );
    `);
    await db.query(
      "insert into public.lukas_qto_material_plans(id,specification) values(1,$1)",
      [`${"x".repeat(200)} `],
    );
    await assert.rejects(
      db.query(
        "insert into public.lukas_qto_material_plans(id,specification) values(2,'')",
      ),
      (error) => error.code === "23514",
    );

    for (const migrationUrl of migrationUrls)
      await db.exec(await readFile(migrationUrl, "utf8"));
    await db.query(
      "insert into public.lukas_qto_material_plans(id,specification) values(2,'')",
    );
    assert.deepEqual(
      (
        await db.query(
          "select id,specification from public.lukas_qto_material_plans order by id",
        )
      ).rows,
      [
        { id: 1, specification: "x".repeat(200) },
        { id: 2, specification: "" },
      ],
    );
    await assert.rejects(
      db.query(
        "insert into public.lukas_qto_material_plans(id,specification) values(3,$1)",
        ["x".repeat(201)],
      ),
      (error) => error.code === "23514",
    );
    await assert.rejects(
      db.query(
        "insert into public.lukas_qto_material_plans(id,specification) values(4,$1)",
        [" ".repeat(201)],
      ),
      (error) => error.code === "23514",
    );
    await assert.rejects(
      db.query(
        "insert into public.lukas_qto_material_plans(id,specification) values(5,null)",
      ),
      (error) => error.code === "23502",
    );
    const validated = await db.query(
      `select convalidated
       from pg_catalog.pg_constraint
       where conname='lukas_qto_material_plans_specification_contract_v2'`,
    );
    assert.equal(validated.rows[0].convalidated, true);
  } finally {
    await db.close();
  }
});
