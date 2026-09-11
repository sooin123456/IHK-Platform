import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';

test('unsubmitted request restores selected scope but requires a fresh preview',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000122`);
  const open=()=>page.getByRole('button',{name:'검토 요청 구성 열기',exact:true}).click();
  await open();
  await page.getByRole('radio',{name:'변경 직접 선택',exact:true}).check();
  await page.getByRole('checkbox',{name:'회의실 검토 영역 추가 · 1쪽',exact:true}).check();
  await page.getByLabel('요청 메시지',{exact:true}).fill('회의실만 확인해 주세요');
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await page.reload();await open();
  await expect(page.getByLabel('요청 메시지',{exact:true})).toHaveValue('회의실만 확인해 주세요');
  await expect(page.getByRole('radio',{name:'변경 직접 선택',exact:true})).toBeChecked();
  await expect(page.getByRole('checkbox',{name:'회의실 검토 영역 추가 · 1쪽',exact:true})).toBeChecked();
  await expect(page.getByRole('checkbox',{name:'출입문 위치 조정 · 1쪽',exact:true})).not.toBeChecked();
  await expect(page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true})).toHaveCount(0);
 }finally{await browser.close();}
});

test('location conversations restore drafts and fail safely on unreadable storage',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const id='00000000-0000-4000-8000-000000000121';
  const key=`1hk:preview:change-requests:${id}:conversations`;
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=${id}`);
  const pin=()=>page.getByRole('button',{name:'수정 1 · 출입문 위치 조정',exact:true});
  await pin().click();
  await page.getByLabel('이 위치에 의견 남기기',{exact:true}).fill('보관할 의견');
  await page.getByRole('button',{name:'화면에 추가',exact:true}).click();
  await page.getByLabel('이 위치에 의견 남기기',{exact:true}).fill('아직 작성 중인 의견');
  await page.reload();await pin().click();
  await expect(page.getByLabel('이 위치에 의견 남기기',{exact:true})).toHaveValue('아직 작성 중인 의견');
  await expect(page.locator('.change-message.own')).toContainText('보관할 의견');
  await page.evaluate(key=>{const original=Storage.prototype.setItem;window.restoreConversationWrite=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(name,value){if(name===key)throw Error('test quota');return original.call(this,name,value);};},key);
  await page.getByLabel('이 위치에 의견 남기기',{exact:true}).fill('실패 후에도 남을 초안');
  await expect(page.getByRole('alert')).toContainText('위치별 대화를 보관하지 못했습니다');
  await page.getByRole('link',{name:'작업공간으로 돌아가기',exact:true}).click();
  await expect(page).toHaveURL(/drawing-workspace/);
  await page.evaluate(()=>window.restoreConversationWrite());
  await page.getByRole('button',{name:'위치별 대화 보관 다시 시도',exact:true}).click();
  await expect.poll(()=>page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).drafts['sample-entrance'],key)).toBe('실패 후에도 남을 초안');
  await page.evaluate(key=>sessionStorage.setItem(key,'broken draft'),key);
  await page.reload();await pin().click();
  await expect(page.getByRole('alert')).toContainText('위치별 대화를 복원하지 못했습니다');
  await expect(page.getByLabel('이 위치에 의견 남기기',{exact:true})).toBeDisabled();
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),'broken draft');
 }finally{await browser.close();}
});

test('review guide follows unchecked pins and keeps original list numbers',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  const guide=page.getByRole('region',{name:'변경 확인 진행',exact:true});
  await expect(guide.getByRole('progressbar')).toHaveAttribute('aria-valuenow','0');
  await guide.getByRole('button',{name:'다음 확인 전 항목',exact:true}).click({timeout:5000});
  await expect(page.locator('[data-change-detail]')).toHaveAttribute('data-change-detail','sample-entrance');
  await page.getByRole('button',{name:'확인 표시',exact:true}).click();
  await expect(guide.getByRole('progressbar')).toHaveAttribute('aria-valuenow','1');
  await guide.getByRole('button',{name:'다음 확인 전 항목',exact:true}).click();
  await expect(page.locator('[data-change-detail]')).toHaveAttribute('data-change-detail','sample-meeting');
  await page.getByRole('button',{name:'전체 변경 3건',exact:true}).click();
  await page.getByLabel('변경 필터',{exact:true}).selectOption('pending');
  await expect(page.locator('[data-change-item="sample-meeting"] .change-index')).toHaveText('2');
  await expect(page.locator('[data-change-item="sample-partition"] .change-index')).toHaveText('3');
 }finally{await browser.close();}
});

