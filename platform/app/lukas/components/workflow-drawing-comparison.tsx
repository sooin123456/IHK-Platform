import {useRef,useEffect} from 'react';
import {useSearchParams} from 'react-router';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {compareDrawingObjects} from '../lib/workflow-drawing-comparison';
import {WorkflowPdfBackground} from './workflow-prototype-pdf';
import {WorkflowDraftShape} from './workflow-draft-shape';
const labels={added:'추가',removed:'삭제',changed:'변경',same:'동일'};
export function WorkflowDrawingComparison({document}:{document:WorkflowBlankDocument}) {
 const rounds=(document.reviewRounds??[]).filter(round=>round.phase==='approved');
 const [params,setParams]=useSearchParams();
 const revision=params.has('drawingRevision')?Number(params.get('drawingRevision')):rounds.at(-1)?.revision??0;
 const target=params.get('drawingTarget')??'current';
 const page=Number(params.get('drawingPage')??'1'),selected=params.get('drawingObject')??'',showSame=params.get('drawingSame')==='1';
 const selectionRef=useRef({drawingRevision:String(revision),drawingTarget:target,drawingPage:String(page),drawingObject:selected,drawingSame:showSame?'1':'0'});
 useEffect(()=>{selectionRef.current={drawingRevision:String(revision),drawingTarget:target,drawingPage:String(page),drawingObject:selected,drawingSame:showSame?'1':'0'};},[revision,target,page,selected,showSame]);
 const update=(patch:Partial<typeof selectionRef.current>)=>{selectionRef.current={...selectionRef.current,...patch};const selection={...selectionRef.current};setParams(previous=>{const next=new URLSearchParams(previous);for(const [key,value] of Object.entries(selection))value?next.set(key,value):next.delete(key);return next;},{preventScrollReset:true});};
 const choose=(key:'drawingRevision'|'drawingTarget',value:string)=>{update({[key]:value,drawingObject:'',drawingPage:'1'});returnButtonRef.current=null;};
 const setPage=(value:number)=>{update({drawingPage:String(value),drawingObject:''});returnButtonRef.current=null;};
 const result=compareDrawingObjects(document,revision,target==='current'?undefined:Number(target));
 const canvasRef=useRef<HTMLDivElement>(null);
 const returnButtonRef=useRef<HTMLButtonElement|null>(null);
 const itemRefs=useRef(new Map<string,HTMLLIElement>());
 const validPage=Number.isInteger(page)&&page>=1&&page<=(result?.approved.source.pages??0);
 const locate=(id:string,nextPage:number,button:HTMLButtonElement)=>{
  returnButtonRef.current=button;
  update({drawingObject:id,drawingPage:String(nextPage)});
  requestAnimationFrame(()=>{
   canvasRef.current?.focus({preventScroll:true});
   canvasRef.current?.querySelector('.flow-local-pdf-surface')?.scrollIntoView({block:'center'});
  });
 };
 return <section className="flow-card" aria-label="도면 변경 오버레이">
  <h3>도면 개정 겹쳐보기</h3>
  <p>PDF 원본 변경을 감지하는 기능이 아니라 저장된 구상 객체의 위치·형상·표시 속성 비교입니다. 수량·금액은 위 검산 비교에서 확인하세요.</p>
  {!rounds.length?<p>비교할 도면 승인 기록이 없습니다. 수량 승인만으로 도면 형상을 추정하지 않습니다.</p>:<>
   <label className="flow-input">기준 도면 개정<select aria-label="기준 도면 개정" value={revision} onChange={event=>choose('drawingRevision',event.target.value)}>{!rounds.some(round=>round.revision===revision)&&<option value={revision} disabled>선택한 승인 기록 없음</option>}{rounds.map(round=><option key={round.revision} value={round.revision}>승인 R{round.revision}</option>)}</select></label>
   <label className="flow-input">대상 도면 개정<select aria-label="대상 도면 개정" value={target} onChange={event=>choose('drawingTarget',event.target.value)}><option value="current">현재 작업</option>{target!=='current'&&!rounds.some(round=>String(round.revision)===target)&&<option value={target} disabled>선택한 승인 기록 없음</option>}{rounds.map(round=><option key={round.revision} value={round.revision}>승인 R{round.revision}</option>)}</select></label>
   {!result?<p role="alert">선택한 승인 기록을 찾을 수 없습니다. 현재 작업본으로 대체하지 않습니다.</p>:<>
   <p>승인 R{result.approved.revision} → {result.target?'승인':'현재'} R{result.target?.revision??document.revision??1} · 읽기 전용</p>
   {!result.compatible?<p role="alert">원본 해시가 달라 겹쳐보기를 중단했습니다. 다른 도면을 임의 정합하지 않습니다.</p>:<>
    <p>이전: 빨강·점선 / 대상: 초록·실선 / 동일: 회색. 숨김 레이어의 객체도 비교에 포함하며 기록은 변경하지 않습니다.</p>
    <section aria-label="레이어 변경 비교" className="flow-card">
     <h4>레이어 변경 · {result.layerRows.filter(row=>row.kind!=='same').length}건</h4>
     <p>객체 형상과 별도로 이름·표시·잠금·목록 순서를 비교합니다. 아래 오버레이는 검토를 위해 숨김 객체도 표시합니다.</p>
     <ul>{result.layerRows.filter(row=>row.kind!=='same').map(row=><li key={row.id} style={{overflowWrap:'anywhere'}}>
      <strong>{labels[row.kind]} · {row.after?.name??row.before?.name}</strong>
      {row.before&&row.after?<ul>
       {row.changes.includes('name')&&<li>이름: {row.before.name} → {row.after.name}</li>}
       {row.changes.includes('visible')&&<li>표시 상태: {row.before.visible?'표시':'숨김'} → {row.after.visible?'표시':'숨김'}</li>}
       {row.changes.includes('locked')&&<li>잠금 상태: {row.before.locked?'잠금':'잠금 해제'} → {row.after.locked?'잠금':'잠금 해제'}</li>}
       {row.changes.includes('order')&&<li>목록 순서: {row.beforeIndex+1} → {row.afterIndex+1}</li>}
      </ul>:<p>{(row.after??row.before).visible?'표시':'숨김'} · {(row.after??row.before).locked?'잠금':'잠금 해제'} · 목록 {(row.after?row.afterIndex:row.beforeIndex)+1}번째</p>}
     </li>)}</ul>
     {!result.layerRows.some(row=>row.kind!=='same')&&<p>레이어 변경이 없습니다.</p>}
    </section>
    <label><input type="checkbox" checked={showSame} onChange={event=>update({drawingSame:event.target.checked?'1':'0'})}/>동일 객체도 표시</label>
    <label className="flow-input">비교 페이지<select aria-label="비교 페이지" value={page} onChange={event=>setPage(Number(event.target.value))}>{!validPage&&<option value={page} disabled>선택한 페이지 없음</option>}{Array.from({length:result.approved.source.pages},(_,i)=><option key={i+1} value={i+1}>{i+1}쪽</option>)}</select></label>
    {!validPage&&<p role="alert">선택한 비교 페이지가 없습니다. 위에서 페이지를 다시 선택하세요.</p>}
    <div ref={canvasRef} tabIndex={-1} role="region" aria-label="도면 비교 표시 영역">
    {validPage&&<WorkflowPdfBackground source={result.approved.source} page={page} onPage={setPage} onReady={()=>{}} onSource={()=>{}}>
     <svg className="flow-blank-canvas" viewBox="0 0 800 520" preserveAspectRatio="none" role="img" aria-label="도면 전후 오버레이">
      {result.rows.filter(row=>showSame||row.kind!=='same').flatMap(row=>{
       const sides=row.kind==='same'?['after'] as const:['before','after'] as const;
       return sides.map(side=>{const shape=row[side];if(!shape||(shape.page??1)!==page)return null;
        return <g key={`${row.id}:${side}`} role="img" aria-label={`${side==='before'?'이전':result.target?'대상':'현재'} ${shape.label} · ${labels[row.kind]}`} strokeDasharray={side==='before'?'6 4':undefined} opacity={row.kind==='same'?0.35:0.8}>
         <WorkflowDraftShape shape={{...shape,stroke:row.kind==='same'?'#64748b':side==='before'?'#c2413b':'#16804a',fill:'transparent'}} selected={selected===row.id}/>
        </g>;
       });
      })}
     </svg>
    </WorkflowPdfBackground>}
    {selected&&result.rows.some(row=>row.id===selected&&(showSame||row.kind!=='same'))&&<button onClick={()=>{
     const item=returnButtonRef.current?.isConnected?returnButtonRef.current:itemRefs.current.get(selected);
     item?.focus({preventScroll:true});
     item?.scrollIntoView({block:'center'});
    }}>선택한 변경 항목으로 돌아가기</button>}
    </div>
    <p>같은 PDF를 다시 연결하면 원본 위에 객체를 표시합니다. 연결 전에는 변경 목록만 확인할 수 있습니다. 실측 정합은 아닙니다.</p>
    <ul>{result.rows.filter(row=>showSame||row.kind!=='same').map(row=><li key={row.id} tabIndex={-1} ref={node=>{if(node)itemRefs.current.set(row.id,node);else itemRefs.current.delete(row.id);}}>
     <strong>{labels[row.kind]} · {row.after?.label??row.before?.label}</strong>
     {row.before&&<button onClick={event=>locate(row.id,row.before!.page??1,event.currentTarget)}>이전 위치: {row.before.label} · {row.before.page??1}쪽</button>}
     {row.after&&<button onClick={event=>locate(row.id,row.after!.page??1,event.currentTarget)}>{result.target?'대상':'현재'} 위치: {row.after.label} · {row.after.page??1}쪽</button>}
    </li>)}</ul>
    {!result.rows.some(row=>row.kind!=='same')&&<p>객체 형상·표시 속성 변경이 없습니다.</p>}
   </>}
   </>}
  </>}
 </section>;
}
