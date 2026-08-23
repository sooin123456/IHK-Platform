import { expect, test } from "@playwright/test";

const roomPath =
  "/workspace-preview/projects/preview-community-center/drawings/preview-drawing";

test("local drawing room completes an issue review without login", async ({
  page,
}) => {
  await page.goto(roomPath);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await expect(
    page.getByRole("heading", { name: "건축 평면도 A-101.pdf" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "외벽 W-01 선택" }).click();

  await page.getByLabel("이슈 제목").fill("외벽 상세 확인");
  await page.getByLabel("설명").fill("도면과 모델의 외벽 위치를 비교합니다.");
  await page.getByRole("button", { name: "이슈 만들기" }).click();
  await page.getByRole("button", { name: "외벽 W-01 연결" }).click();

  await page.getByLabel("댓글").fill("현장 검토 의견입니다.");
  await page.getByRole("button", { name: "추가" }).click();
  await page.getByLabel("처리 상태").selectOption("closed");

  await expect(page.getByText("검토 완료")).toBeVisible();
  await expect(page.getByText("현장 검토 의견입니다.")).toBeVisible();
  await expect(page.getByText("외벽 W-01", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /외벽 상세 확인/ }).click();
  await expect(page.getByText("검토 완료")).toBeVisible();
  await expect(page.getByText("현장 검토 의견입니다.")).toBeVisible();
});
