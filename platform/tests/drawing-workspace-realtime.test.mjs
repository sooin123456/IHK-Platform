import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const realtime = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-workspace-realtime.ts",
);
test.after(() => vite.close());

test("workspace realtime subscriptions stay inside the active project and revision", () => {
  assert.deepEqual(
    realtime.drawingWorkspaceRealtimeSubscriptions({
      documentId: "document-1",
      projectId: "project-1",
      revisionId: "revision-1",
      userId: "user-1",
    }),
    [
      { table: "lukas_drawing_documents", filter: "id=eq.document-1" },
      { table: "lukas_drawing_revisions", filter: "id=eq.revision-1" },
      {
        table: "lukas_drawing_object_issue_links",
        filter: "revision_id=eq.revision-1",
      },
      { table: "lukas_drawing_issues", filter: "project_id=eq.project-1" },
      {
        table: "lukas_drawing_issue_comments",
        filter: "project_id=eq.project-1",
      },
      {
        table: "lukas_drawing_issue_events",
        filter: "project_id=eq.project-1",
      },
      {
        table: "lukas_drawing_issue_approvals",
        filter: "project_id=eq.project-1",
      },
      {
        table: "lukas_qto_project_members",
        filter: "project_id=eq.project-1",
      },
    ],
  );
});

test("a disabled collaboration entitlement is explicit instead of looking like an outage", () => {
  assert.deepEqual(realtime.disabledDrawingWorkspaceRealtimeView(), {
    phase: "disconnected",
    message: "회사 플랜에서 실시간 업무 알림 꺼짐 · 필요할 때 새로고침",
    lastInvalidationAt: null,
  });
});

test("scheduler coalesces workspace changes for 250ms and records the delivered invalidation", () => {
  let pending = null;
  const pendingSignals = [];
  const invalidations = [];
  const views = [];
  const scheduler = realtime.createDrawingWorkspaceInvalidationScheduler({
    now: () => 42,
    onInvalidateScheduled: () => pendingSignals.push("pending"),
    onInvalidate: () => invalidations.push("refresh"),
    onViewChange: (view) => views.push(view),
    schedule: (callback, delay) => {
      assert.equal(delay, 250);
      pending = callback;
      return 1;
    },
    cancel: () => assert.fail("the only timer must not be replaced"),
  });

  scheduler.invalidate();
  scheduler.invalidate();
  assert.deepEqual(pendingSignals, ["pending"]);
  assert.deepEqual(invalidations, []);
  pending();

  assert.deepEqual(invalidations, ["refresh"]);
  assert.equal(views.at(-1).lastInvalidationAt, 42);
  scheduler.dispose();
});

test("controller refreshes once after reconnect and whenever the tab returns", () => {
  const scheduled = [];
  const invalidations = [];
  const controller = realtime.createDrawingWorkspaceRealtimeController({
    now: () => 88,
    onInvalidate: () => invalidations.push("refresh"),
    onViewChange: () => {},
    schedule: (callback) => {
      scheduled.push(callback);
      return scheduled.length;
    },
    cancel: () => {},
  });

  controller.status("CHANNEL_ERROR");
  controller.status("SUBSCRIBED");
  controller.status("SUBSCRIBED");
  controller.visibilityChanged(false);
  assert.equal(scheduled.length, 1);
  scheduled[0]();

  assert.deepEqual(invalidations, ["refresh"]);
  controller.dispose();
});

test("hook keeps the realtime subscription alive while router revalidation settles", async () => {
  const source = await readFile(
    new URL("../app/lukas/lib/drawing-workspace-realtime.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /const \{ revalidate \} = useRevalidator\(\)/);
  assert.doesNotMatch(
    source,
    /\[\s*[\s\S]{0,260}\brevalidator\s*,?[\s\S]{0,80}\]\s*\);/,
    "router state changes must not cancel the completion callback for the revalidation they started",
  );
  assert.match(
    source,
    /const settleInvalidation = \(\) => \{[\s\S]{0,220}onRevalidated\?\.\(\)/,
  );
  assert.match(
    source,
    /return \(\) => \{[\s\S]{0,320}while \(outstandingInvalidations > 0\) settleInvalidation\(\)/,
    "subscription cleanup must balance every pending invalidation signal",
  );
});
