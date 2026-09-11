import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import {
  expect,
  test,
  type BrowserContext,
  type Download,
  type Page,
} from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { runIsolatedNativeDrawingDwgReader } from "../app/lukas/lib/drawing-native-dwg-sandbox.server";
import { DrawingOperationInputSchema } from "../app/lukas/lib/drawing-workspace.types";
import { runNativeDrawingDwgImportWorkerOnce } from "../app/lukas/lib/drawing-native-dwg-import-worker.server";
import { parseNativeDrawingDwgImportWorkerConfig } from "../native-dwg-worker/src/import";
import {
  createNativeDrawingDwgImportRpcFetch,
  createNativeDrawingDwgImportSourceTransport,
  createSupabaseNativeDrawingDwgImportDependencies,
} from "../native-dwg-worker/src/import-supabase";
import {
  parseNativeDrawingDwgResaveWorkerConfig,
  runNativeDrawingDwgResaveWorkerOnce,
} from "../native-dwg-worker/src/resave";
import { createNativeDwgResaveStorageTransport } from "../native-dwg-worker/src/supabase";
import { verifyDisposableSupabaseAuthority } from "../scripts/run-drawing-workspace-m1-e2e.mjs";
import {
  authenticateApiClient,
  authenticateContext,
  createDrawingFixture,
  type DrawingFixture,
} from "./utils/drawing-collaboration-fixture";

const baseUrl = "http://127.0.0.1:4000";
const imageId =
  "sha256:c921c67ddb37d2a57969d04c7a4983f6d847e0b89901403e3b015ac25bf566ae";
const sourceSha256 =
  "bcc54d3c768444c9ade41a23e4ef2b9f5b5668d9972522ee4a4adbc98c670434";
const sourceUrl = new URL(
  "../../docs/superpowers/evidence/2026-09-06-native-dwg-resave-protocol/controller/actual/source/synthetic-input.dwg",
  import.meta.url,
);
const sourceFilename = "1hk-public-resave-source.dwg";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function isTusRequest(url: string) {
  const pathname = new URL(url).pathname;
  return (
    pathname === "/storage/v1/upload/resumable" ||
    pathname.startsWith("/storage/v1/upload/resumable/")
  );
}

function decodeTusMetadata(value: string | undefined) {
  if (!value) throw new Error("TUS upload metadata is missing");
  return Object.fromEntries(
    value.split(",").map((entry) => {
      const [key, encoded = ""] = entry.trim().split(" ", 2);
      return [key, Buffer.from(encoded, "base64").toString("utf8")];
    }),
  );
}

async function uploadDwgFromBrowser(page: Page, bytes: Buffer) {
  await page.getByRole("combobox", { name: "자료 종류" }).selectOption("dwg");
  await page.getByLabel("파일", { exact: true }).setInputFiles({
    buffer: bytes,
    mimeType: "application/acad",
    name: sourceFilename,
  });
  const creation = page.waitForRequest(
    (request) => request.method() === "POST" && isTusRequest(request.url()),
    { timeout: 120_000 },
  );
  const verification = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith(
        "/functions/v1/lukas-qto-upload-verify",
      ) &&
      response.status() === 200,
    { timeout: 120_000 },
  );
  const finalization = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/files/finalize-upload") &&
      response.status() === 200,
    { timeout: 120_000 },
  );
  await page.getByRole("button", { name: "파일 업로드", exact: true }).click();
  const [request] = await Promise.all([creation, verification, finalization]);
  return decodeTusMetadata(request.headers()["upload-metadata"]);
}

async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Playwright download stream is unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function workspacePath(fixture: DrawingFixture) {
  return `/projects/${fixture.projectId}/workspaces/${fixture.blankWorkspace.documentId}`;
}

function resourcePath(fixture: DrawingFixture) {
  return `${workspacePath(fixture)}/native-dwg-resave`;
}

function scopeSearch(scope: Record<string, string | number>) {
  return new URLSearchParams(
    Object.fromEntries(
      Object.entries(scope)
        .filter(([key]) => key !== "projectId" && key !== "documentId")
        .map(([key, value]) => [key, String(value)]),
    ),
  );
}

function serviceClient(config: {
  supabaseUrl: string;
  serviceRoleKey: string;
}) {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: createNativeDrawingDwgImportRpcFetch(config.supabaseUrl) },
  });
}

