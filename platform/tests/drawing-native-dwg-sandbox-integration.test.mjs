import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  chmod,
  constants,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { after, before, test } from "node:test";

import { projectNativeDrawingDwgImport } from "../app/lukas/lib/drawing-native-dwg-import.server.ts";
import {
  nativeDwgSandboxCreateArguments,
  runIsolatedNativeDrawingDwgReader,
} from "../app/lukas/lib/drawing-native-dwg-sandbox.server.ts";
import { runNativeDwgProcess } from "../app/lukas/lib/drawing-native-dwg-worker.server.ts";

const ATTEMPT_LABEL = "org.1hk.native-dwg-reader.attempt";
const fallbackPublishedDirectory = new URL(
  "../../tools/dwg-engine-qualification/bin/Release/net8.0/",
  import.meta.url,
).pathname;
const sha256Of = (bytes) => createHash("sha256").update(bytes).digest("hex");

let dockerPath;
let dockerHost;
let imageId;
let integrationRoot;
let dockerConfigDirectory;
let sourceBytes;
let expectedSource;

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `Required actual Docker isolation prerequisite is unavailable: ${name}.`,
    );
  return value;
}

function dockerEnvironment(overrides = {}) {
  return {
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
    ...overrides,
  };
}

async function dockerCall(
  args,
  { input, timeoutMilliseconds = 30_000, environment = {} } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      dockerPath,
      ["--config", dockerConfigDirectory, "--host", dockerHost, ...args],
      {
        env: dockerEnvironment(environment),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const fail = (error) => {
      child.kill("SIGKILL");
      finish(() => reject(error));
    };
    const timer = setTimeout(
      () =>
        fail(new Error(`Docker command exceeded ${timeoutMilliseconds}ms.`)),
      timeoutMilliseconds,
    );
    child.once("error", fail);
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 1024 * 1024) fail(new Error("Docker stdout overflow."));
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 1024 * 1024) fail(new Error("Docker stderr overflow."));
      else stderr.push(chunk);
    });
    child.once("close", (code, signal) =>
      finish(() =>
        resolve({
          code,
          signal,
          stdout: Buffer.concat(stdout, stdoutBytes),
          stderr: Buffer.concat(stderr, stderrBytes),
        }),
      ),
    );
    child.stdin.once("error", fail);
    child.stdin.end(input);
  });
}

async function successfulDockerCall(args, options) {
  const result = await dockerCall(args, options);
  assert.equal(
    result.code,
    0,
    `Docker command failed (${args.slice(0, 3).join(" ")}): ${result.stderr
      .toString("utf8")
      .slice(0, 2_000)}`,
  );
  assert.equal(result.signal, null);
  return result.stdout;
}

async function inspectContainer(target) {
  return JSON.parse(
    (await successfulDockerCall(["container", "inspect", target])).toString(
      "utf8",
    ),
  )[0];
}

async function assertContainerAbsent(target) {
  assert.match(target, /^1hk-dwg-read-[0-9a-f]{32}$/);
  const output = await successfulDockerCall([
    "container",
    "ls",
    "--all",
    "--no-trunc",
    "--filter",
    `name=^/${target}$`,
    "--format",
    "{{.Names}}",
  ]);
  const exactMatches = output
    .toString("utf8")
    .split("\n")
    .filter((name) => name === target);
  assert.deepEqual(exactMatches, [], `container ${target} was not removed`);
}

async function removeOwnedTestContainer({ id, image, name, label, nonce }) {
  const receipt = await inspectContainer(id);
  assert.equal(receipt.Id, id);
  assert.equal(receipt.Image, image);
  assert.equal(receipt.Name, `/${name}`);
  assert.equal(receipt.Config.Labels[label], nonce);
  const removed = await successfulDockerCall(["rm", "--force", id]);
  assert.equal(removed.toString("utf8").trim(), id);
}

function commandReplacement(createArguments, replacement) {
  const imageIndex = createArguments.indexOf(imageId);
  assert.notEqual(imageIndex, -1);
  return [...createArguments.slice(0, imageIndex + 1), ...replacement];
}

