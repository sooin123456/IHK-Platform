import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import postgres from "postgres";

import { calculateVerifiedBoq } from "../app/lukas/lib/verified-boq.server.ts";
import {
  applyP6AuthorityFixture,
  p6Ids,
  p6LegacyInput,
  p6SeedPopulatedAuthority,
  p6SetSession,
} from "./fixtures/drawing-workspace-p6-database-fixtures.mjs";

async function migration() {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const matches = (await readdir(directory)).filter((name) =>
    name.endsWith("_organization_drawing_libraries.sql"),
  );
  assert.equal(matches.length, 1, "exactly one Task 2 forward migration");
  return readFile(new URL(matches[0], directory), "utf8");
}

test("library migration defines exact registry, immutable version, and provenance ancestry", async () => {
  const sql = await migration();
  for (const table of [
    "lukas_drawing_library_entries",
    "lukas_drawing_library_versions",
    "lukas_drawing_library_imports",
  ])
    assert.match(sql, new RegExp(`create table public\\.${table}`, "i"));
  assert.match(
    sql,
    /kind text not null check \(kind in \('style','block','property_schema','workspace_template'\)\)/i,
  );
  assert.match(
    sql,
    /status text not null check \(status in \('draft','published','deprecated'\)\)/i,
  );
  assert.match(sql, /canonical_payload jsonb not null/i);
  assert.match(sql, /content_sha256 text not null/i);
  assert.match(sql, /predecessor_version_id uuid/i);
  assert.match(sql, /foreign key \(registry_id,organization_id\)/i);
  assert.match(
    sql,
    /foreign key \(predecessor_version_id,predecessor_registry_id,predecessor_organization_id\)/i,
  );
  assert.match(sql, /foreign key \(project_id,organization_id\)/i);
  assert.match(sql, /foreign key \(revision_id,project_id\)/i);
  assert.match(sql, /foreign key \(version_id,registry_id,organization_id\)/i);
});