test('request approval is separate from review and freezes its checked snapshot',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const url=`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000111&returnProject=00000000-0000-4000-8000-000000000101`;
  await page.goto(url);
  await page.getByRole('button',{name:'검토 요청 구성 열기',exact:true}).click();
  await page.getByLabel('요청 메시지',{exact:true}).fill('승인할 고정 범위');
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  const batch=page.getByRole('region',{name:'요청 묶음 검토',exact:true});
  await expect(batch.getByRole('list',{name:'요청 진행 단계',exact:true})).toBeInViewport();
  await batch.getByRole('button',{name:'승인자 보기 · 예시',exact:true}).click();
  await expect(batch.getByRole('button',{name:'이 요청 승인 확인 · 예시',exact:true})).toBeDisabled();
  await batch.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  for(const item of await batch.getByRole('article').all())await item.getByRole('button',{name:'확인 · 예시',exact:true}).click();
  await expect(batch.getByRole('button',{name:'이 요청 승인 확인 · 예시',exact:true})).toHaveCount(0);
  await batch.getByRole('button',{name:'승인 확인으로 계속',exact:true}).click({timeout:5000});
  await expect(batch.getByRole('list',{name:'요청 진행 단계',exact:true})).toContainText('승인 확인');
  await batch.getByLabel('요청 승인 의견',{exact:true}).fill('범위 확인 완료');
  await batch.getByRole('button',{name:'이 요청 승인 확인 · 예시',exact:true}).click();
  await expect(batch.getByRole('status').filter({hasText:'승인 확인 · 화면 예시'})).toContainText('범위 확인 완료');
  await batch.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  await expect(batch.getByRole('button',{name:'확인 · 예시',exact:true}).first()).toBeDisabled();
  await page.reload();
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await expect(batch).toContainText('범위 확인 완료');
  await batch.getByRole('button',{name:'이 요청을 납품 구성에 첨부',exact:true}).click({timeout:5000});
  const handoff=page.getByRole('dialog',{name:'납품으로 넘길 검토 기록',exact:true});
  await expect(handoff).toBeVisible();
  await expect(handoff).toContainText('전체 도면 개정 승인이 아닙니다');
  await page.keyboard.press('Escape');
  await expect(handoff).not.toBeVisible();
  await expect(batch.getByRole('button',{name:'이 요청을 납품 구성에 첨부',exact:true})).toBeFocused();
  await batch.getByRole('button',{name:'이 요청을 납품 구성에 첨부',exact:true}).click();
  await handoff.getByRole('button',{name:'이 기록으로 납품 구성 열기',exact:true}).click();
  await expect(page.getByRole('region',{name:'납품에 첨부할 요청 기록',exact:true})).toContainText('승인할 고정 범위');
  await page.getByRole('button',{name:'첨부 요청 선택 해제',exact:true}).click();
  await expect(page.getByRole('region',{name:'납품에 첨부할 요청 기록',exact:true})).toHaveCount(0);
  await page.reload();
  await page.getByLabel('도면 업무 더보기',{exact:true}).click();
  await page.getByRole('button',{name:'내보내기 화면 열기',exact:true}).click();
  await expect(page.getByRole('region',{name:'납품에 첨부할 요청 기록',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'도면으로 돌아가기',exact:true}).click();
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await expect(batch).toContainText('범위 확인 완료');
  await batch.getByRole('button',{name:'이 요청을 납품 구성에 첨부',exact:true}).click();
  await page.getByRole('button',{name:'이 기록으로 납품 구성 열기',exact:true}).click();
  await page.reload();
  await page.getByLabel('도면 업무 더보기',{exact:true}).click();
  await page.getByRole('button',{name:'내보내기 화면 열기',exact:true}).click();
  await expect(page.getByRole('region',{name:'납품에 첨부할 요청 기록',exact:true})).toContainText('승인할 고정 범위');
  await page.getByRole('button',{name:'납품 구성으로 계속',exact:true}).click();
  const deliveryKey='1hk:preview:delivery:00000000-0000-4000-8000-000000000101:00000000-0000-4000-8000-000000000111';
  await expect.poll(()=>page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)||'null')?.deliverySource?.approvedRequest?.approval?.note,deliveryKey)).toBe('범위 확인 완료');
  await page.reload();
  await page.getByLabel('도면 업무 더보기',{exact:true}).click();
  await page.getByRole('button',{name:'내보내기 화면 열기',exact:true}).click();
  const evidence=page.getByRole('region',{name:'납품에 첨부할 요청 기록',exact:true});
  await expect(evidence).toContainText('범위 확인 완료');
  await expect(page.getByRole('button',{name:'첨부 요청 선택 해제',exact:true})).toHaveCount(0);
  await evidence.getByText('요청 항목·검토 의견 3개',{exact:true}).click();
  await expect(evidence.getByText('출입문 위치 조정 · 1쪽',{exact:true})).toBeVisible();
  await expect(evidence.locator('input,textarea,select')).toHaveCount(0);
 }finally{await browser.close();}
});

