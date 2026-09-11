import {useSearchParams} from 'react-router';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {AccessDecision} from './workflow-share-access';
export function WorkflowShareInbox({documents,onChange}:{documents:WorkflowBlankDocument[];onChange:(document:WorkflowBlankDocument)=>void}){
 const [params,setParams]=useSearchParams();const search=params.get('shareRequestSearch')??'',role=params.get('shareRequestRole')??'author';
 const change=(key:string,value:string)=>setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set(key,value);else next.delete(key);return next;},{replace:true,preventScrollReset:true});
 const all=documents.flatMap(document=>(document.shares??[]).flatMap(share=>(share.accessRequests??[]).filter(request=>request.status==='pending').map(request=>({document,share,request}))));
 const records=all.filter(({document,share,request})=>`${document.title} ${share.recipient} ${request.message}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 return <section className="flow-card" aria-label="내 공유 요청함"><h2>공유 열람 재개 요청</h2><p>여러 도면의 처리 대기 요청입니다. 같은 탭의 역할 체험이며 실제 알림·계정 권한이나 도면 승인이 아닙니다.</p>
 <label className="flow-input">처리 역할<select aria-label="공유 요청 처리 역할" value={role} onChange={event=>change('shareRequestRole',event.target.value)}>{!['author','viewer'].includes(role)&&<option value={role} disabled>알 수 없는 역할 · 처리 불가</option>}<option value="author">보내는 사람 · 작성자 체험</option><option value="viewer">열람자 체험</option></select></label>
 <label className="flow-input">요청 검색<input aria-label="공유 요청 검색" value={search} onChange={event=>change('shareRequestSearch',event.target.value)}/></label>{search&&<button onClick={()=>change('shareRequestSearch','')}>공유 요청 검색 초기화</button>}
 <p role="status">대기 {records.length}건 / 전체 대기 {all.length}건</p>{!records.length&&<p>현재 조건에 맞는 요청이 없습니다. 처리한 이력은 해당 도면의 공유 설정에서 확인할 수 있습니다.</p>}
 {records.map(({document,share,request})=><section className="flow-card" key={`${document.id}:${share.sequence}:${request.id}`} style={{overflowWrap:'anywhere'}}><h3>{document.title} · 공유 #{share.sequence}</h3><p>{share.recipient} · 공유 당시 R{share.revision} · {share.permission==='view'?'보기 전용':'보기·의견'} · {share.includeQuantity?'수량·단가 포함':'수량·금액 미공개'}</p><button onClick={()=>setParams({sharedDocument:document.id,share:String(share.sequence),shareRequestsReturn:'1',shareRequestSearch:search,shareRequestRole:role})}>{document.title} 공유 #{share.sequence} 열람 화면</button><AccessDecision key={role} document={document} share={share} request={request} role={role} onChange={onChange}/></section>)}
 </section>;
}
