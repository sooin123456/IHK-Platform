import assert from "node:assert/strict";
import test from "node:test";
import postgres from "postgres";

const required = process.env.P6_REAL_POSTGRES_REQUIRED === "1";
const databaseUrl = process.env.P6_REAL_POSTGRES_DATABASE_URL;

test(
  "P6 real PostgreSQL concurrency authority is explicitly configured",
  { skip: !required },
  () => {
    if (!databaseUrl) throw new Error("P6 real PostgreSQL gate is UNEXECUTED");
  },
);

test(
  "P6 real PostgreSQL exposes the migrated bridge and indexed source lookup",
  { skip: !databaseUrl },
  async () => {
    const sql = postgres(databaseUrl, { max: 2, prepare: false });
    try {
      const [bridge] = await sql`
        select to_regclass('public.lukas_drawing_boq_links') as bridge,
          to_regclass('public.lukas_drawing_quantity_links') as quantity,
          to_regclass('public.lukas_drawing_material_links') as material
      `;
      assert.deepEqual(bridge, {
        bridge: "lukas_drawing_boq_links",
        quantity: "lukas_drawing_quantity_links",
        material: "lukas_drawing_material_links",
      });
      const indexes = await sql`
        select indexname from pg_indexes
        where schemaname='public' and indexname='lukas_drawing_boq_links_source_idx'
      `;
      assert.equal(indexes.length, 1);
    } finally {
      await sql.end();
    }
  },
);
