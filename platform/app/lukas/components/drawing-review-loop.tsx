import { useState, type Dispatch } from "react";
import { ArrowRight, Check, MapPin, MessageSquare, MoveRight } from "lucide-react";
import {screenShapeKinds,validScreenObjectProperties,type ScreenShape} from "./drawing-screen-object-preview";
import {DrawingObjectPropertiesRecord} from "./drawing-object-properties-record";
import {validScreenBlockCode} from "./drawing-screen-blocks";

type Phase = "draft" | "changed" | "requested" | "changes" | "revised" | "reviewed" | "approved";
type ReviewRevision = {revision: number; page: number; position: number; before: number; phase: Phase; issue: string; message: string;target?:ScreenShape;beforeTarget?:ScreenShape};
export type ReviewLoopState = {
  phase: Phase;
  role: "author" | "reviewer" | "approver";
  revision: number;
  page: number;
  position: number;
  before: number;
  issue: string;
  message: string;
  focused: boolean;
  compared: boolean;
  history: ReviewRevision[];
  target?:ScreenShape;
  beforeTarget?:ScreenShape;
};
export type ReviewLoopAction =
  | { type: "restore"; state: ReviewLoopState }
  | { type: "role"; role: ReviewLoopState["role"] }
  | { type: "move"; page: number }
  | { type: "target" | "edit-target"; object: ScreenShape }
  | { type: "request" | "changes"; message: string }
  | { type: "focus" | "resolve" | "compare" | "review-complete" | "approve" | "new-revision" | "reset" };

export function createReviewLoop(initial: "draft" | "requested" | "changes" | "approved" = "draft"): ReviewLoopState {
  return { phase: initial, role: "author", revision: 1, page: 1, position: initial === "draft" ? 0 : 1, before: 0,
    issue: initial === "changes" ? "문을 벽 끝에서 더 이격해 주세요." : "", message: initial === "draft" ? "" : "출입구 위치 변경을 확인해 주세요. · 예시",
    focused: false, compared: false, history: [] };
}

function archivedRevision(s: ReviewLoopState): ReviewRevision {
  return {revision:s.revision, page:s.page, position:s.position, before:s.before, phase:s.phase, issue:s.issue, message:s.message,...(s.target?{target:{...s.target}}:{}),...(s.beforeTarget?{beforeTarget:{...s.beforeTarget}}:{})};
}

export function validTarget(value:unknown):value is ScreenShape {
  if(!value||typeof value!=="object")return false;
  const object=value as ScreenShape;
  return typeof object.id==="string"&&object.id.length>0&&object.id.length<=100&&screenShapeKinds.includes(object.kind)&&Number.isSafeInteger(object.page)&&object.page>0&&
    Number.isFinite(object.x)&&object.x>=0&&object.x<=1000&&Number.isFinite(object.y)&&object.y>=0&&object.y<=700&&
    (object.rotation===undefined||(Number.isFinite(object.rotation)&&object.rotation>=0&&object.rotation<=359))&&
    (object.width===undefined||(Number.isFinite(object.width)&&object.width>=1&&object.width<=1000))&&
    (object.height===undefined||(Number.isFinite(object.height)&&object.height>=1&&object.height<=(object.kind==="폴리라인"?10000:700)))&&
    (object.kind==="폴리라인"?Array.isArray(object.points)&&object.points.length>=2&&object.points.length<=256&&object.points.every(point=>point&&Number.isFinite(point.x)&&point.x>=0&&point.x<=140&&Number.isFinite(point.y)&&point.y>=0&&point.y<=90):object.points===undefined)&&
    typeof object.name==="string"&&object.name.length<=80&&typeof object.layer==="string"&&object.layer.length<=100&&
    typeof object.color==="string"&&/^#[0-9a-f]{6}$/i.test(object.color)&&["0.25 mm","0.50 mm","1.00 mm"].includes(object.lineWidth)&&
    ["없음","연한 보라","연한 회색"].includes(object.fill)&&typeof object.text==="string"&&object.text.length<=500&&
    (object.properties===undefined||validScreenObjectProperties(object.properties))&&
    (object.kind==="블록"?validScreenBlockCode(object.blockCode):object.blockCode===undefined);
}

