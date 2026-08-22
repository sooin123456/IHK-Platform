import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  assert.match(source, /grant select, insert, update[\s\S]*issues[\s\S]*anchors[\s\S]*to authenticated/i);
  assert.match(source, /grant select, insert[\s\S]*comments to authenticated/i);
  assert.match(source, /grant select[\s\S]*events to authenticated/i);
  assert.match(source, /grant select, update[\s\S]*notifications to authenticated/i);
  assert.doesNotMatch(source, /grant all[\s\S]*to authenticated/i);
});
