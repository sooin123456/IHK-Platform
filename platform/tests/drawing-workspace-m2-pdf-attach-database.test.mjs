import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);

async function migrationSql() {
  const names = (await readdir(migrationsDirectory)).filter((name) =>
    name.endsWith("_drawing_workspace_m2_pdf_primary_attach_authority.sql"),
  );
  assert.equal(names.length, 1, "exactly one M2 PDF attach migration");
  return readFile(new URL(names[0], migrationsDirectory), "utf8");
}

test("M2 PDF attach owns one append-only private request ledger", async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /create table private\.lukas_drawing_source_attach_requests\s*\(/i,
  );
  for (const column of [
    "actor_id uuid not null",
    "client_request_id uuid not null",
    "request_sha256 text not null",
    "project_id uuid not null",
    "document_id uuid not null",
    "revision_id uuid not null",
    "source_file_id uuid not null",
    "source_sha256 text not null",
    "canvas_id uuid not null",
    "result_json jsonb not null",
  ]) {
    assert.match(sql, new RegExp(column.replaceAll(" ", "\\s+"), "i"));
  }
  assert.match(sql, /primary key\s*\(actor_id,client_request_id\)/i);
  assert.match(sql, /Drawing source attach ledger is append-only/i);
  assert.match(
    sql,
    /project_id uuid not null[\s\S]*?references public\.lukas_qto_projects\(id\) on delete cascade/i,
  );
  for (const parent of [
    "lukas_drawing_documents",
    "lukas_drawing_revisions",
    "lukas_qto_files",
    "lukas_drawing_canvases",
  ])
    assert.match(
      sql,
      new RegExp(
        `references\\s+public\\.${parent}\\(id\\)\\s+on delete cascade`,
        "i",
      ),
    );
  assert.match(
    sql,
    /before update or delete on private\.lukas_drawing_source_attach_requests/i,
  );
  const ledgerGuard = sql.slice(
    sql.indexOf(
      "create or replace function private.lukas_drawing_source_attach_ledger_append_guard",
    ),
    sql.indexOf(
      "create trigger lukas_drawing_source_attach_ledger_append_guard",
    ),
  );
  assert.match(
    ledgerGuard,
    /tg_op='DELETE'[\s\S]*?pg_trigger_depth\(\)>1[\s\S]*?app\.lukas_retention_purge_project[\s\S]*?old\.project_id::text[\s\S]*?current_user=pg_catalog\.pg_get_userbyid[\s\S]*?not exists\([\s\S]*?lukas_qto_projects/i,
  );
  assert.match(
    sql,
    /revoke all on table private\.lukas_drawing_source_attach_requests[\s\S]*?from public,anon,authenticated,service_role/i,
  );
});

test("M2 migration refuses inconsistent source-free documents instead of rewriting evidence", async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /lock table public\.lukas_drawing_documents[\s\S]*?public\.lukas_drawing_canvases/i,
  );
  assert.match(
    sql,
    /c\.background_source_file_id is not null[\s\S]*?d\.source_file_id is distinct from c\.background_source_file_id[\s\S]*?d\.source_sha256 is distinct from c\.background_source_sha256/i,
  );
  assert.match(
    sql,
    /p\.background_source_file_id is not null[\s\S]*?d\.source_file_id is distinct from p\.background_source_file_id[\s\S]*?d\.source_sha256 is distinct from p\.background_source_sha256/i,
  );
  assert.match(
    sql,
    /where d\.source_file_id is not null[\s\S]*?f\.kind in \('pdf','ifc'\)[\s\S]*?f\.immutable/i,
  );
  assert.match(sql, /errcode\s*=\s*'P1C01'/i);
  assert.match(sql, /Drawing source attach preflight failed/i);
});

