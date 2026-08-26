import { expect, test, type Page } from "@playwright/test";

const previewPath = "/workspace-preview/drawing-workspace";
const realtimeTestPreviewPath = `${previewPath}?realtimeTest=1`;
const retryTestPreviewPath = `${previewPath}?collaborationRetryTest=1`;
const staleBootstrapPreviewPath = `${previewPath}?bootstrapReadOnlyTest=1`;
const awarenessTestPreviewPath = `${previewPath}?awarenessTest=1`;
const reviewFreezeTestPreviewPath = `${previewPath}?reviewFreezeTest=1`;
test.describe.configure({ timeout: 30_000 });

async function openPreview(page: Page, path = previewPath) {
  page.setDefaultTimeout(5_000);
  await page.goto(path, {
    timeout: 15_000,
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("tablist", { name: "도면 도구" })).toBeVisible();
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
}

async function waitForPreviewRealtimeEffect(page: Page) {
  await expect(
    page.getByRole("status", { name: "실시간 미리보기 준비됨" }),
  ).toBeVisible({ timeout: 15_000 });
}

test("local preview keeps its realtime indicator connected without a Supabase request", async ({
  page,
}) => {
  const supabaseRequests: string[] = [];
  const collaborationSockets: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).port === "54321")
      supabaseRequests.push(request.url());
  });
  page.on("websocket", (socket) => {
    const url = new URL(socket.url());
    if (
      url.pathname.includes("drawing:") ||
      url.hostname.includes("collaboration")
    )
      collaborationSockets.push(socket.url());
  });
  await openPreview(page, realtimeTestPreviewPath);
  await waitForPreviewRealtimeEffect(page);

  await expect(
    page.getByRole("status", { name: "실시간 상태: 실시간 연결됨" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "공동 편집 상태: connected" }),
  ).toHaveText("공동 편집 연결됨 · 1명");
  expect(supabaseRequests).toEqual([]);
  expect(collaborationSockets).toEqual([]);
});

test("two Awareness clients including the same verified user render object and block collaboration safely", async ({
  page,
}) => {
  const supabaseRequests: string[] = [];
  const collaborationSockets: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).port === "54321")
      supabaseRequests.push(request.url());
  });
  page.on("websocket", (socket) => {
    const url = new URL(socket.url());
    if (
      url.pathname.includes("drawing:") ||
      url.hostname.includes("collaboration")
    )
      collaborationSockets.push(socket.url());
  });

  await openPreview(page, awarenessTestPreviewPath);
  await expect(
    page.getByRole("status", { name: "공동 작업 참여자 3명" }),
  ).toBeVisible();
  const participants = page.getByRole("list", { name: "참여자 목록" });
  await expect(participants.getByText("김도윤", { exact: true })).toBeVisible();
  await expect(participants.getByText("나", { exact: true })).toHaveCount(2);
  await expect(page.getByLabel("김도윤 커서")).toBeVisible();
  await expect(page.getByLabel("나 커서")).toBeVisible();
  await expect(page.locator('[data-remote-selection="김도윤"]')).toBeVisible();
  await expect(page.getByLabel("나 커서")).toHaveAttribute(
    "data-remote-selection-ids",
    /00000000-0000-4000-8000-000000000080/,
  );
  const surface = page.getByLabel(/도면 화면/);
  await expect(surface).toHaveAttribute("data-remote-selection-count", "2");
  await expect(surface).toHaveAttribute(
    "data-remote-block-selection-count",
    "1",
  );
  await expect(
    page.getByRole("status", { name: "객체 잠금 상태" }),
  ).toContainText("김도윤님이 코어 편집 중");
  await expect(
    page.getByRole("status", { name: "객체 잠금 상태" }),
  ).toContainText("나님이 D-01 북측 편집 중");
  await expect(
    page.getByRole("status", { name: /공동 편집 상태/ }),
  ).toContainText("3명");

  const overflow = await page.evaluate(() => ({
    document:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
    inspector: (() => {
      const element = document.querySelector('[aria-label="속성 검사기"]');
      return element ? element.scrollWidth - element.clientWidth : 1;
    })(),
  }));
  expect(overflow.document).toBeLessThanOrEqual(0);
  expect(overflow.inspector).toBeLessThanOrEqual(0);

  await page.getByRole("tab", { name: "블록" }).click();
  await page
    .getByRole("button", { name: /단문 D-01 Instance 1개 보기/ })
    .click();
  const lockedInstance = page.getByRole("button", {
    name: "D-01 북측 instance 선택",
  });
  await lockedInstance.click();
  await expect(
    page.getByRole("status", { name: "선택 블록 잠금 상태" }),
  ).toContainText("나님이 편집 중");
  await page.keyboard.press("Delete");
  await expect(
    page.getByRole("status", { name: "공동 편집 작업 차단 안내" }),
  ).toContainText("D-01 북측");
  await expect(lockedInstance).toBeVisible();

  await page
    .getByRole("button", { name: /창호 W-01 Instance 2개 보기/ })
    .click();
  await page.getByRole("button", { name: "W-01 동측 instance 선택" }).click();
  await page.getByRole("textbox", { name: "이름", exact: true }).focus();
  await expect(page.getByLabel("로컬 advisory 잠금")).toHaveText(
    "00000000-0000-4000-8000-000000000082",
  );
  await page.getByRole("tab", { name: "페이지·레이어" }).click();
  await expect(page.getByLabel("로컬 advisory 잠금")).toHaveText("없음");
  expect(supabaseRequests).toEqual([]);
  expect(collaborationSockets).toEqual([]);
});

