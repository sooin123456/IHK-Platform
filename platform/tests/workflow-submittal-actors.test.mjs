import assert from 'node:assert/strict';import test from 'node:test';import {createServer} from 'vite';
test('named submissions require matching simulated actor and personal queue excludes other recipients',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-submittals.ts');const doc=m.submitDrawing({id:'a',title:'도면',shapes:[]},'author',{title:'검토',due:'2026-09-30',message:'확인',assignee:'reviewer',reviewerName:'김검토',reviewerEmail:'kim@example.test'});
 assert.equal(m.decideSubmittal(doc,1,'reviewer','accepted','확인',[],[]),doc);
 assert.equal(m.decideSubmittal(doc,1,'reviewer','changes','보완',[],[],'lee@example.test'),doc);
 const accepted=m.decideSubmittal(doc,1,'reviewer','accepted','확인',[],[],'kim@example.test');assert.equal(accepted.submittals[0].phase,'accepted');assert.equal(accepted.submittals[0].decisionBy,'kim@example.test');
 assert.equal(m.submittalQueue([doc],'reviewer','lee@example.test').length,0);assert.equal(m.submittalQueue([doc],'reviewer','kim@example.test').length,1);
 }finally{await vite.close();}
});
