import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 45_000 });

function recordErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test("public entry separates workspace use from commissioned service on desktop and mobile", async ({
  page,
}) => {
  const errors = recordErrors(page);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/", { waitUntil: "networkidle" });
    const main = page.getByRole("main");
    await expect(
      main.getByRole("link", { name: "직접 작업하기", exact: true }).first(),
    ).toHaveAttribute("href", "/workspace");
    await expect(
      main
        .getByRole("link", { name: "전문가에게 의뢰하기", exact: true })
        .first(),
    ).toHaveAttribute("href", "/inquiry");
    const navigation = page.getByRole("navigation", { name: "주요 탐색" });
    const openMenu = navigation.getByRole("button", { name: "메뉴 열기" });
    if (await openMenu.isVisible()) {
      await openMenu.click();
      const drawer = page.getByRole("dialog");
      await expect(
        drawer.getByRole("link", { name: "직접 작업하기", exact: true }),
      ).toHaveCount(1);
      await expect(
        drawer.getByRole("link", { name: "전문가에게 의뢰하기", exact: true }),
      ).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(openMenu).toBeFocused();
    } else {
      await expect(
        navigation.getByRole("link", { name: "직접 작업하기", exact: true }),
      ).toHaveCount(1);
      await expect(
        navigation.getByRole("link", {
          name: "전문가에게 의뢰하기",
          exact: true,
        }),
      ).toHaveCount(1);
    }
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("responsive dashboard navigation keeps account reachable without duplicate menus", async ({
  page,
}) => {
  const errors = recordErrors(page);
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace-preview", { waitUntil: "networkidle" });
    const menu = page.getByRole("button", { name: "작업공간 메뉴 열기" });
    const mobile = await menu.isVisible();
    if (mobile) await menu.click();
    const navigation = mobile
      ? page.getByRole("dialog", { name: "작업공간 메뉴", exact: true })
      : page.getByRole("complementary", { name: "작업공간 탐색" });
    await expect(
      page.getByRole("combobox", { name: "작업 공간 선택" }),
    ).toBeVisible();
    await expect(
      navigation.getByText("최근 프로젝트", { exact: true }),
    ).toBeVisible();
    const logout = page.getByRole("link", { name: "미리보기", exact: true });
    await expect(logout).toHaveCount(1);
    await logout.scrollIntoViewIfNeeded();
    await expect(logout).toBeVisible();
    const close = page.getByRole("button", { name: "작업공간 메뉴 닫기" });
    if (await close.isVisible()) {
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});

test("task switching keeps authored geometry, selection, history and a local form draft", async ({
  page,
}) => {
  const errors = recordErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/workspace-preview/drawing-workspace?verticalTest=1", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  const modes = page.getByRole("radiogroup", {
    name: "작업 모드",
    exact: true,
  });
  await expect(modes).toBeVisible();
  const output = page.getByLabel("P4 mounted workspace snapshot");
  const readSnapshot = async () =>
    JSON.parse((await output.textContent()) || "null");
  await expect.poll(async () => Boolean(await readSnapshot())).toBe(true);
  const initial = await readSnapshot();
  const surface = page.getByLabel(/도면 화면/);
  await page.getByRole("button", { name: "선 도구", exact: true }).click();
  const drawingBounds = await surface.boundingBox();
  if (!drawingBounds) throw new Error("Drawing surface has no layout box");
  for (const fraction of [0.35, 0.65]) {
    await surface.click({
      position: {
        x: drawingBounds.width * fraction,
        y: drawingBounds.height * 0.3,
      },
    });
  }
  await expect
    .poll(async () => Object.keys((await readSnapshot()).objects).length)
    .toBe(Object.keys(initial.objects).length + 1);
  await page
    .getByRole("button", { name: "P4 로컬 저장 동기화", exact: true })
    .click();
  await expect(page.getByLabel("P4 mounted command result")).toHaveText(
    "로컬 저장 동기화됨",
  );
  const saveState = page.getByRole("status", { name: /^저장 상태:/ });
  await expect(saveState).toHaveAttribute("aria-label", "저장 상태: 저장됨");
  const before = await readSnapshot();
  const canvasHandle = await surface.elementHandle();
  await page.getByText("페이지 만들기", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "새 페이지 이름" })
    .fill("전환 후에도 남을 초안");

  for (const label of ["검토", "수량·금액", "작성"]) {
    await modes.getByRole("radio", { name: label, exact: true }).click();
    await expect(
      modes.getByRole("radio", { name: label, exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("button", { name: "내보내기", exact: true }),
    ).toBeVisible();
    await expect(saveState).toBeVisible();
    await expect(saveState).toHaveAttribute("aria-label", "저장 상태: 저장됨");
    await expect.poll(async () => await readSnapshot()).toEqual(before);
    expect(await canvasHandle!.evaluate((element) => element.isConnected)).toBe(
      true,
    );
  }
  await expect(
    page.getByRole("textbox", { name: "새 페이지 이름" }),
  ).toHaveValue("전환 후에도 남을 초안");
  expect(errors).toEqual([]);
});

test("direct drawing entry remains keyboard-accessible and read-only in compact preview", async ({
  page,
}, testInfo) => {
  const errors = recordErrors(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace-preview", { waitUntil: "networkidle" });
    const disclosure = page
      .locator("summary")
      .filter({ hasText: /^\s*새 도면\s*$/ });
    await expect(disclosure).toBeVisible();
    await disclosure.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.locator("details").filter({ has: disclosure }),
    ).toHaveAttribute("open", "");
    for (const name of [
      "빈 도면으로 시작",
      "템플릿에서 시작",
      "파일 가져오기",
    ]) {
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeDisabled();
    }
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    if (width === 1440 || width === 390)
      await page.screenshot({
        path: testInfo.outputPath(`quick-start-${width}.png`),
        fullPage: true,
      });
  }
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
