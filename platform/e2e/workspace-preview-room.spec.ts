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
  await page.getByLabel("우선순위", { exact: true }).selectOption("urgent");
  await page
    .getByLabel("담당자", { exact: true })
    .selectOption("preview-user-site");
  await page.getByLabel("기한", { exact: true }).fill("2026-09-01");
  await page.getByRole("button", { name: "이슈 만들기" }).click();
  await page.getByRole("button", { name: "외벽 W-01 연결" }).click();

  await page.getByLabel("댓글").fill("현장 검토 의견입니다.");
  await page.getByRole("button", { name: "추가" }).click();
  await page.getByLabel("처리 상태").selectOption("closed");

  await expect(page.getByText("검토 완료")).toBeVisible();
  await expect(page.getByText("현장 검토 의견입니다.")).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: /^외벽 W-01$/ }),
  ).toBeVisible();
  await expect(page.getByLabel("현재 우선순위")).toHaveValue("urgent");
  await expect(page.getByLabel("현재 담당자")).toHaveValue("preview-user-site");
  await expect(page.getByLabel("현재 기한")).toHaveValue("2026-09-01");
  await expect(page.getByText("2026. 9. 1.")).toBeVisible();
  await expect(page.getByText("이슈 생성").first()).toBeVisible();

  await page.getByRole("button", { name: /알림 2건/ }).click();
  await page.getByRole("button", { name: "모두 읽음 처리" }).click();
  await expect(page.getByRole("button", { name: /알림 0건/ })).toBeVisible();

  await page.getByRole("button", { name: /창호 치수 확인/ }).click();
  await page.getByRole("button", { name: "창호 W-01 선택" }).click();
  await page.getByRole("button", { name: "창호 W-01 연결" }).click();
  await expect(page.getByText(/새 근거 연결 완료: 창호 W-01/)).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /외벽 상세 확인/ }).click();
  await expect(page.getByText("검토 완료")).toBeVisible();
  await expect(page.getByText("현장 검토 의견입니다.")).toBeVisible();
});
