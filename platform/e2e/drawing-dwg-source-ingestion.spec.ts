import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  expect,
  test,
  type BrowserContext,
  type Download,
  type Page,
} from "@playwright/test";

import { authenticateContext } from "./utils/drawing-collaboration-fixture";
import {
  createDrawingEstimatorFixture,
  type DrawingEstimatorFixture,
} from "./utils/drawing-estimator-fixture";

const baseUrl = "http://127.0.0.1:4000";
const dwgFixtureUrl = new URL(
  "../../docs/superpowers/evidence/2026-09-06-native-dwg-export-jobs/native.dwg",
  import.meta.url,
);
const dwgFilename = "1hk-public-synthetic-native.DWG";
const dwgSha256 =
  "7d94793d0d35631bd7068971202c686f076659f4836205aa88c3894d1bf77201";
const pdfFilename = "1hk-dwg-source-pdf-regression.pdf";

type StoredFile = {
  byte_size: number;
  content_type: string;
  id: string;
  immutable: boolean;
  kind: string;
  original_filename: string;
  project_id: string;
  sha256: string;
  storage_path: string;
};

let fixture: DrawingEstimatorFixture;
let dwgFile: StoredFile;

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function isTusRequest(url: string) {
  const pathname = new URL(url).pathname;
  return (
    pathname === "/storage/v1/upload/resumable" ||
    pathname.startsWith("/storage/v1/upload/resumable/")
  );
}

function isUploadVerifierRequest(url: string) {
  return new URL(url).pathname.endsWith(
    "/functions/v1/lukas-qto-upload-verify",
  );
}

function isUploadFinalizationRequest(url: string) {
  return new URL(url).pathname.endsWith("/files/finalize-upload");
}

function decodeTusMetadata(value: string | undefined) {
  if (!value) throw new Error("TUS upload metadata is missing");
  return Object.fromEntries(
    value.split(",").map((entry) => {
      const [key, encoded = ""] = entry.trim().split(" ", 2);
      if (!key) throw new Error("TUS upload metadata key is missing");
      return [key, Buffer.from(encoded, "base64").toString("utf8")];
    }),
  );
}

async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Playwright download stream is unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function uploadFromBrowser(
  page: Page,
  input: {
    bytes: Buffer;
    kind: "dwg" | "pdf";
    mimeType: string;
    name: string;
    verifierStatus: number;
  },
) {
  await page
    .getByRole("combobox", { name: "자료 종류" })
    .selectOption(input.kind);
  const fileInput = page.getByLabel("파일", { exact: true });
  await fileInput.setInputFiles({
    buffer: input.bytes,
    mimeType: input.mimeType,
    name: input.name,
  });
  expect(
    await fileInput.evaluate((element) => {
      const file = (element as HTMLInputElement).files?.[0];
      return file
        ? { name: file.name, size: file.size, type: file.type }
        : null;
    }),
  ).toEqual({
    name: input.name,
    size: input.bytes.byteLength,
    type: input.mimeType,
  });
  const tusCreation = page.waitForRequest(
    (request) => request.method() === "POST" && isTusRequest(request.url()),
    { timeout: 120_000 },
  );
  const tusCreationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isTusRequest(response.url()) &&
      response.status() >= 200 &&
      response.status() < 300,
    { timeout: 120_000 },
  );
  const verification = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isUploadVerifierRequest(response.url()) &&
      response.status() === input.verifierStatus,
    { timeout: 120_000 },
  );
  const finalization =
    input.verifierStatus === 200
      ? page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            isUploadFinalizationRequest(response.url()) &&
            response.status() === 200,
          { timeout: 120_000 },
        )
      : null;
  await page.getByRole("button", { name: "파일 업로드", exact: true }).click();
  const [creationRequest, creationResponse, verificationResponse] =
    await Promise.all([tusCreation, tusCreationResponse, verification]);
  if (finalization) await finalization;
  return {
    metadata: decodeTusMetadata(creationRequest.headers()["upload-metadata"]),
    tusStatus: creationResponse.status(),
    verifierStatus: verificationResponse.status(),
  };
}

async function storedFileByName(filename: string) {
  const result = await fixture.admin
    .from("lukas_qto_files")
    .select(
      "id,project_id,kind,original_filename,storage_path,content_type,byte_size,sha256,immutable",
    )
    .eq("project_id", fixture.projectId)
    .eq("original_filename", filename)
    .single();
  if (result.error) throw result.error;
  return result.data as StoredFile;
}

async function expectNoRows(
  table: "lukas_qto_files" | "lukas_qto_verified_uploads",
  column: string,
  value: string,
) {
  const result = await fixture.admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);
  if (result.error) throw result.error;
  expect(result.count).toBe(0);
}

async function downloadFileFromRow(page: Page, filename: string) {
  const row = page.getByRole("row").filter({ hasText: filename });
  await expect(row).toHaveCount(1);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    row.getByRole("link", { name: "다운로드", exact: true }).click(),
  ]);
  return downloadBytes(download);
}

