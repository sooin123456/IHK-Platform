import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';
test('photo draft metadata preserves long escaped names within draft limits and clears all attachment slots',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
  const {fieldPhotoDraftPatch,readFieldPhotoDraft}=await vite.ssrLoadModule('/app/lukas/lib/workflow-field-photo.ts');
  const photos=[0,1,2].map(index=>({name:('"\\\n').repeat(160),sha256:String(index).repeat(64),size:1024,mime:'image/png'}));
  const patch=fieldPhotoDraftPatch(photos,'doc:a');assert.ok(Object.values(patch).every(value=>value.length<=500));assert.deepEqual(readFieldPhotoDraft(JSON.parse(JSON.stringify(patch)),'doc:a'),photos);
  assert.deepEqual(readFieldPhotoDraft(patch,'doc:b'),[]);assert.deepEqual(readFieldPhotoDraft({...patch,...fieldPhotoDraftPatch([],'doc:a')},'doc:a'),[]);
  assert.deepEqual(fieldPhotoDraftPatch([{...photos[0],mime:'image/svg+xml'}],'doc:a'),{});
 }finally{await vite.close();}
});
