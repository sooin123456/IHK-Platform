import {useState} from 'react';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {captureDrawingTemplate,instantiateDrawingTemplate,type SavedDrawingTemplate} from '../lib/workflow-saved-templates';
import {WorkflowDraftShape} from './workflow-draft-shape';
import {WorkflowTemplateManagement} from './workflow-template-management';
export function WorkflowSavedTemplates({documents,templates,drafts,onDraft,onSave,onCreate,onRename,onRemove}:{documents:WorkflowBlankDocument[];templates:SavedDrawingTemplate[];drafts:Record<string,string>;onDraft:(patch:Record<string,string>)=>void;onSave:(template:SavedDrawingTemplate)=>void;onCreate:(document:WorkflowBlankDocument)=>void;onRename:(id:string,name:string)=>void;onRemove:(id:string)=>void}){
 const [error,setError]=useState('');const sourceId=drafts['library:source']??documents[0]?.id;const document=documents.find(document=>document.id===sourceId);const page=Number(drafts['library:page']??'1');
 const selected=drafts['library:selected']??templates[0]?.id;const template=templates.find(template=>template.id===selected);const pages=document?.source?.pages??Math.max(1,...(document?.shapes??[]).map(shape=>shape.page??1));
 return <section className="flow-card" aria-label="내 도면 재사용 템플릿"><h2>내 도면을 다시 쓰기</h2><p>이 탭에 보관하는 개인 템플릿입니다. 회사 공유·표준 승인 기능은 아닙니다. 선택 페이지의 도형·스타일·레이어만 복사하고 원본 파일·수량·단가·댓글·공정·승인은 포함하지 않습니다.</p>
 {!documents.length?<p>직접 만든 작업 도면이 없습니다. 기본 템플릿이나 빈 도면으로 먼저 시작하세요.</p>:<details open={!templates.length}><summary>도면에서 템플릿 보관</summary>
 <label className="flow-input">템플릿 원본 작업<select aria-label="템플릿 원본 작업" value={document?.id??''} onChange={event=>onDraft({'library:source':event.target.value,'library:page':'1'})}>{!document&&<option value="">선택한 작업 없음</option>}{documents.map(document=><option key={document.id} value={document.id}>{document.title}</option>)}</select></label>
 <label className="flow-input">보관할 페이지<select aria-label="보관할 페이지" value={page} onChange={event=>onDraft({'library:page':event.target.value})}>{(!Number.isInteger(page)||page<1||page>pages)&&<option value={page}>선택한 페이지 없음</option>}{Array.from({length:pages},(_,index)=><option key={index+1} value={index+1}>{index+1}쪽</option>)}</select></label>
 <label className="flow-input">보관할 템플릿 이름<input aria-label="보관할 템플릿 이름" maxLength={120} value={drafts['library:name']??''} onChange={event=>onDraft({'library:name':event.target.value})}/></label>
 <p>새 작업은 1쪽으로 시작합니다. 다른 페이지는 합치지 않습니다. 잠금·숨김 레이어 상태는 유지됩니다.</p>
 <button disabled={templates.length>=20||!document} onClick={()=>{const next=document?captureDrawingTemplate(document,crypto.randomUUID(),drafts['library:name']??'',page):null;if(!next){setError('이름과 객체가 있는 페이지를 확인하세요.');return;}onSave(next);onDraft({'library:selected':next.id,'library:name':''});setError('');}}>선택 페이지를 템플릿으로 보관</button>{templates.length>=20&&<p>이 탭의 템플릿은 최대 20개입니다.</p>}
 </details>}
 {error&&<p role="alert">{error}</p>}
 {!templates.length?<p>보관된 내 템플릿이 없습니다.</p>:<>
 <label className="flow-input">내 템플릿<select aria-label="내 템플릿" value={template?.id??''} onChange={event=>onDraft({'library:selected':event.target.value})}>{!template&&<option value="">선택한 템플릿 없음</option>}{templates.map(template=><option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
 {!template?<p role="alert">선택한 템플릿을 찾을 수 없습니다. 다른 항목으로 대체하지 않습니다.</p>:<><h3>{template.name}</h3><p>{template.shapes.length}개 객체 · {template.layers.length}개 레이어 · 독립 복사</p><svg viewBox="0 0 800 520" className="flow-blank-canvas" role="img" aria-label="내 템플릿 미리보기">{template.shapes.map(shape=><WorkflowDraftShape key={shape.id} shape={shape} selected={false}/>)}</svg><p>구성 확인을 위해 숨김 객체도 미리보기에 표시합니다. 새 작업은 원래 레이어 상태를 유지합니다.</p></>}
 {template&&<WorkflowTemplateManagement key={template.id} template={template} name={drafts[`library:rename:${template.id}`]??template.name} onDraft={name=>onDraft({[`library:rename:${template.id}`]:name})} onRename={onRename} onRemove={onRemove}/>}
 <label className="flow-input">재사용 작업 이름<input aria-label="재사용 작업 이름" maxLength={120} value={drafts['library:new-name']??''} onChange={event=>onDraft({'library:new-name':event.target.value})}/></label>
 <button disabled={!template||documents.length>=30} onClick={()=>{const next=template?instantiateDrawingTemplate(template,crypto.randomUUID(),drafts['library:new-name']??''):null;if(!next){setError('새 작업 이름을 입력하세요.');return;}onCreate(next);onDraft({'library:new-name':''});setError('');}}>내 템플릿으로 새 작업 만들기</button>{documents.length>=30&&<p>작업 30개 한도에 도달했습니다. 기존 작업은 변경하지 않습니다.</p>}
 </>}
 </section>;
}
