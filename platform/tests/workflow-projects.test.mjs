import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
test('project containers and document membership survive backup; dangling and duplicate project references are rejected',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
 try{
  const {encodeWorkflowSession:encode,decodeWorkflowSession:decode}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts');
  const {createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
  const base={scenarios:Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)])),drafts:{},blankDocuments:[{id:'legacy',title:'미분류',shapes:[]}]};
  const projects=[{id:'p1',name:'철도 2공구',kind:'civil'}];
  const docs=[...base.blankDocuments,{id:'d1',title:'배수관',projectId:'p1',shapes:[]}];
  const restored=decode(encode({...base,projects,blankDocuments:docs}));
  assert.deepEqual(restored.projects,projects);assert.equal(restored.blankDocuments[1].projectId,'p1');
  assert.equal(decode(encode({...base,projects:[{...projects[0],archived:true}],blankDocuments:docs})).projects[0].archived,true);
  assert.equal(decode(encode(base)).blankDocuments[0].projectId,undefined);
  assert.throws(()=>encode({...base,projects:[],blankDocuments:docs}));
  assert.throws(()=>encode({...base,projects:[...projects,...projects]}));
 }finally{await vite.close();}
});
