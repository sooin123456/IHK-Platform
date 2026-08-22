import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("drawing collaboration foreign keys have covering indexes", async () => {
  const source = await readFile(
    new URL(
      "../supabase/migrations/20260823093000_drawing_foreign_key_indexes.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const columns of [
    "issue_id, project_id",
    "created_by",
    "deactivated_by",
    "author_id",
    "actor_id",
    "closed_by",
  ])
    assert.match(source, new RegExp(columns.replace(", ", ",\\s*")));
});
