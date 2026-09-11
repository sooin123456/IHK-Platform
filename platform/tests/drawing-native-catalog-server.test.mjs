import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildNativeDrawingTemplate,
  listNativeDrawingTemplateKeys,
} from "../app/lukas/lib/drawing-native-templates.ts";
import { listNativeDrawingSymbols } from "../app/lukas/lib/drawing-native-symbols.ts";

const projectId = "71000000-0000-4000-8000-000000000002";
const revisionId = "71000000-0000-4000-8000-000000000004";
const requestId = "71000000-0000-4000-8000-000000000008";
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function catalog(kind) {
  const definitions =
    kind === "block"
      ? listNativeDrawingSymbols()
      : listNativeDrawingTemplateKeys().map(buildNativeDrawingTemplate);
  return definitions.map((definition) => ({
    kind,
    key: definition.key,
    version: 1,
    name: definition.name,
    description: definition.description,
    definition,
    contentSha256: "a".repeat(64),
    artifactSha256: createHash("sha256")
      .update(canonical(definition))
      .digest("hex"),
  }));
}

test("native catalog accepts authored bytes in the artifact domain and rejects altered geometry, identity, digest, omissions and duplicates", async () => {
  const { loadNativeDrawingCatalog } = await import(
    "../app/lukas/lib/drawing-native-catalog.server.ts"
  );
  const rows = catalog("workspace_template");
  const client = (data) => ({
    rpc: async (name, args) => {
      assert.equal(name, "lukas_drawing_list_native_assets");
      assert.deepEqual(args, {
        p_project_id: projectId,
        p_kind: "workspace_template",
      });
      return { data, error: null };
    },
  });
  const result = await loadNativeDrawingCatalog(
    client(rows),
    projectId,
    "workspace_template",
  );
  assert.equal(result.length, 4);
  assert.equal(
    result.find((row) => row.key === "measured-plan").name,
    "치수 평면 예제",
  );
  assert.notEqual(result[0].artifactSha256, result[0].contentSha256);
  for (const alter of [
    (data) => data.pop(),
    (data) => data.push(data[0]),
    (data) => {
      data[0].definition.units = "m";
    },
    (data) => {
      data[0].artifactSha256 = "b".repeat(64);
    },
    (data) => {
      data[0].name = "Forged title";
    },
    (data) => {
      data[0].version = 2;
    },
    (data) => {
      data[0].unexpected = true;
    },
  ]) {
    const changed = structuredClone(rows);
    alter(changed);
    await assert.rejects(
      loadNativeDrawingCatalog(
        client(changed),
        projectId,
        "workspace_template",
      ),
    );
  }
});

test("native import sends only known identity and rejects a receipt for another revision", async () => {
  const { importNativeDrawingAsset } = await import(
    "../app/lukas/lib/drawing-native-catalog.server.ts"
  );
  let calls = 0;
  const client = {
    rpc: async (name, args) => {
      calls++;
      assert.equal(name, "lukas_drawing_import_native_asset");
      assert.deepEqual(args, {
        p_project_id: projectId,
        p_revision_id: revisionId,
        p_kind: "block",
        p_asset_key: "door-single-900",
        p_asset_version: 1,
        p_client_request_id: requestId,
      });
      return {
        data: {
          importId: requestId,
          targetEntityId: projectId,
          revisionId,
          contentSha256: "a".repeat(64),
        },
        error: null,
      };
    },
  };
  const input = {
    projectId,
    revisionId,
    kind: "block",
    key: "door-single-900",
    version: 1,
    clientRequestId: requestId,
  };
  assert.equal(
    (await importNativeDrawingAsset(client, input)).targetEntityId,
    projectId,
  );
  for (const change of [
    { key: "forged-symbol" },
    { definition: {} },
    { revisionId: null },
    { version: 2 },
  ])
    await assert.rejects(
      importNativeDrawingAsset(client, { ...input, ...change }),
    );
  assert.equal(calls, 1);
  await assert.rejects(
    importNativeDrawingAsset(
      {
        rpc: async () => ({
          data: {
            importId: requestId,
            targetEntityId: projectId,
            revisionId: projectId,
            contentSha256: "a".repeat(64),
          },
          error: null,
        }),
      },
      input,
    ),
  );
});

test("native symbol form rejects duplicate, foreign and provenance fields before import", async () => {
  const { parseNativeDrawingSymbolForm } = await import(
    "../app/lukas/lib/drawing-native-catalog.server.ts"
  );
  const form = new FormData();
  for (const [key, value] of Object.entries({
    intent: "import_native_symbol",
    key: "door-single-900",
    version: "1",
    revisionId,
    clientRequestId: requestId,
  }))
    form.set(key, value);
  assert.equal(parseNativeDrawingSymbolForm(form).key, "door-single-900");
  form.append("key", "door-single-800");
  assert.throws(() => parseNativeDrawingSymbolForm(form));
  form.delete("key");
  form.set("key", "door-single-900");
  form.set("provenance", "approved");
  assert.throws(() => parseNativeDrawingSymbolForm(form));
});

