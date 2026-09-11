import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
test('quantity object opens its existing review request without treating quantity as approved',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000156`);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:140,y:100}});
  await page.getByRole('button',{name:'선택 도형으로 검토 요청',exact:true}).click();
  await page.getByLabel('요청 메시지',{exact:true}).fill('바닥 도형 검토 연결');
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  const key='1hk:preview:change-requests:00000000-0000-4000-8000-000000000156';
  const saved=await page.evaluate(key=>sessionStorage.getItem(key),key);
  await openTakeoff(page);
  const evidence=page.getByRole('region',{name:'물량 도형의 검토 기록',exact:true});
  await expect(evidence).toBeVisible({timeout:3000});
  await expect(evidence).toContainText('확인 대기');
  await expect(evidence).toContainText('수량·금액 승인이 아닙니다');
  await page.getByLabel('물량 항목 이름',{exact:true}).fill('왕복할 물량 항목');
  if(process.env.TAKEOFF_REVIEW_SCREENSHOT)await page.screenshot({path:process.env.TAKEOFF_REVIEW_SCREENSHOT,animations:'disabled'});
  await evidence.getByRole('button',{name:'도형 검토 요청 1 열기',exact:true}).click();
  await expect(page.getByRole('region',{name:'물량·내역 작업 패널',exact:true})).toBeHidden();
  await expect(page.getByRole('region',{name:'요청 묶음 검토',exact:true})).toContainText('바닥 도형 검토 연결');
  expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe(saved);
  await page.getByRole('button',{name:'물량 항목으로 돌아가기',exact:true}).click({timeout:3000});
  await expect(page.getByLabel('물량 항목 이름',{exact:true})).toHaveValue('왕복할 물량 항목');
  await expect(page.getByRole('button',{name:'물량 항목으로 돌아가기',exact:true})).toHaveCount(0);
  await page.goto(`${page.url()}&role=viewer`);await page.locator('[data-screen-shape]').click();await openTakeoff(page);
  await expect(evidence).toContainText('확인 대기');
  await evidence.getByRole('button',{name:'도형 검토 요청 1 열기',exact:true}).click();
  await expect(page.getByRole('region',{name:'요청 묶음 검토',exact:true})).toContainText('바닥 도형 검토 연결');
  expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe(saved);
  await page.setViewportSize({width:390,height:844});
  if(process.env.TAKEOFF_RETURN_SCREENSHOT){await page.getByRole('button',{name:'물량 항목으로 돌아가기',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:process.env.TAKEOFF_RETURN_SCREENSHOT,animations:'disabled'});}
  await page.getByRole('button',{name:'물량 항목으로 돌아가기',exact:true}).click();
  await expect(page.getByLabel('물량 항목 이름',{exact:true})).toHaveValue('왕복할 물량 항목');
  await expect(page.getByLabel('물량 항목 이름',{exact:true})).toBeDisabled();
 }finally{await browser.close();}
});
test('quantity evidence returns across PDF pages and reveals a hidden layer without unlocking it',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const pdf=await PDFDocument.create();pdf.addPage([600,400]);pdf.addPage([600,400]);
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview?project=00000000-0000-4000-8000-000000000101&start=file`);
  await page.getByLabel('작업실에서 열 PDF 선택').setInputFiles({name:'물량 페이지 연결.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
  await page.getByRole('button',{name:'선택한 PDF 등록 방식 확인',exact:true}).click();
  await page.getByRole('button',{name:'등록 방식 확인 후 준비',exact:true}).click();
  const ids=[];
  for(const number of [1,2]){
   if(number===2)await page.getByRole('button',{name:'다음 페이지',exact:true}).click();
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:140,y:100}});
   ids.push(await page.locator('[data-screen-shape]').getAttribute('data-screen-shape'));
   await openTakeoff(page);await page.getByLabel('물량 항목 이름',{exact:true}).fill(`${number}층 바닥 물량`);
   await page.getByRole('button',{name:'물량·내역 패널 닫기',exact:true}).click();
  }
  const saved=await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage).filter(([key])=>key.startsWith('1hk:preview:takeoff-rows:'))));
  await page.getByRole('button',{name:'작업실 메뉴 열기',exact:true}).click();
  await page.getByRole('button',{name:'페이지·레이어',exact:true}).click();
  await page.getByRole('button',{name:'검토 주석 잠그기 예시',exact:true}).click();
  await page.getByRole('button',{name:'검토 주석 숨기기 예시',exact:true}).click();
  await page.getByRole('dialog',{name:'작업실 메뉴',exact:true}).getByRole('button',{name:'도면으로 돌아가기',exact:true}).click();
  await expect(page.locator('[data-screen-shape]')).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});await openTakeoff(page);
  const all=page.getByRole('button',{name:'전체 물량 목록',exact:true});if(await all.isVisible())await all.click();
  const list=page.getByRole('region',{name:'도면 물량 연결',exact:true});
  await list.getByRole('searchbox',{name:'물량 항목 검색',exact:true}).fill('1쪽');
  await list.getByRole('button',{name:'1층 바닥 물량 · 물량 항목 열기',exact:true}).click();
  await expect(page.getByLabel('물량 항목 이름',{exact:true})).toHaveValue('1층 바닥 물량');
  await page.getByRole('button',{name:'연결 도형 위치 확인',exact:true}).click();
  await expect(page.locator(`[data-screen-shape="${ids[0]}"]`)).toHaveAttribute('aria-pressed','true');
  await expect(page.locator(`[data-screen-shape="${ids[1]}"]`)).toHaveCount(0);
  await expect(page.getByRole('button',{name:'이전 페이지',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'작업실 메뉴 열기',exact:true}).click();await page.getByRole('button',{name:'페이지·레이어',exact:true}).click();
  await expect(page.getByRole('button',{name:'검토 주석 잠금 해제 예시',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'검토 주석 숨기기 예시',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('dialog',{name:'작업실 메뉴',exact:true}).getByRole('button',{name:'도면으로 돌아가기',exact:true}).click();
  await openTakeoff(page);await page.getByRole('button',{name:'전체 물량 목록',exact:true}).click();
  await list.getByRole('searchbox',{name:'물량 항목 검색',exact:true}).fill('2쪽');
  await list.getByRole('button',{name:'2층 바닥 물량 · 물량 항목 열기',exact:true}).click();
  await page.getByRole('button',{name:'연결 도형 위치 확인',exact:true}).click();
  await expect(page.locator(`[data-screen-shape="${ids[1]}"]`)).toHaveAttribute('aria-pressed','true');
  await expect(page.locator(`[data-screen-shape="${ids[0]}"]`)).toHaveCount(0);
  await expect(page.getByRole('button',{name:'다음 페이지',exact:true})).toBeDisabled();
  if(process.env.TAKEOFF_PAGES_SCREENSHOT)await page.screenshot({path:process.env.TAKEOFF_PAGES_SCREENSHOT,animations:'disabled'});
  expect(await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage).filter(([key])=>key.startsWith('1hk:preview:takeoff-rows:'))))).toEqual(saved);
 }finally{await browser.close();}
});
test('quantity list filters preserved missing records without changing their stored inputs',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const url=`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000155`;
  await page.goto(url);
  for(const [index,name] of ['연결 바닥','철거 벽체'].entries()){
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:140+index*180,y:100}});
   await openTakeoff(page);await page.getByLabel('물량 항목 이름',{exact:true}).fill(name);
   await page.getByLabel('물량 항목 공종',{exact:true}).selectOption(index?'구조':'건축 마감');
   await page.getByRole('button',{name:'물량·내역 패널 닫기',exact:true}).click();
  }
  await page.getByRole('button',{name:'선택 도형 삭제',exact:true}).click();
  const key='1hk:preview:takeoff-rows:00000000-0000-4000-8000-000000000155:office:A3';
  const saved=await page.evaluate(key=>sessionStorage.getItem(key),key);
  await page.goto(`${url}&role=viewer`);await page.setViewportSize({width:390,height:844});await openTakeoff(page);
  const panel=page.getByRole('region',{name:'도면 물량 연결',exact:true});
  const search=panel.getByRole('searchbox',{name:'물량 항목 검색',exact:true});
  await expect(search).toBeVisible({timeout:3000});
  const filter=panel.getByLabel('물량 도형 연결 상태',{exact:true});
  const list=panel.getByRole('list',{name:'연결 물량 항목 목록',exact:true});
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await filter.selectOption('missing');await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText('철거 벽체');
  await expect(list.getByRole('button',{name:'철거 벽체 · 물량 항목 열기',exact:true})).toBeDisabled();
  await search.fill(' 건축 마감 ');await expect(list.getByRole('listitem')).toHaveCount(0);
  await panel.getByRole('button',{name:'물량 검색·필터 초기화',exact:true}).click();
  await expect(search).toHaveValue('');await expect(filter).toHaveValue('all');await expect(list.getByRole('listitem')).toHaveCount(2);
  await search.fill('구조');await expect(list.getByRole('listitem')).toHaveCount(1);
  await list.getByText('보관된 입력 보기',{exact:true}).click();await expect(list).toContainText('철거 벽체');
  if(process.env.TAKEOFF_SEARCH_SCREENSHOT)await page.screenshot({path:process.env.TAKEOFF_SEARCH_SCREENSHOT,animations:'disabled'});
  await search.fill('바닥');await filter.selectOption('available');await expect(list.getByRole('listitem')).toHaveCount(1);
  await list.getByRole('button',{name:'연결 바닥 · 물량 항목 열기',exact:true}).click();
  await expect(page.getByLabel('물량 항목 이름',{exact:true})).toHaveValue('연결 바닥');
  expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe(saved);
 }finally{await browser.close();}
});
test('replacing the drawing keeps prior-source quantity records separate and readonly',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000150`);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:140,y:100}});
  await openTakeoff(page);
  await page.getByLabel('물량 항목 이름',{exact:true}).fill('이전 원본 바닥');
  await page.getByLabel('물량 항목 공종',{exact:true}).selectOption('구조');
  await page.getByRole('button',{name:'물량·내역 패널 닫기',exact:true}).click();
  const read=()=>page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage).filter(([key])=>key.startsWith('1hk:preview:takeoff-rows:'))));
  const before=await read();
  const pdf=await PDFDocument.create();pdf.addPage([600,400]);
  page.on('dialog',dialog=>dialog.accept());
  await page.getByLabel('로컬 PDF 선택',{exact:true}).setInputFiles({name:'교체 원본.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
  await expect(page.locator('[data-screen-shape]')).toHaveCount(0);
  await openTakeoff(page);
  await page.getByText('이전 원본의 물량 기록 보기',{exact:true}).click({timeout:5000});
  const prior=page.getByRole('region',{name:'이전 원본 물량 기록',exact:true});
  await expect(prior).toContainText('템플릿 도면',{timeout:3000});
  await expect(prior.getByRole('button',{name:'이전 원본 바닥 · 물량 항목 열기',exact:true})).toBeDisabled();
  await prior.getByText('보관된 입력 보기',{exact:true}).click();
  await expect(prior).toContainText('구조');
  await expect(prior.getByRole('textbox')).toHaveCount(0);
  const current=page.getByRole('region',{name:'도면 물량 연결',exact:true}).filter({hasNot:page.getByRole('button',{name:'이전 원본 바닥 · 물량 항목 열기',exact:true})});
  await expect(current).toContainText('연결한 물량 항목이 없습니다');
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('region',{name:'물량·내역 작업 패널',exact:true}).evaluate(element=>{element.scrollTop=0;});
  await expect(page.getByText('이전 원본의 물량 기록 보기',{exact:true})).toBeInViewport({ratio:1});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(process.env.PRIOR_TAKEOFF_SCREENSHOT)await page.screenshot({path:process.env.PRIOR_TAKEOFF_SCREENSHOT,animations:'disabled'});
  expect(await read()).toEqual(before);
 }finally{await browser.close();}
});
test('Viewer inspecting an unlinked object does not fabricate a quantity row',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const url=`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000132`;
  await page.goto(url);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:140,y:100}});
  await page.goto(`${url}&role=viewer`);await page.locator('[data-screen-shape]').click();await openTakeoff(page);
  const panel=page.getByRole('region',{name:'선택 도형 물량 연결',exact:true});
  await expect(panel).toContainText('연결 물량 항목 · 0개');
  await expect(panel.getByRole('button',{name:'물량 행 보기',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>sessionStorage.getItem('1hk:preview:takeoff-rows:00000000-0000-4000-8000-000000000132:office:A3'))).toBeNull();
 }finally{await browser.close();}
});
test('opening quantity without a selection lists saved rows and returns to their drawing object',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000132`);
  await openTakeoff(page);
  await expect(page.getByRole('region',{name:'도면 물량 연결',exact:true})).toContainText('연결한 물량 항목이 없습니다');
  await expect(page.locator('.pdf-takeoff-anchor')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'물량·내역 작업 패널',exact:true})).not.toContainText('13.00');
  await page.getByRole('button',{name:'물량·내역 패널 닫기',exact:true}).click();
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:140,y:100}});
  const id=await page.locator('[data-screen-shape]').getAttribute('data-screen-shape');
  await openTakeoff(page);await page.getByLabel('물량 항목 이름',{exact:true}).fill('목록에서 찾을 바닥');
  await page.reload();await openTakeoff(page);
  const list=page.getByRole('region',{name:'도면 물량 연결',exact:true});
  await page.getByRole('button',{name:'설명용 A01 예시 보기',exact:true}).click();
  await expect(page.getByRole('button',{name:'3 내역',exact:true})).toBeVisible();
  await expect(page.locator('.pdf-takeoff-anchor')).toHaveCount(1);
  await page.getByRole('button',{name:'실제 연결 항목으로 돌아가기',exact:true}).click();
  await expect(page.locator('.pdf-takeoff-anchor')).toHaveCount(0);
  await page.getByRole('button',{name:'설명용 A01 예시 보기',exact:true}).click();
  await page.getByRole('button',{name:'물량·내역 패널 닫기',exact:true}).click();
  await openTakeoff(page);
  await expect(page.locator('.pdf-takeoff-anchor')).toHaveCount(0);
  await expect(list).toContainText('목록에서 찾을 바닥');
  if(process.env.TAKEOFF_LIST_SCREENSHOT)await page.screenshot({path:process.env.TAKEOFF_LIST_SCREENSHOT,animations:'disabled'});
  await list.getByRole('button',{name:'목록에서 찾을 바닥 · 물량 항목 열기',exact:true}).click();
  await expect(page.getByLabel('물량 항목 이름',{exact:true})).toHaveValue('목록에서 찾을 바닥');
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'전체 물량 목록',exact:true}).click();
  await expect(list).toBeVisible();
  await page.getByRole('region',{name:'물량·내역 작업 패널',exact:true}).evaluate(element=>{element.scrollTop=0;});
  await expect(list.getByRole('button',{name:'목록에서 찾을 바닥 · 물량 항목 열기',exact:true})).toBeInViewport({ratio:1});
  await expect(list.getByRole('button',{name:'목록에서 찾을 바닥 · 물량 항목 열기',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  if(process.env.TAKEOFF_MOBILE_SCREENSHOT)await page.screenshot({path:process.env.TAKEOFF_MOBILE_SCREENSHOT,animations:'disabled'});
  await list.getByRole('button',{name:'목록에서 찾을 바닥 · 물량 항목 열기',exact:true}).click();
  await expect(page.getByLabel('물량 항목 이름',{exact:true})).toHaveValue('목록에서 찾을 바닥');
  await page.getByRole('button',{name:'연결 도형 위치 확인',exact:true}).click();
  await expect(page.locator(`[data-screen-shape="${id}"]`)).toHaveAttribute('aria-pressed','true');
 }finally{await browser.close();}
});
test('registered drawing restores object quantity drafts after reload',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000132`);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:140,y:100}});
  const id=await page.locator('[data-screen-shape]').getAttribute('data-screen-shape');
  await openTakeoff(page);
  await page.getByLabel('물량 항목 이름',{exact:true}).fill('저장할 바닥');
  await page.getByLabel('물량 항목 공종',{exact:true}).selectOption('구조');
  await page.reload();
  await page.locator(`[data-screen-shape="${id}"]`).click();
  await openTakeoff(page);
  await expect(page.getByLabel('물량 항목 이름',{exact:true})).toHaveValue('저장할 바닥');
  await expect(page.getByLabel('물량 항목 공종',{exact:true})).toHaveValue('구조');
  const key='1hk:preview:takeoff-rows:00000000-0000-4000-8000-000000000132:office:A3';
  await page.evaluate(key=>{const original=Storage.prototype.setItem;window.restoreTakeoffWrites=()=>Storage.prototype.setItem=original;Storage.prototype.setItem=function(name,value){if(name===key)throw Error('test quota');return original.call(this,name,value);};},key);
  await page.getByLabel('물량 항목 이름',{exact:true}).fill('재시도할 바닥');
  await expect(page.getByRole('alert')).toContainText('물량 초안을 보관하지 못했습니다');
  await expect(page.getByRole('button',{name:'전체 물량 목록',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'물량·내역 패널 닫기',exact:true}).click();
  await expect(page.getByLabel('물량 항목 이름',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.restoreTakeoffWrites());
  await page.getByRole('button',{name:'물량 초안 보관 재시도',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(({key,id})=>JSON.parse(sessionStorage.getItem(key)).rows[id].name,{key,id})).toBe('재시도할 바닥');
  const saved=await page.evaluate(key=>sessionStorage.getItem(key),key);
  await page.evaluate(key=>sessionStorage.setItem(key,'broken'),key);
  await page.reload();await page.locator(`[data-screen-shape="${id}"]`).click();await openTakeoff(page);
  await expect(page.getByRole('alert')).toContainText('물량 초안을 읽지 못했습니다');
  await expect(page.getByLabel('물량 항목 이름',{exact:true})).toBeDisabled();
  expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe('broken');
  await page.evaluate(({key,saved})=>sessionStorage.setItem(key,saved),{key,saved});
  await page.getByRole('button',{name:'물량 초안 다시 읽기',exact:true}).click();
  await expect(page.getByLabel('물량 항목 이름',{exact:true})).toHaveValue('재시도할 바닥');
  await page.goto(`${page.url()}&role=viewer`);
  await page.locator(`[data-screen-shape="${id}"]`).click();await openTakeoff(page);
  await expect(page.getByLabel('물량 항목 이름',{exact:true})).toHaveValue('재시도할 바닥');
  await expect(page.getByLabel('물량 항목 이름',{exact:true})).toBeDisabled();
  await page.getByRole('region',{name:'선택 도형 물량 연결',exact:true}).getByRole('button',{name:'물량 행 보기',exact:true}).click();
  expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe(saved);
 }finally{await browser.close();}
});
async function openTakeoff(page){
 const button=page.getByRole('button',{name:'물량·내역 화면 열기',exact:true});
 if(!await button.isVisible())await page.getByLabel('도면 업무 더보기',{exact:true}).click();
 await button.click();
}

test('selected shape reaches its own uncalculated quantity row and returns to the same object',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:140,y:100}});
  await page.getByLabel('이름',{exact:true}).fill('회의실 바닥');
  const id=await page.locator('[data-screen-shape]').getAttribute('data-screen-shape');
  await openTakeoff(page);
  const panel=page.getByRole('region',{name:'선택 도형 물량 연결',exact:true});
  await expect(panel).toContainText('회의실 바닥');
  await expect(page.locator('.pdf-takeoff-anchor')).toHaveCount(0);
  await panel.getByLabel('물량 항목 공종',{exact:true}).selectOption('건축 마감');
  await panel.getByRole('button',{name:'물량 행 보기',exact:true}).click();
  await expect(panel.getByRole('table')).toContainText('미산출');
  await expect(panel.getByRole('table')).not.toContainText('13.00');
  await panel.getByRole('button',{name:'내역 행 보기',exact:true}).click();
  await expect(panel.getByRole('table')).toContainText('미산출');
  await expect(panel).not.toContainText('130,000');
  await panel.getByRole('button',{name:'연결 도형 위치 확인',exact:true}).click();
  await expect(page.locator(`[data-screen-shape="${id}"]`)).toHaveAttribute('aria-pressed','true');
  await openTakeoff(page);
  await panel.getByRole('button',{name:'영역 속성',exact:true}).click();
  await expect(panel.getByLabel('물량 항목 공종',{exact:true})).toHaveValue('건축 마감');
  await page.getByRole('button',{name:'물량·내역 패널 닫기',exact:true}).click();
  await page.getByRole('button',{name:'작성 모드',exact:true}).click();
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:320,y:180}});
  await page.getByLabel('이름',{exact:true}).fill('복도 바닥');
  await openTakeoff(page);
  await expect(panel).toContainText('복도 바닥');
  await expect(panel.getByLabel('물량 항목 공종',{exact:true})).toHaveValue('미분류');
  await panel.getByText('연결 물량 항목 · 2개',{exact:true}).click();
  await panel.getByRole('button',{name:'회의실 바닥 · 물량 항목 열기',exact:true}).click({timeout:5000});
  await expect(panel.getByLabel('물량 항목 공종',{exact:true})).toHaveValue('건축 마감');
  await expect(panel.getByRole('button',{name:'복도 바닥 · 물량 항목 열기',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'물량·내역 패널 닫기',exact:true}).click();
  await page.getByRole('button',{name:'선택 도형 삭제',exact:true}).click();
  await page.locator('[data-screen-shape]').click();
  await openTakeoff(page);
  await expect(panel.getByRole('button',{name:'회의실 바닥 · 물량 항목 열기',exact:true})).toBeDisabled();
  await expect(panel.getByRole('list',{name:'연결 물량 항목 목록',exact:true})).toContainText('도형 없음 · 기록 유지');
  const savedRows=await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage).filter(([key])=>key.startsWith('1hk:preview:takeoff-rows:'))));
  await panel.getByText('보관된 입력 보기',{exact:true}).click({timeout:5000});
  const record=panel.getByRole('region',{name:'누락 도형의 물량 기록',exact:true});
  await expect(record).toContainText('회의실 바닥');
  await expect(record).toContainText('건축 마감');
  await expect(record).toContainText(id);
  await expect(record.getByRole('textbox')).toHaveCount(0);
  expect(await page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage).filter(([key])=>key.startsWith('1hk:preview:takeoff-rows:'))))).toEqual(savedRows);
  if(process.env.SELECTED_TAKEOFF_SCREENSHOT)await page.screenshot({path:process.env.SELECTED_TAKEOFF_SCREENSHOT,animations:'disabled'});
 }finally{await browser.close();}
});
