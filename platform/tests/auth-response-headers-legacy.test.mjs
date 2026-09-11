import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = new URL("../", import.meta.url);
const screen = (name) => new URL(`app/lukas/screens/${name}`, root);

test("legacy protected loaders serialize successful payloads with their Supabase headers", async () => {
  const names = [
    "workspace.tsx",
    "project.tsx",
    "takeoff-artifact.tsx",
    "preflight-artifact.tsx",
    "ifc-browser.tsx",
    "suggestion-pilot.tsx",
    "element-identities.tsx",
    "material-control.tsx",
  ];
  for (const name of names) {
    const source = await readFile(screen(name), "utf8");
    const loaderEnd = source.indexOf("export async function action");
    const loader = source.slice(
      source.indexOf("export async function loader"),
      loaderEnd < 0 ? source.indexOf("export default function") : loaderEnd,
    );
    assert.match(
      loader,
      /return data\([\s\S]*?\{ headers \},?\s*\);/,
      `${name} must preserve auth refresh headers on its successful loader payload`,
    );
  }
});

test("navigation waits for Supabase before its response captures refreshed cookies", async () => {
  const key = "__legacyNavigationHeaders";
  globalThis[key] = new Headers();
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "navigation-auth-fixture",
        enforce: "pre",
        resolveId(source) {
          if (source.endsWith("supa-client.server")) return "\0navigation-supa";
        },
        load(id) {
          if (id === "\0navigation-supa")
            return `export default function () { return [{ auth: { async getUser() { globalThis[${JSON.stringify(key)}].append("Set-Cookie", "refresh=next; Path=/"); return { data: { user: null }, error: null }; } } }, globalThis[${JSON.stringify(key)}]]; }`;
        },
      },
    ],
    resolve: {
      alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
    },
    server: { middlewareMode: true },
  });
  try {
    const route = await vite.ssrLoadModule(
      "/app/core/layouts/navigation.layout.tsx",
    );
    const result = await route.loader({
      request: new Request("https://example.test"),
    });
    assert.deepEqual(result.init.headers.getSetCookie(), [
      "refresh=next; Path=/",
    ]);
  } finally {
    delete globalThis[key];
    await vite.close();
  }
});

test("material export retains artifact headers and multi-cookie auth state from one context", async () => {
  const key = "__legacyMaterialAuthCalls";
  globalThis[key] = 0;
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "material-export-fixture",
        enforce: "pre",
        resolveId(source) {
          if (/lukas\/screens\/material-control(?:\.tsx)?$/.test(source))
            return "\0material-payload";
          if (/lukas\/lib\/material-control\.server(?:\.ts)?$/.test(source))
            return "\0material-csv";
          if (/lukas\/lib\/project-export-audit\.server(?:\.ts)?$/.test(source))
            return "\0material-audit";
        },
        load(id) {
          if (id === "\0material-payload")
            return `export async function loader() { globalThis[${JSON.stringify(key)}]++; return { client: {}, headers: new Headers([["Set-Cookie", "refresh=next; Path=/"], ["Set-Cookie", "session=renewed; Path=/"]]), payload: { project: { id: "project-1" }, summaries: [], materialPlanId: null, materialPlanPage: { cursor: null, nextCursor: null } } }; }`;
          if (id === "\0material-csv")
            return `export function assertCompleteMaterialControlExport() {} export function buildMaterialControlCsv() { return "item,quantity\\nsteel,1\\n"; }`;
          if (id === "\0material-audit")
            return `export async function recordProjectExport() {}`;
        },
      },
    ],
    resolve: {
      alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
    },
    server: { middlewareMode: true },
  });
  try {
    const route = await vite.ssrLoadModule(
      "/app/lukas/screens/material-control-export.ts",
    );
    const response = await route.loader({
      request: new Request("https://example.test"),
    });
    assert.equal(globalThis[key], 1);
    assert.equal(
      response.headers.get("Content-Type"),
      "text/csv; charset=utf-8",
    );
    assert.match(response.headers.get("Content-Disposition"), /project-1\.csv/);
    assert.deepEqual(response.headers.getSetCookie(), [
      "refresh=next; Path=/",
      "session=renewed; Path=/",
    ]);
  } finally {
    delete globalThis[key];
    await vite.close();
  }
});

test("legacy authenticated error and artifact responses merge every auth cookie", async () => {
  for (const name of [
    "information-requirements.tsx",
    "project.tsx",
    "material-control-export.ts",
  ]) {
    const source = await readFile(screen(name), "utf8");
    assert.match(
      source,
      /mergeResponseHeaders/,
      `${name} must merge auth headers`,
    );
  }
});

test("navigation obtains auth before constructing its deferred response", async () => {
  const source = await readFile(
    new URL("app/core/layouts/navigation.layout.tsx", root),
    "utf8",
  );
  assert.ok(
    source.indexOf("await client.auth.getUser()") <
      source.indexOf("return data("),
    "the response must not be initialized before Supabase can refresh cookies",
  );
});

test("material export reuses one authenticated loader context and preserves CSV headers", async () => {
  const source = await readFile(screen("material-control-export.ts"), "utf8");
  assert.doesNotMatch(source, /makeServerClient\(args\.request\)/);
  assert.match(source, /Content-Disposition/);
  assert.match(source, /mergeResponseHeaders/);
});
