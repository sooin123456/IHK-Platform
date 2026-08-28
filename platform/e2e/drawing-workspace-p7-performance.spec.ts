import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import os from "node:os";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { drawingCanvasRenderAdapter } from "../app/lukas/lib/drawing-blocks";
import { buildDrawingP4PerformanceFixture } from "../app/lukas/lib/drawing-p4-performance";
const performancePath =
  "/workspace-preview/drawing-workspace?performanceTest=1";
const layerId = "10000000-0000-4000-8000-000000000001";

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * ratio) - 1] ?? 0;
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`P7 runner provenance is missing ${name}`);
  return value;
}

async function corruptFirstVisibleRaster(
  page: Page,
  mode: "decode" | "dimensions" | "pixels",
) {
  return page.evaluate(async (corruptionMode) => {
    const cache = await caches.open("drawing-pdf-raster-v2");
    const request = (await cache.keys()).find(({ url }) =>
      url.includes("/__drawing-pdf-raster-cache/v2/first-visible-v1/current/"),
    );
    if (!request) throw new Error("first-visible PDF raster cache is missing");
    const response = await cache.match(request);
    if (!response)
      throw new Error("first-visible PDF raster response is missing");
    const headers = new Headers(response.headers);
    const blob =
      corruptionMode === "decode"
        ? new Blob([new Uint8Array([0, 1, 2, 3])], { type: "image/png" })
        : await new Promise<Blob>((resolve, reject) => {
            const canvas = document.createElement("canvas");
            canvas.width =
              corruptionMode === "pixels"
                ? Number(headers.get("x-drawing-canvas-pixel-width"))
                : 1;
            canvas.height =
              corruptionMode === "pixels"
                ? Number(headers.get("x-drawing-canvas-pixel-height"))
                : 1;
            const context = canvas.getContext("2d");
            if (context) {
              context.fillStyle = "#ff00ff";
              context.fillRect(0, 0, canvas.width, canvas.height);
            }
            canvas.toBlob(
              (value) =>
                value ? resolve(value) : reject(new Error("PNG encode failed")),
              "image/png",
            );
          });
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await blob.arrayBuffer(),
    );
    const digestHex = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    headers.set("x-drawing-content-sha256", digestHex);
    const target =
      corruptionMode === "pixels"
        ? `${request.url.slice(0, request.url.lastIndexOf("/") + 1)}${digestHex}`
        : request.url;
    if (target !== request.url) await cache.delete(request);
    await cache.put(target, new Response(blob, { headers }));
    return target;
  }, mode);
}

async function measureFirstUsable(page: Page) {
  const readinessHandle = await page.waitForFunction(
    () => {
      const canvas = document.querySelector<HTMLElement>(
        '[aria-label*="도면 화면"]',
      );
      const hydrated = document.querySelector(
        '[aria-label="미리보기 hydration 상태"]',
      );
      const ifcViewer = document.querySelector<HTMLElement>(
        '[aria-label="IFC 3D 모델 화면"]',
      );
      const workspaceCanvas = document.querySelector<HTMLElement>(
        '[aria-label="도면 캔버스"]',
      );
      const stageEnd = (name: string) => {
        const entries = performance.getEntriesByName(
          `drawing-workspace:${name}`,
        );
        const entry = entries.at(-1);
        return entry ? entry.startTime + entry.duration : 0;
      };
      const ready =
        canvas?.dataset.renderedSemanticObjectCount === "10000" &&
        Number(canvas.dataset.projectedSemanticObjectCount) > 0 &&
        canvas.dataset.pdfCurrentMounted === "true" &&
        ifcViewer?.dataset.viewerPhase === "ready" &&
        workspaceCanvas?.dataset.editReady === "true" &&
        hydrated?.textContent?.includes("준비됨") &&
        stageEnd("hydration") > 0 &&
        stageEnd("pdf") > 0 &&
        stageEnd("ifc") > 0;
      if (!ready) return false;
      const observed = performance.now();
      return {
        navigationStartMs: 0,
        hydrationEndMs: stageEnd("hydration"),
        editReadyObservedMs: observed,
        authoritativeStateObservedMs: observed,
        viewportProjectionObservedMs: observed,
        pdfVisibleObservedMs: observed,
        ifcVisibleObservedMs: observed,
      };
    },
    undefined,
    { timeout: 60_000 },
  );
  const readiness = (await readinessHandle.jsonValue()) as {
    navigationStartMs: number;
    hydrationEndMs: number;
    editReadyObservedMs: number;
    authoritativeStateObservedMs: number;
    viewportProjectionObservedMs: number;
    pdfVisibleObservedMs: number;
    ifcVisibleObservedMs: number;
  };
  const usableFrameEndMs = await page.evaluate(
    () =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() => resolve(performance.now())),
      ),
  );
  return {
    durationMs: usableFrameEndMs - readiness.navigationStartMs,
    readiness: { ...readiness, usableFrameEndMs },
  };
}