test("published bytes are hash-bound, immutable, and imported through an exact retry ledger", async () => {
  const sql = await migration();
  assert.match(
    sql,
    /digest\([\s\S]*pg_catalog\.convert_to\(v_payload::text,'UTF8'\)[\s\S]*'sha256'/i,
  );
  assert.match(sql, /v_payload is distinct from v_version\.canonical_payload/i);
  assert.match(sql, /published library versions are immutable/i);
  assert.match(
    sql,
    /before update or delete on public\.lukas_drawing_library_versions/i,
  );
  assert.match(
    sql,
    /lukas_drawing_library_version_guard\(\)[\s\S]*returns trigger language plpgsql security invoker/i,
  );
  assert.match(sql, /current_user=pg_catalog\.pg_get_userbyid/i);
  assert.doesNotMatch(sql, /set_config\([^)]*drawing_library/i);
  assert.doesNotMatch(sql, /disable trigger/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /client_request_id uuid not null/i);
  assert.match(sql, /request_sha256 text not null/i);
  assert.match(sql, /unique \(imported_by,client_request_id\)/i);
  assert.match(sql, /request ID does not match the stored library import/i);
  assert.match(sql, /r\.status='draft'/i);
  assert.match(sql, /v_version\.status<>'published'/i);
});

test("library RLS is organization exact and public mutation authority is RPC-only", async () => {
  const sql = await migration();
  for (const table of [
    "lukas_drawing_library_entries",
    "lukas_drawing_library_versions",
    "lukas_drawing_library_imports",
  ]) {
    assert.match(
      sql,
      new RegExp(
        `alter table public\\.${table} enable row level security`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `revoke all on table public\\.${table} from anon,authenticated`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `grant select on table public\\.${table} to authenticated`,
        "i",
      ),
    );
  }
  assert.match(
    sql,
    /private\.lukas_qto_organization_role\(organization_id\) is not null/i,
  );
  assert.match(sql, /in \('owner','admin','staff'\)/i);
  assert.match(
    sql,
    /private\.lukas_drawing_workspace_capability\(p_project_id\)[\s\S]*in \('admin','editor'\)/i,
  );
  assert.doesNotMatch(sql, /to authenticated\s+using\s*\(\s*true\s*\)/i);
});

test("imports copy into the existing canonical tables without a second drawing schema", async () => {
  const sql = await migration();
  assert.match(sql, /insert into public\.lukas_drawing_styles/i);
  assert.match(sql, /insert into public\.lukas_drawing_blocks/i);
  assert.match(sql, /insert into public\.lukas_drawing_property_schemas/i);
  assert.match(sql, /private\.lukas_drawing_clone_library_template/i);
  assert.match(sql, /private\.lukas_drawing_p2_canonical_snapshot/i);
  assert.match(sql, /v_current is distinct from v_live/i);
  assert.match(
    sql,
    /object_type='opening'[\s\S]*hostWallId[\s\S]*v_object_map/i,
  );
  assert.match(sql, /private\.lukas_drawing_p4_assert_semantic_graph/i);
  assert.doesNotMatch(
    sql,
    /create table public\.lukas_drawing_library_(styles|blocks|property_schemas|templates)/i,
  );
  assert.match(sql, /source_content_sha256/i);
  assert.match(sql, /target_entity_id/i);
});

test("workspace template copy remaps every canonical internal edge and drops project-scoped evidence", async () => {
  const sql = await migration();
  const clone = sql.slice(
    sql.indexOf(
      "create or replace function private.lukas_drawing_clone_library_template",
    ),
    sql.indexOf(
      "create or replace function public.lukas_drawing_import_library_version",
    ),
  );
  for (const mapping of [
    "v_page_map->>v_row.page_id::text",
    "v_canvas_map->>v_row.canvas_id::text",
    "v_layer_map->>v_row.layer_id::text",
    "v_style_map->>v_row.style_id::text",
    "v_block_map->>v_row.block_id::text",
    "v_schema_map->>v_row.schema_id::text",
    "v_object_map->>v_row.object_id::text",
    "v_instance_map->>v_row.block_instance_id::text",
    "v_column_map->>cell.key",
    "v_object_map->>(v_row.geometry->>'hostWallId')",
  ])
    assert.equal(clone.includes(mapping), true, mapping);
  assert.match(clone, /private\.lukas_drawing_p4_assert_semantic_graph/i);
  assert.doesNotMatch(
    clone,
    /insert into public\.lukas_drawing_object_sources/i,
  );
  assert.doesNotMatch(clone, /insert into public\.lukas_drawing_issue_links/i);
  assert.doesNotMatch(clone, /background_source_file_id/i);
  assert.doesNotMatch(clone, /source_sha256/i);
});

const runtimeIds = Object.freeze({
  organization: "72000000-0000-4000-8000-000000000001",
  otherOrganization: "72000000-0000-4000-8000-000000000002",
  style: "72000000-0000-4000-8000-000000000003",
  targetProject: "72000000-0000-4000-8000-000000000004",
  targetDocument: "72000000-0000-4000-8000-000000000005",
  targetRevision: "72000000-0000-4000-8000-000000000006",
  request: "72000000-0000-4000-8000-000000000007",
});

async function runtimeDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await applyP6AuthorityFixture(db);
    await db.exec(`
      create table public.lukas_qto_organizations(
        id uuid primary key, name text not null, owner_id uuid not null references auth.users(id),
        is_personal boolean not null default false, created_at timestamptz not null default now()
      );
      create table public.lukas_qto_organization_members(
        organization_id uuid not null references public.lukas_qto_organizations(id),
        user_id uuid not null references auth.users(id), role text not null,
        created_at timestamptz not null default now(), primary key(organization_id,user_id)
      );
      alter table public.lukas_qto_projects add column organization_id uuid;
      create table public.lukas_drawing_styles(
        id uuid primary key, revision_id uuid not null, project_id uuid not null,
        name text not null, value jsonb not null, version bigint not null,
        created_by uuid not null references auth.users(id),
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        unique(revision_id,name)
      );
      create or replace function private.lukas_qto_organization_role(p_organization_id uuid)
      returns text language sql stable security definer set search_path='' as $$
        select case when o.owner_id=(select auth.uid()) then 'owner'
          else (select m.role from public.lukas_qto_organization_members m
            where m.organization_id=o.id and m.user_id=(select auth.uid())) end
        from public.lukas_qto_organizations o where o.id=p_organization_id
      $$;
    `);
    await p6SeedPopulatedAuthority(db, calculateVerifiedBoq(p6LegacyInput));
    await p6SetSession(db, null);
    await db.query(
      `insert into public.lukas_qto_organizations(id,name,owner_id) values
       ($1,'1HK',$2),($3,'Other',$4)`,
      [
        runtimeIds.organization,
        p6Ids.owner,
        runtimeIds.otherOrganization,
        p6Ids.otherOwner,
      ],
    );
    await db.query(
      `insert into public.lukas_qto_organization_members(organization_id,user_id,role)
       values($1,$2,'owner'),($1,$3,'member'),($4,$5,'owner')`,
      [
        runtimeIds.organization,
        p6Ids.owner,
        p6Ids.viewer,
        runtimeIds.otherOrganization,
        p6Ids.otherOwner,
      ],
    );
    await db.query(
      `update public.lukas_qto_projects
       set organization_id=case when id=$1 then $2::uuid else $3::uuid end`,
      [p6Ids.project, runtimeIds.organization, runtimeIds.otherOrganization],
    );
    await db.exec(await migration());
    await db.query(
      `insert into public.lukas_qto_projects(
        id,owner_id,organization_id,name,description,created_at,updated_at
      ) values($1,$2,$3,'Target','',now(),now())`,
      [runtimeIds.targetProject, p6Ids.owner, runtimeIds.organization],
    );
    await db.query(
      `insert into public.lukas_qto_project_members(project_id,user_id,role)
       values($1,$2,'owner')`,
      [runtimeIds.targetProject, p6Ids.owner],
    );
    await db.query(
      `insert into public.lukas_drawing_documents(id,project_id,title,created_by)
       values($1,$2,'Target',$3)`,
      [runtimeIds.targetDocument, runtimeIds.targetProject, p6Ids.owner],
    );
    await db.query(
      `insert into public.lukas_drawing_revisions(
        id,document_id,project_id,sequence,status,version,created_by
      ) values($1,$2,$3,1,'draft',1,$4)`,
      [
        runtimeIds.targetRevision,
        runtimeIds.targetDocument,
        runtimeIds.targetProject,
        p6Ids.owner,
      ],
    );
    await db.query(
      `insert into public.lukas_drawing_styles(
        id,revision_id,project_id,name,value,version,created_by
      ) values($1,$2,$3,'회사 표준선',
        '{"stroke":"#112233","strokeWidth":1,"fill":null}'::jsonb,1,$4)`,
      [runtimeIds.style, p6Ids.revision, p6Ids.project, p6Ids.owner],
    );
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function sqlState(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, error.message);
    return true;
  });
}

