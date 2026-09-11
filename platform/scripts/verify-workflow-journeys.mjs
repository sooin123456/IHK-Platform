import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  for (const [scenario, id, quantity] of [
    ["architecture", "A-101", 28],
    ["ifc", "W-201", 40],
    ["civil", "C-301", 66],
  ]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const button = (name) => page.getByRole("button", { name, exact: true });
    await page.goto(
      `http://127.0.0.1:4181/workspace-preview/flow?page=workspace&scenario=${scenario}`,
      { waitUntil: "networkidle" },
    );
    await button("산출 근거 확인").click();
    if (scenario === "architecture") {
      await button("축척 먼저 설정").click();
      await button("축척 설정 체험").click();
      await button("현재 화면으로 돌아가기").click();
      await button("산출 근거 확인").click();
    }
    await button("산출 결과 확인 체험").click();
    await button("현재 화면으로 돌아가기").click();
    await button("검토 요청").click();
    await page
      .getByLabel("검토 요청 내용", { exact: true })
      .fill(`${id} 최초 검토`);
    await button("검토 요청 체험").click();
    await button("검토자로 전환 · 데모").click();
    await page
      .getByLabel("검토 의견", { exact: true })
      .fill(`${id} 범위 수정 필요`);
    await button("수정 요청 체험").click();
    await button("작성자로 전환 · 데모").click();
    await button("현재 화면으로 돌아가기").click();
    await button("변경안 적용").click();
    await button("산출 근거 확인").click();
    await button("산출 결과 확인 체험").click();
    await button("현재 화면으로 돌아가기").click();
    await button("검토 요청").click();
    await page
      .getByLabel("검토 요청 내용", { exact: true })
      .fill(`${id} 수정 반영 재제출`);
    await button("검토 요청 체험").click();
    await button("검토자로 전환 · 데모").click();
    await button("검토 완료 체험").click();
    await button("승인자로 전환 · 데모").click();
    await expect(
      page.getByLabel("승인 대상 근거", { exact: true }),
    ).toContainText(`${quantity}`);
    await expect(button("승인 체험")).toBeDisabled();
    await page
      .getByRole("checkbox", {
        name: "도면 개정·수량·금액의 근거를 확인했습니다",
      })
      .check();
    await button("승인 체험").click();
    await button("현재 화면으로 돌아가기").click();
    await page.locator('[data-project-section="납품"]').click();
    await expect(
      page.getByLabel("승인된 납품 기준", { exact: true }),
    ).toContainText(`R2`);
    await expect(
      page.getByLabel("승인된 납품 기준", { exact: true }),
    ).toContainText(`${quantity}`);
    await page
      .getByRole("checkbox", { name: "PDF 출력 선택", exact: true })
      .uncheck();
    await page
      .getByRole("checkbox", { name: "XLSX 출력 선택", exact: true })
      .uncheck();
    await expect(button("패키지 준비 체험")).toBeDisabled();
    await page
      .getByRole("checkbox", { name: "DWG 출력 선택", exact: true })
      .check();
    await page
      .getByRole("checkbox", { name: "CSV 출력 선택", exact: true })
      .check();
    await page
      .getByLabel("인계 대상 메모", { exact: true })
      .fill("발주처 검토 담당");
    await expect(page.locator(".flow-body")).toContainText(
      "DWG 재저장 엔진 미연결",
    );
    await button("패키지 준비 체험").click();
    await button("인계 목록 미리보기").click();
    await expect(
      page.getByLabel("인계 목록 미리보기", { exact: true }),
    ).toContainText("발주처 검토 담당");
    await expect(
      page.getByLabel("인계 목록 미리보기", { exact: true }),
    ).toContainText("변환 엔진 미연결");
    await expect(page.locator(".flow-body")).toContainText(
      "실제 파일 생성·전송은 수행하지 않았습니다",
    );
    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.getByRole("checkbox", { name: "DWG 출력 선택", exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "CSV 출력 선택", exact: true }),
    ).toBeChecked();
    await expect(
      page.getByLabel("인계 대상 메모", { exact: true }),
    ).toHaveValue("발주처 검토 담당");
    await expect(page.locator(".flow-body")).toContainText(
      "패키지 구성 확인 완료",
    );
    await page.locator('[data-project-section="검토"]').click();
    await page
      .getByRole("navigation", { name: "검토 세부 화면" })
      .getByRole("button", { name: "검토·승인함", exact: true })
      .click();
    await button("승인 상태 확인").click();
    await button("작성자로 전환 · 데모").click();
    await button("승인본 유지하고 새 개정").click();
    await button("현재 화면으로 돌아가기").click();
    await page.locator('[data-project-section="납품"]').click();
    await expect(
      page.getByLabel("승인된 납품 기준", { exact: true }),
    ).toContainText("R2");
    await expect(button("패키지 준비 체험")).toBeDisabled();
    await page.locator('[data-project-section="도면/모델"]').click();
    await page
      .getByRole("navigation", { name: "도면/모델 세부 화면" })
      .getByRole("button", { name: "작업실", exact: true })
      .click();
    await button("속성·레이어").click();
    await page.getByLabel("객체 이름", { exact: true }).fill("후속 수정안");
    await button("객체 속성 적용").click();
    await button("현재 화면으로 돌아가기").click();
    await page.locator('[data-project-section="납품"]').click();
    await expect(
      page.getByLabel("승인된 납품 기준", { exact: true }),
    ).not.toContainText("후속 수정안");
    await expect(
      page.getByLabel("승인된 납품 기준", { exact: true }),
    ).toContainText(id);
    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.getByLabel("승인된 납품 기준", { exact: true }),
    ).toContainText("R2");
    await expect(
      page.getByLabel("승인된 납품 기준", { exact: true }),
    ).not.toContainText("후속 수정안");
    if (scenario === "architecture")
      await page.screenshot({
        path: "/tmp/1hk-approved-delivery.png",
        fullPage: true,
      });
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      `PASS ${scenario}: correction/resubmit/approval/delivery/new revision, fixed snapshot preserved`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
