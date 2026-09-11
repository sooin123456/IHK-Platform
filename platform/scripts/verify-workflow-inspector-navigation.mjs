import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const button=name=>page.getByRole('button',{name,exact:true});
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=start',{waitUntil:'networkidle'});
 await page.getByLabel('빈 작업 이름',{exact:true}).fill('검사기 흐름');await button('빈 작업실 열기').click();
 await button('사각형 구상 도구').click();const canvas=page.getByRole('img',{name:'빈 작업 캔버스'});await canvas.focus();await page.keyboard.press('Enter');
 await page.getByLabel('구상 객체 이름',{exact:true}).fill('선택 유지');
 const nav=page.getByRole('navigation',{name:'작업실 검사기 바로가기'});await expect(nav).toBeVisible();
 await canvas.scrollIntoViewIfNeeded();const before=await canvas.boundingBox();
 await nav.getByRole('button',{name:'검토로 이동',exact:true}).click();
 await expect(page.getByRole('heading',{name:'검토',exact:true})).toBeFocused();
 await page.getByLabel('도면 검토 의견',{exact:true}).fill('입력 중 의견 유지');
 const after=await canvas.boundingBox();expect(Math.abs(before.y-after.y)).toBeLessThan(2);
 await nav.getByRole('button',{name:'속성으로 이동',exact:true}).click();await expect(page.getByLabel('구상 객체 이름',{exact:true})).toHaveValue('선택 유지');
 await nav.getByRole('button',{name:'검토로 이동',exact:true}).click();await expect(page.getByLabel('도면 검토 의견',{exact:true})).toHaveValue('입력 중 의견 유지');
 await page.setViewportSize({width:390,height:844});await nav.getByRole('button',{name:'수량으로 이동',exact:true}).click();await expect(page.getByRole('heading',{name:'수량',exact:true})).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const mobileNav=await nav.boundingBox();expect(mobileNav.y).toBeGreaterThanOrEqual(0);expect(mobileNav.y).toBeLessThan(100);
 await page.screenshot({path:'/tmp/1hk-inspector-navigation.png'});expect(errors).toEqual([]);
 console.log('PASS inspector section navigation preserves canvas position, object selection, draft note and mobile focus');
}finally{await browser.close();}
