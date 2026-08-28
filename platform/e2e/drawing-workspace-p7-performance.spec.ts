import { createHash } from "node:crypto";
import os from "node:os";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { drawingCanvasRenderAdapter } from "../app/lukas/lib/drawing-blocks";
import { buildDrawingP4PerformanceFixture } from "../app/lukas/lib/drawing-p4-performance";
import {
  drawingP7SourceCommitSha,
  writeDrawingP7PerformanceEvidence,
} from "../scripts/drawing-p7-performance-evidence.mjs";

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

  await page.goto("/workspace-preview/drawing-workspace", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            performance.getEntriesByName("drawing-workspace:pdf").length > 0 &&
            performance.getEntriesByName("drawing-workspace:ifc").length > 0,
        ),
      { timeout: 60_000 },
    )
    .toBe(true);

  await page.goto(performancePath, { waitUntil: "domcontentloaded" });
  const surface = page.getByLabel(/도면 화면/);
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector<HTMLElement>(
        '[aria-label*="도면 화면"]',
      );
      const hydrated = document.querySelector(
        '[aria-label="미리보기 hydration 상태"]',
      );
      return (
        canvas?.dataset.renderedSemanticObjectCount === "10000" &&
        Number(canvas.dataset.projectedSemanticObjectCount) > 0 &&
        hydrated?.textContent?.includes("준비됨")
      );
    },
    undefined,
    { timeout: 30_000 },
  );
  const firstUsableMs = await page.evaluate(
    () =>
      new Promise<number>((resolve) =>
        requestAnimationFrame(() => resolve(performance.now())),
      ),
  );
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            performance.getEntriesByName("drawing-workspace:pdf").length > 0 &&
            performance.getEntriesByName("drawing-workspace:ifc").length > 0,
        ),
      { timeout: 60_000 },
    )
    .toBe(true);
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
      selection: [] as number[],
    };
    Object.assign(element, { __p7Performance: evidence });
    const measure = (kind: "zoom" | "pan" | "selection") => {
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
    element.addEventListener(
      "pointerup",
      () => {
        if (evidence.mode === "selection") measure("selection");
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
    const point = await worldPoint(page, target.world);
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
          selection: number[];
        };
      }
    ).__p7Performance;
  });
  expect(frames.zoom).toHaveLength(30);
  expect(frames.pan.length).toBeGreaterThanOrEqual(30);
  expect(frames.selection).toHaveLength(30);

  const stageDurations = await page.evaluate(() => {
    const duration = (name: string) =>
      Math.max(
        ...performance
          .getEntriesByName(`drawing-workspace:${name}`)
          .map((entry) => entry.duration),
      );
    const navigation = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming;
    const ssr = navigation.serverTiming.find(
      ({ name }) => name === "drawing-workspace-ssr",
    )?.duration;
    return {
      ssr,
      hydration: duration("hydration"),
      styleResolution: duration("style-resolution"),
      renderAdapter: duration("render-adapter"),
      konvaMount: duration("konva-mount"),
      snapHitPreparation: duration("snap-hit-preparation"),
      pdf: duration("pdf"),
      ifc: duration("ifc"),
    };
  });
  const loaderMs = Number(
    await page.getByLabel("P7 loader duration").textContent(),
  );
  const p95Ms = {
    zoom: percentile(frames.zoom, 0.95),
    pan: percentile(frames.pan, 0.95),
    selection: percentile(frames.selection, 0.95),
  };
  const firstUsableStatus = firstUsableMs <= 2_500 ? "MET" : "NOT MET";
  const warmStatus =
    Math.max(...Object.values(p95Ms)) <= 16.7 ? "MET" : "NOT MET";
  const localStatus =
    firstUsableStatus === "MET" && warmStatus === "MET" ? "MET" : "NOT MET";
  const hashes = deterministicHashes();
  const evidence = {
    schemaVersion: 1,
    status: localStatus,
    authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
    sourceCommitSha: drawingP7SourceCommitSha(),
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
      firstUsable:
        "cold exact 10,000-object document navigation after warming application, PDF, and IFC assets; usable after hydration, authoritative-state confirmation, non-empty viewport projection, and the next animation frame",
      warm: "same mounted exact 10,000-object workspace after two zoom gestures and one pan gesture; event dispatch to next animation frame",
    },
    stages: {
      loader: { authority: "LOCAL_PRODUCTION_SERVER", durationMs: loaderMs },
      ssr: {
        authority: "LOCAL_PRODUCTION_SERVER",
        durationMs: stageDurations.ssr,
      },
      hydration: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        durationMs: stageDurations.hydration,
      },
      styleResolution: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        durationMs: stageDurations.styleResolution,
      },
      renderAdapter: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        durationMs: stageDurations.renderAdapter,
      },
      konvaMount: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        durationMs: stageDurations.konvaMount,
      },
      snapHitPreparation: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        durationMs: stageDurations.snapHitPreparation,
      },
      pdf: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        durationMs: stageDurations.pdf,
      },
      ifc: {
        authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
        durationMs: stageDurations.ifc,
      },
    },
    firstUsable: {
      durationMs: firstUsableMs,
      targetMs: 2_500,
      status: firstUsableStatus,
    },
    warm: {
      samples: {
        zoom: frames.zoom.length,
        pan: frames.pan.length,
        selection: frames.selection.length,
      },
      p95Ms,
      targetMs: 16.7,
      status: warmStatus,
    },
    determinism: { runs: 100, ...hashes },
    gates: { local: localStatus, productionRuntime: "UNEXECUTED" },
  };
  const evidencePath = writeDrawingP7PerformanceEvidence(evidence);
  await test.info().attach("P7 whole-workspace performance evidence", {
    path: evidencePath,
    contentType: "application/json",
  });
  test.info().annotations.push({
    type: "P7 performance gate",
    description: JSON.stringify(evidence),
  });
  expect(firstUsableStatus, `first usable ${firstUsableMs.toFixed(1)} ms`).toBe(
    "MET",
  );
  expect(warmStatus, `warm p95 ${JSON.stringify(p95Ms)}`).toBe("MET");
});
