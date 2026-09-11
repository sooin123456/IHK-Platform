import {useState} from 'react';
import {useSearchParams} from 'react-router';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {createDocumentShare,expireDocumentShare,shareFeedback,respondShareInvitation,type DocumentShare} from '../lib/workflow-document-share';
import {WorkflowDraftShape} from './workflow-draft-shape';
import {WorkflowPdfBackground} from './workflow-prototype-pdf';
import {ShareAccessRequest,ShareAccessDecisions} from './workflow-share-access';
type Change=(document:WorkflowBlankDocument)=>void;
export function WorkflowLocalShare({document,role,onChange}:{document:WorkflowBlankDocument;role:string;onChange:Change}){
 const [,setParams]=useSearchParams();const [recipient,setRecipient]=useState(''),[permission,setPermission]=useState<'view'|'comment'>('view'),[includeQuantity,setIncludeQuantity]=useState(false),[notice,setNotice]=useState('');
 return <section className="flow-card" aria-label="내 도면 공유"><details><summary>내 도면 공유 설정</summary><p>같은 탭에서 받는 사람 화면을 체험합니다. 실제 초대·링크 발행·접근 권한 부여가 아닙니다. 공유 구성은 작성 당시 도면을 고정하며 도면 승인이나 납품을 대신하지 않습니다.</p>
 <p>공개 범위: 현재 표시되는 레이어의 모든 페이지 객체와 원본 PDF 참조. 숨긴 레이어·댓글·질의·승인 이력은 제외합니다. 원본 PDF는 전체 파일이므로 페이지별 비공개 처리가 아닙니다.</p>
 <form onSubmit={event=>{event.preventDefault();const next=createDocumentShare(document,role,{recipient,permission,includeQuantity});if(next===document){setNotice('작성자 역할·이메일·20개 구성 한도를 확인하세요.');return;}onChange(next);setNotice('공유 구성을 이 탭에 보관했습니다. 실제로 전송하지 않았습니다.');}}><fieldset disabled={role!=='author'||(document.shares?.length??0)>=20}>
 <label className="flow-input">받는 사람<input aria-label="내 도면 공유 수신자" type="email" maxLength={254} required value={recipient} onChange={event=>setRecipient(event.target.value)}/></label>
 <label className="flow-input">권한<select aria-label="내 도면 공유 권한" value={permission} onChange={event=>setPermission(event.target.value as typeof permission)}><option value="view">보기 전용</option><option value="comment">보기·의견</option></select></label>
 <label><input type="checkbox" checked={includeQuantity} onChange={event=>setIncludeQuantity(event.target.checked)}/> 수량·단가 근거도 공개</label><button disabled={!recipient.trim()} type="submit">공유 구성 보관 (체험)</button></fieldset></form><p role="status">{notice}</p>
 {(document.shares??[]).map(share=><article className="flow-card" key={share.sequence} style={{overflowWrap:'anywhere'}}><h3>공유 #{share.sequence} · R{share.revision}</h3><p>{share.recipient} · {share.permission==='view'?'보기 전용':'보기·의견'} · {share.status==='active'?'활성 체험':'만료'}</p><p>{share.invitation==='pending'?'초대 수락 대기':share.invitation==='accepted'?'초대 수락됨':share.invitation==='declined'?'초대 거절됨':'이전 공유 · 초대 확인 기록 없음'}</p><p>{share.objects.length}개 객체 · {share.includeQuantity?'수량·단가 포함':'수량·금액 미공개'}</p><button onClick={()=>setParams({sharedDocument:document.id,share:String(share.sequence)})}>공유 #{share.sequence} 받는 사람 화면</button><button disabled={role!=='author'||share.status==='expired'} onClick={()=>onChange(expireDocumentShare(document,share.sequence,role))}>공유 #{share.sequence} 만료 처리</button>{share.feedback.map((text,index)=><p key={index} style={{whiteSpace:'pre-wrap'}}>수신 의견 {index+1}: {text}</p>)}<ShareAccessDecisions document={document} share={share} role={role} onChange={onChange}/></article>)}
 </details></section>;
}
function SharedDrawing({share}:{share:DocumentShare}){
 const [page,setPage]=useState(share.objects[0]?.page??1);const pages=[...new Set([1,...share.objects.map(object=>object.page??1)])].sort((a,b)=>a-b);
 const drawing=<svg className="flow-blank-canvas" viewBox="0 0 800 520" preserveAspectRatio="none" role="img" aria-label="공유 도면 표시">{share.objects.filter(object=>(object.page??1)===page).map(object=><g key={object.id} role="img" aria-label={`공유 객체: ${object.label}`}><WorkflowDraftShape shape={object} selected={false}/></g>)}</svg>;
 return <section className="flow-card"><h2>공유 시점 도면 · R{share.revision}</h2><p>작성 시점의 구상 객체입니다. 승인 도면이나 실측 결과라는 의미는 아닙니다.</p>{share.source?<WorkflowPdfBackground source={share.source} page={page} onSource={()=>{}} onReady={()=>{}} onPage={setPage}>{drawing}</WorkflowPdfBackground>:<><label className="flow-input">페이지<select aria-label="공유 도면 페이지" value={page} onChange={event=>setPage(Number(event.target.value))}>{pages.map(value=><option key={value} value={value}>{value}쪽</option>)}</select></label>{drawing}</>}
 <ul>{share.objects.filter(object=>(object.page??1)===page).map(object=><li key={object.id}>{object.label||'이름 없는 객체'}{object.quantity&&<span> · 원수량 {object.quantity.raw} {object.quantity.unit} · 보정 {object.quantity.correction} · 단가 {object.quantity.rate.toLocaleString()}원 · 미확정 공유 근거</span>}</li>)}</ul></section>;
}
export function WorkflowLocalShareGuest({document,sequence,loading,onChange,onBack}:{document?:WorkflowBlankDocument;sequence:string|null;loading:boolean;onChange:Change;onBack:()=>void}){
 const [params]=useSearchParams();
 const [message,setMessage]=useState('');const share=document?.shares?.find(share=>String(share.sequence)===sequence);
 const invitationBlocked=share?.invitation==='pending'||share?.invitation==='declined';
 const problem=loading?'공유 자료 확인 중':!share?'공유 자료를 찾을 수 없습니다':share.status==='expired'?'공유가 만료되었습니다':null;
 return <div className="flow-app flow-recipient"><main className="flow-main" aria-label="로컬 도면 공유 열람"><header className="flow-top"><strong>1HK · 도면 공유</strong><span>받는 사람 체험</span></header><section className="flow-card"><p>같은 탭의 자료를 이용하는 프론트엔드 체험입니다. 실제 공유 링크·인증·메일 전송이 아니며 다른 브라우저에서는 열리지 않을 수 있습니다.</p>{problem?<><h1>{problem}</h1><p>다른 도면이나 최신 작업본으로 대체하지 않습니다.</p></>:invitationBlocked?<ShareInvitation key={`${document!.id}:${share!.sequence}`} document={document!} share={share!} onChange={onChange}/>:<><h1>{share!.title} · 공유 #{share!.sequence}</h1><p>{share!.recipient} · {share!.includeQuantity?'수량·단가 공개 · 확정 금액 아님':'수량·금액 미공개'}</p><SharedDrawing key={share!.sequence} share={share!}/>{share!.feedback.map((text,index)=><p key={index} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>의견 {index+1}: {text}</p>)}{share!.permission==='comment'?<><label className="flow-input">의견<textarea aria-label="공유 도면 의견" maxLength={500} value={message} onChange={event=>setMessage(event.target.value)}/></label><button disabled={!message.trim()||share!.feedback.length>=50} onClick={()=>{const next=shareFeedback(document!,share!.sequence,message);if(next!==document){onChange(next);setMessage('');}}}>공유 의견 보관 (체험)</button>{share!.feedback.length>=50&&<p>의견 50개 보관 한도입니다.</p>}</>:<p>보기 전용 공유입니다. 의견 작성·도면 편집·승인은 제공하지 않습니다.</p>}</>}
 {!loading&&share?.status==='expired'&&document&&<ShareAccessRequest document={document} share={share} onChange={onChange}/>}
 <button onClick={onBack}>{params.has('shareRequestsReturn')?'공유 요청함으로 돌아가기':'보내는 사람 작업실'}</button></section></main></div>;
}
function ShareInvitation({document,share,onChange}:{document:WorkflowBlankDocument;share:DocumentShare;onChange:Change}){
 const [email,setEmail]=useState(''),[error,setError]=useState('');
 if(share.invitation==='declined')return <section aria-label="공유 초대 거절"><h1>초대를 거절했습니다</h1><p>이 공유본은 표시하지 않습니다. 다시 참여하려면 보내는 사람에게 새 공유 구성을 요청하세요.</p></section>;
 const respond=(response:'accepted'|'declined')=>{
  const next=respondShareInvitation(document,share.sequence,email,response);
  if(next===document){setError('받는 사람 이메일과 일치하지 않습니다. 초대에 지정된 이메일을 확인하세요.');return;}
  onChange(next);
 };
 return <section aria-label="공유 초대 확인"><h1>도면 공유 초대</h1><p>{share.title} · R{share.revision} · {share.permission==='view'?'보기 전용':'보기·의견'}</p><p style={{overflowWrap:'anywhere'}}>받는 사람: {share.recipient}</p><p>{share.includeQuantity?'수량·단가가 포함된 공유본입니다.':'수량·단가는 공개하지 않습니다.'}</p><p>이메일 입력은 계정 선택 체험이며 실제 본인 인증이 아닙니다. 수락은 도면 승인과 다릅니다.</p>
 <form onSubmit={event=>{event.preventDefault();respond('accepted');}}><label className="flow-input">확인할 이메일<input aria-label="초대 확인 이메일" type="email" required maxLength={254} value={email} onChange={event=>{setEmail(event.target.value);setError('');}}/></label>
 {error&&<p role="alert">{error}</p>}<button type="submit" disabled={!email.trim()}>초대 수락 (체험)</button><button type="button" disabled={!email.trim()} onClick={()=>respond('declined')}>초대 거절 (체험)</button></form></section>;
}