test('document request history survives reload, stays read-only for Viewer and does not overwrite corrupt storage', {skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const documentId='00000000-0000-4000-8000-000000000119';
  const url=`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=${documentId}`;
  const key=`1hk:preview:change-requests:${documentId}`;
  await page.goto(url);
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.getByRole('button',{name:'검토 요청 구성',exact:true}).click();
  await page.getByLabel('요청 메시지',{exact:true}).fill('보존할 검토 묶음');
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  await page.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  await page.getByRole('article',{name:'출입문 위치 조정',exact:true}).getByRole('button',{name:'확인 · 예시',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click({timeout:5000});
  const batch=page.getByRole('region',{name:'요청 묶음 검토',exact:true});
  await expect(batch).toContainText('보존할 검토 묶음');
  await expect(batch.getByRole('article',{name:'출입문 위치 조정',exact:true})).toContainText('확인 · 예시');
  await page.evaluate(key=>{const original=Storage.prototype.setItem;window.restoreRequestWrite=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(name,value){if(name===key)throw Error('test quota');return original.call(this,name,value);};},key);
  await page.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  const second=batch.getByRole('article',{name:'회의실 검토 영역 추가',exact:true});
  await second.getByLabel('검토 의견',{exact:true}).fill('저장 실패에도 유지할 의견');
  await second.getByRole('button',{name:'수정 요청 · 예시',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'요청 묶음을 보관하지 못했습니다'})).toBeVisible();
  await page.getByRole('button',{name:'변경으로 돌아가기',exact:true}).click();
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await expect(second).toContainText('저장 실패에도 유지할 의견');
  await page.getByRole('button',{name:'도면 정보',exact:true}).click();
  await page.getByRole('link',{name:'작업공간으로 돌아가기',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'보관하지 못한 작업이 있어 이동을 멈췄습니다'})).toBeVisible();
  assert.equal(page.url(),url);
  await page.getByRole('button',{name:'요청 보관 상태 보기',exact:true}).click();
  await expect(second).toContainText('저장 실패에도 유지할 의견');
  const replacement=await PDFDocument.create();replacement.addPage();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByLabel('로컬 PDF 선택',{exact:true}).setInputFiles({name:'other-source.pdf',mimeType:'application/pdf',buffer:Buffer.from(await replacement.save())});
  await expect(page.getByText('보관하지 못한 작업이 있어 원본 교체를 멈췄습니다. 보관을 다시 시도한 후 파일을 선택해 주세요.',{exact:true})).toBeVisible();
  await expect(second).toContainText('저장 실패에도 유지할 의견');
  assert.equal(await page.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),true);
  await page.evaluate(()=>window.restoreRequestWrite());
  await page.getByRole('button',{name:'요청 묶음 보관 다시 시도',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'요청 묶음을 보관하지 못했습니다'})).toHaveCount(0);
  await expect(page.getByRole('alert').filter({hasText:'보관하지 못한 작업이 있어 이동을 멈췄습니다'})).toHaveCount(0);
  assert.equal(await page.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);
  const stored=await page.evaluate(key=>sessionStorage.getItem(key),key);assert.ok(stored);
  await page.goto(`${url}&role=viewer`);
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await page.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  await expect(batch.getByRole('button',{name:'확인 · 예시',exact:true}).first()).toBeDisabled();
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),stored);
  await page.evaluate(key=>sessionStorage.setItem(key,'null'),key);
  await page.goto(url);
  await expect(page.getByRole('alert').filter({hasText:'요청 묶음을 복원하지 못했습니다'})).toBeVisible();
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),'null');
  await page.evaluate(({key,stored})=>sessionStorage.setItem(key,stored),{key,stored});
  await page.getByRole('button',{name:'요청 묶음 다시 읽기',exact:true}).click();
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await expect(batch).toContainText('보존할 검토 묶음');
 }finally{await browser.close();}
});

