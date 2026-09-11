import {useState} from 'react';
import {distributionManifest,type TransmittalRow} from '../lib/workflow-transmittals';
export function WorkflowDistributionManifest({rows,batchId,onRecipient}:{rows:TransmittalRow[];batchId:string;onRecipient:(id:string,sequence:number)=>void}){
 const [message,setMessage]=useState('');
 const manifest=distributionManifest(rows,batchId);
 if(!manifest)return null;
 const reference=manifest.drawings[0].reference??'번호 없는 묶음';
 const download=()=>{let url:string|undefined;try{url=URL.createObjectURL(new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='1hk-distribution-manifest.json';link.click();setMessage('구성 명세 다운로드를 요청했습니다. 원본 도면 파일은 포함하지 않습니다.');}catch{setMessage('구성 명세를 내려받지 못했습니다. 다시 시도하세요.');}finally{if(url){const downloadedUrl=url;setTimeout(()=>URL.revokeObjectURL(downloadedUrl),1000);}}};
 return <details><summary>{reference} 묶음 구성 상세</summary><section aria-label={reference+' 묶음 명세'}><p>승인 개정의 원본 참조와 현재 수신 기록을 확인합니다. 도면명은 현재 목록의 이름입니다. 원본 PDF·DWG·검산 파일이나 실제 전송·수신 증명은 포함하지 않습니다.</p>
  {manifest.drawings.map(item=><article className="flow-card" key={item.documentId+':'+item.packageSequence}><h5>{item.currentDocumentTitle} · 승인 R{item.revision}</h5><p>문서번호 {item.reference??'미기재'} · 발행일 {item.issuedOn??'미기재'} · 수신 대상 {item.recipient}</p>
   {item.source?<><p>{item.source.name} · {item.source.pages}페이지 · 승인 객체 {item.approvedObjectCount}개</p><p style={{overflowWrap:'anywhere'}}>원본 SHA-256: {item.source.sha256}</p></>:<p role="status">승인 원본 근거를 찾을 수 없습니다. 현재 작업 파일로 대체하지 않습니다.</p>}
   <p>{item.status==='received'?'수신 확인됨 (체험)':item.status==='correction'?'보완 요청 (체험)':'수신 대기'} · {item.current?'현재 구성':'이전 구성 · 읽기 전용'}{item.linkStatus==='expired'?' · 링크 만료':''}</p>{item.feedback&&<p>수신 의견: {item.feedback}</p>}
   <button disabled={!item.available} aria-label={item.currentDocumentTitle+' 묶음 원본 수신 화면'} onClick={()=>onRecipient(item.documentId,item.packageSequence)}>개별 수신 화면 열기</button>
  </article>)}
  <button aria-label={reference+' 구성 명세 JSON 다운로드'} onClick={download}>구성 명세 JSON 다운로드</button>{message&&<p role="status">{message}</p>}
 </section></details>;
}
