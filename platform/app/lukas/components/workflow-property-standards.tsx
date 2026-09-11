import {useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'react-router';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {savePropertyStandard,applyPropertyStandard,type PropertyStandard,type CustomProperties} from '../lib/workflow-property-standards';
import {canEditDocument} from '../lib/workflow-document-review';
import {editableDraftLayer} from '../lib/workflow-document-layers';
export function PropertyValues({property}:{property:CustomProperties}){return <><p>{property.standard.name} · V{property.standard.version} · {property.standard.code}</p><dl>{property.standard.fields.map(field=><div key={field.key}><dt>{field.label}</dt><dd>{property.values[field.key]??'미입력'}{field.type==='number'&&field.unit?` ${field.unit}`:''}</dd></div>)}</dl></>;}
export function WorkflowPropertyStandards({standards,documents,drafts,onDraft,onStandards,onChange,onOpen}:{standards:PropertyStandard[];documents:WorkflowBlankDocument[];drafts:Record<string,string>;onDraft:(patch:Record<string,string>)=>void;onStandards:(items:PropertyStandard[])=>void;onChange:(doc:WorkflowBlankDocument)=>void;onOpen:(id:string,objectId:string,page:number)=>void}){
 const [params,setParams]=useSearchParams(),[error,setError]=useState('');const pending=useRef(params.toString());useEffect(()=>{pending.current=params.toString();},[params]);
 const change=(values:Record<string,string>)=>{const next=new URLSearchParams(pending.current);for(const [key,value]of Object.entries(values)){if(value)next.set(key,value);else next.delete(key);}pending.current=next.toString();setParams(next,{replace:true});setError('');};
 const selection=params.get('standardSelection')??(standards.length?`${standards.at(-1)!.id}:${standards.at(-1)!.version}`:'new'),standard=standards.find(item=>`${item.id}:${item.version}`===selection),role=params.get('standardRole')??'author';
 const key=`standard:${selection}:`,input=(name:string,fallback='')=>drafts[key+name]??fallback,edit=(name:string,value:string)=>onDraft({[key+name]:value});
 const count=Math.max(1,Math.min(12,Number(input('count',String(standard?.fields.length??1)))||1));
 const fields=Array.from({length:count},(_,index)=>{const old=standard?.fields[index],type=input(`${index}:type`,old?.type??'text');return {key:old?.key??`f${index+1}`,label:input(`${index}:label`,old?.label),type,required:input(`${index}:required`,String(old?.required??true))==='true',...(type==='number'?{unit:input(`${index}:unit`,old?.type==='number'?old.unit:'')}:{ }),...(type==='choice'?{options:input(`${index}:options`,old?.type==='choice'?old.options.join(', '):'').split(',').map(value=>value.trim())}:{})};});
 const doc=documents.find(doc=>doc.id===(params.get('standardDocument')??documents[0]?.id)),object=doc?.shapes.find(shape=>shape.id===(params.get('standardObject')??doc.shapes[0]?.id));
 const applied=object?.customProperties,valuesKey=`property:${doc?.id??'none'}:${object?.id??'none'}:${selection}:`;
 const currentValue=(field:string)=>drafts[valuesKey+field]??(applied&&standard&&applied.standard.id===standard.id&&applied.standard.version===standard.version?String(applied.values[field]??''):'');
 const locked=role!=='author'||!doc||!object||!canEditDocument(doc,'author')||!editableDraftLayer(doc,object);
 return <section aria-label="속성·분류 기준">
  <header className="flow-card"><h2>속성·분류 기준</h2><p>이 탭에서 재사용하는 사용자 기준입니다. 실제 회사 표준 승인·공유는 아닙니다. 분류 코드와 입력 항목을 정의하고 도면 객체에 명시적으로 적용합니다.</p>
   <label className="flow-input">기준 체험 역할<select aria-label="기준 체험 역할" value={role} onChange={event=>change({standardRole:event.target.value})}><option value="author">작성 체험</option><option value="viewer">열람 체험</option></select></label>
   <label className="flow-input">보관 기준 버전<select aria-label="보관 기준 버전" value={standard?selection:'new'} onChange={event=>change({standardSelection:event.target.value})}><option value="new">새 기준</option>{standards.map(item=><option key={`${item.id}:${item.version}`} value={`${item.id}:${item.version}`}>{item.name} · V{item.version}</option>)}</select></label>
   <button onClick={()=>change({standardSelection:'new'})}>새 기준 작성</button>
  </header>
  {selection!=='new'&&!standard?<p role="alert">선택한 기준 버전을 찾을 수 없습니다. 새 기준으로 자동 대체하지 않습니다.</p>:<fieldset className="flow-card" disabled={role!=='author'}><legend>{standard?`${standard.name} · V${standard.version}에서 새 버전 작성`:'새 기준 정의'}</legend>
   <label className="flow-input">기준 이름<input aria-label="기준 이름" maxLength={120} value={input('name',standard?.name)} onChange={event=>edit('name',event.target.value)}/></label>
   <label className="flow-input">분류 코드<input aria-label="분류 코드" maxLength={120} value={input('code',standard?.code)} onChange={event=>edit('code',event.target.value)}/></label>
   {fields.map((field,index)=><fieldset className="flow-card" key={field.key}><legend>항목 {index+1}</legend>
    <label className="flow-input">이름<input aria-label={`항목 ${index+1} 이름`} maxLength={120} value={field.label} onChange={event=>edit(`${index}:label`,event.target.value)}/></label>
    <label className="flow-input">형식<select aria-label={`항목 ${index+1} 형식`} value={field.type} onChange={event=>edit(`${index}:type`,event.target.value)}><option value="text">문자</option><option value="number">숫자</option><option value="choice">선택 목록</option></select></label>
    {field.type==='number'&&<label className="flow-input">단위<input aria-label={`항목 ${index+1} 단위`} maxLength={20} value={field.unit??''} onChange={event=>edit(`${index}:unit`,event.target.value)}/></label>}
    {field.type==='choice'&&<label className="flow-input">선택값 (쉼표로 구분)<input aria-label={`항목 ${index+1} 선택값`} maxLength={500} value={input(`${index}:options`,standard?.fields[index]?.type==='choice'?(standard.fields[index] as {options:string[]}).options.join(', '):'')} onChange={event=>edit(`${index}:options`,event.target.value)}/></label>}
    <label><input type="checkbox" checked={field.required} onChange={event=>edit(`${index}:required`,String(event.target.checked))}/> 필수 항목</label>
   </fieldset>)}
   <div className="flow-actions"><button disabled={count>=12} onClick={()=>edit('count',String(count+1))}>속성 항목 추가</button><button disabled={count<=1} onClick={()=>edit('count',String(count-1))}>마지막 항목 제외</button><button disabled={standards.length>=50} onClick={()=>{const next=savePropertyStandard(standards,standard?.id??crypto.randomUUID(),{name:input('name',standard?.name),code:input('code',standard?.code),fields});if(next===standards){setError('기준명·분류 코드·항목과 선택값 중복을 확인하세요. 전체 버전 한도는 50개입니다.');return;}onStandards(next);const saved=next.at(-1)!;change({standardSelection:`${saved.id}:${saved.version}`});}}>기준 버전 보관</button></div>
   <p>새 버전은 이미 적용한 객체를 자동 변경하지 않습니다. 숫자 단위는 표기이며 수량·단가 계산식에는 연결하지 않습니다.</p>
  </fieldset>}
  {error&&<p role="alert">{error}</p>}
  <section className="flow-card" aria-label="객체 기준 적용"><h3>도면 객체에 적용</h3>
   <label className="flow-input">속성 대상 도면<select aria-label="속성 대상 도면" value={doc?.id??''} onChange={event=>change({standardDocument:event.target.value,standardObject:''})}>{!doc&&<option value="">도면 선택</option>}{documents.map(doc=><option key={doc.id} value={doc.id}>{doc.title}</option>)}</select></label>
   <label className="flow-input">속성 대상 객체<select aria-label="속성 대상 객체" value={object?.id??''} onChange={event=>change({standardObject:event.target.value})}>{!object&&<option value="">객체 선택</option>}{doc?.shapes.map(shape=><option key={shape.id} value={shape.id}>{shape.label}</option>)}</select></label>
   {applied&&<section aria-label="적용된 객체 속성"><h4>현재 적용 값</h4><PropertyValues property={applied}/></section>}
   {standard&&object?<fieldset disabled={locked}><legend>{standard.name} · V{standard.version} 입력</legend>{standard.fields.map(field=><label className="flow-input" key={field.key}>{field.label}{field.required?' *':''}{field.type==='number'&&field.unit?` (${field.unit})`:''}{field.type==='choice'?<select aria-label={`속성값 ${field.label}`} value={currentValue(field.key)} onChange={event=>onDraft({[valuesKey+field.key]:event.target.value})}><option value="">선택하세요</option>{field.options.map(value=><option key={value} value={value}>{value}</option>)}</select>:<input aria-label={`속성값 ${field.label}`} type={field.type==='number'?'number':'text'} step="any" maxLength={500} value={currentValue(field.key)} onChange={event=>onDraft({[valuesKey+field.key]:event.target.value})}/>}</label>)}
    <button onClick={()=>{if(!doc)return;const values=Object.fromEntries(standard.fields.filter(field=>currentValue(field.key)!=='').map(field=>[field.key,field.type==='number'?Number(currentValue(field.key)):currentValue(field.key)]));const updated=applyPropertyStandard(doc,object.id,role,standard,values);if(updated===doc){setError('필수 항목·값 형식·객체 잠금과 승인 상태를 확인하세요.');return;}onChange(updated);setError('');}}>선택 객체에 기준 적용</button>
   </fieldset>:<p>보관한 기준 버전과 적용할 도면 객체를 선택하세요.</p>}
   {locked&&<p>승인·검토 중이거나 잠긴 객체, 열람 역할에서는 적용할 수 없습니다. 승인 도면은 새 개정에서 변경하세요.</p>}
   {doc&&object&&<button onClick={()=>onOpen(doc.id,object.id,object.page??1)}>객체 도면 확인</button>}
  </section>
 </section>;
}