function resaveDependencies(
  config: ReturnType<typeof parseNativeDrawingDwgResaveWorkerConfig>,
) {
  const base = {
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
  };
  return {
    serviceClient: serviceClient(base),
    downloadSource:
      createNativeDrawingDwgImportSourceTransport(base).downloadSource,
    storage: createNativeDwgResaveStorageTransport(base),
  };
}

async function revisionStatus(fixture: DrawingFixture) {
  const result = await fixture.admin
    .from("lukas_drawing_revisions")
    .select("id,status,version")
    .eq("id", fixture.blankWorkspace.revisionId)
    .single();
  if (result.error) throw result.error;
  return result.data;
}

test.describe.serial("actual imported DWG resave publication", () => {
  test.describe.configure({ timeout: 15 * 60_000 });
  test.use({ actionTimeout: 30_000 });

  test("uploads, imports, edits, approves, resaves, rereads, restores and enforces authority", async ({
    browser,
  }, testInfo) => {
    const authority = verifyDisposableSupabaseAuthority(process.env);
    const importConfig = parseNativeDrawingDwgImportWorkerConfig(process.env);
    const resaveConfig = parseNativeDrawingDwgResaveWorkerConfig(process.env);
    expect(importConfig.supabaseUrl).toBe(authority.supabaseUrl);
    expect(resaveConfig.supabaseUrl).toBe(authority.supabaseUrl);
    expect(importConfig.readerImageId).toBe(imageId);
    expect(resaveConfig.resaverImageId).toBe(imageId);
    const imageInspection = execFileSync(
      resaveConfig.dockerPath,
      [
        "--host",
        resaveConfig.dockerHost,
        "image",
        "inspect",
        imageId,
        "--format",
        '{{.Id}} {{index .Config.Labels "org.1hk.native-dwg-reader.protocol"}} {{index .Config.Labels "org.1hk.native-dwg-resaver.protocol"}}',
      ],
      { encoding: "utf8" },
    ).trim();
    expect(imageInspection).toBe(
      `${imageId} 1hk-dwg-import/1 1hk-dwg-resave/1`,
    );

    const sourceBytes = await readFile(sourceUrl);
    expect(sourceBytes.byteLength).toBe(10_987);
    expect(sourceBytes.subarray(0, 6).toString("ascii")).toBe("AC1024");
    expect(sha256(sourceBytes)).toBe(sourceSha256);
    const baseline = await runIsolatedNativeDrawingDwgReader({
      dockerPath: importConfig.dockerPath,
      dockerHost: importConfig.dockerHost,
      imageId,
      sourceBytes,
      expectedSource: {
        sha256: sourceSha256,
        byteSize: sourceBytes.byteLength,
        headerVersion: "AC1024",
      },
    });
    expect(
      baseline.entities.find((entity) => entity.handle === "4A"),
    ).toMatchObject({
      type: "LINE",
      geometry: { start: [0, 0, 0], end: [100, 0, 0] },
    });
    expect(baseline.coverage).toEqual({
      importedEntities: 5,
      unsupportedEntities: 1,
      modelSpaceEntities: 6,
      nonModelSpaceEntities: 3,
    });
    expect(baseline.unsupported).toEqual([
      {
        type: "INSERT",
        reason: "unsupported_type",
        count: 1,
        sampleHandles: ["54"],
      },
    ]);

    const fixture = await createDrawingFixture();
    const ownerContext = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1000 },
    });
    const editorContext = await browser.newContext({ baseURL: baseUrl });
    const reviewerContext = await browser.newContext({ baseURL: baseUrl });
    const approverContext = await browser.newContext({
      baseURL: baseUrl,
      viewport: { width: 1440, height: 1000 },
    });
    const viewerContext = await browser.newContext({ baseURL: baseUrl });
    const outsiderContext = await browser.newContext({ baseURL: baseUrl });
    const pageErrors: string[] = [];
    let releaseCancellation: (() => void) | undefined;
    try {
      const ownerPage = await authenticateContext(
        fixture,
        ownerContext,
        fixture.owner,
        baseUrl,
        `/projects/${fixture.projectId}/files`,
      );
      ownerPage.on("pageerror", (error) => pageErrors.push(error.message));
      await expect(
        ownerPage.getByRole("heading", { name: "파일 추가", exact: true }),
      ).toBeVisible();
      const availabilityPath = testInfo.outputPath("owned-app-available.png");
      await ownerPage.screenshot({ path: availabilityPath });
      await testInfo.attach("owned-app-available", {
        path: availabilityPath,
        contentType: "image/png",
      });

      const tusMetadata = await uploadDwgFromBrowser(ownerPage, sourceBytes);
      const fileResult = await fixture.admin
        .from("lukas_qto_files")
        .select(
          "id,project_id,kind,original_filename,storage_path,content_type,byte_size,sha256,immutable",
        )
        .eq("project_id", fixture.projectId)
        .eq("original_filename", sourceFilename)
        .single();
      if (fileResult.error) throw fileResult.error;
      const sourceFile = fileResult.data;
      expect(sourceFile).toMatchObject({
        project_id: fixture.projectId,
        kind: "dwg",
        original_filename: sourceFilename,
        content_type: "application/octet-stream",
        byte_size: 10_987,
        sha256: sourceSha256,
        immutable: true,
        storage_path: tusMetadata.objectName,
      });
      const originalDownload = await fixture.admin.storage
        .from("lukas-qto")
        .download(sourceFile.storage_path);
      if (originalDownload.error || !originalDownload.data)
        throw (
          originalDownload.error ?? new Error("Original source is unavailable")
        );
      expect(
        sha256(Buffer.from(await originalDownload.data.arrayBuffer())),
      ).toBe(sourceSha256);

      await ownerPage.goto(`${baseUrl}${workspacePath(fixture)}`);
      const importRegion = ownerPage.getByRole("region", {
        name: "DWG 편집 가져오기",
      });
      await expect(importRegion).toBeVisible();
      await importRegion
        .getByRole("combobox", { name: "DWG 원본" })
        .selectOption(sourceFile.id);
      await importRegion
        .getByRole("combobox", { name: "DWG 단위" })
        .selectOption("");
      const importAdmission = ownerPage.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response
            .request()
            .postData()
            ?.includes("request_native_dwg_import") === true,
      );
      await importRegion
        .getByRole("button", { name: "DWG 분석 시작", exact: true })
        .click();
      expect((await importAdmission).status()).toBe(200);
      await expect(importRegion).toContainText(/분석 대기|분석 중/);

      const importClient = serviceClient(importConfig);
      const importDependencies =
        createSupabaseNativeDrawingDwgImportDependencies(importClient, {
          supabaseUrl: importConfig.supabaseUrl,
          serviceRoleKey: importConfig.serviceRoleKey,
          readerImageId: importConfig.readerImageId,
          dockerPath: importConfig.dockerPath,
          dockerHost: importConfig.dockerHost,
          leaseSeconds: importConfig.leaseSeconds,
        });
      expect(
        await runNativeDrawingDwgImportWorkerOnce(importDependencies),
      ).toBe("analyzed");
      await importRegion
        .getByRole("button", { name: "분석 상태 확인", exact: true })
        .click();
      await expect(importRegion).toContainText("분석 완료", {
        timeout: 30_000,
      });
      await importRegion
        .getByRole("button", { name: "편집 객체로 가져오기", exact: true })
        .click();
      await expect(importRegion).toContainText("가져오기 처리 완료", {
        timeout: 45_000,
      });
      await expect(
        ownerPage.getByText("저장됨", { exact: true }).first(),
      ).toBeVisible({
        timeout: 45_000,
      });

      const sourceRows = await fixture.admin
        .from("lukas_drawing_object_sources")
        .select(
          "id,object_id,source_file_id,source_sha256,source_kind,dwg_entity_json",
        )
        .eq("revision_id", fixture.blankWorkspace.revisionId)
        .eq("source_kind", "dwg_entity");
      if (sourceRows.error) throw sourceRows.error;
      expect(sourceRows.data).toHaveLength(5);
      expect(
        sourceRows.data?.map((row) => row.dwg_entity_json.handle).sort(),
      ).toEqual(["4A", "4B", "4C", "4D", "4E"]);
      expect(
        sourceRows.data?.every(
          (row) =>
            row.source_file_id === sourceFile.id &&
            row.source_sha256 === sourceSha256 &&
            row.source_kind === "dwg_entity",
        ),
      ).toBe(true);
      const lineSource = sourceRows.data?.find(
        (row) => row.dwg_entity_json.handle === "4A",
      );
      if (!lineSource) throw new Error("LINE 4A source binding is absent");
      const lineBefore = await fixture.admin
        .from("lukas_drawing_objects")
        .select("id,geometry,version")
        .eq("id", lineSource.object_id)
        .single();
      if (lineBefore.error) throw lineBefore.error;
      expect(lineBefore.data.geometry).toMatchObject({
        type: "line",
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
      });

      const editorPage = await authenticateContext(
        fixture,
        editorContext,
        fixture.editor,
        baseUrl,
        workspacePath(fixture),
      );
      editorPage.on("pageerror", (error) => pageErrors.push(error.message));
      const editedGeometry = {
        ...lineBefore.data.geometry,
        end: { x: 120, y: 21 },
      };
      const operation = DrawingOperationInputSchema.parse({
        clientOperationId: randomUUID(),
        revisionId: fixture.blankWorkspace.revisionId,
        type: "update_objects",
        baseVersions: { [lineBefore.data.id]: lineBefore.data.version },
        forward: {
          type: "update_objects",
          updates: [
            {
              objectId: lineBefore.data.id,
              patch: { geometry: editedGeometry },
            },
          ],
        },
        inverse: {
          type: "update_objects",
          updates: [
            {
              objectId: lineBefore.data.id,
              patch: { geometry: lineBefore.data.geometry },
            },
          ],
        },
        createdAt: new Date().toISOString(),
      });
      const editResponse = await editorContext.request.post(
        `${workspacePath(fixture)}/operation?revision=${fixture.blankWorkspace.revisionId}`,
        {
          form: {
            intent: "apply_operation",
            operation_json: JSON.stringify(operation),
          },
        },
      );
      expect(editResponse.status()).toBe(200);
      await expect
        .poll(async () => {
          const row = await fixture.admin
            .from("lukas_drawing_objects")
            .select("geometry")
            .eq("id", lineBefore.data.id)
            .single();
          if (row.error) throw row.error;
          return row.data.geometry;
        })
        .toMatchObject({
          type: "line",
          start: { x: 0, y: 0 },
          end: { x: 120, y: 21 },
        });
      await editorPage.reload();
      await expect(
        editorPage.getByText("저장됨", { exact: true }).first(),
      ).toBeVisible({
        timeout: 45_000,
      });

      const viewerApi = await authenticateApiClient(fixture, fixture.viewer);
      const viewerMutation = await viewerApi.rpc(
        "lukas_drawing_apply_operation",
        {
          p_revision_id: fixture.blankWorkspace.revisionId,
          p_client_operation_id: randomUUID(),
          p_operation_type: "update_objects",
          p_base_versions: {
            [lineBefore.data.id]: lineBefore.data.version + 1,
          },
          p_forward: operation.forward,
          p_inverse: operation.inverse,
        },
      );
      expect(viewerMutation.error).not.toBeNull();
      const viewerPage = await authenticateContext(
        fixture,
        viewerContext,
        fixture.viewer,
        baseUrl,
        workspacePath(fixture),
      );
      await expect(
        viewerPage.getByRole("button", { name: "검토 요청", exact: true }),
      ).toHaveCount(0);
      await expect(
        viewerPage.getByRole("button", {
          name: /도면 (검토 완료|최종 승인)/,
        }),
      ).toHaveCount(0);

      await editorPage
        .getByRole("button", { name: "검토 요청", exact: true })
        .click();
      await expect
        .poll(async () => (await revisionStatus(fixture)).status)
        .toBe("review_requested");
      const reviewerPage = await authenticateContext(
        fixture,
        reviewerContext,
        fixture.reviewer,
        baseUrl,
        workspacePath(fixture),
      );
      await reviewerPage
        .getByLabel("검토 의견")
        .fill("Imported DWG endpoint review");
      await reviewerPage
        .getByRole("button", { name: "도면 검토 완료", exact: true })
        .click();
      await expect
        .poll(async () => (await revisionStatus(fixture)).status)
        .toBe("reviewed");
      const approverPage = await authenticateContext(
        fixture,
        approverContext,
        fixture.approver,
        baseUrl,
        workspacePath(fixture),
      );
      approverPage.on("pageerror", (error) => pageErrors.push(error.message));
      await approverPage
        .getByLabel("검토 의견")
        .fill("Imported DWG endpoint approval");
      await approverPage
        .getByRole("button", { name: "도면 최종 승인", exact: true })
        .click();
      await expect
        .poll(async () => (await revisionStatus(fixture)).status)
        .toBe("approved");
      const approvals = await fixture.admin
        .from("lukas_drawing_revision_approvals")
        .select("decision,decided_by,snapshot_sha256,subject_version")
        .eq("revision_id", fixture.blankWorkspace.revisionId)
        .in("decision", ["reviewed", "approved"])
        .order("created_at");
      if (approvals.error) throw approvals.error;
      expect(approvals.data?.map((row) => row.decision)).toEqual([
        "reviewed",
        "approved",
      ]);
      expect(approvals.data?.map((row) => row.decided_by)).toEqual([
        fixture.reviewer.id,
        fixture.approver.id,
      ]);
      const approval = approvals.data?.[1];
      if (!approval) throw new Error("Approved snapshot is absent");
      const scope = {
        projectId: fixture.projectId,
        documentId: fixture.blankWorkspace.documentId,
        revisionId: fixture.blankWorkspace.revisionId,
        revisionVersion: approval.subject_version,
        canvasId: fixture.blankWorkspace.canvasId,
        snapshotSha256: approval.snapshot_sha256,
      };

      await approverPage.reload();
      let resavePosts = 0;
      approverPage.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === resourcePath(fixture)
        )
          resavePosts++;
      });
      await approverPage
        .getByRole("button", { name: "내보내기", exact: true })
        .click();
      const dialog = approverPage.getByRole("dialog", {
        name: "도면 내보내기",
      });
      await dialog
        .getByRole("radio", { name: "DWG (시험)", exact: true })
        .check();
      await expect(
        dialog.getByRole("button", { name: "DWG 재저장 요청", exact: true }),
      ).toBeEnabled();
      await expect(
        dialog.getByRole("button", { name: "시험용 DWG 만들기", exact: true }),
      ).toHaveCount(0);
      expect(resavePosts).toBe(0);
      const readyPath = testInfo.outputPath("imported-dwg-resave-ready.png");
      await dialog.screenshot({ path: readyPath });
      await testInfo.attach("imported-dwg-resave-ready", {
        path: readyPath,
        contentType: "image/png",
      });

      let failNextStatus = true;
      await approverPage.route(
        `${baseUrl}${resourcePath(fixture)}?**`,
        async (route) => {
          if (route.request().method() === "GET" && failNextStatus) {
            failNextStatus = false;
            await route.fulfill({ status: 503, body: "finite status fault" });
          } else await route.continue();
        },
      );
      const admissionResponse = approverPage.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === resourcePath(fixture),
      );
      await dialog
        .getByRole("button", { name: "DWG 재저장 요청", exact: true })
        .click();
      const admitted = await admissionResponse;
      expect(admitted.status()).toBe(202);
      const admissionRequest = admitted.request().postDataJSON();
      expect(admissionRequest).toEqual({
        intent: "request",
        ...scope,
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
      expect(Object.keys(admissionRequest).sort()).toEqual(
        [
          "intent",
          "projectId",
          "documentId",
          "revisionId",
          "revisionVersion",
          "canvasId",
          "snapshotSha256",
          "requestId",
        ].sort(),
      );
      const acceptance = await admitted.json();
      expect(acceptance).toEqual({
        jobId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        requestId: admissionRequest.requestId,
        hasChanges: true,
      });
      await expect(dialog.getByRole("alert")).toBeVisible({ timeout: 10_000 });
      const replayResponse = approverPage.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === resourcePath(fixture),
      );
      await dialog
        .getByRole("button", { name: "DWG 재저장 요청", exact: true })
        .click();
      const replayed = await replayResponse;
      expect(replayed.status()).toBe(202);
      expect(replayed.request().postDataJSON()).toEqual(admissionRequest);
      expect(await replayed.json()).toEqual(acceptance);
      await approverPage.unroute(`${baseUrl}${resourcePath(fixture)}?**`);

      const workerResult = await runNativeDrawingDwgResaveWorkerOnce(
        resaveConfig,
        resaveDependencies(resaveConfig),
      );
      expect(workerResult.outcome).toBe("completed");
      await expect(
        dialog.getByText("재저장 완료", { exact: true }),
      ).toBeVisible({
        timeout: 30_000,
      });
      const search = scopeSearch(scope);
      const statusResponse = await approverContext.request.get(
        `${resourcePath(fixture)}?${search}&jobId=${acceptance.jobId}`,
      );
      expect(statusResponse.status()).toBe(200);
      expect(statusResponse.headers()).toMatchObject({
        "cache-control": "private, no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      });
      const completed = await statusResponse.json();
      expect(completed.job).toMatchObject({
        jobId: acceptance.jobId,
        requestId: admissionRequest.requestId,
        status: "completed",
        attemptCount: 1,
        failureCode: null,
        hasChanges: true,
      });
      expect(completed.receipt).toMatchObject({
        schemaVersion: "1hk-dwg-resave-receipt/1",
        jobId: acceptance.jobId,
        attemptNumber: 1,
        scope,
        resaverImageId: imageId,
        sourceSha256,
        qualification: "experimental-unqualified",
        persistenceAuthority: "not-issued",
      });
      expect(
        completed.receipt.artifacts.map((item: { kind: string }) => item.kind),
      ).toEqual(["dwg", "edit_request", "authority", "report"]);
      expect(JSON.stringify({ acceptance, completed })).not.toMatch(
        /bucket|storage[_A-Z]?path|lease|service[_A-Z]?role/i,
      );

      const labels = {
        dwg: "DWG 다운로드",
        edit_request: "편집 요청 다운로드",
        authority: "권한 증거 다운로드",
        report: "네이티브 보고서 다운로드",
      } as const;
      const downloaded: Record<string, Buffer> = {};
      for (const artifact of completed.receipt.artifacts) {
        const link = dialog.getByRole("link", {
          name: labels[artifact.kind as keyof typeof labels],
          exact: true,
        });
        const href = await link.getAttribute("href");
        expect(href).not.toBeNull();
        const response = await approverContext.request.get(href!);
        expect(response.status()).toBe(200);
        expect(response.headers()).toMatchObject({
          "cache-control": "private, no-store",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
          "content-disposition": expect.stringContaining(
            "attachment; filename=",
          ),
        });
        const [download] = await Promise.all([
          approverPage.waitForEvent("download"),
          link.click(),
        ]);
        const bytes = await downloadBytes(download);
        expect({ sha256: sha256(bytes), byteSize: bytes.byteLength }).toEqual({
          sha256: artifact.sha256,
          byteSize: artifact.byteSize,
        });
        expect(sha256(await response.body())).toBe(artifact.sha256);
        downloaded[artifact.kind] = bytes;
      }
      const completedPath = testInfo.outputPath(
        "imported-dwg-resave-completed.png",
      );
      await dialog.screenshot({ path: completedPath });
      await testInfo.attach("imported-dwg-resave-completed", {
        path: completedPath,
        contentType: "image/png",
      });
      const dwgOutput = testInfo.outputPath("resaved.dwg");
      await writeFile(dwgOutput, downloaded.dwg);
      await testInfo.attach("resaved-dwg", {
        path: dwgOutput,
        contentType: "application/acad",
      });
      const reread = await runIsolatedNativeDrawingDwgReader({
        dockerPath: importConfig.dockerPath,
        dockerHost: importConfig.dockerHost,
        imageId,
        sourceBytes: downloaded.dwg,
        expectedSource: {
          sha256: completed.receipt.artifacts[0].sha256,
          byteSize: completed.receipt.artifacts[0].byteSize,
          headerVersion: "AC1024",
        },
      });
      expect(
        reread.entities.find((entity) => entity.handle === "4A"),
      ).toMatchObject({
        type: "LINE",
        geometry: { start: [0, 0, 0], end: [120, 21, 0] },
      });
      for (const handle of ["4B", "4C", "4D", "4E"])
        expect(
          reread.entities.find((entity) => entity.handle === handle),
        ).toEqual(baseline.entities.find((entity) => entity.handle === handle));
      expect(reread.layers).toEqual(baseline.layers);
      expect(reread.coverage).toEqual(baseline.coverage);
      expect(reread.unsupported).toEqual(baseline.unsupported);

      const viewerDownloadPath = `${resourcePath(fixture)}/${acceptance.jobId}/download/dwg?${search}`;
      const viewerDownload =
        await viewerContext.request.get(viewerDownloadPath);
      expect(viewerDownload.status()).toBe(200);
      expect(sha256(await viewerDownload.body())).toBe(
        completed.receipt.artifacts[0].sha256,
      );
      const descriptor = await viewerApi.rpc(
        "lukas_drawing_native_dwg_resave_download_descriptor",
        { p_scope: scope, p_job_id: acceptance.jobId, p_kind: "dwg" },
      );
      expect(descriptor.error).toBeNull();
      for (const result of [
        await viewerApi.storage
          .from("lukas-qto")
          .download(descriptor.data.path),
        await viewerApi.storage
          .from("lukas-qto")
          .upload(descriptor.data.path, Buffer.from("forbidden"), {
            upsert: false,
          }),
        await viewerApi.storage
          .from("lukas-qto")
          .update(descriptor.data.path, Buffer.from("forbidden")),
        await viewerApi.storage
          .from("lukas-qto")
          .remove([descriptor.data.path]),
      ])
        expect(result.error).not.toBeNull();
      const anonymous = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_ANON_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      for (const result of [
        await anonymous.storage
          .from("lukas-qto")
          .download(descriptor.data.path),
        await anonymous.storage
          .from("lukas-qto")
          .upload(descriptor.data.path, Buffer.from("forbidden"), {
            upsert: false,
          }),
        await anonymous.storage
          .from("lukas-qto")
          .update(descriptor.data.path, Buffer.from("forbidden")),
        await anonymous.storage
          .from("lukas-qto")
          .remove([descriptor.data.path]),
      ])
        expect(result.error).not.toBeNull();
      await authenticateContext(
        fixture,
        outsiderContext,
        fixture.nonMember,
        baseUrl,
        "/",
      );
      for (const target of [
        `${resourcePath(fixture)}?${search}&jobId=${acceptance.jobId}`,
        viewerDownloadPath,
      ]) {
        const denied = await outsiderContext.request.get(target, {
          maxRedirects: 0,
        });
        expect([403, 404]).toContain(denied.status());
      }
      const removed = await fixture.retentionClient.rpc(
        "lukas_qto_remove_project_member",
        {
          p_organization_id: fixture.organizationId,
          p_project_id: fixture.projectId,
          p_user_id: fixture.viewer.id,
          p_reason: "Disposable imported DWG revocation proof",
          p_request_id: randomUUID(),
        },
      );
      expect(removed.error).toBeNull();
      const revoked = await viewerContext.request.get(viewerDownloadPath, {
        maxRedirects: 0,
      });
      expect([403, 404]).toContain(revoked.status());
      const restored = await fixture.retentionClient.rpc(
        "lukas_qto_set_project_member",
        {
          p_organization_id: fixture.organizationId,
          p_project_id: fixture.projectId,
          p_email: fixture.viewer.email,
          p_role: "viewer",
          p_request_id: randomUUID(),
        },
      );
      expect(restored.error).toBeNull();

      await approverPage
        .getByRole("button", { name: "닫기", exact: true })
        .click();
      await approverPage
        .getByRole("link", { name: "로그아웃", exact: true })
        .click();
      await expect(approverPage).toHaveURL(/\/auth\/sign-in/);
      const reloginPage = await authenticateContext(
        fixture,
        approverContext,
        fixture.approver,
        baseUrl,
        workspacePath(fixture),
      );
      let reloginPosts = 0;
      reloginPage.on("request", (request) => {
        if (
          request.method() === "POST" &&
          new URL(request.url()).pathname === resourcePath(fixture)
        )
          reloginPosts++;
      });
      await reloginPage
        .getByRole("button", { name: "내보내기", exact: true })
        .click();
      const reloginDialog = reloginPage.getByRole("dialog", {
        name: "도면 내보내기",
      });
      await reloginDialog
        .getByRole("radio", { name: "DWG (시험)", exact: true })
        .check();
      await expect(
        reloginDialog.getByRole("link", { name: "DWG 다운로드", exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      expect(reloginPosts).toBe(0);
      const [redownload] = await Promise.all([
        reloginPage.waitForEvent("download"),
        reloginDialog
          .getByRole("link", { name: "DWG 다운로드", exact: true })
          .click(),
      ]);
      expect(sha256(await downloadBytes(redownload))).toBe(
        completed.receipt.artifacts[0].sha256,
      );
      const originalAfter = await fixture.admin.storage
        .from("lukas-qto")
        .download(sourceFile.storage_path);
      if (originalAfter.error || !originalAfter.data)
        throw originalAfter.error ?? new Error("Original source disappeared");
      expect(sha256(Buffer.from(await originalAfter.data.arrayBuffer()))).toBe(
        sourceSha256,
      );
      const metadataAfter = await fixture.admin
        .from("lukas_qto_files")
        .select("id,sha256,byte_size,immutable,storage_path")
        .eq("id", sourceFile.id)
        .single();
      if (metadataAfter.error) throw metadataAfter.error;
      expect(metadataAfter.data).toEqual({
        id: sourceFile.id,
        sha256: sourceSha256,
        byte_size: 10_987,
        immutable: true,
        storage_path: sourceFile.storage_path,
      });

      const cancellationRequest = {
        intent: "request",
        ...scope,
        requestId: randomUUID(),
      };
      const cancellationAdmission = await approverContext.request.post(
        resourcePath(fixture),
        { data: cancellationRequest, headers: { Origin: baseUrl } },
      );
      expect(cancellationAdmission.status()).toBe(202);
      const cancellation = await cancellationAdmission.json();
      let enteredCancellation!: () => void;
      const cancellationEntered = new Promise<void>((resolve) => {
        enteredCancellation = resolve;
      });
      const cancellationGate = new Promise<void>((resolve) => {
        releaseCancellation = resolve;
      });
      const cancellationWorker = runNativeDrawingDwgResaveWorkerOnce(
        resaveConfig,
        {
          ...resaveDependencies(resaveConfig),
          async resave(input) {
            enteredCancellation();
            await cancellationGate;
            const { runIsolatedNativeDrawingDwgResaver } = await import(
              "../app/lukas/lib/drawing-native-dwg-sandbox.server"
            );
            return runIsolatedNativeDrawingDwgResaver(input);
          },
        },
      );
      await cancellationEntered;
      const foreignCancel = await viewerContext.request.post(
        resourcePath(fixture),
        {
          data: { intent: "cancel", ...scope, jobId: cancellation.jobId },
          headers: { Origin: baseUrl },
          maxRedirects: 0,
        },
      );
      expect([403, 404]).toContain(foreignCancel.status());
      const cancelResponse = await approverContext.request.post(
        resourcePath(fixture),
        {
          data: { intent: "cancel", ...scope, jobId: cancellation.jobId },
          headers: { Origin: baseUrl },
        },
      );
      expect(cancelResponse.status()).toBe(200);
      expect((await cancelResponse.json()).job.status).toBe("cancel_requested");
      const release = releaseCancellation;
      if (!release) throw new Error("Cancellation gate was not installed");
      release();
      releaseCancellation = undefined;
      expect((await cancellationWorker).outcome).toBe("cancelled");
      const cancelledStatus = await approverContext.request.get(
        `${resourcePath(fixture)}?${search}&jobId=${cancellation.jobId}`,
      );
      expect(cancelledStatus.status()).toBe(200);
      expect(await cancelledStatus.json()).toMatchObject({
        job: { status: "cancelled", jobId: cancellation.jobId },
        receipt: null,
      });
      expect(pageErrors).toEqual([]);

      const evidencePath = testInfo.outputPath(
        "native-dwg-resave-evidence.json",
      );
      await writeFile(
        evidencePath,
        `${JSON.stringify(
          {
            status: "passed",
            disposable: {
              projectId: authority.projectId,
              supabaseOrigin: authority.supabaseUrl,
            },
            imageId,
            source: { sha256: sourceSha256, byteSize: sourceBytes.byteLength },
            scope,
            admission: acceptance,
            retry: { sameRequestId: true, sameJobId: true },
            receipt: completed.receipt,
            semanticReadback: {
              line4A: reread.entities.find((entity) => entity.handle === "4A"),
              unchangedHandles: ["4B", "4C", "4D", "4E"],
              layers: "deep-equal",
              coverage: reread.coverage,
              unsupported: reread.unsupported,
              independentCadQualification: "not-performed",
            },
            cancellation: { jobId: cancellation.jobId, status: "cancelled" },
            authority: {
              viewerDownload: 200,
              viewerMutationDenied: true,
              directStorageDenied: true,
              outsiderDenied: true,
              revokedDenied: true,
            },
            reloginRestored: true,
            originalUnchanged: true,
            pageErrors,
          },
          null,
          2,
        )}\n`,
      );
      await testInfo.attach("native-dwg-resave-evidence", {
        path: evidencePath,
        contentType: "application/json",
      });
    } finally {
      releaseCancellation?.();
      await Promise.all([
        ownerContext.close(),
        editorContext.close(),
        reviewerContext.close(),
        approverContext.close(),
        viewerContext.close(),
        outsiderContext.close(),
      ]);
    }
  });
});
