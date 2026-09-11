import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';
test('scene gallery validates bounded PNG snapshots, prevents duplicate identity and never evicts old output',async()=>{const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
 const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-scene-gallery.ts');const frame={id:'one',name:'장면',scenario:'ifc',revision:1,width:640,height:480,dataUrl:'data:image/png;base64,iVBORw0KGgo='};
 const first=m.addGalleryFrame([],frame);assert.equal(first.ok,true);assert.equal(m.readGallery(JSON.stringify(first.items))[0].name,'장면');
 assert.equal(m.addGalleryFrame(first.items,frame).ok,false);assert.equal(m.addGalleryFrame([], {...frame,dataUrl:'https://example.com/image.png'}).ok,false);
 const full=Array.from({length:6},(_,i)=>({...frame,id:String(i)}));assert.equal(m.addGalleryFrame(full,{...frame,id:'seventh'}).ok,false);assert.equal(full.length,6);
 assert.throws(()=>m.readGallery('{broken'));assert.throws(()=>m.readGallery(JSON.stringify([{...frame,width:-1}])));
}finally{await vite.close();}});
