import { useEffect, useRef, useState } from "react";
import { Link, useBlocker, useSearchParams } from "react-router";
import { Button } from "~/core/components/ui/button";
import { reviewLoopLabels, type ReviewLoopState } from "./drawing-review-loop";

type RevisionRef = {documentId: string; title: string; revision: number; page: number; phase: ReviewLoopState["phase"]};
type CostStatus = "unchecked" | "checked" | "applied";
type CostChecks = Record<"addition" | "deletion" | "basis", CostStatus>;
type CostProposal = {id:string;kind:keyof CostChecks;item:string;unit:string;note:string;documentId:string};
type ChangeRound = {id: string; projectId: string; number: number; title: string; reason: string; createdAt: string; revisions: RevisionRef[]; costChecks?: CostChecks;costProposals?:CostProposal[]};
const proposalKinds={addition:"항목 추가",deletion:"항목 제외",basis:"단위·단가 기준 수정"};
const costItems = {addition:"추가 공사의 내역 누락",deletion:"삭제 공사의 내역 잔존",basis:"단위·단가 기준 불일치"};
const costStatuses = {unchecked:"미확인",checked:"확인",applied:"반영 · 예시"};
const storageKey = (projectId: string) => `1hk:preview:changes:${projectId}`;
type ChangeDraft = {id: string; title: string; reason: string; selected: string[]};
export function parseChangeDraft(raw: string): ChangeDraft | null {
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d.id !== "string" || !d.id.trim() || d.id.length > 100 || typeof d.title !== "string" || d.title.length > 80 || typeof d.reason !== "string" || d.reason.length > 500 || !Array.isArray(d.selected) || d.selected.length > 100 || d.selected.some((id: unknown) => typeof id !== "string" || !id.trim() || id.length > 100) || new Set(d.selected).size !== d.selected.length) return null;
    return {id: d.id, title: d.title, reason: d.reason, selected: d.selected};
  } catch { return null; }
}

export function parseChangeRounds(raw: string, projectId: string): ChangeRound[] | null {
  const text = (s: unknown, max: number) => typeof s === "string" && s.trim().length > 0 && s.length <= max;
  try {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 500) return null;
    const ids = new Set<string>();
    const numbers = new Set<number>();
    for (const r of rows) {
      if (!r || r.projectId !== projectId || !text(r.id, 100) || ids.has(r.id) || !Number.isSafeInteger(r.number) || r.number < 1 || numbers.has(r.number) || !text(r.title, 80) || !text(r.reason, 500) || !Number.isFinite(Date.parse(r.createdAt)) || !Array.isArray(r.revisions) || !r.revisions.length || r.revisions.length > 100) return null;
      if (r.costChecks !== undefined && (!r.costChecks || typeof r.costChecks !== "object" || Array.isArray(r.costChecks) || Object.keys(r.costChecks).length !== 3 || !Object.keys(costItems).every(key => Object.hasOwn(r.costChecks,key) && Object.hasOwn(costStatuses,r.costChecks[key])))) return null;
      ids.add(r.id); numbers.add(r.number);
      const documents = new Set<string>();
      for (const ref of r.revisions) {
        if (!ref || !text(ref.documentId, 100) || documents.has(ref.documentId) || !text(ref.title, 80) || !Number.isSafeInteger(ref.revision) || ref.revision < 1 || !Number.isSafeInteger(ref.page) || ref.page < 1 || !Object.hasOwn(reviewLoopLabels, ref.phase)) return null;
        documents.add(ref.documentId);
      }
      if(r.costProposals!==undefined&&(!Array.isArray(r.costProposals)||r.costProposals.length>100||r.costProposals.some((p:CostProposal)=>!p||!text(p.id,100)||!Object.hasOwn(proposalKinds,p.kind)||typeof p.item!=="string"||p.item.length>100||typeof p.unit!=="string"||p.unit.length>20||typeof p.note!=="string"||p.note.length>500||!documents.has(p.documentId))||new Set(r.costProposals.map((p:CostProposal)=>p.id)).size!==r.costProposals.length))return null;
    }
    return rows;
  } catch { return null; }
}

