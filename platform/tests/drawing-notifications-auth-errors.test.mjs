import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer } from "vite";

const fixtureKey = "__drawingNotificationsAuthErrorsFixture";

function queryResult(result) {
  const query = {
    eq() {
      return query;
    },
    in() {
      return query;
    },
    limit() {
      return query;
    },
    order() {
      return query;
    },
    select() {
      return query;
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
}

globalThis[fixtureKey] = {};

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      name: "drawing-notifications-auth-errors-fixture",
      enforce: "pre",
      resolveId(source) {
        if (source.endsWith("supa-client.server"))
          return "\0drawing-notifications-supa-client";
      },
      load(id) {
        if (id === "\0drawing-notifications-supa-client")
          return `export default function (request) { return globalThis[${JSON.stringify(fixtureKey)}].makeServerClient(request); }`;
      },
    },
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});

const route = await vite.ssrLoadModule(
  "/app/lukas/screens/drawing-notifications.tsx",
);

test.after(async () => {
  delete globalThis[fixtureKey];
  await vite.close();
});

function setFixture(results) {
  const databaseCalls = [];
  const headers = new Headers();
  headers.append("Set-Cookie", "refresh=next; Path=/");
  headers.append("Set-Cookie", "session=renewed; Path=/");
  globalThis[fixtureKey].makeServerClient = () => [
    {
      auth: {
        async getUser() {
          return {
            data: {
              user: { id: "user-1", is_anonymous: false },
            },
            error: null,
          };
        },
      },
      from(table) {
        databaseCalls.push(table);
        return queryResult(results[table]);
      },
    },
    headers,
  ];
  return databaseCalls;
}

async function captureThrownResponse(results) {
  const databaseCalls = setFixture(results);
  let thrown;
  try {
    await route.loader({
      request: new Request("https://example.test/notifications"),
    });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Response);
  return { databaseCalls, response: thrown };
}

function assertAuthCookies(response) {
  assert.deepEqual(response.headers.getSetCookie(), [
    "refresh=next; Path=/",
    "session=renewed; Path=/",
  ]);
}

test("notification list failures retain refreshed auth cookies and stop related queries", async () => {
  const { databaseCalls, response } = await captureThrownResponse({
    lukas_drawing_notifications: {
      data: null,
      error: { message: "list unavailable" },
    },
  });

  assert.equal(response.status, 500);
  assert.equal(
    await response.text(),
    "알림을 불러오지 못했습니다: list unavailable",
  );
  assertAuthCookies(response);
  assert.deepEqual(databaseCalls, ["lukas_drawing_notifications"]);
});

test("notification detail failures retain refreshed auth cookies and stop after related queries", async () => {
  const { databaseCalls, response } = await captureThrownResponse({
    lukas_drawing_notifications: {
      data: [
        {
          id: "notification-1",
          project_id: "project-1",
          issue_id: "issue-1",
          event_id: "event-1",
          user_id: "user-1",
          read_at: null,
          created_at: "2026-09-03T00:00:00.000Z",
        },
      ],
      error: null,
    },
    lukas_drawing_issues: {
      data: null,
      error: { message: "details unavailable" },
    },
    lukas_drawing_issue_events: { data: [], error: null },
    lukas_drawing_issue_anchors: { data: [], error: null },
  });

  assert.equal(response.status, 500);
  assert.equal(
    await response.text(),
    "알림 상세를 불러오지 못했습니다: details unavailable",
  );
  assertAuthCookies(response);
  assert.deepEqual(databaseCalls, [
    "lukas_drawing_notifications",
    "lukas_drawing_issues",
    "lukas_drawing_issue_events",
    "lukas_drawing_issue_anchors",
  ]);
});
