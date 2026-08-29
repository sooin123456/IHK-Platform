import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

test("drawing collaboration grants follow least privilege", async () => {
  const source = await readFile(
    new URL(
      "../supabase/migrations/20260823094000_drawing_least_privilege_grants.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /revoke all[\s\S]*from authenticated/i);
  assert.match(
    source,
    /grant select, insert, update[\s\S]*issues[\s\S]*anchors[\s\S]*to authenticated/i,
  );
  assert.match(source, /grant select, insert[\s\S]*comments to authenticated/i);
  assert.match(source, /grant select[\s\S]*events to authenticated/i);
  assert.match(
    source,
    /grant select, update[\s\S]*notifications to authenticated/i,
  );
  assert.doesNotMatch(source, /grant all[\s\S]*to authenticated/i);
});

test("drawing and membership tables require verified email sessions", async () => {
  const migrationDirectory = new URL(
    "../supabase/migrations/",
    import.meta.url,
  );
  const migrationFiles = (await readdir(migrationDirectory)).filter((file) =>
    file.endsWith(".sql"),
  );
  const migrations = (
    await Promise.all(
      migrationFiles.map((file) =>
        readFile(new URL(file, migrationDirectory), "utf8"),
      ),
    )
  ).join("\n");

  for (const table of [
    "lukas_qto_organizations",
    "lukas_qto_organization_members",
    "lukas_qto_project_members",
    "lukas_drawing_issues",
    "lukas_drawing_issue_anchors",
    "lukas_drawing_issue_comments",
    "lukas_drawing_issue_events",
    "lukas_drawing_notifications",
    "lukas_drawing_issue_approvals",
  ]) {
    assert.match(
      migrations,
      new RegExp(
        [
          `create policy ["']verified email sessions only["']`,
          `on public\\.${table}`,
          `as restrictive for all to authenticated`,
          `using \\(private\\.lukas_qto_verified_session\\(\\)\\)`,
          `with check \\(private\\.lukas_qto_verified_session\\(\\)\\)`,
        ].join("\\s+"),
        "i",
      ),
      `${table} must reject anonymous authenticated sessions`,
    );
  }
});