test("PGlite executes publish, immutable copy import, exact retry, and cross-organization denial", async () => {
  const db = await runtimeDatabase();
  try {
    await p6SetSession(db, "authenticated", p6Ids.owner);
    const draft = await db.query(
      `select public.lukas_drawing_create_library_draft($1,'style','회사 표준선',$2,$3,null) value`,
      [runtimeIds.organization, p6Ids.revision, runtimeIds.style],
    );
    const versionId = draft.rows[0].value.versionId;
    const contentSha256 = draft.rows[0].value.contentSha256;
    await db.query(`select public.lukas_drawing_publish_library_version($1)`, [
      versionId,
    ]);
    const first = await db.query(
      `select public.lukas_drawing_import_library_version($1,$2,$3,$4) value`,
      [
        versionId,
        runtimeIds.targetProject,
        runtimeIds.targetRevision,
        runtimeIds.request,
      ],
    );
    const retry = await db.query(
      `select public.lukas_drawing_import_library_version($1,$2,$3,$4) value`,
      [
        versionId,
        runtimeIds.targetProject,
        runtimeIds.targetRevision,
        runtimeIds.request,
      ],
    );
    assert.deepEqual(retry.rows[0].value, first.rows[0].value);
    assert.equal(first.rows[0].value.contentSha256, contentSha256);
    await p6SetSession(db, null);
    const copied = await db.query(
      `select name,value,version from public.lukas_drawing_styles
       where id=$1 and revision_id=$2`,
      [first.rows[0].value.targetEntityId, runtimeIds.targetRevision],
    );
    assert.deepEqual(copied.rows, [
      {
        name: "회사 표준선",
        value: { fill: null, stroke: "#112233", strokeWidth: 1 },
        version: 1,
      },
    ]);
    await p6SetSession(db, "authenticated", p6Ids.owner);
    await sqlState(
      db.query(
        `select public.lukas_drawing_import_library_version($1,$2,$3,$4)`,
        [
          versionId,
          p6Ids.otherProject,
          p6Ids.otherRevision,
          crypto.randomUUID(),
        ],
      ),
      "P1R01",
    );
    await db.query(
      `select public.lukas_drawing_deprecate_library_version($1)`,
      [versionId],
    );
    await sqlState(
      db.query(
        `select public.lukas_drawing_import_library_version($1,$2,$3,$4)`,
        [
          versionId,
          runtimeIds.targetProject,
          runtimeIds.targetRevision,
          crypto.randomUUID(),
        ],
      ),
      "P1R01",
    );
    assert.equal(
      (
        await db.query(
          `select count(*)::int count from public.lukas_drawing_library_imports`,
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await db.close();
  }
});

test("PGlite denies direct lifecycle/content mutation and preserves published SHA", async () => {
  const db = await runtimeDatabase();
  try {
    await p6SetSession(db, "authenticated", p6Ids.owner);
    const draft = await db.query(
      `select public.lukas_drawing_create_library_draft($1,'style','회사 표준선',$2,$3,null) value`,
      [runtimeIds.organization, p6Ids.revision, runtimeIds.style],
    );
    const versionId = draft.rows[0].value.versionId;
    await sqlState(
      db.query(
        `update public.lukas_drawing_library_versions set status='published',
         published_by=$2,published_at=now() where id=$1`,
        [versionId, p6Ids.owner],
      ),
      "42501",
    );
    await p6SetSession(db, "service_role", p6Ids.owner);
    await sqlState(
      db.query(
        `insert into public.lukas_drawing_library_versions(
          registry_id,organization_id,version_no,status,canonical_payload,
          content_sha256,predecessor_version_id,predecessor_registry_id,
          predecessor_organization_id,source_project_id,source_revision_id,
          source_entity_id,created_by
        ) select registry_id,organization_id,2,'draft',canonical_payload,
          repeat('0',64),id,registry_id,organization_id,source_project_id,
          source_revision_id,source_entity_id,created_by
        from public.lukas_drawing_library_versions where id=$1`,
        [versionId],
      ),
      "23514",
    );
    await sqlState(
      db.query(
        `update public.lukas_drawing_library_versions
         set status='deprecated',deprecated_at=now() where id=$1`,
        [versionId],
      ),
      "P1C01",
    );
    await sqlState(
      db.query(
        `update public.lukas_drawing_library_versions set status='published',
         published_by=$2,published_at=now() where id=$1`,
        [versionId, p6Ids.owner],
      ),
      "P1C01",
    );
    await p6SetSession(db, "authenticated", p6Ids.owner);
    await db.query(`select public.lukas_drawing_publish_library_version($1)`, [
      versionId,
    ]);
    await p6SetSession(db, "service_role", p6Ids.owner);
    await sqlState(
      db.query(
        `update public.lukas_drawing_library_versions
         set canonical_payload='{}'::jsonb where id=$1`,
        [versionId],
      ),
      "P1C01",
    );
    await sqlState(
      db.query(
        `delete from public.lukas_drawing_library_versions where id=$1`,
        [versionId],
      ),
      "P1C01",
    );
    await p6SetSession(db, null);
    const stored = await db.query(
      `select content_sha256,
        encode(extensions.digest(convert_to(canonical_payload::text,'UTF8'),'sha256'),'hex') recomputed
       from public.lukas_drawing_library_versions where id=$1`,
      [versionId],
    );
    assert.equal(stored.rows[0].content_sha256, stored.rows[0].recomputed);
  } finally {
    await db.close();
  }
});

const realPostgresUrl = process.env.P7_REAL_POSTGRES_DATABASE_URL;
const realPostgresRequired = process.env.P7_REAL_POSTGRES_REQUIRED === "1";

if (!realPostgresUrl) {
  test(
    "real PostgreSQL proves organization library RLS and trigger authority",
    { skip: !realPostgresRequired },
    () => assert.fail("P7_REAL_POSTGRES_DATABASE_URL is required"),
  );
} else {
  test("real PostgreSQL proves organization library RLS and trigger authority", async () => {
    const sql = postgres(realPostgresUrl, { max: 1, prepare: false });
    try {
      const tables = await sql`
        select c.relname,c.relrowsecurity,
          pg_catalog.has_table_privilege('authenticated',c.oid,'SELECT') can_select,
          pg_catalog.has_table_privilege('authenticated',c.oid,'UPDATE') can_update
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname in (
          'lukas_drawing_library_entries','lukas_drawing_library_versions',
          'lukas_drawing_library_imports'
        ) order by c.relname
      `;
      assert.equal(tables.length, 3);
      for (const row of tables) {
        assert.equal(row.relrowsecurity, true, row.relname);
        assert.equal(row.can_select, true, row.relname);
        assert.equal(row.can_update, false, row.relname);
      }
      const [trigger] = await sql`
        select p.prosecdef security_definer
        from pg_catalog.pg_trigger t
        join pg_catalog.pg_proc p on p.oid=t.tgfoid
        where t.tgname='lukas_drawing_library_version_guard'
      `;
      assert.deepEqual(trigger, { security_definer: false });
    } finally {
      await sql.end();
    }
  });
}
