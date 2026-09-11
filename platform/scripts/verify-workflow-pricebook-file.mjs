import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch();try{
 const page=await browser.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=rates&scenario=architecture&scope=sample',{waitUntil:'networkidle'});
 const section=page.getByRole('region',{name:'CSV 단가표 가져오기'});await section.getByRole('button',{name:'CSV 단가표 가져오기',exact:true}).click();
 await section.getByLabel('단가 CSV 파일',{exact:true}).setInputFiles({name:'rates.csv',mimeType:'text/csv',buffer:Buffer.from('금액,설명,번호,근거,단위\n1200,"배관, 일반",P-01,견적 1쪽,m')});
 const mapping=section.getByRole('region',{name:'CSV 열 연결'});await expect(mapping).toContainText('rates.csv');
 for(const [label,value] of [['코드','2'],['품목명','1'],['단위','4'],['단가','0'],['출처','3']])await mapping.getByLabel(`${label} 열`,{exact:true}).selectOption(value);
 await mapping.getByLabel('출처 열',{exact:true}).selectOption('0');await expect(mapping.getByRole('button',{name:'열 연결 적용',exact:true})).toBeDisabled();await mapping.getByLabel('출처 열',{exact:true}).selectOption('3');
 await page.setViewportSize({width:390,height:844});await mapping.screenshot({path:'/tmp/1hk-pricebook-mapping.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await mapping.getByRole('button',{name:'열 연결 적용',exact:true}).click();await section.getByRole('button',{name:'가져오기 미리보기',exact:true}).click();await expect(section.getByRole('region',{name:'단가 가져오기 미리보기'})).toContainText('배관, 일반');
 await section.getByRole('button',{name:'전체 새 버전 보관',exact:true}).click();await page.reload();await expect(page.getByRole('region',{name:'단가표 버전 관리'})).toContainText('배관, 일반 · P-01 · v1');
 await section.getByRole('button',{name:'CSV 단가표 가져오기',exact:true}).click();await section.getByLabel('단가 CSV 파일',{exact:true}).setInputFiles({name:'rates.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('bad')});await expect(section.getByRole('alert')).toContainText('UTF-8 CSV');
 await section.getByLabel('단가 CSV 파일',{exact:true}).setInputFiles({name:'broken.csv',mimeType:'text/csv',buffer:Buffer.from('a,b\n"broken')});await expect(section.getByRole('alert')).toContainText('따옴표');
 await page.setViewportSize({width:390,height:844});await section.screenshot({path:'/tmp/1hk-pricebook-file.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);console.log('PASS CSV file mapping, quoted field, explicit import/reload, unsupported/corrupt file, mobile');
}finally{await browser.close();}