test("document and canvas source identity change only through one transaction lease", async () => {
  const sql = await migrationSql();
  const guard = sql.slice(
    sql.indexOf(
      "create or replace function private.lukas_drawing_document_guard",
    ),
    sql.indexOf(
      "create or replace function private.lukas_drawing_source_attach_ledger_append_guard",
    ),
  );

  assert.match(
    guard,
    /new\.source_file_id is distinct from old\.source_file_id/i,
  );
  assert.match(guard, /old\.source_file_id is not null/i);
  assert.match(guard, /new\.source_file_id is null/i);
  assert.match(guard, /current_user\s*<>\s*v_owner/i);
  assert.match(
    guard,
    /private\.lukas_drawing_source_attach_leases/i,
  );
  assert.match(guard, /pg_catalog\.txid_current\(\)/i);
  assert.match(guard, /Drawing document source identity is immutable/i);

  assert.match(
    sql,
    /create table private\.lukas_drawing_source_attach_leases\s*\(/i,
  );
  assert.match(
    sql,
    /revoke all on table private\.lukas_drawing_source_attach_leases[\s\S]*?from public,anon,authenticated,service_role/i,
  );
  const canvasGuard = sql.slice(
    sql.indexOf(
      "create function private.lukas_drawing_canvas_source_identity_guard",
    ),
    sql.indexOf("create function private.lukas_drawing_attach_source"),
  );
  assert.match(canvasGuard, /old\.background_source_file_id/i);
  assert.match(canvasGuard, /new\.background_source_file_id/i);
  assert.match(canvasGuard, /private\.lukas_drawing_source_attach_leases/i);
  assert.match(canvasGuard, /Drawing canvas source identity is immutable/i);
  const pageGuard = sql.slice(
    sql.indexOf(
      "create or replace function private.lukas_drawing_page_source_guard",
    ),
    sql.indexOf(
      "create function private.lukas_drawing_canvas_source_identity_guard",
    ),
  );
  assert.match(pageGuard, /tg_op='INSERT'/i);
  assert.match(pageGuard, /v_document\.source_file_id/i);
  assert.match(pageGuard, /Legacy drawing page canvas columns are read-only/i);
});

test("public attach RPC delegates one exact put_canvas operation and exposes no private helper", async () => {
  const sql = await migrationSql();
  const attach = sql.slice(
    sql.indexOf("create function private.lukas_drawing_attach_source"),
    sql.indexOf("create function public.lukas_drawing_attach_source"),
  );

  assert.match(attach, /pg_advisory_xact_lock[\s\S]*?client_request_id/i);
  assert.match(attach, /request_sha256 is distinct from v_request_sha256/i);
  assert.match(attach, /status\s*=\s*'draft'/i);
  assert.match(attach, /in\s*\('admin','editor'\)/i);
  assert.match(attach, /f\.kind\s*=\s*'pdf'/i);
  assert.match(attach, /f\.immutable/i);
  assert.match(
    attach,
    /exists\([\s\S]*?from storage\.objects[\s\S]*?bucket_id='lukas-qto'[\s\S]*?name=f\.storage_path/i,
  );
  assert.match(attach, /p\.sort_order\s*=\s*0/i);
  assert.match(attach, /c\.space_kind\s*=\s*'paper'/i);
  assert.match(attach, /c\.sort_order\s*=\s*0/i);
  assert.match(attach, /background_source_file_id is not null/i);
  assert.match(
    attach,
    /join public\.lukas_drawing_revisions background_revision[\s\S]*?background_revision\.document_id=v_document\.id/i,
  );
  assert.match(attach, /'kind','put_canvas'/i);
  assert.match(attach, /'type','mutate_structure'/i);
  assert.match(
    attach,
    /private\.lukas_drawing_apply_operation\([\s\S]*?p_request_id[\s\S]*?'mutate_structure'/i,
  );
  assert.match(attach, /insert into private\.lukas_drawing_source_attach_leases/i);
  assert.match(attach, /delete from private\.lukas_drawing_source_attach_leases/i);
  assert.match(
    attach,
    /insert into private\.lukas_drawing_source_attach_requests\([\s\S]*?project_id/i,
  );
  assert.match(
    attach,
    /not exists\([\s\S]*?historical\.status<>'draft'/i,
  );
  assert.match(
    attach,
    /Drawing source file is already attached in this project/i,
  );

  assert.match(
    sql,
    /create function public\.lukas_drawing_attach_source\([\s\S]*?language\s+sql[\s\S]*?security\s+definer[\s\S]*?set\s+search_path=''/i,
  );
  assert.match(
    sql,
    /revoke all on function[\s\S]*?private\.lukas_drawing_attach_source\(uuid,uuid,uuid,uuid,uuid\)[\s\S]*?from public,anon,authenticated,service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.lukas_drawing_attach_source\s*\(\s*uuid,uuid,uuid,uuid,uuid\s*\)[\s\S]*?to authenticated,service_role/i,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function private\.lukas_drawing_attach_source/i,
  );
});

test("registered immutable PDFs retain storage bytes before and after attach", async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /create function private\.lukas_drawing_storage_object_is_immutable_pdf\(\s*p_bucket_id text,\s*p_name text\s*\)[\s\S]*?security definer/i,
  );
  assert.match(
    sql,
    /from public\.lukas_qto_files f[\s\S]*?f\.storage_path=p_name[\s\S]*?f\.kind='pdf'[\s\S]*?f\.immutable/i,
  );
  for (const operation of ["delete", "update"])
    assert.match(
      sql,
      new RegExp(
        `create policy "drawing attached sources reject authenticated ${operation}"[\\s\\S]*?on storage\\.objects as restrictive for ${operation} to authenticated[\\s\\S]*?not private\\.lukas_drawing_storage_object_is_immutable_pdf`,
        "i",
      ),
    );
  assert.match(
    sql,
    /grant execute on function\s+private\.lukas_drawing_storage_object_is_immutable_pdf\(text,text\)[\s\S]*?to authenticated,service_role/i,
  );
});

test("M2 publication addition is conditional and idempotent", async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /from\s+pg_catalog\.pg_publication[\s\S]*?where\s+pubname='supabase_realtime'/i,
  );
  assert.match(
    sql,
    /from pg_catalog\.pg_publication_tables[\s\S]*?tablename='lukas_drawing_documents'/i,
  );
  assert.match(
    sql,
    /alter publication supabase_realtime add table public\.lukas_drawing_documents/i,
  );
});
