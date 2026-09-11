import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
test('drawing schedule colors represent planned time only and withhold stale dependency states',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
 const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-schedule.ts');const doc={id:'d',title:'도면',shapes:[{id:'a',label:'기초',x:0,y:0},{id:'b',label:'벽',x:100,y:100}]};
 const a=m.makeObjectSchedule(doc,'a',{start:2,end:5,progress:0}),b=m.makeObjectSchedule(doc,'b',{start:6,end:10,progress:0,predecessorId:'a'});
 assert.equal(m.scheduleVisualState(doc,'a',[a,b],1),'waiting');assert.equal(m.scheduleVisualState(doc,'a',[a,b],3),'active');assert.equal(m.scheduleVisualState(doc,'a',[a,b],5),'complete');assert.equal(m.scheduleVisualState(doc,'b',[a,b],7),'active');assert.equal(m.scheduleVisualState(doc,'b',[a],7),'unplanned');
 assert.equal(m.scheduleVisualState({...doc,shapes:[{...doc.shapes[0],x:10},doc.shapes[1]]},'a',[a,b],7),'stale');assert.equal(m.scheduleVisualState({...doc,shapes:[{...doc.shapes[0],x:10},doc.shapes[1]]},'b',[a,b],7),'conflict');assert.equal(m.scheduleVisualState(doc,'a',[a,b],0),'unavailable');
 }finally{await vite.close();}
});
test('schedule dependencies reject cycles, missing or stale predecessors and overlapping finish-to-start periods',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
 const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-schedule.ts');const doc={id:'d',title:'도면',shapes:[{id:'a',label:'기초',x:10,y:20},{id:'b',label:'벽',x:40,y:50}]};
 const a=m.makeObjectSchedule(doc,'a',{start:1,end:5,progress:100});const b=m.makeObjectSchedule(doc,'b',{start:6,end:10,progress:0,predecessorId:'a'});
 assert.equal(b.predecessorId,'a');assert.equal(m.scheduleDependencyIssue(doc,b,[a,b]),null);assert.match(m.scheduleDependencyIssue(doc,{...b,start:5},[a,b]),/선행 작업 종료 후/);
 assert.match(m.scheduleDependencyIssue(doc,b,[b]),/선행 작업/);assert.match(m.scheduleDependencyIssue({...doc,shapes:[{...doc.shapes[0],x:99},doc.shapes[1]]},b,[a,b]),/근거/);
 assert.match(m.scheduleDependencyIssue(doc,{...a,predecessorId:'b'},[a,b]),/순환/);assert.match(m.scheduleDependencyIssue(doc,{...a,predecessorId:'a'},[a,b]),/순환/);
 assert.equal(m.readObjectSchedule(JSON.stringify(b)).predecessorId,'a');assert.equal(m.readObjectSchedule(JSON.stringify(a)).predecessorId,undefined);
 }finally{await vite.close();}
});
test('calendar dates cross month/year/leap boundaries without timezone shifts and reject invalid dates',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
 const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-schedule.ts');
 assert.equal(m.scheduleDate('2026-09-11',5),'2026-09-15');assert.equal(m.scheduleDate('2026-12-31',2),'2027-01-01');assert.equal(m.scheduleDate('2024-02-28',2),'2024-02-29');assert.equal(m.scheduleDate('2026-02-28',2),'2026-03-01');
 assert.equal(m.scheduleDay('2026-09-11','2026-09-20'),10);assert.equal(m.scheduleDay('2026-09-11','2026-09-10'),null);assert.equal(m.scheduleDay('2026-09-11','2026-10-11'),null);
 for(const date of ['2026-02-30','2026-13-01','09/11/2026',''])assert.equal(m.scheduleDate(date,1),null);assert.equal(m.scheduleDate('2026-09-11',31),null);
 }finally{await vite.close();}
});
test('schedule preview binds geometry, validates periods and compares reported progress without modifying quantities',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
 try{
 const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-schedule.ts');
 const doc={id:'d',title:'도면',revision:2,shapes:[{id:'s',label:'벽',x:20,y:30,page:2}]};
 const plan=m.makeObjectSchedule(doc,'s',{start:1,end:10,progress:20});
 assert.equal(m.scheduleProgress(plan,5),50);assert.equal(m.scheduleProgress(plan,20),100);assert.equal(m.scheduleProgress({...plan,start:5},1),0);
 assert.equal(m.scheduleMatches(doc,plan),true);assert.equal(m.scheduleMatches({...doc,revision:3},plan),false);assert.equal(m.scheduleMatches({...doc,shapes:[{...doc.shapes[0],x:99}]},plan),false);
 assert.deepEqual(m.readObjectSchedule(JSON.stringify(plan)),plan);
 for(const input of [{start:11,end:10,progress:20},{start:0,end:10,progress:20},{start:1,end:31,progress:20},{start:1,end:10,progress:101}])assert.equal(m.makeObjectSchedule(doc,'s',input),null);
 assert.equal(m.makeObjectSchedule(doc,'missing',{start:1,end:10,progress:20}),null);assert.equal(m.readObjectSchedule('bad'),null);assert.equal(doc.shapes[0].quantity,undefined);
 }finally{await vite.close();}
});
