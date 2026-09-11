import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  chmod,
  constants,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  getNativeDrawingDwgImportResult,
  getNativeDrawingDwgImportStatus,
  requestNativeDrawingDwgImport,
} from "../../app/lukas/lib/drawing-native-dwg-import-jobs.server.ts";

const SOURCE_SHA256 =
  "5c287281fafa07f76a0158d5374dd7577910c107dcb55817688acf9fd8656c71";
const REPORT_SHA256 =
  "c01a5e9ebae2460de8781e90dda68a47dc8e3bf3a869d8be188d34adebc783cf";
const SOURCE_BYTE_SIZE = 10_987;
const REPORT_BYTE_SIZE = 1_446;
const SOURCE_HEADER = "AC1024";
const ATTEMPT_LABEL = "org.1hk.native-dwg-reader.attempt";
const TRANSPORT_QUALIFICATION =
  "loopback-test-bridge-not-real-postgrest-jwt-or-supabase-storage";
const sourceUrl = new URL(
  "../../../docs/superpowers/evidence/2026-09-06-native-dwg-import-projection/accepted-code/synthetic-source.dwg",
  import.meta.url,
);
const reportUrl = new URL(
  "../../../docs/superpowers/evidence/2026-09-06-native-dwg-import-projection/accepted-code/native-import.json",
  import.meta.url,
);
const workerUrl = new URL(
  "../../native-dwg-worker/src/import.ts",
  import.meta.url,
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const session = (sql, role, actor, callback) =>
  sql.begin(async (tx) => {
    await tx.unsafe(`set local role "${role}"`);
    await tx`select set_config('request.jwt.claims',${JSON.stringify({ role, sub: actor, is_anonymous: false })},true)`;
    return callback(tx);
  });

const serviceRpc = (sql, name, args) =>
  session(sql, "service_role", null, async (tx) => {
    if (name === "lukas_drawing_claim_native_dwg_import") {
      const [row] =
        await tx`select public.lukas_drawing_claim_native_dwg_import(${args.p_reader_image_id},${args.p_lease_seconds}::integer) value`;
      return row.value;
    }
    if (name === "lukas_drawing_complete_native_dwg_import") {
      const [row] =
        await tx`select public.lukas_drawing_complete_native_dwg_import(
        ${args.p_job_id}::uuid,${args.p_attempt_number}::integer,
        ${args.p_lease_token}::uuid,${args.p_reader_image_id},
        ${args.p_report_text},${args.p_report_sha256}
      ) value`;
      return row.value;
    }
    if (name === "lukas_drawing_fail_native_dwg_import") {
      const [row] = await tx`select public.lukas_drawing_fail_native_dwg_import(
        ${args.p_job_id}::uuid,${args.p_attempt_number}::integer,
        ${args.p_lease_token}::uuid,${args.p_failure_code},${args.p_retryable}
      ) value`;
      return row.value;
    }
    assert.fail(`Unsupported service fixture RPC: ${name}`);
  });

const actorRpc = (sql, actor, name, args) =>
  session(sql, "authenticated", actor, async (tx) => {
    if (name === "lukas_drawing_request_native_dwg_import") {
      const [row] =
        await tx`select public.lukas_drawing_request_native_dwg_import(
        ${tx.json(args.p_scope)}::jsonb,${args.p_request_id}::uuid
      ) value`;
      return row.value;
    }
    if (name === "lukas_drawing_native_dwg_import_status") {
      const [row] =
        await tx`select public.lukas_drawing_native_dwg_import_status(
        ${tx.json(args.p_scope)}::jsonb,${args.p_job_id}::uuid
      ) value`;
      return row.value;
    }
    if (name === "lukas_drawing_native_dwg_import_result") {
      const [row] =
        await tx`select public.lukas_drawing_native_dwg_import_result(
        ${tx.json(args.p_scope)}::jsonb,${args.p_job_id}::uuid
      ) value`;
      return row.value;
    }
    assert.fail(`Unsupported actor fixture RPC: ${name}`);
  });

async function assertSqlState(promise, expected) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, expected, error.message);
    return true;
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function within(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function shellSingleQuote(value) {
  assert.equal(typeof value, "string");
  assert.equal(/[\0\r\n]/.test(value), false);
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function createDockerForwardingShimScript({
  dockerPath,
  containerNamePath,
  configPath,
}) {
  return `#!/bin/sh
actual=${shellSingleQuote(dockerPath)}
name_file=${shellSingleQuote(containerNamePath)}
config_file=${shellSingleQuote(configPath)}
previous=
for argument in "$@"; do
  if [ "$previous" = "--name" ]; then printf '%s\n' "$argument" > "$name_file"; fi
  if [ "$previous" = "--config" ]; then printf '%s\n' "$argument" > "$config_file"; fi
  previous="$argument"
done
exec "$actual" "$@"
`;
}

export async function stopNativeDwgImportPipelineWorker({
  child,
  childExit,
  cleanupOwnedParserAttempt,
  gracefulMilliseconds = 20_000,
  forceMilliseconds = 10_000,
}) {
  assert.equal(typeof child?.kill, "function");
  assert.equal(typeof childExit?.then, "function");
  assert.equal(typeof cleanupOwnedParserAttempt, "function");
  let forced = false;
  let stopError;
  let cleanupError;
  try {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      try {
        await within(
          childExit,
          gracefulMilliseconds,
          "Native pipeline worker did not stop gracefully.",
        );
      } catch {
        forced = true;
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
        await within(
          childExit,
          forceMilliseconds,
          "Native pipeline worker force-stop did not finish.",
        );
      }
    } else await childExit;
  } catch (error) {
    stopError = error;
  }
  try {
    await cleanupOwnedParserAttempt();
  } catch (error) {
    cleanupError = error;
  }
  if (stopError && cleanupError)
    throw new AggregateError(
      [stopError, cleanupError],
      "Native pipeline worker stop and parser cleanup both failed.",
    );
  if (stopError) throw stopError;
  if (cleanupError) throw cleanupError;
  return { forced };
}

function dockerEnvironment() {
  return { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" };
}

async function dockerCall(dockerPath, dockerHost, configDirectory, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(
      dockerPath,
      ["--config", configDirectory, "--host", dockerHost, ...args],
      {
        env: dockerEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
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
        fail(new Error("Native pipeline Docker query exceeded 30 seconds.")),
      30_000,
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
      finish(() => {
        const errorText = Buffer.concat(stderr, stderrBytes).toString("utf8");
        if (code !== 0 || signal !== null)
          reject(
            new Error(
              `Native pipeline Docker query failed (${code}/${signal}): ${errorText.slice(0, 2_000)}`,
            ),
          );
        else resolve(Buffer.concat(stdout, stdoutBytes));
      }),
    );
  });
}

async function optionalText(path) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function cleanupOwnedParserAttempt({
  dockerPath,
  dockerHost,
  dockerConfigDirectory,
  readerImageId,
  containerNamePath,
  readerConfigPath,
  temporaryRoot,
}) {
  const containerName = await optionalText(containerNamePath);
  if (containerName !== null) {
    assert.match(containerName, /^1hk-dwg-read-[0-9a-f]{32}$/);
    const nonce = containerName.slice("1hk-dwg-read-".length);
    const list = async () =>
      (
        await dockerCall(dockerPath, dockerHost, dockerConfigDirectory, [
          "container",
          "ls",
          "--all",
          "--no-trunc",
          "--filter",
          `name=^/${containerName}$`,
          "--filter",
          `label=${ATTEMPT_LABEL}=${nonce}`,
          "--format",
          "{{.Names}}",
        ])
      )
        .toString("utf8")
        .trim();
    const present = await list();
    if (present !== "") {
      assert.equal(present, containerName);
      const [receipt] = JSON.parse(
        (
          await dockerCall(dockerPath, dockerHost, dockerConfigDirectory, [
            "container",
            "inspect",
            containerName,
          ])
        ).toString("utf8"),
      );
      assert.match(receipt.Id, /^[0-9a-f]{64}$/);
      assert.equal(receipt.Name, `/${containerName}`);
      assert.equal(receipt.Image, readerImageId);
      assert.equal(receipt.Config.Labels[ATTEMPT_LABEL], nonce);
      const removed = await dockerCall(
        dockerPath,
        dockerHost,
        dockerConfigDirectory,
        ["container", "rm", "--force", receipt.Id],
      );
      assert.equal(removed.toString("utf8").trim(), receipt.Id);
    }
    assert.equal(await list(), "");
  }

  const readerConfig = await optionalText(readerConfigPath);
  if (readerConfig !== null) {
    assert.equal(dirname(readerConfig), temporaryRoot);
    assert.match(basename(readerConfig), /^1hk-dwg-cli-[A-Za-z0-9]{6}$/);
    try {
      const identity = await lstat(readerConfig, { bigint: true });
      assert.ok(identity.isDirectory());
      assert.equal(identity.isSymbolicLink(), false);
      assert.equal(identity.uid, BigInt(process.getuid()));
      assert.equal(await realpath(readerConfig), readerConfig);
      assert.deepEqual(await readdir(readerConfig), []);
      await rmdir(readerConfig);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await assert.rejects(
      lstat(readerConfig),
      (error) => error?.code === "ENOENT",
    );
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    assert.ok(bytes <= 4 * 1024 * 1024, "fixture RPC body is bounded");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(body.byteLength),
  });
  response.end(body);
}

function sqlError(response, error) {
  sendJson(response, 400, {
    code: typeof error?.code === "string" ? error.code : "XX000",
    details: null,
    hint: null,
    message: "Loopback SQL fixture rejected the request.",
  });
}

function createFixtureClient(origin, key) {
  return createClient(origin, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function snapshotWorkspaceState(owner, projectId, fileId) {
  const [counts] = await owner`
    select
      (select count(*)::integer from public.lukas_drawing_objects
       where project_id=${projectId}::uuid) objects,
      (select count(*)::integer from public.lukas_drawing_operations
       where project_id=${projectId}::uuid) operations,
      (select count(*)::integer from public.lukas_drawing_object_sources
       where project_id=${projectId}::uuid) object_sources,
      (select count(*)::integer from public.lukas_drawing_revision_approvals
       where project_id=${projectId}::uuid) approvals
  `;
  const [file] = await owner`
    select id,project_id,uploaded_by,kind,storage_path,original_filename,
      content_type,byte_size,sha256,immutable
    from public.lukas_qto_files where id=${fileId}::uuid
  `;
  return { counts, file };
}

export async function attachNativeDwgCanonicalPipelineEvidence(
  analysisEvidence,
  afterAnalysis,
  context,
) {
  if (!afterAnalysis) return analysisEvidence;
  return {
    ...analysisEvidence,
    canonicalProof: await afterAnalysis(context),
  };
}

// This bridge verifies production SDK/config/transport composition while every
// authorization, claim and publication decision is executed by real PostgreSQL.
// It is intentionally NOT evidence of real PostgREST, JWT verification, or
// Supabase Storage behavior.
export async function proveNativeDwgImportPipeline({
  owner,
  workerA,
  workerB,
  ids,
  registerProject = () => {},
  dockerPath: rawDockerPath,
  dockerHost,
  readerImageId,
  afterAnalysis,
}) {
  const projectId = randomUUID();
  registerProject(projectId);
  const cleanupErrors = [];
  let primaryError;
  let server;
  let child;
  let childExit;
  let integrationRoot;
  let dockerPath;
  let dockerConfigDirectory;
  let ownedParserCleanup;
  let evidence;
  try {
    assert.equal(
      typeof rawDockerPath,
      "string",
      "NATIVE_DWG_DOCKER_PATH is required",
    );
    assert.ok(
      isAbsolute(rawDockerPath),
      "NATIVE_DWG_DOCKER_PATH must be absolute",
    );
    dockerPath = await realpath(rawDockerPath);
    await access(dockerPath, constants.X_OK);
    assert.ok((await stat(dockerPath)).isFile());
    assert.match(dockerHost, /^unix:\/\/\/[^\0\r\n?#%]+$/);
    const socket = dockerHost.slice("unix://".length);
    assert.ok(isAbsolute(socket));
    assert.equal(normalize(socket), socket);
    assert.ok((await stat(socket)).isSocket());
    assert.match(readerImageId, /^sha256:[0-9a-f]{64}$/);

    const temporaryRoot = await realpath(tmpdir());
    const readerTemporaryRoot = await realpath("/tmp");
    integrationRoot = await mkdtemp(
      join(temporaryRoot, "native-dwg-import-pipeline-"),
    );
    dockerConfigDirectory = await mkdtemp(
      join(integrationRoot, "docker-config-"),
    );
    const inspectedImage = JSON.parse(
      (
        await dockerCall(dockerPath, dockerHost, dockerConfigDirectory, [
          "image",
          "inspect",
          readerImageId,
        ])
      ).toString("utf8"),
    )[0];
    assert.equal(inspectedImage.Id, readerImageId);
    assert.equal(
      inspectedImage.Config.Labels["org.1hk.native-dwg-reader.protocol"],
      "1hk-dwg-import/1",
    );

    const sourceBytes = await readFile(sourceUrl);
    const originalBytes = Buffer.from(sourceBytes);
    assert.equal(sourceBytes.byteLength, SOURCE_BYTE_SIZE);
    assert.equal(sha256(sourceBytes), SOURCE_SHA256);
    assert.equal(sourceBytes.subarray(0, 6).toString("ascii"), SOURCE_HEADER);
    const expectedReport = JSON.parse(await readFile(reportUrl, "utf8"));
    const expectedReportText = JSON.stringify(expectedReport);
    assert.equal(Buffer.byteLength(expectedReportText), REPORT_BYTE_SIZE);
    assert.equal(sha256(expectedReportText), REPORT_SHA256);

    const actor = ids.users.editor;
    const verificationId = randomUUID();
    const storagePath = `${ids.users.owner}/${projectId}/source-uploads/${verificationId}.dwg`;
    await owner`insert into public.lukas_qto_projects(id,organization_id,owner_id,name)
      values(${projectId}::uuid,${ids.organization}::uuid,${ids.users.owner}::uuid,'Native DWG pipeline proof')`;
    await owner`insert into public.lukas_qto_project_members(project_id,user_id,role) values
      (${projectId}::uuid,${actor}::uuid,'estimator')`;
    await owner`insert into public.lukas_qto_verified_uploads(
      id,actor_id,project_id,kind,storage_path,original_filename,content_type,
      byte_size,sha256,dwg_header_version
    ) values(
      ${verificationId}::uuid,${actor}::uuid,${projectId}::uuid,'dwg',
      ${storagePath},'synthetic-source.dwg','application/octet-stream',
      ${SOURCE_BYTE_SIZE},${SOURCE_SHA256},${SOURCE_HEADER}
    )`;
    const [finalized] = await session(
      owner,
      "service_role",
      null,
      (tx) =>
        tx`select public.lukas_qto_finalize_verified_upload(
        ${verificationId}::uuid,${actor}::uuid,${projectId}::uuid
      ) value`,
    );
    const [document] = await session(
      owner,
      "authenticated",
      actor,
      (tx) =>
        tx`select public.lukas_drawing_create_document_idempotent(
        ${projectId}::uuid,null::uuid,'Native analysis target',true,
        ${randomUUID()}::uuid,null::uuid
      ) value`,
    );
    const [canvas] = await owner`
      select id from public.lukas_drawing_canvases
      where revision_id=${document.value.revisionId}::uuid
    `;
    const scope = {
      projectId,
      documentId: document.value.documentId,
      revisionId: document.value.revisionId,
      canvasId: canvas.id,
      sourceFileId: finalized.value.fileId,
      sourceSha256: SOURCE_SHA256,
      unitOverride: null,
    };
    const before = await snapshotWorkspaceState(
      owner,
      projectId,
      scope.sourceFileId,
    );
    assert.deepEqual(before.counts, {
      objects: 0,
      operations: 0,
      object_sources: 0,
      approvals: 0,
    });
    assert.deepEqual(before.file, {
      id: scope.sourceFileId,
      project_id: projectId,
      uploaded_by: actor,
      kind: "dwg",
      storage_path: storagePath,
      original_filename: "synthetic-source.dwg",
      content_type: "application/octet-stream",
      byte_size: "10987",
      sha256: SOURCE_SHA256,
      immutable: true,
    });

    const serviceKey = `fixture-service-${randomUUID()}`;
    const actorKey = `fixture-actor-${randomUUID()}`;
    const ownerKey = `fixture-owner-${randomUUID()}`;
    const requests = [];
    const publication = deferred();
    const postSuccessIdle = deferred();
    let competeOnNextClaim = false;
    let claimCompetition;
    let claimedDescriptor;
    let publishedReportText;
    let origin;
    const storageRoute = `/storage/v1/object/lukas-qto/${storagePath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    server = createServer((request, response) => {
      void (async () => {
        const key = request.headers.apikey;
        assert.ok([serviceKey, actorKey, ownerKey].includes(key));
        assert.equal(request.headers.authorization, `Bearer ${key}`);
        const url = new URL(request.url, origin);
        requests.push({ method: request.method, path: url.pathname, key });
        if (request.method === "GET" && url.pathname === storageRoute) {
          assert.equal(key, serviceKey);
          response.writeHead(200, {
            "content-type": "application/octet-stream",
            "content-length": String(sourceBytes.byteLength),
          });
          response.end(sourceBytes);
          return;
        }
        assert.equal(request.method, "POST");
        assert.match(url.pathname, /^\/rest\/v1\/rpc\/[a-z0-9_]+$/);
        const name = url.pathname.slice("/rest/v1/rpc/".length);
        const args = await readJsonBody(request);
        let value;
        if (key === serviceKey) {
          if (
            name === "lukas_drawing_claim_native_dwg_import" &&
            competeOnNextClaim
          ) {
            competeOnNextClaim = false;
            const pair = await Promise.all([
              serviceRpc(workerA, name, args),
              serviceRpc(workerB, name, args),
            ]);
            assert.equal(pair.filter(Boolean).length, 1);
            claimCompetition = {
              contenders: pair.length,
              winners: pair.filter(Boolean).length,
            };
            value = pair.find(Boolean);
            claimedDescriptor = value;
          } else value = await serviceRpc(workerA, name, args);
          if (name === "lukas_drawing_complete_native_dwg_import") {
            publishedReportText = args.p_report_text;
            publication.resolve(value);
          }
          if (
            name === "lukas_drawing_claim_native_dwg_import" &&
            value === null &&
            publishedReportText
          )
            postSuccessIdle.resolve();
        } else {
          const requestActor = key === actorKey ? actor : ids.users.owner;
          value = await actorRpc(owner, requestActor, name, args);
        }
        sendJson(response, 200, value);
      })().catch((error) => sqlError(response, error));
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === "object");
    origin = `http://127.0.0.1:${address.port}`;

    const actorClient = createFixtureClient(origin, actorKey);
    const rejectedJob = await requestNativeDrawingDwgImport(
      actorClient,
      scope,
      randomUUID(),
    );
    const rejectedClaim = await serviceRpc(
      workerA,
      "lukas_drawing_claim_native_dwg_import",
      {
        p_reader_image_id: readerImageId,
        p_lease_seconds: 300,
      },
    );
    assert.equal(rejectedClaim.jobId, rejectedJob.jobId);
    await assertSqlState(
      serviceRpc(workerA, "lukas_drawing_complete_native_dwg_import", {
        p_job_id: rejectedClaim.jobId,
        p_attempt_number: rejectedClaim.attemptNumber,
        p_lease_token: rejectedClaim.leaseToken,
        p_reader_image_id: readerImageId,
        p_report_text: expectedReportText,
        p_report_sha256: "0".repeat(64),
      }),
      "PNI04",
    );
    await assert.rejects(
      getNativeDrawingDwgImportResult(actorClient, scope, rejectedJob.jobId),
      (error) => error?.kind === "unavailable",
    );
    const [rejectedResidue] = await owner`
      select count(*)::integer count
      from public.lukas_drawing_native_dwg_import_results
      where job_id=${rejectedJob.jobId}::uuid
    `;
    assert.equal(rejectedResidue.count, 0);
    assert.deepEqual(
      await serviceRpc(workerA, "lukas_drawing_fail_native_dwg_import", {
        p_job_id: rejectedClaim.jobId,
        p_attempt_number: rejectedClaim.attemptNumber,
        p_lease_token: rejectedClaim.leaseToken,
        p_failure_code: "report_invalid",
        p_retryable: false,
      }),
      { jobId: rejectedJob.jobId, status: "failed" },
    );

    const accepted = await requestNativeDrawingDwgImport(
      actorClient,
      scope,
      randomUUID(),
    );
    competeOnNextClaim = true;
    const containerNamePath = join(integrationRoot, "reader-container-name");
    const readerConfigPath = join(integrationRoot, "reader-config-path");
    const dockerShim = join(integrationRoot, "docker");
    await writeFile(
      dockerShim,
      createDockerForwardingShimScript({
        dockerPath,
        containerNamePath,
        configPath: readerConfigPath,
      }),
      { mode: 0o700 },
    );
    await chmod(dockerShim, 0o700);
    ownedParserCleanup = () =>
      cleanupOwnedParserAttempt({
        dockerPath,
        dockerHost,
        dockerConfigDirectory,
        readerImageId,
        containerNamePath,
        readerConfigPath,
        temporaryRoot: readerTemporaryRoot,
      });
    child = spawn(
      process.execPath,
      ["--experimental-strip-types", fileURLToPath(workerUrl)],
      {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        env: {
          LANG: "C",
          LC_ALL: "C",
          PATH: process.env.PATH,
          NODE_OPTIONS: "--no-experimental-webstorage",
          SUPABASE_URL: origin,
          SUPABASE_SERVICE_ROLE_KEY: serviceKey,
          NATIVE_DWG_READER_IMAGE_ID: readerImageId,
          NATIVE_DWG_DOCKER_PATH: dockerShim,
          NATIVE_DWG_DOCKER_HOST: dockerHost,
          NATIVE_DWG_IMPORT_LEASE_SECONDS: "300",
          NATIVE_DWG_IMPORT_POLL_MILLISECONDS: "100",
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    const capture = (target, chunk) => {
      outputBytes += chunk.length;
      assert.ok(outputBytes <= 1024 * 1024, "worker output is bounded");
      target.push(chunk);
    };
    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk));
    childExit = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    await within(
      publication.promise,
      160_000,
      "Native pipeline did not publish.",
    );
    await within(
      postSuccessIdle.promise,
      10_000,
      "Native pipeline did not reach post-success idle.",
    );
    const stopped = await stopNativeDwgImportPipelineWorker({
      child,
      childExit,
      cleanupOwnedParserAttempt: ownedParserCleanup,
    });
    const childResult = await childExit;
    child = undefined;
    ownedParserCleanup = undefined;
    assert.deepEqual(stopped, { forced: false });
    assert.deepEqual(childResult, { code: 0, signal: null });
    assert.equal(Buffer.concat(stderr).toString("utf8"), "");
    assert.deepEqual(
      Buffer.concat(stdout).toString("utf8").trim().split("\n"),
      [
        '{"event":"native_dwg_import_worker_started"}',
        '{"event":"native_dwg_import_worker_result","outcome":"analyzed"}',
        '{"event":"native_dwg_import_worker_stopped"}',
      ],
    );
    assert.deepEqual(claimCompetition, { contenders: 2, winners: 1 });
    assert.deepEqual(claimedDescriptor.source, {
      verificationId,
      fileId: scope.sourceFileId,
      bucket: "lukas-qto",
      path: storagePath,
      sha256: SOURCE_SHA256,
      byteSize: SOURCE_BYTE_SIZE,
      headerVersion: SOURCE_HEADER,
    });

    const freshActorClient = createFixtureClient(origin, actorKey);
    const status = await getNativeDrawingDwgImportStatus(
      freshActorClient,
      scope,
      accepted.jobId,
    );
    assert.equal(status.status, "analyzed");
    assert.equal(status.attemptCount, 1);
    assert.equal(status.failureCode, null);
    assert.deepEqual(status.receipt, {
      jobId: accepted.jobId,
      attemptNumber: 1,
      readerImageId,
      reportSha256: REPORT_SHA256,
      reportByteSize: REPORT_BYTE_SIZE,
      source: {
        verificationId,
        fileId: scope.sourceFileId,
        sha256: SOURCE_SHA256,
        byteSize: SOURCE_BYTE_SIZE,
        headerVersion: SOURCE_HEADER,
      },
      qualification: "experimental-unqualified",
      persistenceAuthority: "not-issued",
    });
    const result = await getNativeDrawingDwgImportResult(
      freshActorClient,
      scope,
      accepted.jobId,
    );
    assert.equal(result.reportText, expectedReportText);
    assert.equal(publishedReportText, expectedReportText);
    assert.deepEqual(JSON.parse(result.reportText), expectedReport);
    assert.equal(expectedReport.modelSpaceHandle, "40");
    assert.deepEqual(
      expectedReport.entities.map((entity) => entity.handle),
      ["4A", "4B", "4C", "4D", "4E"],
    );
    assert.deepEqual(
      expectedReport.layers.map((layer) => layer.handle),
      ["3C", "48", "49"],
    );
    assert.deepEqual(expectedReport.coverage, {
      modelSpaceEntities: 6,
      importedEntities: 5,
      unsupportedEntities: 1,
      nonModelSpaceEntities: 3,
    });
    assert.deepEqual(expectedReport.unsupported, [
      {
        type: "INSERT",
        reason: "unsupported_type",
        count: 1,
        sampleHandles: ["54"],
      },
    ]);
    await assert.rejects(
      getNativeDrawingDwgImportResult(
        createFixtureClient(origin, ownerKey),
        scope,
        accepted.jobId,
      ),
      (error) => error?.kind === "unavailable",
    );
    assert.deepEqual(sourceBytes, originalBytes);
    const after = await snapshotWorkspaceState(
      owner,
      projectId,
      scope.sourceFileId,
    );
    assert.deepEqual(after, before);
    const [durable] = await owner`
      select j.status,j.attempt_count,a.outcome,a.reader_image_id,
        r.report_sha256,r.report_byte_size
      from public.lukas_drawing_native_dwg_import_jobs j
      join public.lukas_drawing_native_dwg_import_attempts a
        on a.job_id=j.id and a.attempt_number=1
      join public.lukas_drawing_native_dwg_import_results r on r.job_id=j.id
      where j.id=${accepted.jobId}::uuid
    `;
    assert.deepEqual(durable, {
      status: "analyzed",
      attempt_count: 1,
      outcome: "analyzed",
      reader_image_id: readerImageId,
      report_sha256: REPORT_SHA256,
      report_byte_size: REPORT_BYTE_SIZE,
    });
    await assertSqlState(
      owner`
        update public.lukas_drawing_native_dwg_import_results
        set report_text='{}' where job_id=${accepted.jobId}::uuid
      `,
      "42501",
    );
    assert.ok(
      requests.some(
        ({ method, path, key }) =>
          method === "GET" && path === storageRoute && key === serviceKey,
      ),
    );
    evidence = await attachNativeDwgCanonicalPipelineEvidence(
      {
        transportQualification: TRANSPORT_QUALIFICATION,
        sourceSha256: SOURCE_SHA256,
        sourceByteSize: SOURCE_BYTE_SIZE,
        sourceHeaderVersion: SOURCE_HEADER,
        reportSha256: REPORT_SHA256,
        reportByteSize: REPORT_BYTE_SIZE,
        readerImageId,
        jobId: accepted.jobId,
        status: "analyzed",
        persistenceAuthority: "not-issued",
        claimContenders: 2,
        claimWinners: 1,
        parserContainerResidue: 0,
        parserConfigResidue: 0,
      },
      afterAnalysis,
      {
        owner,
        workerA,
        workerB,
        ids,
        scope,
        jobId: accepted.jobId,
      },
    );
  } catch (error) {
    primaryError = error;
  } finally {
    if (child)
      try {
        await stopNativeDwgImportPipelineWorker({
          child,
          childExit,
          cleanupOwnedParserAttempt: ownedParserCleanup ?? (async () => {}),
        });
        ownedParserCleanup = undefined;
      } catch (error) {
        cleanupErrors.push(
          new Error("Native pipeline worker cleanup failed.", { cause: error }),
        );
      }
    else if (ownedParserCleanup)
      try {
        await ownedParserCleanup();
        ownedParserCleanup = undefined;
      } catch (error) {
        cleanupErrors.push(
          new Error("Native pipeline parser cleanup failed.", { cause: error }),
        );
      }
    if (server)
      try {
        server.closeAllConnections?.();
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      } catch (error) {
        cleanupErrors.push(
          new Error("Native pipeline bridge cleanup failed.", { cause: error }),
        );
      }
    if (integrationRoot && !ownedParserCleanup)
      try {
        await rm(integrationRoot, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(
          new Error("Native pipeline temporary cleanup failed.", {
            cause: error,
          }),
        );
      }
  }
  if (primaryError) {
    if (cleanupErrors.length)
      throw new AggregateError(
        [primaryError, ...cleanupErrors],
        "Native pipeline proof and cleanup both failed.",
      );
    throw primaryError;
  }
  if (cleanupErrors.length)
    throw new AggregateError(cleanupErrors, "Native pipeline cleanup failed.");
  return evidence;
}
