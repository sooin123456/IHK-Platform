import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import { openDrawingCollaborationConnection } from "../app/lukas/lib/drawing-collaboration-client.ts";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function until(predicate, description, timeout = 4500) {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert.ok(predicate(), description);
}

// Real provider + real socket. Hooks only control the server admission boundary;
// no provider methods, callbacks, or timers are mocked.
async function fixture(t, hooks = {}, resolveToken = async () => "test-token") {
  const server = new Server({
    port: 0,
    address: "127.0.0.1",
    quiet: true,
    ...hooks,
  });
  await server.listen();
  const document = new Y.Doc();
  const phases = [];
  let connection;
  t.after(async () => {
    connection?.dispose();
    document.destroy();
    await server.destroy();
  });
  connection = await openDrawingCollaborationConnection({
    document,
    projectId: randomUUID(),
    revisionId: randomUUID(),
    url: server.webSocketURL,
    resolveToken,
    onPhase: (phase) => phases.push(phase),
  });
  return { server, document, phases, connection };
}

test("a connected transport is not shown as admitted before initial sync", async (t) => {
  const gate = deferred();
  let loading = false;
  t.after(() => gate.resolve());
  const f = await fixture(t, {
    onAuthenticate() {},
    async onLoadDocument({ document }) {
      loading = true;
      await gate.promise;
      document.getMap("drawing").set("server", "canonical");
    },
  });
  try {
    await until(() => loading, "server should reach the gated initial load");
    await delay(30);
    assert.equal(f.phases.includes("connected"), false);
    gate.resolve();
    await until(
      () => f.phases.at(-1) === "connected",
      "initial sync should connect",
    );
    assert.equal(f.document.getMap("drawing").get("server"), "canonical");
    assert.equal(f.connection.phase, "connected");
  } finally {
    gate.resolve();
  }
});

test("transient admission retries automatically and preserves pending local changes", async (t) => {
  let attempts = 0;
  const f = await fixture(t, {
    onAuthenticate() {
      if (++attempts <= 2) throw { reason: "drawing-reconciling" };
    },
    onLoadDocument({ document }) {
      document.getMap("drawing").set("server", "canonical");
    },
  });
  f.document.getMap("drawing").set("local", "pending-line");
  await until(
    () => f.phases.includes("retrying"),
    "transient refusal should be visible",
  );
  assert.equal(f.phases.includes("connected"), false);
  await until(
    () => f.phases.at(-1) === "connected",
    "wrapper must reauthenticate AND resync",
  );
  assert.equal(attempts, 3);
  assert.equal(f.document.getMap("drawing").get("local"), "pending-line");
  assert.equal(f.document.getMap("drawing").get("server"), "canonical");
  const remote = [...f.server.hocuspocus.documents.values()][0];
  await until(
    () => remote.getMap("drawing").get("local") === "pending-line",
    "server should receive retained edits",
  );
  assert.equal(f.document.isDestroyed, false);
});

test("permanent permission denial stops automatic retries and is not labeled offline", async (t) => {
  let attempts = 0;
  const f = await fixture(t, {
    onAuthenticate() {
      attempts++;
      throw { reason: "permission-denied" };
    },
  });
  await until(
    () => f.phases.at(-1) === "denied",
    "permission denial should have a distinct status",
  );
  await f.connection.refreshToken(); // visibility/online events must not hammer rejected access
  await delay(1200);
  assert.equal(attempts, 1);
  assert.equal(f.phases.includes("retrying"), false);
  assert.equal(f.phases.at(-1), "denied");
  assert.equal(f.document.isDestroyed, false);
});

test("disposing a pending retry cancels work and late status callbacks, not the document", async (t) => {
  let attempts = 0;
  const f = await fixture(t, {
    onAuthenticate() {
      attempts++;
      throw { reason: "drawing-reconciling" };
    },
  });
  await until(
    () => f.phases.at(-1) === "retrying",
    "retry should be scheduled",
  );
  f.connection.dispose();
  const phases = [...f.phases];
  await f.connection.refreshToken();
  await delay(1200);
  assert.equal(attempts, 1);
  assert.deepEqual(f.phases, phases);
  assert.equal(f.document.isDestroyed, false);
});

test("simultaneous refresh events share one handshake and cannot restart after disposal", async (t) => {
  const token = deferred();
  let tokenCalls = 0;
  let authentications = 0;
  const f = await fixture(
    t,
    {
      onAuthenticate() {
        authentications++;
      },
    },
    async () => {
      if (++tokenCalls > 1) return token.promise;
      return "test-token";
    },
  );
  await until(() => f.phases.at(-1) === "connected", "initial connection");
  const refresh = f.connection.refreshToken();
  const duplicate = f.connection.refreshToken();
  await until(() => tokenCalls === 2, "one pending token request");
  f.connection.dispose();
  const phases = [...f.phases];
  token.resolve("refreshed-token");
  await Promise.all([refresh, duplicate]);
  await delay(50);
  assert.equal(tokenCalls, 2);
  assert.equal(authentications, 1);
  assert.deepEqual(f.phases, phases);
  assert.equal(f.document.isDestroyed, false);
});

test("a transport reconnect resynchronizes the retained document before reporting connected", async (t) => {
  let admissions = 0;
  const gate = deferred();
  t.after(() => gate.resolve());
  const f = await fixture(t, {
    async onAuthenticate() {
      if (++admissions === 2) await gate.promise;
    },
  });
  try {
    await until(() => f.phases.at(-1) === "connected", "initial connection");
    const remote = [...f.server.hocuspocus.documents.values()][0];
    remote.getConnections()[0].webSocket.close(1001, "test-network-drop");
    await until(() => admissions === 2, "provider should reconnect transport");
    const sinceDisconnect = f.phases.slice(f.phases.indexOf("degraded"));
    assert.equal(sinceDisconnect.includes("connected"), false);
    f.document.getMap("drawing").set("offline", "retained-circle");
    gate.resolve();
    await until(
      () => f.phases.at(-1) === "connected",
      "reconnection sync should finish",
    );
    await until(
      () =>
        [...f.server.hocuspocus.documents.values()].some(
          (doc) => doc.getMap("drawing").get("offline") === "retained-circle",
        ),
      "server should receive the disconnected edit",
    );
  } finally {
    gate.resolve();
  }
});

test("a server document-only permission revocation cannot leave a connected badge or auto retry", async (t) => {
  let admissions = 0;
  const f = await fixture(t, {
    onAuthenticate() {
      admissions++;
    },
  });
  await until(() => f.phases.at(-1) === "connected", "initial connection");
  const remote = [...f.server.hocuspocus.documents.values()][0];
  remote
    .getConnections()[0]
    .close({ code: 4403, reason: "permission-revoked" });
  await until(
    () => f.phases.at(-1) === "denied",
    "document-only close must invalidate admission",
  );
  await f.connection.refreshToken();
  await delay(1200);
  assert.equal(admissions, 1);
  assert.equal(f.document.isDestroyed, false);
});
