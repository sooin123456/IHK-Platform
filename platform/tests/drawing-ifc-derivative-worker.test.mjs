import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  DRAWING_IFC_DERIVATIVE_WORKER_LIMITS,
  drawingIfcDerivativeConverterArguments,
  runDrawingIfcDerivativeConverter,
  runDrawingIfcDerivativeWorkerOnce,
} from "../app/lukas/lib/drawing-ifc-derivative-worker.server.ts";

const ids = {
  job: "71000000-0000-4000-8000-000000000001",
  lease: "71000000-0000-4000-8000-000000000002",
  project: "71000000-0000-4000-8000-000000000003",
  source: "71000000-0000-4000-8000-000000000004",
  actor: "71000000-0000-4000-8000-000000000005",
};
const sourceBytes = new TextEncoder().encode(
  "ISO-10303-21;\nEND-ISO-10303-21;",
);
const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
const claim = {
  jobId: ids.job,
  leaseToken: ids.lease,
  projectId: ids.project,
  sourceFileId: ids.source,
  sourceSha256,
  sourceStoragePath: `${ids.actor}/${ids.project}/source-uploads/model.ifc`,
  sourceByteSize: sourceBytes.byteLength,
  requestedBy: ids.actor,
  derivativeVersion: 1,
};

function harness(overrides = {}) {
  const calls = [];
  const dependencies = {
    async claim() {
      calls.push(["claim"]);
      return claim;
    },
    async download(value) {
      calls.push(["download", value]);
      return sourceBytes;
    },
    async convert(value) {
      calls.push(["convert", value]);
      return {
        manifestBytes: new TextEncoder().encode('{"manifest":true}'),
        geometryBytes: new Uint8Array([0x67, 0x6c, 0x54, 0x46]),
      };
    },
    async publish(value) {
      calls.push(["publish", value]);
      return { id: "71000000-0000-4000-8000-000000000006" };
    },
    async complete(value) {
      calls.push(["complete", value]);
    },
    async fail(value) {
      calls.push(["fail", value]);
    },
    ...overrides,
  };
  return { calls, dependencies };
}

test("worker is idle without claiming or fabricating a pending job", async () => {
  const { calls, dependencies } = harness({
    async claim() {
      calls.push(["claim"]);
      return null;
    },
  });
  assert.equal(await runDrawingIfcDerivativeWorkerOnce(dependencies), "idle");
  assert.deepEqual(calls, [["claim"]]);
});

test("worker verifies source lineage, publishes the exact pair, then completes", async () => {
  const { calls, dependencies } = harness();
  assert.equal(
    await runDrawingIfcDerivativeWorkerOnce(dependencies),
    "completed",
  );
  assert.deepEqual(
    calls.map(([name]) => name),
    ["claim", "download", "convert", "publish", "complete"],
  );
  assert.deepEqual(calls[2][1], {
    sourceBytes,
    sourceFileId: ids.source,
  });
  assert.deepEqual(calls[3][1], {
    jobId: ids.job,
    leaseToken: ids.lease,
    projectId: ids.project,
    sourceFileId: ids.source,
    sourceSha256,
    version: 1,
    createdBy: ids.actor,
    manifestBytes: new TextEncoder().encode('{"manifest":true}'),
    geometryBytes: new Uint8Array([0x67, 0x6c, 0x54, 0x46]),
  });
  assert.deepEqual(calls[4][1], {
    jobId: ids.job,
    leaseToken: ids.lease,
    derivativeVersion: 1,
    derivativeId: "71000000-0000-4000-8000-000000000006",
  });
});

test("source byte or SHA mismatch is terminal before converter and publisher", async () => {
  for (const download of [
    async () => sourceBytes.subarray(0, sourceBytes.byteLength - 1),
    async () => new TextEncoder().encode("ISO-10303-21;CHANGED"),
  ]) {
    const { calls, dependencies } = harness({ download });
    assert.equal(
      await runDrawingIfcDerivativeWorkerOnce(dependencies),
      "failed",
    );
    assert.deepEqual(
      calls.map(([name]) => name),
      ["claim", "fail"],
    );
    assert.deepEqual(calls[1][1], {
      jobId: ids.job,
      leaseToken: ids.lease,
      derivativeVersion: 1,
      retryable: false,
      errorCode: "source_identity_mismatch",
      errorMessage: "IFC source identity verification failed.",
    });
  }
});

