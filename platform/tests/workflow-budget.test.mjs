import assert from 'node:assert/strict';import test from 'node:test';import {createServer} from 'vite';
test('budget preview pins an approved sequence and never uses mutable or unapproved totals',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
 const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-budget.ts');
 const doc={quantityReviews:[{sequence:1,phase:'approved',items:[{quantity:{raw:10,correction:2,rate:100}}]},{sequence:2,phase:'requested',items:[{quantity:{raw:100,correction:0,rate:999}}]}]};
 const plan=m.readBudgetPlan(JSON.stringify({sequence:1,budget:2000,reserve:300,note:'검토 예산'}));assert.ok(plan);
 assert.deepEqual(m.budgetComparison(doc,plan),{amount:1200,available:1700,balance:500});
 assert.equal(m.budgetComparison(doc,{...plan,sequence:2}),null);
 assert.equal(m.readBudgetPlan(JSON.stringify({...plan,reserve:2001})),null);
 assert.equal(m.readBudgetPlan(JSON.stringify({...plan,budget:-1})),null);
 assert.equal(m.readBudgetPlan('{broken'),null);
 const huge={quantityReviews:[{sequence:1,phase:'approved',items:[{quantity:{raw:Number.MAX_SAFE_INTEGER,correction:0,rate:2}}]}]};assert.equal(m.budgetComparison(huge,plan),null);
 }finally{await vite.close();}
});
