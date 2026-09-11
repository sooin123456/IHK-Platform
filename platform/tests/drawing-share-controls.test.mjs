import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

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
const controlsModule = await vite
  .ssrLoadModule("/app/lukas/components/drawing-share-controls.tsx")
  .catch(() => ({}));
const shareServer = await vite
  .ssrLoadModule("/app/lukas/lib/drawing-share.server.ts")
  .catch(() => ({}));
const shareAction = await vite
  .ssrLoadModule("/app/lukas/lib/drawing-share-action.server.ts")
  .catch(() => ({}));
test.after(() => vite.close());

const ids = {
  share: "30000000-0000-4000-8000-000000000001",
  project: "30000000-0000-4000-8000-000000000002",
  document: "30000000-0000-4000-8000-000000000003",
  revision: "30000000-0000-4000-8000-000000000004",
  actor: "30000000-0000-4000-8000-000000000005",
};

function renderControls(props) {
  const Component = controlsModule.default;
  const router = createMemoryRouter(
    [{ path: "/", element: createElement(Component, props) }],
    { initialEntries: ["/"] },
  );
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

test("only Admins on frozen exact revisions can mount drawing-share authority", () => {
  assert.equal(typeof controlsModule.canManageDrawingShares, "function");
  for (const status of [
    "review_requested",
    "reviewed",
    "approved",
    "superseded",
  ])
    assert.equal(
      controlsModule.canManageDrawingShares("admin", status, true),
      true,
    );
  assert.equal(
    controlsModule.canManageDrawingShares("admin", "draft", true),
    false,
  );
  assert.equal(
    controlsModule.canManageDrawingShares("editor", "approved", true),
    false,
  );
  assert.equal(
    controlsModule.canManageDrawingShares("admin", "approved", false),
    false,
  );
});

test("share controls expose creation, one-time link, metadata, and scoped revocation", () => {
  assert.equal(typeof controlsModule.default, "function");
  const html = renderControls({
    capability: "admin",
    revisionStatus: "approved",
    snapshotReady: true,
    shares: [
      {
        shareId: ids.share,
        revisionVersion: 7,
        snapshotSha256: "a".repeat(64),
        createdAt: "2026-09-04T00:00:00.000Z",
        expiresAt: "2026-09-11T00:00:00.000Z",
        revokedAt: null,
      },
    ],
    createdShare: {
      shareId: ids.share,
      sharePath: "/share/example-token/drawing",
      expiresAt: "2026-09-11T00:00:00.000Z",
    },
  });
  assert.match(html, /7일 보기 링크 만들기/);
  assert.match(html, /새 공유 링크/);
  assert.match(html, /\/share\/example-token\/drawing/);
  assert.match(html, /공유 링크 취소/);
  assert.match(html, new RegExp(`name="share_id" value="${ids.share}"`));
  assert.doesNotMatch(html, /name="request_id"[^>]*value=""/);
  assert.doesNotMatch(html, /name="share_token"/);
  assert.equal(html.includes("token_hash"), false);
});

test("share controls do not mount for draft or non-Admin workspaces", () => {
  const base = {
    snapshotReady: true,
    shares: [],
    createdShare: null,
  };
  assert.equal(
    renderControls({ ...base, capability: "admin", revisionStatus: "draft" }),
    "",
  );
  assert.equal(
    renderControls({
      ...base,
      capability: "editor",
      revisionStatus: "approved",
    }),
    "",
  );
});

test("share authority scope rejects role, lifecycle, and lineage drift before RPC", () => {
  assert.equal(typeof shareServer.assertDrawingRevisionShareScope, "function");
  const input = {
    capability: "admin",
    projectId: ids.project,
    documentId: ids.document,
    revision: { id: ids.revision, version: 7, status: "approved" },
    bootstrap: {
      sha256: "a".repeat(64),
      canonicalJson: {
        revision: {
          id: ids.revision,
          documentId: ids.document,
          projectId: ids.project,
          version: 7,
        },
      },
    },
  };
  assert.deepEqual(shareServer.assertDrawingRevisionShareScope(input), {
    projectId: ids.project,
    documentId: ids.document,
    revisionId: ids.revision,
    revisionVersion: 7,
    snapshotSha256: "a".repeat(64),
  });
  assert.throws(() =>
    shareServer.assertDrawingRevisionShareScope({
      ...input,
      capability: "editor",
    }),
  );
  assert.throws(() =>
    shareServer.assertDrawingRevisionShareScope({
      ...input,
      revision: { ...input.revision, status: "draft" },
    }),
  );
  assert.throws(() =>
    shareServer.assertDrawingRevisionShareScope({
      ...input,
      bootstrap: {
        ...input.bootstrap,
        canonicalJson: {
          revision: { ...input.bootstrap.canonicalJson.revision, version: 8 },
        },
      },
    }),
  );
});

test("workspace share creation generates the bearer server-side and preserves exact request scope", async () => {
  assert.equal(typeof shareAction.handleDrawingShareIntent, "function");
  const form = new FormData();
  form.set("intent", "create_drawing_share");
  form.set("request_id", ids.share);
  const calls = [];
  const authorityClient = {
    async rpc(name, args) {
      calls.push([name, args]);
      return {
        data: {
          shareId: ids.share,
          projectId: ids.project,
          documentId: ids.document,
          revisionId: ids.revision,
          revisionVersion: 7,
          snapshotSha256: "a".repeat(64),
          createdAt: "2026-09-04T00:00:00.000Z",
          expiresAt: "2026-09-11T00:00:00.000Z",
          revokedAt: null,
          requestId: ids.share,
        },
        error: null,
      };
    },
  };
  const result = await shareAction.handleDrawingShareIntent({
    actorId: ids.actor,
    authorityClient,
    bootstrap: {
      sha256: "a".repeat(64),
      canonicalJson: {
        revision: {
          id: ids.revision,
          documentId: ids.document,
          projectId: ids.project,
          version: 7,
        },
      },
    },
    capability: "admin",
    client: {
      async rpc() {
        throw new Error("Create must not use the authenticated client.");
      },
    },
    environment: {
      SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"s".repeat(48)}`,
    },
    form,
    projectId: ids.project,
    workspace: {
      document: {
        id: ids.document,
        revision: { id: ids.revision, version: 7, status: "approved" },
      },
    },
  });
  assert.equal(result.kind, "drawing_share_created");
  const pathMatch = result.result.sharePath.match(
    /^\/share\/([A-Za-z0-9_-]{43})\/drawing$/,
  );
  assert.ok(pathMatch);
  const rawToken = pathMatch[1];
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  assert.deepEqual(calls, [
    [
      "lukas_qto_create_drawing_share",
      {
        p_project_id: ids.project,
        p_actor_id: ids.actor,
        p_document_id: ids.document,
        p_revision_id: ids.revision,
        p_revision_version: 7,
        p_snapshot_sha256: "a".repeat(64),
        p_token_hash: tokenHash,
        p_request_id: ids.share,
      },
    ],
  ]);
  assert.deepEqual(result.result, {
    shareId: ids.share,
    revisionVersion: 7,
    snapshotSha256: "a".repeat(64),
    createdAt: "2026-09-04T00:00:00.000Z",
    expiresAt: "2026-09-11T00:00:00.000Z",
    revokedAt: null,
    sharePath: result.result.sharePath,
  });
  assert.equal(JSON.stringify(calls).includes(rawToken), false);
});

test("workspace share creation replays one stable server bearer for the same request", async () => {
  const form = new FormData();
  form.set("intent", "create_drawing_share");
  form.set("request_id", ids.share);
  const environment = {
    SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"s".repeat(48)}`,
  };
  let authorityEvents = 0;
  let firstArgs = null;
  const authorityClient = {
    async rpc(name, args) {
      assert.equal(name, "lukas_qto_create_drawing_share");
      if (firstArgs === null) {
        firstArgs = structuredClone(args);
        authorityEvents += 1;
      } else {
        assert.deepEqual(args, firstArgs);
      }
      return {
        data: {
          shareId: ids.share,
          projectId: ids.project,
          documentId: ids.document,
          revisionId: ids.revision,
          revisionVersion: 7,
          snapshotSha256: "a".repeat(64),
          createdAt: "2026-09-04T00:00:00.000Z",
          expiresAt: "2026-09-11T00:00:00.000Z",
          revokedAt: null,
          requestId: ids.share,
        },
        error: null,
      };
    },
  };
  const input = {
    actorId: ids.actor,
    authorityClient,
    bootstrap: {
      sha256: "a".repeat(64),
      canonicalJson: {
        revision: {
          id: ids.revision,
          documentId: ids.document,
          projectId: ids.project,
          version: 7,
        },
      },
    },
    capability: "admin",
    client: {
      async rpc() {
        throw new Error("Create must not use the authenticated client.");
      },
    },
    environment,
    form,
    projectId: ids.project,
    workspace: {
      document: {
        id: ids.document,
        revision: { id: ids.revision, version: 7, status: "approved" },
      },
    },
  };

  const first = await shareAction.handleDrawingShareIntent(input);
  const replay = await shareAction.handleDrawingShareIntent(input);

  assert.deepEqual(replay, first);
  assert.equal(authorityEvents, 1);
  assert.equal(
    JSON.stringify(firstArgs).includes(environment.SUPABASE_SERVICE_ROLE_KEY),
    false,
  );
});

test("workspace share creation rejects a browser-selected bearer before RPC", async () => {
  const chosenToken = "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI";
  const form = new FormData();
  form.set("intent", "create_drawing_share");
  form.set("request_id", ids.share);
  form.set("share_token", chosenToken);
  let rpcCalled = false;
  await assert.rejects(() =>
    shareAction.handleDrawingShareIntent({
      actorId: ids.actor,
      authorityClient: {
        async rpc() {
          rpcCalled = true;
          throw new Error("RPC must not run for a closed-field violation.");
        },
      },
      bootstrap: {
        sha256: "a".repeat(64),
        canonicalJson: {
          revision: {
            id: ids.revision,
            documentId: ids.document,
            projectId: ids.project,
            version: 7,
          },
        },
      },
      capability: "admin",
      client: {
        async rpc() {
          rpcCalled = true;
          throw new Error("RPC must not run for a closed-field violation.");
        },
      },
      form,
      projectId: ids.project,
      workspace: {
        document: {
          id: ids.document,
          revision: { id: ids.revision, version: 7, status: "approved" },
        },
      },
    }),
  );
  assert.equal(rpcCalled, false);
});

test("workspace share creation rejects invalid request identities and injected actor authority before RPC", async () => {
  let rpcCalled = false;
  const base = {
    actorId: ids.actor,
    authorityClient: {
      async rpc() {
        rpcCalled = true;
        throw new Error("RPC must not run for an invalid request identity.");
      },
    },
    bootstrap: {
      sha256: "a".repeat(64),
      canonicalJson: {
        revision: {
          id: ids.revision,
          documentId: ids.document,
          projectId: ids.project,
          version: 7,
        },
      },
    },
    capability: "admin",
    client: {
      async rpc() {
        rpcCalled = true;
        throw new Error("RPC must not run for an invalid request identity.");
      },
    },
    environment: {
      SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"s".repeat(48)}`,
    },
    projectId: ids.project,
    workspace: {
      document: {
        id: ids.document,
        revision: { id: ids.revision, version: 7, status: "approved" },
      },
    },
  };
  const invalidForms = [];
  for (const requestId of [null, "not-a-uuid"]) {
    const form = new FormData();
    form.set("intent", "create_drawing_share");
    if (requestId) form.set("request_id", requestId);
    invalidForms.push(form);
  }
  const duplicate = new FormData();
  duplicate.set("intent", "create_drawing_share");
  duplicate.append("request_id", ids.share);
  duplicate.append("request_id", ids.actor);
  invalidForms.push(duplicate);
  const injectedActor = new FormData();
  injectedActor.set("intent", "create_drawing_share");
  injectedActor.set("request_id", ids.share);
  injectedActor.set("actor_id", ids.actor);
  invalidForms.push(injectedActor);

  for (const form of invalidForms) {
    await assert.rejects(() =>
      shareAction.handleDrawingShareIntent({ ...base, form }),
    );
  }
  assert.equal(rpcCalled, false);
});
