import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ids = Object.freeze({
  organization: "74000000-0000-4000-8000-000000000001",
  project: "74000000-0000-4000-8000-000000000002",
  request: "74000000-0000-4000-8000-000000000003",
  hold: "74000000-0000-4000-8000-000000000004",
});

function form(entries) {
  const value = new FormData();
  for (const [key, item] of Object.entries(entries)) value.set(key, item);
  return value;
}

test("retention forms accept only stable identities and bounded policy values", async () => {
  const { parseOrganizationRetentionForm } =
    await import("../app/lukas/lib/organization-retention.server.ts");
  assert.deepEqual(
    parseOrganizationRetentionForm(
      form({
        intent: "set_policy",
        archive_retention_days: "30",
        approved_retention_days: "2555",
        reason: "회사 보존 기준",
        request_id: ids.request,
      }),
    ),
    {
      intent: "set_policy",
      archiveRetentionDays: 30,
      approvedRetentionDays: 2555,
      reason: "회사 보존 기준",
      requestId: ids.request,
    },
  );
  assert.deepEqual(
    parseOrganizationRetentionForm(
      form({
        intent: "place_hold",
        project_id: ids.project,
        hold_id: ids.hold,
        reason: "분쟁 보존",
        request_id: ids.request,
      }),
    ),
    {
      intent: "place_hold",
      projectId: ids.project,
      holdId: ids.hold,
      reason: "분쟁 보존",
      requestId: ids.request,
    },
  );
  assert.throws(
    () =>
      parseOrganizationRetentionForm(
        form({
          intent: "archive",
          project_id: ids.project,
          reason: "archive",
          request_id: ids.request,
          organization_id: ids.organization,
        }),
      ),
    /허용되지 않은 필드/,
  );
  assert.throws(
    () =>
      parseOrganizationRetentionForm(
        form({
          intent: "set_policy",
          archive_retention_days: "31",
          approved_retention_days: "30",
          reason: "invalid",
          request_id: ids.request,
        }),
      ),
    /승인 근거 보존기간/,
  );
});

test("every admin mutation binds route organization into one exact RPC", async () => {
  const { runOrganizationRetentionMutation } =
    await import("../app/lukas/lib/organization-retention.server.ts");
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: {}, error: null });
    },
  };
  for (const mutation of [
    {
      intent: "archive",
      projectId: ids.project,
      reason: "archive",
      requestId: ids.request,
    },
    {
      intent: "request_delete",
      projectId: ids.project,
      reason: "delete",
      requestId: ids.request,
    },
    {
      intent: "release_hold",
      projectId: ids.project,
      holdId: ids.hold,
      reason: "released",
      requestId: ids.request,
    },
  ])
    await runOrganizationRetentionMutation(client, ids.organization, mutation);
  assert.equal(calls.length, 3);
  for (const call of calls)
    assert.equal(call.args.p_organization_id, ids.organization, call.name);
});

test("retention administration is mounted and archived projects leave the active workspace", () => {
  const routes = readFileSync(
    new URL("../app/routes.ts", import.meta.url),
    "utf8",
  );
  const dashboard = readFileSync(
    new URL("../app/lukas/components/workspace-dashboard.tsx", import.meta.url),
    "utf8",
  );
  const workspace = readFileSync(
    new URL("../app/lukas/screens/workspace.tsx", import.meta.url),
    "utf8",
  );
  const retention = readFileSync(
    new URL("../app/lukas/screens/organization-retention.tsx", import.meta.url),
    "utf8",
  );
  const retentionServer = readFileSync(
    new URL(
      "../app/lukas/lib/organization-retention.server.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(routes, /organizations\/:organizationId\/retention/);
  assert.match(dashboard, /retention/);
  assert.match(workspace, /archived_at/);
  assert.match(retentionServer, /rpc\(\s*"lukas_qto_list_retention_projects"/);
  assert.match(retention, /rpc\("lukas_qto_list_active_legal_holds"/);
  assert.doesNotMatch(retention, /const activeHolds = events\.filter/);
  assert.doesNotMatch(
    retention,
    /from\("lukas_qto_projects"\)[\s\S]{0,240}organization_id/,
  );
  assert.match(retention, /loaderData\.activeHolds\.map/);
  assert.doesNotMatch(
    retention,
    /loaderData\.events\.map\([\s\S]*release_hold/,
  );
});

test("organization retention project listing exhausts deterministic ID pages beyond 100", async () => {
  const { loadOrganizationRetentionProjects } =
    await import("../app/lukas/lib/organization-retention.server.ts");
  const projects = Array.from({ length: 205 }, (_, index) => ({
    id: `${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000000`,
    name: `project-${index + 1}`,
    updated_at: new Date(index * 1000).toISOString(),
  }));
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      const start = args.p_after_id
        ? projects.findIndex((project) => project.id === args.p_after_id) + 1
        : 0;
      return {
        data: projects.slice(start, start + args.p_page_size),
        error: null,
      };
    },
  };
  const loaded = await loadOrganizationRetentionProjects(
    client,
    ids.organization,
  );
  assert.equal(loaded.length, 205);
  assert.deepEqual(
    calls.map((call) => call.args.p_after_id),
    [null, projects[99].id, projects[199].id],
  );
  assert.ok(calls.every((call) => call.args.p_page_size === 100));
});
