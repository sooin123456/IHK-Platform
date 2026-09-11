import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { compactDrawingServerMeasurementEvidence } from "../app/lukas/lib/drawing-workspace-loader-payload.ts";
import { deriveDrawingServerMeasurementEvidence } from "../app/lukas/lib/drawing-semantic-schedules.ts";

const hydrationModule = await import(
  "../app/lukas/lib/drawing-measurement-evidence-hydration.ts"
).catch(() => ({}));

const {
  drawingMeasurementEvidenceResourceReady,
  scheduleDrawingMeasurementEvidenceHydration,
  fetchDrawingMeasurementEvidenceResource,
  useDeferredDrawingMeasurementEvidence,
} = hydrationModule;

const ids = {
  document: "00000000-0000-4000-8000-000000000001",
  revision: "00000000-0000-4000-8000-000000000002",
  project: "00000000-0000-4000-8000-000000000003",
  object: "00000000-0000-4000-8000-000000000004",
};

function measurementFixture() {
  const object = {
    id: ids.object,
    lineageId: ids.object,
    pageId: "00000000-0000-4000-8000-000000000005",
    name: "Measured line",
    layerId: "00000000-0000-4000-8000-000000000006",
    type: "line",
    geometry: {
      type: "line",
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
    },
    styleId: null,
    style: {},
    version: 1,
  };
  const bootstrap = {
    canonicalJson: {
      schemaVersion: 2,
      revision: {
        id: ids.revision,
        documentId: ids.document,
        projectId: ids.project,
        sequence: 1,
        version: 1,
      },
      sources: [],
      pages: [],
      canvases: [],
      layers: [],
      objects: [object],
      styles: [],
      blocks: [],
      blockInstances: [],
      propertySchemas: [],
      propertyValues: [],
      tables: [],
      issues: [],
      operationSequence: 9,
    },
    operationSequence: 9,
    sha256: "a".repeat(64),
  };
  const evidence = deriveDrawingServerMeasurementEvidence({
    documentId: ids.document,
    revisionId: ids.revision,
    revisionVersion: 1,
    snapshotSha256: bootstrap.sha256,
    operationCheckpoint: bootstrap.operationSequence,
    state: { revisionId: ids.revision, objects: { [object.id]: object } },
  });
  return {
    bootstrap,
    evidence,
    wire: compactDrawingServerMeasurementEvidence(evidence, bootstrap),
  };
}

test("measurement resources wait for a visible consumer and settled checkpoint", () => {
  assert.equal(typeof drawingMeasurementEvidenceResourceReady, "function");
  const settledConsumer = {
    checkpointReady: true,
    consumerVisible: true,
    saved: true,
  };

  assert.equal(
    drawingMeasurementEvidenceResourceReady(settledConsumer),
    true,
    "approved and Viewer consumers stay active when their checkpoint is settled",
  );
  for (const unavailable of [
    { ...settledConsumer, consumerVisible: false },
    { ...settledConsumer, saved: false },
    { ...settledConsumer, checkpointReady: false },
  ])
    assert.equal(drawingMeasurementEvidenceResourceReady(unavailable), false);
});

test("measurement hydration waits for bounded browser idle time", () => {
  assert.equal(typeof scheduleDrawingMeasurementEvidenceHydration, "function");
  const requests = [];
  let hydrations = 0;
  const scheduler = {
    requestIdleCallback(callback, options) {
      requests.push({ callback, options });
      return 31;
    },
    cancelIdleCallback() {},
    setTimeout() {
      throw new Error("idle-capable browsers must not use the timer fallback");
    },
    clearTimeout() {},
  };

  scheduleDrawingMeasurementEvidenceHydration({
    hydrate: () => {
      hydrations += 1;
    },
    scheduler,
  });

  assert.equal(
    hydrations,
    0,
    "synchronous rendering must not rebuild evidence",
  );
  assert.equal(requests.length, 1);
  assert.ok(requests[0].options.timeout > 0);
  assert.ok(requests[0].options.timeout <= 1_000);
  requests[0].callback({ didTimeout: false, timeRemaining: () => 10 });
  assert.equal(hydrations, 1);
});

test("measurement hydration cancels stale loader work and has a prompt timer fallback", () => {
  assert.equal(typeof scheduleDrawingMeasurementEvidenceHydration, "function");
  const idleCallbacks = [];
  const cancelled = [];
  let hydrations = 0;
  const cancel = scheduleDrawingMeasurementEvidenceHydration({
    hydrate: () => {
      hydrations += 1;
    },
    scheduler: {
      requestIdleCallback(callback) {
        idleCallbacks.push(callback);
        return 41;
      },
      cancelIdleCallback(handle) {
        cancelled.push(handle);
      },
      setTimeout() {
        throw new Error(
          "idle-capable browsers must not use the timer fallback",
        );
      },
      clearTimeout() {},
    },
  });
  cancel();
  idleCallbacks[0]({ didTimeout: true, timeRemaining: () => 0 });
  assert.equal(hydrations, 0);
  assert.deepEqual(cancelled, [41]);

  const timers = [];
  scheduleDrawingMeasurementEvidenceHydration({
    hydrate: () => {
      hydrations += 1;
    },
    scheduler: {
      setTimeout(callback, delay) {
        timers.push({ callback, delay });
        return 51;
      },
      clearTimeout() {},
    },
  });
  assert.equal(hydrations, 0);
  assert.equal(timers.length, 1);
  assert.ok(timers[0].delay <= 50);
  timers[0].callback();
  assert.equal(hydrations, 1);
});