test("download and publication failures retry, converter rejection terminates", async () => {
  const cases = [
    {
      stage: "download",
      overrides: {
        download: async () => {
          throw new Error("private URL");
        },
      },
      expected: ["claim", "fail"],
      retryable: true,
      code: "source_download_failed",
      outcome: "retry_scheduled",
    },
    {
      stage: "convert",
      overrides: {
        convert: async () => {
          throw new Error("unsupported geometry");
        },
      },
      expected: ["claim", "download", "fail"],
      retryable: false,
      code: "conversion_failed",
      outcome: "failed",
    },
    {
      stage: "publish",
      overrides: {
        publish: async () => {
          throw new Error("network token");
        },
      },
      expected: ["claim", "download", "convert", "fail"],
      retryable: true,
      code: "publication_failed",
      outcome: "retry_scheduled",
    },
    {
      stage: "complete",
      overrides: {
        complete: async () => {
          throw new Error("lost response");
        },
      },
      expected: ["claim", "download", "convert", "publish", "fail"],
      retryable: true,
      code: "completion_failed",
      outcome: "retry_scheduled",
    },
  ];
  for (const item of cases) {
    const { calls, dependencies } = harness(item.overrides);
    assert.equal(
      await runDrawingIfcDerivativeWorkerOnce(dependencies),
      item.outcome,
      item.stage,
    );
    assert.deepEqual(
      calls.map(([name]) => name),
      item.expected,
      item.stage,
    );
    const failure = calls.at(-1)[1];
    assert.equal(failure.retryable, item.retryable, item.stage);
    assert.equal(failure.errorCode, item.code, item.stage);
    assert.doesNotMatch(
      failure.errorMessage,
      /private URL|network token|lost response|unsupported geometry/,
    );
  }
});

test("converter uses separate no-shell targets, a minimal environment, caps, and cleanup", async () => {
  const calls = [];
  const paths = {
    root: "/task/ifc-job-fixed",
    source: "/task/ifc-job-fixed/source.ifc",
    manifest: "/task/ifc-job-fixed/manifest.json",
    geometry: "/task/ifc-job-fixed/geometry.glb",
  };
  const manifestBytes = new Uint8Array([1, 2]);
  const geometryBytes = new Uint8Array([3, 4, 5]);
  const runtime = {
    async mkdtemp(prefix) {
      calls.push(["mkdtemp", prefix]);
      return paths.root;
    },
    async writeFile(path, bytes, options) {
      calls.push(["writeFile", path, bytes, options]);
    },
    async execFile(binary, args, options) {
      calls.push(["execFile", binary, args, options]);
    },
    async readFile(path) {
      calls.push(["readFile", path]);
      return path === paths.manifest ? manifestBytes : geometryBytes;
    },
    async rm(path, options) {
      calls.push(["rm", path, options]);
    },
    tmpdir() {
      return "/task";
    },
  };

  const result = await runDrawingIfcDerivativeConverter(
    {
      binaryPath: "/opt/1hk/bin/ifc-derivative",
      sourceBytes,
      sourceFileId: ids.source,
    },
    runtime,
  );

  assert.deepEqual(result, { manifestBytes, geometryBytes });
  const invocation = calls.find(([name]) => name === "execFile");
  assert.deepEqual(
    invocation[2],
    drawingIfcDerivativeConverterArguments(paths, ids.source),
  );
  assert.equal(invocation[3].shell, false);
  assert.equal(
    invocation[3].timeout,
    DRAWING_IFC_DERIVATIVE_WORKER_LIMITS.converterTimeoutMilliseconds,
  );
  assert.deepEqual(invocation[3].env, { LANG: "C", LC_ALL: "C" });
  assert.deepEqual(calls.at(-1), [
    "rm",
    paths.root,
    { recursive: true, force: true },
  ]);
});

test("converter failure always cleans its exact task directory and hides stderr", async () => {
  const calls = [];
  await assert.rejects(
    runDrawingIfcDerivativeConverter(
      {
        binaryPath: "/opt/1hk/bin/ifc-derivative",
        sourceBytes,
        sourceFileId: ids.source,
      },
      {
        async mkdtemp() {
          return "/task/ifc-job-rejected";
        },
        async writeFile() {},
        async execFile() {
          throw new Error("customer filename and parser dump");
        },
        async readFile() {
          throw new Error("must not read");
        },
        async rm(path, options) {
          calls.push([path, options]);
        },
        tmpdir() {
          return "/task";
        },
      },
    ),
    (error) => {
      assert.equal(error.message, "IFC derivative conversion failed.");
      return true;
    },
  );
  assert.deepEqual(calls, [
    ["/task/ifc-job-rejected", { recursive: true, force: true }],
  ]);
});

test("converter refuses success when private temporary data cannot be removed", async () => {
  await assert.rejects(
    runDrawingIfcDerivativeConverter(
      {
        binaryPath: "/opt/1hk/bin/ifc-derivative",
        sourceBytes,
        sourceFileId: ids.source,
      },
      {
        async mkdtemp() {
          return "/private/task/ifc-job-cleanup-failed";
        },
        async writeFile() {},
        async execFile() {},
        async readFile(path) {
          return path.endsWith("manifest.json")
            ? new Uint8Array([1])
            : new Uint8Array([2]);
        },
        async rm() {
          throw new Error("/private/task/ifc-job-cleanup-failed is busy");
        },
        tmpdir() {
          return "/private/task";
        },
      },
    ),
    (error) => {
      assert.equal(
        error.message,
        "IFC derivative temporary data cleanup failed.",
      );
      assert.doesNotMatch(error.message, /private|busy/);
      return true;
    },
  );
});