test("company library parses native definitions separately and denies native lifecycle mutation", async () => {
  const {
    parseOrganizationLibraryCanonicalPayload,
    assertOrganizationDrawingLibraryMutationAllowed,
  } = await import("../app/lukas/lib/organization-drawing-library.server.ts");
  const definition = buildNativeDrawingTemplate("measured-plan");
  assert.equal(
    parseOrganizationLibraryCanonicalPayload(
      "workspace_template",
      definition,
      "platform_native",
    ).key,
    "measured-plan",
  );
  assert.throws(() =>
    parseOrganizationLibraryCanonicalPayload(
      "workspace_template",
      { ...definition, units: "m" },
      "platform_native",
    ),
  );
  assert.throws(() =>
    assertOrganizationDrawingLibraryMutationAllowed(
      { source_kind: "platform_native" },
      "publish",
    ),
  );
  assert.throws(() =>
    assertOrganizationDrawingLibraryMutationAllowed(
      { source_kind: "platform_native" },
      "deprecate",
    ),
  );
});

test("workspace native symbol action denies Viewer and mismatched revision before any RPC", async () => {
  const { importNativeDrawingSymbolFromWorkspace } = await import(
    "../app/lukas/lib/drawing-native-catalog.server.ts"
  );
  const form = new FormData();
  for (const [key, value] of Object.entries({
    intent: "import_native_symbol",
    key: "door-single-900",
    version: "1",
    revisionId,
    clientRequestId: requestId,
  }))
    form.set(key, value);
  const client = { rpc: () => assert.fail("Denied import reached SQL") };
  for (const [capability, status, id] of [
    ["viewer", "draft", revisionId],
    ["admin", "draft", projectId],
  ]) {
    await assert.rejects(
      importNativeDrawingSymbolFromWorkspace(client, {
        projectId,
        capability,
        revision: { id, status },
        form,
      }),
    );
  }
  await assert.rejects(
    importNativeDrawingSymbolFromWorkspace(client, {
      projectId,
      capability: "editor",
      revision: null,
      form,
    }),
  );
});

test("same native symbol receipt can be replayed after review or approval without local draft rejection", async () => {
  const { importNativeDrawingSymbolFromWorkspace } = await import(
    "../app/lukas/lib/drawing-native-catalog.server.ts"
  );
  const form = new FormData();
  for (const [key, value] of Object.entries({
    intent: "import_native_symbol",
    key: "door-single-900",
    version: "1",
    revisionId,
    clientRequestId: requestId,
  }))
    form.set(key, value);
  const receipt = {
    importId: requestId,
    targetEntityId: projectId,
    revisionId,
    contentSha256: "a".repeat(64),
  };
  const client = {
    rpc: async (name, args) => {
      assert.equal(name, "lukas_drawing_import_native_asset");
      assert.deepEqual(args, {
        p_project_id: projectId,
        p_revision_id: revisionId,
        p_kind: "block",
        p_asset_key: "door-single-900",
        p_asset_version: 1,
        p_client_request_id: requestId,
      });
      return { data: receipt, error: null };
    },
  };
  for (const status of [
    "draft",
    "review_requested",
    "reviewed",
    "approved",
    "superseded",
  ]) {
    assert.deepEqual(
      await importNativeDrawingSymbolFromWorkspace(client, {
        projectId,
        capability: "editor",
        revision: { id: revisionId, status },
        form,
      }),
      receipt,
      status,
    );
  }
});

test("native SQL conflicts, state denials and temporary failures retain bounded route responses", async (t) => {
  const { createServer } = await import("vite");
  const { fileURLToPath } = await import("node:url");
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    resolve: {
      alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
    },
    server: { middlewareMode: true },
  });
  t.after(() => vite.close());
  const { importNativeDrawingAsset } = await vite.ssrLoadModule(
    "/app/lukas/lib/drawing-native-catalog.server.ts",
  );
  const { drawingWorkspaceActionErrorResponse } = await vite.ssrLoadModule(
    "/app/lukas/lib/drawing-workspace-route.server.ts",
  );
  for (const [code, status, kind] of [
    ["P1C01", 409, "conflict"],
    ["P3F01", 409, "conflict"],
    ["P3F02", 409, "conflict"],
    ["P1R01", 409, "rejected"],
    ["40001", 503, "retryable"],
    ["40P01", 503, "retryable"],
    ["P1T01", 503, "retryable"],
    ["08006", 503, "retryable"],
  ]) {
    let failure;
    try {
      await importNativeDrawingAsset(
        {
          rpc: async () => ({
            data: null,
            error: { code, message: "private database details" },
          }),
        },
        {
          projectId,
          revisionId,
          kind: "block",
          key: "door-single-900",
          version: 1,
          clientRequestId: requestId,
        },
      );
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, `${code}: mutation unexpectedly succeeded`);
    const response = await drawingWorkspaceActionErrorResponse(failure, {
      requestId,
    });
    assert.equal(response.status, status, code);
    assert.equal(response.body.kind, kind, code);
    assert.equal(response.body.ok, false, code);
    assert.equal(response.body.requestId, requestId, code);
    assert.ok(
      !JSON.stringify(response.body).includes("private database details"),
      code,
    );
  }
});
