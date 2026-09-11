import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  attachNativeDwgCanonicalPipelineEvidence,
  createDockerForwardingShimScript,
  stopNativeDwgImportPipelineWorker,
} from "./fixtures/drawing-native-dwg-import-pipeline.mjs";

async function run(path, args = []) {
  return await new Promise((resolve, reject) => {
    const child = spawn(path, args, {
      env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.once("error", reject);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("exit", (code, signal) =>
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}

async function startedChild(t, source) {
  const child = spawn(process.execPath, ["-e", source], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    let timer;
    try {
      await Promise.race([
        exit.catch(() => undefined),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("fixture child cleanup did not finish")),
            2_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("fixture child did not start")),
      2_000,
    );
    child.stdout.once("data", () => {
      clearTimeout(timer);
      resolve();
    });
    child.once("error", reject);
  });
  return { child, exit };
}

test("Docker forwarding shim preserves executable and tracker paths containing shell metacharacters", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "native-$-`-'-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, "actual $HOME `uname` ' docker");
  const shim = join(root, "forwarder");
  const namePath = join(root, "name $HOME `uname` '.txt");
  const configPath = join(root, "config $HOME `uname` '.txt");
  await writeFile(executable, "#!/bin/sh\nprintf '<%s>\\n' \"$@\"\n", {
    mode: 0o700,
  });
  await writeFile(
    shim,
    createDockerForwardingShimScript({
      dockerPath: executable,
      containerNamePath: namePath,
      configPath,
    }),
    { mode: 0o700 },
  );
  await chmod(shim, 0o700);

  const result = await run(shim, [
    "--config",
    "/tmp/private $HOME `uname` config",
    "container",
    "create",
    "--name",
    "1hk-dwg-read-0123456789abcdef0123456789abcdef",
  ]);

  assert.deepEqual(result, {
    code: 0,
    signal: null,
    stdout:
      "<--config>\n</tmp/private $HOME `uname` config>\n<container>\n<create>\n<--name>\n<1hk-dwg-read-0123456789abcdef0123456789abcdef>\n",
    stderr: "",
  });
  assert.equal(
    await readFile(namePath, "utf8"),
    "1hk-dwg-read-0123456789abcdef0123456789abcdef\n",
  );
  assert.equal(
    await readFile(configPath, "utf8"),
    "/tmp/private $HOME `uname` config\n",
  );
});

test("worker cleanup allows the production SIGTERM lifecycle to finish", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "native-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const marker = join(root, "graceful");
  const { child, exit } = await startedChild(
    t,
    `const fs=require("node:fs");process.on("SIGTERM",()=>{fs.writeFileSync(${JSON.stringify(marker)},"yes");process.exit(0)});process.stdout.write("ready");setInterval(()=>{},1000)`,
  );

  const result = await stopNativeDwgImportPipelineWorker({
    child,
    childExit: exit,
    gracefulMilliseconds: 1_000,
    forceMilliseconds: 1_000,
    cleanupOwnedParserAttempt: async () => {},
  });

  assert.deepEqual(result, { forced: false });
  assert.equal(await readFile(marker, "utf8"), "yes");
});

test("worker cleanup force-stops a resistant child before narrowly cleaning its owned residue", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "native-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const residue = join(root, "owned-parser-residue");
  await writeFile(residue, "owned");
  const { child, exit } = await startedChild(
    t,
    'process.on("SIGTERM",()=>{});process.stdout.write("ready");setInterval(()=>{},1000)',
  );

  const result = await stopNativeDwgImportPipelineWorker({
    child,
    childExit: exit,
    gracefulMilliseconds: 50,
    forceMilliseconds: 1_000,
    cleanupOwnedParserAttempt: () => rm(residue),
  });

  assert.deepEqual(result, { forced: true });
  await assert.rejects(access(residue));
});

test("optional canonical callback preserves default evidence and nests its separate proof", async () => {
  const analysisEvidence = {
    status: "analyzed",
    persistenceAuthority: "not-issued",
  };
  const context = { jobId: crypto.randomUUID() };

  assert.equal(
    await attachNativeDwgCanonicalPipelineEvidence(
      analysisEvidence,
      undefined,
      context,
    ),
    analysisEvidence,
  );
  assert.deepEqual(
    await attachNativeDwgCanonicalPipelineEvidence(
      analysisEvidence,
      async (received) => ({
        jobId: received.jobId,
        persistenceAuthority: "operation-attested",
      }),
      context,
    ),
    {
      ...analysisEvidence,
      canonicalProof: {
        jobId: context.jobId,
        persistenceAuthority: "operation-attested",
      },
    },
  );
  assert.equal(analysisEvidence.persistenceAuthority, "not-issued");
});
