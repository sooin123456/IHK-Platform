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

test("P3 collaboration migration exposes only the bounded service contracts", () => {
  assert.match(migration, /create role lukas_drawing_collaboration\s+noinherit\s+nologin/i);
  assert.match(migration, /create table private\.lukas_drawing_collaboration_states/i);
  assert.match(migration, /foreign key \(revision_id,project_id\)[\s\S]*references public\.lukas_drawing_revisions\(id,project_id\)/i);
  assert.match(migration, /octet_length\(yjs_state\) between 1 and 8388608/i);
  assert.match(migration, /encode\(extensions\.digest\(yjs_state,'sha256'\),'hex'\)/i);

  for (const signature of [
    "lukas_drawing_collaboration_authorize",
    "lukas_drawing_collaboration_load_state",
    "lukas_drawing_collaboration_store_state",
    "lukas_drawing_collaboration_lookup_operations",
    "lukas_drawing_collaboration_bootstrap",
  ]) {
    assert.match(migration, new RegExp(`function (?:public\\.|private\\.)${signature}\\s*\\(`, "i"));
  }
  assert.match(
    migration,
    /function private\.lukas_drawing_collaboration_bootstrap\([\s\S]*?\) returns jsonb language plpgsql stable security definer set search_path=''/i,
  );
  assert.match(
    migration,
    /function public\.lukas_drawing_collaboration_bootstrap\([\s\S]*?\) returns jsonb language plpgsql stable security definer set search_path=''/i,
  );

  assert.doesNotMatch(migration, /(?:create|alter|drop)\s+(?:table|function|schema|policy)[\s\S]{0,80}\brealtime\./i);
  assert.doesNotMatch(migration, /freeze_request|manifest_digest|\bpassword\b|\blogin\b/i);
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
      new RegExp(`alter publication supabase_realtime add table public\\.${table}`, "i"),
    );
  }
  assert.match(migration, /from pg_catalog\.pg_publication_tables/i);
  assert.match(migration, /pg_catalog\.to_regclass/i);
});
