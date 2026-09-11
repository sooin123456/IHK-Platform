import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
const pdf = await PDFDocument.create();
pdf.addPage([800, 520]);
const buffer = Buffer.from(await pdf.save());
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:4181/workspace-preview/flow?page=start", {
    waitUntil: "networkidle",
  });
  await page.getByLabel("빈 작업 이름", { exact: true }).fill("수량 연결 도면");
  await page
    .getByRole("button", { name: "빈 작업실 열기", exact: true })
    .click();
  await page.locator("input[type=file]").setInputFiles({
    name: "quantity-plan.pdf",
    mimeType: "application/pdf",
    buffer,
  });
  const draw = page.getByRole("button", {
    name: "사각형 구상 도구",
    exact: true,
  });
  await expect(draw).toBeEnabled();
  await draw.click();
  const canvas = page.getByRole("img", { name: "빈 작업 캔버스" });
  await canvas.focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("수동 원수량", { exact: true }).fill("24");
  await page.getByLabel("수량 보정", { exact: true }).fill("2");
  await page.getByLabel("수량 단위", { exact: true }).selectOption("m²");
  await page
    .getByRole("button", { name: "단가표에서 선택", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "배수관 예시 선택", exact: true }),
  ).toBeDisabled();
  await page.getByRole("region",{name:"화면 체험 단가표"}).screenshot({path:"/tmp/1hk-local-rate-picker.png"});
  await page.getByLabel("연결할 단가 검색", { exact: true }).fill("없는 공종");
  await expect(
    page.getByRole("region", { name: "화면 체험 단가표" }),
  ).toContainText("검색 결과가 없습니다");
  await page.getByLabel("연결할 단가 검색", { exact: true }).fill("FIN-01");
  await page
    .getByRole("button", { name: "바닥 마감 예시 선택", exact: true })
    .click();
  await expect(page.getByLabel("단가 원", { exact: true })).toHaveValue(
    "42000",
  );
  await page.getByLabel("수량 단위",{exact:true}).selectOption("m");
  await expect(page.getByLabel("단가 원",{exact:true})).toHaveValue("");
  await page.getByLabel("수량 단위",{exact:true}).selectOption("m²");
  await page.getByLabel("단가 원", { exact: true }).fill("43000");
  await expect(
    page.getByRole("region", { name: "객체 수량 근거" }),
  ).toContainText("직접 입력 단가");
  await page
    .getByRole("button", { name: "단가표에서 선택", exact: true })
    .click();
  await page
    .getByRole("button", { name: "바닥 마감 예시 선택", exact: true })
    .click();
  await page
    .getByLabel("수량 입력 근거", { exact: true })
    .fill("바닥 면적표 24 + 보정 2");
  await page
    .getByRole("button", { name: "수량 근거 연결", exact: true })
    .click();
  await draw.click();
  await canvas.focus();
  await page.keyboard.press("Enter");
  await page
    .getByLabel("구상 객체 이름", { exact: true })
    .fill("문 수량 미연결");
  await page
    .getByRole("button", { name: "내 수량·내역 보기", exact: true })
    .click();
  const section = page.getByRole("region", { name: "내 도면 수량·내역" });
  await expect(section).toContainText("1,092,000");
  await expect(section).toContainText("quantity-plan.pdf");
  await expect(section).toContainText("DEMO-RATES-01 · FIN-01");
  await expect(section.locator("article")).toHaveCount(2);
  const search = section.getByLabel("수량 항목 검색", { exact: true });
  const filter = section.getByLabel("수량 연결 상태", { exact: true });
  await search.fill("없는 항목");
  await expect(section.locator("article")).toHaveCount(0);
  await expect(section).toContainText("조건에 맞는 항목이 없습니다");
  await expect(section).toContainText("전체 미확정 합계 1,092,000원");
  await search.fill("QUANTITY-PLAN");
  await expect(section.locator("article")).toHaveCount(2);
  await filter.selectOption("missing");
  await expect(section.locator("article")).toHaveCount(1);
  await section
    .getByRole("button", { name: "도면 근거 열기", exact: true })
    .click();
  await expect(page.getByLabel("구상 객체 이름", { exact: true })).toHaveValue(
    "문 수량 미연결",
  );
  await page
    .getByRole("button", { name: "내 수량·내역 보기", exact: true })
    .click();
  await filter.selectOption("stale");
  await expect(section.locator("article")).toHaveCount(0);
  await section
    .getByRole("button", { name: "검색·필터 초기화", exact: true })
    .click();
  await expect(section.locator("article")).toHaveCount(2);
  await page.reload();
  await expect(section).toContainText("1,092,000");
  await expect(section).toContainText("DEMO-RATES-01 · FIN-01");
  await section
    .locator("article")
    .filter({
      has: page.getByRole("heading", { name: "구상 영역", exact: true }),
    })
    .getByRole("button", { name: "도면 근거 열기", exact: true })
    .click();
  await expect(page.getByLabel("구상 객체 이름", { exact: true })).toHaveValue(
    "구상 영역",
  );
  await page.locator("input[type=file]").setInputFiles({
    name: "quantity-plan.pdf",
    mimeType: "application/pdf",
    buffer,
  });
  await expect(page.getByLabel("구상 X 위치", { exact: true })).toBeEnabled();
  await page.getByLabel("구상 X 위치", { exact: true }).fill("400");
  await page
    .getByRole("button", { name: "내 수량·내역 보기", exact: true })
    .click();
  await expect(section).toContainText("근거 변경 · 재확인 필요");
  await expect(section).toContainText("집계 대상 없음");
  await filter.selectOption("stale");
  await expect(section.locator("article")).toHaveCount(1);
  await expect(section.locator("article")).toContainText("구상 영역");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/1hk-local-quantity-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS local PDF quantity/rate link, source return, reload, stale exclusion and mobile",
  );
} finally {
  await browser.close();
}
