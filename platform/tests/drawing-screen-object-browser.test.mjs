import assert from "node:assert/strict";
import test from "node:test";
import {chromium,expect} from "@playwright/test";

test("a drawn rectangle keeps its identity through correction, new revision and approval",{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(["localhost","127.0.0.1"].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000111&returnProject=00000000-0000-4000-8000-000000000101`);
  await page.getByRole("button",{name:"사각형 도구 화면",exact:true}).click();
  await page.getByRole("region",{name:"화면 도형 오버레이",exact:true}).click({position:{x:120,y:100}});
  await page.getByRole("textbox",{name:"이름",exact:true}).fill("회의실 검토 영역");
  const setCode=async code=>{
   const details=page.getByRole('region',{name:'선택 도형 사용자 속성',exact:true}).locator('details');
   if(!await details.evaluate(element=>element.open))await details.locator('summary').click();
   await page.getByRole('button',{name:'사용자 속성 편집',exact:true}).click();
   const menu=page.getByRole('dialog',{name:'작업실 메뉴',exact:true});
   await menu.getByLabel('회사 항목 코드',{exact:true}).fill(code);
   await menu.getByRole('button',{name:'선택 도형에 속성 적용',exact:true}).click();
   await menu.getByRole('button',{name:'도면으로 돌아가기',exact:true}).click();
  };
  await setCode('OLD-01');
  await page.getByText('기존 단일 도형 개정 검토',{exact:true}).click();
  await page.getByRole("button",{name:"선택 도형 검토 대상으로 지정",exact:true}).click();
  const panel=page.getByRole("region",{name:"도면 검토 패널",exact:true});
  await expect(panel.getByRole("heading",{name:"회의실 검토 영역 · 1쪽",exact:true})).toBeVisible();
  await expect(panel.getByText("D01 · 문 위치 변경 예시",{exact:true})).toHaveCount(0);
  await panel.getByRole("textbox",{name:"요청 내용",exact:true}).fill("영역 이름 확인");
  await panel.getByRole("button",{name:"검토 요청",exact:true}).click();
  await panel.getByRole("button",{name:"검토자 보기",exact:true}).click();
  await panel.getByRole("textbox",{name:/위치에 수정 의견/}).fill("영역 이름을 회의실 A로 바꿔 주세요");
  await panel.getByRole("button",{name:"수정 요청",exact:true}).click();
  await panel.getByRole("button",{name:"작성자 보기",exact:true}).click();
  await panel.getByRole("button",{name:"의견 위치로 이동",exact:true}).click();
  await panel.getByRole("button",{name:"수정할 새 개정 시작",exact:true}).click();
  await expect(page.getByRole("button",{name:"작성 모드",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(panel.getByRole("button",{name:"재검토 요청",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"회의실 검토 영역 · 화면 도형",exact:true}).click();
  await page.getByRole("textbox",{name:"이름",exact:true}).fill("회의실 A");
  await page.getByRole('button',{name:'도형 실행 취소',exact:true}).click({timeout:5000});
  await expect(page.getByRole('textbox',{name:'이름',exact:true})).toHaveValue('회의실 검토 영역');
  await page.getByRole('button',{name:'도형 다시 실행',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'이름',exact:true})).toHaveValue('회의실 A');
  await setCode('STR-01');
  await page.getByRole("button",{name:"검토 화면 열기",exact:true}).click();
  await panel.getByRole("textbox",{name:"요청 내용",exact:true}).fill("이름 수정 반영");
  await panel.getByRole("button",{name:"재검토 요청",exact:true}).click();
  await panel.getByRole("button",{name:"검토자 보기",exact:true}).click();
  await panel.getByRole("button",{name:"변경 전후 확인",exact:true}).click();
  await expect(panel.getByText("회의실 검토 영역 → 회의실 A",{exact:true})).toBeVisible();
  await expect(panel.getByText('OLD-01 → STR-01',{exact:true})).toBeVisible();
  if(process.env.PROPERTY_COMPARISON_SCREENSHOT)await page.screenshot({path:process.env.PROPERTY_COMPARISON_SCREENSHOT,animations:'disabled'});
  await panel.getByRole("button",{name:"검토 완료 · 승인 요청",exact:true}).click();
  await panel.getByRole("button",{name:"승인자 보기",exact:true}).click();
  await panel.getByRole("button",{name:"변경 전후 확인",exact:true}).click();
  await panel.getByRole("button",{name:"최종 승인하기",exact:true}).click();
  if(process.env.OBJECT_REVIEW_SCREENSHOT)await page.screenshot({path:process.env.OBJECT_REVIEW_SCREENSHOT,fullPage:true,animations:"disabled"});
  await page.reload();
  await expect(page.getByRole("button",{name:"회의실 A · 화면 도형",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"회의실 A · 화면 도형",exact:true}).click();
  await page.getByRole("button",{name:"속성",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"이름",exact:true})).toBeDisabled();
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test("screen shape selection and inspector refer to the same overlay object",{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(["localhost","127.0.0.1"].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole("button",{name:"사각형 도구 화면",exact:true}).click();
  await page.getByRole("region",{name:"화면 도형 오버레이",exact:true}).click({position:{x:80,y:80}});
  await expect(page.getByRole("button",{name:"사각형 01 · 화면 도형",exact:true})).toBeVisible();
  await page.getByRole("textbox",{name:"이름",exact:true}).fill("검토 영역 화면 초안");
  const shape=page.getByRole("button",{name:"검토 영역 화면 초안 · 화면 도형",exact:true});
  await expect(shape).toBeVisible();
  await page.getByRole("button",{name:"원 도구 화면",exact:true}).click();
  await page.getByRole("region",{name:"화면 도형 오버레이",exact:true}).click({position:{x:250,y:100}});
  const round=page.getByRole("button",{name:"원 02 · 화면 도형",exact:true}).locator("circle,ellipse");
  const roundBounds=await round.boundingBox();assert.ok(roundBounds);
  assert.ok(Math.abs(roundBounds.width-roundBounds.height)<1,"circle must not become an ellipse in the drawing viewport");
  await page.setViewportSize({width:1100,height:850});
  await expect.poll(async()=>{const bounds=await round.boundingBox();return bounds?Math.abs(bounds.width-bounds.height):100;}).toBeLessThan(1);
  await page.setViewportSize({width:1280,height:720});
  await shape.click();
  await expect(page.getByRole("textbox",{name:"이름",exact:true})).toHaveValue("검토 영역 화면 초안");
  await page.getByLabel("선 색상",{exact:true}).fill("#ff0000");
  await expect(shape.locator("rect").first()).toHaveAttribute("stroke","#ff0000");
  const overlay=page.getByRole("region",{name:"화면 도형 오버레이",exact:true});
  for(const [kind,x,y] of [["선",.7,.65],["텍스트",.6,.2],["치수",.15,.7]]){
    await page.getByRole("button",{name:`${kind} 도구 화면`,exact:true}).click();
    const bounds=await overlay.boundingBox();assert.ok(bounds);
    await overlay.click({position:{x:bounds.width*x,y:bounds.height*y}});
  }
  await page.getByRole("button",{name:"텍스트 04 · 화면 도형",exact:true}).click();
  await page.getByRole("textbox",{name:"텍스트",exact:true}).fill("도면 위 검토 메모");
  await expect(overlay.locator("text").filter({hasText:"도면 위 검토 메모"})).toBeVisible();
  if(process.env.OBJECT_PREVIEW_SCREENSHOT)await page.screenshot({path:process.env.OBJECT_PREVIEW_SCREENSHOT,fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"검토 화면 열기",exact:true}).click();
  await page.getByRole("button",{name:"문 위치 변경 체험",exact:true}).click();
  await page.getByRole("textbox",{name:/요청 내용/}).fill("검토 중 화면 도형 변경 차단 확인");
  await page.getByRole("button",{name:"검토 요청",exact:true}).click();
  await shape.click();
  await page.getByRole("button",{name:"속성",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"이름",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"작성 모드",exact:true}).click();
  await expect(page.getByRole("button",{name:"사각형 도구 화면",exact:true})).toBeDisabled();
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
