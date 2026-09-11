import {chromium,expect} from '@playwright/test';
// Original screen inventory. Rendering is necessary, not proof of full business behavior.
const pages=[['home','시작 홈'],['projects','프로젝트 목록'],['tasks','내 할 일'],['overview','프로젝트 개요'],['documents','도면·자료'],['start','새 작업 준비'],['workspace','작업실'],['quantities','수량 산출서'],['estimate','내역서'],['rates','회사 단가'],['changes','변경 관리'],['issues','이슈 목록'],['reviews','검토·승인함'],['delivery','납품·인계'],['library','회사 라이브러리'],['settings','구성원·설정'],['field','현장·검측'],['materials','자재·기성']];
const browser=await chromium.launch(); const failures=[];
try {
 for(const width of [1440,390]) {
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  for(const [id,title] of pages) {
   try {
    await page.goto(`http://127.0.0.1:4181/workspace-preview/flow?page=${id}&scenario=architecture&scope=sample`,{waitUntil:'networkidle'});
    await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();
    expect(await page.locator('.flow-body').innerText()).not.toBe('');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({path:`/tmp/1hk-inventory-${width}-${id}.png`,fullPage:true});
    console.log(`PASS ${width} ${id}: heading, content, no pageerror/overflow`);
   }catch(error){failures.push(`${width} ${id}: ${error.message}`);console.log(`FAIL ${width} ${id}`);await page.screenshot({path:`/tmp/1hk-inventory-${width}-${id}-failure.png`,fullPage:true});}
  }
  for(const [id,region] of [['documents','내 도면 목록'],['workspace','내 도면 목록'],['issues','내 도면 공식 질의'],['overview','내 도면 진행 개요'],['quantities','내 도면 수량·내역'],['estimate','내 도면 수량·내역'],['tasks','내 수량 검산 목록'],['reviews','내 수량 검산 목록'],['changes','내 도면 변경 비교'],['delivery','내 PDF 납품'],['field','내 도면 현장 기록'],['materials','내 도면 자재 관리']]){
   try{
    await page.goto(`http://127.0.0.1:4181/workspace-preview/flow?page=${id}&scope=local`,{waitUntil:'networkidle'});
    await expect(page.getByRole('region',{name:region,exact:true})).toBeVisible();
    expect(await page.locator('.flow-body').innerText()).not.toContain('A-101');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
    console.log(`PASS ${width} local ${id}: empty local scope, no sample source or overflow`);
   }catch(error){failures.push(`${width} local ${id}: ${error.message}`);console.log(`FAIL ${width} local ${id}`);}
  }
  for(const [id,title,region] of [['schedule','공정·작업 구간','도면 객체 공정표'],['submittals','제출물 검토','제출물 검토'],['transmittals','배포·수신 대장','배포·수신 대장'],['budget','예산·금액 비교','예산·승인금액 비교'],['presentation','3D 장면·발표','3D 장면·프레젠테이션'],['daily','일일 작업 보고','일일 작업 보고'],['payments','계약·기성 검토','계약·기성 검토'],['handover','준공·자산 인계','준공·자산 인계'],['carbon','탄소 근거','탄소 근거'],['standards','속성·분류 기준','속성·분류 기준']]){
   try{
    await page.goto(`http://127.0.0.1:4181/workspace-preview/flow?page=${id}&scope=local`,{waitUntil:'networkidle'});
    await expect(page.getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();await expect(page.getByRole('region',{name:region,exact:true})).toBeVisible();await expect(page.locator('.flow-heading .flow-eyebrow')).toHaveText('내 작업공간');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);await page.screenshot({path:`/tmp/1hk-inventory-${width}-${id}.png`,fullPage:true});
    console.log(`PASS ${width} added ${id}: explicit local empty state, heading, no sample identity or overflow`);
   }catch(error){failures.push(`${width} added ${id}: ${error.message}`);console.log(`FAIL ${width} added ${id}`);}
  }
  await page.close();
 }
 if(failures.length)throw new Error(failures.join('\n'));
 console.log('PASS 18 original + 10 added screens × desktop/mobile rendering inventory; business actions require separate journey verification');
}finally{await browser.close();}