test.describe
  .serial("DWG source ingestion on the marked disposable stack", () => {
  test.describe.configure({ timeout: 5 * 60_000 });
  test.use({ actionTimeout: 30_000 });

  test.beforeAll(async () => {
    if (process.env.M1_E2E_DISPOSABLE !== "1")
      throw new Error("DWG source E2E requires the disposable M1 runner");
    fixture = await createDrawingEstimatorFixture();
  });

  test("owner rejects invalid bytes, clears only the recovery journal, then stores exact DWG and PDF originals", async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    try {
      const page = await authenticateContext(
        fixture,
        context,
        fixture.owner,
        baseUrl,
        `/projects/${fixture.projectId}/files`,
      );
      const invalidName = "1hk-invalid-header.dwg";
      const invalidBytes = Buffer.from("ZZ1032-invalid-dwg-source", "ascii");
      const invalidUpload = await uploadFromBrowser(page, {
        bytes: invalidBytes,
        kind: "dwg",
        mimeType: "application/acad",
        name: invalidName,
        verifierStatus: 400,
      });
      expect(invalidUpload.metadata).toMatchObject({
        bucketName: "lukas-qto",
        contentType: "application/octet-stream",
      });
      expect(invalidUpload.tusStatus).toBeGreaterThanOrEqual(200);
      expect(invalidUpload.tusStatus).toBeLessThan(300);
      expect(invalidUpload.metadata.objectName).toMatch(
        new RegExp(
          `^${fixture.owner.id}/${fixture.projectId}/source-uploads/[0-9a-f-]{36}\\.dwg$`,
        ),
      );
      await expect(page.getByText(/파일 검증 실패/)).toBeVisible();
      await expect(
        page.getByText("원본 저장 완료 · 파일 등록 대기", { exact: true }),
      ).toBeVisible();
      await expectNoRows("lukas_qto_files", "original_filename", invalidName);
      await expectNoRows(
        "lukas_qto_verified_uploads",
        "storage_path",
        invalidUpload.metadata.objectName,
      );

      await page
        .getByRole("button", { name: "복구 기록 지우기", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "파일 업로드", exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByText("원본 저장 완료 · 파일 등록 대기", { exact: true }),
      ).toHaveCount(0);
      const retainedInvalid = await fixture.admin.storage
        .from("lukas-qto")
        .download(invalidUpload.metadata.objectName);
      if (retainedInvalid.error || !retainedInvalid.data)
        throw (
          retainedInvalid.error ??
          new Error("Rejected DWG source retention could not be verified")
        );
      const retainedInvalidBytes = Buffer.from(
        await retainedInvalid.data.arrayBuffer(),
      );
      expect(retainedInvalidBytes.byteLength).toBe(invalidBytes.byteLength);
      expect(sha256(retainedInvalidBytes)).toBe(sha256(invalidBytes));

      const dwgBytes = await readFile(dwgFixtureUrl);
      expect(dwgBytes.byteLength).toBe(13_387);
      expect(dwgBytes.subarray(0, 6).toString("ascii")).toBe("AC1024");
      expect(sha256(dwgBytes)).toBe(dwgSha256);
      const dwgUpload = await uploadFromBrowser(page, {
        bytes: dwgBytes,
        kind: "dwg",
        mimeType: "application/acad",
        name: dwgFilename,
        verifierStatus: 200,
      });
      expect(dwgUpload.metadata).toMatchObject({
        bucketName: "lukas-qto",
        contentType: "application/octet-stream",
      });
      expect(dwgUpload.tusStatus).toBeGreaterThanOrEqual(200);
      expect(dwgUpload.tusStatus).toBeLessThan(300);
      const desktopDwgRow = page
        .getByRole("row")
        .filter({ hasText: dwgFilename });
      await expect(desktopDwgRow).toBeVisible({ timeout: 120_000 });
      await expect(
        desktopDwgRow.getByText("원본 보관 완료 · 편집 호환성 미검증", {
          exact: true,
        }),
      ).toBeVisible();
      const desktopScreenshot = testInfo.outputPath("dwg-status-desktop.png");
      await desktopDwgRow.screenshot({ path: desktopScreenshot });
      await testInfo.attach("dwg-status-desktop", {
        contentType: "image/png",
        path: desktopScreenshot,
      });

      dwgFile = await storedFileByName(dwgFilename);
      expect(dwgFile).toEqual({
        byte_size: dwgBytes.byteLength,
        content_type: "application/octet-stream",
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        immutable: true,
        kind: "dwg",
        original_filename: dwgFilename,
        project_id: fixture.projectId,
        sha256: dwgSha256,
        storage_path: dwgUpload.metadata.objectName,
      });
      const verification = await fixture.admin
        .from("lukas_qto_verified_uploads")
        .select(
          "actor_id,project_id,kind,storage_path,original_filename,content_type,byte_size,sha256,consumed_file_id,dwg_header_version",
        )
        .eq("consumed_file_id", dwgFile.id)
        .single();
      if (verification.error) throw verification.error;
      expect(verification.data).toEqual({
        actor_id: fixture.owner.id,
        byte_size: dwgBytes.byteLength,
        consumed_file_id: dwgFile.id,
        content_type: "application/octet-stream",
        dwg_header_version: "AC1024",
        kind: "dwg",
        original_filename: dwgFilename,
        project_id: fixture.projectId,
        sha256: dwgSha256,
        storage_path: dwgFile.storage_path,
      });
      const [asCurrent, asPrevious, drawingDocuments] = await Promise.all([
        fixture.admin
          .from("lukas_qto_file_revisions")
          .select("id", { count: "exact", head: true })
          .eq("current_file_id", dwgFile.id),
        fixture.admin
          .from("lukas_qto_file_revisions")
          .select("id", { count: "exact", head: true })
          .eq("previous_file_id", dwgFile.id),
        fixture.admin
          .from("lukas_drawing_documents")
          .select("id", { count: "exact", head: true })
          .eq("source_file_id", dwgFile.id),
      ]);
      for (const result of [asCurrent, asPrevious, drawingDocuments]) {
        if (result.error) throw result.error;
        expect(result.count).toBe(0);
      }
      expect(sha256(await downloadFileFromRow(page, dwgFilename))).toBe(
        dwgSha256,
      );

      const sourcePdf = await fixture.admin
        .from("lukas_qto_files")
        .select("storage_path")
        .eq("id", fixture.pdfFileId)
        .single();
      if (sourcePdf.error) throw sourcePdf.error;
      const sourcePdfDownload = await fixture.admin.storage
        .from("lukas-qto")
        .download(sourcePdf.data.storage_path);
      if (sourcePdfDownload.error || !sourcePdfDownload.data)
        throw (
          sourcePdfDownload.error ?? new Error("PDF fixture is unavailable")
        );
      const pdfBytes = Buffer.from(await sourcePdfDownload.data.arrayBuffer());
      expect(pdfBytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      await uploadFromBrowser(page, {
        bytes: pdfBytes,
        kind: "pdf",
        mimeType: "application/pdf",
        name: pdfFilename,
        verifierStatus: 200,
      });
      const pdfFile = await storedFileByName(pdfFilename);
      await expect(page).toHaveURL(
        `${baseUrl}/projects/${fixture.projectId}/workspaces/new?sourceFileId=${pdfFile.id}`,
        { timeout: 120_000 },
      );
      await page.goto(`${baseUrl}/projects/${fixture.projectId}/files`);
      await expect(
        page.getByRole("row").filter({ hasText: pdfFilename }),
      ).toBeVisible({ timeout: 120_000 });
      expect(pdfFile).toMatchObject({
        byte_size: pdfBytes.byteLength,
        content_type: "application/pdf",
        immutable: true,
        kind: "pdf",
        sha256: sha256(pdfBytes),
      });
      const pdfEvidence = await fixture.admin
        .from("lukas_qto_verified_uploads")
        .select("consumed_file_id,dwg_header_version")
        .eq("consumed_file_id", pdfFile.id)
        .single();
      if (pdfEvidence.error) throw pdfEvidence.error;
      expect(pdfEvidence.data).toEqual({
        consumed_file_id: pdfFile.id,
        dwg_header_version: null,
      });
    } finally {
      await context.close();
    }
  });

  test("DWG status stays honest on mobile and Viewer receives read-only file access", async ({
    browser,
  }, testInfo) => {
    const ownerContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const viewerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    try {
      const ownerPage = await authenticateContext(
        fixture,
        ownerContext,
        fixture.owner,
        baseUrl,
        `/projects/${fixture.projectId}/files`,
      );
      const mobileFile = ownerPage
        .locator("li")
        .filter({ hasText: dwgFilename });
      await expect(mobileFile).toHaveCount(1);
      await expect(
        mobileFile.getByText("원본 보관 완료 · 편집 호환성 미검증", {
          exact: true,
        }),
      ).toBeVisible();
      const mobileScreenshot = testInfo.outputPath("dwg-status-mobile.png");
      await mobileFile.screenshot({ path: mobileScreenshot });
      await testInfo.attach("dwg-status-mobile", {
        contentType: "image/png",
        path: mobileScreenshot,
      });

      const viewerPage = await authenticateContext(
        fixture,
        viewerContext,
        fixture.viewer,
        baseUrl,
        `/projects/${fixture.projectId}/files`,
      );
      await expect(
        viewerPage.getByRole("heading", { name: "파일 추가", exact: true }),
      ).toHaveCount(0);
      const viewerRow = viewerPage
        .getByRole("row")
        .filter({ hasText: dwgFilename });
      await expect(viewerRow).toHaveCount(1);
      await expect(
        viewerRow.getByText("원본 보관 완료 · 편집 호환성 미검증", {
          exact: true,
        }),
      ).toBeVisible();
      expect(sha256(await downloadFileFromRow(viewerPage, dwgFilename))).toBe(
        dwgFile.sha256,
      );
    } finally {
      await Promise.all([ownerContext.close(), viewerContext.close()]);
    }
  });
});
