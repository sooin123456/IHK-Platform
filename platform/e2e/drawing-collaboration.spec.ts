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
    await ownerPage.getByLabel("담당자").selectOption(fixture.reviewer.id);
    await ownerPage.getByRole("button", { name: "이슈 만들기" }).click();
    await ownerPage.getByRole("button", { name: /창호 치수 확인 E2E/ }).click();
    await ownerPage
      .getByRole("button", { name: "선택한 도면 근거 연결" })
      .click();
    await expect(ownerPage.getByText("PDF 영역 근거")).toBeVisible();

    const reviewerPage = await authenticateContext(
      fixture,
      reviewerContext,
      fixture.reviewer,
      baseUrl,
      path,
    );
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
