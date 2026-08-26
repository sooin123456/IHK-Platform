import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260825192113_drawing_workspace_p3_collaboration_state.sql",
    import.meta.url,
  ),
  "utf8",
);
const fenceMigration = await readFile(
  new URL(
    "../supabase/migrations/20260825193714_drawing_workspace_p3_collaboration_state_fence.sql",
    import.meta.url,
  ),
  "utf8",
);
const serviceAuthorityMigration = await readFile(
  new URL(
    "../supabase/migrations/20260825210528_drawing_workspace_p3_collaboration_service_authority.sql",
    import.meta.url,
  ),
  "utf8",
);
const historyLineageMigration = await readFile(
  new URL(
    "../supabase/migrations/20260825234510_drawing_collaboration_history_lineage.sql",
    import.meta.url,
  ),
  "utf8",
);
const historyAuthorityMigration = await readFile(
  new URL(
    "../supabase/migrations/20260826002019_drawing_collaboration_history_authority.sql",
    import.meta.url,
  ),
  "utf8",
);
const reviewFreezeMigration = await readFile(
  new URL(
    "../supabase/migrations/20260826043741_drawing_workspace_p3_review_freeze.sql",
    import.meta.url,
  ),
  "utf8",
);
const reviewRejectionRecoveryMigration = await readFile(
  new URL(
    "../supabase/migrations/20260826052305_drawing_workspace_p3_review_rejection_recovery.sql",
    import.meta.url,
  ),
  "utf8",
);
const crossInstanceFreezeLeaseMigration = await readFile(
  new URL(
    "../supabase/migrations/20260826063603_drawing_workspace_p3_cross_instance_freeze_lease.sql",
    import.meta.url,
  ),
  "utf8",
);

test("P3 collaboration migration exposes only the bounded service contracts", () => {
  assert.match(
    migration,
    /create role lukas_drawing_collaboration\s+noinherit\s+nologin/i,
  );
  assert.match(
    migration,
    /create table private\.lukas_drawing_collaboration_states/i,
  );
  assert.match(
    migration,
    /foreign key \(revision_id,project_id\)[\s\S]*references public\.lukas_drawing_revisions\(id,project_id\)/i,
  );
  assert.match(migration, /octet_length\(yjs_state\) between 1 and 8388608/i);
  assert.match(
    migration,
    /encode\(extensions\.digest\(yjs_state,'sha256'\),'hex'\)/i,
  );

  for (const signature of [
    "lukas_drawing_collaboration_authorize",
    "lukas_drawing_collaboration_load_state",
    "lukas_drawing_collaboration_store_state",
    "lukas_drawing_collaboration_lookup_operations",
    "lukas_drawing_collaboration_bootstrap",
  ]) {
    assert.match(
      migration,
      new RegExp(`function (?:public\\.|private\\.)${signature}\\s*\\(`, "i"),
    );
  }
  assert.match(
    migration,
    /function private\.lukas_drawing_collaboration_bootstrap\([\s\S]*?\) returns jsonb language plpgsql stable security definer set search_path=''/i,
  );
  assert.match(
    migration,
    /function public\.lukas_drawing_collaboration_bootstrap\([\s\S]*?\) returns jsonb language plpgsql stable security definer set search_path=''/i,
  );

  assert.doesNotMatch(
    migration,
    /(?:create|alter|drop)\s+(?:table|function|schema|policy)[\s\S]{0,80}\brealtime\./i,
  );
  assert.doesNotMatch(
    migration,
    /freeze_request|manifest_digest|\bpassword\b|\blogin\b/i,
  );
});

