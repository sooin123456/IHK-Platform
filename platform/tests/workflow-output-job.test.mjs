import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});test.after(()=>vite.close());
test('output jobs retain package identity and progress only through explicit simulated outcomes',async()=>{
 const {updateOutputJob,validOutputJobs}=await vite.ssrLoadModule('/app/lukas/lib/workflow-output-job.ts');
 const doc={id:'d',shapes:[],reviewRounds:[{revision:1,phase:'approved',source:{sha256:'a'.repeat(64)}}],delivery:{sequence:1,revision:1,status:'prepared',recipient:'발주자'}};
 assert.equal(updateOutputJob(doc,1,'ready'),doc);assert.equal(updateOutputJob(doc,2,'start'),doc);
 let next=updateOutputJob(doc,1,'start');assert.equal(next.delivery.output.phase,'processing');assert.equal(next.delivery.output.attempt,1);assert.equal(next.delivery.status,'prepared');assert.equal(next.reviewRounds,doc.reviewRounds);
 assert.equal(updateOutputJob(next,1,'start'),next);
 next=updateOutputJob(next,1,'failed');assert.equal(next.delivery.output.phase,'failed');
 next=updateOutputJob(next,1,'start');assert.equal(next.delivery.output.attempt,2);
 next=updateOutputJob(next,1,'cancelled');assert.equal(next.delivery.output.phase,'cancelled');
 next=updateOutputJob(next,1,'start');next=updateOutputJob(next,1,'ready');assert.equal(next.delivery.output.attempt,3);assert.equal(next.delivery.output.sourceHash,'a'.repeat(64));assert.equal(validOutputJobs(next),true);
 const replaced={...next,deliveryHistory:[next.delivery],delivery:{...doc.delivery,sequence:2}};assert.equal(updateOutputJob(replaced,1,'start'),replaced);assert.equal(validOutputJobs(replaced),true);
 assert.equal(validOutputJobs({...next,reviewRounds:[{...doc.reviewRounds[0],source:{sha256:'b'.repeat(64)}}]}),false);
 assert.equal(updateOutputJob({...doc,reviewRounds:[]},1,'start').delivery.output,undefined);
});
