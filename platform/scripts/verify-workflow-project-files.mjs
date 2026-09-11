import {chromium,expect} from '@playwright/test';import {createServer} from 'vite';
const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts'),{createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');
const raw=codec.encodeWorkflowSession({scenarios:Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)])),drafts:{},projects:[{id:'a',name:'건축',kind:'architecture'},{id:'b',name:'토목',kind:'civil'}],blankDocuments:['a','b'].map(id=>({id,projectId:id,title:`도면 ${id}`,shapes:[]})),importRecords:Array.from({length:100},(_,index)=>({id:String(index),name:`source-${index}.pdf`,size:100,format:'PDF',status:'ready',sha256:index.toString(16).padStart(64,'0'),pages:1,documentId:index===0?'a':'b'}))});await vite.close();
const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.addInitScript(({key,raw})=>{if(!sessionStorage.getItem(key))sessionStorage.setItem(key,raw);},{key:codec.workflowSessionKey,raw});
 const base='http://127.0.0.1:4181/workspace-preview/flow';await page.goto(`${base}?page=documents&scope=local&project=a`,{waitUntil:'networkidle'});
 const files=page.getByRole('region',{name:'내 파일 가져오기 목록'});await expect(files.getByRole('article')).toHaveCount(1);await expect(files.getByRole('heading',{name:'source-0.pdf',exact:true})).toBeVisible();await expect(files.getByLabel('여러 도면 파일 선택',{exact:true})).toBeDisabled();
 await page.reload({waitUntil:'networkidle'});await expect(files.getByRole('article')).toHaveCount(1);
 await page.getByRole('button',{name:'모든 도면 목록 보기',exact:true}).click();await expect(files.getByRole('article')).toHaveCount(100);
 console.log('PASS project-linked source filtering, global import capacity and explicit all-documents recovery');
}finally{await browser.close();}
