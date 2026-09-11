import {useEffect,useState} from "react";
import type {ScreenShape} from "./drawing-screen-object-preview";
import {Button} from "~/core/components/ui/button";

import {parseSelectedTakeoffDrafts,type SelectedTakeoffDraft as Draft} from "../lib/drawing-selected-takeoff-storage";
/** Object-linked screen rows, deliberately without fabricated measurements or prices. */
export function DrawingSelectedTakeoff({object,objects,onChooseObject,missing,viewer,onReturn,draftKey,onSaveFailure}:{object?:ScreenShape;objects?:ScreenShape[];onChooseObject?:(id:string)=>void;missing:boolean;viewer:boolean;onReturn:()=>void;draftKey?:string;onSaveFailure?:(failed:boolean)=>void}){
 const [drafts,setDrafts]=useState<Record<string,Draft>>({});
 const [query,setQuery]=useState("");
 const [connection,setConnection]=useState<"all"|"available"|"missing">("all");
 useEffect(()=>{setQuery("");setConnection("all");},[draftKey]);
 const [viewStep,setViewStep]=useState<Draft["step"]|null>(null);
 useEffect(()=>setViewStep(null),[object?.id,viewer]);
 const [restored,setRestored]=useState(false),[readError,setReadError]=useState(false),[saveError,setSaveError]=useState(false);
 const read=()=>{try{const raw=draftKey?sessionStorage.getItem(draftKey):null;setDrafts(raw!==null?parseSelectedTakeoffDrafts(raw):{});setRestored(true);setReadError(false);}catch{setReadError(true);}};
 const save=()=>{if(!draftKey||!restored||readError||viewer||!Object.keys(drafts).length)return;try{sessionStorage.setItem(draftKey,JSON.stringify({schemaVersion:1,rows:drafts}));setSaveError(false);}catch{setSaveError(true);}};
 useEffect(read,[draftKey]);
 useEffect(save,[draftKey,restored,readError,viewer,drafts]);
 useEffect(()=>{onSaveFailure?.(readError||saveError);},[readError,saveError,onSaveFailure]);
 const draft=(object?drafts[object.id]:undefined)??{name:(object?.name||object?.kind||"").slice(0,80),trade:"미분류",step:"area"};
 useEffect(()=>{
  if(!object||!restored||readError||viewer||missing)return;
  setDrafts(current=>current[object.id]?current:{...current,[object.id]:{name:(object.name||object.kind).slice(0,80),trade:"미분류",step:"area"}});
 },[object?.id,object?.name,object?.kind,restored,readError,viewer,missing]);
 const update=(value:Partial<Draft>)=>{if(viewer||!object||!restored||readError)return;setDrafts(current=>({...current,[object.id]:{...(current[object.id]??draft),...value}}));};
 const step=viewer?(viewStep??draft.step):draft.step;
 const available=new Map((objects??(object?[object]:[])).map(value=>[value.id,value]));
 const rowIds=[...new Set([...(object&&!viewer?[object.id]:[]),...Object.keys(drafts)])];
 const missingCount=rowIds.filter(id=>!available.has(id)).length;
 const search=query.trim().toLocaleLowerCase();
 const visibleIds=rowIds.filter(id=>{
  const source=available.get(id),row=drafts[id];
  return (connection==="all"||(connection==="available"?Boolean(source):!source))&&
   (!search||`${row?.name??source?.name??""} ${row?.trade??"미분류"} ${source?`${source.page}쪽`:"도형 없음"}`.toLocaleLowerCase().includes(search));
 });
 return <section aria-label={object?"선택 도형 물량 연결":"도면 물량 연결"} className="grid gap-4">
  <p className="text-xs text-muted-foreground">미산출 · 수량·금액은 아직 계산하지 않았습니다.</p>
  {readError&&<div role="alert">물량 초안을 읽지 못했습니다. 기존 기록을 덮어쓰지 않습니다.<Button variant="outline" onClick={read}>물량 초안 다시 읽기</Button></div>}
  {saveError&&<div role="alert">물량 초안을 보관하지 못했습니다. 입력을 유지한 채 다시 시도하세요.<Button variant="outline" onClick={save}>물량 초안 보관 재시도</Button></div>}
  {restored&&!readError&&<details open={object?undefined:true} className="rounded border p-3"><summary className="cursor-pointer text-sm font-medium">연결 물량 항목 · {rowIds.length}개</summary>{!rowIds.length&&<p className="mt-3 text-sm">연결한 물량 항목이 없습니다. 도형을 선택해 항목을 시작하세요.</p>}{(rowIds.length>1||query||connection!=="all")&&<div className="mt-3 grid gap-2">
   <label className="grid gap-1 text-xs">물량 항목 검색<input type="search" aria-label="물량 항목 검색" placeholder="이름·공종·페이지" value={query} onChange={event=>setQuery(event.target.value)} className="min-h-9 min-w-0 rounded border px-2"/></label>
   <label className="grid gap-1 text-xs">도형 연결 상태<select aria-label="물량 도형 연결 상태" value={connection} onChange={event=>setConnection(event.target.value as typeof connection)} className="min-h-9 min-w-0 rounded border px-2"><option value="all">전체 {rowIds.length}개</option><option value="available">연결된 도형 {rowIds.length-missingCount}개</option><option value="missing">도형 없음 {missingCount}개</option></select></label>
   <small role="status">{visibleIds.length}/{rowIds.length}개 표시 · 보관 기록은 변경하지 않습니다.</small>
   {!visibleIds.length&&<div className="grid gap-2 text-sm"><p>조건에 맞는 물량 항목이 없습니다.</p><Button variant="outline" onClick={()=>{setQuery("");setConnection("all");}} aria-label="물량 검색·필터 초기화">전체 항목 보기</Button></div>}
  </div>}<ul className="mt-3 grid max-h-60 gap-2 overflow-y-auto" aria-label="연결 물량 항목 목록">{visibleIds.map(id=>{const source=available.get(id),row=drafts[id],name=row?.name.trim()||source?.name||"이름 없는 항목";return <li key={id} className="rounded border p-2 text-sm"><button className="w-full text-left break-words disabled:text-muted-foreground" aria-label={`${name} · 물량 항목 열기`} aria-pressed={id===object?.id} disabled={!source||!onChooseObject||saveError} onClick={()=>onChooseObject?.(id)}>{name}</button><small>{source?`${source.page}쪽` :"도형 없음 · 기록 유지"} · {row?.trade??"미분류"}</small>{!source&&row&&<details className="mt-2"><summary className="cursor-pointer font-medium">보관된 입력 보기</summary><section aria-label="누락 도형의 물량 기록" className="mt-2 grid gap-2 rounded bg-muted/30 p-3"><p>읽기 전용 · 현재 도형을 찾을 수 없어 위치 확인과 편집을 할 수 없습니다.</p><dl className="grid gap-1"><dt>물량 항목 이름</dt><dd className="break-words">{row.name.trim()||"이름 없는 항목"}</dd><dt>공종</dt><dd>{row.trade}</dd><dt>객체 ID</dt><dd className="break-all">{id}</dd></dl><p>원본 도형을 복원하면 같은 ID의 연결을 다시 확인할 수 있습니다. 이 기록을 다른 도형으로 자동 대체하지 않습니다.</p></section></details>}</li>;})}</ul></details>}
  {!object&&<label className="grid gap-2 text-sm">도형에서 물량 항목 시작<select aria-label="물량 연결 도형 선택" value="" disabled={viewer||readError||saveError||!restored||!onChooseObject||!available.size} className="min-h-10 rounded border px-3" onChange={event=>onChooseObject?.(event.target.value)}><option value="">도형 선택</option>{[...available.values()].map(source=><option key={source.id} value={source.id}>{source.page}쪽 · {source.name||source.kind}</option>)}</select><small>수량·금액이 자동 산출되지는 않습니다.</small></label>}
  {object&&<>
  <div className="rounded border p-3 break-words"><strong>{object.name||object.kind}</strong><p>{object.page}쪽 · {object.kind}</p><small className="break-all">객체 ID: {object.id}</small></div>
  {missing&&<p role="alert">연결 도형이 현재 도면에 없습니다. 다른 도형으로 자동 대체하지 않습니다.</p>}
  {viewer&&!drafts[object.id]&&<p role="status" className="text-sm">이 도형에는 연결된 물량 항목이 없습니다. Viewer는 새 항목을 만들 수 없습니다.</p>}
  <nav aria-label="선택 도형 산출 단계" className="flex flex-wrap gap-2">{([['area','영역 속성'],['quantity','물량 행 보기'],['estimate','내역 행 보기']] as const).map(([value,label])=><Button key={value} variant="outline" aria-pressed={step===value} disabled={viewer&&!drafts[object.id]} onClick={()=>viewer?setViewStep(value):update({step:value})}>{label}</Button>)}</nav>
  {step==="area"?<fieldset disabled={viewer||missing||readError||!restored} className="grid gap-3">
   <label className="grid gap-2 text-sm">물량 항목 이름<input aria-label="물량 항목 이름" maxLength={80} value={draft.name} onChange={event=>update({name:event.target.value})} className="min-h-10 rounded border px-3"/></label>
   <label className="grid gap-2 text-sm">공종<select aria-label="물량 항목 공종" value={draft.trade} onChange={event=>update({trade:event.target.value})} className="min-h-10 rounded border px-3">{['미분류','건축 마감','구조','기계 설비'].map(value=><option key={value}>{value}</option>)}</select></label>
   <p className="text-xs text-muted-foreground">항목 이름은 도형 이름을 변경하지 않습니다. 축척·산출 규칙·보정 근거가 필요합니다.</p>
  </fieldset>:<>
   <div className="overflow-x-auto rounded border" tabIndex={0} role="region" aria-label="선택 도형 산출표"><table className="min-w-[420px] w-full text-sm text-left"><caption className="p-3 text-left">{step==="quantity"?"연결 물량 행":"연결 내역 행"} · 미확정</caption><thead><tr>{['항목','공종',...(step==="quantity"?['원수량','보정','최종수량']:['수량','단가','금액'])].map(label=><th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody><tr><td className="p-3">{draft.name.trim()||"이름 없는 항목"}</td><td className="p-3">{draft.trade}</td><td className="p-3">미산출</td><td className="p-3">미등록</td><td className="p-3">미산출</td></tr></tbody></table></div>
   <p role="status" className="text-sm text-amber-800">{draft.trade==="미분류"?"공종 연결 · ":""}축척·산출 규칙·보정 근거{step==="estimate"?"·단가 출처":""}를 확인해야 합니다. 미산출은 0을 뜻하지 않습니다.</p>
  </>}
  <Button variant="outline" disabled={missing||readError||saveError} onClick={onReturn}>연결 도형 위치 확인</Button>
  </>}
  <details className="rounded border p-3 text-sm"><summary className="cursor-pointer">보관·산출 안내</summary><p className="mt-2 text-muted-foreground">선택 도형 → 물량 항목 → 내역 연결 화면입니다. {draftKey?"입력은 이 브라우저 탭의 같은 문서·원본에 보관됩니다.":"입력은 현재 화면에서만 유지됩니다."} 실제 수량·금액 확정에는 축척·산출 규칙·보정 근거가 필요합니다.</p></details>
 </section>;
}
