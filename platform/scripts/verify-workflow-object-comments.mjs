import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch();
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const button=name=>page.getByRole('button',{name,exact:true});
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=start',{waitUntil:'networkidle'});
 await page.getByLabel('빈 작업 이름',{exact:true}).fill('댓글 검증 도면');await button('빈 작업실 열기').click();await expect(page).toHaveURL(/blank=/);
 await button('사각형 구상 도구').click();await page.getByRole('img',{name:'빈 작업 캔버스'}).focus();await page.keyboard.press('Enter');
 await page.getByLabel('객체 댓글 입력',{exact:true}).fill('출입구 폭 확인 바랍니다');await button('댓글 보관').click();
 await expect(page.getByRole('region',{name:'선택 객체 댓글'})).toContainText('출입구 폭 확인 바랍니다');
 const doc=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('1hk:workflow-preview:session:v1')).blankDocuments.find(doc=>doc.title==='댓글 검증 도면'));
 await page.reload();await page.getByLabel('선택할 객체',{exact:true}).selectOption(doc.shapes[0].id);await expect(page.getByRole('region',{name:'선택 객체 댓글'})).toContainText('출입구 폭 확인 바랍니다');
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=issues&scope=local');
 const inbox=page.getByRole('region',{name:'내 도면 객체 댓글'});await expect(inbox).toContainText('출입구 폭 확인 바랍니다');
 await page.getByLabel('객체 댓글 검색',{exact:true}).fill('없는 검색어');await expect(inbox.getByRole('button',{name:'댓글 #1 대상 열기'})).toHaveCount(0);
 await button('댓글 검색 초기화').click();await page.getByLabel('객체 댓글 검색',{exact:true}).fill('출입구');
 await button('댓글 #1 대상 열기').click();await expect(page).toHaveURL(new RegExp(`blank=${doc.id}`));await expect(page.getByLabel('선택할 객체',{exact:true})).toHaveValue(doc.shapes[0].id);
 await button('댓글 목록으로 돌아가기').click();await expect(page).toHaveURL(/page=issues/);await expect(page.getByLabel('객체 댓글 검색',{exact:true})).toHaveValue('출입구');
 await page.reload();await expect(page.getByLabel('객체 댓글 검색',{exact:true})).toHaveValue('출입구');
 await page.goto(`http://127.0.0.1:4181/workspace-preview/flow?page=workspace&blank=${doc.id}&target=${doc.shapes[0].id}&localRole=viewer`);
 await expect(page.getByLabel('객체 댓글 입력',{exact:true})).toBeDisabled();await expect(button('댓글 보관')).toBeDisabled();
 await page.evaluate(id=>{const key='1hk:workflow-preview:session:v1';const session=JSON.parse(sessionStorage.getItem(key));session.blankDocuments.find(doc=>doc.id===id).shapes[0].x+=5;sessionStorage.setItem(key,JSON.stringify(session));},doc.id);
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=issues&scope=local');await expect(button('댓글 #1 대상 열기')).toBeDisabled();
 await expect(inbox).toContainText('재확인 필요');await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await inbox.screenshot({path:'/tmp/1hk-object-comments.png'});expect(errors).toEqual([]);console.log('PASS object comments: persistence, search return, exact target, viewer, stale target and mobile');
} finally {await browser.close();}
