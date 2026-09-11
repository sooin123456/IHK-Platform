import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';

test('inspection correction/reinspection appends history, enforces role and source, survives session restore',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
 try {
  const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-inspections.ts');
  const {addDocumentFieldNote}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-field.ts');
  const doc=addDocumentFieldNote({id:'a',title:'검측도',source:{name:'site.pdf',sha256:'a'.repeat(64),pages:1},shapes:[{id:'wall',label:'벽',x:10,y:20}]},'wall','author',{title:'배관 간격',note:'확인 필요',location:'2공구',condition:'needs-check'});
  const fail={note:'간격 보완 필요',checks:['pass','fail','na']};
  assert.equal(m.recordInspection(doc,1,'author','inspect',fail),doc);
  let current=m.recordInspection(doc,1,'reviewer','inspect',fail);
  assert.equal(m.inspectionPhase(current.inspections[0]),'correction');
  assert.equal(m.recordInspection(current,1,'reviewer','rectify',{note:'보완'}),current);
  current=m.recordInspection(current,1,'author','rectify',{note:'간격 수정 완료'});
  assert.equal(m.inspectionPhase(current.inspections[0]),'reinspection');
  assert.equal(m.recordInspection(current,1,'reviewer','reinspect',{note:'',checks:['pass','pass','pass']}),current);
  const stale={...current,shapes:[{...current.shapes[0],x:30}]};
  assert.equal(m.recordInspection(stale,1,'reviewer','reinspect',{note:'완료',checks:['pass','pass','pass']}),stale);
  current=m.recordInspection(current,1,'reviewer','reinspect',fail);
  assert.equal(m.inspectionPhase(current.inspections[0]),'correction');
  current=m.recordInspection(current,1,'author','rectify',{note:'재보완 완료'});
  current=m.recordInspection(current,1,'reviewer','reinspect',{note:'재검측 완료',checks:['pass','pass','na']});
  assert.equal(m.inspectionPhase(current.inspections[0]),'closed');
  assert.equal(current.inspections[0].events.length,5);
  assert.equal(current.inspections[0].events[0].note,'간격 보완 필요');
  assert.equal(m.recordInspection(current,1,'reviewer','inspect',fail),current);
  assert.deepEqual(current.fieldNotes,doc.fieldNotes);
  assert.equal(current.reviewRounds,undefined);assert.equal(current.quantityReviews,undefined);
  const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
  const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
  const raw=codec.encodeWorkflowSession({scenarios:Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)])),drafts:{},blankDocuments:[current]});
  assert.deepEqual(codec.decodeWorkflowSession(raw).blankDocuments[0].inspections,current.inspections);
  assert.equal(m.inspectionsSchema.safeParse([{fieldNoteId:1,events:[{action:'rectify',note:'잘못된 시작'}]}]).success,false);
  assert.equal(m.recordInspection(doc,1,'reviewer','inspect',{note:'모두 제외',checks:['na','na','na']}),doc);
 } finally {await vite.close();}
});
