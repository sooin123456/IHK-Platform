import assert from 'node:assert/strict';import test from 'node:test';import {createServer} from 'vite';
test('scene metadata preserves bounded camera and display settings without model or approval writes',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
 const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-scenes.ts');
 const scene={id:'a',name:'검토 시점',scenario:'ifc',revision:1,position:[18,16,20],target:[0,1,0],section:true,grid:false,isolated:true};
 assert.deepEqual(m.readScene(JSON.stringify(scene)),scene);
 assert.equal(m.readScene(JSON.stringify({...scene,position:[Infinity,0,0]})),null);
 assert.equal(m.readScene(JSON.stringify({...scene,name:''})),null);
 assert.equal(m.readScene(JSON.stringify({...scene,position:[0,1,0]})),null);
 assert.equal(m.readScene('{broken'),null);
 assert.deepEqual(m.savedScenes({'scene:a':JSON.stringify(scene),'unrelated':JSON.stringify(scene)},'ifc'),[scene]);
 assert.deepEqual(m.savedScenes({'scene:a':JSON.stringify(scene)},'civil'),[]);
 const second={...scene,id:'b',name:'단면'};const drafts={'scene:a':JSON.stringify(scene),'scene:b':JSON.stringify(second),'scene-order:ifc':JSON.stringify(['b','a'])};
 assert.deepEqual(m.savedScenes(drafts,'ifc').map(scene=>scene.id),['b','a']);
 assert.deepEqual(m.savedScenes({...drafts,'scene:b':''},'ifc').map(scene=>scene.id),['a']);
 assert.deepEqual(m.savedScenes({...drafts,'scene-order:ifc':'not-json'},'ifc').map(scene=>scene.id),['a','b']);
 }finally{await vite.close();}
});
