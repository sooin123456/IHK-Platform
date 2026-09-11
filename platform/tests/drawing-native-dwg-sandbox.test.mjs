import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fsPromises from "node:fs/promises";
import { access, readFile, rmdir, unlink } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

import {
  imageId,
  containerId,
  sourceBytes,
  expectedSource,
  report,
  transport,
} from "./fixtures/drawing-native-dwg-sandbox-transport.mjs";

async function api() {
  return import("../app/lukas/lib/drawing-native-dwg-sandbox.server.ts").catch(
    (error) => {
      assert.fail(
        `Required production sandbox module unavailable: ${error.code}`,
      );
    },
  );
}

test("production create argv fixes confinement and the native command", async () => {
  const { nativeDwgSandboxCreateArguments: build } = await api();
  const args = build({
    imageId,
    nonce: "c".repeat(32),
    timeoutMilliseconds: 1001,
  });
  for (const flag of ["--read-only", "--init", "--interactive"])
    assert.ok(args.includes(flag));
  for (const [flag, value] of Object.entries({
    "--pull": "never",
    "--network": "none",
    "--user": "65532:65532",
    "--cap-drop": "ALL",
    "--security-opt": "no-new-privileges=true",
    "--cpus": "1",
    "--memory": "1073741824",
    "--memory-swap": "1073741824",
    "--pids-limit": "64",
    "--cgroupns": "private",
    "--ipc": "private",
    "--ulimit": "core=0:0",
    "--tmpfs": "/tmp:rw,noexec,nosuid,nodev,size=16777216",
    "--log-driver": "none",
    "--restart": "no",
    "--entrypoint": "/usr/bin/timeout",
  }))
    assert.equal(args[args.indexOf(flag) + 1], value, flag);
  assert.equal(args[0], "create");
  assert.deepEqual(args.slice(args.indexOf(imageId)), [
    imageId,
    "--signal=KILL",
    "2s",
    "/usr/share/dotnet/dotnet",
    "/app/DwgEngineQualification.dll",
    "read-native-stdio",
  ]);
  for (const override of [
    { imageId: "reader:latest" },
    { nonce: "x" },
    { timeoutMilliseconds: 120001 },
    { timeoutMilliseconds: 0 },
    { timeoutMilliseconds: 1.5 },
  ])
    assert.throws(() =>
      build({
        imageId,
        nonce: "c".repeat(32),
        timeoutMilliseconds: 120000,
        ...override,
      }),
    );
});

test("configuration, abort and exact raw source validation happen before Docker spawn", async (t) => {
  const { runIsolatedNativeDrawingDwgReader: run } = await api();
  const tx = await transport(t);
  const highBits = Buffer.from([0xc1, 0xc3, 0xb1, 0xb0, 0xb2, 0xb4]);
  for (const change of [
    { imageId: "mutable:latest" },
    { imageId: `sha256:${"A".repeat(64)}` },
    { dockerHost: "tcp://127.0.0.1:2375" },
    { dockerHost: "unix://relative.sock" },
    { dockerHost: "unix:///tmp/../docker.sock" },
    { dockerPath: "docker" },
    { expectedSource: { ...expectedSource, sha256: "0".repeat(64) } },
    { expectedSource: { ...expectedSource, byteSize: 1 } },
    { expectedSource: { ...expectedSource, extra: true } },
    {
      sourceBytes: highBits,
      expectedSource: {
        sha256: createHash("sha256").update(highBits).digest("hex"),
        byteSize: 6,
        headerVersion: "AC1024",
      },
    },
    { signal: AbortSignal.abort() },
    { timeoutMilliseconds: 120001 },
  ])
    await assert.rejects(run({ ...tx.input, ...change }), {
      message: "Isolated native DWG read failed.",
    });
  assert.deepEqual(await tx.calls(), []);
});