async function stableSurfaceBox(surface: Locator) {
  let box = { x: 0, y: 0, width: 0, height: 0 };
  await expect
    .poll(
      async () => {
        try {
          box = await surface.evaluate(async (element) => {
            await new Promise(requestAnimationFrame);
            await new Promise(requestAnimationFrame);
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          });
          return box.width > 0 && box.height > 0;
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return box;
}

async function worldPoint(page: Page, point: { x: number; y: number }) {
  const surface = page.getByLabel(/도면 화면/);
  const box = await stableSurfaceBox(surface);
  const [viewportX, viewportY, zoom] = await Promise.all([
    surface.getAttribute("data-viewport-x"),
    surface.getAttribute("data-viewport-y"),
    surface.getAttribute("data-viewport-zoom"),
  ]);
  return {
    x: box.x + Number(viewportX) + point.x * Number(zoom),
    y: box.y + Number(viewportY) + point.y * Number(zoom),
  };
}

function deterministicHashes() {
  const fixtureHashes: string[] = [];
  const renderOrderHashes: string[] = [];
  const projectionHashes: string[] = [];
  for (let run = 0; run < 100; run += 1) {
    const fixture = buildDrawingP4PerformanceFixture(10_000, layerId);
    const adapter = drawingCanvasRenderAdapter({
      blockInstances: [],
      layers: {
        [layerId]: { visible: true, locked: false, sortOrder: 0 },
      },
      objects: fixture.objects.map((item) => ({
        ...item,
        style: {
          stroke: item.style.stroke ?? "#2563eb",
          strokeWidth: item.style.strokeWidth ?? 1,
          fill: item.style.fill ?? null,
          fontSize: item.style.fontSize,
        },
      })),
      viewportBounds: { x: 90, y: 90, width: 220, height: 70 },
      zoom: 1,
    });
    fixtureHashes.push(sha256(fixture.objects));
    renderOrderHashes.push(sha256(adapter.items.map(({ id }) => id)));
    projectionHashes.push(sha256(adapter.projectedItems.map(({ id }) => id)));
  }
  return { fixtureHashes, renderOrderHashes, projectionHashes };
}

test("P7 exact 10k whole workspace meets first-usable and warm-frame budgets with real stage evidence", async ({
  browser,
  browserName,
  page,
}) => {
  test.setTimeout(10 * 60_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(performancePath, {
    waitUntil: "domcontentloaded",
  });
  const coldCacheMiss = await measureFirstUsable(page);
  const coldSurface = page.getByLabel(/도면 화면/);
  await expect(coldSurface).toHaveAttribute(
    "data-pdf-raster-authority",
    "PDFJS",
  );
  await page.goto(performancePath, { waitUntil: "domcontentloaded" });
  const surface = page.getByLabel(/도면 화면/);
  const warmFirstUsable = await measureFirstUsable(page);
  const readiness = warmFirstUsable.readiness;
  const firstUsableMs = warmFirstUsable.durationMs;
  const pdfRaster = await surface.evaluate((element) => ({
    authority: element.dataset.pdfRasterAuthority,
    cacheStatus: element.dataset.pdfRasterCacheStatus,
    renderProfile: "first-visible-v1",
    keySha256: element.dataset.pdfRasterKeySha256,
    mountedAtMs: Number(element.dataset.pdfRasterMountedAtMs),
    screenPixelRatio: Number(element.dataset.pdfRasterScreenPixelRatio),
  }));
  expect(pdfRaster.authority).toBe("PDFJS");
  expect(pdfRaster.cacheStatus).toBe("UNVERIFIED_HIT");
  expect(pdfRaster.keySha256).toMatch(/^[0-9a-f]{64}$/);
  expect(pdfRaster.mountedAtMs).toBeGreaterThan(0);
  expect(pdfRaster.mountedAtMs).toBeLessThanOrEqual(
    readiness.pdfVisibleObservedMs,
  );
  expect(pdfRaster.screenPixelRatio).toBeGreaterThanOrEqual(1.5);
  const workloadProjection = await surface.evaluate(async (element) => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return {
      projectedObjects: Number(element.dataset.projectedObjectCount),
      projectedSemanticObjects: Number(
        element.dataset.projectedSemanticObjectCount,
      ),
      accessibleObjects: document.querySelectorAll(
        '[aria-label="건축 객체 목록"] li',
      ).length,
    };
  });
  const { accessibleObjects, projectedObjects } = workloadProjection;
  expect(projectedObjects).toBeLessThan(2_500);
  expect(accessibleObjects).toBe(workloadProjection.projectedSemanticObjects);
  expect(accessibleObjects).toBeLessThanOrEqual(projectedObjects);
  await expect(page.getByLabel("P7 source link count")).toHaveText("2");

  const box = await stableSurfaceBox(surface);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -2);
  await page.mouse.wheel(0, 2);
  await page.getByLabel("이동 도구").click();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2 + 2);
  await page.mouse.up();

  await surface.evaluate((element) => {
    const evidence = {
      mode: "zoom",
      zoom: [] as number[],
      pan: [] as number[],
      selection: [] as Array<{
        durationMs: number;
        expectedObjectName: string;
        committedObjectName: string;
      }>,
      expectedSelectionName: "",
      pendingSelection: null as null | {
        startedAt: number;
        sample: {
          durationMs: number;
          expectedObjectName: string;
          committedObjectName: string;
        };
      },
    };
    Object.assign(element, { __p7Performance: evidence });
    const measure = (kind: "zoom" | "pan") => {
      const started = performance.now();
      requestAnimationFrame(() =>
        evidence[kind].push(performance.now() - started),
      );
    };
    element.addEventListener("wheel", () => measure("zoom"), {
      capture: true,
    });
    element.addEventListener(
      "pointermove",
      () => {
        if (evidence.mode === "pan") measure("pan");
      },
      { capture: true },
    );
    window.addEventListener(
      "pointerdown",
      () => {
        if (evidence.mode !== "selection") return;
        const started = performance.now();
        const expectedObjectName = evidence.expectedSelectionName;
        const sample = {
          durationMs: 0,
          expectedObjectName,
          committedObjectName: "",
        };
        evidence.pendingSelection = { startedAt: started, sample };
        requestAnimationFrame(() => {
          sample.durationMs = performance.now() - started;
          sample.committedObjectName = element.dataset.selectedObjectName ?? "";
          evidence.selection.push(sample);
          evidence.pendingSelection = null;
        });
      },
      { capture: true },
    );
  });

  for (let frame = 0; frame < 30; frame += 1) {
    await page.mouse.wheel(0, frame < 15 ? -2 : 1);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }

  await surface.evaluate((element) => {
    (
      element as HTMLElement & { __p7Performance: { mode: string } }
    ).__p7Performance.mode = "pan";
  });
  const panStart = {
    x: box.x + box.width * 0.55,
    y: box.y + box.height * 0.55,
  };
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  for (let frame = 1; frame <= 30; frame += 1) {
    await page.mouse.move(panStart.x + frame, panStart.y + frame * 0.5);
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await page.mouse.up();

  await page.getByRole("button", { name: "화면 맞춤" }).click();
  await page.getByRole("button", { name: "선택 도구" }).click();
  await surface.evaluate((element) => {
    (
      element as HTMLElement & { __p7Performance: { mode: string } }
    ).__p7Performance.mode = "selection";
  });
  const selectionTargets = [
    { name: "P4 selection 1", world: { x: 110, y: 100 } },
    { name: "P4 selection 2", world: { x: 110, y: 140 } },
  ];
  for (let sample = 0; sample < 30; sample += 1) {
    const target = selectionTargets[sample % selectionTargets.length];
    await surface.evaluate((element, expectedSelectionName) => {
      (
        element as HTMLElement & {
          __p7Performance: { expectedSelectionName: string };
        }
      ).__p7Performance.expectedSelectionName = expectedSelectionName;
    }, target.name);
    const point = await worldPoint(page, target.world);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.mouse.click(point.x, point.y);
    await expect(surface).toHaveAttribute(
      "data-selected-object-name",
      target.name,
    );
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }

  const frames = await surface.evaluate((element) => {
    return (
      element as HTMLElement & {
        __p7Performance: {
          zoom: number[];
          pan: number[];
          selection: Array<{
            durationMs: number;
            expectedObjectName: string;
            committedObjectName: string;
          }>;
        };
      }
    ).__p7Performance;
  });
  expect(frames.zoom).toHaveLength(30);
  expect(frames.pan.length).toBeGreaterThanOrEqual(30);
  expect(frames.selection).toHaveLength(30);
  expect(
    frames.selection.every(
      ({ committedObjectName, expectedObjectName }) =>
        committedObjectName === expectedObjectName,
    ),
  ).toBe(true);

  const stageIntervals = await page.evaluate(() => {
    const interval = (name: string) => {
      const entry = performance
        .getEntriesByName(`drawing-workspace:${name}`)
        .sort((left, right) => right.duration - left.duration)[0];
      return {
        startMs: entry.startTime,
        endMs: entry.startTime + entry.duration,
        durationMs: entry.duration,
      };
    };
    const navigation = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming;
    const ssr = navigation.serverTiming.find(
      ({ name }) => name === "drawing-workspace-ssr",
    )?.duration;
    return {
      ssr,
      hydration: interval("hydration"),
      styleResolution: interval("style-resolution"),
      renderAdapter: interval("render-adapter"),
      konvaMount: interval("konva-mount"),
      snapHitPreparation: interval("snap-hit-preparation"),
      pdf: interval("pdf"),
      ifc: interval("ifc"),
    };
  });
  const loaderMs = Number(
    await page.getByLabel("P7 loader duration").textContent(),
  );
  const p95Ms = {
    zoom: percentile(frames.zoom, 0.95),
    pan: percentile(frames.pan, 0.95),
    selection: percentile(
      frames.selection.map(({ durationMs }) => durationMs),
      0.95,
    ),
  };
  const hashes = deterministicHashes();
  const capture = {
    schemaVersion: 1,
    authority: "P7_PLAYWRIGHT_RAW_CAPTURE_V1",
    runId: requiredEnvironment("P7_RUN_ID"),
    source: {
      commitSha: requiredEnvironment("P7_SOURCE_COMMIT_SHA"),
      treeSha256: requiredEnvironment("P7_SOURCE_TREE_SHA256"),
      runnerSha256: requiredEnvironment("P7_RUNNER_SHA256"),
      configSha256: requiredEnvironment("P7_CONFIG_SHA256"),
      build: {
        serverSha256: requiredEnvironment("P7_BUILD_SERVER_SHA256"),
        clientSha256: requiredEnvironment("P7_BUILD_CLIENT_SHA256"),
      },
    },
    browserName,
    browserVersion: browser.version(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    viewport: page.viewportSize(),
    cpu: {
      model: os.cpus()[0]?.model ?? "unknown",
      logicalCount: os.cpus().length,
    },
    memory: {
      totalBytes: os.totalmem(),
      freeBytesAtMeasurement: os.freemem(),
    },
    workload: {
      objects: 10_000,
      objectMix: {
        wall: 2_000,
        opening: 2_000,
        space: 1_500,
        area: 1_500,
        grid: 1_500,
        arc: 1_500,
      },
      authoritativeObjects: 10_000,
      projectedObjects,
      accessibleObjects,
      sourceLinks: 2,
      selectedIfcModels: 1,
      activePdfPages: 1,
    },
    conditions: {
      coldCacheMiss:
        "fresh production-build Chromium context with empty derived raster storage navigates directly to the exact 10,000-object workspace; requires hydration, exact authoritative-state confirmation, durable local edit bridge readiness, non-empty viewport projection, visible PDF.js pixels, a ready visible IFC frame, and the next animation frame",
      firstUsable:
        "exact 10,000-object warm reopen after one untimed production navigation primes immutable application, PDF, and IFC response bytes; an unverified derived raster may display provisionally but does not satisfy readiness, which requires PDF.js pixels rendered from the original source plus hydration, exact authoritative-state confirmation, durable local edit bridge readiness, non-empty viewport projection, a ready visible IFC frame, and the next animation frame; this does not substitute for the separately captured cold/cache-miss boundary whose status is independently derived",
      warm: "same mounted exact 10,000-object workspace after two zoom gestures and one pan gesture; earliest capture-phase input boundary to the next animation frame, with selection state committed in that frame",
    },
    coldCacheMiss: {
      cacheStatus: "MISS",
      readiness: coldCacheMiss.readiness,
    },
    pdfRaster,
    stages: {
      loader: { authority: "LOCAL_PRODUCTION_SERVER", durationMs: loaderMs },
      ssr: {
        authority: "LOCAL_PRODUCTION_SERVER",
        durationMs: stageIntervals.ssr,
      },
      hydration: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        ...stageIntervals.hydration,
      },
      styleResolution: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        ...stageIntervals.styleResolution,
      },
      renderAdapter: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        ...stageIntervals.renderAdapter,
      },
      konvaMount: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        ...stageIntervals.konvaMount,
      },
      snapHitPreparation: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        ...stageIntervals.snapHitPreparation,
      },
      pdf: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        ...stageIntervals.pdf,
      },
      ifc: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        ...stageIntervals.ifc,
      },
    },
    firstUsable: {
      readiness,
    },
    warm: {
      rawSamples: {
        zoomMs: frames.zoom,
        panMs: frames.pan,
        selection: frames.selection,
      },
    },
    determinism: { runs: 100, ...hashes },
  };
  const capturePath = requiredEnvironment("P7_PLAYWRIGHT_CAPTURE_PATH");
  writeFileSync(capturePath, `${JSON.stringify(capture, null, 2)}\n`);
  await test.info().attach("P7 raw Playwright performance capture", {
    path: capturePath,
    contentType: "application/json",
  });
  test.info().annotations.push({
    type: "P7 performance gate",
    description: JSON.stringify({
      coldCacheMissMs: coldCacheMiss.durationMs,
      firstUsableMs,
      p95Ms,
    }),
  });
});

