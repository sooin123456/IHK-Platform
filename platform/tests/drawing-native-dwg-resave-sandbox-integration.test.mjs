import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { before, after, test } from "node:test";
import {
  applyDrawingCommand,
  createDrawingDocumentState,
} from "../app/lukas/lib/drawing-commands.ts";
import { projectNativeDrawingDwgImport } from "../app/lukas/lib/drawing-native-dwg-import.server.ts";
import { buildNativeDrawingDwgSelectedEdits } from "../app/lukas/lib/drawing-native-dwg-selected-edits.server.ts";
import {
  nativeDwgResaveSandboxCreateArguments,
  runIsolatedNativeDrawingDwgReader,
  runIsolatedNativeDrawingDwgResaver,
} from "../app/lukas/lib/drawing-native-dwg-sandbox.server.ts";
import { runNativeDwgProcess } from "../app/lukas/lib/drawing-native-dwg-worker.server.ts";

// Actual Docker/native tests. The forwarding shim records real daemon receipts;
// it never invents native output or container policy. Evidence is retained only
// in the explicitly supplied private directory, which must not already exist.
const label = "org.1hk.native-dwg-resaver.attempt";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const required = (name) => {
  assert.ok(
    process.env[name],
    `Required actual resave prerequisite unavailable: ${name}`,
  );
  return process.env[name];
};
let dockerPath,
  dockerHost,
  imageId,
  root,
  config,
  engineDll,
  dotnetPath,
  sourceBytes,
  expectedSource,
  baseInput,
  requestBytes;
const identity = {
  revisionId: "95000000-0000-4000-8000-000000000001",
  canvasId: "95000000-0000-4000-8000-000000000002",
  sourceFileId: "95000000-0000-4000-8000-000000000003",
};
const actorId = "95000000-0000-4000-8000-000000000004";
const jsonFile = async (path) => JSON.parse(await readFile(path, "utf8"));
const saveJson = (name, value) =>
  writeFile(join(root, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
  });