test("server rendering leaves compact measurement evidence untouched", () => {
  assert.equal(typeof useDeferredDrawingMeasurementEvidence, "function");
  let reads = 0;
  const unread = new Proxy(
    {},
    {
      get() {
        reads += 1;
        throw new Error("compact evidence was decoded during render");
      },
    },
  );
  function Harness() {
    const result = useDeferredDrawingMeasurementEvidence(unread, unread);
    return createElement(
      "output",
      null,
      result.evidence || result.error ? "decoded" : "pending",
    );
  }

  assert.match(renderToString(createElement(Harness)), />pending</);
  assert.equal(reads, 0);
});

test("measurement resource fetch preserves credentials and decodes the checkpoint-bound wire", async () => {
  assert.equal(typeof fetchDrawingMeasurementEvidenceResource, "function");
  const { bootstrap, evidence, wire } = measurementFixture();
  const calls = [];
  const result = await fetchDrawingMeasurementEvidenceResource({
    url: "/measurement-evidence?revision=trusted",
    bootstrap,
    signal: new AbortController().signal,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          measurementEvidence: wire,
          measurementEvidenceError: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.deepEqual(result, { evidence, error: null });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.credentials, "same-origin");
  assert.equal(calls[0].init.headers.accept, "application/json");
  assert.equal(
    calls[0].init.keepalive,
    true,
    "deferred evidence requests must be allowed to finish across route navigation",
  );
});

test("measurement resource hydration does not abort an in-flight request when its panel closes", async () => {
  const source = await readFile(
    new URL(
      "../app/lukas/lib/drawing-measurement-evidence-hydration.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const hook = source.slice(
    source.indexOf(
      "export function useDeferredDrawingMeasurementEvidenceResource",
    ),
  );

  assert.doesNotMatch(
    hook,
    /new AbortController\(\)|controller\.abort\(\)/,
    "closing a tab may ignore a stale result, but must not surface ERR_ABORTED",
  );
});

test("measurement resource failures stay bounded and stale wire fails closed", async () => {
  assert.equal(typeof fetchDrawingMeasurementEvidenceResource, "function");
  const { bootstrap, wire } = measurementFixture();
  const unavailable = await fetchDrawingMeasurementEvidenceResource({
    url: "/measurement-evidence",
    bootstrap,
    fetcher: async () => new Response("private details", { status: 503 }),
  });
  assert.deepEqual(unavailable, {
    evidence: null,
    error: {
      code: "measurement_derivation_failed",
      message: "서버 측정 증거를 계산하지 못했습니다.",
    },
  });

  const staleWire = structuredClone(wire);
  staleWire.snapshotSha256 = "b".repeat(64);
  const stale = await fetchDrawingMeasurementEvidenceResource({
    url: "/measurement-evidence",
    bootstrap,
    fetcher: async () =>
      new Response(
        JSON.stringify({
          measurementEvidence: staleWire,
          measurementEvidenceError: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  assert.equal(stale.evidence, null);
  assert.equal(stale.error?.code, "measurement_derivation_failed");
});

test("stale measurement checkpoints request one loader revalidation without showing a derivation error", async () => {
  assert.equal(typeof fetchDrawingMeasurementEvidenceResource, "function");
  const { bootstrap } = measurementFixture();
  let staleRequests = 0;
  let bodyReads = 0;
  const result = await fetchDrawingMeasurementEvidenceResource({
    url: "/measurement-evidence?operation=8",
    bootstrap,
    onCheckpointStale() {
      staleRequests += 1;
    },
    fetcher: async () => ({
      ok: false,
      status: 409,
      async json() {
        bodyReads += 1;
        throw new Error("409 bodies are not part of the browser contract");
      },
    }),
  });

  assert.deepEqual(result, { evidence: null, error: null });
  assert.equal(staleRequests, 1);
  assert.equal(bodyReads, 0);

  const controller = new AbortController();
  controller.abort();
  await fetchDrawingMeasurementEvidenceResource({
    url: "/measurement-evidence?operation=8",
    bootstrap,
    signal: controller.signal,
    onCheckpointStale() {
      staleRequests += 1;
    },
    fetcher: async () => ({
      ok: false,
      status: 409,
      async json() {
        throw new Error("409 bodies are not part of the browser contract");
      },
    }),
  });
  assert.equal(staleRequests, 1);
});