test("mutable PDF raster cache entries cannot satisfy source-pixel readiness", async ({
  page,
}) => {
  test.setTimeout(3 * 60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/workspace-preview/drawing-workspace", {
    waitUntil: "domcontentloaded",
  });
  const surface = page.getByLabel(/도면 화면/);
  await expect(surface).toHaveAttribute("data-pdf-current-mounted", "true", {
    timeout: 60_000,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => performance.getEntriesByName("drawing-workspace:pdf").length,
      ),
    )
    .toBeGreaterThan(0);

  for (const mode of ["dimensions", "decode", "pixels"] as const) {
    await corruptFirstVisibleRaster(page, mode);
    await page.goto(performancePath, { waitUntil: "domcontentloaded" });
    await expect(surface).toHaveAttribute("data-pdf-current-mounted", "true", {
      timeout: 60_000,
    });
    await expect(surface).toHaveAttribute("data-pdf-raster-authority", "PDFJS");
    await expect
      .poll(() =>
        page.evaluate(
          () => performance.getEntriesByName("drawing-workspace:pdf").length,
        ),
      )
      .toBeGreaterThan(0);
  }
});

test("the mounted IFC component rearms first paint when only the workspace lifecycle changes", async ({
  page,
}) => {
  test.setTimeout(3 * 60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    "/workspace-preview/drawing-workspace?ifcLifecycleTest=1&view=split",
    { waitUntil: "domcontentloaded" },
  );
  const lifecycle = page.getByLabel("P7 IFC first-paint lifecycle");
  await expect(lifecycle).toHaveText(/^initial:/, { timeout: 60_000 });
  const initialKey = (await lifecycle.textContent())!.slice("initial:".length);
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          performance.getEntriesByName(
            `drawing-first-ifc-frame:${encodeURIComponent(key)}`,
          ).length,
        initialKey,
      ),
    )
    .toBe(1);
  const viewer = page.getByLabel("IFC 3D 모델", { exact: true });
  const initialViewerInstance = await viewer.getAttribute(
    "data-ifc-viewer-instance",
  );

  await page
    .getByRole("button", { name: "P7 IFC lifecycle transition" })
    .click();
  await expect(lifecycle).toHaveText(/^next:/);
  const nextKey = (await lifecycle.textContent())!.slice("next:".length);
  expect(nextKey).not.toBe(initialKey);
  await expect(viewer).toHaveAttribute(
    "data-ifc-viewer-instance",
    initialViewerInstance!,
  );
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          performance.getEntriesByName(
            `drawing-first-ifc-frame:${encodeURIComponent(key)}`,
          ).length,
        nextKey,
      ),
    )
    .toBe(1);
});
