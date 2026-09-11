import assert from "node:assert/strict";
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

const workspace = await vite.ssrLoadModule("/app/lukas/screens/workspace.tsx");

test.after(() => vite.close());

test("default workspace entry prefers a populated authorized scope without overriding explicit scope", () => {
  assert.equal(
    typeof workspace.resolveWorkspaceEntryScope,
    "function",
    "workspace route must export its pure entry-scope decision",
  );

  const common = {
    authorizedOrganizationIds: ["personal", "empty-team", "populated-team"],
    defaultOrganizationId: "personal",
    accessibleProjectOrganizationIds: ["populated-team", "outside"],
    hasSharedProjects: true,
  };

  assert.deepEqual(workspace.resolveWorkspaceEntryScope(common), {
    activeScopeKey: "populated-team",
    hasAccessibleProjects: true,
  });
  assert.deepEqual(
    workspace.resolveWorkspaceEntryScope({
      ...common,
      requestedSpace: "empty-team",
    }),
    { activeScopeKey: "empty-team", hasAccessibleProjects: true },
  );
  assert.deepEqual(
    workspace.resolveWorkspaceEntryScope({
      ...common,
      requestedSpace: "shared",
    }),
    { activeScopeKey: "shared", hasAccessibleProjects: true },
  );
});

test("default workspace entry falls back from empty organizations to shared and identifies a new account", () => {
  const emptyOrganizations = {
    authorizedOrganizationIds: ["personal", "empty-team"],
    defaultOrganizationId: "personal",
    accessibleProjectOrganizationIds: ["outside"],
  };

  assert.deepEqual(
    workspace.resolveWorkspaceEntryScope({
      ...emptyOrganizations,
      hasSharedProjects: true,
    }),
    { activeScopeKey: "shared", hasAccessibleProjects: true },
  );
  assert.deepEqual(
    workspace.resolveWorkspaceEntryScope({
      ...emptyOrganizations,
      hasSharedProjects: false,
    }),
    { activeScopeKey: "personal", hasAccessibleProjects: false },
  );
});