test("collaboration initialization retry cleans partial resources and restores editing", async ({
  page,
}) => {
  await openPreview(page, retryTestPreviewPath);
  await expect(page.getByLabel("협업 재시도 상태")).toHaveText("local-failed");
  await expect(page.getByText(/로컬 저장 실패/)).toBeVisible();
  await expect(page.getByLabel("협업 로컬 리소스 수")).toHaveText("0");
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByText(/로컬 저장 실패/)).toBeHidden();
  await expect(page.getByLabel("협업 로컬 리소스 수")).toHaveText("1");
  await expect(page.getByLabel("협업 로컬 동기화 횟수")).toHaveText("1");
  await expect(page.getByLabel("협업 provider 실패 횟수")).toHaveText("1");
  await expect(page.getByLabel("협업 재시도 상태")).toHaveText(
    "provider-failed",
  );
  await expect(page.getByLabel("협업 provider 수")).toHaveText("0");
  await expect(
    page.getByRole("textbox", { name: "새 레이어 이름" }),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByLabel("협업 provider 수")).toHaveText("1");
  await expect(page.getByLabel("협업 재시도 상태")).toHaveText("connected");
  await expect(
    page.getByRole("status", { name: "공동 편집 상태: connected" }),
  ).toBeVisible();
});

test("transactional read-only bootstrap blocks stale draft editing before initialization", async ({
  page,
}) => {
  await openPreview(page, staleBootstrapPreviewPath);
  await expect(
    page.getByRole("textbox", { name: "새 레이어 이름" }),
  ).toBeHidden();
  await expect(
    page.getByRole("status", { name: "공동 편집 상태: connected" }),
  ).toHaveText("공동 편집 연결됨 · 읽기 전용 · 1명");
});

test("review freeze immediately remounts read-only and a failed transition safely releases it", async ({
  page,
}) => {
  await openPreview(page, reviewFreezeTestPreviewPath);
  const review = page.getByRole("button", { name: "검토 요청" });
  const layerName = page.getByRole("textbox", { name: "새 레이어 이름" });
  await expect(review).toBeEnabled();
  await expect(layerName).toBeVisible();
  const frozenUi = await review.evaluate(async (button) => {
    const form = button.closest("form") as HTMLFormElement;
    form.requestSubmit = () => undefined;
    (button as HTMLButtonElement).click();
    const deadline = performance.now() + 250;
    do {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (
        (button as HTMLButtonElement).disabled &&
        !document.querySelector("#new-layer-name")
      )
        return true;
    } while (performance.now() < deadline);
    return false;
  });
  expect(frozenUi).toBe(true);
  const requestId = await page.evaluate(
    () =>
      Object.entries(sessionStorage).find(([key]) =>
        key.startsWith("drawing-review-freeze:"),
      )?.[1],
  );
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
  await page.reload();
  const retryReview = page.getByRole("button", { name: "검토 요청" });
  const retryLayerName = page.getByRole("textbox", {
    name: "새 레이어 이름",
  });
  await retryReview.click();
  await expect(page.getByText("로컬 동결 실패 복구 시험")).toBeVisible();
  await expect(retryReview).toBeEnabled();
  await expect(retryLayerName).toBeVisible();
  await expect(page.locator('input[name="freeze_request_id"]')).toHaveValue(
    requestId!,
  );
  await retryReview.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator('input[name="freeze_request_id"]')).toHaveValue(
    requestId!,
  );
  await expect(retryReview).toBeEnabled();
});

