import {useEffect,useState} from "react";
import {Button} from "~/core/components/ui/button";
import {screenPropertyClassifications,type ScreenShape,type ScreenObjectProperties} from "./drawing-screen-object-preview";
const empty:ScreenObjectProperties={classification:"미분류",code:"",note:"",required:false};
export function DrawingObjectPropertiesPreview({object,disabled,onApply}:{object:ScreenShape;disabled:boolean;onApply?:(properties:ScreenObjectProperties)=>void}){
 const [draft,setDraft]=useState(object.properties??empty);
 const [applied,setApplied]=useState(false);
 useEffect(()=>{setDraft(object.properties??empty);},[object.id,object.properties]);
 useEffect(()=>setApplied(false),[object.id]);
 const update=(patch:Partial<ScreenObjectProperties>)=>{setDraft(current=>({...current,...patch}));setApplied(false);};
 return <section aria-label="도형 사용자 속성 편집" className="grid gap-4">
  <div className="rounded-lg border p-3"><strong>{object.name||object.kind}</strong><p className="text-sm">{object.page}쪽 · {object.kind}</p></div>
  <fieldset disabled={disabled||!onApply} className="grid gap-3">
   <label className="grid gap-1 text-sm">공종 분류<select aria-label="공종 분류" className="min-h-10 rounded border px-3" value={draft.classification} onChange={event=>update({classification:event.target.value as ScreenObjectProperties['classification']})}>{screenPropertyClassifications.map(value=><option key={value}>{value}</option>)}</select></label>
   <label className="grid gap-1 text-sm">회사 항목 코드<input aria-label="회사 항목 코드" className="min-h-10 rounded border px-3" maxLength={40} value={draft.code} onChange={event=>update({code:event.target.value})}/></label>
   <label className="grid gap-1 text-sm">검토 메모<textarea aria-label="검토 메모" className="rounded border p-3" rows={3} maxLength={500} value={draft.note} onChange={event=>update({note:event.target.value})}/></label>
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.required} onChange={event=>update({required:event.target.checked})}/>후속 검토 표시</label>
  </fieldset>
  <Button disabled={disabled||!onApply} onClick={()=>{onApply?.(draft);setApplied(true);}}>선택 도형에 속성 적용</Button>
  {applied&&JSON.stringify(object.properties)===JSON.stringify(draft)&&<p role="status">화면 도형에 적용했습니다.</p>}
  {disabled&&<p role="status">읽기 전용 또는 잠긴 도형입니다.</p>}
  <p className="text-xs text-muted-foreground">적용한 속성은 도형과 함께 보관하며 실행 취소할 수 있습니다. 적용 전 입력은 이 메뉴의 초안입니다. 이 표시는 검토 요청·승인·물량 공종을 자동 변경하지 않습니다.</p>
 </section>;
}
