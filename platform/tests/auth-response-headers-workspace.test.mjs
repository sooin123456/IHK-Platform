import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer } from "vite";

const authenticatedHeadersKey = "__workspaceAuthenticatedHeaders";
const verifiedBoqLoaderCallsKey = "__workspaceVerifiedBoqLoaderCalls";
globalThis[authenticatedHeadersKey] = new Headers([
  ["Set-Cookie", "refresh=next; Path=/"],
  ["Set-Cookie", "session=renewed; Path=/"],
]);
globalThis[verifiedBoqLoaderCallsKey] = 0;

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      name: "authenticated-workspace-route-fixtures",
      enforce: "pre",
      resolveId(source) {
        if (source.endsWith("/lukas/lib/drawing-collaboration.server"))
          return "\0drawing-context";
        if (source.endsWith("/lukas/lib/drawing-workspace.server"))
          return "\0drawing-workspace";
        if (source.endsWith("/lukas/lib/organization-administration.server"))
          return "\0organization-administration";
        if (source.endsWith("/lukas/lib/drawing-workspace-loader-payload"))
          return "\0loader-payload";
        if (
          source === "./verified-boq" ||
          source.endsWith("/lukas/screens/verified-boq")
        )
          return "\0verified-boq";
      },
      load(id) {
        if (id === "\0drawing-context")
          return `export async function drawingContext() { return { headers: globalThis[${JSON.stringify(authenticatedHeadersKey)}], client: {}, project: { id: "10000000-0000-4000-8000-000000000001", owner_id: "20000000-0000-4000-8000-000000000001" }, user: { id: "20000000-0000-4000-8000-000000000001" }, role: "owner" }; }`;
        if (id === "\0drawing-workspace")
          return `export async function loadDrawingWorkspaceCapability() { return "editor"; } export async function loadDrawingWorkspaceMeasurementState() { throw new Error("not reached"); }`;
        if (id === "\0organization-administration")
          return `export async function assertProjectOrganizationFeature() {}`;
        if (id === "\0loader-payload")
          return `export function compactDrawingServerMeasurementEvidence() {}`;
        if (id === "\0verified-boq")
          return `export async function loader() { globalThis[${JSON.stringify(verifiedBoqLoaderCallsKey)}]++; return new Response("csv", { status: 206, headers: [["Content-Disposition", "attachment; filename=boq.csv"], ["Set-Cookie", "download=ready; Path=/"], ["Set-Cookie", "audit=written; Path=/"], ["Set-Cookie", "refresh=next; Path=/"], ["Set-Cookie", "session=renewed; Path=/"]] }); }`;
      },
    },
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const measurementEvidenceRoute = await vite.ssrLoadModule(
  "/app/lukas/screens/drawing-workspace-measurement-evidence.ts",
);
const { mergeResponseHeaders } = await vite.ssrLoadModule(
  "/app/core/lib/response-headers.server.ts",
);
const verifiedBoqExportRoute = await vite.ssrLoadModule(
  "/app/lukas/screens/verified-boq-export.ts",
);

test.after(async () => {
  delete globalThis[authenticatedHeadersKey];
  delete globalThis[verifiedBoqLoaderCallsKey];
  await vite.close();
});

test("authenticated workspace parse responses retain collected Set-Cookie headers", async () => {
  await assert.rejects(
    () =>
      measurementEvidenceRoute.loader({
        request: new Request(
          "https://example.test/projects/invalid/workspaces/valid/evidence",
        ),
        params: {
          projectId: "10000000-0000-4000-8000-000000000001",
          workspaceId: "30000000-0000-4000-8000-000000000001",
        },
      }),
    (response) => {
      assert.equal(response?.constructor?.name, "Response", response?.message);
      assert.equal(response.status, 400);
      assert.deepEqual(response.headers.getSetCookie(), [
        "refresh=next; Path=/",
        "session=renewed; Path=/",
      ]);
      return true;
    },
  );
});

test("auth header merges retain custom download headers and every Set-Cookie", async () => {
  const response = mergeResponseHeaders(
    new Response("export", {
      status: 409,
      statusText: "Conflict",
      headers: [
        ["Content-Disposition", 'attachment; filename="boq.csv"'],
        ["Set-Cookie", "download=ready; Path=/"],
        ["Set-Cookie", "audit=written; Path=/"],
      ],
    }),
    globalThis[authenticatedHeadersKey],
  );

  assert.equal(response.status, 409);
  assert.equal(response.statusText, "Conflict");
  assert.equal(
    response.headers.get("Content-Disposition"),
    'attachment; filename="boq.csv"',
  );
  assert.deepEqual(response.headers.getSetCookie(), [
    "download=ready; Path=/",
    "audit=written; Path=/",
    "refresh=next; Path=/",
    "session=renewed; Path=/",
  ]);
  assert.equal(await response.text(), "export");
});

test("auth header merges do not duplicate cookies already applied to a response", () => {
  const once = mergeResponseHeaders(
    new Response(null, {
      headers: { "Set-Cookie": "refresh=next; Path=/" },
    }),
    globalThis[authenticatedHeadersKey],
  );
  const twice = mergeResponseHeaders(once, globalThis[authenticatedHeadersKey]);

  assert.deepEqual(twice.headers.getSetCookie(), [
    "refresh=next; Path=/",
    "session=renewed; Path=/",
  ]);
});

test("authenticated verified BOQ downloads retain custom headers and auth cookies from one loader context", async () => {
  const response = await verifiedBoqExportRoute.loader({
    request: new Request(
      "https://example.test/projects/project/boq/export/csv",
    ),
    params: { projectId: "project", format: "csv" },
  });

  assert.equal(response.status, 206);
  assert.equal(globalThis[verifiedBoqLoaderCallsKey], 1);
  assert.equal(
    response.headers.get("Content-Disposition"),
    "attachment; filename=boq.csv",
  );
  assert.deepEqual(response.headers.getSetCookie(), [
    "download=ready; Path=/",
    "audit=written; Path=/",
    "refresh=next; Path=/",
    "session=renewed; Path=/",
  ]);
  assert.equal(await response.text(), "csv");
});