test("P3 collaboration private grants exclude every Data API role", () => {
  assert.match(
    migration,
    /revoke all on table private\.lukas_drawing_collaboration_states from public,anon,authenticated,service_role,lukas_drawing_collaboration/i,
  );
  assert.match(
    migration,
    /revoke all on function private\.lukas_drawing_collaboration_(?:authorize|load_state|store_state|lookup_operations|bootstrap)[\s\S]*from public,anon,authenticated,service_role/i,
  );
  assert.match(
    migration,
    /grant execute on function private\.lukas_drawing_collaboration_(?:authorize|load_state|store_state|lookup_operations|bootstrap)[\s\S]*to lukas_drawing_collaboration/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.lukas_drawing_collaboration_bootstrap\(uuid\) to authenticated/i,
  );
});

test("P3 collaboration publication changes are idempotent application-table additions", () => {
  for (const table of [
    "lukas_drawing_revisions",
    "lukas_drawing_object_issue_links",
    "lukas_drawing_issues",
    "lukas_drawing_issue_comments",
    "lukas_drawing_issue_events",
    "lukas_drawing_issue_approvals",
    "lukas_qto_project_members",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `alter publication supabase_realtime add table public\\.${table}`,
        "i",
      ),
    );
  }
  assert.match(migration, /from pg_catalog\.pg_publication_tables/i);
  assert.match(migration, /pg_catalog\.to_regclass/i);
});

