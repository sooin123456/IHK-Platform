import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});test.after(()=>vite.close());
test('location index aggregates exact prefixes across documents without merging building and civil paths',async()=>{
 const {indexFieldLocations}=await vite.ssrLoadModule('/app/lukas/lib/workflow-field-locations.ts');
 const building={kind:'building',building:'A',floor:'1',room:'동쪽'},civil={kind:'civil',route:'A',section:'1',station:'동쪽'};
 const docs=[{id:'a',fieldNotes:[{id:1,locationPath:building}]},{id:'b',fieldNotes:[{id:1,locationPath:building},{id:2,locationPath:civil}]}];
 const index=indexFieldLocations(docs);const group=index.find(item=>item.key===JSON.stringify(['building','A','1']));assert.equal(group.records.length,2);assert.deepEqual(group.records.map(item=>item.document.id),['a','b']);assert.equal(index.find(item=>item.key===JSON.stringify(['civil','A','1'])).records.length,1);
 assert.equal(indexFieldLocations([]).length,0);
});