test('a frozen multi-change request reaches reviewer decisions and author correction without replacing its history', {skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  for(const x of [120,350]){
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x,y:100}});
  }
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.getByRole('button',{name:'검토 요청 구성',exact:true}).click();
  await page.getByLabel('요청 메시지',{exact:true}).fill('두 영역을 검토해 주세요');
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click({timeout:5000});
  const batch=page.getByRole('region',{name:'요청 묶음 검토',exact:true});
  await expect(batch).toContainText('요청 1');
  await page.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  const first=batch.getByRole('article',{name:'사각형 01',exact:true});
  const second=batch.getByRole('article',{name:'사각형 02',exact:true});
  await first.getByRole('button',{name:'확인 · 예시',exact:true}).click();
  await expect(second.getByRole('button',{name:'수정 요청 · 예시',exact:true})).toBeDisabled();
  await second.getByLabel('검토 의견',{exact:true}).fill('폭을 다시 확인해 주세요');
  await second.getByRole('button',{name:'수정 요청 · 예시',exact:true}).click();
  await expect(batch).toContainText('수정 요청 1건');
  if(process.env.REQUEST_BATCH_SCREENSHOT)await page.screenshot({path:process.env.REQUEST_BATCH_SCREENSHOT});
  await page.getByRole('button',{name:'작성자 보기 · 예시',exact:true}).click();
  await second.getByRole('button',{name:'도면에서 확인',exact:true}).click();
  await expect(page.locator('[data-change-detail] h3')).toHaveText('사각형 02');
  await page.getByRole('button',{name:'작성으로',exact:true}).click();
  await page.getByLabel('이름',{exact:true}).fill('수정한 두 번째 영역');
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await expect(second).toContainText('폭을 다시 확인해 주세요');
  await expect(second.getByRole('status')).toContainText('요청 이후 변경됨');
  await second.getByText('요청 당시 · 현재 비교',{exact:true}).click();
  await expect(second.getByRole('region',{name:'요청 당시 내용',exact:true})).toContainText('사각형 02');
  await expect(second.getByRole('region',{name:'요청 당시 내용',exact:true})).not.toContainText('수정한 두 번째 영역');
  await expect(second.getByRole('region',{name:'현재 내용',exact:true})).toContainText('수정한 두 번째 영역');
  await expect(first.getByRole('status')).toContainText('요청 당시와 동일');
  await batch.getByRole('button',{name:'요청 당시 도형 배치 보기',exact:true}).click();
  const snapshot=page.getByRole('region',{name:'요청 당시 도형 배치',exact:true});
  await expect(snapshot.locator('[data-screen-shape]')).toHaveCount(2);
  await expect(snapshot.locator('[data-screen-shape]').nth(1)).toHaveAttribute('aria-label','사각형 02 · 화면 도형');
  await expect(snapshot).not.toContainText('수정한 두 번째 영역');
  if(process.env.REQUEST_SNAPSHOT_SCREENSHOT)await page.screenshot({path:process.env.REQUEST_SNAPSHOT_SCREENSHOT,animations:'disabled'});
  await page.getByRole('button',{name:'요청 당시 도형 배치 닫기',exact:true}).click();
  await page.getByRole('button',{name:'같은 항목으로 재검토 구성',exact:true}).click();
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  await expect(batch).toContainText('요청 2');
  await expect(batch).toContainText('수정한 두 번째 영역');
  await page.getByLabel('요청 이력',{exact:true}).selectOption('1');
  await expect(batch).toContainText('사각형 02');
  await expect(batch).toContainText('폭을 다시 확인해 주세요');
  await page.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  await expect(batch.getByRole('button',{name:'확인 · 예시',exact:true}).first()).toBeDisabled();
 }finally{await browser.close();}
});

test('mobile long request preview focuses its result and returns to the preserved message for editing', {skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.getByRole('button',{name:'검토 요청 구성',exact:true}).click();
  const message=page.getByRole('textbox',{name:'요청 메시지',exact:true});
  const text='출입 동선과 변경 범위를 확인해 주세요.\n'.repeat(12);
  await message.fill(text);
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  const heading=page.getByRole('heading',{name:'요청 구성 예시 · 미전송',exact:true});
  await expect(heading).toBeFocused({timeout:5000});
  await expect(heading).toBeInViewport();
  const tabs=page.getByRole('button',{name:'변경',exact:true});
  const tabBounds=await tabs.boundingBox();
  const headingBounds=await heading.boundingBox();
  assert.ok(headingBounds.y>=tabBounds.y+tabBounds.height,'result heading must not be hidden under fixed tabs');
  if(process.env.MOBILE_REQUEST_SCREENSHOT)await page.screenshot({path:process.env.MOBILE_REQUEST_SCREENSHOT});
  await page.getByRole('button',{name:'요청 내용 수정',exact:true}).click();
  await expect(message).toBeFocused();
  await expect(message).toHaveValue(text);
  await expect(heading).toHaveCount(0);
  await message.fill('수정한 요청');
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await expect(heading).toBeFocused();
  await expect(page.locator('.change-scope[role="status"]')).toContainText('수정한 요청');
 }finally{await browser.close();}
});

