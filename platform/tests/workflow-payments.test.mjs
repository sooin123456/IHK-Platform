import assert from 'node:assert/strict';import test from 'node:test';import {createServer} from 'vite';
test('payment requests pin verified evidence, preserve correction history and bound cumulative confirmed amounts',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
  const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-payments.ts');
  const {setDocumentQuantity}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts'),{reduceQuantityReview}=await vite.ssrLoadModule('/app/lukas/lib/workflow-quantity-review.ts');
  const {addDocumentFieldNote}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-field.ts'),{recordInspection}=await vite.ssrLoadModule('/app/lukas/lib/workflow-inspections.ts');
  const {submitDailyReport,decideDailyReport}=await vite.ssrLoadModule('/app/lukas/lib/workflow-daily-reports.ts');
  let doc={id:'pay',title:'기성도',source:{name:'cost.pdf',sha256:'a'.repeat(64),pages:1},shapes:[{id:'pipe',label:'배관',x:10,y:20}]};
  doc=setDocumentQuantity(doc,'pipe',{raw:10,correction:0,unit:'m',rate:100,reason:'산출 근거'});
  for(const [role,type]of[['author','request'],['reviewer','review'],['approver','approve']])doc=reduceQuantityReview(doc,role,{type,message:'수량 확인'});
  doc=addDocumentFieldNote(doc,'pipe','author',{title:'시공 확인',note:'설치 완료',location:'2공구',condition:'conforming'});
  doc=recordInspection(doc,1,'reviewer','inspect',{note:'점검 완료',checks:['pass','pass','na']});
  doc=submitDailyReport(doc,'author',{date:'2026-09-11',work:'설치',next:'다음 구간',weather:'맑음',workers:2,progress:100,fieldNoteId:1});
  doc=decideDailyReport(doc,1,'reviewer','accepted','보고 확인');
  const terms={name:'배관공사',partner:'시공사 예시',amount:1500};
  assert.equal(m.saveContract(doc,'viewer',terms),doc);doc=m.saveContract(doc,'author',terms);
  const input={period:'2026-09',amount:400,note:'설치분 요청',quantitySequence:1,dailyId:1};
  let current=m.submitPayment(doc,'author',input);
  assert.equal(current.paymentClaims[0].contract.version,1);
  assert.equal(m.submitPayment(current,'author',input),current);
  current=m.decidePayment(current,1,'reviewer','changes','근거 설명 보완');
  current=m.submitPayment(current,'author',{...input,note:'설명 보완'},1);
  current=m.decidePayment(current,2,'reviewer','accepted','400 확인');
  assert.equal(m.confirmedPayments(current),400);
  assert.equal(m.submitPayment(current,'author',{...input,amount:601}),current);
  current=m.submitPayment(current,'author',{...input,amount:600});
  const changed=m.saveContract(current,'author',{...terms,name:'변경 계약'});
  assert.equal(m.decidePayment(changed,3,'reviewer','accepted','확인'),changed);
  assert.equal(changed.paymentClaims[2].contract.name,'배관공사');
  assert.equal(m.saveContract(current,'author',{...terms,amount:300}),current);
  current=m.decidePayment(current,3,'reviewer','accepted','600 확인');assert.equal(m.confirmedPayments(current),1000);
  assert.equal(m.submitPayment(current,'author',{...input,amount:1}),current);
  assert.equal(current.paymentClaims[0].phase,'changes');assert.equal(current.dailyReports[0].phase,'accepted');
  const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts'),{createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
  const raw=codec.encodeWorkflowSession({scenarios:Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)])),drafts:{},blankDocuments:[current]});
  assert.deepEqual(codec.decodeWorkflowSession(raw).blankDocuments[0].paymentClaims,current.paymentClaims);
 }finally{await vite.close();}
});
