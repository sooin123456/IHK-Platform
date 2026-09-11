import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrationSuffix = "_drawing_workspace_m4_dxf_entity_source_authority.sql";

async function attestationMigrations() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const foundation = names.filter((name) =>
    name.endsWith("_drawing_dxf_plan_attestation_foundation.sql"),
  );
  const enforcement = names.filter((name) =>
    name.endsWith("_drawing_dxf_plan_attestation_enforcement.sql"),
  );
  assert.equal(
    foundation.length,
    1,
    "one additive attestation foundation exists",
  );
  assert.equal(
    enforcement.length,
    1,
    "one later attestation enforcement exists",
  );
  assert.ok(foundation[0] < enforcement[0], "foundation precedes enforcement");
  return {
    foundation: await readFile(
      new URL(foundation[0], migrationsDirectory),
      "utf8",
    ),
    enforcement: await readFile(
      new URL(enforcement[0], migrationsDirectory),
      "utf8",
    ),
  };
}

async function migrationEntry() {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const matches = names.filter((name) => name.endsWith(migrationSuffix));
  assert.equal(matches.length, 1, "one forward migration owns DXF sources");
  const name = matches[0];
  assert.ok(
    name > "20260902012022_drawing_workspace_m4_verified_dxf_kind.sql",
    "DXF source authority follows verified DXF file-kind authority",
  );
  return {
    name,
    sql: await readFile(new URL(name, migrationsDirectory), "utf8"),
  };
}

test("DXF source authority is one additive transaction with the strict columns", async () => {
  const { sql } = await migrationEntry();

  assert.match(sql, /\bbegin\s*;/i);
  assert.match(sql, /\bcommit\s*;/i);
  for (const column of [
    "dxf_entity_key text",
    "dxf_entity_type text",
    "dxf_source_layer text",
    "dxf_handle text",
    "dxf_unit_code integer",
    "dxf_unit_source text",
    "dxf_importer_version integer",
  ])
    assert.match(sql, new RegExp(`add column\\s+${column}`, "i"));
  assert.match(sql, /source_kind\s+in\s*\([^)]*'dxf_entity'/i);
  assert.doesNotMatch(sql, /alter function[\s\S]*?rename to/i);
});

test("generated database contract exposes every hosted DXF lineage column", async () => {
  const types = await readFile(
    new URL("../database.types.ts", import.meta.url),
    "utf8",
  );
  const start = types.indexOf("lukas_drawing_object_sources: {");
  const end = types.indexOf("\n      hangil_project_inquiries:", start);
  assert.ok(start >= 0 && end > start, "drawing source table type is present");
  const sourceTable = types.slice(start, end);
  for (const [column, type] of [
    ["dxf_entity_key", "string | null"],
    ["dxf_entity_type", "string | null"],
    ["dxf_source_layer", "string | null"],
    ["dxf_handle", "string | null"],
    ["dxf_unit_code", "number | null"],
    ["dxf_unit_source", "string | null"],
    ["dxf_importer_version", "number | null"],
  ])
    assert.match(
      sourceTable,
      new RegExp(`${column}: ${type.replace("|", "\\|")}`),
    );
});

