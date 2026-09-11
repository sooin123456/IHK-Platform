import assert from "node:assert/strict";
import test from "node:test";
import {chromium,expect} from "@playwright/test";
import {PDFDocument} from "pdf-lib";

test("project resources preserve drafts and selection without granting Viewer edits",{skip:!process.env.RESOURCES_PREVIEW_ORIGIN,timeout:60000},async()=>{
  const origin=new URL(process.env.RESOURCES_PREVIEW_ORIGIN);
  assert.ok(["localhost","127.0.0.1"].includes(origin.hostname));
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage();
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    const url=`${origin.origin}/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-resources`;
    await page.goto(url);
    await expect(page.getByRole("textbox",{name:"자료 이름",exact:true})).toBeEnabled();
    await page.getByRole("textbox",{name:"자료 이름",exact:true}).fill("출입구 변경 견적서.pdf");
    await page.getByRole("textbox",{name:"자료 설명",exact:true}).fill("문 교체 수량 확인 필요");
    await page.getByRole("combobox",{name:"자료 분류",exact:true}).selectOption("quote");
    await page.reload();
    await expect(page.getByRole("textbox",{name:"자료 이름",exact:true})).toHaveValue("출입구 변경 견적서.pdf");
    await expect(page.getByRole("textbox",{name:"자료 설명",exact:true})).toHaveValue("문 교체 수량 확인 필요");
    await page.getByRole("button",{name:"자료 목록에 보관 · 이 탭",exact:true}).click();
    await expect(page.getByRole("article",{name:"자료 상세",exact:true})).toContainText("문 교체 수량 확인 필요");
    await page.reload();
    await expect(page.getByRole("article",{name:"자료 상세",exact:true})).toContainText("출입구 변경 견적서.pdf");
    await expect(page.getByRole("textbox",{name:"자료 이름",exact:true})).toHaveValue("");
    await page.getByRole("textbox",{name:"자료 검색",exact:true}).fill("없는 자료");
    await expect(page.getByText("검색 결과가 없습니다.",{exact:true})).toBeVisible();
    await page.goto(`${url}&role=viewer`);
    await expect(page.getByRole("article",{name:"자료 상세",exact:true})).toContainText("문 교체 수량 확인 필요");
    await expect(page.getByRole("textbox",{name:"자료 이름",exact:true})).toHaveCount(0);
    await expect(page.getByRole("button",{name:"자료 목록에 보관 · 이 탭",exact:true})).toHaveCount(0);
    const pdf=await PDFDocument.create();pdf.addPage([600,400]);pdf.addPage([600,400]);
    await page.getByLabel("열람할 로컬 PDF 선택",{exact:true}).setInputFiles({name:"reference.pdf",mimeType:"application/pdf",buffer:Buffer.from(await pdf.save())});
    await expect(page.getByRole("button",{name:"자료 다음 페이지",exact:true})).toBeEnabled();
    await expect(page.locator('[aria-label="자료 PDF 읽기 전용 열람"] canvas')).toBeVisible();
    await page.getByRole("button",{name:"자료 다음 페이지",exact:true}).click();
    await expect(page.getByRole("button",{name:"자료 다음 페이지",exact:true})).toBeDisabled();
    await expect(page.getByRole("button",{name:"자료 이전 페이지",exact:true})).toBeEnabled();
    await page.reload();
    await expect(page.getByRole("article",{name:"자료 상세",exact:true})).toContainText("문 교체 수량 확인 필요");
    await expect(page.getByLabel("열람할 로컬 PDF 선택",{exact:true})).toBeVisible();
    await expect(page.locator('[aria-label="자료 PDF 읽기 전용 열람"] canvas')).toHaveCount(0);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