export function reviewRevisionFor(state: ReviewLoopState, revision: number, page: number): ReviewLoopState | null {
  const saved = state.revision === revision ? state : state.history.find(item => item.revision === revision);
  if (!saved || saved.page !== page) return null;
  return {...saved, role: "author", history: [], compared: true, focused: true};
}

export function parseReviewLoopSession(raw: string): ReviewLoopState | null {
  const revision = (value: unknown): value is ReviewRevision => {
    if (!value || typeof value !== "object") return false;
    const r = value as ReviewRevision;
    return [r.revision,r.page].every(n=>Number.isSafeInteger(n)&&n>0) &&
      [r.position,r.before].every(n=>Number.isSafeInteger(n)&&n>=0) &&
      ["draft","changed","requested","changes","revised","reviewed","approved"].includes(r.phase) &&
      typeof r.issue === "string" && r.issue.length<=500 && typeof r.message === "string" && r.message.length<=500&&
      (r.target===undefined||(validTarget(r.target)&&r.target.page===r.page))&&(r.beforeTarget===undefined||(validTarget(r.beforeTarget)&&r.beforeTarget.id===r.target?.id&&r.beforeTarget.page===r.page));
  };
  try {
    const value = JSON.parse(raw) as ReviewLoopState;
    if (!revision(value) || !["author","reviewer","approver"].includes(value.role) || !Array.isArray(value.history) || !value.history.every(revision)) return null;
    return {...value, focused:false, compared:false};
  } catch { return null; }
}

// Screen-only session. No request, identity or drawing mutation leaves this component.
export function reviewLoopReducer(s: ReviewLoopState, a: ReviewLoopAction): ReviewLoopState {
  if (a.type === "restore") return a.state;
  if (a.type === "reset") return createReviewLoop();
  if (a.type === "role") return { ...s, role: a.role, compared: false };
  if (a.type === "focus") return { ...s, focused: true };
  if (a.type === "compare") return { ...s, compared: true };
  if (s.role === "author") {
    if(a.type==="target"&&s.phase==="draft"&&!s.target&&s.position===0&&validTarget(a.object))return {...s,phase:"changed",page:a.object.page,target:{...a.object},focused:true};
    if(a.type==="edit-target"&&s.target&&["draft","changed","revised"].includes(s.phase)&&validTarget(a.object)&&a.object.id===s.target.id&&a.object.page===s.page){
      if(JSON.stringify(a.object)===JSON.stringify(s.target))return s;
      return {...s,target:{...a.object},phase:s.issue?"revised":"changed",compared:false};
    }
    if(a.type==="move"&&s.target)return s;
    if (a.type === "move" && s.phase === "draft") return { ...s, phase: "changed", page: s.position > 0 ? s.page : a.page, before: s.position, position: s.position + 1, focused: true };
    if (a.type === "request" && (s.phase === "changed" || s.phase === "revised") && a.message.trim()) return { ...s, phase: "requested", message: a.message.trim(), compared: false, focused: false };
    if (a.type === "resolve" && s.phase === "changes" && s.focused) return { ...s, phase: s.target?"draft":"revised", revision: s.revision + 1, before: s.position, position: s.target?s.position:s.position + 1, ...(s.target?{beforeTarget:{...s.target}}:{}), compared: false, history: [...s.history, archivedRevision(s)] };
    if (a.type === "new-revision" && s.phase === "approved") return { ...createReviewLoop(), revision: s.revision + 1, page: s.page, position: s.position, before: s.position,...(s.target?{target:{...s.target},beforeTarget:{...s.target}}:{}), history: [...s.history, archivedRevision(s)] };
  } else if (s.role === "reviewer" && s.phase === "requested") {
    if (a.type === "changes" && a.message.trim()) return { ...s, phase: "changes", issue: a.message.trim(), focused: false };
    if (a.type === "review-complete" && s.compared) return { ...s, phase: "reviewed", compared: false };
  } else if (s.role === "approver" && s.phase === "reviewed") {
    if (a.type === "approve" && s.compared) return { ...s, phase: "approved" };
    if (a.type === "changes" && a.message.trim()) return { ...s, phase: "changes", issue: a.message.trim(), focused: false };
  }
  return s;
}

