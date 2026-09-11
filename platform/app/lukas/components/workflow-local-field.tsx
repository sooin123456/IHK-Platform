import {useState} from 'react';
import {WorkflowInspection} from './workflow-inspection';
import {WorkflowFieldComparison} from './workflow-field-comparison';
import {WorkflowFieldLocations} from './workflow-field-locations';
import {fieldRecordPath} from '../lib/workflow-field-locations';
import {useSearchParams} from 'react-router';
import {FieldPhotoInput,FieldPhotoPreview} from './workflow-field-photos';
import {readFieldPhotoDraft,fieldPhotoDraftPatch,type FieldPhoto} from '../lib/workflow-field-photo';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {addDocumentFieldNote,fieldNoteMatches,fieldLocationSchema,formatFieldLocation,type DocumentFieldNote} from '../lib/workflow-document-field';
const labels={changed:'변경 검토 필요',conforming:'현장 일치 기록','needs-check':'추가 확인 필요'};
export function WorkflowLocalField({documents,selectedId,onSelect,onChange,onOpen,drafts,onDraft}:{documents:WorkflowBlankDocument[];selectedId?:string;onSelect:(id:string)=>void;onChange:(document:WorkflowBlankDocument)=>void;onOpen:(id:string,target:string,page:number,reviewId?:number)=>void;drafts:Record<string,string>;onDraft:(patch:Record<string,string>)=>void}) {
 const selected=selectedId?documents.find(document=>document.id===selectedId):documents[0];
 return <><WorkflowFieldLocations documents={documents} onOpen={onOpen}/><section className="flow-card" aria-label="내 도면 현장 기록">
  <h2>내 도면 · 현장 기록</h2><p>직접 만든 도면의 객체에 관찰 기록을 연결합니다. 실제 검측 승인·GPS·현장 통지는 수행하지 않는 로컬 화면입니다.</p>
  {documents.length>0&&<label className="flow-input">현장 도면<select aria-label="현장 도면" value={selected?.id??''} onChange={event=>onSelect(event.target.value)}>{!selected&&<option value="" disabled>도면을 찾을 수 없음</option>}{documents.map(document=><option key={document.id} value={document.id}>{document.title}</option>)}</select></label>}
  {selected?<FieldDocument key={selected.id} document={selected} onChange={onChange} onOpen={onOpen} drafts={drafts} onDraft={onDraft}/>:<p>{selectedId?'선택한 도면을 찾을 수 없습니다. 다른 도면으로 자동 연결하지 않습니다.':'등록된 도면이 없습니다. 빈 작업 또는 PDF 작업을 먼저 만들어 주세요.'}</p>}
 </section></>;
}
function FieldDocument({document,onChange,onOpen,drafts,onDraft}:{document:WorkflowBlankDocument;onChange:(document:WorkflowBlankDocument)=>void;onOpen:(id:string,target:string,page:number,reviewId?:number)=>void;drafts:Record<string,string>;onDraft:(patch:Record<string,string>)=>void}) {
 const [params,setParams]=useSearchParams();
 const draftField=<T extends string,>(name:string,fallback:T)=>{
  const key=`field-draft:${document.id}:${name}`;
  return [((drafts[key]??fallback)+(drafts[key+':tail']??'')) as T,(value:string)=>onDraft({[key]:value.slice(0,500),[key+':tail']:value.slice(500,1000)})] as const;
 };
 const [objectId,setObjectId]=draftField('object',document.shapes[0]?.id??'');
 const [role,setRole]=draftField<string>('role','author'),[title,setTitle]=draftField('title',''),[note,setNote]=draftField('note',''),[location,setLocation]=draftField('location','');
 const [condition,setCondition]=draftField<DocumentFieldNote['condition']>('condition','needs-check');
 const [observedOn,setObservedOn]=draftField('observedOn','');
 const photoPrefix=`field-draft:${document.id}:photos`,photos=readFieldPhotoDraft(drafts,photoPrefix);
 const setPhotos=(photos:FieldPhoto[])=>onDraft(fieldPhotoDraftPatch(photos,photoPrefix));
 const [photoBusy,setPhotoBusy]=useState(false);
 const [locationKind,setLocationKind]=draftField<string>('locationKind','free');
 const [building,setBuilding]=draftField('building',''),[floor,setFloor]=draftField('floor',''),[room,setRoom]=draftField('room','');
 const [route,setRoute]=draftField('route',''),[section,setSection]=draftField('section',''),[station,setStation]=draftField('station','');
 const parsedPath=fieldLocationSchema.safeParse(locationKind==='building'?{kind:'building',building,floor,room}:{kind:'civil',route,section,station});
 const locationPath=locationKind==='free'?undefined:parsedPath.success?parsedPath.data:undefined;
 const locationText=locationKind==='free'?location:locationPath?formatFieldLocation(locationPath):'';
 const shape=document.shapes.find(item=>item.id===objectId),records=document.fieldNotes??[];
 const options=new Map<string,string>();
 const pathOf=fieldRecordPath;
 for(const record of records){
  const path=pathOf(record);
  for(let depth=1;depth<=path.length;depth++){
   const prefix=path.slice(0,depth);
   options.set(JSON.stringify(prefix),[path[0]==='building'?'건축':path[0]==='civil'?'토목':'직접 입력',...prefix.slice(1)].join(' / '));
  }
 }
 const locationFilter=params.get('fieldLocation')??'';
 const filteredRecords=locationFilter?records.filter(record=>pathOf(record).some((_,index)=>JSON.stringify(pathOf(record).slice(0,index+1))===locationFilter)):records;
 const setLocationFilter=(value:string)=>setParams(previous=>{const next=new URLSearchParams(previous);if(value)next.set('fieldLocation',value);else next.delete('fieldLocation');return next;},{replace:true,preventScrollReset:true});
 const locked=!['author','reviewer'].includes(role)||!document.source||!shape;
 return <>
  <label className="flow-input">현장 체험 역할<select aria-label="현장 체험 역할" value={role} onChange={event=>setRole(event.target.value)}><option value="author">작성자</option><option value="reviewer">검토자</option><option value="viewer">보기 전용</option></select></label>
  <p>이 역할 선택은 실제 권한을 변경하지 않습니다. 기록은 최대 100건이며 도면 승인 상태와 별개입니다.</p>
  {!document.source&&<p role="status">작업실에서 원본 PDF를 연결해야 근거를 보관할 수 있습니다.</p>}
  {!document.shapes.length&&<p role="status">연결할 객체가 없습니다. 작업실에서 객체를 만든 뒤 기록하세요.</p>}
  <label className="flow-input">연결 객체<select aria-label="현장 연결 객체" value={objectId} onChange={event=>setObjectId(event.target.value)}>{!shape&&<option value="">객체 선택</option>}{document.shapes.map(item=><option key={item.id} value={item.id}>{item.label} · {item.page??1}쪽</option>)}</select></label>
  {shape&&<p>{document.source?.name??'원본 없음'} · {shape.page??1}쪽 · R{document.revision??1} · {shape.label}</p>}
  <fieldset disabled={locked}>
   <label className="flow-input">관찰 날짜 (선택)<input type="date" aria-label="관찰 날짜" value={observedOn} onChange={event=>setObservedOn(event.target.value)}/></label>
   <label className="flow-input">위치 구분<select aria-label="위치 구분" value={locationKind} onChange={event=>setLocationKind(event.target.value)}><option value="free">직접 입력</option><option value="building">건축 · 동 / 층 / 실</option><option value="civil">토목 · 노선 / 공구 / 측점</option></select></label>
   {locationKind==='free'?<label className="flow-input">현장 위치<input aria-label="현장 위치" maxLength={160} value={location} placeholder="예: 1동 2층 / 2공구 STA 0+200" onChange={event=>setLocation(event.target.value)}/></label>:<>
    {(locationKind==='building'?[["동",building,setBuilding],["층",floor,setFloor],["실·구역",room,setRoom]] as const:[["노선",route,setRoute],["공구",section,setSection],["측점·구간",station,setStation]] as const).map(([label,value,setValue])=><label className="flow-input" key={label}>{label}<input aria-label={label} maxLength={50} value={value} onChange={event=>setValue(event.target.value)}/></label>)}
    <p role="status">{locationText||'세 위치 항목을 모두 입력하세요. 좌표·측점 계산이 아닌 현장 분류 정보입니다.'}</p>
   </>}
   <label className="flow-input">기록 제목<input aria-label="현장 기록 제목" maxLength={120} value={title} onChange={event=>setTitle(event.target.value)}/></label>
   <label className="flow-input">관찰 상태<select aria-label="현장 관찰 상태" value={condition} onChange={event=>setCondition(event.target.value as typeof condition)}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
   <label className="flow-input">관찰 내용<textarea aria-label="현장 기록 내용" maxLength={1000} value={note} onChange={event=>setNote(event.target.value)}/></label>
   <FieldPhotoInput photos={photos} onChange={setPhotos} onBusy={setPhotoBusy}/>
   <button disabled={photoBusy||!locationText.trim()||!title.trim()||!note.trim()||records.length>=100} onClick={()=>{
    const updated=addDocumentFieldNote(document,objectId,role,{title,note,location:locationText,locationPath,photos,condition,...(observedOn?{observedOn}:{})});if(updated!==document){onChange(updated);setTitle('');setNote('');setPhotos([]);}
   }}>현장 기록 보관</button>
  </fieldset>
  {records.length>=100&&<p role="status">보관 한도 100건에 도달했습니다. 기존 기록을 덮어쓰지 않습니다.</p>}
  <h3>관찰 기록 · {records.length}건</h3>
  <label className="flow-input">기록 위치 필터<select aria-label="기록 위치 필터" value={locationFilter} onChange={event=>setLocationFilter(event.target.value)}><option value="">모든 위치</option>{locationFilter&&!options.has(locationFilter)&&<option value={locationFilter}>현재 도면에 없는 위치</option>}{[...options].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
  {locationFilter&&<button onClick={()=>setLocationFilter('')}>위치 필터 해제</button>}
  <p role="status">표시 {filteredRecords.length}건 / 전체 {records.length}건</p>
  {records.length>0&&!filteredRecords.length&&<p>선택한 위치의 기록이 없습니다. 필터를 해제하면 전체 기록을 볼 수 있습니다.</p>}
  {!records.length&&<p>아직 관찰 기록이 없습니다.</p>}
  <WorkflowFieldComparison documentId={document.id} records={filteredRecords} drafts={drafts} onDraft={onDraft} onInspect={id=>{onDraft({[`inspection:${document.id}:${id}:open`]:'1'});globalThis.document.getElementById(`field-record-${document.id}-${id}`)?.scrollIntoView({block:'start',behavior:'smooth'});}}/>
  {[...filteredRecords].reverse().map(record=>{
   const matches=fieldNoteMatches(document,record);
   return <article className="flow-card" id={`field-record-${document.id}-${record.id}`} key={record.id}><h4>{record.title}</h4><p>{labels[record.condition]} · {record.location}</p><p>{record.note}</p><p>{record.source.name} · {record.page}쪽 · R{record.revision} · {record.objectLabel}</p>
    <p>기록 #{record.id} · 당시 위치 ({record.x}, {record.y}) · 관찰 기록이며 검측 승인 아님</p>
    {(record.photos??[]).map(photo=><FieldPhotoPreview key={photo.sha256} photo={photo}/>)}
    {!matches&&<p role="status">원본·개정·객체 위치 재확인 필요. 현재 위치로 자동 연결하지 않습니다.</p>}
    <button disabled={!matches} onClick={()=>onOpen(document.id,record.objectId,record.page)}>기록 #{record.id} 도면 위치 확인</button>
    <button disabled={!matches||role==='viewer'} onClick={()=>onOpen(document.id,record.objectId,record.page,record.id)}>기록 #{record.id} 검토 초안 작성</button>
    <WorkflowInspection document={document} record={record} drafts={drafts} onDraft={onDraft} onChange={onChange}/>
   </article>;
  })}
 </>;
}
