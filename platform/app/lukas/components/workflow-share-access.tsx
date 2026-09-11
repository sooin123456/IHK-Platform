import {useState} from 'react';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {requestShareAccess,decideShareAccess,type DocumentShare,type ShareAccess} from '../lib/workflow-document-share';
type Props={document:WorkflowBlankDocument;share:DocumentShare;onChange:(document:WorkflowBlankDocument)=>void};
const labels={pending:'요청 대기',allowed:'열람 재개 허용',denied:'요청 거절'};
export function ShareAccessRequest({document,share,onChange}:Props){
 const [message,setMessage]=useState('');const requests=share.accessRequests??[],pending=requests.some(request=>request.status==='pending');
 return <section className="flow-card" aria-label="공유 열람 재개 요청"><h2>열람 재개 요청 · 체험</h2><p>보내는 사람에게 같은 공유본의 열람 재개를 요청하는 화면입니다. 실제 알림·권한 변경은 발생하지 않습니다.</p>
 {requests.map(request=><article key={request.id} style={{overflowWrap:'anywhere'}}><h3>요청 #{request.id} · {labels[request.status]}</h3><p style={{whiteSpace:'pre-wrap'}}>{request.message}</p>{request.decision&&<p>결정 사유: {request.decision}</p>}</article>)}
 {!pending&&requests.length<20&&<><label className="flow-input">요청 사유<textarea aria-label="열람 재개 요청 사유" maxLength={500} value={message} onChange={event=>setMessage(event.target.value)}/></label><button disabled={!message.trim()} onClick={()=>{const next=requestShareAccess(document,share.sequence,message);if(next!==document){onChange(next);setMessage('');}}}>열람 재개 요청 보관 (체험)</button></>}
 {pending&&<p role="status">요청 대기 · 보내는 사람의 결정을 기다리는 체험 상태입니다.</p>}{requests.length>=20&&<p>공유당 요청 20개 한도입니다. 이전 이력은 유지됩니다.</p>}
 </section>;
}
export function AccessDecision({document,share,request,role,onChange}:Props&{request:ShareAccess;role:string}){
 const [decision,setDecision]=useState('');const allowed=role==='author'&&share.status==='expired'&&request.status==='pending';
 return <article className="flow-card" style={{overflowWrap:'anywhere'}}><h4>열람 요청 #{request.id} · {labels[request.status]}</h4><p style={{whiteSpace:'pre-wrap'}}>{request.message}</p>{request.decision&&<p>결정 사유: {request.decision}</p>}{request.status==='pending'&&<><label className="flow-input">열람 결정 사유<textarea aria-label={`공유 #${share.sequence} 요청 #${request.id} 결정 사유`} disabled={!allowed} maxLength={500} value={decision} onChange={event=>setDecision(event.target.value)}/></label><button disabled={!allowed||!decision.trim()} onClick={()=>onChange(decideShareAccess(document,share.sequence,request.id,role,'allow',decision))}>공유 #{share.sequence} 요청 #{request.id} 허용</button><button disabled={!allowed||!decision.trim()} onClick={()=>onChange(decideShareAccess(document,share.sequence,request.id,role,'deny',decision))}>공유 #{share.sequence} 요청 #{request.id} 거절</button><p>열람 재개 결정입니다. 도면·수량 승인이나 공유 범위 변경이 아닙니다.</p></>}</article>;
}
export function ShareAccessDecisions({document,share,role,onChange}:Props&{role:string}){return <>{(share.accessRequests??[]).map(request=><AccessDecision key={request.id} document={document} share={share} request={request} role={role} onChange={onChange}/>)}</>;}
