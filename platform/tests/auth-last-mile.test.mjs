import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer } from "vite";

const fixtureKey = "__authLastMileFixture";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      name: "auth-last-mile-fixtures",
      enforce: "pre",
      resolveId(source) {
        if (source.endsWith("supa-client.server"))
          return "\0auth-last-mile-supa";
        if (source.endsWith("concrete-takeoff-artifact.server"))
          return "\0auth-last-mile-takeoff";
        if (source.endsWith("preflight-artifact.server"))
          return "\0auth-last-mile-preflight";
      },
      load(id) {
        if (id === "\0auth-last-mile-supa")
          return `export default function makeServerClient(request) { return globalThis[${JSON.stringify(fixtureKey)}].makeServerClient(request); }`;
        if (id === "\0auth-last-mile-takeoff")
          return "export function verifyConcreteTakeoffBundle() { throw new Error('not reached'); }";
        if (id === "\0auth-last-mile-preflight")
          return "export function verifyPreflightBundle() { throw new Error('not reached'); }";
      },
    },
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});

const confirmRoute = await vite.ssrLoadModule(
  "/app/features/auth/screens/confirm.tsx",
);
const takeoffRoute = await vite.ssrLoadModule(
  "/app/lukas/screens/takeoff-artifact.tsx",
);
const preflightRoute = await vite.ssrLoadModule(
  "/app/lukas/screens/preflight-artifact.tsx",
);

test.after(async () => {
  delete globalThis[fixtureKey];
  await vite.close();
});

test("confirmation OTP failures retain Supabase cookies and cache policy", async () => {
  globalThis[fixtureKey] = {
    makeServerClient() {
      const headers = new Headers();
      return [
        {
          auth: {
            async verifyOtp() {
              headers.append("Set-Cookie", "refresh=next; Path=/");
              return {
                data: { user: null },
                error: { message: "expired token" },
              };
            },
          },
        },
        headers,
      ];
    },
  };

  const result = await confirmRoute.loader({
    request: new Request(
      "https://example.test/auth/confirm?token_hash=token&type=signup",
    ),
  });

  assert.equal(result.init.status, 400);
  assert.ok(result.init.headers, "OTP error response must retain auth headers");
  assert.equal(result.init.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(result.init.headers.getSetCookie(), [
    "refresh=next; Path=/",
  ]);
});

for (const [name, route, pathname] of [
  ["takeoff", takeoffRoute, "/projects/project-1/takeoff/artifact-1?tab=proof"],
  [
    "preflight",
    preflightRoute,
    "/projects/project-1/preflight/artifact-1?tab=proof",
  ],
]) {
  test(`${name} artifact blocks anonymous users before database access`, async () => {
    let databaseCalls = 0;
    globalThis[fixtureKey] = {
      makeServerClient() {
        return [
          {
            auth: {
              async getUser() {
                return {
                  data: { user: { id: "anonymous-1", is_anonymous: true } },
                };
              },
            },
            from() {
              databaseCalls++;
              throw new Error(
                "database access must not occur for anonymous users",
              );
            },
          },
          new Headers([["Set-Cookie", "refresh=next; Path=/"]]),
        ];
      },
    };

    await assert.rejects(
      () =>
        route.loader({
          request: new Request(`https://example.test${pathname}`),
          params: { projectId: "project-1", artifactId: "artifact-1" },
        }),
      (response) => {
        assert.equal(response.status, 302);
        assert.equal(
          response.headers.get("Location"),
          `/login?next=${encodeURIComponent(pathname)}`,
        );
        assert.deepEqual(response.headers.getSetCookie(), [
          "refresh=next; Path=/",
        ]);
        return true;
      },
    );
    assert.equal(databaseCalls, 0);
  });
}