export const reviewLoopLabels: Record<Phase, string> = {
  draft: "작성 중", changed: "변경 1건", requested: "검토 대기", changes: "수정 요청", revised: "재검토 준비", reviewed: "검토 완료 · 승인 대기", approved: "승인된 개정",
};

export type InternalReviewRequest={id:string;originRevision:number;revision:number;page:number;message:string;status:"pending"|"working"|"resolved"|"unknown"};
export function internalReviewRequests(documentId:string,state:ReviewLoopState):InternalReviewRequest[] {
  const requests:InternalReviewRequest[]=[];
  let active:InternalReviewRequest|undefined;
  let previousApproved=false;
  for(const revision of [...state.history,state]){
    if(!revision.issue){active=undefined;previousApproved=revision.phase==="approved";continue;}
    if(!active||active.message!==revision.issue||previousApproved){
      active={id:`internal:${documentId}:R${revision.revision}:I01`,originRevision:revision.revision,revision:revision.revision,page:revision.page,message:revision.issue,status:"unknown"};
      requests.push(active);
    }
    active.revision=revision.revision;active.page=revision.page;
    active.status=revision.phase==="approved"?"resolved":revision.revision!==state.revision?"unknown":revision.phase==="changes"?"pending":["revised","requested","reviewed"].includes(revision.phase)?"working":"unknown";
    previousApproved=revision.phase==="approved";
  }
  return requests;
}

export function ReviewHistory({history}: {history: ReviewRevision[]}) {
  if (!history.length) return null;
  return <section className="review-change-card" aria-label="이전 개정 이력">
    <h3>이전 개정</h3><p>이 도면의 화면 예시 기록입니다. 현재 개정을 덮어쓰지 않습니다.</p>
    {[...history].reverse().map(revision => <details className="review-object-details" key={revision.revision}>
      <summary>R{revision.revision} · {reviewLoopLabels[revision.phase]} · {revision.page}쪽</summary>
      {revision.target?<ReviewTargetSummary target={revision.target} before={revision.beforeTarget}/>:<><p>보관본 · 읽기 전용 · D01</p>
      <svg viewBox="0 0 100 60" role="img" aria-label={`R${revision.revision} 보관된 문 위치`} style={{width:"100%",maxHeight:130}}>
        <path d="M8 42 H92 M8 45 H92" stroke="#475569" strokeWidth="1" fill="none" />
        <path d={`M${24 + (revision.before % 5) * 10} 42 v-18 a18 18 0 0 1 18 18`} stroke="#64748b" strokeWidth="1.5" strokeDasharray="2 2" fill="none" />
        <path d={`M${24 + (revision.position % 5) * 10} 42 v-18 a18 18 0 0 1 18 18`} stroke="#6d28d9" strokeWidth="2" fill="none" />
      </svg>
      <p>위치 {revision.before + 1} → 위치 {revision.position + 1}</p></>}
      <p>검토 요청: {revision.message || "없음"}</p>
      {revision.issue ? <p>I01 의견: {revision.issue}</p> : null}
    </details>)}
  </section>;
}

