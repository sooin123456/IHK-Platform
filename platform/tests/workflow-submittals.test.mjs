import assert from 'node:assert/strict';import test from 'node:test';import {createServer} from 'vite';
test('related drawing package freezes recipient and sources, rejects foreign/missing attachments and blocks stale acceptance',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
  const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-submittals.ts');
  const a={id:'a',projectId:'p',title:'평면',shapes:[]},b={id:'b',projectId:'p',title:'단면',shapes:[]},other={id:'c',projectId:'q',title:'다른 프로젝트',shapes:[]};
  const input={title:'시공도 묶음',due:'2026-09-30',assignee:'reviewer',reviewerName:'김검토',message:'평면과 단면 확인',attachmentIds:['b']};
  const submitted=m.submitDrawing(a,'author',input,undefined,[a,b,other]);const item=submitted.submittals[0];
  assert.equal(item.reviewerName,'김검토');assert.equal(item.attachments[0].documentId,'b');assert.equal(item.attachments[0].documentTitle,'단면');
  assert.equal(m.submittalMatches(submitted,item,[b]),true);assert.equal(m.submittalMatches(submitted,item,[]),false);
  const changed={...b,title:'단면 수정'};assert.equal(m.submittalMatches(submitted,item,[changed]),false);
  assert.equal(m.decideSubmittal(submitted,1,'reviewer','accepted','확인',[changed]),submitted);
  assert.equal(m.decideSubmittal(submitted,1,'reviewer','accepted','확인',[b]).submittals[0].phase,'accepted');
  assert.equal(m.submitDrawing(a,'author',{...input,attachmentIds:['c']},undefined,[a,b,other]),a);
  assert.equal(m.submitDrawing(a,'author',{...input,attachmentIds:['missing']},undefined,[a,b]),a);
  assert.equal(m.submitDrawing(a,'author',{...input,attachmentIds:['b','b']},undefined,[a,b]),a);
 }finally{await vite.close();}
});
test('submittal queue routes unresolved work by role without merging document-local IDs',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
 const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-submittals.ts');
 const a={id:'a',title:'건축',submittals:[{id:1,phase:'changes',assignee:'reviewer',due:'2026-09-12'},{id:2,previous:1,phase:'submitted',assignee:'reviewer',due:'2026-09-15'}]};
 const b={id:'b',title:'토목',submittals:[{id:1,phase:'submitted',assignee:'approver',due:'2026-09-11'},{id:2,phase:'changes',assignee:'reviewer',due:'2026-09-14'}]};
 assert.deepEqual(m.submittalQueue([a,b],'reviewer').map(row=>[row.document.id,row.item.id]),[['a',2]]);
 assert.deepEqual(m.submittalQueue([a,b],'author').map(row=>[row.document.id,row.item.id]),[['b',2]]);
 assert.deepEqual(m.submittalQueue([a,b],'approver').map(row=>[row.document.id,row.item.id]),[['b',1]]);
 assert.deepEqual(m.submittalQueue([a,b],'viewer'),[]);
 }finally{await vite.close();}
});
test('submittals preserve return/resubmit history, block stale acceptance and never approve drawings',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
 const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-submittals.ts');
 const doc={id:'a',title:'설비 검토도',shapes:[{id:'one',label:'설비',x:10,y:20}]};
 const input={title:'설비 시공도',due:'2026-09-30',assignee:'reviewer',message:'시공 전 검토 요청'};
 assert.equal(m.submitDrawing(doc,'viewer',input),doc);
 const submitted=m.submitDrawing(doc,'author',input);assert.equal(submitted.submittals.length,1);
 assert.equal(m.decideSubmittal(submitted,1,'author','accepted','확인'),submitted);
 const changed={...submitted,shapes:[{...doc.shapes[0],x:50}]};
 assert.equal(m.submittalMatches(changed,submitted.submittals[0]),false);
 assert.equal(m.decideSubmittal(changed,1,'reviewer','accepted','확인'),changed);
 const returned=m.decideSubmittal(changed,1,'reviewer','changes','간격 수정 후 재제출');
 const resubmitted=m.submitDrawing(returned,'author',{...input,message:'간격을 수정했습니다'},1);
 assert.equal(resubmitted.submittals.length,2);assert.equal(resubmitted.submittals[0].phase,'changes');assert.equal(resubmitted.submittals[1].previous,1);
 const accepted=m.decideSubmittal(resubmitted,2,'reviewer','accepted','검토 완료');
 assert.equal(accepted.submittals[1].phase,'accepted');assert.equal(accepted.reviewRounds,undefined);assert.equal(accepted.quantityReviews,undefined);
 assert.equal(m.submitDrawing(accepted,'author',input,1),accepted);
 assert.equal(m.submitDrawing(doc,'author',{...input,due:'2026-02-30'}),doc);
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts'),{createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
 const raw=codec.encodeWorkflowSession({scenarios:Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)])),drafts:{},blankDocuments:[accepted]});
 assert.deepEqual(codec.decodeWorkflowSession(raw).blankDocuments[0].submittals,accepted.submittals);
 const restored=codec.decodeWorkflowSession(raw).blankDocuments[0];assert.equal(m.submittalMatches(restored,restored.submittals[1]),true);
 }finally{await vite.close();}
});
