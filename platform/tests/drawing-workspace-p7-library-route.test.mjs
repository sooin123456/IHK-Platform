import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ORGANIZATION_LIBRARY_LIST_LIMIT,
  parseOrganizationDrawingLibraryForm,
  parseOrganizationDrawingLibrarySearch,
  runOrganizationDrawingLibraryMutation,
} from "../app/lukas/lib/organization-drawing-library.server.ts";

const ids = Object.freeze({
  organization: "71000000-0000-4000-8000-000000000001",
  project: "71000000-0000-4000-8000-000000000002",
  revision: "71000000-0000-4000-8000-000000000003",
  entity: "71000000-0000-4000-8000-000000000004",
  version: "71000000-0000-4000-8000-000000000005",
  predecessor: "71000000-0000-4000-8000-000000000006",
  request: "71000000-0000-4000-8000-000000000007",
});

function form(entries) {
  const value = new FormData();
  for (const [key, item] of Object.entries(entries)) value.set(key, item);
  return value;
}

test("organization library mutations accept stable authority inputs only", () => {
  assert.deepEqual(
    parseOrganizationDrawingLibraryForm(
      form({
        intent: "create_draft",
        kind: "style",
        name: "회사 표준선",
        source_revision_id: ids.revision,
        source_entity_id: ids.entity,
        predecessor_version_id: ids.predecessor,
      }),
    ),
    {
      intent: "create_draft",
      kind: "style",
      name: "회사 표준선",
      sourceRevisionId: ids.revision,
      sourceEntityId: ids.entity,
      predecessorVersionId: ids.predecessor,
    },
  );
  assert.deepEqual(
    parseOrganizationDrawingLibraryForm(
      form({ intent: "publish", version_id: ids.version }),
    ),
    { intent: "publish", versionId: ids.version },
  );
  assert.deepEqual(
    parseOrganizationDrawingLibraryForm(
      form({ intent: "deprecate", version_id: ids.version }),
    ),
    { intent: "deprecate", versionId: ids.version },
  );
  assert.deepEqual(
    parseOrganizationDrawingLibraryForm(
      form({
        intent: "import",
        version_id: ids.version,
        project_id: ids.project,
        revision_id: ids.revision,
        client_request_id: ids.request,
      }),
    ),
    {
      intent: "import",
      versionId: ids.version,
      projectId: ids.project,
      revisionId: ids.revision,
      clientRequestId: ids.request,
    },
  );

  for (const injected of [
    { content_sha256: "a".repeat(64) },
    { canonical_payload: "{}" },
    { organization_id: ids.organization },
    { status: "published" },
    { target_entity_id: ids.entity },
  ])
    assert.throws(
      () =>
        parseOrganizationDrawingLibraryForm(
          form({
            intent: "publish",
            version_id: ids.version,
            ...injected,
          }),
        ),
      /허용되지 않은 필드/,
    );
});

test("workspace template drafts have no polymorphic entity and imports keep exact optional revision", () => {
  assert.deepEqual(
    parseOrganizationDrawingLibraryForm(
      form({
        intent: "create_draft",
        kind: "workspace_template",
        name: "기본 작업실",
        source_revision_id: ids.revision,
      }),
    ),
    {
      intent: "create_draft",
      kind: "workspace_template",
      name: "기본 작업실",
      sourceRevisionId: ids.revision,
      sourceEntityId: null,
      predecessorVersionId: null,
    },
  );
  assert.deepEqual(
    parseOrganizationDrawingLibraryForm(
      form({
        intent: "import",
        version_id: ids.version,
        project_id: ids.project,
        client_request_id: ids.request,
      }),
    ),
    {
      intent: "import",
      versionId: ids.version,
      projectId: ids.project,
      revisionId: null,
      clientRequestId: ids.request,
    },
  );
  assert.throws(
    () =>
      parseOrganizationDrawingLibraryForm(
        form({
          intent: "create_draft",
          kind: "block",
          name: "문",
          source_revision_id: ids.revision,
        }),
      ),
    /원본 객체/,
  );
});

test("organization library search is bounded and cursor identity is exact", () => {
  assert.equal(ORGANIZATION_LIBRARY_LIST_LIMIT, 100);
  assert.deepEqual(
    parseOrganizationDrawingLibrarySearch(
      new URLSearchParams({ kind: "block", status: "published" }),
    ),
    { kind: "block", status: "published" },
  );
  assert.throws(
    () =>
      parseOrganizationDrawingLibrarySearch(
        new URLSearchParams({ kind: "unknown" }),
      ),
    /필터/,
  );
});

test("every mutation binds the route organization into database authority", async () => {
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: {}, error: null });
    },
  };
  for (const mutation of [
    { intent: "publish", versionId: ids.version },
    { intent: "deprecate", versionId: ids.version },
    {
      intent: "import",
      versionId: ids.version,
      projectId: ids.project,
      revisionId: ids.revision,
      clientRequestId: ids.request,
    },
  ])
    await runOrganizationDrawingLibraryMutation(
      client,
      ids.organization,
      mutation,
    );
  assert.equal(calls.length, 3);
  for (const call of calls)
    assert.equal(call.args.p_organization_id, ids.organization, call.name);
});

test("organization library route is mounted in authenticated navigation", () => {
  const routes = readFileSync(
    new URL("../app/routes.ts", import.meta.url),
    "utf8",
  );
  const screen = readFileSync(
    new URL(
      "../app/lukas/screens/organization-drawing-library.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const dashboard = readFileSync(
    new URL("../app/lukas/components/workspace-dashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(routes, /organizations\/:organizationId\/drawing-library/);
  assert.match(screen, /회사 도면 라이브러리/);
  assert.match(screen, /create_draft/);
  assert.match(screen, /publish/);
  assert.match(screen, /deprecate/);
  assert.match(screen, /client_request_id/);
  assert.doesNotMatch(screen, /원본 객체 UUID|직전 버전 UUID/);
  assert.match(screen, /predecessorOptions/);
  assert.match(dashboard, /drawing-library/);
});
