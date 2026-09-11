import type {MeasurementRecord} from '../lib/workflow-measurement';
import {useRef,useState} from 'react';
import {WorkflowPdfBackground} from './workflow-prototype-pdf';
export function WorkflowMeasurementEvidence({evidence}:{evidence?:MeasurementRecord}) {
 const [showLocation,setShowLocation]=useState(false);
 const trigger=useRef<HTMLButtonElement>(null);
 if(!evidence)return null;
 return <details onToggle={event=>{if(event.target===event.currentTarget&&!event.currentTarget.open)setShowLocation(false);}}><summary>측정 기록 #{evidence.id} · {evidence.page}쪽 · R{evidence.revision}</summary>
  <p>사용자가 선택한 {evidence.kind==='area'?'면적':evidence.kind==='path'?'경로':'거리'} 측정 · 기준 길이 {evidence.length} m · 측정점 {evidence.target.length}개. 자동 인식·공인 측량 결과가 아닙니다.</p>
  <p style={{overflowWrap:'anywhere'}}>{evidence.source.name} · SHA-256 {evidence.source.sha256}</p>
  <p>기준점(정규화 좌표): {evidence.reference.map(p=>`(${p.x.toFixed(4)}, ${p.y.toFixed(4)})`).join(' → ')} · 페이지 가로/세로 비율 {evidence.aspect.toFixed(4)}</p>
  <p style={{overflowWrap:'anywhere'}}>측정점(정규화 좌표): {evidence.target.map((p,i)=>`${i+1}: (${p.x.toFixed(4)}, ${p.y.toFixed(4)})`).join(' → ')}</p>
  <p>수량에 연결한 당시의 측정 기록 사본입니다. 보정은 원수량과 별도로 검토합니다.</p>
  <button ref={trigger} aria-expanded={showLocation} onClick={()=>setShowLocation(value=>!value)}>측정 위치 확인</button>
  {showLocation&&<section aria-label="측정 위치 읽기 전용" className="flow-card">
   <h4>보관된 측정 위치 · {evidence.page}쪽</h4>
   <p>보라색은 기준선, 초록색은 측정 경로입니다. 같은 PDF를 연결해야 표시되며 페이지는 측정 기록에 고정됩니다. 현재 작업 객체나 수량을 수정하지 않습니다.</p>
   <WorkflowPdfBackground key={`${evidence.source.sha256}:${evidence.page}`} source={evidence.source} page={evidence.page} fixedPage onSource={()=>{}} onPage={()=>{}} onReady={()=>{}}>
    <svg className="flow-blank-canvas" viewBox="0 0 800 520" preserveAspectRatio="none" role="img" aria-label="보관된 측정 위치">
     {[evidence.reference,evidence.target].map((points,index)=><g key={index} stroke={index?'#16804a':'#6554d7'} fill={index?'#16804a':'#6554d7'} pointerEvents="none">
      {index===1&&evidence.kind==='area'?<polygon points={points.map(p=>`${p.x*800},${p.y*520}`).join(' ')} fill="#16804a22" strokeWidth="2"/>:<polyline points={points.map(p=>`${p.x*800},${p.y*520}`).join(' ')} fill="none" strokeWidth="2" strokeDasharray={index?undefined:'6 3'}/>}
      {points.map((point,i)=><g key={i}><circle cx={point.x*800} cy={point.y*520} r="4"/><text x={point.x*800+6} y={point.y*520-6} stroke="none" fontSize="12">{index?i+1:i===0?'A':'B'}</text></g>)}
     </g>)}
    </svg>
   </WorkflowPdfBackground>
   <button onClick={()=>{setShowLocation(false);trigger.current?.focus();}}>검토 근거로 돌아가기</button>
  </section>}
 </details>;
}