function docker(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      dockerPath,
      ["--config", config, "--host", dockerHost, ...args],
      {
        env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      },
    );
    const out = [],
      err = [];
    let size = 0,
      failure;
    const fail = (error) => {
      failure = error;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(
      () => fail(new Error("Actual Docker deadline")),
      30000,
    );
    for (const [stream, chunks] of [
      [child.stdout, out],
      [child.stderr, err],
    ])
      stream.on("data", (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024)
          fail(new Error("Actual Docker output overflow"));
        else chunks.push(chunk);
      });
    child.once("error", fail);
    child.stdin.once("error", fail);
    child.stdin.end(input);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else
        resolve({
          code,
          signal,
          stdout: Buffer.concat(out),
          stderr: Buffer.concat(err),
        });
    });
  });
}
async function ok(args, input) {
  const r = await docker(args, input);
  assert.equal(r.code, 0, r.stderr.toString());
  assert.equal(r.signal, null);
  return r.stdout;
}
async function inspect(id) {
  return JSON.parse((await ok(["container", "inspect", id])).toString())[0];
}
async function absent(name) {
  assert.match(name, /^1hk-dwg-resave-[0-9a-f]{32}$/);
  const names = (
    await ok([
      "container",
      "ls",
      "--all",
      "--no-trunc",
      "--filter",
      `name=^/${name}$`,
      "--format",
      "{{.Names}}",
    ])
  )
    .toString()
    .trim();
  assert.equal(names, "");
}
async function removeOwned(owned) {
  const r = await inspect(owned.id);
  assert.equal(r.Name, `/${owned.name}`);
  assert.equal(r.Image, imageId);
  assert.equal(r.Config.Labels[label], owned.nonce);
  assert.equal(
    (await ok(["rm", "--force", owned.id])).toString().trim(),
    owned.id,
  );
}
async function native(args) {
  return runNativeDwgProcess(dotnetPath, [engineDll, ...args], {
    timeoutMilliseconds: 120000,
    maxOutputBytes: 65536,
    signal: new AbortController().signal,
    env: { LANG: "C", LC_ALL: "C" },
  });
}
async function shim(name, coordinate = false) {
  const path = join(root, `${name}-docker`),
    log = join(root, `${name}-calls.jsonl`),
    marker = join(root, `${name}-running`);
  // All policy and lifecycle actions below go through the actual Docker CLI.
  const script = `#!${process.execPath}
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const actual=${JSON.stringify(dockerPath)},args=process.argv.slice(2),log=${JSON.stringify(log)},marker=${JSON.stringify(marker)};
const op=args[4],id=args.at(-1),common=args.slice(0,4);
const call=(a,stdio='pipe')=>spawnSync(actual,a,{stdio,env:process.env,timeout:30000});
fs.appendFileSync(log,JSON.stringify({args})+'\\n');
if(op==='start'){
 const pre=call([...common,'container','inspect',id]);if(pre.status!==0)process.exit(71);
 fs.writeFileSync(${JSON.stringify(join(root, name + "-before.json"))},pre.stdout);
 if(${coordinate}){const s=call([...common,'start',id]);if(s.status!==0)process.exit(72);fs.writeFileSync(marker,id);await new Promise(resolve=>setTimeout(resolve,5000));}
 const r=call(${coordinate}?[...common,'attach',id]:args,'inherit');
 const post=call([...common,'container','inspect',id]);if(post.status===0)fs.writeFileSync(${JSON.stringify(join(root, name + "-after.json"))},post.stdout);
 process.exit(r.status??73);
}
const r=call(args,'inherit');process.exit(r.status??74);
`;
  await writeFile(path, script, { flag: "wx" });
  await chmod(path, 0o700);
  return {
    path,
    marker,
    async names() {
      const lines = (await readFile(log, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
      return lines
        .filter((l) => l.args[4] === "create")
        .map((l) => l.args[l.args.indexOf("--name") + 1]);
    },
  };
}

before(
  async () => {
    dockerPath = required("NATIVE_DWG_DOCKER_PATH");
    dockerHost = required("NATIVE_DWG_DOCKER_HOST");
    imageId = required("NATIVE_DWG_RESAVER_IMAGE_ID");
    root = required("NATIVE_DWG_RESAVE_SANDBOX_EVIDENCE_DIRECTORY");
    engineDll = required("NATIVE_DWG_RESAVE_TEST_ENGINE_DLL");
    dotnetPath = required("NATIVE_DWG_DOTNET_PATH");
    for (const path of [dockerPath, root, engineDll, dotnetPath])
      assert.ok(isAbsolute(path));
    assert.match(imageId, /^sha256:[0-9a-f]{64}$/);
    assert.match(dockerHost, /^unix:\/\/\//);
    assert.ok((await stat(dockerHost.slice(7))).isSocket());
    await mkdir(root);
    config = await mkdtemp(join(root, "empty-config-"));
    const image = JSON.parse(
      (await ok(["image", "inspect", imageId])).toString(),
    )[0];
    assert.equal(
      image.Config.Labels["org.1hk.native-dwg-resaver.protocol"],
      "1hk-dwg-resave/1",
    );
    assert.equal(
      image.Config.Labels["org.1hk.native-dwg-reader.protocol"],
      "1hk-dwg-import/1",
    );
    await saveJson("image.json", image);
    await native([
      "create-generated-fixture",
      "--output-dir",
      join(root, "source"),
    ]);
    sourceBytes = await readFile(join(root, "source", "synthetic-input.dwg"));
    expectedSource = {
      sha256: sha(sourceBytes),
      byteSize: sourceBytes.length,
      headerVersion: "AC1024",
    };
    baseInput = {
      dockerPath,
      dockerHost,
      imageId,
      sourceBytes,
      expectedSource,
      timeoutMilliseconds: 120000,
    };
  },
  { timeout: 180000 },
);
after(async () => {
  if (config) await rmdir(config);
});

test(
  "actual resaver 2GiB cgroup enforces no mounts/network/capabilities and deadline",
  { timeout: 60000 },
  async () => {
    const nonce = randomBytes(16).toString("hex"),
      name = `1hk-dwg-resave-${nonce}`;
    const args = nativeDwgResaveSandboxCreateArguments({
      imageId,
      nonce,
      timeoutMilliseconds: 10000,
    });
    const command = `printf 'MEMORY=';cat /sys/fs/cgroup/memory.max;printf 'SWAP=';cat /sys/fs/cgroup/memory.swap.max;printf 'CPU=';cat /sys/fs/cgroup/cpu.max;printf 'PIDS=';cat /sys/fs/cgroup/pids.max;cat /proc/self/status;cat /proc/net/dev;cat /proc/net/route;cat /proc/self/mountinfo;env;touch /.probe 2>/dev/null;printf 'ROOT_WRITE=%s\\n' "$?";touch /tmp/probe;printf 'TMP_WRITE=%s\\n' "$?";test -e /Users;printf 'HOST_USERS=%s\\n' "$?"`;
    const id = (
      await ok([
        ...args.slice(0, args.indexOf(imageId) + 1),
        "--signal=KILL",
        "10s",
        "/bin/sh",
        "-c",
        command,
      ])
    )
      .toString()
      .trim();
    const owned = { id, name, nonce };
    try {
      const receipt = await inspect(id);
      assert.deepEqual(receipt.Mounts, []);
      assert.equal(receipt.HostConfig.NetworkMode, "none");
      assert.equal(receipt.HostConfig.ReadonlyRootfs, true);
      assert.deepEqual(receipt.HostConfig.CapDrop, ["ALL"]);
      assert.equal(receipt.HostConfig.Memory, 2147483648);
      assert.equal(receipt.HostConfig.MemorySwap, 2147483648);
      const output = (await ok(["start", "--attach", id])).toString();
      await writeFile(join(root, "cgroup-probe.txt"), output, { flag: "wx" });
      await saveJson("cgroup-receipt.json", receipt);
      assert.match(output, /MEMORY=2147483648\n/);
      assert.match(output, /SWAP=0\n/);
      assert.match(output, /CPU=100000 100000\n/);
      assert.match(output, /PIDS=64\n/);
      assert.match(output, /^Uid:\s+65532\s+65532\s+65532\s+65532$/m);
      assert.match(output, /^NoNewPrivs:\s+1$/m);
      assert.match(output, /^Seccomp:\s+2$/m);
      for (const cap of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"])
        assert.match(output, new RegExp(`^${cap}:\\s+0+$`, "m"));
      assert.doesNotMatch(output, /eth0|en0|SECRET|SUPABASE/);
      assert.match(output, /ROOT_WRITE=[1-9]/);
      assert.match(output, /TMP_WRITE=0/);
      assert.match(output, /HOST_USERS=1/);
      assert.match(output, /\/tmp rw,nosuid,nodev,noexec/);
    } finally {
      await removeOwned(owned);
    }
    await absent(name);
    const timerNonce = randomBytes(16).toString("hex"),
      timerName = `1hk-dwg-resave-${timerNonce}`;
    const timerArgs = nativeDwgResaveSandboxCreateArguments({
      imageId,
      nonce: timerNonce,
      timeoutMilliseconds: 1000,
    });
    const timerId = (
      await ok([
        ...timerArgs.slice(0, timerArgs.indexOf(imageId) + 1),
        "--signal=KILL",
        "1s",
        "/bin/sleep",
        "30",
      ])
    )
      .toString()
      .trim();
    try {
      const started = Date.now();
      const r = await docker(["start", "--attach", timerId]);
      assert.equal(r.code, 137);
      assert.ok(Date.now() - started < 7000);
      assert.equal((await inspect(timerId)).State.OOMKilled, false);
    } finally {
      await removeOwned({ id: timerId, name: timerName, nonce: timerNonce });
    }
    await absent(timerName);
  },
);

test(
  "actual compiler edits five literal geometries through isolated resave and readback with untouched inventory",
  { timeout: 240000 },
  async (t) => {
    const before = await runIsolatedNativeDrawingDwgReader(baseInput);
    assert.equal(before.unitCode, 4);
    assert.equal(before.source.headerVersion, "AC1024");
    const importInput = { report: before, expectedSource, ...identity };
    const projected = projectNativeDrawingDwgImport(importInput);
    const geometry = {
      LINE: { type: "line", start: { x: 10, y: 11 }, end: { x: 120, y: 21 } },
      CIRCLE: { type: "circle", center: { x: 12, y: 14 }, radius: 7 },
      ARC: {
        type: "arc",
        semanticVersion: 1,
        center: { x: 45, y: 30 },
        radius: 9,
        startAngleDegrees: 300,
        sweepAngleDegrees: 90,
      },
      LWPOLYLINE: {
        type: "polyline",
        points: [
          { x: 1, y: 12 },
          { x: 16, y: 20 },
          { x: 31, y: 12 },
          { x: 1, y: 12 },
        ],
        closed: false,
      },
    };
    const updates = projected.objects.map((object) => {
      const type = projected.bindings.find(
        (b) => b.objectId === object.id,
      ).entityType;
      return {
        objectId: object.id,
        baseVersion: object.version,
        patch:
          type === "TEXT"
            ? {
                geometry: {
                  ...object.geometry,
                  origin: { x: 8, y: 42 },
                  text: "수정된 실명",
                },
                style: { ...object.style, fontSize: 3.25 },
              }
            : { geometry: geometry[type] },
      };
    });
    const state = createDrawingDocumentState({
      revisionId: identity.revisionId,
      objects: projected.objects,
      layers: projected.layers,
    });
    const applied = applyDrawingCommand(
      state,
      { type: "update_objects", actorId, updates },
      {
        createId: () => "95000000-0000-4000-8000-000000000005",
        now: () => "2026-09-06T00:00:00.000Z",
      },
    );
    const compiled = buildNativeDrawingDwgSelectedEdits({
      importInput,
      objects: Object.values(applied.state.objects),
    });
    assert.deepEqual(
      compiled.request.edits.map(({ handle, type }) => ({ handle, type })),
      [
        { handle: "4A", type: "LINE" },
        { handle: "4B", type: "CIRCLE" },
        { handle: "4C", type: "ARC" },
        { handle: "4D", type: "LWPOLYLINE" },
        { handle: "4E", type: "TEXT" },
      ],
    );
    requestBytes = Buffer.from(JSON.stringify(compiled.request));
    await writeFile(join(root, "request.json"), requestBytes, { flag: "wx" });
    const forwarded = await shim("success");
    const result = await runIsolatedNativeDrawingDwgResaver({
      ...baseInput,
      dockerPath: forwarded.path,
      requestBytes,
      expectedRequestSha256: sha(requestBytes),
    });
    assert.deepEqual(result.report.request, {
      schemaVersion: "1hk-dwg-edits/2",
      sha256: sha(requestBytes),
      byteSize: requestBytes.length,
      handles: ["4A", "4B", "4C", "4D", "4E"],
    });
    assert.deepEqual(result.report.source, expectedSource);
    assert.equal(result.report.output.sha256, sha(result.dwgBytes));
    assert.equal(result.report.output.byteSize, result.dwgBytes.length);
    assert.equal(result.report.output.headerVersion, "AC1024");
    assert.deepEqual(result.report.verification, {
      noEditRoundTrip: "passed",
      selectedEditRoundTrip: "passed",
      geometryTolerance: 1e-9,
      inventoriedEntityCount: 9,
      editedEntityCount: 5,
      inventoryCoverage: "supported-fields-only",
      independentCad: "not-performed",
    });
    assert.deepEqual(JSON.parse(result.reportBytes.toString()), result.report);
    await writeFile(join(root, "report.json"), result.reportBytes, {
      flag: "wx",
    });
    await writeFile(join(root, "resaved.dwg"), result.dwgBytes, { flag: "wx" });
    const after = await runIsolatedNativeDrawingDwgReader({
      ...baseInput,
      sourceBytes: result.dwgBytes,
      expectedSource: result.report.output,
    });
    assert.equal(after.unitCode, 4);
    assert.deepEqual(after.layers, before.layers);
    assert.deepEqual(after.coverage, before.coverage);
    assert.deepEqual(after.unsupported, before.unsupported);
    const entity = (type) => after.entities.find((e) => e.type === type);
    assert.deepEqual(entity("LINE").geometry, {
      start: [10, 11, 0],
      end: [120, 21, 0],
    });
    assert.deepEqual(entity("CIRCLE").geometry, {
      center: [12, 14, 0],
      radius: 7,
    });
    assert.deepEqual(entity("LWPOLYLINE").geometry, {
      points: [
        [1, 12, 0],
        [16, 20, 0],
        [31, 12, 0],
        [1, 12, 0],
      ],
      closed: false,
    });
    assert.deepEqual(entity("TEXT").geometry, {
      insert: [8, 42, 0],
      height: 3.25,
      text: "수정된 실명",
    });
    assert.deepEqual(entity("ARC").geometry.center, [45, 30, 0]);
    assert.equal(entity("ARC").geometry.radius, 9);
    assert.ok(
      Math.abs(entity("ARC").geometry.startAngleRadians - 5.235987755982989) <=
        1e-9,
    );
    assert.ok(
      Math.abs(entity("ARC").geometry.endAngleRadians - 6.806784082777885) <=
        1e-9,
    );
    const ids = (report) =>
      report.entities.map(({ handle, ownerHandle, layerHandle, type }) => ({
        handle,
        ownerHandle,
        layerHandle,
        type,
      }));
    assert.deepEqual(ids(after), ids(before));
    // Passive native inventories include default paper VIEWPORT and block
    // children that the editable reader intentionally does not project.
    for (const [name, path] of [
      ["source", join(root, "source", "synthetic-input.dwg")],
      ["resaved", join(root, "resaved.dwg")],
    ])
      await native([
        "qualify",
        "--input",
        path,
        "--output-dir",
        join(root, `${name}-inventory`),
      ]);
    const baseline = (
      await jsonFile(
        join(root, "source-inventory", "qualification-report.json"),
      )
    ).baselineInventory;
    const output = (
      await jsonFile(
        join(root, "resaved-inventory", "qualification-report.json"),
      )
    ).baselineInventory;
    const selected = new Set(["4A", "4B", "4C", "4D", "4E"]);
    const untouched = (inventory) =>
      inventory.entities.filter((e) => !selected.has(e.handle));
    assert.deepEqual(untouched(output), untouched(baseline));
    assert.deepEqual(
      untouched(output).map(({ handle, type, owner }) => ({
        handle,
        type,
        owner,
      })),
      [
        { handle: "47", type: "VIEWPORT", owner: "44" },
        { handle: "52", type: "LINE", owner: "4F" },
        { handle: "53", type: "CIRCLE", owner: "4F" },
        { handle: "54", type: "INSERT", owner: "40" },
      ],
    );
    assert.equal(
      untouched(output)[1].geometry,
      "start=0,0,0;end=8,0,0;thickness=0;normal=0,0,1",
    );
    assert.equal(
      untouched(output)[2].geometry,
      "center=4,4,0;radius=2;thickness=0;normal=0,0,1",
    );
    assert.match(
      untouched(output)[0].geometry,
      /^center=148\.5,105,0;width=297;height=210;/,
    );
    assert.deepEqual(
      { ...output, entities: [] },
      { ...baseline, entities: [] },
    );
    assert.equal(sha(sourceBytes), expectedSource.sha256);
    assert.equal(
      sha(await readFile(join(root, "source", "synthetic-input.dwg"))),
      expectedSource.sha256,
    );
    for (const name of await forwarded.names()) await absent(name);
    for (const phase of ["before", "after"]) {
      const r = (await jsonFile(join(root, `success-${phase}.json`)))[0];
      assert.equal(r.HostConfig.Memory, 2147483648);
      assert.equal(r.HostConfig.MemorySwap, 2147483648);
      assert.deepEqual(r.Mounts, []);
      assert.equal(r.Config.Cmd.at(-1), "resave-native-stdio");
      assert.equal(r.State.Status, phase === "before" ? "created" : "exited");
    }
    const summary = {
      imageId,
      source: expectedSource,
      requestSha256: sha(requestBytes),
      reportSha256: sha(result.reportBytes),
      outputSha256: sha(result.dwgBytes),
      qualification: "experimental-unqualified",
      persistenceAuthority: "not-issued",
      independentCad: "not-performed",
      inventoryCoverage: "supported-fields-only",
      ownedCleanup: true,
    };
    await saveJson("summary.json", summary);
    t.diagnostic(JSON.stringify(summary));
  },
);

test(
  "actual invalid geometry, raw invalid stream, source mismatch, cancellation and deadline clean owned attempts and preserve foreign container",
  { timeout: 120000 },
  async () => {
    const nonce = randomBytes(16).toString("hex"),
      name = `1hk-dwg-resave-${nonce}`;
    const args = nativeDwgResaveSandboxCreateArguments({
      imageId,
      nonce,
      timeoutMilliseconds: 30000,
    });
    const id = (await ok(args)).toString().trim();
    const sentinel = { id, name, nonce };
    try {
      const raw = await docker(
        ["start", "--attach", "--interactive", id],
        Buffer.from("invalid stream"),
      );
      assert.notEqual(raw.code, 0);
      assert.equal(raw.stdout.length, 0);
      assert.equal(raw.stderr.toString(), "native stream resave failed.\n");
      for (const mode of ["invalid", "mismatch", "abort", "deadline"]) {
        const forwarded = await shim(
          mode,
          mode === "abort" || mode === "deadline",
        );
        const controller = new AbortController();
        const bytes = Buffer.from(
          JSON.stringify({
            schemaVersion: "1hk-dwg-edits/2",
            sourceSha256:
              mode === "mismatch" ? "0".repeat(64) : expectedSource.sha256,
            coordinateSystem: "WCS_NATIVE_UNITS",
            edits: [
              { handle: "4A", type: "LINE", start: [0, 0, 0], end: [0, 0, 0] },
            ],
          }),
        );
        const input = {
          ...baseInput,
          dockerPath: forwarded.path,
          requestBytes:
            mode === "abort" || mode === "deadline" ? requestBytes : bytes,
          expectedRequestSha256: sha(
            mode === "abort" || mode === "deadline" ? requestBytes : bytes,
          ),
          signal: controller.signal,
          timeoutMilliseconds: mode === "deadline" ? 3000 : 30000,
        };
        const started = Date.now();
        const pending = assert.rejects(
          runIsolatedNativeDrawingDwgResaver(input),
          { message: "Isolated native DWG resave failed." },
        );
        if (mode === "abort" || mode === "deadline") {
          const end = Date.now() + 5000;
          while (
            !(await access(forwarded.marker).then(
              () => true,
              () => false,
            ))
          ) {
            assert.ok(Date.now() < end);
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          const runningId = await readFile(forwarded.marker, "utf8");
          assert.equal((await inspect(runningId)).State.Running, true);
          if (mode === "abort") controller.abort();
        }
        await pending;
        if (mode === "deadline") assert.ok(Date.now() - started < 8000);
        const names = await forwarded.names();
        assert.equal(names.length, mode === "mismatch" ? 0 : 1);
        for (const ownedName of names) await absent(ownedName);
        assert.equal((await inspect(id)).Id, id);
      }
    } finally {
      await removeOwned(sentinel);
    }
    await absent(name);
  },
);
