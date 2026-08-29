import { Server } from "@hocuspocus/server";
import { expect, test, type Page } from "@playwright/test";

const previewPath = "/workspace-preview/drawing-workspace";
const collaborationPort = 12347;

type MountedSnapshot = {
  selectedIds: string[];
  objects: Record<string, any>;
};

async function openMultiplayerPreview(page: Page, alternateUser = false) {
  const query = new URLSearchParams({ localMultiplayerTest: "1" });
  if (alternateUser) query.set("alternateUser", "1");
  await page.goto(`${previewPath}?${query}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect(
    page.getByRole("status", { name: "공동 편집 상태: connected" }),
  ).toBeVisible({ timeout: 30_000 });
}

async function mountedSnapshot(page: Page) {
  const output = page.getByLabel("로컬 공동 편집 workspace snapshot");
  await expect(output).not.toHaveText("null");
  return JSON.parse((await output.textContent()) ?? "null") as MountedSnapshot;
}

async function drawingPoint(page: Page, xRatio: number, yRatio: number) {
  const surface = page.getByLabel(/도면 화면/);
  const box = await surface.boundingBox();
  if (!box) throw new Error("Drawing canvas has no layout box");
  return { x: box.x + box.width * xRatio, y: box.y + box.height * yRatio };
}

test.describe.serial("1HK local Hocuspocus multiplayer authority", () => {
  const collaboration = new Server({
    address: "127.0.0.1",
    port: collaborationPort,
    quiet: true,
    stopOnSignals: false,
  });

  test.beforeAll(async () => {
    await collaboration.listen();
  });

  test.afterAll(async () => {
    await collaboration.destroy();
  });

  test("two isolated browsers share cursor, object creation, and movement", async ({
    browser,
  }) => {
    const authorContext = await browser.newContext();
    const observerContext = await browser.newContext();
    const author = await authorContext.newPage();
    const observer = await observerContext.newPage();

    try {
      await Promise.all([
        openMultiplayerPreview(author),
        openMultiplayerPreview(observer, true),
      ]);
      await Promise.all([
        expect(
          author.getByRole("status", { name: "공동 작업 참여자 2명" }),
        ).toBeVisible(),
        expect(
          observer.getByRole("status", { name: "공동 작업 참여자 2명" }),
        ).toBeVisible(),
      ]);

      const cursorTarget = await drawingPoint(author, 0.72, 0.62);
      await author.mouse.move(cursorTarget.x, cursorTarget.y);
      await expect(observer.getByLabel("나 커서")).toBeVisible();

      const before = await mountedSnapshot(author);
      const beforeIds = new Set(Object.keys(before.objects));
      await author.getByRole("button", { name: "선 도구" }).click();
      const lineStart = await drawingPoint(author, 0.62, 0.54);
      const lineEnd = await drawingPoint(author, 0.76, 0.54);
      await author.mouse.click(lineStart.x, lineStart.y);
      await author.mouse.click(lineEnd.x, lineEnd.y);

      let createdId = "";
      await expect
        .poll(async () => {
          const snapshot = await mountedSnapshot(observer);
          createdId =
            Object.keys(snapshot.objects).find((id) => !beforeIds.has(id)) ??
            "";
          return createdId;
        })
        .not.toBe("");

      const created = (await mountedSnapshot(observer)).objects[createdId];
      expect(created.geometry.type).toBe("line");

      const movingId = "00000000-0000-4000-8000-000000000070";
      const movingBefore = (await mountedSnapshot(observer)).objects[movingId];
      await author.getByRole("button", { name: "P4 첫 선 객체 선택" }).click();
      await expect
        .poll(async () => (await mountedSnapshot(author)).selectedIds)
        .toEqual([movingId]);
      await author.getByLabel(/도면 화면/).focus();
      await author.keyboard.press("ArrowRight");

      await expect
        .poll(async () => (await mountedSnapshot(observer)).objects[movingId])
        .toMatchObject({ version: movingBefore.version + 1 });
      expect(
        (await mountedSnapshot(observer)).objects[movingId].geometry,
      ).not.toEqual(movingBefore.geometry);
    } finally {
      await Promise.all([authorContext.close(), observerContext.close()]);
    }
  });
});
