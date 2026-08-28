import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";

const previewPath = "/workspace-preview/drawing-workspace?p5IfcTest=1&view=2d";

async function openP5Preview(page: Page) {
  page.setDefaultTimeout(15_000);
  await page.goto(previewPath, {
    timeout: 30_000,
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect(
    page.getByRole("group", { name: "도면 작업실 보기" }),
  ).toBeVisible();
}

async function changedPixelRatio(page: Page, screenshot: Buffer) {
  return page.evaluate(async (encoded) => {
    const image = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${encoded}`)).blob(),
    );
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas 2D context is unavailable.");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const background = [pixels[0], pixels[1], pixels[2]];
    let changed = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const delta =
        Math.abs(pixels[index] - background[0]) +
        Math.abs(pixels[index + 1] - background[1]) +
        Math.abs(pixels[index + 2] - background[2]);
      if (delta > 24) changed += 1;
    }
    image.close();
    return changed / (canvas.width * canvas.height);
  }, screenshot.toString("base64"));
}

test.describe.configure({ mode: "serial", timeout: 120_000 });

test("manual P5 PDF preview serves current and opt-in predecessor bytes without interception", async ({
  page,
}) => {
  const resourceResponses: Array<{ path: string; status: number }> = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (path === "/__p5-current.pdf" || path === "/__p5-previous.pdf")
      resourceResponses.push({ path, status: response.status() });
  });
  await page.goto("/workspace-preview/drawing-workspace?p5PdfTest=1", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect(
    page.getByText("PDF 원본 배경을 표시하고 있습니다."),
  ).toBeVisible();
  expect(resourceResponses).toContainEqual({
    path: "/__p5-current.pdf",
    status: 200,
  });
  expect(
    resourceResponses.some(({ path }) => path === "/__p5-previous.pdf"),
  ).toBe(false);
  await page.getByRole("button", { name: "겹쳐 보기" }).click();
  await expect
    .poll(() =>
      resourceResponses.filter(({ path }) => path === "/__p5-previous.pdf"),
    )
    .toEqual([{ path: "/__p5-previous.pdf", status: 200 }]);
});

test("active PDF page compares only its exact predecessor with transient non-listening markers and Viewer denial", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const context = CanvasRenderingContext2D.prototype;
    const original = context.getImageData;
    (window as typeof window & { __p5ImageReads?: number }).__p5ImageReads = 0;
    context.getImageData = function (...args) {
      (window as typeof window & { __p5ImageReads?: number }).__p5ImageReads =
        ((window as typeof window & { __p5ImageReads?: number })
          .__p5ImageReads ?? 0) + 1;
      return original.apply(this, args);
    };
  });
  const source = await readFile(
    path.resolve(
      "../.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-10-artifacts/representative-drawing.pdf",
    ),
  );
  const changedDocument = await PDFDocument.load(source);
  changedDocument.getPage(0).drawRectangle({
    x: 72,
    y: 72,
    width: 144,
    height: 96,
    color: rgb(0.9, 0.05, 0.05),
  });
  const changed = Buffer.from(await changedDocument.save());
  const before = {
    current: createHash("sha256").update(changed).digest("hex"),
    previous: createHash("sha256").update(source).digest("hex"),
  };
  const previousRequests: Array<{
    capabilityReleased: boolean;
    url: string;
  }> = [];
  let compareCapabilityRequests = 0;
  let routedCapabilityRequests = 0;
  let secondCapabilityResponseReady = false;
  let secondCapabilityResponseReleased = false;
  let releaseSecondCapabilityResponse!: () => void;
  const secondCapabilityResponseRelease = new Promise<void>((resolve) => {
    releaseSecondCapabilityResponse = resolve;
  });
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.postData()?.includes("load_pdf_compare")
    )
      compareCapabilityRequests += 1;
  });
  await page.route("**/workspace-preview/drawing-workspace*", async (route) => {
    const request = route.request();
    if (
      request.method() !== "POST" ||
      !request.postData()?.includes("load_pdf_compare")
    ) {
      await route.continue();
      return;
    }
    const requestNumber = ++routedCapabilityRequests;
    const response = await route.fetch();
    if (requestNumber !== 2) {
      await route.fulfill({ response });
      return;
    }
    const originalBody = (await response.body()).toString();
    expect(originalBody).toContain("/__p5-previous.pdf");
    secondCapabilityResponseReady = true;
    await secondCapabilityResponseRelease;
    secondCapabilityResponseReleased = true;
    await route.fulfill({
      body: originalBody.replaceAll(
        "/__p5-previous.pdf",
        "/__p5-previous.pdf?capability=fresh",
      ),
      response,
    });
  });
  await page.route("**/__p5-current.pdf", (route) =>
    route.fulfill({ body: changed, contentType: "application/pdf" }),
  );
  await page.route("**/__p5-previous.pdf*", async (route) => {
    previousRequests.push({
      capabilityReleased: secondCapabilityResponseReleased,
      url: route.request().url(),
    });
    await route.fulfill({ body: source, contentType: "application/pdf" });
  });

  await page.goto(
    "/workspace-preview/drawing-workspace?p5PdfTest=1&realtimeTest=1",
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect(
    page.getByRole("group", { name: "PDF 개정 비교" }),
  ).toBeVisible();
  expect(previousRequests).toHaveLength(0);
  expect(compareCapabilityRequests).toBe(0);
  await page.getByRole("button", { name: "겹쳐 보기" }).click();
  await expect.poll(() => previousRequests).toHaveLength(1);
  expect(compareCapabilityRequests).toBe(1);
  await page.getByLabel("이전 도면 불투명도").fill("35");
  await page.getByRole("button", { name: "변경 표시 계산" }).click();
  await expect(page.getByText("브라우저 미리보기").first()).toBeVisible();
  expect(previousRequests).toHaveLength(1);
  await expect(
    page.locator('[data-pdf-diff-marker="true"][data-listening="false"]'),
  ).not.toHaveCount(0);
  const explicitImageReads = await page.evaluate(
    () =>
      (window as typeof window & { __p5ImageReads?: number }).__p5ImageReads ??
      0,
  );
  await page.getByLabel("이전 도면 불투명도").fill("65");
  await page.getByRole("button", { name: "이전 도면" }).click();
  await page.getByRole("button", { name: "겹쳐 보기" }).click();
  await page.waitForTimeout(100);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __p5ImageReads?: number })
          .__p5ImageReads ?? 0,
    ),
  ).toBe(explicitImageReads);
  expect(compareCapabilityRequests).toBe(1);
  await page.getByRole("button", { name: "현재 도면" }).click();
  await expect(page.locator('[data-pdf-diff-marker="true"]')).toHaveCount(0);
  await page.getByRole("button", { name: "겹쳐 보기" }).click();
  await expect.poll(() => secondCapabilityResponseReady).toBe(true);
  try {
    await page.waitForTimeout(250);
    expect(previousRequests).toHaveLength(1);
    await expect(
      page.getByText("이전 PDF 접근 권한을 요청합니다."),
    ).toBeVisible();
  } finally {
    releaseSecondCapabilityResponse();
  }
  await expect.poll(() => previousRequests).toHaveLength(2);
  expect(compareCapabilityRequests).toBe(2);
  expect(previousRequests[1]?.capabilityReleased).toBe(true);
  expect(previousRequests[1]?.url).toContain(
    "/__p5-previous.pdf?capability=fresh",
  );
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __p5ImageReads?: number })
          .__p5ImageReads ?? 0,
    ),
  ).toBe(explicitImageReads);
  await expect(page.locator('[data-pdf-diff-marker="true"]')).toHaveCount(0);
  await page.getByRole("button", { name: "변경 표시 계산" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __p5ImageReads?: number })
            .__p5ImageReads ?? 0,
      ),
    )
    .toBe(explicitImageReads + 2);
  await expect(
    page.locator('[data-pdf-diff-marker="true"][data-listening="false"]'),
  ).not.toHaveCount(0);
  await page.screenshot({
    path: process.env.DRAWING_P5_ARTIFACT_ROOT
      ? path.resolve(
          process.env.DRAWING_P5_ARTIFACT_ROOT,
          "task-5-pdf-overlay.png",
        )
      : path.resolve(
          "../.superpowers/sdd/2026-08-27-drawing-workspace-p5/task-5-pdf-overlay.png",
        ),
    fullPage: true,
  });
  await page.getByRole("button", { name: "현재 도면" }).click();
  await expect(page.locator('[data-pdf-diff-marker="true"]')).toHaveCount(0);

  await page.getByRole("button", { name: "테스트 보기 권한" }).click();
  await expect(
    page.getByRole("group", { name: "PDF 개정 비교" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "선택 객체 원본 근거" }),
  ).toContainText("조회 전용");
  await expect(
    page.getByRole("button", { name: /원본 근거 연결|원본 근거 해제/ }),
  ).toHaveCount(0);

  expect(createHash("sha256").update(changed).digest("hex")).toBe(
    before.current,
  );
  expect(createHash("sha256").update(source).digest("hex")).toBe(
    before.previous,
  );
});

test("a non-current PDF mode queues one fresh capability while cancellation is pending", async ({
  page,
}) => {
  page.setDefaultTimeout(15_000);
  const source = await readFile(
    path.resolve(
      "../.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-10-artifacts/representative-drawing.pdf",
    ),
  );
  let loadRequests = 0;
  let cancelRequests = 0;
  let initialLoadReady = false;
  let cancelReady = false;
  let releaseInitialLoad!: () => void;
  let releaseCancel!: () => void;
  const initialLoadRelease = new Promise<void>((resolve) => {
    releaseInitialLoad = resolve;
  });
  const cancelRelease = new Promise<void>((resolve) => {
    releaseCancel = resolve;
  });
  const previousRequests: string[] = [];
  await page.route("**/workspace-preview/drawing-workspace*", async (route) => {
    const request = route.request();
    const postData = request.postData() ?? "";
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    if (postData.includes("load_pdf_compare")) {
      const requestNumber = ++loadRequests;
      const response = await route.fetch();
      if (requestNumber === 1) {
        initialLoadReady = true;
        await initialLoadRelease;
        await route.fulfill({ response });
        return;
      }
      const originalBody = (await response.body()).toString();
      expect(originalBody).toContain("/__p5-previous.pdf");
      await route.fulfill({
        body: originalBody.replaceAll(
          "/__p5-previous.pdf",
          "/__p5-previous.pdf?capability=queued",
        ),
        response,
      });
      return;
    }
    if (postData.includes("cancel_pdf_compare")) {
      cancelRequests += 1;
      const response = await route.fetch();
      cancelReady = true;
      await cancelRelease;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  await page.route("**/__p5-current.pdf", (route) =>
    route.fulfill({ body: source, contentType: "application/pdf" }),
  );
  await page.route("**/__p5-previous.pdf*", async (route) => {
    previousRequests.push(route.request().url());
    await route.fulfill({ body: source, contentType: "application/pdf" });
  });

  await page.goto("/workspace-preview/drawing-workspace?p5PdfTest=1", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  const canvas = page.getByLabel(/도면 화면/);
  await page.getByRole("button", { name: "겹쳐 보기" }).click();
  await expect.poll(() => initialLoadReady).toBe(true);
  await page.getByRole("button", { name: "현재 도면" }).click();
  await expect.poll(() => cancelReady).toBe(true);
  await page.getByRole("button", { name: "겹쳐 보기" }).click();
  try {
    await expect(
      page.getByRole("button", { name: "겹쳐 보기" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText("이전 PDF 접근 권한을 요청합니다."),
    ).toBeVisible();
    expect(loadRequests).toBe(1);
    expect(cancelRequests).toBe(1);
    expect(previousRequests).toHaveLength(0);
  } finally {
    releaseInitialLoad();
    releaseCancel();
  }
  await expect.poll(() => loadRequests).toBe(2);
  await expect.poll(() => previousRequests).toHaveLength(1);
  await page.waitForTimeout(250);
  expect(loadRequests).toBe(2);
  expect(cancelRequests).toBe(1);
  expect(previousRequests).toEqual([
    expect.stringContaining("/__p5-previous.pdf?capability=queued"),
  ]);
  await expect(canvas).toHaveAttribute("data-pdf-previous-mounted", "true");
  await expect(
    page.getByRole("button", { name: "변경 표시 계산" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "이전 도면" }).click();
  await page.getByRole("button", { name: "현재 도면" }).click();
  await expect(page.getByRole("button", { name: "현재 도면" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(canvas).toHaveAttribute("data-pdf-previous-mounted", "false");
  await page.waitForTimeout(250);
  expect(loadRequests).toBe(2);
  expect(cancelRequests).toBe(1);
  expect(previousRequests).toHaveLength(1);
});

test("a failed PDF capability settles until a new user selection retries", async ({
  page,
}) => {
  page.setDefaultTimeout(15_000);
  const source = await readFile(
    path.resolve(
      "../.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-10-artifacts/representative-drawing.pdf",
    ),
  );
  let loadRequests = 0;
  let previousRequests = 0;
  await page.route("**/workspace-preview/drawing-workspace*", async (route) => {
    const request = route.request();
    const postData = request.postData() ?? "";
    if (request.method() !== "POST" || !postData.includes("load_pdf_compare")) {
      await route.continue();
      return;
    }
    loadRequests += 1;
    if (loadRequests === 1) {
      const response = await route.fetch();
      await route.fulfill({
        body: JSON.stringify([
          { _1: 2 },
          "data",
          { _3: 4, _5: 6, _7: 8, _9: -5 },
          "ok",
          false,
          "kind",
          "pdf_compare",
          "error",
          "PDF 개정 비교 증거가 일치하지 않습니다.",
          "previousPdf",
        ]),
        response,
        status: 200,
      });
      return;
    }
    await route.fulfill({ response: await route.fetch() });
  });
  await page.route("**/__p5-current.pdf", (route) =>
    route.fulfill({ body: source, contentType: "application/pdf" }),
  );
  await page.route("**/__p5-previous.pdf", async (route) => {
    previousRequests += 1;
    await route.fulfill({ body: source, contentType: "application/pdf" });
  });

  await page.goto("/workspace-preview/drawing-workspace?p5PdfTest=1", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await page.getByRole("button", { name: "겹쳐 보기" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "PDF 개정 비교 증거가 일치하지 않습니다.",
  );
  await page.waitForTimeout(250);
  expect(loadRequests).toBe(1);
  expect(previousRequests).toBe(0);

  await page.getByRole("button", { name: "겹쳐 보기" }).click();
  await expect.poll(() => loadRequests).toBe(2);
  await expect.poll(() => previousRequests).toBe(1);
  await expect(
    page.getByRole("button", { name: "변경 표시 계산" }),
  ).toBeEnabled();
});

test("disabling PDF compare cancels pending predecessor work and clears transient resources", async ({
  page,
}) => {
  const source = await readFile(
    path.resolve(
      "../.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-10-artifacts/representative-drawing.pdf",
    ),
  );
  let releasePrevious!: () => void;
  const previousReleased = new Promise<void>((resolve) => {
    releasePrevious = resolve;
  });
  let previousStarted = false;
  await page.route("**/__p5-current.pdf", (route) =>
    route.fulfill({ body: source, contentType: "application/pdf" }),
  );
  await page.route("**/__p5-previous.pdf", async (route) => {
    previousStarted = true;
    await previousReleased;
    if (!route.request().isNavigationRequest())
      await route.fulfill({ body: source, contentType: "application/pdf" });
  });
  await page.goto("/workspace-preview/drawing-workspace?p5PdfTest=1", {
    waitUntil: "domcontentloaded",
  });
  const canvas = page.getByLabel(/도면 화면/);
  await expect(canvas).toHaveAttribute("data-pdf-current-mounted", "true", {
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "겹쳐 보기" }).click();
  await expect.poll(() => previousStarted, { timeout: 15_000 }).toBe(true);
  await page.getByRole("button", { name: "현재 도면" }).click();
  releasePrevious();
  await expect(canvas).toHaveAttribute("data-pdf-previous-mounted", "false");
  await expect(page.getByText("브라우저 미리보기")).toHaveCount(0);
  await expect(page.getByText("이전 PDF를 여는 중입니다.")).toHaveCount(0);
});

test("mounted PDF inspector uses operation commands for exact link and unlink", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const source = await readFile(
    path.resolve(
      "../.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-10-artifacts/representative-drawing.pdf",
    ),
  );
  const hash = createHash("sha256").update(source).digest("hex");
  await page.route("**/__p5-current.pdf", (route) =>
    route.fulfill({ body: source, contentType: "application/pdf" }),
  );
  await page.goto("/workspace-preview/drawing-workspace?p5PdfTest=1", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
    "data-pdf-current-mounted",
    "true",
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: "P5 연결 객체 선택" }).click();
  const snapshot = page.getByLabel("P5 mounted workspace snapshot");
  await expect(snapshot).toContainText(
    '"selectedIds":["00000000-0000-4000-8000-000000000071"]',
  );
  await page.getByRole("button", { name: "PDF 영역 원본 근거 연결" }).click();
  expect(pageErrors).toEqual([]);
  await expect(snapshot).toContainText('"sourceKind":"pdf_region"');
  await expect(snapshot).toContainText(
    '"sourceFileId":"00000000-0000-4000-8000-000000000002"',
  );
  await expect(snapshot).not.toContainText("signedUrl");
  await expect(snapshot).not.toContainText("브라우저 미리보기");
  await page.getByRole("button", { name: "원본 근거 해제" }).click();
  await expect(snapshot).not.toContainText('"sourceKind":"pdf_region"');
  expect(createHash("sha256").update(source).digest("hex")).toBe(hash);
});

test("mounted IFC viewer stays loaded across 2D, 3D, and split modes and retries cached GLB without refetch", async ({
  page,
}) => {
  let manifestFetches = 0;
  let glbFetches = 0;
  let rawIfcFetches = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith(".ifc.manifest.json")) manifestFetches += 1;
    if (pathname.endsWith("/examples/example.ifc.glb")) glbFetches += 1;
    if (pathname.endsWith(".ifc")) rawIfcFetches += 1;
  });
  await openP5Preview(page);
  await expect(page.getByLabel("도면 캔버스")).toBeVisible();
  expect(manifestFetches).toBe(0);
  expect(glbFetches).toBe(0);

  await page.getByRole("button", { name: "IFC 3D" }).click();
  await expect(page).toHaveURL(/view=3d/);
  await expect(page.getByRole("img", { name: "IFC 3D 모델 화면" })).toBeVisible(
    {
      timeout: 60_000,
    },
  );
  await expect(page.locator('canvas[aria-label="IFC 3D 모델"]')).toHaveCount(
    1,
    {
      timeout: 60_000,
    },
  );
  // Keep this trace exact: a cold Vite optimizer reload invalidates a dev run,
  // so warm the server and rerun instead of filtering real duplicate fetches.
  await expect
    .poll(() => ({ manifestFetches, glbFetches }), {
      message: "the mounted viewer must fetch each verified derivative once",
    })
    .toEqual({ manifestFetches: 1, glbFetches: 1 });
  const canvas = page.locator('canvas[aria-label="IFC 3D 모델"]');
  const mountedCanvas = await canvas.evaluate((element) =>
    element.getAttribute("data-ifc-viewer-instance"),
  );

  await page.getByRole("button", { name: "2D 도면" }).click();
  await expect(page.getByLabel("도면 캔버스")).toBeVisible();
  await page.getByRole("button", { name: "분할 보기" }).click();
  await expect(page).toHaveURL(/view=split/);
  await expect(page.getByLabel("도면 캔버스")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "IFC 3D 모델 화면" }),
  ).toBeVisible();
  expect({ manifestFetches, glbFetches }).toEqual({
    manifestFetches: 1,
    glbFetches: 1,
  });
  expect(rawIfcFetches).toBe(0);
  await expect(canvas).toHaveAttribute(
    "data-ifc-viewer-instance",
    mountedCanvas ?? "",
  );

  await canvas.dispatchEvent("webglcontextlost");
  await expect(
    page.getByRole("button", { name: "3D 화면 다시 시도" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "3D 화면 다시 시도" }).click();
  await expect(page.locator('canvas[aria-label="IFC 3D 모델"]')).toHaveCount(1);
  expect({ manifestFetches, glbFetches }).toEqual({
    manifestFetches: 1,
    glbFetches: 1,
  });

  await page
    .getByRole("combobox", { name: "IFC 원본 선택" })
    .selectOption("00000000-0000-4000-8000-0000000000a2");
  await expect
    .poll(() => ({ manifestFetches, glbFetches }))
    .toEqual({ manifestFetches: 2, glbFetches: 2 });
  expect(rawIfcFetches).toBe(0);
  await expect(canvas).not.toHaveAttribute(
    "data-ifc-viewer-instance",
    mountedCanvas ?? "",
  );
  await page.getByRole("combobox", { name: "IFC 원본 선택" }).selectOption("");
  await expect(page.locator('canvas[aria-label="IFC 3D 모델"]')).toHaveCount(0);
});

test("cold split paints the fitted IFC model without a manual fit", async ({
  page,
}) => {
  await openP5Preview(page);
  await page.getByRole("button", { name: "분할 보기" }).click();
  await expect(page).toHaveURL(/view=split/);
  const canvas = page.locator('canvas[aria-label="IFC 3D 모델"]');
  await expect(canvas).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/3D 요소 115개를 표시했습니다/)).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(() =>
      canvas.screenshot().then((image) => changedPixelRatio(page, image)),
    )
    .toBeGreaterThan(0.18);
});

test("a source swap during a pending verified manifest load commits only the latest generation", async ({
  page,
}) => {
  let releaseManifest!: () => void;
  let reportManifest!: () => void;
  const manifestReleased = new Promise<void>((resolve) => {
    releaseManifest = resolve;
  });
  const manifestStarted = new Promise<void>((resolve) => {
    reportManifest = resolve;
  });
  await page.route("**/examples/example.ifc.manifest.json", async (route) => {
    reportManifest();
    await manifestReleased;
    await route.continue();
  });
  await openP5Preview(page);
  await page.getByRole("button", { name: "IFC 3D" }).click();
  await manifestStarted;
  await page
    .getByRole("combobox", { name: "IFC 원본 선택" })
    .selectOption("00000000-0000-4000-8000-0000000000a2");
  releaseManifest();

  await expect(page).toHaveURL(/ifc=00000000-0000-4000-8000-0000000000a2/);
  await expect(page.getByTitle("example-copy.ifc")).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText(/3D 요소 115개를 표시했습니다/)).toBeVisible();
  await expect(page.locator('canvas[aria-label="IFC 3D 모델"]')).toHaveCount(
    1,
    {
      timeout: 60_000,
    },
  );
  await page.getByRole("combobox", { name: "IFC 원본 선택" }).selectOption("");
  await expect(page.locator('canvas[aria-label="IFC 3D 모델"]')).toHaveCount(0);
});

test("narrow split view uses accessible tabs and two browsers preserve independent shareable modes", async ({
  browser,
}) => {
  const first = await browser.newPage({
    viewport: { width: 560, height: 900 },
  });
  const second = await browser.newPage({
    viewport: { width: 560, height: 900 },
  });
  await Promise.all([openP5Preview(first), openP5Preview(second)]);
  await first.getByRole("button", { name: "분할 보기" }).click();
  await second.getByRole("button", { name: "IFC 3D" }).click();
  await expect(
    first.getByRole("tablist", { name: "분할 보기 패널" }),
  ).toBeVisible();
  const drawingTab = first.getByRole("tab", { name: "2D 도면" });
  const ifcTab = first.getByRole("tab", { name: "IFC 3D" });
  await expect(ifcTab).toHaveAttribute(
    "aria-controls",
    "drawing-split-panel-3d",
  );
  await drawingTab.focus();
  await drawingTab.press("ArrowLeft");
  await expect(ifcTab).toHaveAttribute("aria-selected", "true");
  await expect(ifcTab).toBeFocused();
  await ifcTab.press("ArrowRight");
  await expect(drawingTab).toHaveAttribute("aria-selected", "true");
  await expect(drawingTab).toBeFocused();
  await drawingTab.press("End");
  await expect(ifcTab).toHaveAttribute("aria-selected", "true");
  await expect(ifcTab).toBeFocused();
  await expect(
    first.getByRole("img", { name: "IFC 3D 모델 화면" }),
  ).toBeVisible({
    timeout: 60_000,
  });
  await expect(first).toHaveURL(/view=split/);
  await expect(second).toHaveURL(/view=3d/);
  await Promise.all([first.close(), second.close()]);
});

test("drawing and IFC GlobalId focus is bidirectional while remote selections stay renderer-local", async ({
  browser,
}) => {
  const local = await browser.newPage();
  const remote = await browser.newPage();
  await Promise.all([
    openP5Preview(local),
    remote.goto(`${previewPath}&awarenessTest=1`, {
      waitUntil: "domcontentloaded",
    }),
  ]);
  await local.getByRole("button", { name: "P5 연결 객체 선택" }).click();
  await expect(local.getByLabel("P5 mounted workspace snapshot")).toContainText(
    "00000000-0000-4000-8000-000000000070",
  );
  await local.getByRole("button", { name: "IFC 3D" }).click();
  await expect(local.getByTitle("0VNYAWfXv8JvIRVfOzYH1j")).toBeVisible({
    timeout: 60_000,
  });
  const elementList = local
    .locator('section:has(input[aria-label="IFC 요소 검색"])')
    .last();
  await elementList.getByRole("button").nth(1).click();
  await expect(
    local.getByText("선택한 IFC 요소와 연결된 도면 객체가 없습니다."),
  ).toBeVisible();
  await local.getByRole("button", { name: "P5 도면 선택 해제" }).click();
  await local.getByRole("button", { name: "P5 연결 객체 선택" }).click();
  await expect(
    local.getByText("선택한 IFC 요소와 연결된 도면 객체가 없습니다."),
  ).toHaveCount(0);
  await local
    .getByRole("button", {
      name: /NZ-PFC Channels beam:300PFC40\.1:691733/,
    })
    .click();
  await expect(local.getByLabel("P5 mounted workspace snapshot")).toContainText(
    "00000000-0000-4000-8000-000000000070",
  );

  await remote.getByRole("button", { name: "IFC 3D" }).click();
  await expect(
    remote.locator('canvas[aria-label="IFC 3D 모델"]'),
  ).toHaveAttribute("data-remote-ifc-element-ids", "2863", {
    timeout: 60_000,
  });
  await Promise.all([local.close(), remote.close()]);
});
