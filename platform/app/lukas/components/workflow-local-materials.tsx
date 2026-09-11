import {useState} from 'react';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {materialTotals,materialOrderTotals,materialOrderDue,recordMaterialEvent,materialEventSign,type MaterialEvent} from '../lib/workflow-document-materials';
import {quantityReviewMatches} from '../lib/workflow-quantity-review';
import {deliveryQuantityReview} from '../lib/workflow-document-delivery';
type Navigation={initialSequence?:string;initialObject?:string;onOpen:(documentId:string,sequence:number,objectId:string,page:number,revision:number)=>void};
const names={order:'발주',receive:'입고',install:'설치','cancel-order':'발주 취소',return:'반품',uninstall:'설치 철회'};
export function WorkflowLocalMaterials({documents,selectedId,onSelect,onChange,...navigation}:{documents:WorkflowBlankDocument[];selectedId?:string;onSelect:(id:string)=>void;onChange:(doc:WorkflowBlankDocument)=>void}&Navigation){
 const doc=selectedId?documents.find(doc=>doc.id===selectedId):documents[0];
 return <section className="flow-card" aria-label="내 도면 자재 관리"><h2>내 도면 · 자재 관리</h2><p>승인 수량을 기준으로 발주·입고·설치 흐름을 체험합니다. 실제 발주서 전송, 재고 처리, 검측 승인 또는 기성 청구가 아닙니다.</p>
 {documents.length>0&&<label className="flow-input">자재 기준 도면<select aria-label="자재 기준 도면" value={doc?.id??''} onChange={event=>onSelect(event.target.value)}>{!doc&&<option value="">도면 없음</option>}{documents.map(doc=><option key={doc.id} value={doc.id}>{doc.title}</option>)}</select></label>}
 {doc?<DocumentMaterials key={doc.id} document={doc} onChange={onChange} {...navigation}/>:<p>선택한 도면이 없거나 찾을 수 없습니다. 다른 도면의 수량으로 대체하지 않습니다.</p>}</section>;
}
function DocumentMaterials({document,onChange,initialSequence,initialObject,onOpen}:{document:WorkflowBlankDocument;onChange:(doc:WorkflowBlankDocument)=>void}&Navigation){
 const approved=document.quantityReviews?.filter(round=>round.phase==='approved')??[];
 const [sequence,setSequence]=useState(initialSequence!==undefined?Number(initialSequence):approved.at(-1)?.sequence??0);
 const round=approved.find(round=>round.sequence===sequence);
 const [objectId,setObjectId]=useState(initialObject??round?.items[0]?.id??'');
 const [role,setRole]=useState('author'),[kind,setKind]=useState<MaterialEvent['kind']>('order'),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),[message,setMessage]=useState('');
 const [recordedOn,setRecordedOn]=useState(''),[expectedOn,setExpectedOn]=useState(''),[supplier,setSupplier]=useState(''),[orderId,setOrderId]=useState('');
 const today=new Date().toLocaleDateString('sv-SE'),orders=(document.materialEvents??[]).filter(event=>event.sequence===sequence&&event.objectId===objectId&&event.kind==='order');
 const item=round?.items.find(item=>item.id===objectId),totals=materialTotals(document,sequence,objectId);
 const approvedAmount=item?item.quantity.raw+item.quantity.correction:0;
 const linkedDrawing=round&&deliveryQuantityReview(document,round.revision,round.sequence);
 if(!approved.length)return <p role="status">승인된 수량이 없습니다. 물량·비용에서 수량 검산·승인 흐름을 먼저 완료하세요.</p>;
 return <>
 {!round||!item?<p role="alert">선택한 승인 기준 또는 객체를 찾을 수 없습니다. 아래에서 기준을 다시 선택하세요.</p>:null}
 <label className="flow-input">자재 체험 역할<select aria-label="자재 체험 역할" value={role} onChange={event=>setRole(event.target.value)}><option value="author">작성자</option><option value="viewer">열람자</option></select></label>
 <label className="flow-input">승인 수량 기준<select aria-label="승인 수량 기준" value={sequence} onChange={event=>{const next=approved.find(round=>round.sequence===Number(event.target.value));setSequence(next?.sequence??0);setObjectId(next?.items[0]?.id??'');setAmount('');setReason('');setMessage('');setOrderId('');setRecordedOn('');setExpectedOn('');setSupplier('');}}>{approved.map(round=><option key={round.sequence} value={round.sequence}>검산 #{round.sequence} · R{round.revision}</option>)}</select></label>
 <p>개정별 기록은 별도입니다. 이전 개정의 발주·입고 실적이 자동 이월되거나 합산되지 않습니다.</p>
 <label className="flow-input">자재 연결 객체<select aria-label="자재 연결 객체" value={objectId} onChange={event=>{setObjectId(event.target.value);setAmount('');setReason('');setMessage('');setOrderId('');setRecordedOn('');setExpectedOn('');setSupplier('');}}>{round?.items.map(item=><option key={item.id} value={item.id}>{item.label} · {item.page}쪽</option>)}</select></label>
 {round&&item&&<><p>{round.source.name} · {item.page}쪽 · R{round.revision} · {item.label}</p><p>승인 수량 {approvedAmount} {item.quantity.unit}</p><details><summary>승인 원본 근거</summary><p style={{overflowWrap:'anywhere'}}>SHA-256 {round.source.sha256}</p><p>산출 사유: {item.quantity.reason}</p></details>
 <button disabled={!linkedDrawing} onClick={()=>onOpen(document.id,sequence,item.id,item.page,round.revision)}>승인 도면에서 위치 확인</button>
 {!linkedDrawing&&<p>이 수량과 일치하는 승인 도면이 없습니다. 현재 도면으로 대신 연결하지 않습니다.</p>}
 {!quantityReviewMatches(document,round)&&<p role="status">현재 도면과 다른 승인 기준입니다. 아래 기록은 선택한 과거 승인에만 연결됩니다.</p>}
 <dl><dt>누적 발주</dt><dd>{totals.order} {item.quantity.unit}</dd><dt>누적 입고</dt><dd>{totals.receive} {item.quantity.unit}</dd><dt>누적 설치</dt><dd>{totals.install} {item.quantity.unit}</dd><dt>미입고</dt><dd>{totals.order-totals.receive} {item.quantity.unit}</dd><dt>미설치</dt><dd>{totals.receive-totals.install} {item.quantity.unit}</dd></dl>
 {totals.order>approvedAmount&&<p role="status">발주 수량이 승인 수량을 초과합니다. 손실·여유분 및 변경 사유를 확인하세요.</p>}
 </>}
 <section className="flow-card" aria-label="발주별 납기 현황"><h3>발주별 납기 현황</h3><p>확인 기준일: {today}. 발주에 직접 연결한 실적만 계산합니다. 공통 기록은 임의 배분하지 않으므로 실제 미입고 여부는 공통 기록과 대조하세요.</p>{!orders.length&&<p>아직 발주 기록이 없습니다.</p>}{orders.map(order=>{const linked=materialOrderTotals(document,order.id),status=materialOrderDue(document,order.id,today);return <article key={order.id}><h4>발주 #{order.id} · {order.supplier??'공급처 미등록'}</h4><p>발주일 {order.recordedOn??'미등록'} · 예정 납기 {order.expectedOn??'미등록'}</p><p>{{missing:'발주 없음',cancelled:'발주 취소됨',received:'연결 입고 완료',unknown:'납기 미등록',late:'납기 경과 · 연결 입고 확인 필요',due:'오늘 납기 · 입고 확인 필요',planned:'납기 예정'}[status]}</p><p>유효 발주 {linked.order} · 연결 입고 {linked.receive} · 연결 미입고 {linked.order-linked.receive} {item?.quantity.unit}</p>{role==='author'&&<button onClick={()=>{setKind('receive');setOrderId(String(order.id));setAmount('');setReason('');setMessage('');}}>발주 #{order.id} 입고 기록하기</button>}</article>;})}</section>
 <fieldset disabled={role!=='author'||!item}><label className="flow-input">처리 구분<select aria-label="자재 처리 구분" value={kind} onChange={event=>setKind(event.target.value as MaterialEvent['kind'])}>{Object.entries(names).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>{kind==='order'?<><label className="flow-input">발주일 (선택)<input aria-label="발주일" type="date" value={recordedOn} onChange={event=>setRecordedOn(event.target.value)}/></label><label className="flow-input">예정 납기 (선택)<input aria-label="예정 납기" type="date" value={expectedOn} onChange={event=>setExpectedOn(event.target.value)}/></label><label className="flow-input">공급처 (선택)<input aria-label="공급처" maxLength={120} value={supplier} onChange={event=>setSupplier(event.target.value)}/></label><p>납기를 입력하면 발주일도 입력하세요. 납기는 발주일보다 빠를 수 없습니다.</p></>:<label className="flow-input">연결 발주<select aria-label="연결 발주" value={orderId} onChange={event=>setOrderId(event.target.value)}><option value="">공통 기록 · 발주 미지정</option>{orders.map(order=><option key={order.id} value={order.id}>발주 #{order.id} · {order.supplier??'공급처 미등록'}</option>)}</select></label>}<label className="flow-input">추가 수량<input aria-label="자재 추가 수량" type="number" min="0" step="any" value={amount} onChange={event=>setAmount(event.target.value)}/></label><label className="flow-input">처리 사유<textarea aria-label="자재 처리 사유" maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></label><button disabled={!reason.trim()||!(Number(amount)>0)} onClick={()=>{const next=recordMaterialEvent(document,role,{sequence,objectId,kind,amount:Number(amount),reason,...(kind==='order'?{...(recordedOn?{recordedOn}:{}),...(expectedOn?{expectedOn}:{}),...(supplier.trim()?{supplier:supplier.trim()}:{})}:orderId?{orderId:Number(orderId)}:{})});if(next===document){setMessage('기록할 수 없습니다. 발주 날짜·납기와 연결 발주를 확인하세요. 누적 입고는 발주 이하, 설치는 입고 이하이어야 하며 기록 한도는 500건입니다.');return;}onChange(next);setAmount('');setReason('');setMessage('로컬 자재 기록을 보관했습니다.');}}>자재 기록 보관</button></fieldset>
 <p>누계는 취소·반품·설치 철회를 반영한 현재 수량입니다. 차감할 때도 양수 수량을 입력하며 원래 기록은 삭제하지 않습니다. 이미 입고된 수량은 먼저 반품하고, 설치된 수량은 먼저 설치 철회해야 합니다.</p>
 <p role="status">{message}</p><h3>선택 기준 처리 이력</h3>{(document.materialEvents??[]).filter(event=>event.sequence===sequence&&event.objectId===objectId).map(event=><p key={event.id}>#{event.id} {names[event.kind]} {materialEventSign(event.kind)>0?'+':'−'}{event.amount} {item?.quantity.unit} · {event.reason}{event.orderId?` · 발주 #${event.orderId} 연결`:' · 공통 기준'}</p>)}
 </>;
}