test("P3 collaboration forward fix fences equal-checkpoint state stores", () => {
  assert.match(fenceMigration, /add column store_generation bigint/i);
  assert.match(
    fenceMigration,
    /lukas_drawing_collaboration_store_state\(\s*p_user_id uuid,[\s\S]*p_expected_generation bigint,[\s\S]*p_expected_sha256 text/i,
  );
  assert.match(fenceMigration, /p_expected_generation[\s\S]*store_generation/i);
  assert.match(fenceMigration, /p_expected_sha256[\s\S]*yjs_sha256/i);
  assert.match(
    fenceMigration,
    /store_generation\s*=\s*v_existing\.store_generation\s*\+\s*1/i,
  );
  assert.match(
    fenceMigration,
    /revoke all on function private\.lukas_drawing_collaboration_store_state\(uuid,uuid,uuid,smallint,bytea,bigint\)/i,
  );
});

test("P3 collaboration service authority is room-bound and excludes Data API roles", () => {
  for (const name of ["load_state", "store_state", "bootstrap"]) {
    assert.match(
      serviceAuthorityMigration,
      new RegExp(
        `create or replace function private\\.lukas_drawing_collaboration_service_${name}`,
        "i",
      ),
    );
  }
  assert.match(
    serviceAuthorityMigration,
    /where r\.id=p_revision_id and r\.project_id=p_project_id for update/i,
  );
  assert.match(serviceAuthorityMigration, /v_status<>'draft'/i);
  assert.match(
    serviceAuthorityMigration,
    /p_expected_generation[\s\S]*store_generation/i,
  );
  assert.match(
    serviceAuthorityMigration,
    /p_expected_sha256[\s\S]*yjs_sha256/i,
  );
  assert.match(
    serviceAuthorityMigration,
    /revoke all on function private\.lukas_drawing_collaboration_service_[\s\S]*from public,anon,authenticated,service_role/i,
  );
  assert.match(
    serviceAuthorityMigration,
    /grant execute on function private\.lukas_drawing_collaboration_service_[\s\S]*to lukas_drawing_collaboration/i,
  );
  assert.doesNotMatch(serviceAuthorityMigration, /p_user_id|auth\.uid\(\)/i);
});

test("collaboration history forward migration persists and compares exact lineage", () => {
  assert.match(historyLineageMigration, /add column history_action text/i);
  assert.match(
    historyLineageMigration,
    /add column original_operation_id uuid/i,
  );
  assert.match(
    historyLineageMigration,
    /foreign key\(revision_id,original_operation_id\)[\s\S]*references public\.lukas_drawing_operations\(revision_id,client_operation_id\)/i,
  );
  assert.match(
    historyLineageMigration,
    /v_existing\.history_action is distinct from p_history_action/i,
  );
  assert.match(
    historyLineageMigration,
    /v_existing\.original_operation_id is distinct from p_original_operation_id/i,
  );
  assert.match(
    historyLineageMigration,
    /lukas_drawing_collaboration_lookup_operations[\s\S]*history_action text[\s\S]*original_operation_id uuid/i,
  );
  assert.match(historyLineageMigration, /'historyAction',o\.history_action/i);
  assert.match(
    historyLineageMigration,
    /'originalOperationId',o\.original_operation_id/i,
  );
  assert.doesNotMatch(
    historyLineageMigration,
    /alter migration|update auth\./i,
  );
});

test("collaboration history authority migration closes legacy and direct-DML bypasses", () => {
  assert.match(
    historyAuthorityMigration,
    /foreign key\s*\(revision_id,original_operation_id,actor_id\)[\s\S]*references public\.lukas_drawing_operations\s*\(\s*revision_id,client_operation_id,actor_id\s*\)/i,
  );
  assert.match(
    historyAuthorityMigration,
    /create or replace function private\.lukas_drawing_apply_operation\([\s\S]*?p_inverse jsonb\s*\)[\s\S]*?select private\.lukas_drawing_apply_operation\([\s\S]*?p_inverse,null::text,null::uuid/i,
  );
  assert.match(
    historyAuthorityMigration,
    /create or replace function public\.lukas_drawing_apply_operation\([\s\S]*?p_inverse jsonb\s*\)[\s\S]*?select private\.lukas_drawing_apply_operation\([\s\S]*?p_inverse,null::text,null::uuid/i,
  );
  assert.match(
    historyAuthorityMigration,
    /revoke all on function private\.lukas_drawing_apply_operation\(\s*uuid,uuid,text,jsonb,jsonb,jsonb\s*\) from public,anon/i,
  );
  assert.match(
    historyAuthorityMigration,
    /grant execute on function public\.lukas_drawing_apply_operation\(\s*uuid,uuid,text,jsonb,jsonb,jsonb\s*\) to authenticated,service_role/i,
  );
  assert.doesNotMatch(historyAuthorityMigration, /drop column|update auth\./i);
});

test("P3 review freeze is forward-only, private, manifest-bound, and DB-canonical", () => {
  assert.match(
    reviewFreezeMigration,
    /freeze_state text not null default 'active'/i,
  );
  assert.match(
    reviewFreezeMigration,
    /'freezing'[\s\S]*'frozen'[\s\S]*'released'/i,
  );
  assert.match(reviewFreezeMigration, /accepted_manifest_sha256/i);
  assert.match(reviewFreezeMigration, /accepted_operation_count/i);
  assert.match(reviewFreezeMigration, /frozen_base_operation_sequence/i);
  assert.match(reviewFreezeMigration, /review_committed_at/i);
  assert.match(
    reviewFreezeMigration,
    /coalesce\(pg_catalog\.current_setting\('private\.lukas_drawing_freeze_write',true\),''\)<>'1'/i,
  );
  assert.match(
    reviewFreezeMigration,
    /get diagnostics v_changed=row_count;[\s\S]*if v_changed<>1 then/i,
  );
  assert.match(
    reviewFreezeMigration,
    /create function private\.lukas_drawing_collaboration_begin_freeze/i,
  );
  assert.match(
    reviewFreezeMigration,
    /create function private\.lukas_drawing_collaboration_complete_freeze/i,
  );
  assert.match(
    reviewFreezeMigration,
    /create function public\.lukas_drawing_request_collaborative_review/i,
  );
  assert.match(
    reviewFreezeMigration,
    /item->'forward'=o\.forward[\s\S]*item->'inverse'=o\.inverse[\s\S]*item->'resultVersions'=o\.result_versions/i,
  );
  assert.match(
    reviewFreezeMigration,
    /v_result:=private\.lukas_drawing_request_review\(p_revision_id\)/i,
  );
  assert.match(
    reviewFreezeMigration,
    /grant execute on function private\.lukas_drawing_collaboration_(?:read_freeze|begin_freeze|complete_freeze|release_freeze)[\s\S]*to lukas_drawing_collaboration/i,
  );
  assert.match(
    reviewFreezeMigration,
    /revoke all on function private\.lukas_drawing_request_review\(uuid\) from public,anon,authenticated,service_role/i,
  );
  assert.match(
    reviewFreezeMigration,
    /lukas_drawing_request_review_legacy_guard[\s\S]*lukas_drawing_revisions[\s\S]*for update;[\s\S]*if found and exists\(select 1 from private\.lukas_drawing_collaboration_states/i,
  );
  assert.doesNotMatch(
    reviewFreezeMigration,
    /(?:create|alter|drop)\s+(?:table|function|schema|policy)[\s\S]{0,80}\brealtime\./i,
  );
});

test("P3 review rejection recovery is version-bound and forward-only", () => {
  assert.match(
    reviewRejectionRecoveryMigration,
    /frozen_subject_revision_version/i,
  );
  assert.match(reviewRejectionRecoveryMigration, /frozen_yjs_state_vector/i);
  assert.match(reviewRejectionRecoveryMigration, /frozen_operation_statuses/i);
  assert.match(
    reviewRejectionRecoveryMigration,
    /z_lukas_drawing_revision_rejection_release_freeze/i,
  );
  assert.match(
    reviewRejectionRecoveryMigration,
    /lukas_drawing_collaboration_sync_released_state/i,
  );
  assert.doesNotMatch(reviewRejectionRecoveryMigration, /\brealtime\./i);
});

test("P3 cross-instance freeze lease is private, bounded, and owner-fenced", () => {
  assert.match(
    crossInstanceFreezeLeaseMigration,
    /create table private\.lukas_drawing_collaboration_freeze_leases/i,
  );
  assert.match(
    crossInstanceFreezeLeaseMigration,
    /revoke all on table private\.lukas_drawing_collaboration_freeze_leases\s+from public,anon,authenticated,service_role,lukas_drawing_collaboration/i,
  );
  assert.match(crossInstanceFreezeLeaseMigration, /freeze_owner_token uuid/i);
  assert.match(
    crossInstanceFreezeLeaseMigration,
    /freeze_owner_lease_expires_at timestamptz/i,
  );
  assert.match(
    crossInstanceFreezeLeaseMigration,
    /p_lease_seconds not between 5 and 300/i,
  );
  assert.match(
    crossInstanceFreezeLeaseMigration,
    /freeze_owner_lease_expires_at>pg_catalog\.clock_timestamp\(\)/i,
  );
  assert.match(
    crossInstanceFreezeLeaseMigration,
    /if p_yjs_state is null and p_base_operation_sequence is null then return/i,
  );
  assert.match(
    crossInstanceFreezeLeaseMigration,
    /when l\.revision_id is not null then 'freezing'/i,
  );
  assert.match(
    crossInstanceFreezeLeaseMigration,
    /subject_revision_version bigint not null check\(subject_revision_version>0\)/i,
  );
  for (const name of [
    "acquire_freeze_lease",
    "renew_freeze_lease",
    "release_freeze_lease",
  ]) {
    assert.match(
      crossInstanceFreezeLeaseMigration,
      new RegExp(
        `revoke all on function private\\.lukas_drawing_collaboration_${name}\\([\\s\\S]*?from public,anon,authenticated,service_role`,
        "i",
      ),
    );
    assert.match(
      crossInstanceFreezeLeaseMigration,
      new RegExp(
        `grant execute on function private\\.lukas_drawing_collaboration_${name}\\([\\s\\S]*?to lukas_drawing_collaboration`,
        "i",
      ),
    );
  }
  assert.match(
    crossInstanceFreezeLeaseMigration,
    /revoke all on function private\.lukas_drawing_collaboration_begin_freeze\(uuid,uuid,uuid,bytea,bigint\) from lukas_drawing_collaboration/i,
  );
  assert.doesNotMatch(crossInstanceFreezeLeaseMigration, /\brealtime\./i);
});
