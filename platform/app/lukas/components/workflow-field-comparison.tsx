import type {DocumentFieldNote} from '../lib/workflow-document-field';
import {FieldPhotoPreview} from './workflow-field-photos';
export function WorkflowFieldComparison({documentId,records,drafts,onDraft,onInspect}:{documentId:string;records:DocumentFieldNote[];drafts:Record<string,string>;onDraft:(patch:Record<string,string>)=>void;onInspect:(id:number)=>void}){
 const key=`field-compare:${documentId}:`,value=(name:string)=>drafts[key+name]??'';
 const first=records.find(record=>String(record.id)===value('first'));
 const candidates=first?records.filter(record=>record.id!==first.id&&record.objectId===first.objectId&&record.source.sha256===first.source.sha256&&record.page===first.page&&record.x===first.x&&record.y===first.y&&record.location===first.location&&JSON.stringify(record.locationPath??null)===JSON.stringify(first.locationPath??null)):[];
 const second=candidates.find(record=>String(record.id)===value('second'));
 const label=(record:DocumentFieldNote)=>`#${record.id} · ${record.observedOn??'날짜 미기록'} · ${record.title}`;
 return <section className="flow-card" aria-label="현장 사진 비교"><details open={value('open')==='1'} onToggle={event=>onDraft({[key+'open']:event.currentTarget.open?'1':'0'})}><summary>같은 위치의 현장 사진 비교</summary>
  <p>같은 원본·페이지·객체·기록 위치의 두 관찰을 나란히 확인합니다. 촬영 각도 정합, AI 차이 탐지, 시공 적합 판정은 수행하지 않습니다. 날짜는 사용자가 입력한 관찰일이며 사진 촬영 시각 인증이 아닙니다.</p>
  <label className="flow-input">기준 현장 기록<select aria-label="기준 현장 기록" value={first?String(first.id):''} onChange={event=>onDraft({[key+'first']:event.target.value,[key+'second']:''})}><option value="">기준 기록 선택</option>{records.map(record=><option key={record.id} value={record.id}>{label(record)}</option>)}</select></label>
  <label className="flow-input">비교 현장 기록<select aria-label="비교 현장 기록" value={second?String(second.id):''} disabled={!first} onChange={event=>onDraft({[key+'second']:event.target.value})}><option value="">같은 위치의 다른 기록 선택</option>{candidates.map(record=><option key={record.id} value={record.id}>{label(record)}</option>)}</select></label>
  {first&&!candidates.length&&<p>같은 위치의 다른 관찰 기록이 없습니다. 현장 기록을 추가한 뒤 비교하세요.</p>}
  {((value('first')&&!first)||(value('second')&&!second))&&<p role="alert">선택 기록이 없거나 비교 위치가 다릅니다. 다른 기록으로 대체하지 않습니다.</p>}
  {first&&second&&<><div className="flow-grid-two">{[first,second].map((record,index)=><article key={record.id} aria-label={index===0?'기준 관찰':'비교 관찰'}><h4>{index===0?'기준':'비교'} · {label(record)}</h4><p>{record.location} · {record.objectLabel} · R{record.revision}</p><p>{record.note}</p>{record.photos?.length?record.photos.map(photo=><FieldPhotoPreview key={`${record.id}:${photo.sha256}`} photo={photo}/>):<p>이 기록에는 사진이 없습니다.</p>}</article>)}</div>
   <button onClick={()=>onInspect(second.id)}>비교 기록 검측 확인</button><p>비교 결과를 승인하지 않습니다. 선택한 기록의 검측·시정 이력을 확인합니다.</p>
  </>}
 </details></section>;
}
