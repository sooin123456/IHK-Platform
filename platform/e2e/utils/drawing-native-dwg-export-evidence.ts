import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { expect, type Browser, type TestInfo } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

import {
  calculateNativeDwgWriterBuildSha256,
  runNativeDrawingDwgWorkerOnce,
  type NativeDwgJobClaim,
  type NativeDwgReceipt,
  type NativeDwgScope,
} from "../../app/lukas/lib/drawing-native-dwg-worker.server";
import { parseNativeDwgWorkerConfig } from "../../native-dwg-worker/src/index";
import { createSupabaseNativeDwgWorkerDependencies } from "../../native-dwg-worker/src/supabase";
import { verifyDisposableSupabaseAuthority } from "../../scripts/run-drawing-workspace-m1-e2e.mjs";
import {
  authenticateApiClient,
  authenticateContext,
  type DrawingFixture,
} from "./drawing-collaboration-fixture";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

// Real, marked-local infrastructure only. No synthetic approval or application
// mutation endpoint is introduced for these checks.
export async function proveNativeDrawingDwgExport({
  browser,
  fixture,
  scope,
  testInfo,
}: {
  browser: Browser;
  fixture: DrawingFixture;
  scope: NativeDwgScope;
  testInfo: TestInfo;
}) {
  const authority = verifyDisposableSupabaseAuthority(process.env);
  const config = parseNativeDwgWorkerConfig(process.env);
  expect(config.supabaseUrl).toBe(authority.supabaseUrl);
  const writerBuildSha256 = await calculateNativeDwgWriterBuildSha256(
    config.publishedDirectory,
  );
  const baseUrl = "http://127.0.0.1:4000";
  const workspacePath = `/projects/${scope.projectId}/workspaces/${scope.documentId}`;
  const resourcePath = `${workspacePath}/native-dwg`;
  const search = new URLSearchParams({
    revisionId: scope.revisionId,
    revisionVersion: String(scope.revisionVersion),
    canvasId: scope.canvasId,
    snapshotSha256: scope.snapshotSha256,
  });
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: { width: 1440, height: 1000 },
  });
  const viewerContext = await browser.newContext({ baseURL: baseUrl });
  const outsiderContext = await browser.newContext({ baseURL: baseUrl });
  const sqlOptions = { max: 1, connection: { statement_timeout: 45000 } };
  const sql = postgres(authority.databaseUrl, sqlOptions);
  const lockSql = postgres(authority.databaseUrl, sqlOptions);
  const failSql = postgres(authority.databaseUrl, sqlOptions);
  type SqlOutcome = { value: unknown; error: unknown };
  let lockOutcome: Promise<SqlOutcome> | undefined;
  let failureOutcome: Promise<SqlOutcome> | undefined;
  const evidence: Record<string, unknown> = {
    qualification: "experimental-unqualified",
    scope,
    writerBuildSha256,
    independentCadQualification: "not-performed",
  };
  const pageErrors: string[] = [];
  let restoreViewer = false;
  try {
    const page = await authenticateContext(
      fixture,
      context,
      fixture.approver,
      baseUrl,
      workspacePath,
    );
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.getByRole("button", { name: "내보내기", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "도면 내보내기" });
    await dialog
      .getByRole("radio", { name: "DWG (시험)", exact: true })
      .check();
    const create = dialog.getByRole("button", {
      name: "시험용 DWG 만들기",
      exact: true,
    });
    await expect(create).toBeEnabled();
    const acceptedResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === resourcePath &&
        response.request().method() === "POST",
    );
    await create.click();
    const accepted = await acceptedResponse;
    expect(accepted.status()).toBe(202);
    const request = accepted.request().postDataJSON();
    expect(request).toEqual({ ...scope, requestId: expect.any(String) });
    const acceptance = await accepted.json();
    expect(acceptance).toEqual({
      accepted: true,
      requestId: request.requestId,
      jobId: expect.any(String),
    });
    Object.assign(evidence, { acceptance, request });
    await expect(dialog).toContainText("대기열에서 변환을 기다리고 있습니다.");

    // Exercise the real React same-job retry: a single intentional GET failure
    // is a transport fault, not a substitute for a successful server response.
    let injectedStatusFailures = 0;
    await page.route(`${baseUrl}${resourcePath}?**`, async (route) => {
      if (route.request().method() === "GET" && injectedStatusFailures === 0) {
        injectedStatusFailures++;
        await route.fulfill({
          status: 503,
          contentType: "text/plain",
          body: "Injected status interruption",
        });
      } else await route.continue();
    });
    await expect(
      dialog.getByRole("button", { name: "같은 요청 다시 확인", exact: true }),
    ).toBeVisible();
    const replayResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === resourcePath &&
        response.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "같은 요청 다시 확인", exact: true })
      .click();
    const replay = await replayResponse;
    expect(replay.status()).toBe(202);
    expect(replay.request().postDataJSON()).toEqual(request);
    expect(await replay.json()).toEqual(acceptance);
    await expect(dialog).toContainText("대기열에서 변환을 기다리고 있습니다.");
    await page.unroute(`${baseUrl}${resourcePath}?**`);
    Object.assign(evidence, {
      injectedStatusFailures,
      sameIdRetryResumed: true,
    });
    await dialog.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("button", { name: "내보내기", exact: true }).click();
    await dialog
      .getByRole("radio", { name: "DWG (시험)", exact: true })
      .check();
    await expect(dialog).toContainText("대기열에서 변환을 기다리고 있습니다.");
    evidence.queuedReopenRestored = true;

    const publicationReplays: string[] = [];
    const newWorker = () => {
      const client = createClient(
        config.supabaseUrl,
        config.supabaseServiceRoleKey,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
          },
        },
      );
      const dependencies = createSupabaseNativeDwgWorkerDependencies(client, {
        supabaseUrl: config.supabaseUrl,
        serviceRoleKey: config.supabaseServiceRoleKey,
        dotnetPath: config.dotnetPath,
        publishedDirectory: config.publishedDirectory,
        writerBuildSha256,
        leaseSeconds: 900,
      });
      const publish = dependencies.publish;
      dependencies.publish = async (input) => {
        const first = await publish(input);
        // Two actual HTTP RPCs, intentionally replaying a completed publication.
        // This establishes idempotency, not a claim of transport-level loss.
        const second = await publish(input);
        expect(second).toEqual(first);
        publicationReplays.push(first.jobId);
        return second;
      };
      return dependencies;
    };
    const outcomes = await Promise.all([
      runNativeDrawingDwgWorkerOnce(newWorker()),
      runNativeDrawingDwgWorkerOnce(newWorker()),
    ]);
    evidence.outcomes = outcomes;
    expect([...outcomes].sort()).toEqual(["completed", "idle"]);
    await expect(dialog).toContainText("시험용 DWG 파일이 준비되었습니다.", {
      timeout: 30_000,
    });
    await expect(dialog).toContainText(
      "내부 시험용 experimental-unqualified 결과입니다.",
    );
    const statusResponse = await context.request.get(
      `${resourcePath}?${search}&jobId=${acceptance.jobId}`,
    );
    expect(statusResponse.status()).toBe(200);
    expect(statusResponse.headers()["cache-control"]).toBe("private, no-store");
    const status = await statusResponse.json();
    expect(status).toMatchObject({ status: "completed", attemptCount: 1 });
    const receipt = status.receipt as NativeDwgReceipt;
    expect(receipt).toEqual({
      jobId: acceptance.jobId,
      attempt: 1,
      qualification: "experimental-unqualified",
      source: scope,
      writerBuildSha256,
      structureSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      artifacts: expect.any(Array),
      createdAt: expect.any(String),
    });
    expect(Number.isFinite(Date.parse(receipt.createdAt))).toBe(true);
    expect(receipt.artifacts.map((artifact) => artifact.kind).sort()).toEqual([
      "authority",
      "dwg",
      "report",
      "source_manifest",
    ]);
    expect(receipt.source).toEqual(scope);
    expect(receipt.writerBuildSha256).toBe(writerBuildSha256);
    const files = [
      ["dwg", "DWG", "native.dwg"],
      ["source_manifest", "도면 데이터", "source-manifest.json"],
      ["authority", "승인·원본 근거", "authority.json"],
      ["report", "검증 보고서", "native-report.json"],
    ] as const;
    const downloaded: Record<string, { sha256: string; byteSize: number }> = {};
    const downloadHeaders: Record<
      string,
      Record<string, string | undefined>
    > = {};
    for (const [kind, label, filename] of files) {
      const link = dialog.getByRole("link", { name: label, exact: true });
      await expect(link).toHaveCount(1);
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        link.click(),
      ]);
      const output = testInfo.outputPath(`native-dwg-${filename}`);
      await download.saveAs(output);
      const bytes = await readFile(output);
      const identity = { sha256: sha256(bytes), byteSize: bytes.byteLength };
      const href = await link.getAttribute("href");
      expect(href).not.toBeNull();
      const headerResponse = await context.request.get(href!);
      expect(headerResponse.status()).toBe(200);
      const responseHeaders = headerResponse.headers();
      expect(responseHeaders).toMatchObject({
        "cache-control": "private, no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "content-disposition": expect.stringMatching(
          /^attachment; filename="drawing-experimental(?:-(?:source-manifest|authority|native-report))?\.(?:dwg|json)"$/,
        ),
      });
      // Express may append a JSON charset and compression removes the raw
      // Content-Length. Verify the media type and decoded bytes independently.
      expect(responseHeaders["content-type"].split(";")[0]).toBe(
        kind === "dwg" ? "application/acad" : "application/json",
      );
      if (
        responseHeaders["content-length"] &&
        !responseHeaders["content-encoding"]
      )
        expect(responseHeaders["content-length"]).toBe(
          String(bytes.byteLength),
        );
      downloadHeaders[kind] = Object.fromEntries(
        [
          "cache-control",
          "referrer-policy",
          "x-content-type-options",
          "content-type",
          "content-disposition",
          "content-length",
          "content-encoding",
        ].map((name) => [name, responseHeaders[name]]),
      );
      expect(sha256(await headerResponse.body())).toBe(identity.sha256);
      expect(
        receipt.artifacts.find((artifact) => artifact.kind === kind),
      ).toEqual({ kind, ...identity });
      if (kind === "dwg")
        expect(bytes.subarray(0, 6).toString("ascii")).toBe("AC1024");
      if (kind === "report")
        expect(JSON.parse(bytes.toString())).toMatchObject({
          status: "passed-internal-semantic-comparison",
          qualification: "experimental-unqualified",
          failures: [],
        });
      downloaded[kind] = identity;
      await testInfo.attach(`native-dwg-${filename}`, {
        path: output,
        contentType: kind === "dwg" ? "application/acad" : "application/json",
      });
    }
    const screenshot = testInfo.outputPath("native-dwg-completed.png");
    await page.screenshot({ path: screenshot });
    await testInfo.attach("native-dwg-completed", {
      path: screenshot,
      contentType: "image/png",
    });

    const viewerPage = await authenticateContext(
      fixture,
      viewerContext,
      fixture.viewer,
      baseUrl,
      workspacePath,
    );
    const viewerClient = await authenticateApiClient(fixture, fixture.viewer);
    await authenticateContext(
      fixture,
      outsiderContext,
      fixture.nonMember,
      baseUrl,
      "/",
    );
    const downloadPath = `${resourcePath}/${acceptance.jobId}/download/dwg?${search}`;
    const viewerDownload = await viewerContext.request.get(downloadPath);
    expect(viewerDownload.status()).toBe(200);
    expect(sha256(await viewerDownload.body())).toBe(downloaded.dwg.sha256);
    expect(viewerDownload.headers()["cache-control"]).toBe("private, no-store");
    expect(viewerDownload.headers()["x-content-type-options"]).toBe("nosniff");
    const descriptor = await viewerClient.rpc(
      "lukas_drawing_native_dwg_download_descriptor",
      {
        p_scope: scope,
        p_job_id: acceptance.jobId,
        p_kind: "dwg",
      },
    );
    expect(descriptor.error).toBeNull();
    const direct = await viewerClient.storage
      .from("lukas-qto")
      .download(descriptor.data.path);
    expect(direct.error).not.toBeNull();
    const outsider = await outsiderContext.request.get(downloadPath, {
      maxRedirects: 0,
    });
    expect([403, 404]).toContain(outsider.status());
    // Reapplying this exact viewer role is safe even if the removal response is
    // lost after commit, so record cleanup intent before the mutating request.
    restoreViewer = true;
    const removed = await fixture.retentionClient.rpc(
      "lukas_qto_remove_project_member",
      {
        p_organization_id: fixture.organizationId,
        p_project_id: scope.projectId,
        p_user_id: fixture.viewer.id,
        p_reason: "Disposable native DWG live-authorization proof",
        p_request_id: randomUUID(),
      },
    );
    expect(removed.error).toBeNull();
    const revoked = await viewerContext.request.get(downloadPath, {
      maxRedirects: 0,
    });
    expect([403, 404]).toContain(revoked.status());
    await viewerPage.close();
    const restored = await fixture.retentionClient.rpc(
      "lukas_qto_set_project_member",
      {
        p_organization_id: fixture.organizationId,
        p_project_id: scope.projectId,
        p_email: fixture.viewer.email,
        p_role: "viewer",
        p_request_id: randomUUID(),
      },
    );
    expect(restored.error).toBeNull();
    restoreViewer = false;

    // A second real job leaves its first staged upload session open. A separate
    // service-role connection waits on the project lock across the real lease
    // deadline. No lease timestamp or approved source is rewritten for the test.
    const laterRequest = { ...scope, requestId: randomUUID() };
    const laterResponse = await context.request.post(resourcePath, {
      data: laterRequest,
      headers: { Origin: baseUrl },
    });
    expect(laterResponse.status()).toBe(202);
    const later = await laterResponse.json();
    const claimed = await fixture.admin.rpc(
      "lukas_drawing_claim_native_dwg_export",
      {
        p_writer_build_sha256: writerBuildSha256,
        p_lease_seconds: 30,
      },
    );
    expect(claimed.error).toBeNull();
    const claim = claimed.data as NativeDwgJobClaim;
    expect(claim).toMatchObject({ jobId: later.jobId, attempt: 1 });
    const leaseArgs = {
      p_job_id: claim.jobId,
      p_attempt: claim.attempt,
      p_lease_token: claim.leaseToken,
    };
    const stageArgs = {
      ...leaseArgs,
      p_structure_sha256: receipt.structureSha256,
      p_artifacts: receipt.artifacts,
    };
    const staged = await fixture.admin.rpc(
      "lukas_drawing_stage_native_dwg_export",
      stageArgs,
    );
    expect(staged.error).toBeNull();
    let locked!: () => void;
    let lockFailed!: (error: unknown) => void;
    const lockReady = new Promise<void>((resolve, reject) => {
      locked = resolve;
      lockFailed = reject;
    });
    lockOutcome = lockSql
      .begin(async (tx) => {
        await tx`select id from public.lukas_qto_projects where id=${scope.projectId}::uuid for update`;
        locked();
        await tx`select pg_sleep(greatest(0, extract(epoch from (${claim.leaseExpiresAt}::timestamptz-clock_timestamp())))+0.3)`;
      })
      .then(
        () => ({ value: "released", error: null }),
        (error) => {
          lockFailed(error);
          return { value: null, error };
        },
      );
    await lockReady;
    const [leaseBeforeWait] = await sql`select clock_timestamp() observed_at,
      extract(epoch from (${claim.leaseExpiresAt}::timestamptz-clock_timestamp()))::float seconds_remaining`;
    expect(leaseBeforeWait.seconds_remaining).toBeGreaterThan(5);
    const [{ pid }] = await failSql`select pg_backend_pid() pid`;
    failureOutcome = failSql
      .begin(async (tx) => {
        await tx`set local role service_role`;
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ role: "service_role" })}, true)`;
        const [row] =
          await tx`select public.lukas_drawing_fail_native_dwg_export(
        ${claim.jobId}::uuid,${claim.attempt}::integer,${claim.leaseToken}::uuid,
        'conversion_failed',true) value`;
        return row.value;
      })
      .then(
        (value) => ({ value, error: null }),
        (error) => ({ value: null, error }),
      );
    await expect
      .poll(
        async () => {
          const [row] = await sql`select wait_event_type='Lock'
            and position('lukas_drawing_fail_native_dwg_export' in query)>0
            and query_start<${claim.leaseExpiresAt}::timestamptz
            and clock_timestamp()<${claim.leaseExpiresAt}::timestamptz as waiting_before_expiry
            from pg_stat_activity where pid=${pid}`;
          return row?.waiting_before_expiry;
        },
        { timeout: 5_000 },
      )
      .toBe(true);
    expect(await lockOutcome).toEqual({ value: "released", error: null });
    expect(await failureOutcome).toEqual({ value: "stale", error: null });
    const [leaseAfterWait] = await sql`select clock_timestamp() observed_at,
      clock_timestamp()>${claim.leaseExpiresAt}::timestamptz expired`;
    expect(leaseAfterWait.expired).toBe(true);
    const [afterWait] =
      await sql`select status,attempt_count,last_error_code from public.lukas_drawing_native_dwg_jobs where id=${claim.jobId}::uuid`;
    expect(afterWait).toEqual({
      status: "processing",
      attempt_count: 1,
      last_error_code: null,
    });
    const reclaimedOutcomes = await Promise.all([
      runNativeDrawingDwgWorkerOnce(newWorker()),
      runNativeDrawingDwgWorkerOnce(newWorker()),
    ]);
    expect([...reclaimedOutcomes].sort()).toEqual(["completed", "idle"]);
    const staleStage = await fixture.admin.rpc(
      "lukas_drawing_stage_native_dwg_export",
      stageArgs,
    );
    const stalePublish = await fixture.admin.rpc(
      "lukas_drawing_publish_native_dwg_export",
      leaseArgs,
    );
    expect(staleStage.error?.code).toBe("PNJ03");
    // A later attempt already owns the immutable receipt; an older attempt
    // must not borrow its publication replay.
    expect(stalePublish.error?.code).toBe("PNJ04");
    const attempts =
      await sql`select attempt_number,upload_state from public.lukas_drawing_native_dwg_attempts where job_id=${claim.jobId}::uuid order by attempt_number`;
    expect([...attempts]).toEqual([
      { attempt_number: 1, upload_state: "open" },
      { attempt_number: 2, upload_state: "closed" },
    ]);
    const counts =
      await sql`select job_id,count(*)::integer receipt_count from public.lukas_drawing_native_dwg_exports where job_id in (${acceptance.jobId}::uuid,${claim.jobId}::uuid) group by job_id order by job_id`;
    expect(counts).toHaveLength(2);
    expect(counts.every((row) => row.receipt_count === 1)).toBe(true);
    expect([...publicationReplays].sort()).toEqual(
      [acceptance.jobId, claim.jobId].sort(),
    );
    expect(pageErrors).toEqual([]);
    Object.assign(evidence, {
      status: "passed",
      acceptance,
      request,
      outcomes,
      receipt,
      downloaded,
      downloadHeaders,
      injectedStatusFailures,
      sameIdRetryResumed: true,
      queuedReopenRestored: true,
      viewerDownloadStatus: viewerDownload.status(),
      directStorageDenied: true,
      outsiderStatus: outsider.status(),
      revokedStatus: revoked.status(),
      lockWaitObserved: true,
      leaseBeforeWait,
      leaseAfterWait,
      delayedFailure: "stale",
      afterWait,
      reclaimedOutcomes,
      attempts: [...attempts],
      receiptCounts: [...counts],
      publicationReplays,
      pageErrors,
    });
  } finally {
    try {
      if (restoreViewer) {
        const restored = await fixture.retentionClient.rpc(
          "lukas_qto_set_project_member",
          {
            p_organization_id: fixture.organizationId,
            p_project_id: scope.projectId,
            p_email: fixture.viewer.email,
            p_role: "viewer",
            p_request_id: randomUUID(),
          },
        );
        expect(restored.error).toBeNull();
      }
      const evidencePath = testInfo.outputPath("native-dwg-export-jobs.json");
      await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
      await testInfo.attach("native-dwg-export-jobs", {
        path: evidencePath,
        contentType: "application/json",
      });
    } finally {
      await Promise.all([
        context.close(),
        viewerContext.close(),
        outsiderContext.close(),
        sql.end({ timeout: 5 }),
        lockSql.end({ timeout: 5 }),
        failSql.end({ timeout: 5 }),
      ]);
      await Promise.all([lockOutcome, failureOutcome]);
    }
  }
}