test("preview keeps a local edit through realtime revalidation and resets only when its lifecycle changes", async ({
  page,
}) => {
  await openPreview(page, realtimeTestPreviewPath);
  await waitForPreviewRealtimeEffect(page);

  const loaderNonce = page.getByLabel("미리보기 loader nonce");
  const initialNonce = await loaderNonce.textContent();
  const localLayerName = "Realtime local edit";
  await page
    .getByRole("textbox", { name: "새 레이어 이름" })
    .fill(localLayerName);
  await page.getByRole("button", { name: "레이어 추가" }).click();
  const localLayer = page.getByRole("textbox", {
    name: `레이어 이름: ${localLayerName}`,
  });
  await expect(localLayer).toBeVisible();

  await page.getByRole("button", { name: "실시간 갱신 시험" }).click();
  await expect(page.getByLabel("실시간 갱신 횟수")).toHaveText("1");
  await expect(loaderNonce).not.toHaveText(initialNonce ?? "");
  await expect(localLayer).toBeVisible();

  await page.getByRole("button", { name: "테스트 사용자 전환" }).click();
  await expect(localLayer).toBeHidden();

  await page.getByRole("button", { name: "테스트 보기 권한" }).click();
  await expect(
    page.getByText("읽기 전용 레이어 목록", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "공동 편집 상태: connected" }),
  ).toHaveText("공동 편집 연결됨 · 읽기 전용 · 1명");
  await expect(
    page.getByRole("textbox", { name: "새 레이어 이름" }),
  ).toBeHidden();
});

test("local preview click selects the Style tab and reveals its panel", async ({
  page,
}) => {
  await openPreview(page);

  const structureTab = page.getByRole("tab", { name: "페이지·레이어" });
  const stylesTab = page.getByRole("tab", { name: "스타일" });
  const structurePanel = page.locator("#drawing-panel-structure");
  const stylesPanel = page.locator("#drawing-panel-styles");

  await expect(structureTab).toHaveAttribute("aria-selected", "true");
  await expect(structurePanel).toBeVisible();
  await expect(stylesPanel).toBeHidden();

  await expect(async () => {
    await stylesTab.click();
    await expect(stylesTab).toHaveAttribute("aria-selected", "true", {
      timeout: 250,
    });
  }).toPass({ timeout: 10_000 });

  await expect(structureTab).toHaveAttribute("aria-selected", "false");
  await expect(stylesPanel).toBeVisible();
  await expect(structurePanel).toBeHidden();
});

test("local preview Arrow, Home, and End keys select and focus their target tabs", async ({
  page,
}) => {
  await openPreview(page);

  const structureTab = page.getByRole("tab", { name: "페이지·레이어" });
  const stylesTab = page.getByRole("tab", { name: "스타일" });
  const historyTab = page.getByRole("tab", { name: "변경 이력" });

  await expect(async () => {
    await structureTab.focus();
    await structureTab.press("ArrowRight");
    await expect(stylesTab).toHaveAttribute("aria-selected", "true", {
      timeout: 250,
    });
    await expect(stylesTab).toBeFocused({ timeout: 250 });
  }).toPass({ timeout: 10_000 });
  await expect(page.locator("#drawing-panel-styles")).toBeVisible();

  await stylesTab.press("End");
  await expect(historyTab).toHaveAttribute("aria-selected", "true");
  await expect(historyTab).toBeFocused();
  await expect(page.locator("#drawing-panel-history")).toBeVisible();

  await historyTab.press("Home");
  await expect(structureTab).toHaveAttribute("aria-selected", "true");
  await expect(structureTab).toBeFocused();
  await expect(page.locator("#drawing-panel-structure")).toBeVisible();
});