test('return from change exploration restores the original PDF page zoom and scroll position', {skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const pdf=await PDFDocument.create();pdf.addPage([600,400]);pdf.addPage([600,400]);
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=pdf`);
  await page.getByLabel('로컬 PDF 선택',{exact:true}).setInputFiles({name:'return-location.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
  await page.getByRole('button',{name:'다음 페이지',exact:true}).click();
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:120,y:100}});
  await page.getByRole('button',{name:'이전 페이지',exact:true}).click();
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  const back=page.getByRole('button',{name:'탐색 전 위치로 돌아가기',exact:true});
  await expect(back).toHaveCount(0);
  for(let i=0;i<4;i++)await page.getByRole('button',{name:'도면 확대',exact:true}).click();
  const surface=page.getByLabel('PDF 1쪽',{exact:true});
  await expect(surface).toHaveAttribute('aria-busy','false');
  await surface.hover({position:{x:600,y:400}});
  await page.mouse.wheel(180,240);
  await expect.poll(()=>surface.evaluate(node=>node.scrollTop)).toBeGreaterThan(100);
  const before=await surface.evaluate(node=>({left:node.scrollLeft,top:node.scrollTop}));
  await page.locator('[data-change-item]').click();
  await expect(page.getByLabel('PDF 2쪽',{exact:true})).toHaveAttribute('aria-busy','false');
  if(process.env.RETURN_LOCATION_SCREENSHOT)await page.screenshot({path:process.env.RETURN_LOCATION_SCREENSHOT});
  await back.click({timeout:5000});
  await expect(surface).toHaveAttribute('aria-busy','false');
  await expect(page.getByLabel('맞춤 배율 대비 확대',{exact:true})).toHaveText('200%');
  await expect.poll(()=>surface.evaluate(node=>node.scrollTop)).toBe(before.top);
  await expect.poll(()=>surface.evaluate(node=>node.scrollLeft)).toBe(before.left);
  await expect(back).toHaveCount(0);
  await expect(page.locator('[data-change-detail]')).toHaveCount(0);
 }finally{await browser.close();}
});

test('review request includes only chosen changes and invalidates its preview when selection changes', {skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.getByRole('button',{name:'검토 요청 구성',exact:true}).click();
  await page.getByRole('radio',{name:'변경 직접 선택',exact:true}).check({timeout:5000});
  await page.getByLabel('요청 메시지',{exact:true}).fill('출입문만 먼저 검토해주세요');
  const preview=page.getByRole('button',{name:'요청 내용 미리보기',exact:true});
  await expect(preview).toBeDisabled();
  await page.getByRole('checkbox',{name:'출입문 위치 조정 · 1쪽',exact:true}).check();
  await preview.click();
  const result=page.locator('.change-scope[role="status"]');
  await expect(result).toContainText('출입문 위치 조정');
  await expect(result).not.toContainText('회의실 검토 영역 추가');
  await expect(result).toContainText('1개 변경');
  await page.getByRole('checkbox',{name:'칸막이 철거 검토 · 1쪽',exact:true}).check();
  await expect(result).toHaveCount(0);
  await preview.click();
  await expect(result).toContainText('2개 변경');
  await expect(result).toContainText('칸막이 철거 검토');
  await page.getByRole('button',{name:'변경으로 돌아가기',exact:true}).click();
  await page.getByRole('button',{name:'검토 요청 구성',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'출입문 위치 조정 · 1쪽',exact:true})).toBeChecked();
  await page.getByRole('radio',{name:'현재 페이지 전체',exact:true}).check();
  await expect(result).toHaveCount(0);
  await preview.click();
  await expect(result).toContainText('3개 변경');
  await expect(result).toContainText('회의실 검토 영역 추가');
 }finally{await browser.close();}
});

test('overlapping pins expand into individually selectable changes and Escape restores focus', {skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  for(let i=0;i<3;i++){
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:120,y:100}});
  }
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  const cluster=page.getByRole('button',{name:'겹친 변경 3개',exact:true});
  await cluster.click();
  const list=page.getByRole('group',{name:'겹친 변경 선택',exact:true});
  await expect(list.getByRole('button')).toHaveCount(3);
  await expect(list.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(cluster).toBeFocused();
  await cluster.click();
  if(process.env.CLUSTER_SCREENSHOT)await page.screenshot({path:process.env.CLUSTER_SCREENSHOT});
  await list.getByRole('button').nth(1).click();
  await expect(page.locator('[data-change-detail] h3')).toHaveText('사각형 02');
  await expect(list).toHaveCount(0);
 }finally{await browser.close();}
});

test('unfinished share email and role survive returning to the drawing', {skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByLabel('도면 업무 더보기',{exact:true}).click();
  await page.getByRole('button',{name:'공유 화면 열기',exact:true}).click();
  await page.getByLabel('받는 사람 이메일',{exact:true}).fill('draft@example.com');
  await page.getByRole('combobox',{name:'역할',exact:true}).selectOption('editor');
  await page.getByRole('button',{name:'도면으로 돌아가기',exact:true}).click();
  await page.getByRole('button',{name:'공유 화면 열기',exact:true}).click();
  await expect(page.getByLabel('받는 사람 이메일',{exact:true})).toHaveValue('draft@example.com');
  await expect(page.getByRole('combobox',{name:'역할',exact:true})).toHaveValue('editor');
  await expect(page.getByRole('heading',{name:'초대 확인 화면 예시',exact:true})).toHaveCount(0);
 }finally{await browser.close();}
});

test('reselecting identical PDF bytes under another name preserves the change conversation', {skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const pdf=await PDFDocument.create();pdf.addPage([600,400]);
 const buffer=Buffer.from(await pdf.save());
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=pdf`);
  const input=page.getByLabel('로컬 PDF 선택',{exact:true});
  await input.setInputFiles({name:'original.pdf',mimeType:'application/pdf',buffer});
  await expect(page.getByRole('button',{name:'사각형 도구 화면',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:120,y:100}});
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.locator('[data-change-item]').click();
  const draft=page.getByRole('textbox',{name:'이 위치에 의견 남기기',exact:true});
  await draft.fill('기존 의견');
  await page.getByRole('button',{name:'화면에 추가',exact:true}).click();
  await draft.fill('작성 중인 수정 요청');
  await page.getByLabel('위치 대화 유형',{exact:true}).selectOption('수정 요청');
  await page.getByRole('button',{name:'확인 표시',exact:true}).click();
  await page.getByLabel('도면 업무 더보기',{exact:true}).click();
  await page.getByRole('button',{name:'공유 화면 열기',exact:true}).click();
  await page.getByLabel('받는 사람 이메일',{exact:true}).fill('review@example.com');
  await page.getByRole('button',{name:'초대 화면 확인',exact:true}).click();
  await page.getByRole('button',{name:'도면으로 돌아가기',exact:true}).click();
  await input.setInputFiles({name:'renamed.pdf',mimeType:'application/pdf',buffer});
  await expect(page.getByRole('heading',{name:'renamed.pdf',exact:true})).toBeVisible();
  await expect(draft).toHaveValue('작성 중인 수정 요청');
  await expect(page.getByLabel('위치 대화 유형',{exact:true})).toHaveValue('수정 요청');
  await expect(page.locator('.change-message.own')).toContainText('기존 의견');
  await expect(page.getByRole('button',{name:'확인 표시 해제',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'공유 화면 열기',exact:true}).click();
  await expect(page.getByRole('heading',{name:'초대 확인 화면 예시',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('review@example.com');
 }finally{await browser.close();}
});

test('returning from a real change conversation opens that object inspector for correction', {skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:120,y:100}});
  await page.getByRole('textbox',{name:'이름',exact:true}).fill('수정할 검토 영역');
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.locator('[data-change-item]').click();
  await page.getByRole('textbox',{name:'이 위치에 의견 남기기',exact:true}).fill('폭 확인 초안');
  await page.getByRole('button',{name:'작성으로',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'이름',exact:true})).toHaveValue('수정할 검토 영역');
  await page.getByRole('textbox',{name:'이름',exact:true}).fill('수정한 검토 영역');
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await expect(page.getByRole('heading',{name:'수정한 검토 영역',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'이 위치에 의견 남기기',exact:true})).toHaveValue('폭 확인 초안');
 }finally{await browser.close();}
});

