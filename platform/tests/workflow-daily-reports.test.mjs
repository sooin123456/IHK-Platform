import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';
test('daily reports freeze dated field/inspection evidence, retain resubmissions and isolate approval domains',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
  const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-daily-reports.ts');
  const {addDocumentFieldNote}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-field.ts');
  const {recordInspection}=await vite.ssrLoadModule('/app/lukas/lib/workflow-inspections.ts');
  let doc=addDocumentFieldNote({id:'daily',title:'일일 보고도',source:{name:'site.pdf',sha256:'a'.repeat(64),pages:1},shapes:[{id:'a',label:'배관',x:10,y:20}]},'a','author',{title:'시공 확인',note:'현장 확인',location:'2공구',condition:'needs-check'});
  doc=recordInspection(doc,1,'reviewer','inspect',{note:'시정 필요',checks:['pass','fail','na']});
  const input={date:'2026-09-11',work:'배관 설치',workers:5,progress:40,weather:'맑음',next:'간격 조정',fieldNoteId:1};
  assert.equal(m.submitDailyReport(doc,'viewer',input),doc);
  assert.equal(m.submitDailyReport(doc,'author',{...input,date:'2026-02-30'}),doc);
  assert.equal(m.submitDailyReport(doc,'author',{...input,progress:101}),doc);
  let current=m.submitDailyReport(doc,'author',input);
  assert.equal(current.dailyReports[0].evidence.objectId,'a');
  current=recordInspection(current,1,'author','rectify',{note:'조정 완료'});
  assert.equal(current.dailyReports[0].inspection.events.length,1);
  assert.equal(m.decideDailyReport(current,1,'author','accepted','확인'),current);
  current=m.decideDailyReport(current,1,'reviewer','changes','조치 내용을 보완하세요');
  current=m.submitDailyReport(current,'author',{...input,work:'조치 결과 보완'},1);
  assert.equal(current.dailyReports[1].previous,1);assert.equal(current.dailyReports[1].inspection.events.length,2);
  assert.equal(m.submitDailyReport(current,'author',input,1),current);
  current=m.decideDailyReport(current,2,'reviewer','accepted','보고 확인');
  assert.equal(current.dailyReports[0].phase,'changes');assert.equal(current.dailyReports[1].phase,'accepted');
  assert.equal(current.reviewRounds,undefined);assert.equal(current.quantityReviews,undefined);
  const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts'),{createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
  const raw=codec.encodeWorkflowSession({scenarios:Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)])),drafts:{},blankDocuments:[current]});
  assert.deepEqual(codec.decodeWorkflowSession(raw).blankDocuments[0].dailyReports,current.dailyReports);
 }finally{await vite.close();}
});
