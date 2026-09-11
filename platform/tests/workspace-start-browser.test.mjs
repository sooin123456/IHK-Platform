import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';

test('project search finds an older drawing and keeps favorite list settings after reload',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview`);
  await page.getByRole('button',{name:'성수동 사무실 즐겨찾기 추가',exact:true}).click();
  await page.getByLabel('프로젝트와 파일 검색',{exact:true}).fill('아이디어 스케치');
  const project=page.getByRole('link',{name:'성수동 사무실 도면 목록 열기',exact:true});
  await expect(project).toBeVisible({timeout:5000});
  await expect(page.getByRole('link',{name:'판교 주택 리모델링 도면 목록 열기',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'즐겨찾기',exact:true}).click();
  await page.getByRole('button',{name:'목록으로 보기',exact:true}).click();
  await page.reload();
  await expect(page.getByLabel('프로젝트와 파일 검색',{exact:true})).toHaveValue('아이디어 스케치');
  await expect(page.getByRole('button',{name:'목록으로 보기',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'즐겨찾기',exact:true})).toHaveAttribute('aria-pressed','true');
  await project.click();await expect(page).toHaveURL(/project=00000000-0000-4000-8000-000000000101/);
 }finally{await browser.close();}
});

for(const kind of ['blank','template'])test(`${kind} starts from an empty home and reopens the same drawing from its new project`,{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview?state=empty`);
  await page.getByRole('link',{name:'새 프로젝트',exact:true}).click();
  await page.getByLabel('프로젝트 이름',{exact:true}).fill(`${kind} 시작 프로젝트`);
  await page.getByRole('button',{name:'미리보기 프로젝트 만들기',exact:true}).click();
  await expect(page).toHaveURL(/project=00000000-0000-4000-9000-/);
  const project=new URL(page.url()).searchParams.get('project');
  await page.getByRole('link',{name:'새 도면',exact:true}).first().click();
  if(kind==='template')await page.getByRole('link',{name:'템플릿에서 시작',exact:true}).click();
  await page.getByLabel(kind==='blank'?'도면 제목':'템플릿 도면 제목',{exact:true}).fill(`${kind} 첫 도면`);
  await page.getByRole('button',{name:kind==='blank'?'새 도면 열기':'이 템플릿으로 시작',exact:true}).click();
  await expect(page).toHaveURL(/drawing-workspace/);
  const document=new URL(page.url()).searchParams.get('screenDocument');assert.ok(document);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:100,y:100}});
  await page.getByLabel('이름',{exact:true}).fill('다시 열어 확인할 영역');
  const object=await page.locator('[data-screen-shape]').getAttribute('data-screen-shape');
  await page.getByRole('link',{name:'작업공간으로 돌아가기',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`project=${project}`));
  await page.reload();
  await page.locator(`a[href*="screenDocument=${document}"]`).first().click();
  await expect(page.locator('[data-screen-shape]')).toHaveAttribute('data-screen-shape',object);
  await expect(page.locator('[data-screen-shape]')).toHaveAttribute('aria-label','다시 열어 확인할 영역 · 화면 도형');
 }finally{await browser.close();}
});

test('new project keeps inputs after failed storage then creates exactly one project on retry',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview?state=empty`);
  await page.getByRole('link',{name:'새 프로젝트',exact:true}).click();
  await page.getByLabel('프로젝트 이름',{exact:true}).fill('현장 검토 프로젝트');
  await page.getByLabel('설명 · 선택',{exact:true}).fill('첫 도면 시작 검증');
  await page.evaluate(()=>{const original=Storage.prototype.setItem;window.restoreProjectWrite=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(key,value){if(key==='1hk:preview:projects')throw Error('test quota');return original.call(this,key,value);};});
  await page.getByRole('button',{name:'미리보기 프로젝트 만들기',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('프로젝트를 보관하지 못했습니다');
  await expect(page.getByLabel('프로젝트 이름',{exact:true})).toHaveValue('현장 검토 프로젝트');
  await expect(page.getByLabel('설명 · 선택',{exact:true})).toHaveValue('첫 도면 시작 검증');
  await page.evaluate(()=>window.restoreProjectWrite());
  await page.getByRole('button',{name:'미리보기 프로젝트 만들기',exact:true}).click();
  await expect(page).toHaveURL(/project=00000000-0000-4000-9000-/);
  assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('1hk:preview:projects')).length),1);
  await page.reload();await expect(page.getByRole('navigation',{name:'현재 위치',exact:true})).toContainText('현장 검토 프로젝트');
 }finally{await browser.close();}
});
