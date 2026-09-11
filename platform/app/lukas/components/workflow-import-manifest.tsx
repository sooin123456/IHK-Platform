import {useEffect,useRef,useState} from 'react';
import type {ImportRecord} from '../lib/workflow-import-manifest';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {localPdfFingerprint} from '../lib/drawing-pdf-screen-handoff';
import {rememberWorkflowPdf} from '../lib/workflow-pdf-session';
export function WorkflowImportManifest({records,documents,onAdd,onOpen,disabled,totalRecordCount=records.length,projectFiltered=false}:{records:ImportRecord[];documents:WorkflowBlankDocument[];onAdd:(record:ImportRecord)=>void;onOpen:(id:string)=>void;disabled:boolean;totalRecordCount?:number;projectFiltered?:boolean}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');const controller=useRef<AbortController|null>(null);
 useEffect(()=>()=>controller.current?.abort(),[]);
 async function inspect(files:File[],retry?:ImportRecord){
  if(!files.length)return;if(files.length>10){setNotice('한 번에 최대 10개를 선택하세요. 이번 선택은 처리하지 않았습니다.');return;}
  if(retry&&(files.length!==1||files[0].name!==retry.name||files[0].size!==retry.size)){setNotice('기존 파일의 이름과 크기가 일치해야 합니다. 다른 파일은 새 선택으로 추가하세요.');return;}
  if(!retry&&files.length>100-totalRecordCount){setNotice('목록은 최대 100개입니다. 남은 수만큼 파일을 선택하세요.');return;}
  const selected=files.map(file=>{const extension=file.name.split('.').at(-1)?.toUpperCase();const format:ImportRecord['format']=extension==='PDF'||extension==='DWG'||extension==='IFC'?extension:'OTHER';return {file,record:retry?{...retry,status:'pending' as const}:{id:crypto.randomUUID(),name:file.name,size:file.size,format,status:'pending' as const}};});
  for(const {record} of selected)onAdd(record);
  const task=new AbortController();controller.current=task;setBusy(true);setNotice('파일 확인 중 · 화면을 떠나도 미완료 선택 내역은 남습니다. 돌아와 파일을 다시 선택해 확인하세요.');let problem='';
  try{for(const {file,record:initial} of selected){
   if(task.signal.aborted)return;
   let record:ImportRecord=initial;const format=record.format;
   let url:string|undefined,opened:{destroy:()=>Promise<void>}|undefined;
   try{
    if(file.size<=0||file.size>50*1024*1024)throw new Error('size');
    const hash=await localPdfFingerprint(file);if(task.signal.aborted)return;
    if(record.sha256&&record.sha256!==hash)throw new Error('등록한 파일과 내용이 다릅니다. 확인된 원본을 다시 선택하세요.');
    record={...record,sha256:hash};onAdd(record);
    if(format==='PDF'){
     const reader=await import('../lib/pdf-page-renderer.client');if(task.signal.aborted)return;
     url=URL.createObjectURL(file);const result=await reader.openPdfDocument(url,task.signal);opened=result;
     if(task.signal.aborted)return;
     record={...record,status:'ready',pages:result.document.numPages};rememberWorkflowPdf(record.sha256!,file);
    }else record={...record,status:format==='OTHER'?'unsupported':'needs-engine'};
   }catch(error){if(error instanceof Error&&error.message.includes('내용이 다릅니다'))problem=error.message;record={...record,status:'failed'};}
   finally{if(opened)await opened.destroy();if(url)URL.revokeObjectURL(url);}
   if(task.signal.aborted)return;onAdd(record);
  }setNotice(problem||'선택 처리를 마쳤습니다. 동일 내용·형식의 파일은 중복 추가하지 않습니다.');}
  finally{if(!task.signal.aborted)setBusy(false);}
 }
 const labels={pending:'확인 미완료 · 파일 재선택 필요',ready:'실제 PDF 열람 준비',failed:'파일 확인 실패',unsupported:'지원하지 않는 형식','needs-engine':'분석 엔진 미연결'};
 return <section className="flow-card" aria-label="내 파일 가져오기 목록"><h2>내 파일 가져오기</h2>{projectFiltered&&<p>선택 프로젝트에 연결된 원본과 아직 도면에 연결하지 않은 공용 준비 파일만 표시합니다. 다른 프로젝트에 연결된 원본은 전체 도면 목록에서 확인하세요.</p>}<p>한 번에 10개, 파일당 50MB 이하 · 목록 최대 100개. 파일을 서버로 전송하지 않습니다. 이름·해시·결과만 이 탭에 보관하고, 원본 바이트는 백업에 포함하지 않습니다.</p>
 <label className="flow-input">PDF·DWG·IFC 선택<input aria-label="여러 도면 파일 선택" type="file" multiple accept=".pdf,.dwg,.ifc" disabled={disabled||busy||totalRecordCount>=100} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';void inspect(files);}}/></label>
 <p role="status">{notice}</p>{!records.length&&<p>선택한 파일이 없습니다. 파일 없이 빈 작업실로 시작할 수도 있습니다.</p>}
 {records.map(record=>{const missing=Boolean(record.documentId&&!documents.some(doc=>doc.id===record.documentId));return <article className="flow-card" key={record.id} style={{overflowWrap:'anywhere'}}><h3>{record.name}</h3><p>{record.format} · {record.size.toLocaleString()} bytes · {labels[record.status]}</p>
 {record.sha256&&<details><summary>파일 식별 근거</summary><p>SHA-256: {record.sha256}</p></details>}
 {record.status==='ready'&&<><p>{record.pages}쪽 · 새로고침 뒤 원본을 다시 선택해야 할 수 있습니다. 작업실에서 같은 해시의 PDF만 재연결합니다.</p><button disabled={disabled||busy||missing||(!record.documentId&&documents.length>=30)} onClick={()=>onOpen(record.id)}>{record.name} 작업실 열기</button>{missing&&<p>연결된 도면이 없습니다. 다른 도면으로 대체하지 않습니다.</p>}{!record.documentId&&documents.length>=30&&<p>작업 도면 30개 한도입니다.</p>}</>}
 {record.status==='needs-engine'&&<p>이 파일의 형상·단위·글꼴·외부참조는 분석하지 않았습니다. 실제 편집·DWG 재저장·납품이 가능하다는 의미가 아닙니다. PDF로 준비하면 원본 도면을 확인할 수 있습니다.</p>}
 {record.status==='unsupported'&&<p>PDF·DWG·IFC를 선택하세요. 이 파일로 작업실을 만들지 않았습니다.</p>}
 {record.status==='failed'&&<p>빈 파일·50MB 초과·손상·암호 설정을 확인하세요. 원본을 확인한 뒤 다시 선택할 수 있습니다.</p>}
 {(record.status==='pending'||record.status==='failed')&&<><p>{record.sha256?'이미 확인된 해시와 같은 파일만 재시도합니다.':'아직 내용 식별을 완료하지 않았습니다. 같은 이름·크기의 파일을 선택하면 내용을 다시 확인합니다.'}</p><label className="flow-input">파일 다시 확인<input aria-label={`${record.name} 확인 다시 진행`} type="file" disabled={disabled||busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void inspect([file],record);}}/></label></>}
 </article>;})}</section>;
}
