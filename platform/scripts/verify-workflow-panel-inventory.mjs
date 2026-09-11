import {chromium,expect} from '@playwright/test';
const cases=[['start','단위·축척 확인','축척·단위'],['documents','원본 형식·호환성 확인','파일 호환성'],['workspace','속성·레이어','객체 속성·레이어'],['workspace','모델 구조·근거','모델 구조·단면'],['workspace','산출 근거 확인','산출식·보정 근거'],['rates','가져오기·연결','품목·단가 연결'],['workspace','변경 전후 비교','변경 전후 비교'],['workspace','검토 요청','검토 요청'],['workspace','확인할 항목·AI','확인할 항목·AI'],['workspace','외부 검토 공유','공유·초대']];
const browser=await chromium.launch();
try {
 for(const width of [1440,390]) {
  const page=await browser.newPage({viewport:{width,height:1000}}); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const button=name=>page.getByRole('button',{name,exact:true});
  const check=async title=>{
   const dialog=page.getByRole('dialog');
   await expect(dialog.getByRole('heading',{name:title,exact:true})).toBeVisible();
   expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
   await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
   console.log(`PASS ${width} panel ${title}: rendered, no internal overflow, Escape closes`);
  };
  for(const [route,action,title] of cases){
   await page.goto(`http://127.0.0.1:4181/workspace-preview/flow?page=${route}&scenario=ifc&scope=sample`,{waitUntil:'networkidle'});
   await button(action).click();await check(title);
  }
  await button('산출 근거 확인').click();
  await button('산출 결과 확인 체험').click();
  await button('현재 화면으로 돌아가기').click();
  await button('검토 요청').click();
  await page.getByLabel('검토 요청 내용',{exact:true}).fill('패널 종단간 검토 요청');
  await button('검토 요청 체험').click();
  await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=reviews&scenario=ifc&scope=sample',{waitUntil:'networkidle'});
  await button('대상 확인·의견').click();await check('의견·수정 요청');
  await button('승인 상태 확인').click();await check('승인·새 개정');
  expect(errors).toEqual([]);await page.close();
 }
 console.log('PASS original 12-panel × desktop/mobile presentation inventory; individual action coverage remains in scenario tests');
}finally{await browser.close();}
