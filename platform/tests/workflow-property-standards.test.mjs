import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';
test('property standards version independently and validate reusable object values without changing approved snapshots',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
  const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-property-standards.ts');
  const input={name:'배관 기준',code:'MEP-PIPE',fields:[{key:'f1',label:'구경',type:'number',unit:'mm',required:true},{key:'f2',label:'재질',type:'choice',options:['강관','PVC'],required:true}]};
  let standards=m.savePropertyStandard([],'std',input);assert.equal(standards[0].version,1);
  const doc={id:'one',title:'설비도',shapes:[{id:'pipe',label:'배관',x:10,y:20}]};
  assert.equal(m.applyPropertyStandard(doc,'pipe','viewer',standards[0],{f1:100,f2:'강관'}),doc);
  assert.equal(m.applyPropertyStandard(doc,'pipe','author',standards[0],{f1:'100',f2:'강관'}),doc);
  assert.equal(m.applyPropertyStandard(doc,'pipe','author',standards[0],{f1:100,f2:'미등록'}),doc);
  const assigned=m.applyPropertyStandard(doc,'pipe','author',standards[0],{f1:100,f2:'강관'});
  standards=m.savePropertyStandard(standards,'std',{...input,name:'배관 개정 기준'});assert.equal(standards[1].version,2);assert.equal(assigned.shapes[0].customProperties.standard.name,'배관 기준');
  assert.equal(m.savePropertyStandard(standards,'other',input),standards);
  const {reduceDocumentReview}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-review.ts');let approved={...assigned,source:{name:'source.pdf',sha256:'a'.repeat(64),pages:1}};
  for(const [role,type]of[['author','request'],['reviewer','review'],['approver','approve']])approved=reduceDocumentReview(approved,role,{type,targetId:'pipe',message:'속성 확인'});
  assert.equal(m.applyPropertyStandard(approved,'pipe','author',standards[1],{f1:200,f2:'PVC'}),approved);
  const next=reduceDocumentReview(approved,'author',{type:'new-revision'}),changed=m.applyPropertyStandard(next,'pipe','author',standards[1],{f1:200,f2:'PVC'});
  assert.equal(changed.reviewRounds[0].objects[0].customProperties.values.f1,100);assert.equal(changed.shapes[0].customProperties.values.f1,200);
  const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts'),{createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
  const raw=codec.encodeWorkflowSession({scenarios:Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)])),drafts:{},blankDocuments:[changed],propertyStandards:standards});const restored=codec.decodeWorkflowSession(raw);
  assert.deepEqual(restored.propertyStandards,standards);assert.deepEqual(restored.blankDocuments[0].shapes[0].customProperties,changed.shapes[0].customProperties);
  const {captureDrawingTemplate,instantiateDrawingTemplate}=await vite.ssrLoadModule('/app/lukas/lib/workflow-saved-templates.ts');
  const template=captureDrawingTemplate(changed,'template','도형 재사용',1);
  assert.equal(template.shapes[0].customProperties,undefined);
  assert.equal(instantiateDrawingTemplate({...template,shapes:changed.shapes},'copy','복사 도면').shapes[0].customProperties,undefined);
 }finally{await vite.close();}
});