async function createFromProductionProfile({ nonce, command, milliseconds }) {
  const name = `1hk-dwg-read-${nonce}`;
  const args = commandReplacement(
    nativeDwgSandboxCreateArguments({
      imageId,
      nonce,
      timeoutMilliseconds: milliseconds,
    }),
    command,
  );
  const id = (await successfulDockerCall(args, { timeoutMilliseconds: 30_000 }))
    .toString("utf8")
    .trim();
  assert.match(id, /^[0-9a-f]{64}$/);
  const receipt = await inspectContainer(id);
  assert.equal(receipt.Name, `/${name}`);
  assert.equal(receipt.Image, imageId);
  assert.equal(receipt.Config.Labels[ATTEMPT_LABEL], nonce);
  return { id, image: imageId, name, label: ATTEMPT_LABEL, nonce, receipt };
}

async function createForwardingShim(t, { coordinateAbort = false } = {}) {
  const directory = await mkdtemp(join(integrationRoot, "docker-shim-"));
  const path = join(directory, "docker");
  const logPath = join(directory, "calls.log");
  const startedPath = join(directory, "start-attached");
  const script = `#!/bin/sh
actual=${JSON.stringify(dockerPath)}
host=${JSON.stringify(dockerHost)}
log=${JSON.stringify(logPath)}
marker=${JSON.stringify(startedPath)}
printf '%s\\n' "$*" >> "$log"
is_start=0
container_id=
docker_config=
previous=
for argument in "$@"; do
  if [ "$argument" = "start" ]; then is_start=1; fi
  if [ "$previous" = "--config" ]; then docker_config="$argument"; fi
  previous="$argument"
  container_id="$argument"
done
if [ "$is_start" -eq 1 ] && [ ${coordinateAbort ? "1" : "0"} -eq 1 ]; then
  "$actual" --config "$docker_config" --host "$host" start "$container_id" >/dev/null || exit $?
  /usr/bin/touch "$marker"
  /bin/sleep 2
  exec "$actual" --config "$docker_config" --host "$host" attach "$container_id"
fi
exec "$actual" "$@"
`;
  await writeFile(path, script);
  await chmod(path, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    path,
    logPath,
    startedPath,
    async attempts() {
      const log = await readFile(logPath, "utf8").catch(() => "");
      return [...new Set(log.match(/1hk-dwg-read-[0-9a-f]{32}/g) ?? [])];
    },
  };
}

