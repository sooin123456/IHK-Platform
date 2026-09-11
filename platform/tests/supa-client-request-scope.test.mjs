import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer } from "vite";

const fixtureKey = "__supaClientRequestScopeFixture";

globalThis[fixtureKey] = {
  clients: [],
  getUserImpl(args) {
    return Promise.resolve({
      data: { user: { id: args[0] ?? "cookie-user" } },
      error: null,
    });
  },
  createClient() {
    const calls = [];
    const client = {
      auth: {
        getUser(...args) {
          calls.push(args);
          return globalThis[fixtureKey].getUserImpl(args);
        },
      },
    };
    this.clients.push({ calls, client });
    return client;
  },
};

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      name: "supa-client-request-scope-fixture",
      enforce: "pre",
      resolveId(source) {
        if (source === "@supabase/ssr") return "\0request-scope-supabase-ssr";
      },
      load(id) {
        if (id !== "\0request-scope-supabase-ssr") return;
        return `
          export function createServerClient() {
            return globalThis[${JSON.stringify(fixtureKey)}].createClient();
          }
          export function parseCookieHeader() { return []; }
          export function serializeCookieHeader(name, value) {
            return name + "=" + value;
          }
        `;
      },
    },
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
  ssr: { noExternal: ["@supabase/ssr"] },
});

const { default: makeServerClient } = await vite.ssrLoadModule(
  "/app/core/lib/supa-client.server.ts",
);

test.beforeEach(() => {
  globalThis[fixtureKey].clients.length = 0;
  globalThis[fixtureKey].getUserImpl = (args) =>
    Promise.resolve({
      data: { user: { id: args[0] ?? "cookie-user" } },
      error: null,
    });
});

test.after(async () => {
  delete globalThis[fixtureKey];
  await vite.close();
});

test("one request shares its Supabase client, response headers, and cookie auth lookup", async () => {
  const request = new Request("https://example.test/projects/project-1");

  const [firstClient, firstHeaders] = makeServerClient(request);
  const [secondClient, secondHeaders] = makeServerClient(request);
  const firstLookup = firstClient.auth.getUser();
  const secondLookup = secondClient.auth.getUser();

  assert.equal(firstClient, secondClient);
  assert.equal(firstHeaders, secondHeaders);
  assert.equal(firstLookup, secondLookup);
  assert.deepEqual(await firstLookup, {
    data: { user: { id: "cookie-user" } },
    error: null,
  });
  assert.equal(globalThis[fixtureKey].clients.length, 1);
  assert.deepEqual(globalThis[fixtureKey].clients[0].calls, [[]]);
});

test("different Request instances never share Supabase state", async () => {
  const firstRequest = new Request("https://example.test/projects/project-1");
  const secondRequest = new Request("https://example.test/projects/project-1");

  const [firstClient, firstHeaders] = makeServerClient(firstRequest);
  const [secondClient, secondHeaders] = makeServerClient(secondRequest);

  assert.notEqual(firstClient, secondClient);
  assert.notEqual(firstHeaders, secondHeaders);
  assert.equal(globalThis[fixtureKey].clients.length, 2);
});

test("explicit JWT lookups bypass the request's cookie auth memo", async () => {
  const [client] = makeServerClient(
    new Request("https://example.test/projects/project-1"),
  );

  const cookieLookup = client.auth.getUser();
  const firstJwtLookup = client.auth.getUser("jwt-a");
  const secondJwtLookup = client.auth.getUser("jwt-a");

  assert.equal(
    await cookieLookup.then((result) => result.data.user.id),
    "cookie-user",
  );
  assert.equal(
    await firstJwtLookup.then((result) => result.data.user.id),
    "jwt-a",
  );
  assert.equal(
    await secondJwtLookup.then((result) => result.data.user.id),
    "jwt-a",
  );
  assert.deepEqual(globalThis[fixtureKey].clients[0].calls, [
    [],
    ["jwt-a"],
    ["jwt-a"],
  ]);
});

test("a rejected cookie auth lookup stays single-flight for the request", async () => {
  const authFailure = new Error("auth unavailable");
  globalThis[fixtureKey].getUserImpl = () => Promise.reject(authFailure);
  const [client] = makeServerClient(
    new Request("https://example.test/projects/project-1"),
  );

  const firstLookup = client.auth.getUser();
  const secondLookup = client.auth.getUser();
  const firstSettled = await Promise.allSettled([firstLookup, secondLookup]);

  assert.equal(firstLookup, secondLookup);
  assert.deepEqual(firstSettled, [
    { status: "rejected", reason: authFailure },
    { status: "rejected", reason: authFailure },
  ]);
  assert.deepEqual(globalThis[fixtureKey].clients[0].calls, [[]]);

  const laterLookup = client.auth.getUser();
  const [laterSettled] = await Promise.allSettled([laterLookup]);
  assert.equal(laterLookup, firstLookup);
  assert.deepEqual(laterSettled, {
    status: "rejected",
    reason: authFailure,
  });
  assert.deepEqual(globalThis[fixtureKey].clients[0].calls, [[]]);
});
