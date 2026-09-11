import test from 'node:test';
import {chromium,expect} from '@playwright/test';

test('normal workspace guidance is compact and expandable while keeping the mode action visible',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000148`);
  const guide=page.locator('[aria-label="도면 작업 흐름"]');
  const summary=guide.getByText('작업 안내',{exact:true});
  await expect(summary).toBeVisible({timeout:5000});
  expect((await guide.boundingBox()).height).toBeLessThanOrEqual(56);
  const storage=guide.getByText('검토 예시는 이 브라우저 탭에 보관됩니다. 실제 승인·서버 저장은 아닙니다.',{exact:true});
  await expect(storage).not.toBeVisible();
  await summary.click();await expect(storage).toBeVisible();
  await summary.click();
  await page.setViewportSize({width:390,height:844});
  await expect(summary).toBeInViewport();
  await expect(page.getByRole('button',{name:'변경 위치 확인',exact:true})).toBeInViewport();
  expect((await guide.boundingBox()).height).toBeLessThanOrEqual(56);
  if(process.env.COMPACT_GUIDE_SCREENSHOT)await page.screenshot({path:process.env.COMPACT_GUIDE_SCREENSHOT,animations:'disabled'});
  await page.evaluate(()=>sessionStorage.setItem('1hk:preview:review:00000000-0000-4000-8000-000000000148','invalid'));
  await page.reload();await summary.click();
  await expect(guide).toContainText('검토 기록을 보관하거나 복원하지 못했습니다');
  await expect(storage).not.toBeVisible();
 }finally{await browser.close();}
});

test('mode guide opens changes without leaving the drawing',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  const url=page.url();
  await page.getByRole('button',{name:'작성 모드',exact:true}).click();
  await page.getByRole('button',{name:'변경 위치 확인',exact:true}).click();
  await expect(page.getByRole('button',{name:'검토 모드',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'수정 1 · 출입문 위치 조정',exact:true}).click();
  await expect(page.locator('[data-change-detail]')).toHaveAttribute('data-change-detail','sample-entrance');
  await page.getByRole('button',{name:'변경 목록 열기',exact:true}).click();
  await expect(page.locator('[data-change-item="sample-entrance"]')).toBeVisible();
  await expect(page.locator('[data-change-detail]')).toHaveCount(0);
  expect(page.url()).toBe(url);
  await page.getByRole('button',{name:'작성 모드',exact:true}).click();
  await expect(page.getByRole('button',{name:'변경 위치 확인',exact:true})).toBeVisible();
  if(process.env.MODE_GUIDE_SCREENSHOT)await page.screenshot({path:process.env.MODE_GUIDE_SCREENSHOT,animations:'disabled'});
 }finally{await browser.close();}
});
