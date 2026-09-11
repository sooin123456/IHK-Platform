import {useState} from 'react';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {addObjectComment,commentMatches} from '../lib/workflow-document-comments';
const roles={author:'작성자',reviewer:'검토자',approver:'승인자'};
export function WorkflowObjectComments({document,objectId,role,onChange}:{document:WorkflowBlankDocument;objectId:string;role:string;onChange:(doc:WorkflowBlankDocument)=>void}){
 const [text,setText]=useState('');const comments=document.objectComments?.filter(comment=>comment.objectId===objectId)??[];
 return <section className="flow-card" aria-label="선택 객체 댓글"><h3>객체 댓글 · {comments.length}건</h3><p>로컬 역할 체험의 의견입니다. 공식 질의·검토 요청·승인이 아니며 다른 사용자에게 전송하지 않습니다.</p>
 <label className="flow-input">의견<textarea aria-label="객체 댓글 입력" maxLength={1000} value={text} disabled={role==='viewer'} onChange={event=>setText(event.target.value)}/></label><button disabled={role==='viewer'||!text.trim()||(document.objectComments?.length??0)>=200} onClick={()=>{const next=addObjectComment(document,objectId,role,text);if(next!==document){onChange(next);setText('');}}}>댓글 보관</button>
 {(document.objectComments?.length??0)>=200&&<p>도면당 댓글 200건 보관 한도입니다. 기존 댓글은 유지됩니다.</p>}
 {comments.map(comment=><article key={comment.id}><strong>#{comment.id} · {roles[comment.role]} 체험 · R{comment.revision}</strong><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{comment.text}</p>{!commentMatches(document,comment)&&<p>작성 당시와 원본·개정·객체 위치가 다릅니다.</p>}</article>)}</section>;
}
export function WorkflowCommentInbox({documents,onOpen,search,onSearch}:{documents:WorkflowBlankDocument[];onOpen:(id:string,objectId:string,page:number)=>void;search:string;onSearch:(value:string)=>void}){
 const setSearch=onSearch;const records=documents.flatMap(doc=>(doc.objectComments??[]).map(comment=>({doc,comment})));
 const filtered=records.filter(({doc,comment})=>`${doc.title} ${comment.objectLabel} ${comment.text}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
 return <section className="flow-card" aria-label="내 도면 객체 댓글"><h2>내 도면 · 객체 댓글</h2><p>일반 의견 목록입니다. 공식 질의와 승인 기록은 별도입니다.</p><label className="flow-input">댓글 검색<input aria-label="객체 댓글 검색" value={search} onChange={event=>setSearch(event.target.value)}/></label>{search&&<button onClick={()=>setSearch('')}>댓글 검색 초기화</button>}<p>표시 {filtered.length}건 / 전체 {records.length}건</p>{!filtered.length&&<p>표시할 댓글이 없습니다. 작업실에서 객체를 선택하고 의견을 남기세요.</p>}
 {filtered.map(({doc,comment})=><article className="flow-card" key={`${doc.id}:${comment.id}`}><h3>{doc.title} · {comment.objectLabel}</h3><p>{comment.page}쪽 · R{comment.revision} · {roles[comment.role]} 체험</p><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{comment.text}</p><button disabled={!commentMatches(doc,comment)} onClick={()=>onOpen(doc.id,comment.objectId,comment.page)}>댓글 #{comment.id} 대상 열기</button>{!commentMatches(doc,comment)&&<p>원본·개정·객체 위치 재확인 필요. 현재 위치로 자동 연결하지 않습니다.</p>}</article>)}</section>;
}
