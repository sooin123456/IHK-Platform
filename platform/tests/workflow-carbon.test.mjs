import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';
test('carbon preview excludes incomplete/mismatched factors and freezes comparable approved evidence',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
  const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-carbon.ts'),{setDocumentQuantity}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts'),{reduceQuantityReview}=await vite.ssrLoadModule('/app/lukas/lib/workflow-quantity-review.ts');
  let doc={id:'carbon',title:'탄소 검토도',source:{name:'cost.pdf',sha256:'a'.repeat(64),pages:1},shapes:[{id:'pipe',label:'배관',x:10,y:20}]};doc=setDocumentQuantity(doc,'pipe',{raw:10,correction:2,unit:'m',rate:100,reason:'산출 근거'});
  for(const [role,type]of[['author','request'],['reviewer','review'],['approver','approve']])doc=reduceQuantityReview(doc,role,{type,message:'수량 확인'});
  const round=doc.quantityReviews[0],factor={value:2,unit:'m',source:'사용자 입력 예시 근거',version:'v1'};
  assert.equal(m.carbonPreview(round,{}).complete,false);assert.equal(m.carbonPreview(round,{pipe:{...factor,unit:'kg'}}).complete,false);
  assert.equal(m.carbonPreview(round,{pipe:factor}).total,24);
  assert.equal(m.saveCarbon(doc,'viewer',1,'A1-A3',{pipe:factor},'검토'),doc);
  const first=m.saveCarbon(doc,'author',1,'A1-A3',{pipe:factor},'초기 계수');assert.equal(first.carbonAssessments.length,1);
  const second=m.saveCarbon(first,'author',1,'A1-A3',{pipe:{...factor,value:3,version:'v2'}},'계수 개정');
  assert.equal(second.carbonAssessments[0].factors.pipe.value,2);assert.equal(m.compareCarbon(second.carbonAssessments[0],second.carbonAssessments[1]),12);
  const third=m.saveCarbon(second,'author',1,'A4',{pipe:factor},'운송 단계');assert.equal(m.compareCarbon(third.carbonAssessments[0],third.carbonAssessments[2]),null);
  assert.equal(m.saveCarbon(doc,'author',1,'A1-A3',{},'누락'),doc);
  const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts'),{createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
  const raw=codec.encodeWorkflowSession({scenarios:Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)])),drafts:{},blankDocuments:[third]});assert.deepEqual(codec.decodeWorkflowSession(raw).blankDocuments[0].carbonAssessments,third.carbonAssessments);
 }finally{await vite.close();}
});
