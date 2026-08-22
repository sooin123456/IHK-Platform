import { expect, test } from "@playwright/test";

import {
  authenticateContext,
  createDrawingFixture,
  destroyDrawingFixture,
  type DrawingFixture,
} from "./utils/drawing-collaboration-fixture";

test.describe.serial("1HK drawing collaboration", () => {
  let fixture: DrawingFixture;
  const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4000";

  test.beforeAll(async () => {
    fixture = await createDrawingFixture();
  });

  test.afterAll(async () => {
    await destroyDrawingFixture(fixture);
  });

  test("maker creates a PDF issue and reviewer closes it in realtime", async ({
    browser,
  }) => {
    const path = `/projects/${fixture.projectId}/drawings/${fixture.pdfFileId}`;
    const ownerContext = await browser.newContext();
    const reviewerContext = await browser.newContext();
    const ownerPage = await authenticateContext(
      fixture,
      ownerContext,
      fixture.owner,
      baseUrl,
      path,
    );

    await expect(ownerPage.getByTestId("pdf-canvas")).toBeVisible();
    await ownerPage.getByRole("button", { name: "영역 지정" }).click();
    const canvas = ownerPage.getByTestId("pdf-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("PDF canvas has no layout box");
    await ownerPage.mouse.move(
      box.x + box.width * 0.2,
      box.y + box.height * 0.2,
    );
    await ownerPage.mouse.down();
    await ownerPage.mouse.move(
      box.x + box.width * 0.55,
      box.y + box.height * 0.45,
    );
    await ownerPage.mouse.up();
    await expect(ownerPage.getByText("1쪽 영역을 선택했습니다.")).toBeVisible();

    await ownerPage.getByLabel("이슈 제목").fill("창호 치수 확인 E2E");
    await ownerPage.getByLabel("기한").first().fill("2099-12-31");
    await ownerPage.getByLabel("담당자").selectOption(fixture.reviewer.id);
    await ownerPage.getByRole("button", { name: "이슈 만들기" }).click();
    await ownerPage.getByRole("button", { name: /창호 치수 확인 E2E/ }).click();
    await ownerPage
      .getByRole("button", { name: "선택한 도면 근거 연결" })
      .click();
    await expect(ownerPage.getByText("PDF 영역 근거")).toBeVisible();
    await expect(ownerPage.locator('input[id^="due-"]')).toHaveValue(
      "2099-12-31",
    );
    await ownerPage.goto(
      `${baseUrl}/projects/${fixture.projectId}/drawings/${fixture.revisedPdfFileId}`,
    );
    await expect(ownerPage.getByText("개정 도면 재검토 1건")).toBeVisible();
    await expect(
      ownerPage.getByText(
        "PDF 좌표는 자동 복사하지 않습니다. 새 도면에서 영역을 다시 선택하세요.",
      ),
    ).toBeVisible();

    const reviewerPage = await authenticateContext(
      fixture,
      reviewerContext,
      fixture.reviewer,
      baseUrl,
      path,
    );
    await reviewerPage.goto(`${baseUrl}/notifications`);
    await expect(reviewerPage.getByText("창호 치수 확인 E2E")).toBeVisible();
    await expect(reviewerPage.getByText(/안 읽음 [1-9]/)).toBeVisible();
    const unreadButtons = reviewerPage.getByRole("button", {
      name: "읽음 처리",
    });
    for (
      let remaining = await unreadButtons.count();
      remaining > 0;
      remaining--
    ) {
      await unreadButtons.first().click();
      await expect(unreadButtons).toHaveCount(remaining - 1);
    }
    await expect(reviewerPage.getByText("안 읽음 0")).toBeVisible();
    await reviewerPage.goto(`${baseUrl}${path}`);
    await reviewerPage
      .getByRole("button", { name: /창호 치수 확인 E2E/ })
      .click();
    await reviewerPage.getByLabel("댓글").fill("검토 완료: 치수 근거 확인");
    await reviewerPage.getByRole("button", { name: "등록" }).click();
    await reviewerPage.getByLabel("상태").selectOption("closed");
    await reviewerPage.getByRole("button", { name: /저장/ }).first().click();
    await expect(reviewerPage.getByText("완료", { exact: true })).toBeVisible();
    await expect(ownerPage.getByText("완료", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      ownerPage.getByText("검토 완료: 치수 근거 확인"),
    ).toBeVisible();
    await expect(
      ownerPage.getByRole("region", { name: "변경 기록" }),
    ).toContainText("상태 변경");

    await ownerContext.close();
    await reviewerContext.close();
  });

  test("maker binds a real IFC element and camera to an issue", async ({
    browser,
  }) => {
    const path = `/projects/${fixture.projectId}/drawings/${fixture.ifcFileId}`;
    const context = await browser.newContext();
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      path,
    );

    const useElement = page.getByRole("button", {
      name: "이 요소를 이슈 근거로 사용",
    });
    await expect(useElement).toBeEnabled({ timeout: 30_000 });
    await useElement.click();
    await page.getByLabel("이슈 제목").fill("IFC 객체 근거 E2E");
    await page.getByRole("button", { name: "이슈 만들기" }).click();
    await page.getByRole("button", { name: /IFC 객체 근거 E2E/ }).click();
    await page.getByRole("button", { name: "선택한 도면 근거 연결" }).click();
    await expect(page.getByText("IFC 객체 근거")).toBeVisible();
    await page.goto(
      `${baseUrl}/projects/${fixture.projectId}/drawings/${fixture.revisedIfcFileId}`,
    );
    await expect(page.getByText("개정 도면 재검토 1건")).toBeVisible();
    await expect(
      page.getByText(
        "같은 IFC 객체가 확인되지 않았습니다. 새 도면에서 객체를 다시 선택하세요.",
      ),
    ).toBeVisible();

    await context.close();
  });

  test("viewer is read-only and non-member cannot enter", async ({
    browser,
  }) => {
    const path = `/projects/${fixture.projectId}/drawings/${fixture.pdfFileId}`;
    const viewerContext = await browser.newContext();
    const viewerPage = await authenticateContext(
      fixture,
      viewerContext,
      fixture.viewer,
      baseUrl,
      path,
    );
    await expect(
      viewerPage.getByText("조회 권한으로 참여 중입니다."),
    ).toBeVisible();
    await expect(viewerPage.getByLabel("이슈 제목")).toHaveCount(0);

    const outsiderContext = await browser.newContext();
    const outsiderPage = await authenticateContext(
      fixture,
      outsiderContext,
      fixture.nonMember,
      baseUrl,
      "/workspace",
    );
    const response = await outsiderPage.goto(`${baseUrl}${path}`);
    expect(response?.status()).toBe(404);
    await viewerContext.close();
    await outsiderContext.close();
  });

  test("390px mobile keeps drawing and issue work reachable", async ({
    browser,
  }) => {
    const path = `/projects/${fixture.projectId}/drawings/${fixture.pdfFileId}`;
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      path,
    );
    await expect(page.getByRole("button", { name: "도면" })).toBeVisible();
    await page.getByRole("button", { name: /이슈/ }).click();
    await expect(page.getByRole("region", { name: "도면 이슈" })).toBeVisible();
    await page.getByRole("button", { name: "도면" }).click();
    await expect(page.getByTestId("pdf-canvas")).toBeVisible();
    await context.close();
  });
});
