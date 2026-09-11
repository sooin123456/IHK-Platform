import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
test.after(() => vite.close());
test('drawing review freezes field record photo evidence and rejects stale or mismatched requests',async()=>{
 const {reduceDocumentReview}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-review.ts');
 const source={name:'a.pdf',sha256:'a'.repeat(64),pages:1};
 const field={id:1,title:'확인',note:'현장 관찰',location:'1동',condition:'changed',objectId:'a',objectLabel:'벽',page:1,revision:1,x:10,y:20,source,photos:[{name:'site.png',sha256:'b'.repeat(64),size:100,mime:'image/png'}]};
 const doc={id:'d',title:'도면',source,shapes:[{id:'a',label:'벽',x:10,y:20}],fieldNotes:[field]};
 const action={type:'request',targetId:'a',message:'사진 확인',fieldNoteId:1};
 const next=reduceDocumentReview(doc,'author',action);
 assert.deepEqual(next.reviewRounds[0].fieldEvidence,field);
 field.photos[0].name='changed.png';assert.equal(next.reviewRounds[0].fieldEvidence.photos[0].name,'site.png');
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const raw=codec.encodeWorkflowSession({scenarios:Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)])),drafts:{},blankDocuments:[next]});
 assert.equal(codec.decodeWorkflowSession(raw).blankDocuments[0].reviewRounds[0].fieldEvidence.photos[0].name,'site.png');
 const invalid=JSON.parse(raw);invalid.blankDocuments[0].reviewRounds[0].fieldEvidence.objectId='wrong';assert.equal(codec.decodeWorkflowSession(JSON.stringify(invalid)),null);
 assert.equal(reduceDocumentReview(doc,'author',{...action,fieldNoteId:9}),doc);
 const moved={...doc,shapes:[{...doc.shapes[0],x:11}]};assert.equal(reduceDocumentReview(moved,'author',action),moved);
});
test('field photo references preserve metadata but reject unsupported or oversized originals',async()=>{
 const {fieldPhotoSchema}=await vite.ssrLoadModule('/app/lukas/lib/workflow-field-photo.ts');
 const photo={name:'site.png',sha256:'a'.repeat(64),size:100,mime:'image/png'};
 assert.deepEqual(fieldPhotoSchema.parse(photo),photo);
 assert.equal(fieldPhotoSchema.safeParse({...photo,mime:'image/svg+xml'}).success,false);
 assert.equal(fieldPhotoSchema.safeParse({...photo,size:11*1024*1024}).success,false);
 assert.equal(fieldPhotoSchema.safeParse({...photo,sha256:'bad'}).success,false);
});
test('structured field locations preserve building and civil hierarchy',async()=>{
 const {fieldLocationSchema,formatFieldLocation,documentFieldNoteSchema}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-field.ts');
 const building={kind:'building',building:'1동',floor:'B1',room:'기계실'};
 const civil={kind:'civil',route:'A노선',section:'2공구',station:'STA 0+200'};
 assert.deepEqual(fieldLocationSchema.parse(building),building);
 assert.equal(formatFieldLocation(civil),'A노선 / 2공구 / STA 0+200');
 assert.equal(fieldLocationSchema.safeParse({...civil,section:''}).success,false);
 const record={id:1,title:'확인',note:'관찰',location:formatFieldLocation(building),locationPath:building,condition:'needs-check',objectId:'a',objectLabel:'벽',page:1,revision:1,x:0,y:0,source:{name:'a.pdf',sha256:'a'.repeat(64),pages:1}};
 assert.deepEqual(documentFieldNoteSchema.parse(record).locationPath,building);
 assert.equal(documentFieldNoteSchema.safeParse({...record,location:'다른 위치'}).success,false);
});
test('local field observations bind the selected object and preserve original context',async()=>{
 const {addDocumentFieldNote,fieldNoteMatches}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-field.ts');
 const doc={id:'d',title:'현장',source:{name:'a.pdf',sha256:'a'.repeat(64),pages:2},shapes:[{id:'a',label:'벽',x:30,y:40,page:2}]};
 const input={title:'위치 확인',note:'현장 위치 차이',location:'1동 2층',condition:'changed'};
 const next=addDocumentFieldNote(doc,'a','reviewer',input);
 assert.equal(next.fieldNotes[0].objectId,'a');assert.equal(next.fieldNotes[0].page,2);assert.equal(next.fieldNotes[0].source.sha256,'a'.repeat(64));
 assert.equal(fieldNoteMatches(next,next.fieldNotes[0]),true);
 assert.equal(fieldNoteMatches({...next,shapes:[]},next.fieldNotes[0]),false);
 assert.equal(fieldNoteMatches({...next,shapes:[{...doc.shapes[0],x:90}]},next.fieldNotes[0]),false);
 assert.equal(addDocumentFieldNote(doc,'a','viewer',input),doc);
 assert.equal(addDocumentFieldNote(doc,'missing','author',input),doc);
 assert.equal(addDocumentFieldNote(doc,'a','author',{...input,note:''}),doc);
});
test('measured quantity preserves evidence and rejects wrong page, raw quantity or unit',async()=>{
 const {setDocumentQuantity,documentQuantityRow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts');
 const source={name:'a.pdf',sha256:'a'.repeat(64),pages:2};
 const evidence={id:1,source,page:1,revision:1,kind:'distance',reference:[{x:0,y:0},{x:.5,y:0}],target:[{x:0,y:0},{x:.25,y:0}],length:10,aspect:2};
 const doc={id:'d',title:'측정 연결',source,shapes:[{id:'s',label:'벽',x:10,y:20}],measurements:[evidence]};
 const input={raw:5,correction:1,unit:'m',rate:100,reason:'측정 검토',measurementSource:evidence};
 const next=setDocumentQuantity(doc,'s',input);
 assert.deepEqual(next.shapes[0].quantity.measurementSource,evidence);
 assert.equal(documentQuantityRow({...next,revision:2},next.shapes[0]).stale,true);
 assert.equal(setDocumentQuantity(doc,'s',{...input,raw:6}),doc);
 assert.equal(setDocumentQuantity(doc,'s',{...input,unit:'m²'}),doc);
 assert.equal(setDocumentQuantity(doc,'s',{...input,measurementSource:{...evidence,page:2}}),doc);
});
test('measurement records survive session restore and malformed calibration is rejected',async()=>{
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const source={name:'measure.pdf',sha256:'a'.repeat(64),pages:2};
 const record={id:1,source,page:1,revision:1,kind:'distance',reference:[{x:0,y:0},{x:.5,y:0}],target:[{x:0,y:0},{x:0,y:.5}],length:10,aspect:2};
 const data={scenarios:Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)])),drafts:{},blankDocuments:[{id:'m',title:'측정',source,shapes:[],measurements:[record]}]};
 const raw=codec.encodeWorkflowSession(data);
 assert.deepEqual(JSON.parse(raw).blankDocuments[0].measurements,[record]);
 assert.deepEqual(codec.decodeWorkflowSession(raw).blankDocuments[0].measurements,[record]);
 const invalid=JSON.parse(raw);invalid.blankDocuments[0].measurements[0].length=0;
 assert.equal(codec.decodeWorkflowSession(JSON.stringify(invalid)),null);
 const wrongPage=JSON.parse(raw);wrongPage.blankDocuments[0].measurements[0].page=3;
 assert.equal(codec.decodeWorkflowSession(JSON.stringify(wrongPage)),null);
});
test('output manifest uses the delivered approval rather than current work and blocks missing evidence',async()=>{
 const {WorkflowOutputPreparation}=await vite.ssrLoadModule('/app/lukas/components/workflow-output-preparation.tsx');
 const source={name:'approved.pdf',sha256:'a'.repeat(64),pages:2};
 const document={id:'d',title:'출력',revision:2,source:{...source,name:'current.pdf'},shapes:[],reviewRounds:[{revision:1,source,objects:[{id:'a',x:0,y:0,label:'승인 객체'}],targetId:'a',phase:'approved',message:'확인'}]};
 const delivery={sequence:1,revision:1,recipient:'수신자',status:'prepared'};
 const render=d=>renderToStaticMarkup(React.createElement(WorkflowOutputPreparation,{document,delivery:d}));
 const valid=render(delivery);assert.match(valid,/approved.pdf/);assert.doesNotMatch(valid,/current.pdf/);assert.match(valid,/수량·내역 표 미포함/);assert.match(valid,/출력 준비 체험/);
 for(const invalid of [{...delivery,revision:99},{...delivery,quantityReviewSequence:99}]){
  const html=render(invalid);assert.match(html,/role="alert"/);assert.doesNotMatch(html,/출력 준비 체험/);
 }
});
test('drawing overlay compares frozen geometry by ID and refuses unrelated originals',async()=>{
 const {compareDrawingObjects}=await vite.ssrLoadModule('/app/lukas/lib/workflow-drawing-comparison.ts');
 const source={name:'a.pdf',sha256:'a'.repeat(64),pages:2};const a={id:'a',x:10,y:20,label:'벽',page:1};const b={id:'b',x:30,y:40,label:'삭제',page:2};
 const doc={id:'d',title:'도면',source,revision:2,shapes:[{...a,x:50},{id:'c',x:100,y:100,label:'추가'}],reviewRounds:[{revision:1,source,objects:[a,b],targetId:'a',message:'승인',phase:'approved'}]};
 const result=compareDrawingObjects(doc,1);
 assert.deepEqual(result.rows.map(row=>[row.id,row.kind]),[['a','changed'],['b','removed'],['c','added']]);
 assert.equal(result.rows[0].before.x,10);assert.equal(result.rows[0].after.x,50);assert.equal(a.x,10);
 assert.equal(compareDrawingObjects({...doc,source:{...source,sha256:'b'.repeat(64)}},1).compatible,false);
 assert.equal(compareDrawingObjects(doc,99),null);
 assert.equal(compareDrawingObjects({...doc,shapes:[{...a,width:120,height:80,rotation:0}]},1).rows[0].kind,'same');
});
test('local quantity comparison preserves approved values and withholds stale or incompatible deltas',async()=>{
 const {compareDocumentQuantities}=await vite.ssrLoadModule('/app/lukas/lib/workflow-quantity-comparison.ts');
 const q=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts');const qr=await vite.ssrLoadModule('/app/lukas/lib/workflow-quantity-review.ts');
 let doc=q.setDocumentQuantity({id:'d',title:'비교',source:{name:'a.pdf',sha256:'a'.repeat(64),pages:1},shapes:[{id:'s',label:'바닥',x:10,y:20}]},'s',{raw:10,correction:0,unit:'m²',rate:45000,reason:'근거'});
 for(const [role,type] of [['author','request'],['reviewer','review'],['approver','approve']])doc=qr.reduceQuantityReview(doc,role,{type,message:'확인'});
 const next=q.setDocumentQuantity(doc,'s',{raw:12,correction:0,unit:'m²',rate:45000,reason:'수정 근거'});
 const result=compareDocumentQuantities(next,1);assert.equal(result.delta,90000);assert.equal(result.rows[0].beforeAmount,450000);assert.equal(result.rows[0].afterAmount,540000);assert.equal(result.rows[0].kind,'changed');
 assert.equal(compareDocumentQuantities({...next,shapes:[]},1).delta,-450000);
 assert.equal(compareDocumentQuantities({...next,shapes:[{...next.shapes[0],x:50}]},1).delta,null);
 assert.equal(compareDocumentQuantities({...next,source:{...next.source,sha256:'b'.repeat(64)}},1).compatible,false);
 assert.equal(compareDocumentQuantities(next,99),null);
 assert.equal(doc.quantityReviews[0].items[0].quantity.raw,10);
 let twice=next;for(const [role,type] of [['author','request'],['reviewer','review'],['approver','approve']])twice=qr.reduceQuantityReview(twice,role,{type,message:'두번째'});
 const edited={...twice,shapes:[{...twice.shapes[0],x:80}]};
 assert.equal(compareDocumentQuantities(edited,1,2).delta,90000);
 assert.equal(compareDocumentQuantities(edited,2,1).delta,-90000);
 assert.equal(compareDocumentQuantities(edited,1,1).delta,0);
 assert.equal(compareDocumentQuantities(edited,1,99),null);
 const {WorkflowQuantityComparison}=await vite.ssrLoadModule('/app/lukas/components/workflow-quantity-comparison.tsx');
 const render=value=>renderToStaticMarkup(React.createElement(WorkflowQuantityComparison,{document:value,onOpen:()=>{}}));
 assert.match(render(next),/현재 도면 근거 열기/);
 assert.doesNotMatch(render({...next,shapes:[]}),/현재 도면 근거 열기/);
 assert.match(render({...next,shapes:[]}),/현재 객체 없음/);
 const frozen={...next,reviewRounds:[{revision:1,source:doc.source,objects:doc.shapes,targetId:'s',message:'확인',phase:'approved'}]};
 assert.match(render(frozen),/이전 승인 도면 근거 열기/);
 assert.doesNotMatch(render(next),/이전 승인 도면 근거 열기/);
});
test('quantity inbox separates pending requests from approved history and flags changed evidence',async()=>{
 const {WorkflowQuantityInbox}=await vite.ssrLoadModule('/app/lukas/components/workflow-quantity-inbox.tsx');
 const q=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts');const qr=await vite.ssrLoadModule('/app/lukas/lib/workflow-quantity-review.ts');
 let doc=q.setDocumentQuantity({id:'q',title:'검산 문서',source:{name:'a.pdf',sha256:'a'.repeat(64),pages:1},shapes:[{id:'s',x:10,y:20,label:'바닥'}]},'s',{raw:10,correction:0,unit:'m²',rate:45000,reason:'근거'});
 doc=qr.reduceQuantityReview(doc,'author',{type:'request',message:'면적 검산 요청'});
 const render=(value,mode='tasks')=>renderToStaticMarkup(React.createElement(WorkflowQuantityInbox,{documents:[value],mode,onOpen:()=>{}}));
 assert.match(render(doc),/면적 검산 요청/);assert.match(render(doc),/검산 대상 열기/);assert.match(render(doc),/450,000/);
 assert.match(render({...doc,shapes:[{...doc.shapes[0],x:30}]}),/요청 후 근거 변경/);
 doc=qr.reduceQuantityReview(doc,'reviewer',{type:'review',message:'확인'});doc=qr.reduceQuantityReview(doc,'approver',{type:'approve',message:'승인'});
 assert.doesNotMatch(render(doc),/검산 대상 열기/);assert.match(render(doc,'reviews'),/금액 승인 완료/);
});
test('local findings use exact source and object evidence and resolve when quantity is linked',async()=>{
 const {localDocumentFindings}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-findings.ts');
 const {setDocumentQuantity}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts');
 const empty={id:'d',title:'직접 도면',shapes:[]};
 assert.deepEqual(localDocumentFindings(empty).map(x=>x.kind),['source']);
 const doc={...empty,source:{name:'a.pdf',sha256:'a'.repeat(64),pages:2},shapes:[{id:'exact',label:'바닥',page:2,x:10,y:20}]};
 assert.deepEqual(localDocumentFindings(doc).map(x=>[x.kind,x.objectId,x.page]),[['quantity-missing','exact',2]]);
 const linked=setDocumentQuantity(doc,'exact',{raw:10,correction:0,unit:'m²',rate:45000,reason:'면적표'});
 assert.deepEqual(localDocumentFindings(linked).map(x=>x.kind),['quantity-review']);
 const moved={...linked,shapes:[{...linked.shapes[0],x:30}]};
 assert.deepEqual(localDocumentFindings(moved).map(x=>x.kind),['quantity-stale']);
 assert.equal(localDocumentFindings(moved)[0].objectId,'exact');
 assert.deepEqual(doc.shapes[0],{id:'exact',label:'바닥',page:2,x:10,y:20});
});
test('delivery pins only quantity approvals matching its frozen drawing revision',async()=>{
 const q=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts');const qr=await vite.ssrLoadModule('/app/lukas/lib/workflow-quantity-review.ts');
 const delivery=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-delivery.ts');
 const source={name:'a.pdf',sha256:'a'.repeat(64),pages:1};let doc=q.setDocumentQuantity({id:'d',title:'납품',source,shapes:[{id:'s1',x:10,y:20,label:'바닥'}]},'s1',{raw:10,correction:0,unit:'m²',rate:45000,reason:'면적표'});
 doc=qr.reduceQuantityReview(doc,'author',{type:'request',message:'검산'});doc=qr.reduceQuantityReview(doc,'reviewer',{type:'review',message:'확인'});doc=qr.reduceQuantityReview(doc,'approver',{type:'approve',message:'승인'});
 doc={...doc,reviewRounds:[{revision:1,source,objects:doc.shapes,targetId:'s1',message:'도면',phase:'approved'}]};
 const prepared=delivery.reduceDocumentDelivery(doc,{type:'prepare',revision:1,recipient:'발주처',quantityReviewSequence:1});
 assert.equal(prepared.delivery.quantityReviewSequence,1);
 assert.equal(delivery.reduceDocumentDelivery(doc,{type:'prepare',revision:1,recipient:'발주처',quantityReviewSequence:2}),doc);
 const mismatch={...doc,quantityReviews:[{...doc.quantityReviews[0],revision:2}]};assert.equal(delivery.reduceDocumentDelivery(mismatch,{type:'prepare',revision:1,recipient:'발주처',quantityReviewSequence:1}),mismatch);
 const changed={...prepared,revision:2,shapes:[{...doc.shapes[0],quantity:{...doc.shapes[0].quantity,raw:12}}]};
 assert.equal(delivery.deliveryQuantityReview(changed,1,1).items[0].quantity.raw,10);
 const {WorkflowDocumentRecipient}=await vite.ssrLoadModule('/app/lukas/components/workflow-document-recipient.tsx');
 const renderRecipient=value=>renderToStaticMarkup(React.createElement(WorkflowDocumentRecipient,{document:value,sequence:'1',loading:false,onChange:()=>{},onBack:()=>{}}));
 assert.match(renderRecipient(changed),/450,000/);
 assert.doesNotMatch(renderRecipient(changed),/540,000/);
 assert.doesNotMatch(renderRecipient({...changed,delivery:{...changed.delivery,quantityReviewSequence:2}}),/450,000|수신자 확인 의견/);
 const {WorkflowDocumentDeliveries}=await vite.ssrLoadModule('/app/lukas/components/workflow-document-delivery.tsx');
 assert.match(renderToStaticMarkup(React.createElement(WorkflowDocumentDeliveries,{documents:[changed],onChange:()=>{},onOpen:()=>{},onRecipient:()=>{}})),/포함할 검산 결과/);
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');const scenarios=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 assert.equal(codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios,drafts:{},blankDocuments:[changed]})).blankDocuments[0].delivery.quantityReviewSequence,1);
 assert.equal(codec.decodeWorkflowSession(JSON.stringify({version:1,scenarios,drafts:{},blankDocuments:[{...changed,delivery:{...changed.delivery,quantityReviewSequence:2}}]})),null);
});
test('session writer never emits an autosave that its reader refuses by size',async()=>{
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const scenarios=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 const large={scenarios,drafts:Object.fromEntries(Array.from({length:4500},(_,i)=>[`note${i}`,'x'.repeat(500)]))};
 assert.throws(()=>codec.encodeWorkflowSession(large),/size|크기|한도/i);
 const backup=codec.encodeWorkflowSession(large,20_000_000);
 assert.equal(codec.decodeWorkflowSession(backup),null);
 assert.equal(Object.keys(codec.decodeWorkflowSession(backup,20_000_000).drafts).length,4500);
});
test('quantity review is separate from drawing review and refuses approval after evidence changes',async()=>{
 const q=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts');
 const source={name:'a.pdf',sha256:'a'.repeat(64),pages:1};
 const doc=q.setDocumentQuantity({id:'q',title:'검산',source,shapes:[{id:'s1',x:10,y:20,label:'바닥'}]},'s1',{raw:10,correction:0,unit:'m²',rate:45000,reason:'면적표'});
 const round={sequence:1,revision:1,source,items:[{id:'s1',label:'바닥',page:1,quantity:doc.shapes[0].quantity}],excludedCount:0,phase:'requested',requestNote:'검산 요청'};
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const scenarios=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 const restored=codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios,drafts:{},blankDocuments:[{...doc,quantityReviews:[round]}]}));
 assert.deepEqual(restored.blankDocuments[0].quantityReviews,[round]);
 const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-quantity-review.ts');
 const requested=m.reduceQuantityReview(doc,'author',{type:'request',message:'검산 요청'});
 assert.equal(requested.quantityReviews[0].phase,'requested');assert.equal(requested.reviewRounds,undefined);
 assert.equal(m.reduceQuantityReview(requested,'author',{type:'approve',message:'우회'}),requested);
 const reviewed=m.reduceQuantityReview(requested,'reviewer',{type:'review',message:'수량 확인'});
 assert.equal(reviewed.quantityReviews[0].phase,'reviewed');
 const changed=q.setDocumentQuantity(reviewed,'s1',{raw:12,correction:0,unit:'m²',rate:45000,reason:'수량 보완'});
 assert.equal(m.reduceQuantityReview(changed,'approver',{type:'approve',message:'승인'}),changed);
 const approved=m.reduceQuantityReview(reviewed,'approver',{type:'approve',message:'금액 확인'});
 assert.equal(approved.quantityReviews[0].phase,'approved');assert.equal(approved.quantityReviews[0].items[0].quantity.raw,10);
 const newRequest=m.reduceQuantityReview(changed,'author',{type:'request',message:'변경 후 재검산'});
 assert.equal(newRequest.quantityReviews.length,2);assert.equal(newRequest.quantityReviews[0].items[0].quantity.raw,10);assert.equal(newRequest.quantityReviews[1].items[0].quantity.raw,12);
 const stale={...doc,shapes:[{...doc.shapes[0],x:30}]};assert.equal(m.reduceQuantityReview(stale,'author',{type:'request',message:'검산'}),stale);
 assert.equal(m.reduceQuantityReview(doc,'viewer',{type:'request',message:'검산'}),doc);
});
test('multi-object edits preserve relative placement and refuse partial locked changes',async()=>{
 const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-blank-document.ts');
 const doc={id:'d',title:'선택',shapes:[{id:'a',x:100,y:100,label:'A'},{id:'b',x:600,y:400,label:'B'}]};
 assert.equal(typeof m.transformDraftSelection,'function');
 const moved=m.transformDraftSelection(doc,['a','b'],{type:'move',dx:200,dy:200});
 assert.deepEqual(moved.map(s=>[s.x,s.y]),[[180,140],[680,440]]);
 const copied=m.transformDraftSelection(doc,['a','b'],{type:'copy',newIds:['c','d']});
 assert.equal(copied.length,4);assert.deepEqual(copied.slice(2).map(s=>[s.id,s.x,s.y]),[['c',120,120],['d',620,420]]);
 assert.deepEqual(m.transformDraftSelection(doc,['a','b'],{type:'delete'}),[]);
 const locked={...doc,layers:[{id:'default',name:'표시',visible:true,locked:false},{id:'locked',name:'잠금',visible:true,locked:true}],shapes:[doc.shapes[0],{...doc.shapes[1],layerId:'locked'}]};
 for(const action of [{type:'move',dx:10,dy:10},{type:'copy',newIds:['c','d']},{type:'delete'}])assert.equal(m.transformDraftSelection(locked,['a','b'],action),null);
 assert.equal(m.transformDraftSelection(doc,['missing'],{type:'delete'}),null);
 assert.equal(m.transformDraftSelection(doc,['a'],{type:'copy',newIds:['b']}),null);
});
test('local polyline vertices survive storage and drive rendering and quantity staleness',async()=>{
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const scenarios=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 const shape={id:'p1',kind:'polyline',label:'연결선',x:100,y:100,width:200,height:100,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}]};
 const doc={id:'p',title:'연결선',source:{name:'a.pdf',sha256:'a'.repeat(64),pages:1},shapes:[shape]};
 const restored=codec.decodeWorkflowSession(JSON.stringify({version:1,scenarios,drafts:{},blankDocuments:[doc]}));
 assert.notEqual(restored,null);assert.deepEqual(restored.blankDocuments[0].shapes[0].points,shape.points);
 for(const points of [[],[{x:0,y:0}],[{x:-1,y:0},{x:1,y:1}]])assert.equal(codec.decodeWorkflowSession(JSON.stringify({version:1,scenarios,drafts:{},blankDocuments:[{...doc,shapes:[{...shape,points}]}]})),null);
 const q=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts');
 const linked=q.setDocumentQuantity(doc,'p1',{raw:10,correction:0,unit:'m',rate:1,reason:'길이표'});
 assert.equal(q.documentQuantityRow(linked,{...linked.shapes[0],points:[{x:0,y:0},{x:0.5,y:0.5},{x:1,y:1}]}).stale,true);
 const {WorkflowDraftShape}=await vite.ssrLoadModule('/app/lukas/components/workflow-draft-shape.tsx');
 const html=renderToStaticMarkup(React.createElement(WorkflowDraftShape,{shape,selected:false}));
 assert.match(html,/<polyline/);assert.match(html,/points="100,100 300,100 300,200"/);
});
test('layer order controls drawing stacking and layer edits cannot orphan objects',async()=>{
 const layers=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-layers.ts');
 const doc={id:'d',title:'도면',layers:[{id:'review',name:'검토',visible:true,locked:false},{id:'default',name:'기본',visible:true,locked:false}],shapes:[{id:'front',layerId:'review',x:0,y:0,label:'앞'},{id:'back',x:0,y:0,label:'뒤'}]};
 assert.equal(typeof layers.orderedDraftShapes,'function');
 assert.deepEqual(layers.orderedDraftShapes(doc).map(s=>s.id),['back','front']);
 assert.deepEqual(layers.orderedDraftShapes({...doc,layers:[...doc.layers].reverse()}).map(s=>s.id),['front','back']);
 assert.equal(layers.validDraftLayers(doc,[doc.layers[1]]),false);
 assert.equal(layers.validDraftLayers(doc,[...doc.layers].reverse()),true);
 assert.equal(layers.validDraftLayers(doc,doc.layers.map(layer=>({...layer,name:'중복'}))),false);
});
test('local layers persist with valid object references and frozen review visibility',async()=>{
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const scenarios=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 const doc={id:'layers',title:'레이어',source:{name:'a.pdf',sha256:'a'.repeat(64),pages:1},layers:[{id:'default',name:'표시',visible:true,locked:false},{id:'review',name:'검토',visible:false,locked:true}],shapes:[{id:'s1',x:10,y:20,label:'표시',layerId:'review'}]};
 const restored=codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios,drafts:{},blankDocuments:[doc]}));
 assert.deepEqual(restored.blankDocuments[0].layers,doc.layers);
 const invalid={...doc,shapes:[{...doc.shapes[0],layerId:'missing'}]};
 assert.equal(codec.decodeWorkflowSession(JSON.stringify({version:1,scenarios,drafts:{},blankDocuments:[invalid]})),null);
 const {reduceDocumentReview}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-review.ts');
 const requested=reduceDocumentReview(doc,'author',{type:'request',targetId:'s1',message:'확인'});
 assert.deepEqual(requested.reviewRounds[0].layers,doc.layers);
 doc.layers[1].visible=true;assert.equal(requested.reviewRounds[0].layers[1].visible,false);
 const {setDocumentQuantity}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts');
 assert.equal(setDocumentQuantity(doc,'s1',{raw:1,correction:0,unit:'m²',rate:1,reason:'근거'}),doc);
});
test('local draft size and rotation persist in approval and invalidate quantity evidence',async()=>{
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const q=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts');
 const scenarios=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 const original={id:'s1',label:'바닥',kind:'rectangle',x:100,y:100};
 const doc={id:'frame',title:'크기 편집',source:{name:'a.pdf',sha256:'a'.repeat(64),pages:1},shapes:[original]};
 const linked=q.setDocumentQuantity(doc,'s1',{raw:10,correction:0,unit:'m²',rate:1,reason:'산출서'});
 const changed={...linked,shapes:[{...linked.shapes[0],width:240,height:160,rotation:30}]};
 const restored=codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios,drafts:{},blankDocuments:[changed]}));
 assert.equal(restored.blankDocuments[0].shapes[0].width,240);
 assert.equal(restored.blankDocuments[0].shapes[0].rotation,30);
 assert.equal(q.documentQuantityRow(changed,changed.shapes[0]).stale,true);
 assert.equal(q.documentQuantityRow(linked,linked.shapes[0]).stale,false);
 for(const patch of [{width:0},{height:Infinity},{rotation:181},{x:680,width:240}]){
  assert.equal(codec.decodeWorkflowSession(JSON.stringify({version:1,scenarios,drafts:{},blankDocuments:[{...changed,shapes:[{...changed.shapes[0],...patch}]}]})),null);
 }
 const {reduceDocumentReview}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-review.ts');
 const request=reduceDocumentReview(changed,'author',{type:'request',targetId:'s1',message:'검토'});
 assert.equal(request.reviewRounds[0].objects[0].width,240);
 const {WorkflowDraftShape}=await vite.ssrLoadModule('/app/lukas/components/workflow-draft-shape.tsx');
 const html=renderToStaticMarkup(React.createElement(WorkflowDraftShape,{shape:request.reviewRounds[0].objects[0],selected:true}));
 assert.match(html,/rotate\(30 220 180\)/);assert.match(html,/width="240"/);
});
test('pricebook CSV preview validates rows before atomic version import',async()=>{
 const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const csv='코드,품목명,단위,단가,출처\nFIN-A,"바닥, 마감",m²,45000,단가표 1쪽\nPIPE,배수관,m,85000,단가표 2쪽';
 const start=m.createWorkflow('architecture');
 const imported=m.reduceWorkflow(start,{type:'pricebook-import',csv});
 assert.equal(imported.pricebook?.length,2);
 assert.equal(imported.pricebook[0].name,'바닥, 마감');
 const second=m.reduceWorkflow(imported,{type:'pricebook-import',csv});
 assert.equal(second.pricebook[2].version,2);
 assert.equal(second.object.rate,start.object.rate);
 for(const bad of [csv+'\nBAD,오류,m²,-2,출처',csv+'\nfin-a,중복,m²,1,출처','코드,품목명,단위,단가,출처\nA,금액없음,m²,,출처','코드,품목명,단위,단가,출처\nA,"미닫힘,m²,1,출처']){
  assert.equal(m.reduceWorkflow(imported,{type:'pricebook-import',csv:bad}),imported);
 }
 assert.equal(m.reduceWorkflow({...start,role:'viewer'},{type:'pricebook-import',csv}).pricebook,undefined);
 const full={...start,pricebook:Array.from({length:199},(_,i)=>({...imported.pricebook[0],code:`E${i}`}))};
 assert.equal(m.reduceWorkflow(full,{type:'pricebook-import',csv}),full);
});
test('local quantity freezes a selected company rate and rejects conflicting provenance',async()=>{
 const q=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts');
 const rateSource={code:'LOCAL-1',name:'현장 바닥',unit:'m²',rate:45000,source:'등록 단가표',version:1};
 const doc={id:'local-rate',title:'도면',source:{name:'a.pdf',sha256:'a'.repeat(64),pages:1},shapes:[{id:'s1',x:10,y:20,label:'바닥'}]};
 const input={raw:10,correction:0,unit:'m²',rate:45000,reason:'산출서',rateSource};
 const saved=q.setDocumentQuantity(doc,'s1',input);
 assert.equal(saved.shapes[0].quantity.rateSource?.version,1);
 rateSource.rate=47000;
 assert.equal(saved.shapes[0].quantity.rateSource.rate,45000);
 assert.equal(q.setDocumentQuantity(doc,'s1',input),doc);
 assert.equal(q.documentQuantitySchema.safeParse({...saved.shapes[0].quantity,rateReference:{catalogVersion:'DEMO-RATES-01',code:'FIN-01'}}).success,false);
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const scenarios=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 const restored=codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios,drafts:{},blankDocuments:[saved]}));
 assert.deepEqual(restored.blankDocuments[0].shapes[0].quantity,saved.shapes[0].quantity);
 const {reduceDocumentReview}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-review.ts');
 const requested=reduceDocumentReview(saved,'author',{type:'request',targetId:'s1',message:'단가 확인'});
 const reviewed=reduceDocumentReview(requested,'reviewer',{type:'review',message:'검토 완료'});
 const approved=reduceDocumentReview(reviewed,'approver',{type:'approve',message:'승인 확인'});
 assert.equal(approved.reviewRounds[0].phase,'approved');
 assert.equal(approved.reviewRounds[0].objects[0].quantity.rateSource.rate,45000);
});
test('pricebook revisions retain applied source and survive session without rewriting earlier values',async()=>{
 const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const initial=m.createWorkflow('architecture');
 const entry={code:'FIN-A',name:'바닥 마감',unit:'m²',rate:45000,source:'사내 단가표 1쪽'};
 const one=m.reduceWorkflow(initial,{type:'pricebook-save',entry});
 assert.equal(one.pricebook?.[0].version,1);
 const applied=m.reduceWorkflow(one,{type:'rate',rate:45000,unit:'m²',reference:{code:'FIN-A',version:1}});
 assert.equal(applied.object.rateSource.version,1);
 const two=m.reduceWorkflow(applied,{type:'pricebook-save',entry:{...entry,rate:47000,source:'사내 단가표 수정'}});
 assert.equal(two.pricebook.length,2);assert.equal(two.pricebook[0].rate,45000);
 assert.equal(two.object.rateSource.rate,45000);
 assert.equal(m.reduceWorkflow(two,{type:'rate',rate:47000,unit:'m²',reference:{code:'FIN-A',version:1}}),two);
 const viewer={...two,role:'viewer'};assert.equal(m.reduceWorkflow(viewer,{type:'pricebook-save',entry}),viewer);
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const scenarios={architecture:two,ifc:m.createWorkflow('ifc'),civil:m.createWorkflow('civil')};
 const restored=codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios,drafts:{}}));
 assert.deepEqual(restored.scenarios.architecture.pricebook,two.pricebook);
 assert.deepEqual(restored.scenarios.architecture.object.rateSource,two.object.rateSource);
 const manual=m.reduceWorkflow(two,{type:'rate',rate:48000,unit:'m²'});
 assert.equal(Object.hasOwn(manual.object,'rateSource'),false);
 const manualRestored=codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios:{...scenarios,architecture:manual},drafts:{}}));
 assert.deepEqual(manualRestored.scenarios.architecture.object,manual.object);
});
test('member role plans validate identity, persist locally and never change acting role',async()=>{
 const model=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const start=model.createWorkflow('architecture');
 const action={type:'member-plan',name:'현장 검토자',email:'review@example.test',role:'reviewer'};
 const added=model.reduceWorkflow(start,action);
 assert.equal(added.members?.find(m=>m.email==='review@example.test')?.role,'reviewer');
 assert.equal(added.role,'author');
 const changed=model.reduceWorkflow(added,{...action,email:'REVIEW@example.test',role:'viewer'});
 assert.equal(changed.members.filter(m=>m.email==='review@example.test').length,1);
 assert.equal(changed.members.find(m=>m.email==='review@example.test').role,'viewer');
 assert.equal(model.reduceWorkflow(start,{...action,email:'invalid'}),start);
 const viewer={...start,role:'viewer'};assert.equal(model.reduceWorkflow(viewer,action),viewer);
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const scenarios={architecture:changed,ifc:model.createWorkflow('ifc'),civil:model.createWorkflow('civil')};
 assert.deepEqual(codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios,drafts:{}})).scenarios.architecture.members,changed.members);
});
test('re-preparing a delivery preserves earlier recipient feedback through session restore',async()=>{
 const {reduceDocumentDelivery}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-delivery.ts');
 const source={name:'plan.pdf',sha256:'a'.repeat(64),pages:1};
 const doc={id:'history-doc',title:'납품 이력',source,shapes:[],reviewRounds:[{revision:1,phase:'approved',source,objects:[],targetId:'s1',message:'검토'}]};
 const first=reduceDocumentDelivery(doc,{type:'prepare',revision:1,recipient:'첫 수신자'});
 const replied=reduceDocumentDelivery(first,{type:'correction',message:'목록 보완 필요'});
 const second=reduceDocumentDelivery(replied,{type:'prepare',revision:1,recipient:'다음 수신자'});
 assert.deepEqual(second.deliveryHistory,[replied.delivery]);
 assert.equal(second.delivery.feedback,undefined);
 const received=reduceDocumentDelivery(second,{type:'receive',message:'새 구성 확인'});
 assert.equal(received.deliveryHistory[0].feedback,'목록 보완 필요');
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const scenarios=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 const restored=codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios,drafts:{},blankDocuments:[received]}));
 assert.deepEqual(restored.blankDocuments[0].deliveryHistory,received.deliveryHistory);
 assert.equal(codec.decodeWorkflowSession(JSON.stringify({version:1,scenarios,drafts:{},blankDocuments:[{...received,deliveryHistory:[{...received.deliveryHistory[0],revision:99}]}]})),null);
 const full={...received,deliveryHistory:Array.from({length:100},()=>({...replied.delivery}))};
 assert.equal(reduceDocumentDelivery(full,{type:'prepare',revision:1,recipient:'초과'}),full);
});
test('recipient preview expires and replacement packages invalidate old references', async () => {
 const {reduceDocumentDelivery}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-delivery.ts');
 const doc={id:'guest-doc',title:'승인 도면',shapes:[],reviewRounds:[{revision:1,phase:'approved'}]};
 const first=reduceDocumentDelivery(doc,{type:'prepare',revision:1,recipient:'발주처'});
 assert.equal(first.delivery.sequence,1);
 const expired=reduceDocumentDelivery(first,{type:'expire'});
 assert.equal(expired.delivery.linkStatus,'expired');
 assert.equal(reduceDocumentDelivery(expired,{type:'receive',message:'확인'}),expired);
 const second=reduceDocumentDelivery(expired,{type:'prepare',revision:1,recipient:'발주처'});
 assert.equal(second.delivery.sequence,2);
 assert.equal(second.delivery.linkStatus,'active');
});
test('local catalog rate keeps versioned provenance and rejects mismatched unit or price', async () => {
 const model=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts');
 const doc={id:'rate-doc',title:'단가 연결',source:{name:'plan.pdf',sha256:'a'.repeat(64),pages:1},shapes:[{id:'s1',x:10,y:20,label:'바닥'}]};
 const rateReference={catalogVersion:'DEMO-RATES-01',code:'FIN-01'};
 const input={raw:24,correction:0,unit:'m²',rate:42000,reason:'산출서 근거',rateReference};
 const linked=model.setDocumentQuantity(doc,'s1',input);
 assert.deepEqual(linked.shapes[0].quantity.rateReference,rateReference);
 assert.equal(model.setDocumentQuantity(doc,'s1',{...input,unit:'m'}),doc);
 assert.equal(model.setDocumentQuantity(doc,'s1',{...input,rate:1}),doc);
 assert.equal(model.setDocumentQuantity(doc,'s1',{...input,rateReference:{...rateReference,code:'unknown'}}),doc);
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const scenarios=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 const restored=codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios,drafts:{},blankDocuments:[linked]}));
 assert.deepEqual(restored.blankDocuments[0].shapes[0].quantity.rateReference,rateReference);
});
test('local takeoff retains manual evidence, marks moved copies stale and freezes review values', async () => {
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const scenarios=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 const quantity={raw:24,correction:2,unit:'m²',rate:42000,reason:'바닥 면적표 24 + 보정 2',basis:'saved-geometry'};
 const doc={id:'qty-doc',title:'적산 근거',source:{name:'plan.pdf',sha256:'a'.repeat(64),pages:1},shapes:[{id:'s1',x:100,y:100,label:'바닥',quantity}]};
 const restored=codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios,drafts:{},blankDocuments:[doc]}));
 assert.deepEqual(restored.blankDocuments[0].shapes[0].quantity,quantity);
 const model=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts');
 const input={raw:24,correction:2,unit:'m²',rate:42000,reason:'바닥 면적표 24 + 보정 2'};
 const linked=model.setDocumentQuantity(doc,'s1',input);
 assert.equal(model.documentQuantityRow(linked,linked.shapes[0]).amount,1092000);
 assert.equal(model.documentQuantityRow(linked,linked.shapes[0]).stale,false);
 assert.equal(model.documentQuantityRow(linked,{...linked.shapes[0],x:101}).stale,true);
 assert.equal(model.documentQuantityRow(linked,{...linked.shapes[0],id:'copy'}).stale,true);
 assert.equal(model.setDocumentQuantity(doc,'s1',{...input,raw:-1}),doc);
 assert.equal(model.setDocumentQuantity(doc,'s1',{...input,correction:-25}),doc);
 assert.equal(model.setDocumentQuantity(doc,'s1',{...input,reason:' '}),doc);
 assert.equal(model.setDocumentQuantity({...doc,source:undefined},'s1',input).shapes[0],doc.shapes[0]);
 const {reduceDocumentReview}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-review.ts');
 const requested=reduceDocumentReview(linked,'author',{type:'request',targetId:'s1',message:'검토'});
 assert.equal(model.setDocumentQuantity(requested,'s1',{...input,raw:99}),requested);
 assert.equal(requested.reviewRounds[0].objects[0].quantity.raw,24);
});
test('draft geometry kinds and styles survive session and approved snapshots',async()=>{
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const {reduceDocumentReview}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-review.ts');
 const scenarios=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 const shapes=['line','circle','text','rectangle'].map((kind,i)=>({id:`s${i}`,x:50,y:100,kind,label:'표시',stroke:'#112233',fill:'none',lineWidth:3,page:1}));
 let doc={id:'style-doc',title:'표시 도면',source:{name:'plan.pdf',sha256:'a'.repeat(64),pages:1},shapes};
 doc=reduceDocumentReview(doc,'author',{type:'request',targetId:'s0',message:'표시 검토'});
 const restored=codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios,drafts:{},blankDocuments:[doc]}));
 assert.deepEqual(restored.blankDocuments[0].shapes,shapes);
 assert.deepEqual(restored.blankDocuments[0].reviewRounds[0].objects,shapes);
 assert.equal(codec.decodeWorkflowSession(JSON.stringify({version:1,scenarios,drafts:{},blankDocuments:[{...doc,shapes:[{...shapes[0],stroke:'url(https://invalid.test)'}]}]})),null);
});
test('local object history groups inspector changes and restores move copy delete without source changes',async()=>{
 const history=await vite.ssrLoadModule('/app/lukas/lib/drawing-screen-object-history.ts');
 assert.equal(typeof history.editObjectHistory,'function');
 const first={id:'s1',x:10,y:20,label:'구역',page:2};
 let state={past:[],present:[first],future:[]};
 state=history.editObjectHistory(state,{type:'record',group:'position',update:objects=>objects.map(o=>({...o,x:30}))});
 state=history.editObjectHistory(state,{type:'record',group:'position',update:objects=>objects.map(o=>({...o,x:40}))});
 assert.equal(state.past.length,1);
 state=history.editObjectHistory(state,{type:'record',update:objects=>[...objects,{...objects[0],id:'copy',x:60}]});
 assert.equal(state.present.length,2);
 state=history.editObjectHistory(state,{type:'undo'});assert.equal(state.present.length,1);assert.equal(state.present[0].x,40);
 state=history.editObjectHistory(state,{type:'undo'});assert.deepEqual(state.present,[first]);
 state=history.editObjectHistory(state,{type:'redo'});assert.equal(state.present[0].x,40);
 state=history.editObjectHistory(state,{type:'reset'});assert.equal(state.past.length,0);assert.equal(state.future.length,0);
});
test('local delivery uses approved snapshot and keeps receipt separate from drawing approval',async()=>{
 let delivery;try{delivery=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-delivery.ts');}catch{}
 assert.ok(delivery,'Local approved-document delivery model missing');
 const source={name:'plan.pdf',sha256:'a'.repeat(64),pages:2};
 const round={revision:1,source,objects:[{id:'s1',x:0,y:0,label:'승인 대상',page:2}],targetId:'s1',message:'검토',phase:'approved',approvalNote:'승인'};
 const doc={id:'d1',title:'납품 도면',source,shapes:[],revision:2,reviewRounds:[round]};
 const action={type:'prepare',revision:1,recipient:'발주처 검토팀'};
 assert.equal(delivery.reduceDocumentDelivery({...doc,reviewRounds:[]},action).delivery,undefined);
 const prepared=delivery.reduceDocumentDelivery(doc,action);
 assert.equal(prepared.delivery.revision,1);
 assert.equal(prepared.delivery.status,'prepared');
 const feedback=delivery.reduceDocumentDelivery(prepared,{type:'correction',message:'도면 목록을 확인해주세요'});
 assert.equal(feedback.delivery.status,'correction');
 assert.equal(feedback.reviewRounds[0].phase,'approved');
 assert.equal(feedback.revision,2);
 const received=delivery.reduceDocumentDelivery(prepared,{type:'receive',message:'구성 확인 완료'});
 assert.equal(received.delivery.status,'received');
 assert.equal(delivery.reduceDocumentDelivery(received,{type:'correction',message:''}),received);
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const scenarios=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 assert.deepEqual(codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios,drafts:{},blankDocuments:[received]})).blankDocuments[0],received);
 assert.equal(codec.decodeWorkflowSession(JSON.stringify({version:1,scenarios,drafts:{},blankDocuments:[{...received,delivery:{...received.delivery,revision:99}}]})),null);
});
test('local review inbox distinguishes pending roles and retains actual document targets',async()=>{
 let inbox;try{inbox=await vite.ssrLoadModule('/app/lukas/components/workflow-document-inbox.tsx');}catch{}
 assert.ok(inbox,'Local document inbox missing');
 const base={id:'d1',title:'보강 도면',revision:1,shapes:[],reviewRounds:[{revision:1,source:{name:'actual.pdf',sha256:'a'.repeat(64),pages:2},objects:[{id:'s1',label:'보강 구역',x:10,y:20,page:2}],targetId:'s1',message:'검토 요청',phase:'requested'}]};
 const render=(documents,mode)=>renderToStaticMarkup(React.createElement(inbox.WorkflowDocumentInbox,{documents,mode,onOpen(){}}));
 const pending=render([base],'tasks');assert.match(pending,/actual.pdf/);assert.match(pending,/2쪽/);assert.match(pending,/검토자/);
 const approved={...base,reviewRounds:[{...base.reviewRounds[0],phase:'approved',approvalNote:'승인'}]};
 assert.doesNotMatch(render([approved],'tasks'),/보강 도면/);
 assert.match(render([approved],'reviews'),/보강 도면/);
 assert.match(render([],'tasks'),/처리할 로컬 검토 작업이 없습니다/);
});
test('PDF review rounds freeze real source and objects across correction and approval',async()=>{
 let review;try{review=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-review.ts');}catch{}
 assert.ok(review,'Independent document review model missing');
 const original={id:'pdf1',title:'실제 도면',source:{name:'plan.pdf',sha256:'a'.repeat(64),pages:2},page:2,shapes:[{id:'s1',x:120,y:100,label:'검토 대상',page:2}]};
 assert.equal(review.reduceDocumentReview(original,'viewer',{type:'request',targetId:'s1',message:'확인 요청'}),original);
 let doc=review.reduceDocumentReview(original,'author',{type:'request',targetId:'s1',message:'확인 요청'});
 assert.equal(review.documentReviewPhase(doc),'requested');
 assert.equal(doc.reviewRounds[0].objects[0].page,2);
 assert.equal(doc.reviewRounds[0].source.sha256,'a'.repeat(64));
 assert.equal(review.canEditDocument(doc,'author'),false);
 assert.equal(review.reduceDocumentReview(doc,'author',{type:'approve',message:'승인'}),doc);
 doc=review.reduceDocumentReview(doc,'reviewer',{type:'changes',message:'명칭을 구체화하세요'});
 assert.equal(review.canEditDocument(doc,'author'),true);
 doc={...doc,shapes:doc.shapes.map(s=>({...s,label:'보강 구간'}))};
 doc=review.reduceDocumentReview(doc,'author',{type:'request',targetId:'s1',message:'명칭 수정 완료'});
 assert.equal(doc.reviewRounds.length,2);
 assert.equal(doc.reviewRounds[0].objects[0].label,'검토 대상');
 assert.equal(doc.reviewRounds[1].objects[0].label,'보강 구간');
 doc=review.reduceDocumentReview(doc,'reviewer',{type:'review',message:'수정 확인'});
 doc=review.reduceDocumentReview(doc,'approver',{type:'approve',message:'구상 검토 승인'});
 assert.equal(review.documentReviewPhase(doc),'approved');
 const approved=doc.reviewRounds[1];
 doc=review.reduceDocumentReview(doc,'author',{type:'new-revision'});
 assert.equal(review.documentReviewPhase(doc),'draft');
 assert.equal(doc.revision,3);
 assert.deepEqual(doc.reviewRounds[1],approved);
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const scenarios=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 assert.deepEqual(codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios,drafts:{},blankDocuments:[doc]})).blankDocuments[0],doc);
});
test('local PDF evidence restores fingerprint and page-specific overlays without storing bytes',async()=>{
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const scenarios=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 const doc={id:'pdf-draft',title:'실제 도면',source:{name:'plan.pdf',sha256:'a'.repeat(64),pages:2},page:2,shapes:[{id:'s1',x:100,y:100,label:'확인',page:2}]};
 const restored=codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios,drafts:{},blankDocuments:[doc]}));
 assert.deepEqual(restored.blankDocuments,[doc]);
 const invalid={...doc,source:{...doc.source,sha256:'invalid'}};
 assert.equal(codec.decodeWorkflowSession(JSON.stringify({version:1,scenarios,drafts:{},blankDocuments:[invalid]})),null);
});
test('template starts create independent editable layouts without engineering evidence',async()=>{
 const module=await vite.ssrLoadModule('/app/lukas/lib/workflow-blank-document.ts');
 assert.equal(typeof module.createWorkflowTemplateDocument,'function');
 const first=module.createWorkflowTemplateDocument('office','first','사무실 구상');
 const second=module.createWorkflowTemplateDocument('office','second','다른 사무실');
 const civil=module.createWorkflowTemplateDocument('site','third','현장 구상');
 assert.equal(first.title,'사무실 구상');
 assert.equal(first.shapes.length,4);
 assert.equal(civil.shapes.length,3);
 assert.equal(first.sourceId,undefined);
 assert.equal(first.quantity,undefined);
 first.shapes[0].label='수정';
 assert.equal(second.shapes[0].label,'회의실');
 assert.notEqual(first.shapes[0].id,second.shapes[0].id);
 assert.equal(module.createWorkflowTemplateDocument('unknown','fourth','오류'),null);
});
test('blank documents restore without borrowing scenario source or quantities',async()=>{
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const scenarios=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 const doc={id:'blank-1',title:'배치 구상',shapes:[]};
 const restored=codec.decodeWorkflowSession(codec.encodeWorkflowSession({scenarios,drafts:{},blankDocuments:[doc]}));
 assert.deepEqual(restored.blankDocuments,[doc]);
 assert.equal(restored.scenarios.civil.object.sourceId,'CIVIL-01');
});
test('project list groups building workflows without duplicating projects and exposes civil work',async()=>{
 let view;
 try{view=await vite.ssrLoadModule('/app/lukas/components/workflow-prototype-projects.tsx');}catch{}
 assert.ok(view,'Grouped project entry view missing');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const states=Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)]));
 const html=renderToStaticMarkup(React.createElement(view.WorkflowProjectsPage,{scenarios:states,onOpen(){},onStart(){}}));
 assert.equal((html.match(/data-project-card=/g)??[]).length,2);
 assert.match(html,/건축 적산 열기/);
 assert.match(html,/3D 검토 열기/);
 assert.match(html,/토목 현장 열기/);
});
test('model evidence panel exposes selected source and does not invent an IFC GlobalId',async()=>{
 let component;
 try{component=await vite.ssrLoadModule('/app/lukas/components/workflow-prototype-model.tsx');}catch{}
 assert.ok(component,'Model evidence panel missing');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const html=renderToStaticMarkup(React.createElement(component.WorkflowModelPanel,{state:createWorkflow('ifc'),open(){},go(){}}));
 assert.match(html,/IFC-01/);
 assert.match(html,/W-201/);
 assert.match(html,/GlobalId 미연결/);
 assert.match(html,/모델 원본은 아직 연결되지 않았습니다/);
});
test('change page displays a decrease once and a rate-only monetary difference',async()=>{
 const {WorkflowPrototypePage}=await vite.ssrLoadModule('/app/lukas/components/workflow-prototype-pages.tsx');
 const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const state=createWorkflow('civil');
 const render=object=>renderToStaticMarkup(React.createElement(WorkflowPrototypePage,{page:'changes',state:{...state,object},go(){},open(){},dispatch(){}}));
 const lower=render({...state.object,quantity:58});
 assert.doesNotMatch(lower,/\+\-2/);
 assert.match(lower,/-170,000/);
 const rate=render({...state.object,rate:90000});
 assert.match(rate,/\+300,000/);
 assert.match(rate,/초기 예시 R1/);
});
test("session snapshot restores three isolated scenarios and rejects broken or incompatible data", async () => {
  let session;
  try {
    session = await vite.ssrLoadModule(
      "/app/lukas/lib/workflow-prototype-session.ts",
    );
  } catch {}
  assert.ok(session, "Versioned preview session codec is missing");
  const { createWorkflow, reduceWorkflow } = await vite.ssrLoadModule(
    "/app/lukas/lib/workflow-prototype.ts",
  );
  const scenarios = {
    architecture: reduceWorkflow(createWorkflow("architecture"), {
      type: "revise",
    }),
    ifc: createWorkflow("ifc"),
    civil: createWorkflow("civil"),
  };
  const drafts = {
    "architecture:request:2": "공제 근거 확인",
    "ifc:review:1": "외벽 수정 요청",
  };
  const raw = session.encodeWorkflowSession({ scenarios, drafts });
  const restored = session.decodeWorkflowSession(raw);
  assert.equal(restored.scenarios.architecture.object.quantity, 28);
  assert.equal(restored.scenarios.ifc.object.quantity, 36);
  assert.equal(restored.drafts["architecture:request:2"], "공제 근거 확인");
  assert.equal(session.decodeWorkflowSession("{broken"), null);
  const wrong = JSON.parse(raw);
  wrong.version = 999;
  assert.equal(session.decodeWorkflowSession(JSON.stringify(wrong)), null);
  const crossed = JSON.parse(raw);
  crossed.scenarios.ifc = crossed.scenarios.architecture;
  assert.equal(session.decodeWorkflowSession(JSON.stringify(crossed)), null);
  const invalid = JSON.parse(raw);
  invalid.scenarios.civil.object.quantity = -2;
  assert.equal(session.decodeWorkflowSession(JSON.stringify(invalid)), null);
});
test("review handoff exposes correction context and next role without losing source evidence", async () => {
  let view;
  try {
    view = await vite.ssrLoadModule(
      "/app/lukas/components/workflow-prototype-review-context.tsx",
    );
  } catch {}
  assert.ok(view, "Review handoff context missing");
  const { createWorkflow, reduceWorkflow } = await vite.ssrLoadModule(
    "/app/lukas/lib/workflow-prototype.ts",
  );
  let state = createWorkflow("ifc");
  for (const action of [
    { type: "calculate" },
    { type: "request", message: "외벽 수량 확인" },
    { type: "role", role: "reviewer" },
    { type: "correction", message: "개구부 공제 확인" },
  ])
    state = reduceWorkflow(state, action);
  const html = renderToStaticMarkup(
    React.createElement(view.WorkflowReviewContext, {
      state,
      dispatch() {},
      open() {},
      go() {},
    }),
  );
  assert.match(html, /개구부 공제 확인/);
  assert.match(html, /W-201/);
  assert.match(html, /IFC-01/);
  assert.match(html, /작성자로 전환/);
  assert.match(html, /같은 도면에서 수정/);
});
test("navigation keeps estimate within takeoff and exposes every page without repeating global controls", async () => {
  let navigation;
  try {
    navigation = await vite.ssrLoadModule(
      "/app/lukas/components/workflow-prototype-navigation.tsx",
    );
  } catch {}
  assert.ok(navigation, "Contextual navigation is missing");
  const { workflowPages } = await vite.ssrLoadModule(
    "/app/lukas/lib/workflow-prototype.ts",
  );
  for (const [page] of workflowPages) {
    const html = renderToStaticMarkup(
      React.createElement(navigation.WorkflowNavigation, { page, go() {} }),
    );
    assert.equal((html.match(/data-project-section=/g) ?? []).length, 6);
    assert.equal((html.match(/>구성원·설정</g) ?? []).length, 1);
    const context = renderToStaticMarkup(
      React.createElement(navigation.WorkflowContextNavigation, {
        page,
        go() {},
      }),
    );
    assert.ok(
      (html + context).includes(`data-page="${page}"`),
      `${page} cannot be reached`,
    );
  }
  const html = renderToStaticMarkup(
    React.createElement(navigation.WorkflowContextNavigation, {
      page: "estimate",
      go() {},
    }),
  );
  assert.match(html, /aria-current="page"[^>]*>내역서/);
  assert.match(html, /수량 산출서/);
  assert.doesNotMatch(html, /현장·검측/);
});
test("workspace presents source-linked canvas and read-only viewers cannot revise", async () => {
  const { WorkflowPrototypePage } = await vite.ssrLoadModule(
    "/app/lukas/components/workflow-prototype-pages.tsx",
  );
  const { createWorkflow } = await vite.ssrLoadModule(
    "/app/lukas/lib/workflow-prototype.ts",
  );
  for (const scenario of ["architecture", "ifc", "civil"]) {
    const state = { ...createWorkflow(scenario), role: "viewer" };
    const html = renderToStaticMarkup(
      React.createElement(WorkflowPrototypePage, {
        page: "workspace",
        state,
        go() {},
        open() {},
        dispatch() {},
      }),
    );
    assert.match(html, /aria-label="도면·모델 작업 캔버스"/);
    assert.match(html, /aria-label="분할 보기"/);
    assert.match(html, /disabled=""[^>]*>.*?변경안 적용/s);
    assert.ok(html.includes(state.object.id));
  }
});
test("quantity and estimate pages expose the same selected source instead of unrelated sample rows", async () => {
  let view;
  try {
    view = await vite.ssrLoadModule(
      "/app/lukas/components/workflow-prototype-pages.tsx",
    );
  } catch {}
  assert.ok(view, "Connected workflow pages are not implemented");
  const { createWorkflow, reduceWorkflow } = await vite.ssrLoadModule(
    "/app/lukas/lib/workflow-prototype.ts",
  );
  const s = reduceWorkflow(createWorkflow("ifc"), { type: "calculate" });
  for (const page of ["quantities", "estimate"]) {
    const html = renderToStaticMarkup(
      React.createElement(view.WorkflowPrototypePage, {
        page,
        state: s,
        go() {},
        open() {},
        dispatch() {},
      }),
    );
    assert.match(html, /W-201/);
    assert.match(html, /36/);
    assert.match(html, /근거/);
  }
});
test("unapproved delivery does not present a completed package", async () => {
  let view;
  try {
    view = await vite.ssrLoadModule(
      "/app/lukas/components/workflow-prototype-pages.tsx",
    );
  } catch {}
  assert.ok(view);
  const { createWorkflow } = await vite.ssrLoadModule(
    "/app/lukas/lib/workflow-prototype.ts",
  );
  const html = renderToStaticMarkup(
    React.createElement(view.WorkflowPrototypePage, {
      page: "delivery",
      state: createWorkflow("architecture"),
      go() {},
      open() {},
      dispatch() {},
    }),
  );
  assert.match(html, /승인본 필요/);
  assert.doesNotMatch(html, /납품 완료/);
});
