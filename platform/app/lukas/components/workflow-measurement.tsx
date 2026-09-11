import {useEffect,useState} from 'react';
import {previewDistance,previewMeasure,measurementValue,type MeasurementPoint} from '../lib/workflow-measurement';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
export function useWorkflowMeasurement(document:WorkflowBlankDocument,ready:boolean,writable:boolean,onChange:(document:WorkflowBlankDocument)=>void) {
 const sourceKey=`${document.id}:${document.source?.sha256}:${document.page??1}:${document.revision??1}`;
 const records=document.measurements??[];
 const nextId=Math.max(0,...records.map(record=>record.id))+1;
 const [active,setActive]=useState(false);
 const [reference,setReference]=useState<MeasurementPoint[]>([]),[target,setTarget]=useState<MeasurementPoint[]>([]);
 const [length,setLength]=useState(''),[aspect,setAspect]=useState(1),[stage,setStage]=useState<'reference'|'target'>('reference');
 const [cursor,setCursor]=useState<MeasurementPoint>({x:.5,y:.5});
 const [kind,setKind]=useState<'distance'|'path'|'area'>('distance'),[finished,setFinished]=useState(false);
 const clear=()=>{setReference([]);setTarget([]);setLength('');setStage('reference');setCursor({x:.5,y:.5});setFinished(false);};
 useEffect(()=>{clear();setActive(false);},[sourceKey]);
 const valid=previewDistance(reference,reference,Number(length),aspect)!==null;
 const calculated=stage==='target'?(kind==='distance'?previewDistance(reference,target,Number(length),aspect):previewMeasure(kind,reference,target,Number(length),aspect)):null;
 const value=kind==='distance'||finished?calculated:null;
 const points=stage==='reference'?reference:target;
 const addPoint=(point:MeasurementPoint)=>{
  if(stage==='target'&&kind!=='distance'&&(finished||target.length>=100))return;
  const next=(stage==='reference'||kind==='distance')&&points.length===2?[point]:[...points,point];
  if(stage==='reference')setReference(next);else setTarget(next);
 };
 const panel=active?<section className="flow-card" aria-label="PDF 축척·거리 미리보기">
  <h3>PDF 축척·측정 미리보기</h3>
  <p>현재 페이지의 같은 축척 영역에서 기준점 두 개를 누르고 실제 길이를 입력하세요. 거리에는 두 점, 경로·면적에는 순서대로 점을 선택합니다. 원본·객체·수량표는 변경하지 않으며 실무 확정 측정이 아닙니다. 보관하지 않은 측정은 페이지 변경·새로고침 시 초기화됩니다.</p>
  <p role="status">{stage==='reference'?`기준점 ${reference.length}/2 선택`:`측정점 ${target.length}/${kind==='distance'?'2':'100'} 선택${finished?' · 완료':''}`}</p>
  <p>키보드: 도면 측정점 지정에 초점을 두고 방향키로 1%, Shift+방향키로 10% 이동한 뒤 Enter로 점을 지정합니다. Esc는 측정 닫기입니다.</p>
  <label className="flow-input">기준 실제 길이 (m)<input aria-label="기준 실제 길이 (m)" type="number" min="0" step="any" value={length} onChange={event=>{setLength(event.target.value);setStage('reference');setTarget([]);setFinished(false);}}/></label>
  <label className="flow-input">측정 종류<select aria-label="측정 종류" value={kind} onChange={event=>{setKind(event.target.value as typeof kind);setTarget([]);setFinished(false);}}><option value="distance">거리</option><option value="path">경로 길이</option><option value="area">면적</option></select></label>
  {reference.length===2&&!valid&&<p role="alert">서로 다른 기준점과 0보다 큰 실제 길이가 필요합니다.</p>}
  <button disabled={!ready||!valid} onClick={()=>{setStage('target');setTarget([]);setFinished(false);}}>{kind==='distance'?'거리 측정점 선택':'측정점 다시 선택'}</button>
  {stage==='target'&&kind!=='distance'&&<>
   <p>경로는 열린 선, 면적은 마지막 점과 첫 점을 연결한 단일 영역입니다. 구멍·중첩 영역 공제는 지원하지 않습니다.</p>
   <button disabled={calculated===null||finished} onClick={()=>setFinished(true)}>측정 완료</button>
   <button disabled={!target.length} onClick={()=>{setTarget(points=>points.slice(0,-1));setFinished(false);}}>마지막 측정점 취소</button>
   {target.length>=3&&calculated===null&&<p role="alert">점의 교차·중복·일직선 또는 입력 범위를 확인하세요. 유효한 결과를 계산할 수 없습니다.</p>}
  </>}
  {value!==null&&<p role="status">{kind==='area'?'면적':kind==='path'?'경로':'거리'} 미리보기: {value.toFixed(3)} {kind==='area'?'m²':'m'} · 미확정</p>}
  <button disabled={!writable||!ready||value===null||nextId>100} onClick={()=>{
   if(!writable||!ready||value===null||!document.source||nextId>100)return;
   onChange({...document,measurements:[...records,{id:nextId,source:{...document.source},page:document.page??1,revision:document.revision??1,kind,reference:reference.map(p=>({...p})),target:target.map(p=>({...p})),length:Number(length),aspect}]});
  }}>측정 기록 보관</button>
  <p>이 탭의 도면에 미확정 기록을 최대 100건 보관합니다. 서버 저장이나 수량 승인으로 처리하지 않습니다. 다시 열 때 같은 PDF를 연결해야 합니다.</p>
  {nextId>100&&<p role="status">측정 기록 보관 한도에 도달했습니다. 기존 기록을 덮어쓰지 않습니다.</p>}
  {records.length>0&&<section aria-label="보관된 측정 기록"><h4>보관된 측정 기록</h4><ul>{records.map(record=>{
   const compatible=record.source.sha256===document.source?.sha256&&record.page===(document.page??1)&&record.revision===(document.revision??1);
   const result=measurementValue(record);
   return <li key={record.id}>
    <p>기록 #{record.id} · {record.page}쪽 · R{record.revision} · {record.kind==='area'?'면적':record.kind==='path'?'경로':'거리'} {result?.toFixed(3)} {record.kind==='area'?'m²':'m'} · 미확정</p>
    <p>{record.source.name} · 기준 길이 {record.length} m</p>
    <button disabled={!ready||!compatible||result===null} onClick={()=>{setReference(record.reference.map(p=>({...p})));setTarget(record.target.map(p=>({...p})));setLength(String(record.length));setAspect(record.aspect);setKind(record.kind);setStage('target');setFinished(true);}}>기록 #{record.id} 불러오기</button>
    {!compatible&&<p>원본·페이지·개정이 다릅니다. 현재 도면에 임의로 적용하지 않습니다.</p>}
   </li>;
  })}</ul></section>}
  <button onClick={clear}>기준 다시 잡기</button>
  <button onClick={()=>setActive(false)}>측정 닫기</button>
 </section>:null;
 const overlay=active&&ready?<g aria-label="측정점 선택 영역">
  <rect width="800" height="520" fill="transparent" pointerEvents="all" role="button" tabIndex={0} aria-label="도면 측정점 지정" onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{
   if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' ','Escape'].includes(event.key))return;
   event.preventDefault();event.stopPropagation();
   if(event.key==='Escape'){setActive(false);return;}
   const box=event.currentTarget.getBoundingClientRect();if(box.width&&box.height)setAspect(box.width/box.height);
   if(event.key==='Enter'||event.key===' '){if(!event.repeat)addPoint(cursor);return;}
   const step=event.shiftKey ? .1 : .01;
   setCursor(point=>({x:Math.max(0,Math.min(1,point.x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0))),y:Math.max(0,Math.min(1,point.y+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0)))}));
  }} onClick={event=>{
   event.stopPropagation();const box=event.currentTarget.getBoundingClientRect();
   if(!box.width||!box.height)return;setAspect(box.width/box.height);
   const point={x:Math.max(0,Math.min(1,(event.clientX-box.left)/box.width)),y:Math.max(0,Math.min(1,(event.clientY-box.top)/box.height))};
   setCursor(point);addPoint(point);
  }}/>
  <path d={`M ${cursor.x*800-7} ${cursor.y*520} h 14 M ${cursor.x*800} ${cursor.y*520-7} v 14`} stroke="#111827" strokeWidth="2" pointerEvents="none"/>
  {[reference,target].map((line,index)=><g key={index} pointerEvents="none" stroke={index?'#16804a':'#6554d7'} fill={index?'#16804a':'#6554d7'}>
   {index===1&&kind==='area'&&line.length>=3?<polygon points={line.map(point=>`${point.x*800},${point.y*520}`).join(' ')} fill="#16804a22" strokeWidth="2" strokeDasharray={finished?undefined:'5 3'}/>:<polyline points={line.map(point=>`${point.x*800},${point.y*520}`).join(' ')} fill="none" strokeWidth="2"/>}
   {line.map((point,i)=><circle key={i} cx={point.x*800} cy={point.y*520} r="5"/>)}
  </g>)}
 </g>:null;
 return {active,setActive,panel,overlay};
}
