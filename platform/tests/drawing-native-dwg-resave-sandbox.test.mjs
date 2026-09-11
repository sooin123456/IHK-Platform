import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fsPromises, { access, readFile, rmdir, unlink } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import {
  imageId,
  containerId,
  sourceBytes,
  expectedSource,
  transport,
} from "./fixtures/drawing-native-dwg-sandbox-transport.mjs";

const failure = { message: "Isolated native DWG resave failed." };
const cleanupFailure = (confirmed) => (error) => {
  assert.equal(error.message, failure.message);
  assert.equal(error.name, "NativeDrawingDwgResaveSandboxError");
  assert.equal(error.cleanupConfirmed, confirmed);
  return true;
};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const requestBytes = Buffer.from(
  JSON.stringify({
    schemaVersion: "1hk-dwg-edits/2",
    sourceSha256: expectedSource.sha256,
    coordinateSystem: "WCS_NATIVE_UNITS",
    edits: [{ handle: "4A", type: "LINE", start: [1, 2, 0], end: [3, 4, 0] }],
  }),
);
const dwgBytes = Buffer.from("AC1024finite-resaved-fixture");
const report = {
  schemaVersion: "1hk-dwg-resave/1",
  qualification: "experimental-unqualified",
  persistenceAuthority: "not-issued",
  source: expectedSource,
  request: {
    schemaVersion: "1hk-dwg-edits/2",
    sha256: sha(requestBytes),
    byteSize: requestBytes.length,
    handles: ["4A"],
  },
  output: {
    sha256: sha(dwgBytes),
    byteSize: dwgBytes.length,
    headerVersion: "AC1024",
  },
  engine: { name: "ACadSharp", version: "3.7.1" },
  verification: {
    noEditRoundTrip: "passed",
    selectedEditRoundTrip: "passed",
    geometryTolerance: 1e-9,
    inventoriedEntityCount: 9,
    editedEntityCount: 1,
    inventoryCoverage: "supported-fields-only",
    independentCad: "not-performed",
  },
};
const txFor = (t, mode = "ok", change = {}) =>
  transport(t, mode, change, {
    report,
    dwgHex: dwgBytes.toString("hex"),
    requestHex: requestBytes.toString("hex"),
  });
async function api() {
  const mod = await import(
    "../app/lukas/lib/drawing-native-dwg-sandbox.server.ts"
  );
  assert.equal(
    typeof mod.runIsolatedNativeDrawingDwgResaver,
    "function",
    "Required isolated resaver API absent",
  );
  assert.equal(
    typeof mod.nativeDwgResaveSandboxCreateArguments,
    "function",
    "Required resaver profile API absent",
  );
  return {
    run: mod.runIsolatedNativeDrawingDwgResaver,
    build: mod.nativeDwgResaveSandboxCreateArguments,
  };
}

test("resaver fixes command, ownership and 2GiB without accepting profile overrides", async () => {
  const { build } = await api();
  const base = { imageId, nonce: "c".repeat(32), timeoutMilliseconds: 1001 };
  const args = build(base);
  for (const [key, value] of Object.entries({
    "--name": `1hk-dwg-resave-${"c".repeat(32)}`,
    "--label": `org.1hk.native-dwg-resaver.attempt=${"c".repeat(32)}`,
    "--memory": "2147483648",
    "--memory-swap": "2147483648",
    "--network": "none",
    "--user": "65532:65532",
    "--cap-drop": "ALL",
    "--security-opt": "no-new-privileges=true",
    "--pids-limit": "64",
    "--cpus": "1",
  }))
    assert.equal(args[args.indexOf(key) + 1], value);
  assert.deepEqual(args.slice(args.indexOf(imageId) + 1), [
    "--signal=KILL",
    "2s",
    "/usr/share/dotnet/dotnet",
    "/app/DwgEngineQualification.dll",
    "resave-native-stdio",
  ]);
  for (const change of [
    { imageId: "mutable:latest" },
    { nonce: "x" },
    { timeoutMilliseconds: 0 },
    { timeoutMilliseconds: 120001 },
    { command: "sh" },
    { memory: 1 },
  ])
    assert.throws(() => build({ ...base, ...change }), failure);
});

