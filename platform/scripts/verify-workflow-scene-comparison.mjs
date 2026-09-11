import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=presentation&scenario=ifc&scope=sample',{waitUntil:'networkidle'});
 const region=page.getByRole('region',{name:'3D 장면·프레젠테이션'});await expect(region.locator('canvas')).toBeVisible();
 for(const [name,section]of[['전체 검토',false],['단면 검토',true]]){await region.getByLabel('장면 이름',{exact:true}).fill(name);await region.getByLabel('장면 단면',{exact:true}).setChecked(section);await region.getByRole('button',{name:'현재 화면 이미지 준비',exact:true}).click();await region.getByRole('button',{name:'이미지를 이 브라우저에 보관',exact:true}).click();await expect(region.getByRole('img',{name:name+' 보관 이미지',exact:true})).toBeVisible();}
 const comparison=page.getByRole('region',{name:'보관 이미지 비교'});await comparison.getByLabel('비교 기준 이미지',{exact:true}).selectOption({label:'전체 검토 · 예시 R1'});await comparison.getByLabel('비교 대상 이미지',{exact:true}).selectOption({label:'단면 검토 · 예시 R1'});
 await expect(page).toHaveURL(url=>Boolean(url.searchParams.get('galleryLeft'))&&Boolean(url.searchParams.get('galleryRight')));
 const left=await comparison.getByRole('img',{name:'기준: 전체 검토',exact:true}).getAttribute('src'),right=await comparison.getByRole('img',{name:'대상: 단면 검토',exact:true}).getAttribute('src');expect(left).not.toBe(right);
 await page.reload({waitUntil:'networkidle'});await expect(comparison.getByRole('img',{name:'기준: 전체 검토',exact:true})).toHaveAttribute('src',left);await expect(comparison.getByRole('img',{name:'대상: 단면 검토',exact:true})).toHaveAttribute('src',right);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();await comparison.screenshot({path:'/tmp/1hk-scene-comparison.png'});
 await page.getByRole('button',{name:'전체 검토 보관 이미지 삭제',exact:true}).click();await page.getByRole('button',{name:'이미지 삭제 확정',exact:true}).click();await expect(comparison.getByRole('alert')).toContainText('찾을 수 없습니다');await expect(comparison.getByRole('img')).toHaveCount(0);
 await comparison.getByRole('button',{name:'이미지 비교 선택 초기화',exact:true}).click();await expect(comparison.getByRole('alert')).toHaveCount(0);await expect(comparison.getByLabel('비교 기준 이미지',{exact:true})).toHaveValue('');expect(errors).toEqual([]);
 console.log('PASS actual captured image comparison, exact reload targets, mobile, deleted-image refusal and reset');
}finally{await browser.close();}