test("hydrated export dialog explains background availability and cancels one gated run", async ({
  page,
}) => {
  await openPreview(page);
  const dialog = page.getByRole("dialog", { name: "도면 내보내기" });
  await expect(async () => {
    await page.getByRole("button", { name: "내보내기" }).click();
    await expect(dialog).toBeVisible({ timeout: 250 });
  }).toPass({ timeout: 10_000 });

  await dialog.getByRole("radio", { name: "PNG" }).check();
  const includeBackground = dialog.getByRole("checkbox", {
    name: "PDF 배경 포함",
  });
  await expect(includeBackground).toBeDisabled();
  await expect(dialog).toContainText(
    "현재 canvas에는 포함할 PDF 배경이 없습니다.",
  );

  await dialog.getByRole("radio", { name: "PDF" }).check();
  const download = dialog.getByRole("button", { name: "다운로드" });
  await download.evaluate((button) => {
    (button as HTMLElement).click();
    (button as HTMLElement).click();
  });
  await expect(dialog.getByRole("button", { name: "취소" })).toBeVisible();
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "내보내기" }).click();
  await expect(
    page.getByRole("dialog", { name: "도면 내보내기" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();
});

test("1280px structure panel keeps disabled explanations readable below controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openPreview(page);

  const panel = page.locator("#drawing-panel-structure");
  const explanations = panel.locator(
    'p[id^="page-delete-reason-"], p[id^="canvas-delete-reason-"], p[id^="canvas-order-reason-"]',
  );
  await expect(explanations).not.toHaveCount(0);

  const layout = await panel.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);

  const rectangles = await explanations.evaluateAll((nodes) =>
    nodes.map((node) => {
      const explanation = node.getBoundingClientRect();
      const input = node.closest("div.rounded-md")?.querySelector("input");
      const controls = input?.getBoundingClientRect();
      return {
        explanation: {
          width: explanation.width,
          y: explanation.y,
        },
        controls: controls ? { height: controls.height, y: controls.y } : null,
      };
    }),
  );
  for (const rectangle of rectangles) {
    expect(rectangle.controls).not.toBeNull();
    expect(rectangle.explanation.width).toBeGreaterThanOrEqual(120);
    expect(rectangle.explanation.y).toBeGreaterThanOrEqual(
      rectangle.controls!.y + rectangle.controls!.height,
    );
  }
});

test("architectural object tools remain accessible without toolbar overflow on desktop and tablet", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await openPreview(page);
    const surface = page.getByLabel(/도면 화면/);
    const initialSemanticCount = Number(
      await surface.getAttribute("data-rendered-semantic-object-count"),
    );
    const semanticTrigger = page.getByRole("button", { name: "건축 객체" });
    await semanticTrigger.click();
    await page.getByRole("menuitem", { name: "벽 도구" }).click();
    await expect(semanticTrigger).toBeFocused();
    const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
    const viewportX = Number(await surface.getAttribute("data-viewport-x"));
    const viewportY = Number(await surface.getAttribute("data-viewport-y"));
    await surface.click({
      position: { x: viewportX + 100 * zoom, y: viewportY + 700 * zoom },
    });
    await surface.click({
      position: { x: viewportX + 900 * zoom, y: viewportY + 700 * zoom },
    });
    await expect(surface).toHaveAttribute(
      "data-rendered-semantic-object-count",
      String(initialSemanticCount + 1),
    );
    await expect(
      page.getByRole("list", { name: "건축 객체 목록" }),
    ).toContainText("Wall · wall");
    if (viewport.width === 1440) {
      await page.getByRole("button", { name: "선택 도구" }).click();
      await surface.click({
        position: { x: viewportX + 500 * zoom, y: viewportY + 700 * zoom },
      });
      await expect(
        page.getByRole("heading", { name: "건축 객체" }),
      ).toBeVisible();
      await expect(page.getByLabel("벽 두께")).toHaveValue("200");
      await expect(page.getByText("미리보기", { exact: true })).toBeVisible();
      await expect(
        page.getByText("서버 계산 · V1", { exact: true }),
      ).toBeVisible();
      await semanticTrigger.click();
      await page.getByRole("menuitem", { name: "영역 도구" }).click();
      const invalidBoundary = [
        { x: 100, y: 100 },
        { x: 300, y: 300 },
        { x: 100, y: 300 },
        { x: 300, y: 100 },
      ];
      for (const [index, point] of invalidBoundary.entries()) {
        await surface.click({
          position: {
            x: viewportX + point.x * zoom,
            y: viewportY + point.y * zoom,
          },
        });
        if (index < invalidBoundary.length - 1) await page.waitForTimeout(600);
      }
      await page.keyboard.press("Enter");
      await expect(page.getByRole("alert")).toContainText(/경계|다각형/);
      await page.keyboard.press("Escape");
    }
    await semanticTrigger.click();
    for (const name of [
      "벽 도구",
      "개구부 도구",
      "공간 도구",
      "영역 도구",
      "그리드 도구",
      "호 도구",
    ])
      await expect(page.getByRole("menuitem", { name })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "벽 도구" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("menuitem", { name: "개구부 도구" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "벽 도구" })).toBeHidden();
    await expect(semanticTrigger).toBeFocused();
    const overflow = await page.evaluate(() => {
      const toolbar = document.querySelector('[aria-label="캔버스 도구"]');
      return {
        document:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        toolbar: toolbar ? toolbar.scrollWidth - toolbar.clientWidth : 1,
      };
    });
    expect(overflow.document).toBeLessThanOrEqual(0);
    expect(overflow.toolbar).toBeLessThanOrEqual(0);
  }
});
