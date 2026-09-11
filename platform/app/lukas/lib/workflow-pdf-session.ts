// Tab-runtime only: no browser storage, network or PDF worker objects retained.
const files=new Map<string,File>();
const byteLimit=64*1024*1024;
export function recalledWorkflowPdf(hash:string){
 const file=files.get(hash);
 if(file){files.delete(hash);files.set(hash,file);}
 return file??null;
}
export function rememberWorkflowPdf(hash:string,file:File){
 if(!/^[a-f0-9]{64}$/.test(hash)||file.size>byteLimit)return;
 files.delete(hash);files.set(hash,file);
 while(files.size>3||[...files.values()].reduce((sum,file)=>sum+file.size,0)>byteLimit){
  const first=files.keys().next().value;if(first===undefined)break;files.delete(first);
 }
}
export function forgetWorkflowPdf(hash:string){files.delete(hash);}