test("success streams literal frame and returns only verified bytes after both cleanup stages", async (t) => {
  const { run } = await api();
  const tx = await txFor(t);
  const result = await run(tx.input);
  assert.deepEqual(result, {
    report,
    reportBytes: Buffer.from(JSON.stringify(report)),
    dwgBytes,
  });
  const header = Buffer.from([
    49, 72, 75, 82, 83, 86, 48, 49, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  header.writeUInt32BE(requestBytes.length, 8);
  header.writeUInt32BE(sourceBytes.length, 12);
  assert.deepEqual(
    await tx.stdin(),
    Buffer.concat([header, requestBytes, sourceBytes]),
  );
  assert.equal(await tx.stateExists(), false);
  const calls = await tx.calls();
  assert.deepEqual(calls.at(-1).args.slice(2), ["rm", "--force", containerId]);
  for (const call of calls) {
    const { __CF_USER_TEXT_ENCODING, ...env } = call.env;
    assert.deepEqual(env, { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" });
    assert.deepEqual(call.configEntries, []);
    assert.equal(call.configMode, 0o700);
  }
  await assert.rejects(access(calls[0].configDirectory), { code: "ENOENT" });
});

test("request and source mismatches, host configuration and abort fail before Docker spawn", async (t) => {
  const { run } = await api();
  const tx = await txFor(t);
  const unbound = Buffer.from(
    requestBytes.toString().replace(expectedSource.sha256, "0".repeat(64)),
  );
  for (const change of [
    { expectedRequestSha256: "0".repeat(64) },
    { requestBytes: unbound, expectedRequestSha256: sha(unbound) },
    { expectedSource: { ...expectedSource, sha256: "0".repeat(64) } },
    { imageId: "mutable:latest" },
    { dockerHost: "tcp://127.0.0.1:2375" },
    { dockerPath: "docker" },
    { signal: AbortSignal.abort() },
    { timeoutMilliseconds: 120001 },
  ])
    await assert.rejects(run({ ...tx.input, ...change }), cleanupFailure(true));
  assert.deepEqual(await tx.calls(), []);
});

test("resaver refuses wrong image protocol and unenforced resources before create", async (t) => {
  const { run } = await api();
  for (const change of [
    { info: { MemoryLimit: false } },
    { info: { SwapLimit: false } },
    { info: { SecurityOptions: ["name=seccomp,profile=unconfined"] } },
    {
      image: {
        Config: {
          Volumes: null,
          ExposedPorts: null,
          Env: ["DOTNET_EnableDiagnostics=0"],
          Labels: { "org.1hk.native-dwg-reader.protocol": "1hk-dwg-import/1" },
        },
      },
    },
  ]) {
    const tx = await txFor(t, "ok", change);
    await assert.rejects(run(tx.input), cleanupFailure(true));
    assert.equal(
      (await tx.calls()).some((c) => c.args[2] === "create"),
      false,
    );
  }
});

test("actual receipt deviations prevent start and clean exact owned identity", async (t) => {
  const { run } = await api();
  for (const change of [
    { host: { Memory: 1073741824 } },
    { host: { MemorySwap: 1073741824 } },
    { host: { NetworkMode: "host" } },
    { host: { CapAdd: ["SYS_ADMIN"] } },
    { host: { Binds: ["/tmp:/host"] } },
    { container: { Mounts: [{}] } },
    { container: { Args: ["sh"] } },
    { config: { Cmd: ["read-native-stdio"] } },
    { config: { Env: ["SECRET=x"] } },
  ]) {
    const tx = await txFor(t, "ok", change);
    await assert.rejects(run(tx.input), cleanupFailure(true));
    assert.equal(
      (await tx.calls()).some((c) => c.args[2] === "start"),
      false,
    );
    assert.equal(await tx.stateExists(), false);
  }
});

test("stderr, nonzero, OOM, overflow, malformed and mismatched reports fail closed", async (t) => {
  const { run } = await api();
  for (const [mode, change] of [
    ["nonzero", {}],
    ["unexpected-stderr", {}],
    ["stderr-cap", {}],
    ["stdout-cap", {}],
    ["metadata-cap", {}],
    ["utf8", {}],
    ["bom", {}],
    ["ok", { state: { OOMKilled: true } }],
    ["ok", { state: { ExitCode: 7 } }],
    ["ok", { state: { Running: true } }],
    ["ok", { report: { extra: true } }],
    [
      "ok",
      { report: { source: { ...expectedSource, sha256: "0".repeat(64) } } },
    ],
    [
      "ok",
      { report: { request: { ...report.request, sha256: "0".repeat(64) } } },
    ],
    [
      "ok",
      { report: { output: { ...report.output, sha256: "0".repeat(64) } } },
    ],
    ["remove-failure", {}],
  ]) {
    const tx = await txFor(t, mode, change);
    await assert.rejects(
      run(tx.input),
      cleanupFailure(mode !== "remove-failure"),
    );
    assert.equal(await tx.stateExists(), mode === "remove-failure");
  }
});

test("uncertain create outcomes reconcile by owned name and foreign identity is preserved", async (t) => {
  const { run } = await api();
  for (const mode of [
    "lost-create",
    "bad-id",
    "hang-create",
    "foreign-cleanup",
  ]) {
    const tx = await txFor(t, mode);
    await assert.rejects(
      run({ ...tx.input, timeoutMilliseconds: 1500 }),
      cleanupFailure(mode !== "foreign-cleanup"),
    );
    const calls = await tx.calls();
    assert.equal(calls.filter((c) => c.args[2] === "create").length, 1);
    assert.equal(
      calls.some((c) => c.args[2] === "rm"),
      mode !== "foreign-cleanup",
    );
    assert.equal(await tx.stateExists(), mode === "foreign-cleanup");
    if (mode !== "foreign-cleanup")
      assert.ok(
        calls.some(
          (c) =>
            c.args[2] === "container" && /^1hk-dwg-resave-/.test(c.args.at(-1)),
        ),
      );
  }
});

for (const stage of ["start", "removal", "config-cleanup"])
  for (const action of ["source-mutation", "request-mutation", "abort"]) {
    test(
      `${action} at ${stage} prevents publication after owned cleanup`,
      { timeout: 10000 },
      async (t) => {
        const { run } = await api();
        const tx = await txFor(
          t,
          stage === "removal"
            ? "slow-remove"
            : stage === "start" && action === "abort"
              ? "hang-start"
              : "ok",
        );
        const controller = new AbortController();
        const act = () => {
          if (action === "abort") controller.abort();
          else
            tx.input[
              action === "source-mutation" ? "sourceBytes" : "requestBytes"
            ][8] ^= 1;
        };
        if (stage === "config-cleanup") {
          const original = fsPromises.rmdir;
          const mocked = t.mock.method(
            fsPromises,
            "rmdir",
            async (path, ...args) => {
              const value = await original(path, ...args);
              if (String(path).includes("/1hk-dwg-cli-")) act();
              return value;
            },
          );
          syncBuiltinESMExports();
          t.after(() => {
            mocked.mock.restore();
            syncBuiltinESMExports();
          });
        }
        const pending = assert.rejects(
          run({ ...tx.input, signal: controller.signal }),
          cleanupFailure(true),
        );
        if (stage === "start" && action !== "abort") act();
        else if (stage !== "config-cleanup") {
          const deadline = Date.now() + 5000;
          while (
            !(await tx.calls()).some(
              (c) => c.args[2] === (stage === "start" ? "start" : "rm"),
            )
          ) {
            assert.ok(Date.now() < deadline);
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          act();
        }
        await pending;
        assert.equal(await tx.stateExists(), false);
        if (action !== "abort") {
          const bytes = await tx.stdin();
          assert.deepEqual(
            bytes.subarray(16, 16 + requestBytes.length),
            requestBytes,
          );
          assert.deepEqual(
            bytes.subarray(16 + requestBytes.length),
            sourceBytes,
          );
        }
      },
    );
  }

test("bounded outer deadline still performs independent cleanup", async (t) => {
  const { run } = await api();
  const tx = await txFor(t, "hang-start");
  const started = Date.now();
  await assert.rejects(
    run({ ...tx.input, timeoutMilliseconds: 1500 }),
    cleanupFailure(true),
  );
  assert.ok(Date.now() - started < 2800);
  assert.equal(await tx.stateExists(), false);
});

test("replaced private CLI directory is preserved and resave fails", async (t) => {
  const { run } = await api();
  const tx = await txFor(t, "replace-config");
  await assert.rejects(run(tx.input), cleanupFailure(false));
  const directory = (await tx.calls())[0].configDirectory;
  t.after(async () => {
    await unlink(join(directory, "replacement-sentinel"));
    await rmdir(directory);
    await rmdir(directory + "-owned");
  });
  assert.equal(
    await readFile(join(directory, "replacement-sentinel"), "utf8"),
    "keep",
  );
  assert.equal(await tx.stateExists(), false);
});

test("uncertain CLI directory creation cannot claim cleanup; reader retains generic error", async (t) => {
  const { run } = await api();
  const tx = await txFor(t);
  const mocked = t.mock.method(fsPromises, "mkdtemp", async () => {
    throw new Error("uncertain creation");
  });
  syncBuiltinESMExports();
  t.after(() => {
    mocked.mock.restore();
    syncBuiltinESMExports();
  });
  await assert.rejects(run(tx.input), cleanupFailure(false));
  const { runIsolatedNativeDrawingDwgReader } = await import(
    "../app/lukas/lib/drawing-native-dwg-sandbox.server.ts"
  );
  await assert.rejects(
    runIsolatedNativeDrawingDwgReader({
      ...tx.input,
      signal: AbortSignal.abort(),
    }),
    (error) => {
      assert.equal(error.name, "Error");
      assert.equal(error.message, "Isolated native DWG read failed.");
      assert.equal(Object.hasOwn(error, "cleanupConfirmed"), false);
      return true;
    },
  );
});