export function createChangeRound(current: ChangeRound[], projectId: string, title: string, reason: string, revisions: RevisionRef[], id: string, createdAt: string): ChangeRound {
  const round = {id, projectId, number: Math.max(0, ...current.map(r => r.number)) + 1, title: title.trim(), reason: reason.trim(), createdAt, revisions: revisions.map(r => ({...r}))};
  if (!parseChangeRounds(JSON.stringify([...current, round]), projectId)) throw Error("변경 이름·사유와 연결할 도면 개정을 확인해 주세요.");
  return round;
}

export function saveChangeRound(current: ChangeRound[], round: ChangeRound, storage: Pick<Storage, "setItem">): ChangeRound[] {
  const next = [...current, round];
  if (!parseChangeRounds(JSON.stringify(next), round.projectId)) throw Error("변경 회차 정보가 일치하지 않습니다.");
  storage.setItem(storageKey(round.projectId), JSON.stringify(next));
  return next;
}

export function saveChangeCostChecks(current: ChangeRound[], projectId: string, roundId: string, checks: CostChecks, storage: Pick<Storage,"setItem">): ChangeRound[] {
  if (!current.some(round => round.id === roundId) || !parseChangeRounds(JSON.stringify(current),projectId)) throw Error("변경 회차 정보가 일치하지 않습니다.");
  const next = current.map(round => round.id === roundId ? {...round,costChecks:{...checks}} : round);
  if (!parseChangeRounds(JSON.stringify(next),projectId)) throw Error("비용 점검 상태를 확인해 주세요.");
  storage.setItem(storageKey(projectId),JSON.stringify(next));
  return next;
}

export function saveChangeCostProposals(current:ChangeRound[],projectId:string,roundId:string,proposals:CostProposal[],storage:Pick<Storage,"setItem">):ChangeRound[] {
  if(!current.some(round=>round.id===roundId))throw Error("변경 회차를 찾을 수 없습니다.");
  const next=current.map(round=>round.id===roundId?{...round,costProposals:proposals.map(proposal=>({...proposal}))}:round);
  if(!parseChangeRounds(JSON.stringify(next),projectId))throw Error("내역 변경안의 항목·도면 근거를 확인해 주세요.");
  storage.setItem(storageKey(projectId),JSON.stringify(next));return next;
}

function ChangeCostProposals({round,viewer,onSave,hrefFor,onSaveState}:{round:ChangeRound;viewer:boolean;onSave:(rows:CostProposal[])=>void;hrefFor:(documentId:string,roundId:string)=>string|null;onSaveState:(failed:boolean)=>void}) {
  const [rows,setRows]=useState(round.costProposals??[]);
  const [failed,setFailed]=useState(false);
  const save=(next:CostProposal[])=>{if(viewer)return;setRows(next);try{onSave(next);setFailed(false);onSaveState(false);}catch{setFailed(true);onSaveState(true);}};
  return <section className="mt-3 grid gap-3" aria-label={`제${round.number}차 내역 변경안`}>
    <h4 className="font-semibold">내역 변경안 · 미확정</h4><p className="text-xs text-muted-foreground">내역 항목의 추가·제외·기준 수정안을 작성합니다. 실제 내역표나 금액에 반영하지 않으며 점검 상태도 자동 변경하지 않습니다.</p>
    {!viewer&&<div className="flex flex-wrap gap-2">{(Object.keys(proposalKinds) as (keyof CostChecks)[]).map(kind=><Button key={kind} type="button" variant="outline" disabled={rows.length>=100} onClick={()=>save([...rows,{id:crypto.randomUUID(),kind,item:"",unit:"",note:"",documentId:round.revisions[0].documentId}])}>{proposalKinds[kind]} 변경안 작성</Button>)}</div>}
    {!rows.length&&<p className="text-sm text-muted-foreground">아직 작성한 내역 변경안이 없습니다.</p>}
    <ol className="grid gap-3">{rows.map((row,index)=>{const href=hrefFor(row.documentId,round.id);const update=(patch:Partial<CostProposal>)=>save(rows.map(item=>item.id===row.id?{...item,...patch}:item));return <li key={row.id} className="grid gap-2 rounded-lg border bg-background p-3" aria-label={`내역 변경안 ${index+1}`}>
      <p className="text-sm font-medium">{proposalKinds[row.kind]} · 변경안 {index+1}</p>
      <fieldset disabled={viewer} className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">내역 항목명<input className="rounded border p-2" maxLength={100} value={row.item} onChange={e=>update({item:e.target.value})}/></label>
        <label className="grid gap-1 text-sm">단위<input className="rounded border p-2" maxLength={20} value={row.unit} onChange={e=>update({unit:e.target.value})}/></label>
        <label className="grid gap-1 text-sm sm:col-span-2">변경 사유·기준<textarea className="rounded border p-2" maxLength={500} value={row.note} onChange={e=>update({note:e.target.value})}/></label>
        <label className="grid gap-1 text-sm sm:col-span-2">연결 도면<select className="rounded border p-2" value={row.documentId} onChange={e=>update({documentId:e.target.value})}>{round.revisions.map(ref=><option key={ref.documentId} value={ref.documentId}>{ref.title} · R{ref.revision} · {ref.page}쪽</option>)}</select></label>
      </fieldset>
      {href?<Link className="text-sm underline" to={href}>변경안의 도면 근거 보기</Link>:<p role="alert">연결 도면을 찾을 수 없습니다.</p>}
      {!viewer&&<Button type="button" variant="ghost" onClick={()=>save(rows.filter(item=>item.id!==row.id))}>이 변경안 제거</Button>}
    </li>;})}</ol>
    {failed?<p role="alert">변경안을 보관하지 못했습니다. 입력은 현재 화면에만 유지됩니다.<Button type="button" variant="outline" onClick={()=>save(rows)}>변경안 보관 다시 시도</Button></p>:<p className="text-xs text-muted-foreground">입력은 이 탭에 보관됩니다. 보고서는 항목명과 사유가 작성된 변경안을 포함합니다.</p>}
  </section>;
}