test('provided structural PDF renders with review overlays without changing source bytes', {skip:!process.env.OBJECT_PREVIEW_ORIGIN||!process.env.STRUCTURE_PDF_PATH,timeout:60000},async()=>{
 const {readFile}=await import('node:fs/promises');
 const {createHash}=await import('node:crypto');
 const original=await readFile(process.env.STRUCTURE_PDF_PATH);
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=pdf`);
  await page.getByLabel('로컬 PDF 선택',{exact:true}).setInputFiles({name:'구조.pdf',mimeType:'application/pdf',buffer:original});
  await expect(page.getByRole('button',{name:'다음 페이지',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:180,y:200}});
  await page.getByRole('textbox',{name:'이름',exact:true}).fill('기초 접합부 검토');
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.locator('[data-change-item]').click();
  await expect(page.getByRole('heading',{name:'기초 접합부 검토',exact:true})).toBeVisible();
  await expect(page.locator('.pdf-drawing-viewport canvas')).toBeVisible();
  if(process.env.STRUCTURE_PDF_SCREENSHOT)await page.screenshot({path:process.env.STRUCTURE_PDF_SCREENSHOT});
  assert.equal(hash(await readFile(process.env.STRUCTURE_PDF_PATH)),hash(original));
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test('review highlight keeps the drawn rectangle dimensions on a wide drawing', {skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:120,y:100}});
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  const shape=page.locator('[data-screen-shape] rect').first();
  const region=page.locator('.change-region');
  for(const size of [{width:1280,height:800},{width:1100,height:900}]){
   await page.setViewportSize(size);
   await expect.poll(async()=>{
    const a=await shape.boundingBox(),b=await region.boundingBox();
    return a&&b?Math.max(Math.abs(a.width-b.width),Math.abs(a.height-b.height)):Infinity;
   }).toBeLessThan(2);
  }
 }finally{await browser.close();}
});

test('mobile change pin opens a reachable detail panel and closing returns focus to the pin', {skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);
 assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  const pin=page.getByRole('button',{name:'수정 1 · 출입문 위치 조정',exact:true});
  await pin.click();
  const panel=page.getByRole('complementary',{name:'도면 정보 패널',exact:true});
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading',{name:'출입문 위치 조정',exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'정보 패널 닫기',exact:true}).click();
  await expect(pin).toBeFocused();
 }finally{await browser.close();}
});

test('PDF changes return to their own pages and retain drafts across page and mode changes', {skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);
 assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const pdf=await PDFDocument.create();pdf.addPage([600,400]);pdf.addPage([600,400]);
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=pdf`);
  await page.getByLabel('로컬 PDF 선택',{exact:true}).setInputFiles({name:'two-page-review.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
  await expect(page.getByRole('button',{name:'다음 페이지',exact:true})).toBeEnabled();
  for(const [number,name] of [[1,'1층 검토 영역'],[2,'2층 검토 영역']]){
   if(number===2)await page.getByRole('button',{name:'다음 페이지',exact:true}).click();
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:120,y:100}});
   await page.getByRole('textbox',{name:'이름',exact:true}).fill(name);
  }
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.locator('[data-change-item]').filter({hasText:'1층 검토 영역'}).click();
  await expect(page.getByRole('button',{name:'이전 페이지',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'추가 1 · 1층 검토 영역',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'추가 2 · 2층 검토 영역',exact:true})).toHaveCount(0);
  await page.getByRole('textbox',{name:'이 위치에 의견 남기기',exact:true}).fill('1층 의견 초안');
  await page.getByRole('button',{name:'다음 변경',exact:true}).click();
  await expect(page.getByRole('button',{name:'다음 페이지',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'추가 2 · 2층 검토 영역',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'이 위치에 의견 남기기',exact:true})).toHaveValue('');
  await page.getByRole('button',{name:'이전 변경',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'이 위치에 의견 남기기',exact:true})).toHaveValue('1층 의견 초안');
  await page.getByRole('button',{name:'검토 요청 구성 열기',exact:true}).click();
  await page.getByRole('textbox',{name:'요청 메시지',exact:true}).fill('1층 변경 검토 부탁드립니다');
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  const requestResult=page.getByRole('status').filter({hasText:'요청 구성 예시 · 미전송'});
  await expect(requestResult).toBeVisible();
  await page.getByRole('button',{name:'다음 페이지',exact:true}).click();
  await expect(requestResult).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'요청 메시지',exact:true})).toHaveValue('1층 변경 검토 부탁드립니다');
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await expect(requestResult).toBeVisible();
  await expect(requestResult).toContainText('2쪽');
  await page.getByRole('radio',{name:'변경 직접 선택',exact:true}).check();
  await page.getByRole('checkbox',{name:'1층 검토 영역 · 1쪽',exact:true}).check();
  await page.getByRole('checkbox',{name:'2층 검토 영역 · 2쪽',exact:true}).check();
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await expect(requestResult).toContainText('1, 2쪽 · 2개 변경');
  await expect(requestResult).toContainText('1층 검토 영역 (1쪽)');
  await expect(requestResult).toContainText('2층 검토 영역 (2쪽)');
  if(process.env.REQUEST_SCOPE_SCREENSHOT)await page.screenshot({path:process.env.REQUEST_SCOPE_SCREENSHOT});
  await page.getByRole('button',{name:'변경으로 돌아가기',exact:true}).click();
  await page.getByRole('button',{name:'이전 페이지',exact:true}).click();
  await page.getByRole('button',{name:'작성 모드',exact:true}).click();
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await expect(page.getByRole('button',{name:'이전 페이지',exact:true})).toBeDisabled();
  await expect(page.getByRole('textbox',{name:'이 위치에 의견 남기기',exact:true})).toHaveValue('1층 의견 초안');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test('keyboard selection focuses the change heading and returning restores the list item', {skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);
 assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  const entry=page.locator('[data-change-item="sample-entrance"]');
  await entry.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'출입문 위치 조정',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'전체 변경 3건',exact:true}).click();
  await expect(entry).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('textbox',{name:'이 위치에 의견 남기기',exact:true}).fill('초점 이동 중 초안 유지');
  await page.getByRole('button',{name:'검토 요청 구성 열기',exact:true}).click();
  await expect(page.getByRole('heading',{name:'검토 요청 구성',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'변경으로 돌아가기',exact:true}).click();
  await expect(page.getByRole('heading',{name:'출입문 위치 조정',exact:true})).toBeFocused();
  await expect(page.getByRole('textbox',{name:'이 위치에 의견 남기기',exact:true})).toHaveValue('초점 이동 중 초안 유지');
 }finally{await browser.close();}
});

