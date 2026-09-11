import {useEffect,useRef,useState} from 'react';
import {inspectSupportingFile,recallSupportingFile,supportingFileAccept,type SupportingFile} from '../lib/workflow-supporting-files';

export function SupportingFileRow({file,onVerified}:{file:SupportingFile;onVerified:()=>void}){
 const [,refresh]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const connected=Boolean(recallSupportingFile(file.sha256));
 return <div style={{overflowWrap:'anywhere'}}><p>{file.name} · {(file.size/1024).toFixed(1)}KB</p><details><summary>원본 식별 정보</summary><p>SHA-256: {file.sha256}</p></details>
  {connected?<button type="button" aria-label={`${file.name} 원본 다운로드`} onClick={()=>{
   const original=recallSupportingFile(file.sha256);if(!original){refresh(value=>value+1);onVerified();setError('임시 보관에서 해제되었습니다. 같은 원본을 다시 연결하세요.');return;}
   const url=URL.createObjectURL(new Blob([original],{type:'application/octet-stream'}));const link=document.createElement('a');link.href=url;link.download=file.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }}>연결 원본 다운로드</button>:<label className="flow-input">같은 원본 다시 연결<input type="file" accept={supportingFileAccept} aria-label={`${file.name} 원본 다시 연결`} disabled={busy} onChange={async event=>{const original=event.target.files?.[0];event.target.value='';if(!original)return;setBusy(true);setError('');try{await inspectSupportingFile(original,file);if(mounted.current){refresh(value=>value+1);onVerified();}}catch(error){if(mounted.current)setError(error instanceof Error?error.message:'파일을 연결할 수 없습니다.');}finally{if(mounted.current)setBusy(false);}}}/></label>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}

export function SupportingFileInput({files,onChange,onBusy,onVerified,label='제출 보조 파일 선택'}:{label?:string;files:SupportingFile[];onChange:(files:SupportingFile[])=>void;onBusy:(busy:boolean)=>void;onVerified:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;onBusy(false);};},[]);
 return <section aria-label={label+" 영역"}><h4>보조 자료 · {files.length}/5</h4><p>파일당 10MB 이하. 파일명·크기·해시만 탭과 백업에 저장합니다. 원본은 서버로 보내지 않으며 새로고침 후 다시 연결해야 합니다. 임시 원본 보관은 10개·64MB 이내입니다. 파일 내용·형식 정합·악성코드는 검사하지 않습니다.</p>
  <input type="file" accept={supportingFileAccept} aria-label={label} disabled={busy||files.length>=5} onChange={async event=>{const original=event.target.files?.[0];event.target.value='';if(!original)return;setBusy(true);onBusy(true);setError('');try{const file=await inspectSupportingFile(original);if(mounted.current){if(files.some(item=>item.sha256===file.sha256))setError('이미 첨부한 내용의 파일입니다.');else onChange([...files,file]);onVerified();}}catch(error){if(mounted.current)setError(error instanceof Error?error.message:'파일을 추가할 수 없습니다.');}finally{if(mounted.current){setBusy(false);onBusy(false);}}}}/>
  {error&&<p role="alert">{error}</p>}{files.map(file=><div key={file.sha256}><SupportingFileRow file={file} onVerified={onVerified}/><button type="button" aria-label={`${file.name} 첨부 제거`} disabled={busy} onClick={()=>onChange(files.filter(item=>item.sha256!==file.sha256))}>첨부 제거</button></div>)}
 </section>;
}