test("DXF payload constraint is disjoint from PDF and IFC payloads", async () => {
  const { sql } = await migrationEntry();

  assert.match(sql, /source_kind='dxf_entity'[\s\S]*dxf_entity_key/i);
  assert.match(sql, /entityType'\s+in\s*\(\s*'LINE'[\s\S]*'TEXT'/i);
  assert.match(sql, /jsonb_typeof\(p_entity->'handle'\)='null'/i);
  assert.match(sql, /\^\[0-9A-F\]\{1,32\}\$/i);
  assert.match(sql, /unitCode'\)::numeric in\s*\(1,2,4,5,6\)/i);
  assert.match(sql, /unitSource' in\s*\('declared','user_selected'\)/i);
  assert.match(sql, /importerVersion'\)::numeric=1/i);
  assert.match(
    sql,
    /source_kind='dxf_entity'[\s\S]*pdf_page_number is null[\s\S]*ifc_global_id is null/i,
  );
  assert.match(
    sql,
    /source_kind='pdf_region'[\s\S]*dxf_entity_key is null[\s\S]*source_kind='ifc_element'[\s\S]*dxf_importer_version is null/i,
  );
});

test("canonical DXF JSON and operation validation accept only the exact variant", async () => {
  const { sql } = await migrationEntry();

  const sourceJson = sql.slice(
    sql.indexOf("create or replace function private.lukas_drawing_source_json"),
    sql.indexOf(
      "create or replace function private.lukas_drawing_structure_action_valid",
    ),
  );
  for (const key of [
    "entityKey",
    "entityType",
    "sourceLayer",
    "handle",
    "unitCode",
    "unitSource",
    "importerVersion",
  ])
    assert.match(sourceJson, new RegExp(`'${key}'`, "i"));
  assert.match(sourceJson, /when 'pdf_region'/i);
  assert.match(sourceJson, /when 'ifc_element'/i);
  assert.match(sourceJson, /when 'dxf_entity'/i);

  const validator = sql.slice(
    sql.indexOf(
      "create or replace function private.lukas_drawing_structure_action_valid",
    ),
    sql.indexOf(
      "create or replace function private.lukas_drawing_object_source_guard",
    ),
  );
  assert.match(validator, /v->>'sourceKind'='dxf_entity'/i);
  assert.match(
    validator,
    /v-array\[[^\]]*'entityKey'[^\]]*'importerVersion'[^\]]*\]='\{\}'::jsonb/i,
  );
  assert.match(validator, /private\.lukas_drawing_dxf_entity_payload_valid/i);
});

test("source guard binds immutable DXF files and every DXF payload column", async () => {
  const { sql } = await migrationEntry();
  const guard = sql.slice(
    sql.indexOf(
      "create or replace function private.lukas_drawing_object_source_guard",
    ),
    sql.indexOf(
      "create or replace function private.lukas_drawing_apply_source_actions",
    ),
  );

  assert.match(
    guard,
    /f\.id=new\.source_file_id[\s\S]*f\.project_id=new\.project_id[\s\S]*f\.sha256=new\.source_sha256[\s\S]*f\.immutable/i,
  );
  assert.match(guard, /new\.source_kind='dxf_entity'\s+and\s+f\.kind='dxf'/i);
  for (const column of [
    "dxf_entity_key",
    "dxf_entity_type",
    "dxf_source_layer",
    "dxf_handle",
    "dxf_unit_code",
    "dxf_unit_source",
    "dxf_importer_version",
  ])
    assert.match(
      guard,
      new RegExp(`new\\.${column} is distinct from old\\.${column}`, "i"),
    );
  assert.match(
    sql,
    /revoke insert,update,delete on table public\.lukas_drawing_object_sources[\s\S]*authenticated/i,
  );
});

test("operation, checkpoint, and template paths preserve exact DXF lineage", async () => {
  const { sql } = await migrationEntry();

  const apply = sql.slice(
    sql.indexOf(
      "create or replace function private.lukas_drawing_apply_source_actions",
    ),
    sql.indexOf(
      "create or replace function private.lukas_drawing_create_from_template",
    ),
  );
  assert.match(apply, /insert into public\.lukas_drawing_object_sources/i);
  for (const column of [
    "dxf_entity_key",
    "dxf_entity_type",
    "dxf_source_layer",
    "dxf_handle",
    "dxf_unit_code",
    "dxf_unit_source",
    "dxf_importer_version",
  ])
    assert.match(apply, new RegExp(column, "i"));

  assert.match(
    sql,
    /create or replace function private\.lukas_drawing_create_from_template/i,
  );
  assert.match(
    sql,
    /create or replace function private\.lukas_drawing_p5_checkpoint_sources/i,
  );
  assert.match(
    sql,
    /create or replace function private\.lukas_drawing_apply_operation_pre_p4_semantic_objects[\s\S]*sourceKind'='dxf_entity'[\s\S]*f\.kind='dxf'/i,
  );
});

test("DXF authority owns three exact import phases plus inverse deletion", async () => {
  const { sql } = await migrationEntry();
  const authority = sql.slice(
    sql.indexOf("create function private.lukas_drawing_dxf_import_phase"),
    sql.indexOf(
      "create or replace function private.lukas_drawing_p6_source_anchor_json",
    ),
  );

  assert.match(authority, /return 'layer_create'/i);
  assert.match(authority, /return 'object_source_create'/i);
  assert.match(authority, /return 'layer_finalize'/i);
  assert.match(
    authority,
    /p_forward \? 'historyGroup' and v_count>0[\s\S]*return 'layer_delete'/i,
  );
  assert.match(
    authority,
    /ordinality%2=1[\s\S]*put_object[\s\S]*ordinality%2=0[\s\S]*put_source/i,
  );
  assert.match(
    authority,
    /ordinality%2=1[\s\S]*delete_source[\s\S]*ordinality%2=0[\s\S]*delete_object/i,
  );
  assert.doesNotMatch(authority, /sourceLayer'[^;]*v_layer\.name/i);
  assert.match(authority, /v_expected_object_type/i);
  assert.match(authority, /return 'object_source_delete'/i);
  assert.match(authority, /active_source[\s\S]*delete_source/i);
  assert.match(authority, /a->>'baseVersion'<>'2'/i);
  assert.match(authority, /version=v_layer\.version\+1/i);
  assert.match(
    authority,
    /if p_forward \? 'historyGroup' and not exists\([\s\S]*then return 'layer_finalize'/i,
  );
  assert.match(
    authority,
    /private\.lukas_drawing_apply_dxf_import_operation\(/i,
  );
});

test("DXF history groups are exact, resumable, and fence incomplete revisions", async () => {
  const { sql } = await migrationEntry();
  const groupValidator = sql.match(
    /create function private\.lukas_drawing_dxf_history_group_valid\([\s\S]*?\n\$\$;/i,
  )?.[0];
  const appendGuard = sql.match(
    /create function private\.lukas_drawing_dxf_history_group_append_guard\(\)[\s\S]*?\n\$\$;/i,
  )?.[0];
  const freezeGuard = sql.match(
    /create function private\.lukas_drawing_dxf_history_group_freeze_guard\(\)[\s\S]*?\n\$\$;/i,
  )?.[0];

  assert.ok(groupValidator);
  assert.ok(appendGuard);
  assert.ok(freezeGuard);
  assert.match(groupValidator, /array\['id','kind','index','count'\]/i);
  assert.match(groupValidator, /p_group->>'kind'='dxf_import'/i);
  assert.match(groupValidator, /p_group->>'index'[\s\S]*>=0/i);
  assert.match(groupValidator, /p_group->>'count'[\s\S]*between 1 and 48/i);
  assert.match(
    groupValidator,
    /p_group->>'index'[\s\S]*<\(p_group->>'count'\)::numeric/i,
  );
  assert.match(
    sql,
    /create function private\.lukas_drawing_dxf_history_group_status\(/i,
  );
  assert.match(
    sql,
    /create function private\.lukas_drawing_dxf_history_groups_complete\(/i,
  );
  assert.match(
    sql,
    /create trigger lukas_drawing_dxf_history_group_append_guard[\s\S]*before insert on public\.lukas_drawing_operations/i,
  );
  assert.match(
    appendGuard,
    /from public\.lukas_drawing_revisions r[\s\S]*for update[\s\S]*select s\.freeze_state/i,
  );
  assert.match(
    appendGuard,
    /select s\.freeze_state into v_freeze_state[\s\S]*from private\.lukas_drawing_collaboration_states s[\s\S]*for share[\s\S]*v_freeze_state in\('freezing','frozen'\)/i,
  );
  assert.match(
    sql,
    /create trigger lukas_drawing_dxf_history_group_lineage_update_guard[\s\S]*before update of history_action,original_operation_id/i,
  );
  assert.match(
    sql,
    /create trigger lukas_drawing_dxf_history_group_review_guard[\s\S]*before update on public\.lukas_drawing_revisions/i,
  );
  assert.match(
    sql,
    /create trigger lukas_drawing_dxf_history_group_freeze_guard[\s\S]*before insert or update on private\.lukas_drawing_collaboration_states/i,
  );
  assert.match(
    freezeGuard,
    /new\.freeze_state='frozen'[\s\S]*old\.freeze_state='freezing'[\s\S]*lukas_drawing_dxf_history_groups_complete/i,
  );
  assert.match(sql, /return 'layer_delete'/i);
  assert.match(
    sql,
    /p_forward \? 'historyGroup'[\s\S]*lukas_drawing_apply_dxf_import_operation/i,
  );
});

test("operation proof is timezone-stable and never blesses legacy rows", async () => {
  const { sql } = await migrationEntry();
  const envelopeHash = sql.match(
    /create function private\.lukas_drawing_operation_envelope_sha256\([\s\S]*?\n\$\$;/i,
  )?.[0];
  const proofBootstrap = sql.slice(
    sql.indexOf(
      "create table private.lukas_drawing_operation_authority_proofs",
    ),
    sql.indexOf(
      "create function private.lukas_drawing_operation_authority_guard",
    ),
  );

  assert.ok(envelopeHash);
  assert.match(
    envelopeHash,
    /extract\(epoch from p_operation\.created_at\)[\s\S]*1000000/i,
  );
  assert.doesNotMatch(envelopeHash, /'createdAt',\s*p_operation\.created_at/i);
  assert.doesNotMatch(
    proofBootstrap,
    /insert into private\.lukas_drawing_operation_authority_proofs\([\s\S]*?select[\s\S]*?from public\.lukas_drawing_operations/i,
  );
});

test("BOQ 1.1 adds DXF anchor keys without changing PDF or IFC anchor JSON", async () => {
  const { sql } = await migrationEntry();

  assert.match(
    sql,
    /create function private\.lukas_drawing_p6_source_anchor_json/i,
  );
  assert.match(
    sql,
    /when 'dxf_entity'[\s\S]*'entityKey'[\s\S]*'importerVersion'/i,
  );
  assert.match(
    sql,
    /when 'dxf_entity'[\s\S]*'pdfPageNumber',null[\s\S]*'camera',null/i,
  );
  assert.match(sql, /when 'pdf_region'[\s\S]*'pdfPageNumber'[\s\S]*'camera'/i);
  assert.match(sql, /when 'ifc_element'[\s\S]*'pdfPageNumber'[\s\S]*'camera'/i);
  assert.match(
    sql,
    /create or replace function private\.lukas_drawing_p6_input_state[\s\S]*private\.lukas_drawing_p6_source_anchor_json\(\s*a\.id,a\.revision_id,a\.project_id\s*\)/i,
  );
});

test("DXF plan attestation is two-phase, service-only, and guards both operation writes", async () => {
  const { foundation, enforcement } = await attestationMigrations();

  assert.match(
    foundation,
    /create table private\.lukas_drawing_dxf_plan_attestations/i,
  );
  assert.match(
    foundation,
    /create (or replace )?function private\.lukas_drawing_operation_request_sha256/i,
  );
  assert.match(foundation, /'drawing-operation-request:v1'/i);
  assert.match(
    foundation,
    /create (or replace )?function public\.lukas_drawing_attest_dxf_import_plan/i,
  );
  assert.match(foundation, /current_setting\('role',true\)/i);
  assert.match(foundation, /request\.jwt\.claims/i);
  assert.match(
    foundation,
    /grant execute on function public\.lukas_drawing_attest_dxf_import_plan[\s\S]*service_role/i,
  );
  assert.match(
    foundation,
    /revoke all on table private\.lukas_drawing_dxf_plan_attestations[\s\S]*service_role/i,
  );
  assert.match(foundation, /DXF plan requires a source phase/);
  assert.match(
    foundation,
    /v_phase in\('layer_create','object_source_create','layer_finalize'\)\) is not true/,
  );
  assert.match(foundation, /DXF plan phase order is invalid/);
  assert.match(foundation, /DXF plan layer is not created by this plan/);
  assert.match(foundation, /DXF committed operations are not a prefix/);
  assert.match(
    enforcement,
    /before insert or update on public\.lukas_drawing_operations/i,
  );
  assert.match(enforcement, /for update/i);
  assert.match(enforcement, /operation_type<>'restore_checkpoint'/i);
  assert.match(enforcement, /mutate_objects_with_references/i);
  assert.ok(
    enforcement.indexOf("DXF reference rewrite requires a server plan") <
      enforcement.indexOf(
        "if v_protected is not true and v_old_protected is not true then return new",
      ),
    "novel reference rewrites are rejected before history rows can return early",
  );
  assert.match(
    enforcement,
    /if not found then[\s\S]*errcode='P1T01'[\s\S]*if v_proof\.actor_id[\s\S]*errcode='P1C01'/i,
  );
  assert.match(
    enforcement,
    /create trigger lukas_drawing_z_dxf_plan_attestation_guard[\s\S]*before insert or update on public\.lukas_drawing_operations/i,
  );
  assert.match(
    enforcement,
    /create or replace function public\.lukas_drawing_apply_operation\([\s\S]*when sqlstate 'P1C01' then[\s\S]*DXF operation plan attestation is pending[\s\S]*errcode='P1T01'/i,
  );
});