test('a change selection reveals its hidden locked layer without unlocking it', {skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);
 assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:120,y:100}});
  const shape=page.getByRole('button',{name:'사각형 01 · 화면 도형',exact:true});
  await expect(shape).toBeVisible();
  await page.getByRole('button',{name:'페이지 패널 전환',exact:true}).click();
  await page.getByRole('button',{name:'레이어',exact:true}).click();
  await page.getByRole('button',{name:'검토 주석 잠그기 예시',exact:true}).click();
  await page.getByRole('button',{name:'검토 주석 숨기기 예시',exact:true}).click();
  await expect(shape).toHaveCount(0);
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.locator('[data-change-item]').click();
  await expect(shape).toBeVisible();
  await expect(page.getByRole('button',{name:'검토 주석 잠금 해제 예시',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'검토 주석 숨기기 예시',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'작성으로',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'이름',exact:true})).toBeDisabled();
 }finally{await browser.close();}
});

test('each change keeps its own draft text and conversation type across mode changes', {skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);
 assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.getByRole('button',{name:'수정 1 · 출입문 위치 조정',exact:true}).click();
  const text=page.getByRole('textbox',{name:'이 위치에 의견 남기기',exact:true});
  const kind=page.getByLabel('위치 대화 유형',{exact:true});
  await text.fill('출입문 간섭을 수정해 주세요');
  await kind.selectOption({label:'수정 요청'});
  await page.getByRole('button',{name:'추가 2 · 회의실 검토 영역 추가',exact:true}).click();
  await expect(text).toHaveValue('');
  await expect(kind).toHaveValue('의견');
  await text.fill('회의실 통로 확인했습니다');
  await page.getByRole('button',{name:'수정 1 · 출입문 위치 조정',exact:true}).click();
  await expect(text).toHaveValue('출입문 간섭을 수정해 주세요');
  await expect(kind).toHaveValue('수정 요청');
  await page.getByRole('button',{name:'작성 모드',exact:true}).click();
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await expect(kind).toHaveValue('수정 요청');
  await expect(text).toHaveValue('출입문 간섭을 수정해 주세요');
  await page.getByRole('button',{name:'화면에 추가',exact:true}).click();
  await expect(page.locator('.change-message.own')).toContainText('수정 요청');
  await expect(page.locator('.change-message.own')).toContainText('출입문 간섭을 수정해 주세요');
  await page.getByRole('button',{name:'추가 2 · 회의실 검토 영역 추가',exact:true}).click();
  await expect(text).toHaveValue('회의실 통로 확인했습니다');
  await expect(kind).toHaveValue('의견');
  await expect(page.locator('.change-message.own')).toHaveCount(0);
 }finally{await browser.close();}
});
