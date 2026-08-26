import os from "node:os";

import { expect, test, type Locator, type Page } from "@playwright/test";

const previewPath = "/workspace-preview/drawing-workspace?performanceTest=1";

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * ratio) - 1] ?? 0;
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

test("P4 10,000 mixed semantic desktop baseline records first usable target and warm frames", async ({
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
  await page.goto(previewPath, { waitUntil: "domcontentloaded" });
  const surface = page.getByLabel(/도면 화면/);
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "10000",
    { timeout: 30_000 },
  );
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  const box = await stableSurfaceBox(surface);
  const firstUsableMs = await page.evaluate(() => performance.now());
  expect(
    firstUsableMs,
    `first usable ${firstUsableMs.toFixed(1)} ms`,
  ).toBeLessThanOrEqual(10_000);

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
    Object.assign(element, { __p4ReleasePerformance: evidence });
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
      element as HTMLElement & { __p4ReleasePerformance: { mode: string } }
    ).__p4ReleasePerformance.mode = "pan";
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
      element as HTMLElement & { __p4ReleasePerformance: { mode: string } }
    ).__p4ReleasePerformance.mode = "selection";
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
    const evidence = (
      element as HTMLElement & {
        __p4ReleasePerformance: {
          zoom: number[];
          pan: number[];
          selection: number[];
        };
      }
    ).__p4ReleasePerformance;
    return evidence;
  });
  expect(frames.zoom).toHaveLength(30);
  expect(frames.pan.length).toBeGreaterThanOrEqual(30);
  expect(frames.selection).toHaveLength(30);

  const evidence = {
    status: "MEASURED",
    authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
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
    objectMix: {
      wall: 2_000,
      opening: 2_000,
      space: 1_500,
      area: 1_500,
      grid: 1_500,
      arc: 1_500,
    },
    conditions: {
      firstUsable:
        "cold 10,000-object document navigation after warming application assets",
      frames: "warm after two zoom gestures and one pan gesture",
    },
    firstUsableMs,
    firstUsableTargetMs: 2_500,
    firstUsableTargetMet: firstUsableMs <= 2_500,
    warmSamples: {
      zoom: frames.zoom.length,
      pan: frames.pan.length,
      selection: frames.selection.length,
    },
    p95Ms: {
      zoom: percentile(frames.zoom, 0.95),
      pan: percentile(frames.pan, 0.95),
      selection: percentile(frames.selection, 0.95),
    },
    p7SixtyFpsGate: "UNEXECUTED",
    productionProviderP95: "UNEXECUTED",
  };
  test.info().annotations.push({
    type: "P4 performance baseline",
    description: JSON.stringify(evidence),
  });
});
