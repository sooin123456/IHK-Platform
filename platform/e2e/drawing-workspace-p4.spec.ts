import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Download, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const previewPath = "/workspace-preview/drawing-workspace";
const artifactRoot = process.env.DRAWING_P4_ARTIFACT_ROOT
  ? path.resolve(process.env.DRAWING_P4_ARTIFACT_ROOT)
  : path.resolve("..", ".superpowers/sdd/2026-08-26-drawing-workspace-p4");

async function openPreview(page: Page, query = "") {
  await page.goto(`${previewPath}${query}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect(page.getByRole("tablist", { name: "도면 도구" })).toBeVisible();
}

type DrawingDurabilityGate = {
  active: boolean;
  pending(): number;
  release(): void;
};

async function installDrawingDurabilityGate(page: Page) {
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(
      IDBTransaction.prototype,
      "oncomplete",
    );
    if (!descriptor?.get || !descriptor.set)
      throw new Error("IDBTransaction.oncomplete is unavailable.");
    const delayed: Array<() => void> = [];
    const browser = globalThis as typeof globalThis & {
      __drawingDurabilityGate?: DrawingDurabilityGate;
    };
    browser.__drawingDurabilityGate = {
      active: false,
      pending: () => delayed.length,
      release() {
        this.active = false;
        for (const complete of delayed.splice(0)) complete();
      },
    };
    Object.defineProperty(IDBTransaction.prototype, "oncomplete", {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get() {
        return descriptor.get!.call(this);
      },
      set(handler) {
        if (typeof handler !== "function") {
          descriptor.set!.call(this, handler);
          return;
        }
        descriptor.set!.call(
          this,
          function (this: IDBTransaction, event: Event) {
            const transaction = this;
            const complete = () => handler.call(transaction, event);
            if (browser.__drawingDurabilityGate?.active) delayed.push(complete);
            else complete();
          },
        );
      },
    });
  });
}

function drawingDurabilityGate(page: Page) {
  return page.evaluate(() => {
    const gate = (
      globalThis as typeof globalThis & {
        __drawingDurabilityGate?: DrawingDurabilityGate;
      }
    ).__drawingDurabilityGate;
    if (!gate) throw new Error("Drawing durability gate is unavailable.");
    return { active: gate.active, pending: gate.pending() };
  });
}

async function openObjectInspector(page: Page) {
  const objectTab = page.getByRole("tab", { name: "객체", exact: true });
  await objectTab.click();
  await expect(objectTab).toHaveAttribute("aria-selected", "true");
}

async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Download stream is unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function exportBytes(page: Page, format: "SVG" | "PNG" | "PDF") {
  await page.getByRole("button", { name: "내보내기" }).click();
  const dialog = page.getByRole("dialog", { name: "도면 내보내기" });
  await dialog.getByRole("radio", { name: format }).check();
  if (format !== "SVG")
    await dialog.getByLabel("PNG 렌더 배율").selectOption("1");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "다운로드" }).click(),
  ]);
  const bytes = await downloadBytes(download);
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  return bytes;
}

type MountedSnapshot = {
  activeCanvasId: string | null;
  layers: Record<string, any>;
  objects: Record<string, any>;
  operationIds: string[];
  redoIds: string[];
  selectedIds: string[];
  undoIds: string[];
};

async function mountedSnapshot(page: Page) {
  const output = page.getByLabel("P4 mounted workspace snapshot");
  await expect(output).not.toHaveText("null");
  return JSON.parse((await output.textContent()) ?? "null") as MountedSnapshot;
}

async function clientPointForWorld(
  page: Page,
  point: { x: number; y: number },
) {
  const surface = page.getByLabel(/도면 화면/);
  const box = await surface.boundingBox();
  if (!box) throw new Error("Drawing surface is not measurable.");
  const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
  const x =
    Number(await surface.getAttribute("data-viewport-x")) + point.x * zoom;
  const y =
    Number(await surface.getAttribute("data-viewport-y")) + point.y * zoom;
  return {
    client: { x: box.x + x, y: box.y + y },
    local: { x, y },
  };
}

async function clickWorld(page: Page, point: { x: number; y: number }) {
  const surface = page.getByLabel(/도면 화면/);
  const position = await clientPointForWorld(page, point);
  await surface.click({ position: position.local });
  await page.waitForTimeout(120);
}

async function dragWorld(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const start = await clientPointForWorld(page, from);
  const end = await clientPointForWorld(page, to);
  await page.mouse.move(start.client.x, start.client.y);
  await page.mouse.down();
  await page.mouse.move(end.client.x, end.client.y, { steps: 8 });
  await page.mouse.up();
}

async function useSemanticTool(page: Page, name: string) {
  await page.getByRole("button", { name: "건축 객체" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

function semanticObjects(snapshot: MountedSnapshot) {
  return Object.values(snapshot.objects).filter((object) =>
    ["wall", "opening", "space", "area", "grid", "arc"].includes(
      object.geometry.type,
    ),
  );
}

function semanticContent(snapshot: MountedSnapshot) {
  return Object.fromEntries(
    Object.entries(snapshot.objects).map(([id, object]) => {
      const { version: _version, ...content } = object;
      return [id, content];
    }),
  );
}

function hostedOpeningCenter(snapshot: MountedSnapshot, openingId: string) {
  const opening = snapshot.objects[openingId].geometry;
  const wall = snapshot.objects[opening.hostWallId].geometry;
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  return {
    x: wall.start.x + (dx / length) * opening.offsetMillimeters,
    y: wall.start.y + (dy / length) * opening.offsetMillimeters,
  };
}

test("P4 preview keeps Result as the default inspector", async ({ page }) => {
  await openPreview(page, "?verticalTest=1");
  await expect(
    page.getByRole("tab", { name: "결과", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("P4 populated preview exports every semantic object", async ({ page }) => {
  const ifcPath = path.resolve("../samples/sample.ifc");
  const ifcBefore = createHash("sha256")
    .update(await readFile(ifcPath))
    .digest("hex");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPreview(page);
  const surface = page.getByLabel(/도면 화면/);
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "8",
  );
  const semanticList = page.getByRole("list", { name: "건축 객체 목록" });
  await expect(semanticList).toContainText("회의실 외벽 · wall");
  await expect(semanticList).toContainText("회의실 동측벽 · wall");
  await expect(semanticList).toContainText("D-101 · opening");
  await expect(semanticList).toContainText("W-101 · opening");
  await expect(semanticList).toContainText("회의실 · space");
  await expect(semanticList).toContainText("외부 포장 · area");
  await expect(semanticList).toContainText("A · grid");
  await expect(semanticList).toContainText("처마 호 · arc");
  await page.getByRole("tab", { name: "표·일람" }).click();
  await expect(
    page.getByRole("table", { name: "Room schedule · 미리보기" }),
  ).toContainText("회의실");
  await expect(
    page.getByRole("table", { name: "Door schedule · 미리보기" }),
  ).toContainText("D-101");
  await expect(
    page.getByRole("table", { name: "Finish schedule · 미리보기" }),
  ).toContainText("카펫 타일");

  const svg = (await exportBytes(page, "SVG")).toString("utf8");
  expect(svg.match(/data-semantic-type=/g) ?? []).toHaveLength(8);
  expect(svg).toContain("101 · 회의실");
  expect(svg).toContain("외부 포장");
  expect(svg).toContain('aria-label="A · grid"');
  expect(svg).toContain('<tspan x="40" y="0">A</tspan>');
  const png = await exportBytes(page, "PNG");
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

  await page.screenshot({
    path: path.join(artifactRoot, "task-6-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.screenshot({
    path: path.join(artifactRoot, "task-6-tablet.png"),
    fullPage: true,
  });
  expect(
    createHash("sha256")
      .update(await readFile(ifcPath))
      .digest("hex"),
  ).toBe(ifcBefore);
});

test("hidden host visibility excludes hosted openings from every mounted semantic surface and restores them", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPreview(page, "?hiddenHostTest=1&awarenessTest=1&verticalTest=1");
  await openObjectInspector(page);
  const surface = page.getByLabel(/도면 화면/);
  const semanticList = page.getByRole("list", { name: "건축 객체 목록" });
  const localAwareness = page.getByLabel("로컬 Awareness payload");
  const openingId = "00000000-0000-4000-8000-000000000101";
  const unlockedOpeningId = "00000000-0000-4000-8000-000000000102";
  const remoteLockStatus = page.getByRole("status", {
    name: "객체 잠금 상태",
  });
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "0",
  );
  await expect(surface).toHaveAttribute("data-remote-selection-count", "0");
  await expect(semanticList).not.toContainText("D-101");
  await page.getByRole("button", { name: "선택 도구" }).click();
  await clickWorld(page, { x: 305, y: 780 });
  await expect(surface).toHaveAttribute("data-selected-object-name", "");

  await page.getByRole("tab", { name: "페이지·레이어" }).click();
  const hostLayerVisibility = page.getByLabel("레이어 표시: 건축 작업");
  if (!(await hostLayerVisibility.isChecked()))
    await hostLayerVisibility.click();
  await expect(hostLayerVisibility).toBeChecked();
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "8",
  );
  await expect(surface).toHaveAttribute("data-remote-selection-count", "3");
  await expect(remoteLockStatus).toContainText("김도윤님이 D-101 편집 중");
  await expect(semanticList).toContainText(
    "D-101 · opening · door · 오프셋 230 mm · 너비 90 mm · 높이 2100 mm · 문턱 0 mm",
  );

  await page.getByRole("button", { name: "P4 첫 개구부 선택" }).click();
  await expect
    .poll(async () => (await mountedSnapshot(page)).selectedIds)
    .toEqual([openingId]);
  await expect
    .poll(
      async () =>
        JSON.parse((await localAwareness.textContent()) ?? "null")?.selectedIds,
    )
    .toEqual([openingId]);

  await page.getByRole("button", { name: "P4 두 번째 개구부 선택" }).click();
  await expect
    .poll(async () => (await mountedSnapshot(page)).selectedIds)
    .toEqual([unlockedOpeningId]);
  await page
    .getByRole("button", { name: "P4 실제 Awareness lease 잠금" })
    .click();
  await expect
    .poll(async () => {
      const state = JSON.parse((await localAwareness.textContent()) ?? "null");
      return {
        selectedIds: state?.selectedIds,
        softLockIds: state?.softLocks?.map(
          (lock: { entityId: string }) => lock.entityId,
        ),
      };
    })
    .toEqual({
      selectedIds: [unlockedOpeningId],
      softLockIds: [unlockedOpeningId],
    });

  await hostLayerVisibility.click();
  await expect(hostLayerVisibility).not.toBeChecked();
  await expect
    .poll(async () => (await mountedSnapshot(page)).selectedIds)
    .toEqual([]);
  await expect
    .poll(
      async () =>
        JSON.parse((await localAwareness.textContent()) ?? "null")?.selectedIds,
    )
    .toEqual([]);
  await expect
    .poll(
      async () =>
        JSON.parse((await localAwareness.textContent()) ?? "null")?.softLocks,
    )
    .toEqual([]);
  await expect(surface).toHaveAttribute("data-remote-selection-count", "0");
  await openObjectInspector(page);
  await expect(remoteLockStatus).toContainText("김도윤님이 D-101 편집 중");

  await hostLayerVisibility.click();
  await expect(hostLayerVisibility).toBeChecked();
  await expect
    .poll(async () => (await mountedSnapshot(page)).selectedIds)
    .toEqual([]);
  await expect
    .poll(
      async () =>
        JSON.parse((await localAwareness.textContent()) ?? "null")?.selectedIds,
    )
    .toEqual([]);
  await expect(surface).toHaveAttribute("data-remote-selection-count", "3");
  await expect(remoteLockStatus).toContainText("김도윤님이 D-101 편집 중");
  await page.waitForTimeout(5_500);
  await expect
    .poll(
      async () =>
        JSON.parse((await localAwareness.textContent()) ?? "null")?.softLocks,
    )
    .toEqual([]);
});

test("capability loss releases a real local lease without renewal resurrection", async ({
  page,
}) => {
  await openPreview(page, "?awarenessTest=1&realtimeTest=1&verticalTest=1");
  await openObjectInspector(page);
  const localAwareness = page.getByLabel("로컬 Awareness payload");
  const unlockedOpeningId = "00000000-0000-4000-8000-000000000102";
  const remoteLockStatus = page.getByRole("status", {
    name: "객체 잠금 상태",
  });
  await expect(remoteLockStatus).toContainText("김도윤님이 D-101 편집 중");
  await page.getByRole("button", { name: "P4 두 번째 개구부 선택" }).click();
  await page
    .getByRole("button", { name: "P4 실제 Awareness lease 잠금" })
    .click();
  await expect
    .poll(async () => {
      const state = JSON.parse((await localAwareness.textContent()) ?? "null");
      return state?.softLocks?.map(
        (lock: { entityId: string }) => lock.entityId,
      );
    })
    .toEqual([unlockedOpeningId]);

  await page.getByRole("button", { name: "테스트 보기 권한" }).click();
  await expect
    .poll(async () => {
      const state = JSON.parse((await localAwareness.textContent()) ?? "null");
      return state?.softLocks ?? [];
    })
    .toEqual([]);
  await page.waitForTimeout(5_500);
  await expect
    .poll(async () => {
      const state = JSON.parse((await localAwareness.textContent()) ?? "null");
      return state?.softLocks ?? [];
    })
    .toEqual([]);
  await expect(remoteLockStatus).toContainText("김도윤님이 D-101 편집 중");
});

test("mounted bridge preserves a rapid hosted-wall keyboard burst", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPreview(page, "?verticalTest=1");
  await openObjectInspector(page);
  const wallId = "00000000-0000-4000-8000-000000000100";
  const openingId = "00000000-0000-4000-8000-000000000101";
  const before = await mountedSnapshot(page);
  await page.getByRole("button", { name: "선택 도구" }).click();
  await clickWorld(page, { x: 500, y: 720 });
  await expect
    .poll(async () => (await mountedSnapshot(page)).selectedIds)
    .toEqual([wallId]);

  const burst = [
    ...Array(12).fill("Shift+ArrowRight"),
    ...Array(7).fill("Shift+ArrowDown"),
    ...Array(5).fill("Shift+ArrowLeft"),
    ...Array(3).fill("Shift+ArrowUp"),
  ];
  for (const key of burst) await page.keyboard.press(key);

  await page.getByLabel("벽 두께").fill("220");
  await page.getByLabel("벽 높이").fill("3200");
  await page.getByRole("button", { name: "건축 속성 적용" }).click();
  await page.getByLabel(/도면 화면/).focus();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+Shift+z");
  await expect
    .poll(async () => (await mountedSnapshot(page)).operationIds.length)
    .toBe(before.operationIds.length + burst.length + 3);
  await expect
    .poll(async () => (await mountedSnapshot(page)).objects[wallId].version)
    .toBe(before.objects[wallId].version + burst.length + 3);
  const after = await mountedSnapshot(page);
  expect(after.objects[wallId].geometry.start).toEqual({ x: 190, y: 760 });
  expect(after.objects[wallId].geometry.end).toEqual({ x: 970, y: 760 });
  expect(after.objects[wallId].geometry.thicknessMillimeters).toBe(220);
  expect(after.objects[wallId].geometry.heightMillimeters).toBe(3200);
  expect(after.objects[openingId].geometry).toEqual(
    before.objects[openingId].geometry,
  );
  await expect(page.getByLabel("공동 편집 작업 차단 안내")).toHaveCount(0);
  await page.getByRole("button", { name: "P4 첫 개구부 선택" }).click();
  await expect
    .poll(async () => (await mountedSnapshot(page)).selectedIds)
    .toEqual([openingId]);
  await dragWorld(page, { x: 420, y: 760 }, { x: 440, y: 760 });
  await dragWorld(page, { x: 440, y: 760 }, { x: 460, y: 760 });
  await expect
    .poll(
      async () =>
        (await mountedSnapshot(page)).objects[openingId].geometry
          .offsetMillimeters,
    )
    .toBe(270);
  expect(
    (await mountedSnapshot(page)).objects[openingId].version,
  ).toBeGreaterThan(before.objects[openingId].version);

  const durable = await mountedSnapshot(page);
  expect(durable.objects[wallId].geometry.thicknessMillimeters).toBe(220);
  expect(durable.objects[wallId].geometry.heightMillimeters).toBe(3200);
  await page.getByRole("button", { name: "P4 로컬 저장 동기화" }).click();
  await expect(page.getByLabel("P4 mounted command result")).toHaveText(
    "로컬 저장 동기화됨",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect
    .poll(async () => (await mountedSnapshot(page)).operationIds)
    .toEqual(durable.operationIds);
  const reloaded = await mountedSnapshot(page);
  expect(reloaded.objects).toEqual(durable.objects);
  expect(reloaded.operationIds).toEqual(durable.operationIds);
  expect(reloaded.undoIds).toEqual(durable.undoIds);
  expect(reloaded.redoIds).toEqual(durable.redoIds);
});

test("semantic inspector preserves a dirty field across an unrelated authoritative projection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPreview(page, "?verticalTest=1");
  await openObjectInspector(page);
  const wallId = "00000000-0000-4000-8000-000000000100";
  await page.getByRole("button", { name: "선택 도구" }).click();
  await clickWorld(page, { x: 500, y: 720 });
  await page.getByLabel("벽 두께").fill("220");
  await page.getByRole("button", { name: "P4 원격 벽 이름 변경" }).click();
  await expect(page.getByLabel("벽 두께")).toHaveValue("220");
  await expect(
    page.getByText(/편집 중인 건축 속성이 다른 변경에서 수정되었습니다/),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "건축 속성 적용" }).click();
  await expect
    .poll(
      async () =>
        (await mountedSnapshot(page)).objects[wallId].geometry
          .thicknessMillimeters,
    )
    .toBe(220);
  const applied = await mountedSnapshot(page);
  expect(applied.objects[wallId].name).toContain("원격");
  expect(applied.operationIds).toHaveLength(2);
});

test("semantic inspector blocks same-field projections and clears on cancel, selection, and deletion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPreview(page, "?verticalTest=1");
  await openObjectInspector(page);
  const wallId = "00000000-0000-4000-8000-000000000100";
  const arcId = "00000000-0000-4000-8000-000000000106";
  await page.getByRole("button", { name: "선택 도구" }).click();
  await clickWorld(page, { x: 500, y: 720 });
  await page.getByLabel("벽 두께").fill("220");
  await page.getByRole("button", { name: "P4 원격 벽 두께 변경" }).click();
  await expect(page.getByLabel("벽 두께")).toHaveValue("220");
  await expect(
    page.getByText(/편집 중인 건축 속성이 다른 변경에서 수정되었습니다/),
  ).toBeVisible();
  await page.getByRole("button", { name: "건축 속성 적용" }).click();
  const conflicted = await mountedSnapshot(page);
  expect(conflicted.operationIds).toHaveLength(1);
  expect(conflicted.objects[wallId].geometry.thicknessMillimeters).toBe(24);

  await page.getByRole("button", { name: "건축 속성 취소" }).click();
  await expect(page.getByLabel("벽 두께")).toHaveValue("24");
  await expect(
    page.getByText(/편집 중인 건축 속성이 다른 변경에서 수정되었습니다/),
  ).toHaveCount(0);
  await page.getByLabel("벽 두께").fill("230");
  await clickWorld(page, { x: 350, y: 720 });
  await expect(page.getByLabel("개구부 너비")).toBeVisible();
  await clickWorld(page, { x: 500, y: 720 });
  await expect(page.getByLabel("벽 두께")).toHaveValue("24");

  await clickWorld(page, { x: 950, y: 690 });
  await expect
    .poll(async () => (await mountedSnapshot(page)).selectedIds)
    .toEqual([arcId]);
  await page.getByLabel("호 반지름").fill("100");
  await page.getByLabel(/도면 화면/).focus();
  await page.keyboard.press("Delete");
  await expect
    .poll(async () => (await mountedSnapshot(page)).objects[arcId])
    .toBeUndefined();
  await expect(page.getByLabel("호 반지름")).toHaveCount(0);
});

test("P4 integrated architectural authoring, conflict, restore, permissions, freeze, and durable export vertical", async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  const sourcePdfPath = path.resolve(
    "../.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-10-artifacts/representative-drawing.pdf",
  );
  const ifcPath = path.resolve("../samples/sample.ifc");
  const sourcePdfBytes = await readFile(sourcePdfPath);
  const before = {
    pdf: createHash("sha256").update(sourcePdfBytes).digest("hex"),
    ifc: createHash("sha256")
      .update(await readFile(ifcPath))
      .digest("hex"),
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await openPreview(page, "?verticalTest=1");
  const surface = page.getByLabel(/도면 화면/);
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "8",
  );
  const initial = await mountedSnapshot(page);
  const initialSemantic = semanticContent(initial);
  const initialIds = Object.keys(initial.objects);
  const initialSvg = await exportBytes(page, "SVG");
  await page.getByRole("tab", { name: "표·일람" }).click();
  const initialSchedules = await Promise.all(
    ["Room", "Door", "Finish"].map((name) =>
      page
        .getByRole("table", { name: new RegExp(`^${name} schedule`) })
        .innerText(),
    ),
  );

  await openPreview(page, "?verticalTest=1&reviewFreezeTest=1");
  const review = page.getByRole("button", { name: "검토 요청" });
  const reviewClick = review.click();
  await expect(
    page.getByRole("textbox", { name: "새 레이어 이름" }),
  ).toBeHidden();
  await reviewClick;
  await expect(page.getByText("로컬 동결 실패 복구 시험")).toBeVisible();
  await page.getByText("레이어 만들기", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "새 레이어 이름" }),
  ).toBeVisible();
  await openPreview(page, "?verticalTest=1");
  await openObjectInspector(page);

  await useSemanticTool(page, "벽 도구");
  await clickWorld(page, { x: 100, y: 400 });
  await clickWorld(page, { x: 1400, y: 400 });
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "9",
  );

  await useSemanticTool(page, "개구부 도구");
  await clickWorld(page, { x: 900, y: 400 });
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "10",
  );
  await page.getByRole("button", { name: "선택 도구" }).click();
  await clickWorld(page, { x: 900, y: 400 });
  await page.getByLabel("벽 기준 오프셋").fill("1150");
  await page.getByLabel("개구부 너비").fill("200");
  await page.getByRole("button", { name: "건축 속성 적용" }).click();
  await expect(page.getByLabel("벽 기준 오프셋")).toHaveValue("1150");
  await useSemanticTool(page, "개구부 도구");
  await clickWorld(page, { x: 600, y: 400 });
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "11",
  );

  for (const [tool, points, count] of [
    [
      "공간 도구",
      [
        { x: 100, y: 500 },
        { x: 300, y: 500 },
        { x: 300, y: 650 },
        { x: 100, y: 650 },
      ],
      "12",
    ],
    [
      "영역 도구",
      [
        { x: 400, y: 500 },
        { x: 600, y: 500 },
        { x: 600, y: 650 },
        { x: 400, y: 650 },
      ],
      "13",
    ],
  ] as const) {
    await useSemanticTool(page, tool);
    for (const point of points) await clickWorld(page, point);
    await page.keyboard.press("Enter");
    await expect(surface).toHaveAttribute(
      "data-rendered-semantic-object-count",
      count,
    );
  }

  await useSemanticTool(page, "그리드 도구");
  await clickWorld(page, { x: 700, y: 550 });
  await clickWorld(page, { x: 1400, y: 550 });
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "14",
  );

  await useSemanticTool(page, "호 도구");
  await clickWorld(page, { x: 1000, y: 700 });
  await clickWorld(page, { x: 1100, y: 700 });
  await clickWorld(page, { x: 1000, y: 800 });
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "15",
  );

  const authored = await mountedSnapshot(page);
  const authoredIds = Object.keys(authored.objects).filter(
    (id) => !initialIds.includes(id),
  );
  expect(authoredIds).toHaveLength(7);
  expect(
    authoredIds.map((id) => authored.objects[id].geometry.type).sort(),
  ).toEqual(["arc", "area", "grid", "opening", "opening", "space", "wall"]);
  const wallId = authoredIds.find(
    (id) => authored.objects[id].geometry.type === "wall",
  )!;
  const [openingId, windowId] = authoredIds
    .filter((id) => authored.objects[id].geometry.type === "opening")
    .sort(
      (left, right) =>
        authored.objects[left].geometry.offsetMillimeters -
        authored.objects[right].geometry.offsetMillimeters,
    );
  expect(authored.objects[openingId].geometry.hostWallId).toBe(wallId);
  expect(authored.objects[windowId].geometry.hostWallId).toBe(wallId);
  expect(authored.objects[openingId].geometry.openingKind).toBe("door");
  await page.getByRole("button", { name: "선택 도구" }).click();
  await clickWorld(page, hostedOpeningCenter(authored, windowId));
  await page.getByLabel("개구부 종류").selectOption("window");
  await page.getByRole("button", { name: "건축 속성 적용" }).click();
  await expect
    .poll(
      async () =>
        (await mountedSnapshot(page)).objects[windowId].geometry.openingKind,
    )
    .toBe("window");

  const authoredDoorAndWindow = await mountedSnapshot(page);
  const beforeReload = {
    objects: authoredDoorAndWindow.objects,
    objectIds: Object.keys(authoredDoorAndWindow.objects),
    operationIds: authoredDoorAndWindow.operationIds,
  };
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "15",
  );
  const reloaded = await mountedSnapshot(page);
  expect(Object.keys(reloaded.objects)).toEqual(beforeReload.objectIds);
  expect(reloaded.objects).toEqual(beforeReload.objects);
  expect(reloaded.operationIds).toEqual(beforeReload.operationIds);

  await page.getByRole("button", { name: "선택 도구" }).click();
  await clickWorld(page, { x: 1380, y: 400 });
  await expect
    .poll(async () => (await mountedSnapshot(page)).selectedIds)
    .toEqual([wallId]);
  await page
    .getByRole("button", { name: "P4 선택 벽과 개구부 원자 삭제" })
    .click();
  await expect(page.getByLabel("P4 mounted command result")).toHaveText(
    "호스트와 개구부 원자 삭제됨",
  );
  await expect
    .poll(async () => {
      const snapshot = await mountedSnapshot(page);
      return [wallId, openingId, windowId].map((id) => id in snapshot.objects);
    })
    .toEqual([false, false, false]);
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "12",
  );
  const deletedSnapshot = await mountedSnapshot(page);
  await expect(
    page.getByRole("status", { name: "저장 상태: 저장됨" }),
  ).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect
    .poll(async () => (await mountedSnapshot(page)).undoIds)
    .toEqual(deletedSnapshot.undoIds);
  await page.getByRole("button", { name: "P4 원자 삭제 복원" }).click();
  await expect(page.getByLabel("P4 mounted command result")).toHaveText(
    "호스트와 개구부 원자 삭제 실행 취소됨",
  );
  await expect
    .poll(async () => {
      const snapshot = await mountedSnapshot(page);
      return [wallId, openingId, windowId].map((id) => id in snapshot.objects);
    })
    .toEqual([true, true, true]);
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "15",
  );
  expect(
    (await mountedSnapshot(page)).objects[windowId].geometry.openingKind,
  ).toBe("window");

  await page.getByRole("button", { name: "선택 도구" }).click();
  await clickWorld(page, { x: 1380, y: 400 });
  await expect
    .poll(async () => (await mountedSnapshot(page)).selectedIds)
    .toEqual([wallId]);
  await openObjectInspector(page);
  await expect(page.getByLabel("벽 두께")).toBeVisible();
  await page.getByLabel("벽 두께").fill("240");
  await page.getByRole("button", { name: "건축 속성 적용" }).click();
  await expect
    .poll(
      async () =>
        (await mountedSnapshot(page)).objects[wallId].geometry
          .thicknessMillimeters,
    )
    .toBe(240);

  const beforeWallMove = await mountedSnapshot(page);
  const wallBefore = beforeWallMove.objects[wallId].geometry;
  const openingBefore = beforeWallMove.objects[openingId].geometry;
  await surface.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect
    .poll(
      async () =>
        (await mountedSnapshot(page)).objects[wallId].geometry.start.x,
    )
    .toBe(wallBefore.start.x + 10);
  await expect
    .poll(
      async () =>
        (await mountedSnapshot(page)).objects[wallId].geometry.start.y,
    )
    .toBe(wallBefore.start.y + 10);
  const afterWallMove = await mountedSnapshot(page);
  const wallAfter = afterWallMove.objects[wallId].geometry;
  const openingAfterWallMove = afterWallMove.objects[openingId].geometry;
  expect(wallAfter.start.y).toBe(wallBefore.start.y + 10);
  expect(openingAfterWallMove.hostWallId).toBe(wallId);
  expect(openingAfterWallMove.offsetMillimeters).toBe(
    openingBefore.offsetMillimeters,
  );

  const followedCenter = hostedOpeningCenter(afterWallMove, openingId);
  await clickWorld(page, followedCenter);
  await expect
    .poll(async () => (await mountedSnapshot(page)).selectedIds)
    .toEqual([openingId]);
  const offsetBeforeOpeningMove =
    afterWallMove.objects[openingId].geometry.offsetMillimeters;
  await dragWorld(page, followedCenter, {
    x: followedCenter.x + 100,
    y: followedCenter.y,
  });
  await expect
    .poll(
      async () =>
        (await mountedSnapshot(page)).objects[openingId].geometry
          .offsetMillimeters,
    )
    .not.toBe(offsetBeforeOpeningMove);
  const offsetAfterOpeningMove = (await mountedSnapshot(page)).objects[
    openingId
  ].geometry.offsetMillimeters;

  await page.getByRole("button", { name: "실행 취소" }).click();
  await expect
    .poll(
      async () =>
        (await mountedSnapshot(page)).objects[openingId].geometry
          .offsetMillimeters,
    )
    .toBe(offsetBeforeOpeningMove);
  await page.getByRole("button", { name: "다시 실행" }).click();
  await expect
    .poll(
      async () =>
        (await mountedSnapshot(page)).objects[openingId].geometry
          .offsetMillimeters,
    )
    .toBe(offsetAfterOpeningMove);

  await page.getByRole("button", { name: "속성 검사기 숨기기" }).click();
  await clickWorld(page, { x: 1390, y: 410 });
  const validWallGeometry = structuredClone(
    (await mountedSnapshot(page)).objects[wallId].geometry,
  );
  await page.getByRole("button", { name: "P4 선택 벽 잘못 축소 시도" }).click();
  await expect(page.getByLabel("P4 mounted command result")).toContainText(
    "잘못된 축소 거부됨",
  );
  expect((await mountedSnapshot(page)).objects[wallId].geometry).toEqual(
    validWallGeometry,
  );

  await openPreview(page, "?verticalTest=1&awarenessTest=1");
  await openObjectInspector(page);
  await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
    "data-remote-selection-count",
    "3",
  );
  const lockedDoorBefore = (await mountedSnapshot(page)).objects[
    "00000000-0000-4000-8000-000000000101"
  ].geometry.offsetMillimeters;
  await page.getByRole("button", { name: "P4 첫 개구부 선택" }).click();
  await expect
    .poll(async () => (await mountedSnapshot(page)).selectedIds)
    .toEqual(["00000000-0000-4000-8000-000000000101"]);
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("공동 편집 작업 차단 안내")).toContainText(
    "김도윤님이 D-101 편집 중",
  );
  expect(
    (await mountedSnapshot(page)).objects[
      "00000000-0000-4000-8000-000000000101"
    ].geometry.offsetMillimeters,
  ).toBe(lockedDoorBefore);

  await openPreview(page, "?verticalTest=1&collaborationRetryTest=1");
  await expect(page.getByLabel("협업 재시도 상태")).toHaveText("local-failed");
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByLabel("협업 재시도 상태")).toHaveText(
    "provider-failed",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByLabel("협업 재시도 상태")).toHaveText("connected");
  await openPreview(page, "?verticalTest=1");
  await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "15",
  );
  expect(Object.keys((await mountedSnapshot(page)).objects).sort()).toEqual(
    [...beforeReload.objectIds].sort(),
  );

  await page.getByRole("tab", { name: "페이지·레이어" }).click();
  const workLayerLock = page.getByLabel("레이어 잠금: 건축 작업");
  await expect(
    page.getByRole("status", { name: "공동 편집 상태: connected" }),
  ).toBeVisible();
  await page.waitForTimeout(250);
  await workLayerLock.click();
  await expect
    .poll(
      async () =>
        (await mountedSnapshot(page)).layers[
          "00000000-0000-4000-8000-000000000031"
        ].locked,
    )
    .toBe(true);
  const lockedWallGeometry = structuredClone(
    (await mountedSnapshot(page)).objects[wallId].geometry,
  );
  await page.getByRole("button", { name: "선택 도구" }).click();
  await dragWorld(page, { x: 310, y: 410 }, { x: 410, y: 410 });
  expect((await mountedSnapshot(page)).objects[wallId].geometry).toEqual(
    lockedWallGeometry,
  );
  await workLayerLock.click();
  await expect
    .poll(
      async () =>
        (await mountedSnapshot(page)).layers[
          "00000000-0000-4000-8000-000000000031"
        ].locked,
    )
    .toBe(false);

  await page.screenshot({
    path: path.join(artifactRoot, "task-6-fix2-integrated-authored.png"),
    fullPage: true,
  });

  await openPreview(page, "?verticalTest=1");

  const pdf = await exportBytes(page, "PDF");
  const parsed = await PDFDocument.load(pdf);
  expect(parsed.getPageCount()).toBeGreaterThan(0);
  expect(parsed.getSubject()).toBe("Canonical drawing workspace export");
  const rendered = await page.evaluate(
    async (bytes) => {
      const rendererPath = "/app/lukas/lib/pdf-page-renderer.client.ts";
      const renderer = await import(rendererPath);
      const blobUrl = URL.createObjectURL(
        new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }),
      );
      const opened = await renderer.openPdfDocument(blobUrl);
      const canvas = document.createElement("canvas");
      const pageRender = await renderer.renderPdfPageToCanvas({
        document: opened.document,
        pageNumber: 1,
        canvas,
        hostWidth: 900,
        zoom: 1,
      });
      const pixels = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let nonWhite = 0;
      for (let index = 0; index < pixels.length; index += 4)
        if (
          pixels[index] < 250 ||
          pixels[index + 1] < 250 ||
          pixels[index + 2] < 250
        )
          nonWhite += 1;
      pageRender.cleanup();
      await opened.destroy();
      URL.revokeObjectURL(blobUrl);
      return { height: canvas.height, nonWhite, width: canvas.width };
    },
    [...pdf],
  );
  expect(rendered.width).toBeGreaterThan(0);
  expect(rendered.height).toBeGreaterThan(0);
  expect(rendered.nonWhite).toBeGreaterThan(100);

  const sourceRendered = await page.evaluate(
    async (bytes) => {
      const rendererPath = "/app/lukas/lib/pdf-page-renderer.client.ts";
      const renderer = await import(rendererPath);
      const url = URL.createObjectURL(
        new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }),
      );
      const opened = await renderer.openPdfDocument(url);
      const pages = opened.document.numPages;
      await opened.destroy();
      URL.revokeObjectURL(url);
      return pages;
    },
    [...sourcePdfBytes],
  );
  expect(sourceRendered).toBeGreaterThan(0);

  const changedBeforeRestore = await mountedSnapshot(page);
  expect(semanticObjects(changedBeforeRestore)).toHaveLength(15);
  await page.getByRole("tab", { name: "변경 이력" }).click();
  await page.getByRole("button", { name: /상태로 복원/ }).click();
  await expect(
    page.getByText("체크포인트 복원 작업을 안전하게 저장했습니다."),
  ).toBeVisible();
  await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "8",
  );
  const restored = await mountedSnapshot(page);
  expect(semanticContent(restored)).toEqual(initialSemantic);
  expect(
    restored.objects["00000000-0000-4000-8000-000000000101"].geometry
      .hostWallId,
  ).toBe("00000000-0000-4000-8000-000000000100");
  await page.getByRole("tab", { name: "표·일람" }).click();
  const restoredSchedules = await Promise.all(
    ["Room", "Door", "Finish"].map((name) =>
      page
        .getByRole("table", { name: new RegExp(`^${name} schedule`) })
        .innerText(),
    ),
  );
  expect(restoredSchedules).toEqual(initialSchedules);
  expect(await exportBytes(page, "SVG")).toEqual(initialSvg);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "8",
  );
  expect(semanticContent(await mountedSnapshot(page))).toEqual(initialSemantic);

  await openPreview(page, "?verticalTest=1&bootstrapReadOnlyTest=1");
  await expect(page.getByRole("button", { name: "건축 객체" })).toBeHidden();
  await expect(
    page.getByRole("status", { name: "공동 편집 상태: connected" }),
  ).toContainText("읽기 전용");
  const beforeViewerAttempt = semanticContent(await mountedSnapshot(page));
  await page.getByRole("button", { name: "P4 직접 변경 시도" }).click();
  await expect(page.getByLabel("P4 mounted command result")).toHaveText(
    "직접 변경 권한 차단됨",
  );
  expect(semanticContent(await mountedSnapshot(page))).toEqual(
    beforeViewerAttempt,
  );

  await page.screenshot({
    path: path.join(artifactRoot, "task-6-fix2-integrated-restored.png"),
    fullPage: true,
  });
  expect(
    createHash("sha256")
      .update(await readFile(sourcePdfPath))
      .digest("hex"),
  ).toBe(before.pdf);
  expect(
    createHash("sha256")
      .update(await readFile(ifcPath))
      .digest("hex"),
  ).toBe(before.ifc);
});

test("P4 awareness exposes semantic selection and lock", async ({ page }) => {
  await openPreview(page, "?awarenessTest=1");
  await openObjectInspector(page);
  const surface = page.getByLabel(/도면 화면/);
  await expect(surface).toHaveAttribute("data-remote-selection-count", "3");
  await expect(
    page.getByRole("status", { name: "객체 잠금 상태" }),
  ).toContainText("김도윤님이 D-101 편집 중");
});

test("checkpoint restore stays unsaved and blocks navigation until IndexedDB persistence settles", async ({
  page,
}) => {
  await installDrawingDurabilityGate(page);
  await openPreview(page, "?verticalTest=1");
  await expect(page.getByRole("button", { name: "건축 객체" })).toBeEnabled();

  await page.getByRole("button", { name: "P4 직접 변경 시도" }).click();
  await expect(page.getByLabel("P4 mounted command result")).toHaveText(
    "직접 변경 제출됨",
  );
  await expect(
    page.getByRole("status", { name: "저장 상태: 저장됨" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "변경 이력" }).click();
  await page.evaluate(() => {
    const gate = (
      globalThis as typeof globalThis & {
        __drawingDurabilityGate?: DrawingDurabilityGate;
      }
    ).__drawingDurabilityGate;
    if (!gate) throw new Error("Drawing durability gate is unavailable.");
    gate.active = true;
  });
  await page.getByRole("button", { name: /상태로 복원/ }).click();

  await expect
    .poll(async () => (await drawingDurabilityGate(page)).pending)
    .toBe(1);
  await expect(
    page.getByRole("status", { name: "저장 상태: 저장 중" }),
  ).toBeVisible();

  let navigationWarning = "";
  await Promise.all([
    page.waitForEvent("dialog").then(async (dialog) => {
      navigationWarning = dialog.message();
      await dialog.dismiss();
    }),
    page.getByRole("link", { name: "협업 도면실로 돌아가기" }).click(),
  ]);
  expect(navigationWarning).toBe(
    "아직 브라우저 저장소에 저장되지 않은 도면 작업이 있습니다.",
  );
  await expect(page).toHaveURL(/\/workspace-preview\/drawing-workspace/);

  await page.evaluate(() => {
    const gate = (
      globalThis as typeof globalThis & {
        __drawingDurabilityGate?: DrawingDurabilityGate;
      }
    ).__drawingDurabilityGate;
    if (!gate) throw new Error("Drawing durability gate is unavailable.");
    gate.release();
  });
  await expect(
    page.getByText("체크포인트 복원 작업을 안전하게 저장했습니다."),
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "저장 상태: 저장됨" }),
  ).toBeVisible();
});
