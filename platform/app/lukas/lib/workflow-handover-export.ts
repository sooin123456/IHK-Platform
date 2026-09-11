import type {Handover} from './workflow-handover';

export async function createHandoverArchive(documentId:string,item:Handover,originals:File[]):Promise<Uint8Array>{
 const metadata=[...new Map(item.assets.flatMap(asset=>asset.manualFiles??[]).map(file=>[file.sha256,file])).values()];
 if(originals.reduce((sum,file)=>sum+file.size,0)>64*1024*1024)throw new Error('원본 합계는 64MB 이하로 준비하세요.');
 const byHash=new Map<string,Uint8Array>();
 for(const file of originals){const bytes=new Uint8Array(await file.arrayBuffer());const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');byHash.set(hash,bytes);}
 const content:Record<string,Uint8Array>={},manuals=metadata.map(file=>{
  const bytes=byHash.get(file.sha256);if(!bytes||bytes.length!==file.size)throw new Error(`${file.name}: 같은 원본을 다시 연결하세요.`);
  const extension=file.name.match(/\.(pdf|docx|xlsx|csv|txt|png|jpe?g)$/i)?.[1].toLowerCase()??'bin';
  const path=`manuals/${file.sha256}.${extension}`;content[path]=bytes;return {path,originalName:file.name,sha256:file.sha256,size:file.size};
 });
 const {zipSync,strToU8}=await import('fflate');
 content['handover.json']=strToU8(JSON.stringify({format:'1hk-local-handover',version:1,simulated:true,includesDrawingOriginal:false,documentId,handover:item,manuals},null,2));
 content['README.txt']=strToU8('1HK 로컬 인계 자료\n인계 당시 자산·점검 정보와 연결한 매뉴얼 원본입니다. PDF/DWG/IFC 도면 원본 및 현장 사진 원본은 포함하지 않습니다. 서버 전송·공식 준공 승인·전자서명·법적 인계 증명이 아닙니다. 파일 내용과 안전성은 별도 확인하세요.');
 return zipSync(content,{level:0});
}
