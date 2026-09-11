import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');const {setDocumentQuantity}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts');
let doc={id:'boq',title:'배관 도면',source:{name:'basis.pdf',sha256:'a'.repeat(64),pages:2},shapes:[{id:'a',label:'1층 배관',x:10,y:10,page:1},{id:'b',label:'2층 배관',x:40,y:10,page:2}]};
for(const id of ['a','b'])doc=setDocumentQuantity(doc,id,{raw:id==='a'?2:3,correction:0,unit:'m',rate:100,reason:'시연',rateSource:{code:'P-01',name:'배관 항목',source:'시연 기준',version:1,unit:'m',rate:100}});
doc={...doc,shapes:[...doc.shapes,{id:'c',label:'별도 직접 입력',x:80,y:10,page:1}]};doc=setDocumentQuantity(doc,'c',{raw:7,correction:0,unit:'m',rate:200,reason:'별도 시연'});
const raw=codec.encodeWorkflowSession({scenarios:Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)])),drafts:{},blankDocuments:[doc]});await vite.close();
const browser=await chromium.launch();try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(({key,raw})=>{if(!sessionStorage.getItem(key))sessionStorage.setItem(key,raw);},{key:codec.workflowSessionKey,raw});
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=estimate&scope=local',{waitUntil:'networkidle'});
 const groups=page.getByRole('region',{name:'항목별 내역 집계'});await expect(groups).toContainText('500원');await expect(groups).toContainText('5 m');await expect(groups).toContainText('P-01');
 await groups.getByLabel('내역 묶음 검색',{exact:true}).fill('없는 코드');await expect(groups).toContainText('검색 결과가 없습니다');await expect(groups.getByRole('article')).toHaveCount(0);
 await groups.getByLabel('내역 묶음 검색',{exact:true}).fill('P-01');await expect(groups.getByRole('article')).toHaveCount(1);await expect(page).toHaveURL(/boqQuery=P-01/);
 await expect(groups).toContainText('미확정 합계 1,900원');await expect(groups.getByRole('status')).toContainText('표시 소계 500원');
 await groups.getByText('연결 객체 2건',{exact:true}).click();await groups.getByRole('button',{name:'배관 도면 · 2층 배관 · 2쪽 근거',exact:true}).click();await expect(page).toHaveURL(/target=b/);await expect(page.getByLabel('선택할 객체',{exact:true})).toHaveValue('b');
 await page.getByRole('button',{name:'내 수량·내역 보기',exact:true}).click();await expect(page).toHaveURL(/page=estimate/);await expect(groups).toContainText('500원');
 await expect(groups.getByLabel('내역 묶음 검색',{exact:true})).toHaveValue('P-01');await expect(groups.getByRole('button',{name:'배관 도면 · 2층 배관 · 2쪽 근거',exact:true})).toBeVisible();await page.reload();await expect(groups.getByRole('button',{name:'배관 도면 · 2층 배관 · 2쪽 근거',exact:true})).toBeVisible();await expect(groups.getByLabel('내역 묶음 검색',{exact:true})).toHaveValue('P-01');
 await page.setViewportSize({width:390,height:844});await groups.screenshot({path:'/tmp/1hk-boq-groups.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const missing=new URL(page.url());missing.searchParams.set('boqGroup','missing');await page.goto(missing.toString());await expect(groups).toContainText('이전에 펼친 묶음이 변경되었거나 집계에서 제외되었습니다');await expect(groups.getByRole('button',{name:'배관 도면 · 2층 배관 · 2쪽 근거',exact:true})).not.toBeVisible();
 await groups.getByRole('button',{name:'내역 검색 초기화',exact:true}).click();await expect(groups.getByRole('article')).toHaveCount(2);expect(errors).toEqual([]);console.log('PASS grouped BOQ totals, search/empty/reset, expanded exact-object return/reload, missing group and mobile');
}finally{await browser.close();}
