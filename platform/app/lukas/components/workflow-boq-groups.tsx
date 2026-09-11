import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {useSearchParams} from 'react-router';
import {groupDocumentBoq} from '../lib/workflow-boq-groups';
const number=(value:number)=>value.toLocaleString('ko-KR',{maximumFractionDigits:3});
export function WorkflowBoqGroups({documents,onOpen}:{documents:WorkflowBlankDocument[];onOpen:(id:string,target:string,page:number)=>void}){
 const result=groupDocumentBoq(documents);
 const [params,setParams]=useSearchParams();const query=params.get('boqQuery')??'',expanded=params.get('boqGroup')??'';
 const term=query.trim().toLocaleLowerCase();
 const visible=result.groups.filter(group=>[group.label,group.basis,group.unit,...group.items.map(item=>`${item.document.title} ${item.shape.label}`)].join(' ').toLocaleLowerCase().includes(term));
 const search=(value:string)=>setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set('boqQuery',value);else next.delete('boqQuery');return next;},{replace:true,preventScrollReset:true});
 return <section className="flow-card" aria-label="항목별 내역 집계"><h2>항목별 내역 집계</h2>
 <p>같은 단가 코드·버전·출처·단위·금액의 연결 객체를 묶습니다. 항목 코드가 없는 직접 입력은 객체별로 유지합니다. 공종 자동 분류나 내역 승인 결과가 아닙니다.</p>
 <p>미확정 합계 {number(result.total)}원 · {result.groups.length}개 묶음</p><p>미연결 {result.missing}건 · 근거 재확인 {result.stale}건 제외. 부가세·제경비 미포함, 원 단위 반올림한 객체별 금액의 합계입니다.</p>
 {!result.groups.length&&<p>집계할 연결 수량이 없습니다. 아래 객체 목록에서 수량·단가 근거를 확인하세요.</p>}
 <label className="flow-input">내역 묶음 검색<input aria-label="내역 묶음 검색" type="search" maxLength={200} value={query} onChange={event=>search(event.target.value)} placeholder="항목·코드·출처·도면·객체"/></label><button onClick={()=>search('')}>내역 검색 초기화</button>
 <p role="status">표시 {visible.length} / 전체 {result.groups.length}개 묶음 · 표시 소계 {number(visible.reduce((sum,group)=>sum+group.amount,0))}원</p><p>연결 객체가 검색에 맞으면 해당 묶음 전체를 표시합니다. 개별 객체만의 소계가 아닙니다.</p>
 {query&&visible.length===0&&<p>검색 결과가 없습니다. 검색어를 지워 전체 항목을 확인하세요.</p>}
 {expanded&&!result.groups.some(group=>group.key===expanded)&&<p role="status">이전에 펼친 묶음이 변경되었거나 집계에서 제외되었습니다. 다른 묶음을 자동으로 열지 않습니다.</p>}
 {visible.map(group=><article className="flow-card" key={group.key} style={{overflowWrap:'anywhere'}}><h3>{group.label}</h3><p>{group.basis}</p><p>{number(group.quantity)} {group.unit} · 단가 {number(group.rate)}원/{group.unit} · 소계 {number(group.amount)}원</p>
 <details open={expanded===group.key}><summary onClick={event=>{event.preventDefault();setParams(previous=>{const next=new URLSearchParams(previous);if(expanded===group.key)next.delete('boqGroup');else next.set('boqGroup',group.key);return next;},{replace:true,preventScrollReset:true});}}>연결 객체 {group.items.length}건</summary><ul>{group.items.map(({document,shape})=><li key={`${document.id}:${shape.id}`}><button onClick={()=>onOpen(document.id,shape.id,shape.page??1)}>{document.title} · {shape.label||'이름 없는 객체'} · {shape.page??1}쪽 근거</button></li>)}</ul></details></article>)}
 </section>;
}