function ReviewTargetSummary({target,before}:{target:ScreenShape;before?:ScreenShape}) {
  return <section aria-label="고정 도형 속성"><h3>{target.name||target.kind} · {target.page}쪽</h3><p>화면 도형 1개 · 원본 CAD 객체가 아닙니다.</p>
    <dl><dt>종류</dt><dd>{target.kind}</dd><dt>이름</dt><dd>{before?`${before.name} → `:"새 도형 · "}{target.name}</dd><dt>선 색상</dt><dd>{before?`${before.color} → `:""}{target.color}</dd><dt>선 굵기</dt><dd>{before?`${before.lineWidth} → `:""}{target.lineWidth}</dd><dt>채움</dt><dd>{before?`${before.fill} → `:""}{target.fill}</dd><dt>텍스트</dt><dd>{before?`${before.text||"없음"} → `:""}{target.text||"없음"}</dd></dl>
    <details><summary>도형 식별 정보</summary><p>{target.id} · 레이어 {target.layer}</p></details>
    <DrawingObjectPropertiesRecord object={target} before={before}/>
  </section>;
}

export function DrawingReviewIssueSummary({ state: s, onLocate }: { state: ReviewLoopState; onLocate: () => void }) {
  if (!s.issue) return null;
  return <article className="review-issue"><span className="review-kicker"><MessageSquare size={13}/> I01 · 김검토의 위치 의견</span><p>{s.issue}</p><small>{s.phase === "changes"||s.phase === "draft" ? "미해결" : s.phase === "approved" ? "반영 확인 · 해결됨" : "수정 반영 · 재검토 대상"}</small><button type="button" className="review-secondary" onClick={onLocate}>{s.target?.name||"D01"} · {s.page}쪽 의견 위치 보기</button></article>;
}

