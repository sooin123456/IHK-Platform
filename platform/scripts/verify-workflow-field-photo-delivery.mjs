import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {PDFDocument} from 'pdf-lib';
import {createHash} from 'node:crypto';
const browser=await chromium.launch();
const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const photo={name:'field.png',mimeType:'image/png',buffer:await page.screenshot()};
 const pdf=await PDFDocument.create();pdf.addPage([800,520]);const source={name:'field.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};
 const hash=file=>createHash('sha256').update(file.buffer).digest('hex');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const {reduceDocumentReview}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-review.ts');
 const original={name:source.name,sha256:hash(source),pages:1};
 let doc={id:'photo-delivery',title:'현장 사진 인계',source:original,shapes:[{id:'wall',label:'배관',x:20,y:30}],fieldNotes:[{id:1,title:'위치 확인',note:'요청 당시 관찰',location:'2공구',condition:'changed',objectId:'wall',objectLabel:'배관',page:1,revision:1,x:20,y:30,source:original,photos:[{name:photo.name,sha256:hash(photo),size:photo.buffer.length,mime:photo.mimeType}]}]};
 doc=reduceDocumentReview(doc,'author',{type:'request',targetId:'wall',message:'현장 사진 검토',fieldNoteId:1});
 const raw=codec.encodeWorkflowSession({scenarios:Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)])),drafts:{},blankDocuments:[doc]});
 await page.addInitScript(({key,raw})=>{if(!sessionStorage.getItem(key))sessionStorage.setItem(key,raw);},{key:codec.workflowSessionKey,raw});
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=workspace&blank=photo-delivery&target=wall',{waitUntil:'networkidle'});
 await page.getByLabel('작업실 PDF 선택',{exact:true}).setInputFiles(source);
 for(const [role,action] of [['reviewer','검토 완료하기'],['approver','이 개정 승인하기']]){await page.getByLabel('도면 검토 체험 역할',{exact:true}).selectOption(role);await page.getByLabel('도면 검토 의견',{exact:true}).fill('현장 근거 확인');await page.getByRole('button',{name:action,exact:true}).click();}
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=delivery&scope=local',{waitUntil:'networkidle'});
 await page.getByLabel('현장 사진 인계 수신 대상',{exact:true}).fill('검토팀');await page.getByRole('button',{name:'납품 구성 준비',exact:true}).click();await page.getByRole('button',{name:'독립 수신 화면 열기',exact:true}).click();await expect(page).toHaveURL(/recipientDocument=/);
 const evidence=page.getByRole('region',{name:'승인 당시 현장·사진 근거'});await expect(evidence).toContainText('요청 당시 관찰');
 await page.reload({waitUntil:'networkidle'});await expect(evidence).toContainText('field.png');
 await evidence.getByLabel('field.png 사진 다시 연결',{exact:true}).setInputFiles({...photo,buffer:Buffer.concat([photo.buffer,Buffer.from('different')])});await expect(evidence.getByRole('alert')).toContainText('기록한 사진과 내용이 다릅니다');
 await evidence.getByLabel('field.png 사진 다시 연결',{exact:true}).setInputFiles(photo);await expect(evidence.getByRole('img',{name:'현장 사진 field.png'})).toBeVisible();
 await page.evaluate(key=>{const data=JSON.parse(sessionStorage.getItem(key));data.blankDocuments[0].fieldNotes[0].note='나중에 변경한 현장 기록';sessionStorage.setItem(key,JSON.stringify(data));},codec.workflowSessionKey);await page.reload({waitUntil:'networkidle'});await expect(evidence).toContainText('요청 당시 관찰');await expect(evidence).not.toContainText('나중에 변경한');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByLabel('수신자 확인 의견',{exact:true}).fill('현장 사진 근거 수신');await page.getByRole('button',{name:'수신 확인 기록 (체험)',exact:true}).click();
 const stored=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).blankDocuments[0],codec.workflowSessionKey);expect(stored.delivery.status).toBe('received');expect(stored.reviewRounds[0].fieldEvidence.note).toBe('요청 당시 관찰');expect(errors).toEqual([]);
 console.log('PASS field-photo review approval → delivery → frozen recipient evidence, reconnect, live-note independence and receipt');
}finally{await browser.close();await vite.close();}