function ChangeCostChecklist({round,viewer,onSave,onSaveState}: {round:ChangeRound;viewer:boolean;onSave:(checks:CostChecks)=>void;onSaveState:(failed:boolean)=>void}) {
  const [checks,setChecks]=useState<CostChecks>(round.costChecks ?? {addition:"unchecked",deletion:"unchecked",basis:"unchecked"});
  const [failed,setFailed]=useState(false);
  const save=(next:CostChecks)=>{
    if (viewer) return;
    setChecks(next);
    try {onSave(next);setFailed(false);onSaveState(false);} catch {setFailed(true);onSaveState(true);}
  };
  return <section className="mt-3 grid gap-2 rounded-lg border bg-background p-3" aria-label={`제${round.number}차 변경 내역 점검`}>
    <h4 className="text-sm font-semibold">내역 누락 점검 · 수동 체크리스트</h4>
    <p className="text-xs text-muted-foreground">누락을 자동 탐지한 결과가 아닙니다. 이 변경에서 확인할 항목을 직접 표시하세요. 도면 승인과 내역·금액 확정은 별개입니다.</p>
    <fieldset className="grid gap-2" disabled={viewer}>{(Object.keys(costItems) as (keyof CostChecks)[]).map(key=><label key={key} className="grid gap-1 text-sm">{costItems[key]}<select className="min-h-10 rounded border bg-background px-2" value={checks[key]} onChange={e=>save({...checks,[key]:e.target.value as CostStatus})}>{Object.entries(costStatuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>)}</fieldset>
    <p className="text-xs">{Object.values(checks).filter(status=>status==="unchecked").length}개 미확인 · 실제 내역 행 수정·금액 계산 없음</p>
    {failed && <div role="alert" className="text-sm text-destructive">점검 상태를 보관하지 못했습니다. 현재 선택은 이 창에서만 유지됩니다.<Button type="button" variant="outline" onClick={()=>save(checks)}>점검 보관 다시 시도</Button></div>}
  </section>;
}

const reportSections = {reason:"변경 사유",drawings:"영향 도면·개정",comparison:"전후 비교 근거",cost:"내역 점검 요약"};
type ReportSection = keyof typeof reportSections;
type ReportConfig = {roundIds:string[];format:"pdf"|"xlsx";recipient:string;sections:ReportSection[]};
type ChangeReport = {id:string;number:number;createdAt:string;rounds:ChangeRound[]} & Omit<ReportConfig,"roundIds">;
const defaultReportConfig:ReportConfig={roundIds:[],format:"pdf",recipient:"발주 담당 · 예시",sections:["reason","drawings","cost"]};
function validReportConfig(c: ReportConfig): boolean {
  return Boolean(c && ["pdf","xlsx"].includes(c.format) && typeof c.recipient === "string" && c.recipient.length <= 100 && Array.isArray(c.roundIds) && c.roundIds.length <= 500 && c.roundIds.every(id=>typeof id === "string" && id.length > 0 && id.length <= 100) && new Set(c.roundIds).size===c.roundIds.length && Array.isArray(c.sections) && c.sections.every(key=>Object.hasOwn(reportSections,key)) && new Set(c.sections).size===c.sections.length);
}
export function createChangeReport(rounds:ChangeRound[], config:ReportConfig, id:string, number:number, createdAt:string):ChangeReport {
  if (!validReportConfig(config) || !config.recipient.trim() || !config.roundIds.length || !config.sections.length || !id || !Number.isSafeInteger(number) || number<1 || !Number.isFinite(Date.parse(createdAt))) throw Error("회차·포함 항목·수신자를 확인해 주세요.");
  const selected=rounds.filter(round=>config.roundIds.includes(round.id));
  if(selected.length!==config.roundIds.length) throw Error("선택한 변경 회차를 찾을 수 없습니다.");
  if(config.sections.includes("cost")&&selected.some(round=>round.costProposals?.some(row=>!row.item.trim()||!row.note.trim())))throw Error("내역 변경안의 항목명과 변경 사유를 작성해 주세요.");
  return {id,number,createdAt,format:config.format,recipient:config.recipient.trim(),sections:[...config.sections],rounds:structuredClone(selected)};
}

export function DrawingChangeReportPreview({returnHref,viewer}: {returnHref:string;viewer:boolean}) {
  let projectId: string | null = null;
  let readOnly = viewer;
  try {
    const url = new URL(returnHref, "http://preview.local");
    const id = url.searchParams.get("project");
    if (returnHref.startsWith("/") && url.origin === "http://preview.local" && url.pathname === "/workspace-preview" && id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) projectId = id;
    readOnly ||= url.searchParams.get("role") === "viewer";
  } catch { /* Missing project context must not select a default project. */ }
  return <section aria-label="프로젝트 변경 보고서" className="border-t pt-4">
    {projectId ? <StoredChangeReportPreview key={projectId} projectId={projectId} viewer={readOnly}/> : <p className="text-sm text-muted-foreground">프로젝트에 연결된 도면에서 변경 보고서를 구성할 수 있습니다. 독립 작업에는 프로젝트 변경 이력이 없습니다.</p>}
  </section>;
}

function StoredChangeReportPreview({projectId,viewer}: {projectId:string;viewer:boolean}) {
  const [rounds,setRounds] = useState<ChangeRound[] | null>(null);
  const [error,setError] = useState(false);
  const [attempt,setAttempt] = useState(0);
  useEffect(()=>{
    try {
      const parsed=parseChangeRounds(sessionStorage.getItem(storageKey(projectId)) ?? "[]",projectId);
      if (!parsed) throw Error("invalid rounds");
      setRounds(parsed);setError(false);
    } catch {setError(true);}
  },[projectId,attempt]);
  if (error) return <div role="alert">변경 회차를 복원하지 못했습니다. 기존 기록은 변경하지 않았습니다.<Button type="button" variant="outline" onClick={()=>setAttempt(value=>value+1)}>변경 회차 다시 불러오기</Button></div>;
  if (!rounds) return <p role="status">변경 회차를 불러오고 있습니다.</p>;
  return <ChangeReportPreview projectId={projectId} rounds={rounds} viewer={viewer}/>;
}

function ChangeReportPreview({projectId,rounds,viewer,pendingCost=false}: {projectId:string;rounds:ChangeRound[];viewer:boolean;pendingCost?:boolean}) {
  const [config,setConfig]=useState<ReportConfig>(defaultReportConfig);
  const [reports,setReports]=useState<ChangeReport[]>([]);
  const [loaded,setLoaded]=useState(false);
  const [blocked,setBlocked]=useState(false);
  const [error,setError]=useState("");
  const key=`${storageKey(projectId)}:reports`;
  useEffect(()=>{
    try {
      const raw=sessionStorage.getItem(key);
      if(raw){
        const saved=JSON.parse(raw);
        if(!validReportConfig(saved.config) || !Array.isArray(saved.reports) || saved.reports.length>50) throw Error("invalid");
        const ids=new Set(); const numbers=new Set();
        for(const report of saved.reports){
          if(!report || typeof report.id!=="string" || !report.id || report.id.length>100 || ids.has(report.id) || numbers.has(report.number) || !Array.isArray(report.rounds) || !report.rounds.length || !parseChangeRounds(JSON.stringify(report.rounds),projectId)) throw Error("invalid report");
          createChangeReport(report.rounds,{...report,roundIds:report.rounds.map((r:ChangeRound)=>r.id)},report.id,report.number,report.createdAt);
          ids.add(report.id);numbers.add(report.number);
        }
        setConfig(saved.config);setReports(saved.reports);
      }
    }catch{setBlocked(true);setError("보고서 구성 기록을 복원하지 못했습니다. 기존 기록을 보호하기 위해 변경을 중지했습니다.");}
    setLoaded(true);
  },[key,projectId]);
  const persist=(nextConfig:ReportConfig,nextReports:ChangeReport[])=>sessionStorage.setItem(key,JSON.stringify({config:nextConfig,reports:nextReports}));
  const configure=(next:ReportConfig)=>{
    if(viewer || !loaded || blocked)return;
    setConfig(next);
    try{persist(next,reports);setError("");}catch{setError("구성을 보관하지 못했습니다. 현재 입력은 이 창에만 유지됩니다. 저장 공간을 확인한 뒤 다시 시도해 주세요.");}
  };
  return <details className="rounded-xl border p-4">
    <summary className="cursor-pointer font-semibold">변경 이력 보고서 · 납품 구성 예시</summary>
    <p className="my-3 text-sm text-muted-foreground">회차 범위와 제출 항목을 확인합니다. 실제 PDF·Excel 생성 및 발송은 하지 않습니다.</p>
    {!loaded && <p role="status">보고서 구성을 복원하고 있습니다.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <fieldset disabled={viewer || !loaded || blocked} className="grid gap-3">
      <legend className="text-sm font-medium">보고서 구성</legend>
      <Button type="button" variant="outline" onClick={()=>configure({...config,roundIds:rounds.map(r=>r.id)})}>현재 회차 전체 선택</Button>
      {rounds.map(round=><label className="flex items-start gap-2 text-sm" key={round.id}><input type="checkbox" checked={config.roundIds.includes(round.id)} onChange={e=>configure({...config,roundIds:e.target.checked?[...config.roundIds,round.id]:config.roundIds.filter(id=>id!==round.id)})}/>제{round.number}차 변경 · {round.title}</label>)}
      {!rounds.length && <p className="text-sm">변경 회차를 먼저 등록해 주세요.</p>}
      <label className="grid gap-1 text-sm">보고서 형식<select className="rounded border bg-background p-2" value={config.format} onChange={e=>configure({...config,format:e.target.value as ReportConfig["format"]})}><option value="pdf">PDF · 보고서</option><option value="xlsx">Excel · 내역 변경 표</option></select></label>
      <label className="grid gap-1 text-sm">수신자 예시<input className="rounded border bg-background p-2" maxLength={100} value={config.recipient} onChange={e=>configure({...config,recipient:e.target.value})}/></label>
      <fieldset className="grid gap-2"><legend className="text-sm">포함 항목</legend>{(Object.keys(reportSections) as ReportSection[]).map(section=><label className="flex items-center gap-2 text-sm" key={section}><input type="checkbox" checked={config.sections.includes(section)} onChange={e=>configure({...config,sections:e.target.checked?[...config.sections,section]:config.sections.filter(s=>s!==section)})}/>{reportSections[section]}</label>)}</fieldset>
      <p className="text-xs text-muted-foreground">전후 비교는 검토 기록 참조이며 원본 비교 이미지 생성은 미연결입니다. 내역 점검은 수동 표시이며 금액 변화 계산이 아닙니다. 등록 당시 검토 상태가 최종 납품 승인을 의미하지 않습니다.</p>
      {pendingCost&&<p role="alert">저장되지 않은 내역 점검·변경안이 있습니다. 보관을 다시 시도한 뒤 보고서를 구성하세요.</p>}
      <Button type="button" disabled={pendingCost || !config.roundIds.length || !config.sections.length || !config.recipient.trim() || reports.length>=50} onClick={()=>{
        if(pendingCost)return;
        try{
          const report=createChangeReport(rounds,config,crypto.randomUUID(),Math.max(0,...reports.map(r=>r.number))+1,new Date().toISOString());
          const next=[...reports,report];persist(config,next);setReports(next);setError("");
        }catch(e){setError(`${e instanceof Error?e.message:"기록하지 못했습니다."} 구성은 유지됩니다. 실제 파일·발송은 없습니다.`);}
      }}>구성 확인 · 예시 기록 남기기</Button>
      {reports.length>=50 && <p>이 탭의 보고서 예시 기록 한도 50개에 도달했습니다.</p>}
      {error && !blocked && <Button type="button" variant="outline" onClick={()=>configure(config)}>구성 보관 다시 시도</Button>}
    </fieldset>
    {viewer && <p className="text-sm">보기 전용 · 보고서 구성을 변경하거나 기록할 수 없습니다.</p>}
    <ol className="mt-4 grid gap-3">{[...reports].reverse().map(report=><li className="rounded border p-3 text-sm" key={report.id}>
      <h4 className="font-semibold">보고서 구성 {report.number} · {report.format.toUpperCase()} · 미발송</h4>
      <p className="break-words">수신자 예시: {report.recipient}</p><p>포함 항목: {report.sections.map(s=>reportSections[s]).join(" · ")}</p>
      {report.rounds.map(round=><div key={round.id} className="mt-2"><p>제{round.number}차 변경 · {round.title}</p>{report.sections.includes("reason") && <p className="whitespace-pre-wrap break-words">{round.reason}</p>}{report.sections.includes("drawings") && <p>{round.revisions.map(ref=>`${ref.title} R${ref.revision} ${ref.page}쪽`).join(" · ")}</p>}{report.sections.includes("cost") && <p>수동 점검: {(Object.keys(costItems) as (keyof CostChecks)[]).map(key=>`${costItems[key]} ${costStatuses[round.costChecks?.[key] ?? "unchecked"]}`).join(" · ")}</p>}{report.sections.includes("cost") && (round.costProposals??[]).map(row=><p key={row.id} className="mt-1 break-words">내역 변경안 · {proposalKinds[row.kind]} · {row.item} · {row.unit||"단위 미지정"} · {row.note} · {round.revisions.find(ref=>ref.documentId===row.documentId)?.title} · 미확정</p>)}{report.sections.includes("comparison") && <p>전후 비교: 연결된 검토 기록 참조 · 원본 비교 이미지 미생성</p>}</div>)}
      <p className="mt-2 text-xs text-muted-foreground">확인 당시 구성 보관 · 이후 회차 변경을 자동 반영하지 않습니다. 실제 파일 생성·납품 기록이 아닙니다.</p>
    </li>)}</ol>
  </details>;
}

export function ProjectChangePreview({projectId, viewer, candidates, readError, hrefFor}: {
  projectId: string; viewer: boolean; candidates: RevisionRef[]; readError: boolean; hrefFor: (documentId: string, roundId: string) => string | null;
}) {
  const [query] = useSearchParams();
  const highlightedRound = query.get("changeRound");
  const focusedRound = useRef<string | null>(null);
  const [rounds, setRounds] = useState<ChangeRound[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [restoreError, setRestoreError] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [draftId, setDraftId] = useState("");
  const [draftError, setDraftError] = useState(false);
  const [saveAttempt, setSaveAttempt] = useState(0);
  const [failedCost, setFailedCost] = useState<Record<string,boolean>>({});
  const pendingCost = Object.values(failedCost).some(Boolean);
  const blocker = useBlocker(pendingCost);
  const [exitWarning,setExitWarning] = useState(false);
  useEffect(()=>{if(blocker.state==="blocked"){blocker.reset();setExitWarning(true);}},[blocker]);
  useEffect(()=>{
    if(!pendingCost){setExitWarning(false);return;}
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
  },[pendingCost]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey(projectId));
      const restored = raw ? parseChangeRounds(raw, projectId) : [];
      if (!restored) throw Error("invalid");
      setRounds(restored);
      const rawDraft = sessionStorage.getItem(`${storageKey(projectId)}:draft`);
      const draft = rawDraft ? parseChangeDraft(rawDraft) : null;
      if (rawDraft && !draft) throw Error("invalid draft");
      // A successfully registered draft must not reappear if clearing its storage failed.
      if (draft && !restored.some(round => round.id === draft.id)) {
        setTitle(draft.title); setReason(draft.reason); setSelected(draft.selected); setDraftId(draft.id);
      } else { setDraftId(crypto.randomUUID()); }
    } catch { setRestoreError(true); }
    setLoaded(true);
  }, [projectId]);
  useEffect(() => {
    if (!loaded || restoreError || viewer || !draftId) return;
    try {
      sessionStorage.setItem(`${storageKey(projectId)}:draft`, JSON.stringify({id:draftId,title,reason,selected}));
      setDraftError(false);
    } catch { setDraftError(true); }
  }, [projectId, loaded, restoreError, viewer, draftId, title, reason, selected, saveAttempt]);
  useEffect(() => {
    if (!highlightedRound) { focusedRound.current = null; return; }
    if (loaded && focusedRound.current !== highlightedRound && rounds.some(round => round.id === highlightedRound)) {
      const target = document.getElementById(`change-round-${highlightedRound}`);
      if (target) { target.focus({preventScroll:true}); target.scrollIntoView({block:"nearest"}); focusedRound.current = highlightedRound; }
    }
  }, [loaded, highlightedRound, rounds]);
  return <section className="grid gap-4" aria-label="프로젝트 변경 회차">
    {exitWarning&&<p role="alert" className="rounded-lg border border-amber-300 p-3 text-sm">저장되지 않은 입력을 보호하기 위해 이동을 멈췄습니다. 내역 점검·변경안의 보관 다시 시도를 완료해 주세요.</p>}
    <p className="text-sm text-muted-foreground">변경 회차는 여러 도면 개정을 묶는 업무 기록입니다. 도면 개정 번호와 별개이며, 이 탭에만 보관하는 화면 예시입니다.</p>
    {(!loaded || restoreError || readError) && <p role={restoreError || readError ? "alert" : "status"}>{restoreError ? "변경 이력을 읽지 못했습니다. 기존 기록을 보호하기 위해 등록을 중지했습니다. 창을 닫고 다시 열어 주세요." : readError ? "일부 도면 검토 기록을 읽지 못했습니다. 도면에서 확인한 뒤 다시 열어 주세요." : "변경 이력을 복원하고 있습니다."}</p>}
    {!viewer && <form className="grid gap-3 rounded-xl border p-4" onSubmit={event => {
      event.preventDefault();
      if (!loaded || restoreError || readError) return;
      try {
        const refs = candidates.filter(r => selected.includes(r.documentId));
        if (refs.length !== selected.length) throw Error("연결할 도면을 다시 선택해 주세요.");
        const round = createChangeRound(rounds, projectId, title, reason, refs, draftId, new Date().toISOString());
        setRounds(saveChangeRound(rounds, round, sessionStorage));
        setTitle(""); setReason(""); setSelected([]); setDraftId(crypto.randomUUID()); setError("");
      } catch (e) { setError(`${e instanceof Error ? e.message : "등록하지 못했습니다."} 입력은 유지됩니다. 저장 공간과 선택 항목을 확인한 뒤 다시 시도해 주세요.`); }
    }}>
      <h3 className="font-semibold">새 변경 회차</h3>
      {draftError ? <div role="alert" className="text-sm text-destructive">입력을 보관하지 못했습니다. 창을 닫으면 작성 중 내용이 사라질 수 있습니다.<Button type="button" variant="outline" onClick={() => setSaveAttempt(n => n + 1)}>입력 보관 다시 시도</Button></div> : loaded && !restoreError ? <p className="text-xs text-muted-foreground">작성 중 입력은 이 탭에 보관됩니다. 다른 프로젝트와 공유되지 않습니다.</p> : null}
      <label className="grid gap-1 text-sm">변경 이름<input className="rounded border p-2" maxLength={80} required value={title} onChange={e => setTitle(e.target.value)}/></label>
      <label className="grid gap-1 text-sm">변경 사유<textarea className="rounded border p-2" maxLength={500} required value={reason} onChange={e => setReason(e.target.value)}/></label>
      <fieldset className="grid gap-2" disabled={!loaded || restoreError || readError}><legend className="text-sm font-medium">연결할 현재 도면 개정</legend>
        {candidates.map(ref => <label key={ref.documentId} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={selected.includes(ref.documentId)} onChange={e => setSelected(e.target.checked ? [...selected, ref.documentId] : selected.filter(id => id !== ref.documentId))}/><span>{ref.title} · R{ref.revision} · {ref.page}쪽 · {reviewLoopLabels[ref.phase]}</span></label>)}
        {!candidates.length && <p className="text-sm">연결할 검토 기록이 없습니다. 도면에서 변경·검토 요청을 진행한 뒤 다시 열어 주세요.</p>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={!loaded || restoreError || readError || !selected.length || !title.trim() || !reason.trim()}>변경 회차를 이 탭에 보관</Button>
    </form>}
    {viewer && <p className="text-sm">보기 전용 · 변경 회차를 등록할 수 없습니다.</p>}
    {loaded && !restoreError && !rounds.length && <p className="rounded-xl border border-dashed p-5">아직 등록한 변경 회차가 없습니다.</p>}
    {loaded && !restoreError && <ChangeReportPreview projectId={projectId} rounds={rounds} viewer={viewer} pendingCost={pendingCost}/>}
    <ol className="grid gap-3">{[...rounds].reverse().map(round => <li key={round.id} id={`change-round-${round.id}`} tabIndex={-1} className={`rounded-xl border p-4 focus:outline-2 focus:outline-violet-500 ${highlightedRound === round.id ? "border-violet-500 bg-violet-50 dark:bg-violet-950" : ""}`}>
      <h3 className="break-words font-semibold">제{round.number}차 변경 · {round.title}</h3>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{round.reason}</p>
      <p className="mt-1 text-xs text-muted-foreground">등록: {new Date(round.createdAt).toLocaleString("ko-KR")} · 로컬 화면 체험</p>
      <ul className="mt-3 grid gap-2">{round.revisions.map(ref => {
        const href = hrefFor(ref.documentId, round.id);
        return <li key={ref.documentId} className="rounded border p-3 text-sm"><p>{ref.title} · 등록 당시 R{ref.revision} · {ref.page}쪽</p><p>등록 당시: {reviewLoopLabels[ref.phase]}</p>{href ? <Link className="underline" to={href}>R{ref.revision} 검토 기록 읽기 전용으로 열기</Link> : <p role="alert">연결된 도면 또는 검토 기록을 찾을 수 없습니다.</p>}</li>;
      })}</ul>
      <ChangeCostChecklist round={round} viewer={viewer || restoreError} onSaveState={failed=>setFailedCost(current=>({...current,[`checks:${round.id}`]:failed}))} onSave={checks=>setRounds(saveChangeCostChecks(rounds,projectId,round.id,checks,sessionStorage))}/>
      <ChangeCostProposals round={round} viewer={viewer || restoreError} hrefFor={hrefFor} onSaveState={failed=>setFailedCost(current=>({...current,[`proposals:${round.id}`]:failed}))} onSave={rows=>setRounds(saveChangeCostProposals(rounds,projectId,round.id,rows,sessionStorage))}/>
      <p className="mt-3 text-xs text-muted-foreground">등록 당시 참조 기록이며 개정 원본의 별도 저장은 아닙니다. 과거 개정은 도면의 이전 개정 이력에서 확인하세요. 내역 행·비용 영향 금액·납품 기록은 아직 연결되지 않았습니다.</p>
    </li>)}</ol>
  </section>;
}
