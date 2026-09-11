import test from 'node:test';
import {chromium,expect} from '@playwright/test';

for(const mobile of [false,true])test(`location request starts with only that change and returns without losing its conversation (${mobile?'mobile':'desktop'})`,{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{});
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  const url=page.url();
  await page.getByRole('button',{name:'수정 1 · 출입문 위치 조정',exact:true}).click();
  await page.getByLabel('이 위치에 의견 남기기',{exact:true}).fill('동선 확인 부탁드립니다');
  await page.getByRole('button',{name:'화면에 추가',exact:true}).click();
  await page.getByRole('button',{name:'이 위치 검토 요청',exact:true}).click({timeout:5000});
  if(mobile)await expect(page.getByRole('checkbox',{name:'출입문 위치 조정 · 1쪽',exact:true})).toBeInViewport({timeout:5000});
  await expect(page.getByRole('radio',{name:'변경 직접 선택',exact:true})).toBeChecked();
  await expect(page.getByRole('checkbox',{name:'출입문 위치 조정 · 1쪽',exact:true})).toBeChecked();
  await expect(page.getByRole('checkbox',{name:'회의실 검토 영역 추가 · 1쪽',exact:true})).not.toBeChecked();
  await page.getByLabel('요청 메시지',{exact:true}).fill('출입문 위치만 검토해 주세요');
  await page.getByRole('button',{name:'변경으로 돌아가기',exact:true}).click();
  await expect(page.locator('.change-message.own')).toContainText('동선 확인 부탁드립니다');
  await page.getByRole('button',{name:'이 위치 검토 요청',exact:true}).click();
  await expect(page.getByLabel('요청 메시지',{exact:true})).toHaveValue('출입문 위치만 검토해 주세요');
  if(process.env.LOCATION_REQUEST_SCREENSHOT)await page.screenshot({path:`${process.env.LOCATION_REQUEST_SCREENSHOT}-${mobile?'mobile':'desktop'}.png`,animations:'disabled'});
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  const request=page.getByRole('region',{name:'요청 묶음 검토',exact:true});
  await expect(request.getByRole('article')).toHaveCount(1);
  await expect(request.getByRole('article')).toContainText('출입문 위치 조정');
  await page.getByRole('button',{name:'변경 목록 열기',exact:true}).click();
  await expect(page.locator('[data-change-item="sample-entrance"]')).toBeVisible();
  await expect(request).not.toBeVisible();
  expect(page.url()).toBe(url);
 }finally{await browser.close();}
});

test('viewer can read a location but cannot compose a location request',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&role=viewer`);
  await page.getByRole('button',{name:'수정 1 · 출입문 위치 조정',exact:true}).click();
  await expect(page.getByRole('button',{name:'이 위치 검토 요청',exact:true})).toBeDisabled({timeout:5000});
 }finally{await browser.close();}
});