async function waitUntil(check, timeoutMilliseconds = 5_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Condition was not reached within ${timeoutMilliseconds}ms.`);
}

function section(output, name) {
  const match = output.match(
    new RegExp(`${name}_BEGIN\\n([\\s\\S]*?)${name}_END(?:\\n|$)`),
  );
  assert.ok(match, `missing ${name} probe section`);
  return match[1];
}

before(
  async () => {
    dockerPath = requiredEnvironment("NATIVE_DWG_DOCKER_PATH");
    dockerHost = requiredEnvironment("NATIVE_DWG_DOCKER_HOST");
    imageId = requiredEnvironment("NATIVE_DWG_READER_IMAGE_ID");
    assert.ok(
      isAbsolute(dockerPath),
      "NATIVE_DWG_DOCKER_PATH must be absolute",
    );
    dockerPath = await realpath(dockerPath);
    assert.ok((await stat(dockerPath)).isFile());
    await access(dockerPath, constants.X_OK);
    assert.match(dockerHost, /^unix:\/\/\/[^\0\r\n?#%]+$/);
    const socket = dockerHost.slice("unix://".length);
    assert.ok(isAbsolute(socket));
    assert.equal(normalize(socket), socket);
    assert.ok((await stat(socket)).isSocket());
    assert.match(imageId, /^sha256:[0-9a-f]{64}$/);

    integrationRoot = await mkdtemp(
      join(await realpath(tmpdir()), "native-dwg-sandbox-integration-"),
    );
    dockerConfigDirectory = await mkdtemp(
      join(integrationRoot, "empty-docker-config-"),
    );
    assert.equal((await stat(dockerConfigDirectory)).mode & 0o777, 0o700);

    const inspectedImage = JSON.parse(
      (await successfulDockerCall(["image", "inspect", imageId])).toString(
        "utf8",
      ),
    )[0];
    assert.equal(inspectedImage.Id, imageId);
    assert.equal(
      inspectedImage.Config.Labels["org.1hk.native-dwg-reader.protocol"],
      "1hk-dwg-import/1",
    );

    const publishedDirectory =
      process.env.NATIVE_DWG_PUBLISHED_DIRECTORY ?? fallbackPublishedDirectory;
    assert.ok(isAbsolute(publishedDirectory));
    await access(
      join(publishedDirectory, "DwgEngineQualification.dll"),
      constants.R_OK,
    );
    const dotnetPath = await realpath(
      process.env.NATIVE_DWG_DOTNET_PATH ?? "/opt/homebrew/bin/dotnet",
    );
    await access(dotnetPath, constants.X_OK);
    const fixtureDirectory = join(integrationRoot, "fresh-generated-fixture");
    await runNativeDwgProcess(
      dotnetPath,
      [
        join(publishedDirectory, "DwgEngineQualification.dll"),
        "create-generated-fixture",
        "--output-dir",
        fixtureDirectory,
      ],
      {
        timeoutMilliseconds: 120_000,
        maxOutputBytes: 64 * 1024,
        signal: new AbortController().signal,
        env: { LANG: "C", LC_ALL: "C" },
      },
    );
    sourceBytes = await readFile(join(fixtureDirectory, "synthetic-input.dwg"));
    expectedSource = {
      sha256: sha256Of(sourceBytes),
      byteSize: sourceBytes.byteLength,
      headerVersion: sourceBytes.subarray(0, 6).toString("ascii"),
    };
  },
  { timeout: 180_000 },
);

after(async () => {
  if (integrationRoot)
    await rm(integrationRoot, { recursive: true, force: true });
});

test(
  "container absence requires a successful exact-name Docker query",
  { timeout: 30_000 },
  async (t) => {
    const owned = await createFromProductionProfile({
      nonce: randomBytes(16).toString("hex"),
      milliseconds: 5_000,
      command: ["--signal=KILL", "5s", "/bin/true"],
    });
    let removed = false;
    try {
      await assert.rejects(assertContainerAbsent(owned.name));
      await removeOwnedTestContainer(owned);
      removed = true;
      await assert.doesNotReject(assertContainerAbsent(owned.name));

      const directory = await mkdtemp(join(integrationRoot, "failed-docker-"));
      const failedDockerPath = join(directory, "docker");
      await writeFile(failedDockerPath, "#!/bin/sh\nexit 42\n");
      await chmod(failedDockerPath, 0o700);
      t.after(() => rm(directory, { recursive: true, force: true }));
      const actualDockerPath = dockerPath;
      dockerPath = failedDockerPath;
      try {
        await assert.rejects(
          assertContainerAbsent(owned.name),
          /Docker command failed/,
        );
      } finally {
        dockerPath = actualDockerPath;
      }
    } finally {
      if (!removed) await removeOwnedTestContainer(owned);
    }
  },
);

test(
  "two parallel actual native reads use unique attempts and preserve literal source geometry",
  { timeout: 180_000 },
  async (t) => {
    const shim = await createForwardingShim(t);
    const original = Buffer.from(sourceBytes);
    const input = {
      dockerPath: shim.path,
      dockerHost,
      imageId,
      sourceBytes,
      expectedSource,
      timeoutMilliseconds: 120_000,
    };
    const [first, second] = await Promise.all([
      runIsolatedNativeDrawingDwgReader(input),
      runIsolatedNativeDrawingDwgReader(input),
    ]);

    for (const report of [first, second]) {
      assert.deepEqual(report.source, expectedSource);
      assert.deepEqual(report.coverage, {
        modelSpaceEntities: 6,
        importedEntities: 5,
        unsupportedEntities: 1,
        nonModelSpaceEntities: 3,
      });
      assert.deepEqual(
        report.entities.map(
          ({ handle, ownerHandle, layerHandle, type, geometry }) => ({
            handle,
            ownerHandle,
            layerHandle,
            type,
            geometry,
          }),
        ),
        [
          {
            handle: "4A",
            ownerHandle: "40",
            layerHandle: "48",
            type: "LINE",
            geometry: { start: [0, 0, 0], end: [100, 0, 0] },
          },
          {
            handle: "4B",
            ownerHandle: "40",
            layerHandle: "48",
            type: "CIRCLE",
            geometry: { center: [25, 25, 0], radius: 10 },
          },
          {
            handle: "4C",
            ownerHandle: "40",
            layerHandle: "48",
            type: "ARC",
            geometry: {
              center: [50, 25, 0],
              radius: 12,
              startAngleRadians: 0.25,
              endAngleRadians: 2.5,
            },
          },
          {
            handle: "4D",
            ownerHandle: "40",
            layerHandle: "48",
            type: "LWPOLYLINE",
            geometry: {
              points: [
                [0, 10, 0],
                [15, 18, 0],
                [30, 10, 0],
                [0, 10, 0],
              ],
              closed: true,
            },
          },
          {
            handle: "4E",
            ownerHandle: "40",
            layerHandle: "49",
            type: "TEXT",
            geometry: {
              insert: [5, 40, 0],
              height: 2.5,
              text: "SYNTHETIC QA TEXT",
            },
          },
        ],
      );
      const projected = projectNativeDrawingDwgImport({
        report,
        expectedSource,
        revisionId: "93000000-0000-4000-8000-000000000001",
        canvasId: "93000000-0000-4000-8000-000000000002",
        sourceFileId: "93000000-0000-4000-8000-000000000003",
      });
      assert.equal(projected.objects.length, 5);
      assert.deepEqual(projected.objects[0].geometry, {
        type: "line",
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
      });
      assert.deepEqual(projected.objects[4].geometry, {
        type: "text",
        origin: { x: 5, y: 40 },
        width: 25.5,
        text: "SYNTHETIC QA TEXT",
      });
      assert.deepEqual(
        projected.objects.map(({ name }) => name),
        [
          "DWG LINE 4A",
          "DWG CIRCLE 4B",
          "DWG ARC 4C",
          "DWG LWPOLYLINE 4D",
          "DWG TEXT 4E",
        ],
      );
      assert.deepEqual(
        projected.bindings.map((binding, index) => ({
          linkedObject: binding.objectId === projected.objects[index].id,
          sourceFileId: binding.sourceFileId,
          sourceSha256: binding.sourceSha256,
          handle: binding.handle,
          ownerHandle: binding.ownerHandle,
          entityType: binding.entityType,
        })),
        [
          {
            linkedObject: true,
            sourceFileId: "93000000-0000-4000-8000-000000000003",
            sourceSha256: expectedSource.sha256,
            handle: "4A",
            ownerHandle: "40",
            entityType: "LINE",
          },
          {
            linkedObject: true,
            sourceFileId: "93000000-0000-4000-8000-000000000003",
            sourceSha256: expectedSource.sha256,
            handle: "4B",
            ownerHandle: "40",
            entityType: "CIRCLE",
          },
          {
            linkedObject: true,
            sourceFileId: "93000000-0000-4000-8000-000000000003",
            sourceSha256: expectedSource.sha256,
            handle: "4C",
            ownerHandle: "40",
            entityType: "ARC",
          },
          {
            linkedObject: true,
            sourceFileId: "93000000-0000-4000-8000-000000000003",
            sourceSha256: expectedSource.sha256,
            handle: "4D",
            ownerHandle: "40",
            entityType: "LWPOLYLINE",
          },
          {
            linkedObject: true,
            sourceFileId: "93000000-0000-4000-8000-000000000003",
            sourceSha256: expectedSource.sha256,
            handle: "4E",
            ownerHandle: "40",
            entityType: "TEXT",
          },
        ],
      );
    }
    assert.equal(sha256Of(original), expectedSource.sha256);
    assert.equal(sha256Of(sourceBytes), expectedSource.sha256);
    assert.deepEqual(sourceBytes, original);
    const reportSha256s = [first, second].map((report) =>
      sha256Of(Buffer.from(JSON.stringify(report), "utf8")),
    );
    assert.equal(reportSha256s[0], reportSha256s[1]);

    const attempts = await shim.attempts();
    assert.equal(attempts.length, 2);
    assert.notEqual(attempts[0], attempts[1]);
    for (const name of attempts) await assertContainerAbsent(name);
    t.diagnostic(
      JSON.stringify({
        imageId,
        source: expectedSource,
        parsedReportSha256: reportSha256s[0],
        attempts: attempts.length,
      }),
    );
  },
);

test(
  "actual process and cgroup state enforce the production sandbox profile",
  { timeout: 60_000 },
  async (t) => {
    const secretName = "NATIVE_DWG_INTEGRATION_SYNTHETIC_SECRET";
    const secretValue = `must-not-enter-${randomBytes(12).toString("hex")}`;
    const nonce = randomBytes(16).toString("hex");
    const probeScript = `
set +e
touch /.1hk-probe-root-write 2>/dev/null
printf 'ROOT_WRITE=%s\\n' "$?"
touch /tmp/.1hk-probe-tmp-write 2>/dev/null
printf 'TMP_WRITE=%s\\n' "$?"
if [ -e /Users ]; then printf 'HOST_USERS_VISIBLE=1\\n'; else printf 'HOST_USERS_VISIBLE=0\\n'; fi
printf 'STATUS_BEGIN\\n'; cat /proc/self/status; printf 'STATUS_END\\n'
printf 'MOUNTS_BEGIN\\n'; cat /proc/self/mountinfo; printf 'MOUNTS_END\\n'
printf 'NETDEV_BEGIN\\n'; cat /proc/net/dev; printf 'NETDEV_END\\n'
printf 'ROUTE_BEGIN\\n'; cat /proc/net/route; printf 'ROUTE_END\\n'
printf 'IPV6_ROUTE_BEGIN\\n'; cat /proc/net/ipv6_route; printf 'IPV6_ROUTE_END\\n'
printf 'ENV_BEGIN\\n'; env; printf 'ENV_END\\n'
printf 'MEMORY_MAX='; cat /sys/fs/cgroup/memory.max
printf 'CPU_MAX='; cat /sys/fs/cgroup/cpu.max
printf 'PIDS_MAX='; cat /sys/fs/cgroup/pids.max
rm -f /tmp/.1hk-probe-tmp-write
`;
    const owned = await createFromProductionProfile({
      nonce,
      milliseconds: 10_000,
      command: ["--signal=KILL", "10s", "/bin/sh", "-c", probeScript],
    });
    try {
      const receipt = owned.receipt;
      assert.equal(receipt.HostConfig.ReadonlyRootfs, true);
      assert.equal(receipt.HostConfig.NetworkMode, "none");
      assert.deepEqual(receipt.HostConfig.Binds, null);
      assert.deepEqual(receipt.HostConfig.Devices, []);
      assert.deepEqual(receipt.Mounts, []);
      assert.deepEqual(receipt.Config.Volumes, null);
      assert.deepEqual(receipt.HostConfig.Tmpfs, {
        "/tmp": "rw,noexec,nosuid,nodev,size=16777216",
      });

      const started = await dockerCall(["start", "--attach", owned.id], {
        timeoutMilliseconds: 20_000,
        environment: { [secretName]: secretValue },
      });
      assert.equal(started.code, 0, started.stderr.toString("utf8"));
      const output = started.stdout.toString("utf8");
      assert.match(output, /ROOT_WRITE=[1-9][0-9]*/);
      assert.match(output, /TMP_WRITE=0/);
      assert.match(output, /HOST_USERS_VISIBLE=0/);

      const status = section(output, "STATUS");
      assert.match(status, /^Uid:\s+65532\s+65532\s+65532\s+65532$/m);
      assert.match(status, /^Gid:\s+65532\s+65532\s+65532\s+65532$/m);
      assert.match(status, /^NoNewPrivs:\s+1$/m);
      assert.match(status, /^Seccomp:\s+2$/m);
      for (const capability of [
        "CapInh",
        "CapPrm",
        "CapEff",
        "CapBnd",
        "CapAmb",
      ])
        assert.match(status, new RegExp(`^${capability}:\\s+0{16}$`, "m"));

      const mounts = section(output, "MOUNTS");
      assert.equal(mounts.includes("/Users"), false);
      assert.equal(mounts.includes("docker.sock"), false);
      assert.equal(mounts.includes("/var/run/docker"), false);
      const interfaces = section(output, "NETDEV")
        .split("\n")
        .slice(2)
        .map((line) => line.split(":", 1)[0].trim())
        .filter(Boolean);
      assert.deepEqual(interfaces, ["lo"]);
      assert.equal(section(output, "ROUTE").trim().split("\n").length, 1);
      const ipv6Routes = section(output, "IPV6_ROUTE")
        .trim()
        .split("\n")
        .filter(Boolean);
      assert.ok(
        ipv6Routes.every((line) => line.trim().split(/\s+/).at(-1) === "lo"),
      );
      const environment = section(output, "ENV");
      assert.equal(environment.includes(secretName), false);
      assert.equal(environment.includes(secretValue), false);
      assert.match(output, /^MEMORY_MAX=1073741824$/m);
      assert.match(output, /^PIDS_MAX=64$/m);
      const cpu = output.match(/^CPU_MAX=(\d+) (\d+)$/m);
      assert.ok(cpu);
      assert.equal(Number(cpu[1]) / Number(cpu[2]), 1);
      t.diagnostic(
        JSON.stringify({
          uid: 65_532,
          gid: 65_532,
          noNewPrivileges: 1,
          seccompMode: 2,
          capabilitiesHex: "0000000000000000",
          rootWrite: "failed",
          tmpWrite: "succeeded",
          hostUsersVisible: false,
          interfaces,
          ipv4RouteRows: 0,
          memoryMax: 1_073_741_824,
          cpuMax: {
            quota: Number(cpu[1]),
            period: Number(cpu[2]),
            ratio: Number(cpu[1]) / Number(cpu[2]),
          },
          pidsMax: 64,
          inheritedSyntheticSecret: false,
        }),
      );
    } finally {
      await removeOwnedTestContainer(owned);
    }
  },
);

test(
  "the image entrypoint kills a finite sleeper at the inner deadline",
  { timeout: 20_000 },
  async () => {
    const owned = await createFromProductionProfile({
      nonce: randomBytes(16).toString("hex"),
      milliseconds: 1_000,
      command: ["--signal=KILL", "1s", "/bin/sleep", "30"],
    });
    try {
      const startedAt = performance.now();
      const result = await dockerCall(["start", "--attach", owned.id], {
        timeoutMilliseconds: 8_000,
      });
      const elapsed = performance.now() - startedAt;
      assert.equal(result.code, 137);
      assert.ok(elapsed >= 800 && elapsed < 7_000, `elapsed ${elapsed}ms`);
      const receipt = await inspectContainer(owned.id);
      assert.equal(receipt.State.Status, "exited");
      assert.equal(receipt.State.ExitCode, 137);
      assert.equal(receipt.State.OOMKilled, false);
    } finally {
      await removeOwnedTestContainer(owned);
    }
  },
);

test(
  "invalid native input and caller abort remove only their exact owned attempts",
  { timeout: 90_000 },
  async (t) => {
    const sentinelNonce = randomBytes(16).toString("hex");
    const sentinelName = `1hk-dwg-unrelated-${sentinelNonce}`;
    const sentinelLabel = "org.1hk.native-dwg-reader.integration-sentinel";
    const sentinelId = (
      await successfulDockerCall([
        "create",
        "--pull",
        "never",
        "--name",
        sentinelName,
        "--label",
        `${sentinelLabel}=${sentinelNonce}`,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges=true",
        "--entrypoint",
        "/bin/true",
        imageId,
      ])
    )
      .toString("utf8")
      .trim();
    const sentinel = {
      id: sentinelId,
      image: imageId,
      name: sentinelName,
      label: sentinelLabel,
      nonce: sentinelNonce,
    };
    t.after(async () => {
      const stillPresent = await dockerCall([
        "container",
        "inspect",
        sentinelId,
      ]);
      if (stillPresent.code === 0) await removeOwnedTestContainer(sentinel);
    });

    const invalidShim = await createForwardingShim(t);
    const invalidBytes = Buffer.from("AC1024not-a-valid-native-dwg", "ascii");
    const invalidExpected = {
      sha256: sha256Of(invalidBytes),
      byteSize: invalidBytes.byteLength,
      headerVersion: "AC1024",
    };
    await assert.rejects(
      runIsolatedNativeDrawingDwgReader({
        dockerPath: invalidShim.path,
        dockerHost,
        imageId,
        sourceBytes: invalidBytes,
        expectedSource: invalidExpected,
        timeoutMilliseconds: 30_000,
      }),
      { message: "Isolated native DWG read failed." },
    );
    const invalidAttempts = await invalidShim.attempts();
    assert.equal(invalidAttempts.length, 1);
    await assertContainerAbsent(invalidAttempts[0]);
    assert.equal((await inspectContainer(sentinelId)).Id, sentinelId);

    const abortShim = await createForwardingShim(t, {
      coordinateAbort: true,
    });
    const controller = new AbortController();
    const pending = runIsolatedNativeDrawingDwgReader({
      dockerPath: abortShim.path,
      dockerHost,
      imageId,
      sourceBytes,
      expectedSource,
      signal: controller.signal,
      timeoutMilliseconds: 30_000,
    });
    await waitUntil(() =>
      access(abortShim.startedPath, constants.F_OK).then(
        () => true,
        () => false,
      ),
    );
    const abortAttempts = await abortShim.attempts();
    assert.equal(abortAttempts.length, 1);
    const running = await inspectContainer(abortAttempts[0]);
    assert.equal(running.State.Running, true);
    controller.abort();
    await assert.rejects(pending, {
      message: "Isolated native DWG read failed.",
    });
    await assertContainerAbsent(abortAttempts[0]);
    assert.equal((await inspectContainer(sentinelId)).Id, sentinelId);
  },
);
