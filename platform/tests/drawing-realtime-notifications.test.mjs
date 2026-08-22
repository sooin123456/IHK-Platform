import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("drawing room subscribes to project-scoped realtime changes", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-room.client.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /createBrowserClient/);
  assert.match(source, /project_id=eq\./);
  assert.match(source, /useRevalidator/);
  assert.match(source, /removeChannel/);
});

test("drawing events create an inbox without notifying the actor", async () => {
  const source = await readFile(
    new URL(
      "../supabase/migrations/20260823092000_drawing_notifications.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /after insert on public\.lukas_drawing_issue_events/);
  assert.match(source, /lukas_drawing_notifications/);
  assert.match(source, /is distinct from new\.actor_id/);
  assert.match(source, /resolution_requested/);
});

test("authenticated routes expose an accessible notification inbox", async () => {
  const routes = await readFile(new URL("../app/routes.ts", import.meta.url), "utf8");
  const screen = await readFile(
    new URL("../app/lukas/screens/drawing-notifications.tsx", import.meta.url),
    "utf8",
  );
  assert.match(routes, /\/notifications/);
  assert.match(screen, /알림 작업함/);
  assert.match(screen, /mark_read/);
  assert.match(screen, /읽음 처리/);
});
