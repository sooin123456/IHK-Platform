import {useEffect,useRef,useState} from 'react';
import type {Handover} from '../lib/workflow-handover';
import {recallSupportingFile} from '../lib/workflow-supporting-files';
export function WorkflowHandoverExport({documentId,item}:{documentId:string;item:Handover}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const manuals=[...new Map(item.assets.flatMap(asset=>asset.manualFiles??[]).map(file=>[file.sha256,file])).values()],missing=manuals.filter(file=>!recallSupportingFile(file.sha256));
 return <section aria-label={`인계본 #${item.id} 자료 묶음`} style={{overflowWrap:'anywhere'}}><h4>인계 자료 묶음</h4>
  <p>자산·점검 정보(JSON) + 매뉴얼 {manuals.length}개 + 안내문. PDF·DWG·IFC 도면 원본과 현장 사진 원본은 제외합니다. 로컬 자료이며 공식 준공 승인·서버 전송·전자서명 증명이 아닙니다.</p>
  {missing.length>0&&<p>원본 미연결 {missing.length}개: {missing.map(file=>file.name).join(', ')}. 위 자산·점검 목록을 펼쳐 동일 파일을 다시 연결하세요.</p>}
  <button disabled={busy||missing.length>0} aria-label={`인계본 #${item.id} 자료 ZIP 다운로드`} onClick={async()=>{
   setBusy(true);setError('');try{
    const originals=manuals.map(file=>recallSupportingFile(file.sha256));if(originals.some(file=>!file))throw new Error('매뉴얼 원본을 다시 연결하세요.');
    const {createHandoverArchive}=await import('../lib/workflow-handover-export');
    const bytes=await createHandoverArchive(documentId,item,originals as File[]);if(!mounted.current)return;
    const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/zip'}));const link=document.createElement('a');link.href=url;link.download=`1hk-local-handover-${item.id}.zip`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }catch(error){if(mounted.current)setError(error instanceof Error?error.message:'자료 묶음을 만들지 못했습니다. 다시 시도하세요.');}finally{if(mounted.current)setBusy(false);}
  }}>{busy?'자료 묶는 중…':'로컬 자료 ZIP 다운로드'}</button>{error&&<p role="alert">{error}</p>}
 </section>;
}
