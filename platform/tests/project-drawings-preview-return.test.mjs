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
const preview = await vite.ssrLoadModule(
  "/app/lukas/screens/local-drawing-workspace-preview.tsx",
);
test.after(() => vite.close());
function load(query) {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    return preview.loader({
      request: new Request(
        `http://127.0.0.1:4181/workspace-preview/drawing-workspace?awarenessTest=1&${query}`,
      ),
      params: {},
      context: {},
    }).data;
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

test("project-launched editor returns to the originating project library", () => {
  const data = load("returnProject=00000000-0000-4000-8000-000000000102");
  assert.equal(
    data.roomUrl,
    "/workspace-preview?project=00000000-0000-4000-8000-000000000102",
  );
});

test("preview return navigation ignores external or unknown destinations", () => {
  for (const value of [
    "https://example.com",
    "//example.com",
    "00000000-0000-4000-8000-000000000999",
    "",
  ]) {
    assert.equal(
      load(`returnProject=${encodeURIComponent(value)}`).roomUrl,
      "/workspace-preview",
    );
  }
});

test("viewer preview retains its read-only capability and origin on editor entry", () => {
  const data = load(
    "returnProject=00000000-0000-4000-8000-000000000101&role=viewer",
  );
  assert.equal(data.capability, "viewer");
  assert.equal(
    data.roomUrl,
    "/workspace-preview?project=00000000-0000-4000-8000-000000000101&role=viewer",
  );
});

test("PDF screen preserves a known project, viewer role and original-files tab", () => {
  const data = load(
    "layout=pdf&returnProject=00000000-0000-4000-8000-000000000101&role=viewer&returnTab=files&returnEmpty=1",
  );
  assert.equal(
    data.roomUrl,
    "/workspace-preview?project=00000000-0000-4000-8000-000000000101&role=viewer&empty=1&tab=files",
  );
});

test("PDF entry from the first-use home returns to the same empty home", () => {
  assert.equal(
    load("layout=pdf&returnState=empty").roomUrl,
    "/workspace-preview?state=empty",
  );
  assert.equal(
    load("layout=pdf&returnState=default").roomUrl,
    "/workspace-preview?state=default",
  );
  assert.equal(
    load(
      "layout=pdf&returnState=https://example.com&returnTab=https://example.com",
    ).roomUrl,
    "/workspace-preview",
  );
});
