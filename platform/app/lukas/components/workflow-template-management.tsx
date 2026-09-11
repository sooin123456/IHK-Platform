import {useState} from 'react';
import type {SavedDrawingTemplate} from '../lib/workflow-saved-templates';

export function WorkflowTemplateManagement({template,name,onDraft,onRename,onRemove}:{
 template:SavedDrawingTemplate;name:string;onDraft:(name:string)=>void;
 onRename:(id:string,name:string)=>void;onRemove:(id:string)=>void;
}){
 const [removing,setRemoving]=useState(false);
 const [confirmed,setConfirmed]=useState(false);
 const [message,setMessage]=useState('');
 const [error,setError]=useState('');
 return <section aria-label="선택 템플릿 관리">
  <details>
   <summary>템플릿 관리</summary>
   <label className="flow-input">템플릿 변경 이름
    <input aria-label="템플릿 변경 이름" maxLength={120} value={name} onChange={event=>onDraft(event.target.value)}/>
   </label>
   <button onClick={()=>{
    const next=name.trim();
    if(!next||next.length>120){setError('이름을 1~120자로 입력하세요.');return;}
    onRename(template.id,next);setError('');setMessage('템플릿 이름을 저장했습니다. 기존 도면의 이름은 유지됩니다.');
   }}>템플릿 이름 저장</button>
   {error&&<p role="alert">{error}</p>}
   {message&&<p role="status">{message}</p>}
   {!removing?<button onClick={()=>{setRemoving(true);setConfirmed(false);}}>템플릿 삭제</button>:<div className="flow-card">
    <strong>‘{template.name}’ 템플릿을 삭제할까요?</strong>
    <p>선택한 개인 템플릿만 목록에서 제거합니다. 원본과 이 템플릿으로 이미 만든 도면은 삭제하지 않습니다.</p>
    <p>삭제 후 되돌리기는 제공하지 않습니다. 다시 필요할 수 있다면 먼저 작업 백업을 다운로드하세요.</p>
    <label><input type="checkbox" aria-label="이 템플릿을 목록에서 삭제함을 확인합니다" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>이 템플릿을 목록에서 삭제함을 확인합니다</label>
    <div className="flow-actions">
     <button disabled={!confirmed} onClick={()=>{if(confirmed)onRemove(template.id);}}>선택 템플릿만 삭제</button>
     <button onClick={()=>{setRemoving(false);setConfirmed(false);}}>삭제 취소</button>
    </div>
   </div>}
  </details>
 </section>;
}
