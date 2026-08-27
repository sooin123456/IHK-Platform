import { expect, test, type Page } from "@playwright/test";

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

test.describe.configure({ mode: "serial", timeout: 120_000 });

test("mounted IFC viewer stays loaded across 2D, 3D, and split modes and retries WebGL without refetch", async ({
  page,
}) => {
  let ifcFetches = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/examples/example.ifc")) ifcFetches += 1;
  });
  await openP5Preview(page);
  await expect(page.getByLabel("도면 캔버스")).toBeVisible();
  expect(ifcFetches).toBe(0);

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
  await expect.poll(() => ifcFetches).toBe(1);
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
  expect(ifcFetches).toBe(1);
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
  expect(ifcFetches).toBe(1);

  await page
    .getByRole("combobox", { name: "IFC 원본 선택" })
    .selectOption("00000000-0000-4000-8000-0000000000a2");
  await expect.poll(() => ifcFetches).toBe(2);
  await expect(canvas).not.toHaveAttribute(
    "data-ifc-viewer-instance",
    mountedCanvas ?? "",
  );
  await page.getByRole("combobox", { name: "IFC 원본 선택" }).selectOption("");
  await expect(page.locator('canvas[aria-label="IFC 3D 모델"]')).toHaveCount(0);
});

test("a source swap during the pending web-ifc import commits only the latest generation", async ({
  page,
}) => {
  let releaseImport!: () => void;
  let reportImport!: () => void;
  const importReleased = new Promise<void>((resolve) => {
    releaseImport = resolve;
  });
  const importStarted = new Promise<void>((resolve) => {
    reportImport = resolve;
  });
  await page.route(
    /\/node_modules\/\.vite\/deps\/web-ifc\.js/,
    async (route) => {
      reportImport();
      await importReleased;
      await route.continue();
    },
  );
  await openP5Preview(page);
  await page.getByRole("button", { name: "IFC 3D" }).click();
  await importStarted;
  await page
    .getByRole("combobox", { name: "IFC 원본 선택" })
    .selectOption("00000000-0000-4000-8000-0000000000a2");
  releaseImport();

  await expect(page).toHaveURL(/ifc=00000000-0000-4000-8000-0000000000a2/);
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
  const ifcTab = first.getByRole("tab", { name: "IFC 3D" });
  await expect(ifcTab).toHaveAttribute(
    "aria-controls",
    "drawing-split-panel-3d",
  );
  await ifcTab.focus();
  await ifcTab.press("ArrowLeft");
  await expect(first.getByRole("tab", { name: "2D 도면" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await first.getByRole("tab", { name: "2D 도면" }).press("ArrowRight");
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
