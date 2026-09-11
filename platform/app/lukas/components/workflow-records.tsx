import {useSearchParams} from 'react-router';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {workflowRecords,filterWorkflowRecords,recordKinds,type WorkflowRecord} from '../lib/workflow-records';
export function WorkflowReviewRecord({documents,documentId,revision}:{documents:WorkflowBlankDocument[];documentId:string;revision:string}){
 const round=documents.find(doc=>doc.id===documentId)?.reviewRounds?.find(row=>String(row.revision)===revision);
 return <section className="flow-card" aria-label="검토 기록 원본" style={{overflowWrap:'anywhere'}}>
  <h2>검토 기록 원본{round?` · R${round.revision}`:''}</h2>
  {!round?<p role="alert">선택한 검토 기록을 찾을 수 없습니다. 최신 도면으로 대체하지 않습니다. 프로젝트 기록으로 돌아가 다시 선택하세요.</p>:<>
   <p>{({requested:'검토 요청',changes:'수정 요청',reviewed:'검토 완료',approved:'승인됨'})[round.phase]} · 읽기 전용</p>
   <p>검토 요청 당시 보관한 객체와 원본 식별 정보입니다. 현재 편집 상태나 원본 파일 전체를 대신하지 않으며, 서버 감사 증명이 아닙니다.</p>
   <dl><dt>원본 파일</dt><dd>{round.source.name}</dd><dt>SHA-256</dt><dd>{round.source.sha256}</dd><dt>페이지 수</dt><dd>{round.source.pages}</dd><dt>요청 의견</dt><dd style={{whiteSpace:'pre-wrap'}}>{round.message}</dd><dt>검토 의견</dt><dd style={{whiteSpace:'pre-wrap'}}>{round.reviewNote||'아직 없음'}</dd><dt>승인 의견</dt><dd style={{whiteSpace:'pre-wrap'}}>{round.approvalNote||'아직 없음'}</dd></dl>
   <h3>당시 객체 · {round.objects.length}개</h3>
   {round.objects.map(shape=><article key={shape.id} className="flow-card"><h4>{shape.label}{shape.id===round.targetId?' · 검토 대상':''}</h4><p>{shape.kind??'rectangle'} · {shape.page??1}쪽 · X {shape.x}, Y {shape.y}</p>{shape.quantity&&<p>수량 근거: {shape.quantity.basis}</p>}</article>)}
  </>}
 </section>;
}
export function WorkflowRecords({documents,onOpen}:{documents:WorkflowBlankDocument[];onOpen:(record:WorkflowRecord)=>void}){
 const [params,setParams]=useSearchParams();const search=params.get('recordSearch')??'',kind=params.get('recordKind')??'',documentId=params.get('recordDocument')??'';
 const change=(patch:Record<string,string>)=>setParams(previous=>{const next=new URLSearchParams(previous);for(const[key,value]of Object.entries(patch)){if(value)next.set(key,value);else next.delete(key);}next.delete('recordLimit');return next;},{replace:true,preventScrollReset:true});
 const rows=workflowRecords(documents),visible=filterWorkflowRecords(rows,{search,kind,document:documentId});
 const count=Math.min(500,Math.max(50,Number(params.get('recordLimit'))||50));
 return <section className="flow-card" aria-label="프로젝트 기록 찾아보기"><h2>프로젝트 기록 찾아보기</h2><p>이 탭에 보관된 업무 기록을 종류별로 모았습니다. 발생 시간순 활동 로그나 서버 감사 증명이 아닙니다. 기록의 현재 상태를 표시하며, 일부 항목은 해당 도면의 기록 목록을 엽니다.</p>
  <label className="flow-input">기록 검색<input aria-label="기록 검색" value={search} onChange={event=>change({recordSearch:event.target.value})} placeholder="도면·제목·내용·상태"/></label>
  <label className="flow-input">기록 종류<select aria-label="기록 종류" value={kind} onChange={event=>change({recordKind:event.target.value})}><option value="">전체 종류</option>{kind&&!Object.hasOwn(recordKinds,kind)&&<option value={kind}>알 수 없는 종류</option>}{Object.entries(recordKinds).map(([key,title])=><option key={key} value={key}>{title}</option>)}</select></label>
  <label className="flow-input">기록 도면<select aria-label="기록 도면" value={documentId} onChange={event=>change({recordDocument:event.target.value})}><option value="">현재 프로젝트의 모든 도면</option>{documentId&&!documents.some(doc=>doc.id===documentId)&&<option value={documentId}>선택했던 도면 없음</option>}{documents.map(doc=><option key={doc.id} value={doc.id}>{doc.title}</option>)}</select></label>
  <button onClick={()=>change({recordSearch:'',recordKind:'',recordDocument:''})}>기록 필터 초기화</button><p role="status">전체 {rows.length}건 · 조건 일치 {visible.length}건 · 표시 {Math.min(count,visible.length)}건</p>
  {!rows.length?<p>아직 보관된 업무 기록이 없습니다. 작업실에서 검토·질의 등을 진행하면 여기에 나타납니다.</p>:!visible.length?<p>조건에 맞는 기록이 없습니다. 검색 또는 필터를 초기화하세요.</p>:visible.slice(0,count).map(row=><article key={row.key} className="flow-card" style={{overflowWrap:'anywhere'}}><p>{recordKinds[row.kind]} · {row.documentTitle} · {row.status}</p><h3>{row.title}</h3><p style={{whiteSpace:'pre-wrap'}}>{row.summary}</p><button aria-label={row.title+' 기록 화면'} onClick={()=>onOpen(row)}>기록 화면 열기</button></article>)}
  {visible.length>count&&count<500&&<button onClick={()=>setParams(previous=>{const next=new URLSearchParams(previous);next.set('recordLimit',String(count+50));return next;},{replace:true,preventScrollReset:true})}>기록 50건 더 보기</button>}{visible.length>500&&count>=500&&<p>500건을 표시했습니다. 도면·종류·검색으로 범위를 좁혀주세요.</p>}
 </section>;
}