export function DrawingReviewLoop({ state: s, dispatch, ready, viewer, onLocate, page = 1, showIssueSummary=true }: {
  state: ReviewLoopState; dispatch: Dispatch<ReviewLoopAction>; ready: boolean; viewer: boolean; onLocate: () => void; page?: number;showIssueSummary?:boolean;
}) {
  const [message, setMessage] = useState("출입구 위치 변경에 따른 통행 간섭을 확인해 주세요.");
  const [reason, setReason] = useState("");
  if (!ready) return <div className="review-loop"><h2>도면을 먼저 열어 주세요</h2><p>도면의 변경 위치와 검토 의견을 함께 확인합니다.</p><p>편집·저장·공유는 아직 연결되지 않았습니다.</p></div>;
  if (viewer) return <div className="review-loop"><h2>보기 전용</h2><p>{reviewLoopLabels[s.phase]} · R{s.revision} · {s.page}쪽</p><p>작성과 검토 결정은 이 화면에서 할 수 없습니다.</p><article className="review-change-card">{s.target?<ReviewTargetSummary target={s.target} before={s.beforeTarget}/>:<><h3>D01 · 문 위치 변경 예시</h3><p>위치 {s.before + 1} → 위치 {s.position + 1}</p></>}<p className="whitespace-pre-wrap break-words">검토 요청: {s.message || "요청 내용 없음"}</p>{s.issue && <p className="whitespace-pre-wrap break-words">수정 요청: {s.issue}</p>}<small>원본 도면 객체가 아닌 화면 예시의 검토 기록입니다.</small></article><ReviewHistory history={s.history}/></div>;
  const author = s.role === "author";
  const active = Boolean(s.target)||s.phase !== "draft" || s.position > 0;
  return <section className="review-loop" aria-label="도면 검토 패널">
    <div className="review-demo-label">화면 체험 · 저장·전송·실제 승인 없음</div>
    <div className="review-role-switch" role="group" aria-label="체험 역할 전환">
      <button aria-pressed={author} onClick={() => dispatch({ type: "role", role: "author" })}>작성자 보기</button>
      <button aria-pressed={s.role === "reviewer"} onClick={() => dispatch({ type: "role", role: "reviewer" })}>검토자 보기</button>
      <button aria-pressed={s.role === "approver"} onClick={() => dispatch({ type: "role", role: "approver" })}>승인자 보기</button>
    </div>
    <div className="review-heading"><span>R{String(s.revision).padStart(2, "0")} · {active ? `${s.page}쪽` : "초안"}</span><h2 aria-live="polite">{!author && s.phase === "requested" ? "변경 검토" : reviewLoopLabels[s.phase]}</h2></div>
    <p className="review-context">{author ? "내 변경을 요청하고, 돌아온 의견을 수정합니다." : s.role === "reviewer" ? "김검토 · 변경 위치를 확인하고 검토를 완료합니다. 최종 승인은 승인자가 결정합니다." : "이승인 · 검토 완료된 개정을 확인하고 최종 승인하거나 수정을 요청합니다."} 역할 전환은 화면 체험이며 실제 권한 부여가 아닙니다.</p>
    <article className="review-change-card">
      {s.target?<><ReviewTargetSummary target={s.target} before={s.compared?s.beforeTarget:undefined}/><p>{["requested","reviewed","approved"].includes(s.phase)?"검토 대상 고정 · 화면 예시":"작성 중 · 화면 예시"}</p><button className="review-secondary" onClick={onLocate}>{s.page}쪽 변경 위치 보기</button><button className="review-secondary" onClick={()=>{onLocate();dispatch({type:"compare"});}}>변경 전후 확인</button>{s.phase==="draft"&&<p>도면 위 도형을 선택해 속성을 수정한 뒤 검토를 요청하세요. 새 개정 시작만으로 수정 완료 처리하지 않습니다.</p>}</>:<>
      <span className="review-kicker">D01 · 문 위치 변경 예시</span>
      <h3>출입구 위치 조정</h3>
      <p>원본 위 별도 예시 도형입니다. 실제 문 인식이나 CAD 편집이 아닙니다.</p>
      {active && <>
        <details className="review-object-details"><summary>객체 속성 · D01</summary><dl><dt>종류</dt><dd>문 · 예시 도형</dd><dt>레이어</dt><dd>검토 오버레이</dd><dt>근거</dt><dd>{s.page}쪽 · D01</dd><dt>개정</dt><dd>R{s.revision}</dd><dt>상태</dt><dd>{s.phase === "approved" ? "승인 · 읽기 전용" : s.phase === "requested" || s.phase === "reviewed" ? "검토 대상 고정" : "작성 중 · 예시"}</dd></dl></details>
        <div className="review-position"><span>위치 {s.before + 1}</span><ArrowRight size={14}/><strong>위치 {s.position + 1}</strong></div>
        <button className="review-secondary" onClick={onLocate}><MapPin size={14}/> {s.page}쪽 변경 위치 보기</button>
        <button className="review-secondary" onClick={() => { onLocate(); dispatch({ type: "compare" }); }}>변경 전후 확인</button>
        {s.compared && <small>점선: 변경 전 · 실선: 현재 검토 대상</small>}
      </>}
      {s.phase === "draft" && (author ? <button className="review-primary" onClick={() => { dispatch({ type: "move", page }); onLocate(); }}><MoveRight size={15}/> 문 위치 변경 체험</button> : <p>작성자가 변경을 요청하면 이곳에서 검토합니다.</p>)}
      </>}
    </article>
    {showIssueSummary&&<DrawingReviewIssueSummary state={s} onLocate={onLocate}/>}
    {(s.phase === "requested" || s.phase === "reviewed") && <p className="review-request-message"><strong>요청 내용</strong>{s.message}</p>}
    {author && (s.phase === "changed" || s.phase === "revised") && <form onSubmit={e => { e.preventDefault(); dispatch({ type: "request", message }); }}>
      <label>검토 담당자<select aria-label="검토 담당자"><option>김검토 · 검토자 예시</option></select></label>
      <label>요청 내용<textarea value={message} onChange={e => setMessage(e.target.value)} maxLength={500} required /></label>
      <p className="review-context">{s.page}쪽 · 변경 1건을 R{s.revision} 검토 대상으로 고정합니다.</p>
      <button className="review-primary" disabled={!message.trim()}>{s.phase === "revised" ? "재검토 요청" : "검토 요청"}</button>
    </form>}
    {author && s.phase === "requested" && <div className="review-next"><strong>김검토의 검토를 기다립니다.</strong><p>위의 ‘검토자 보기’로 상대방 화면을 체험할 수 있습니다. 요청한 내용은 검토 중 수정하지 않습니다.</p></div>}
    {((s.role === "reviewer" && s.phase === "requested") || (s.role === "approver" && s.phase === "reviewed")) && <form onSubmit={e => { e.preventDefault(); dispatch({ type: "changes", message: reason }); }}>
      <label>{s.target?.name||"D01"} 위치에 수정 의견<textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} placeholder="수정이 필요한 내용을 입력하세요." required /></label>
      <button className="review-secondary" disabled={!reason.trim()}>수정 요청</button>
      <button type="button" className="review-primary" disabled={!s.compared} onClick={() => dispatch({ type: s.role === "reviewer" ? "review-complete" : "approve" })}><Check size={15}/> {s.role === "reviewer" ? "검토 완료 · 승인 요청" : "최종 승인하기"}</button>
      {!s.compared && <small>변경 전후를 확인한 뒤 결정할 수 있습니다.</small>}
    </form>}
    {s.phase === "reviewed" && s.role !== "approver" && <div className="review-next"><strong>검토가 완료되어 최종 승인을 기다립니다.</strong><p>검토 대상은 고정되어 있습니다. ‘승인자 보기’에서 최종 결정 과정을 체험하세요.</p></div>}
    {s.phase === "requested" && s.role === "approver" && <p>검토자가 검토를 완료하면 최종 승인할 수 있습니다.</p>}
    {s.phase === "changes" && (author ? <div className="review-next"><p>{s.target?"요청된 개정은 보존하고 새 개정에서 해당 도형을 수정합니다.":"의견 위치를 확인하고 예시 도형을 한 번 더 이동합니다."}</p><button className="review-secondary" onClick={onLocate}>의견 위치로 이동</button><button className="review-primary" disabled={!s.focused} onClick={() => dispatch({ type: "resolve" })}>{s.target?"수정할 새 개정 시작":"의견 반영 · 문 위치 재조정"}</button></div> : <div className="review-next">작성자에게 수정 요청한 상태입니다. ‘작성자 보기’에서 수정 과정을 이어가세요.</div>)}
    {!author && s.phase === "revised" && <p>작성자가 재검토를 요청하면 수정된 버전을 검토할 수 있습니다.</p>}
    {s.phase === "approved" && <div className="review-next"><strong>R{s.revision} 읽기 전용 · 승인 예시</strong><p>이 버전은 유지됩니다. 추가 수정은 새 개정에서 시작합니다. 내보내기는 상단에서 별도로 선택합니다.</p>{author && <button className="review-secondary" onClick={() => dispatch({ type: "new-revision" })}>새 개정 시작</button>}</div>}
    <ReviewHistory history={s.history}/>
  </section>;
}

export function DrawingReviewMarker({ state: s, onLocate }: { state: ReviewLoopState; onLocate: () => void }) {
  if(s.target)return null;
  if (s.phase === "draft" && s.position === 0) return null;
  const x = (n: number) => 24 + (n % 5) * 10;
  return <div className="review-marker" data-focused={s.focused} aria-label="D01 문 위치 변경 예시">
    <svg viewBox="0 0 100 60" aria-label="예시 도형의 변경 전후" role="img">
      <path d="M8 42 H92 M8 45 H92" stroke="#475569" strokeWidth="1" fill="none"/>
      {s.compared && <path d={`M${x(s.before)} 42 v-18 a18 18 0 0 1 18 18`} stroke="#64748b" strokeWidth="1.5" strokeDasharray="2 2" fill="none"/>}
      <path d={`M${x(s.position)} 42 v-18 a18 18 0 0 1 18 18`} stroke="#6d28d9" strokeWidth="2" fill="none"/>
    </svg>
    <button type="button" data-review-pin onPointerDown={e => e.stopPropagation()} onClick={onLocate}><MapPin size={13}/> D01 · {s.phase === "draft" ? "기준 도형" : s.issue ? "의견 1" : "변경 1"} · 예시</button>
  </div>;
}
