import {chromium,expect} from '@playwright/test';import {createServer} from 'vite';
const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts'),{createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts'),{reduceDocumentReview}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-review.ts'),{addDocumentFieldNote}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-field.ts'),{recordInspection}=await vite.ssrLoadModule('/app/lukas/lib/workflow-inspections.ts');
let doc={id:'asset',title:'준공 인계도',source:{name:'asset.pdf',sha256:'a'.repeat(64),pages:1},shapes:[{id:'pump',label:'급수 펌프',x:10,y:20}]};
for(const [role,type]of[['author','request'],['reviewer','review'],['approver','approve']])doc=reduceDocumentReview(doc,role,{type,targetId:'pump',message:'도면 확인'});
doc=addDocumentFieldNote(doc,'pump','author',{title:'펌프 점검',note:'설치 확인',location:'기계실',condition:'conforming'});doc=recordInspection(doc,1,'reviewer','inspect',{note:'점검 종결',checks:['pass','pass','na']});
const raw=codec.encodeWorkflowSession({scenarios:Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)])),drafts:{},blankDocuments:[doc]});await vite.close();
const browser=await chromium.launch();try{
 const page=await browser.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(({key,raw})=>{if(!sessionStorage.getItem(key))sessionStorage.setItem(key,raw);},{key:codec.workflowSessionKey,raw});
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=delivery&scope=local',{waitUntil:'networkidle'});await page.getByRole('navigation',{name:'납품 세부 화면'}).getByRole('button',{name:'준공·자산 인계',exact:true}).click();
 const panel=page.getByRole('region',{name:'준공·자산 인계',exact:true});await expect(panel.getByRole('button',{name:'인계본 준비',exact:true})).toBeDisabled();
 for(const [label,value] of [['자산번호','P-01'],['자산명','급수 펌프'],['설치 위치','기계실'],['제조사','제조사 예시'],['모델명','M-10'],['참고문서 표기','운전 매뉴얼 v1']])await panel.getByLabel(label,{exact:true}).fill(value);
 await page.reload({waitUntil:'networkidle'});await expect(panel.getByLabel('참고문서 표기',{exact:true})).toHaveValue('운전 매뉴얼 v1');await panel.getByRole('button',{name:'자산 정보 보관',exact:true}).click();await expect(panel).toContainText('등록 자산 1개');
 await panel.getByLabel('인계 대상',{exact:true}).fill('시설관리팀');await panel.getByRole('button',{name:'인계본 준비',exact:true}).click();await expect(panel.getByRole('heading',{name:'인계본 #1 · R1',exact:true})).toBeVisible();
 await panel.getByLabel('인계 처리 역할',{exact:true}).selectOption('recipient');await panel.getByLabel('인계본 #1 수신 의견',{exact:true}).fill('매뉴얼 버전을 보완해주세요');await panel.getByRole('button',{name:'인계본 #1 보완 요청',exact:true}).click();
 await panel.getByLabel('인계 처리 역할',{exact:true}).selectOption('author');await panel.getByLabel('참고문서 표기',{exact:true}).fill('운전 매뉴얼 v2');await panel.getByRole('button',{name:'자산 정보 보관',exact:true}).click();await panel.getByRole('button',{name:'인계본 #1 보완 준비',exact:true}).click();await panel.getByRole('button',{name:'보완 인계본 준비',exact:true}).click();
 await panel.getByLabel('인계 처리 역할',{exact:true}).selectOption('recipient');await panel.getByLabel('인계본 #2 수신 의견',{exact:true}).fill('보완 자료 확인');
 const packageTwo=panel.getByRole('article').filter({has:page.getByRole('heading',{name:'인계본 #2 · R1',exact:true})});
 await packageTwo.getByText('인계 당시 자산·점검 목록',{exact:true}).click();
 await panel.getByRole('button',{name:'인계본 #2 P-01 승인 위치',exact:true}).click();await expect(page).toHaveURL(/snapshot=1/);await expect(page).toHaveURL(/target=pump/);await page.getByRole('button',{name:'준공 인계로 돌아가기',exact:true}).click();await expect(panel.getByLabel('인계본 #2 수신 의견',{exact:true})).toHaveValue('보완 자료 확인');await panel.getByRole('button',{name:'인계본 #2 수신 확인',exact:true}).click();
 await page.reload({waitUntil:'networkidle'});await expect(panel).toContainText('보완 자료 확인');
 const saved=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).blankDocuments[0],codec.workflowSessionKey);expect(saved.handovers[0].assets[0].manual).toBe('운전 매뉴얼 v1');expect(saved.handovers[1].assets[0].manual).toBe('운전 매뉴얼 v2');expect(saved.handovers[1].phase).toBe('received');
 await panel.getByLabel('인계 처리 역할',{exact:true}).selectOption('viewer');await expect(panel.getByLabel('참고문서 표기',{exact:true})).toHaveCount(0);await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await panel.screenshot({path:'/tmp/1hk-handover.png'});expect(errors).toEqual([]);
 console.log('PASS asset register, approved readiness, frozen handover correction/receipt, exact source return, drafts/reload/mobile');
}finally{await browser.close();}