test("successful transport requires owned stopped receipt, exact bytes and clean CLI environment", async (t) => {
  const { runIsolatedNativeDrawingDwgReader: run } = await api();
  const tx = await transport(t);
  const old = process.env.DWG_TEST_SERVICE_SECRET;
  process.env.DWG_TEST_SERVICE_SECRET = "must-not-reach-cli";
  t.after(() => {
    if (old === undefined) delete process.env.DWG_TEST_SERVICE_SECRET;
    else process.env.DWG_TEST_SERVICE_SECRET = old;
  });
  assert.deepEqual(await run(tx.input), report);
  assert.deepEqual(await tx.stdin(), sourceBytes);
  assert.equal(await tx.stateExists(), false);
  const calls = await tx.calls();
  for (const call of calls) {
    // The Node executable initializes this CoreFoundation locale itself on macOS.
    const { __CF_USER_TEXT_ENCODING, ...env } = call.env;
    if (process.platform === "darwin")
      assert.match(
        __CF_USER_TEXT_ENCODING,
        /^0x[0-9A-Fa-f]+:0x[0-9A-Fa-f]+:0x[0-9A-Fa-f]+$/,
      );
    assert.deepEqual(env, { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" });
  }
  const operations = calls.map((c) => c.args.slice(2, 4).join(" "));
  assert.ok(
    operations.indexOf("container inspect") <
      operations.indexOf("start --attach"),
  );
  assert.deepEqual(calls.at(-1).args.slice(2), ["rm", "--force", containerId]);
});

test("daemon profile deviations fail before start and remove only the owned container", async (t) => {
  const { runIsolatedNativeDrawingDwgReader: run } = await api();
  for (const host of [
    { ReadonlyRootfs: false },
    { NetworkMode: "host" },
    { CapAdd: ["SYS_ADMIN"] },
    { SecurityOpt: ["seccomp=unconfined"] },
    { PidsLimit: 0 },
    { MemorySwap: -1 },
    { Binds: ["/tmp:/host"] },
    { Tmpfs: { "/tmp": "rw" } },
    { Init: false },
    { PidMode: "host" },
    { Devices: [{}] },
    { LogConfig: { Type: "json-file" } },
    { RestartPolicy: { Name: "always" } },
  ]) {
    const tx = await transport(t, "ok", { host });
    await assert.rejects(run(tx.input), {
      message: "Isolated native DWG read failed.",
    });
    assert.equal(
      (await tx.calls()).some((c) => c.args[2] === "start"),
      false,
    );
    assert.equal(await tx.stateExists(), false);
  }
});

test("live, nonzero, OOM, malformed, overflowing and source-mismatched reports never succeed", async (t) => {
  const { runIsolatedNativeDrawingDwgReader: run } = await api();
  for (const [mode, change] of [
    ["ok", { state: { Running: true } }],
    ["ok", { state: { ExitCode: 7 } }],
    ["ok", { state: { OOMKilled: true } }],
    [
      "ok",
      { report: { source: { ...expectedSource, sha256: "0".repeat(64) } } },
    ],
    ["ok", { report: { extra: true } }],
    ["nonzero", {}],
    ["utf8", {}],
    ["stdout-cap", {}],
    ["stderr-cap", {}],
    ["remove-failure", {}],
  ]) {
    const tx = await transport(t, mode, change);
    await assert.rejects(run(tx.input), {
      message: "Isolated native DWG read failed.",
    });
    assert.equal(await tx.stateExists(), mode === "remove-failure");
  }
});

test("lost or malformed create receipts reconcile exact name once and clean owned identity", async (t) => {
  const { runIsolatedNativeDrawingDwgReader: run } = await api();
  for (const mode of ["lost-create", "bad-id", "hang-create"]) {
    const tx = await transport(t, mode);
    await assert.rejects(run({ ...tx.input, timeoutMilliseconds: 1500 }), {
      message: "Isolated native DWG read failed.",
    });
    const calls = await tx.calls();
    assert.equal(calls.filter((c) => c.args[2] === "create").length, 1);
    const name = calls.find((c) => c.args[2] === "create").args;
    const expectedName = name[name.indexOf("--name") + 1];
    assert.ok(
      calls.some(
        (c) => c.args[2] === "container" && c.args.at(-1) === expectedName,
      ),
    );
    assert.equal(await tx.stateExists(), false);
  }
});

test("outer deadline and cancellation use separate cleanup authority", async (t) => {
  const { runIsolatedNativeDrawingDwgReader: run } = await api();
  for (const abort of [false, true]) {
    const tx = await transport(t, "hang-start");
    const controller = new AbortController();
    const timer = abort ? setTimeout(() => controller.abort(), 1500) : null;
    const started = Date.now();
    await assert.rejects(
      run({
        ...tx.input,
        timeoutMilliseconds: abort ? 2500 : 1500,
        signal: controller.signal,
      }),
      { message: "Isolated native DWG read failed." },
    );
    if (timer) clearTimeout(timer);
    assert.ok(Date.now() - started < 2800);
    assert.equal(await tx.stateExists(), false);
    assert.ok((await tx.calls()).some((c) => c.args[2] === "start"));
  }
});

test("caller bytes are snapshotted before awaits and mutation prevents publication", async (t) => {
  const { runIsolatedNativeDrawingDwgReader: run } = await api();
  const tx = await transport(t);
  const pending = run(tx.input);
  tx.input.sourceBytes[8] ^= 1;
  await assert.rejects(pending, {
    message: "Isolated native DWG read failed.",
  });
  assert.deepEqual(await tx.stdin(), sourceBytes);
  assert.equal(await tx.stateExists(), false);
});

test("foreign ownership is never permission to start or delete", async (t) => {
  const { runIsolatedNativeDrawingDwgReader: run } = await api();
  for (const [mode, change] of [
    ["ok", { container: { Image: `sha256:${"f".repeat(64)}` } }],
    ["foreign-cleanup", {}],
  ]) {
    const tx = await transport(t, mode, change);
    await assert.rejects(run(tx.input), {
      message: "Isolated native DWG read failed.",
    });
    assert.equal(
      (await tx.calls()).some((c) => c.args[2] === "rm"),
      false,
    );
    assert.equal(await tx.stateExists(), true);
  }
});

test("unenforced daemon limits and image-provided volumes are refused before create", async (t) => {
  const { runIsolatedNativeDrawingDwgReader: run } = await api();
  for (const change of [
    { info: { MemoryLimit: false } },
    { info: { SwapLimit: false } },
    { info: { CpuCfsQuota: false } },
    { info: { CpuCfsPeriod: false } },
    { info: { PidsLimit: false } },
    { info: { OSType: "windows" } },
    { info: { SecurityOptions: ["name=seccomp,profile=unconfined"] } },
    {
      image: {
        Config: {
          Volumes: { "/data": {} },
          ExposedPorts: null,
          Env: ["DOTNET_EnableDiagnostics=0"],
          Labels: { "org.1hk.native-dwg-reader.protocol": "1hk-dwg-import/1" },
        },
      },
    },
  ]) {
    const tx = await transport(t, "ok", change);
    await assert.rejects(run(tx.input), {
      message: "Isolated native DWG read failed.",
    });
    assert.equal(
      (await tx.calls()).some((c) => c.args[2] === "create"),
      false,
    );
  }
});

test("validated Docker configuration is captured before caller mutation", async (t) => {
  const { runIsolatedNativeDrawingDwgReader: run } = await api();
  const tx = await transport(t);
  const pending = run(tx.input);
  tx.input.dockerHost = "tcp://untrusted.example:2375";
  tx.input.imageId = "untrusted:latest";
  assert.deepEqual(await pending, report);
  assert.equal(await tx.stateExists(), false);
});

test("unexpected stderr, BOM and overflowing metadata fail closed", async (t) => {
  const { runIsolatedNativeDrawingDwgReader: run } = await api();
  for (const mode of ["unexpected-stderr", "bom", "metadata-cap"]) {
    const tx = await transport(t, mode);
    await assert.rejects(run(tx.input), {
      message: "Isolated native DWG read failed.",
    });
    assert.equal(await tx.stateExists(), false);
  }
});

test(
  "caller mutation while cleanup runs still prevents report publication",
  { timeout: 10000 },
  async (t) => {
    const { runIsolatedNativeDrawingDwgReader: run } = await api();
    const tx = await transport(t, "slow-remove");
    const pending = assert.rejects(run(tx.input), {
      message: "Isolated native DWG read failed.",
    });
    const changed = new Promise((resolve) => {
      const timer = setInterval(async () => {
        if ((await tx.calls()).some((c) => c.args[2] === "rm")) {
          clearInterval(timer);
          tx.input.sourceBytes[8] ^= 1;
          resolve();
        }
      }, 10);
      t.after(() => clearInterval(timer));
    });
    await changed;
    await pending;
    assert.equal(await tx.stateExists(), false);
  },
);

test("an extra network attachment or changed shared-memory limit prevents start", async (t) => {
  const { runIsolatedNativeDrawingDwgReader: run } = await api();
  for (const change of [
    { container: { NetworkSettings: { Networks: { none: {}, bridge: {} } } } },
    { host: { ShmSize: 1073741824 } },
  ]) {
    const tx = await transport(t, "ok", change);
    await assert.rejects(run(tx.input), {
      message: "Isolated native DWG read failed.",
    });
    assert.equal(
      (await tx.calls()).some((c) => c.args[2] === "start"),
      false,
    );
    assert.equal(await tx.stateExists(), false);
  }
});

test("every CLI command uses a private empty config, avoiding hostile home fallback and cleaning on failure", async (t) => {
  const { runIsolatedNativeDrawingDwgReader: run } = await api();
  const directories = new Set();
  for (const mode of ["hostile-home", "nonzero"]) {
    const tx = await transport(t, mode);
    if (mode === "nonzero")
      await assert.rejects(run(tx.input), {
        message: "Isolated native DWG read failed.",
      });
    else await run(tx.input);
    assert.equal(await tx.hostileHomeRead(), false);
    const calls = await tx.calls();
    const config = calls[0].configDirectory;
    assert.equal(typeof config, "string");
    assert.equal(directories.has(config), false);
    directories.add(config);
    for (const call of calls) {
      assert.equal(call.configDirectory, config);
      assert.deepEqual(call.configEntries, []);
      assert.equal(call.configMode, 0o700);
    }
    await assert.rejects(access(config), { code: "ENOENT" });
  }
});

test("replacement of the owned CLI config directory is preserved and fails the read", async (t) => {
  const { runIsolatedNativeDrawingDwgReader: run } = await api();
  const tx = await transport(t, "replace-config");
  await assert.rejects(run(tx.input), {
    message: "Isolated native DWG read failed.",
  });
  const config = (await tx.calls())[0].configDirectory;
  t.after(async () => {
    await unlink(join(config, "replacement-sentinel"));
    await rmdir(config);
    await rmdir(config + "-owned");
  });
  assert.equal(
    await readFile(join(config, "replacement-sentinel"), "utf8"),
    "keep",
  );
  assert.equal(await tx.stateExists(), false);
});

for (const action of ["mutation", "cancellation"]) {
  test(
    `caller ${action} during private config cleanup prevents publication`,
    { timeout: 10000 },
    async (t) => {
      const { runIsolatedNativeDrawingDwgReader: run } = await api();
      const tx = await transport(t);
      const controller = new AbortController();
      const originalRmdir = fsPromises.rmdir;
      let cleanedDirectory;
      // Intervene at the last asynchronous cleanup boundary while preserving the
      // real filesystem effect. No parser/production hook or timing race is used.
      const intercepted = t.mock.method(
        fsPromises,
        "rmdir",
        async (path, ...args) => {
          const result = await originalRmdir(path, ...args);
          if (String(path).includes("/1hk-dwg-cli-")) {
            cleanedDirectory = path;
            assert.equal(await tx.stateExists(), false);
            if (action === "mutation") tx.input.sourceBytes[8] ^= 1;
            else controller.abort();
          }
          return result;
        },
      );
      syncBuiltinESMExports();
      t.after(() => {
        intercepted.mock.restore();
        syncBuiltinESMExports();
      });
      const outcome = await run({
        ...tx.input,
        signal: controller.signal,
      }).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      assert.equal(typeof cleanedDirectory, "string");
      await assert.rejects(access(cleanedDirectory), { code: "ENOENT" });
      assert.equal(outcome.error?.message, "Isolated native DWG read failed.");
      assert.equal(outcome.value, undefined);
    },
  );
}
