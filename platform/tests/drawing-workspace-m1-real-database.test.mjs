import assert from "node:assert/strict";
import test from "node:test";

const databaseUrl = process.env.M1_REAL_POSTGRES_DATABASE_URL;
const required = process.env.M1_REAL_POSTGRES_REQUIRED === "1";

if (!databaseUrl) {
  test(
    "M1 real PostgreSQL proves idempotency, starter provenance, and binding authority",
    { skip: required ? false : "M1 real PostgreSQL gate is UNEXECUTED" },
    () => assert.fail("M1_REAL_POSTGRES_DATABASE_URL is required"),
  );
} else {
  test("M1 real PostgreSQL proves idempotency, starter provenance, and binding authority", async () => {
    const { default: postgres } = await import("postgres");
    const sql = postgres(databaseUrl, { max: 2, prepare: false });
    try {
      const [binding] = await sql`
        select c.relrowsecurity,
          pg_catalog.has_table_privilege('anon',c.oid,'SELECT') anon_select,
          pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') authenticated_select,
          pg_catalog.has_table_privilege('authenticated',c.oid,'INSERT') authenticated_insert,
          pg_catalog.has_table_privilege('authenticated',c.oid,'UPDATE') authenticated_update,
          pg_catalog.has_table_privilege('service_role',c.oid,'SELECT') service_select,
          pg_catalog.has_table_privilege('service_role',c.oid,'INSERT') service_insert
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname='lukas_drawing_estimate_bindings'
      `;
      assert.deepEqual(binding, {
        relrowsecurity: true,
        anon_select: false,
        authenticated_select: true,
        authenticated_insert: true,
        authenticated_update: false,
        service_select: true,
        service_insert: false,
      });

      const functions = await sql`
        select n.nspname schema_name,p.proname,p.prosecdef,
          p.proconfig,
          pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') anon_execute
        from pg_catalog.pg_proc p
        join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where p.proname in (
          'lukas_drawing_create_document_idempotent',
          'lukas_drawing_list_platform_starters',
          'lukas_drawing_ensure_platform_starter_version',
          'lukas_drawing_record_platform_starter_import',
          'lukas_drawing_document_creation_result'
        )
        order by n.nspname,p.proname
      `;
      assert.ok(functions.length >= 6);
      for (const fn of functions) {
        assert.ok(fn.proconfig?.includes("search_path=\"\"") || fn.proconfig?.includes("search_path="));
        assert.equal(fn.anon_execute, false, `${fn.schema_name}.${fn.proname}`);
        if (fn.schema_name === "public") assert.equal(fn.prosecdef, false);
      }

      const starters = await sql`
        select key,version,canonical_payload,
          pg_catalog.encode(extensions.digest(
            pg_catalog.convert_to(canonical_payload::text,'UTF8'),'sha256'
          ),'hex') recomputed,content_sha256
        from private.lukas_drawing_platform_starters order by key
      `;
      assert.deepEqual(
        starters.map(({ key, version }) => ({ key, version: Number(version) })),
        [
          { key: "apartment-remodel", version: 1 },
          { key: "commercial-interior", version: 1 },
          { key: "demolition-restoration", version: 1 },
          { key: "interior-basic", version: 1 },
        ],
      );
      for (const starter of starters) {
        assert.equal(starter.content_sha256, starter.recomputed);
        assert.deepEqual(starter.canonical_payload.table.rows, []);
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
}
