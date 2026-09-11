import { useEffect, useState } from "react";
import { Button } from "~/core/components/ui/button";
type Section = "organization" | "retention" | "templates" | "usage";
type ManagementDraft = {current:Section;name:string;template:string;templateNotes:Record<string,string>;policy:string};
const pendingDrafts = new Map<string, ManagementDraft>();
const warnPending = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
export function WorkspaceManagementPreview({
  viewer,
  section = "organization",
  draftKey,
}: {
  viewer: boolean;
  section?: Section;
  draftKey?: string;
}) {
  const [current, setCurrent] = useState<Section>(section);
  const [name, setName] = useState("개인 작업공간");
  const [template, setTemplate] = useState("사무실 평면 · 예시");
  const [templateNotes, setTemplateNotes] = useState<Record<string, string>>({});
  const [policy, setPolicy] = useState("미설정");
  const [restored,setRestored] = useState(!draftKey);
  const [blocked,setBlocked] = useState(false);
  const [error,setError] = useState("");
  const [retry,setRetry] = useState(0);
  useEffect(()=>{
    if(!draftKey)return;
    try{
      const pending=pendingDrafts.get(draftKey);
      const raw=pending?null:sessionStorage.getItem(draftKey);
      const saved=pending??(raw===null?null:JSON.parse(raw));
      if(pending||raw!==null){
        const templates=["사무실 평면 · 예시","주택 평면 · 예시","카페 평면 · 예시"];
        if(!saved||!["organization","retention","templates","usage"].includes(saved.current)||typeof saved.name!=="string"||saved.name.length>80||!templates.includes(saved.template)||!["미설정","프로젝트 종료 후 보존 · 예시","관리자 검토 후 정리 · 예시"].includes(saved.policy)||!saved.templateNotes||typeof saved.templateNotes!=="object"||Array.isArray(saved.templateNotes)||Object.entries(saved.templateNotes).some(([key,value])=>!templates.includes(key)||typeof value!=="string"||value.length>500))throw Error("invalid management draft");
        setCurrent(saved.current);setName(saved.name);setTemplate(saved.template);setTemplateNotes(saved.templateNotes);setPolicy(saved.policy);
        if(pending)setError("보관하지 못한 관리 초안을 메모리에서 복원했습니다. 새로고침 전에 보관을 다시 시도해 주세요.");
      }
    }catch{setBlocked(true);setError("관리 초안을 복원하지 못했습니다. 기존 초안을 덮어쓰지 않았습니다.");}
    setRestored(true);
  },[draftKey]);
  useEffect(()=>{
    if(!draftKey||!restored||blocked||viewer)return;
    const draft={current,name,template,templateNotes,policy};
    try{
      sessionStorage.setItem(draftKey,JSON.stringify(draft));
      pendingDrafts.delete(draftKey);if(!pendingDrafts.size)window.removeEventListener("beforeunload",warnPending);
      setError("");
    }catch{
      pendingDrafts.set(draftKey,draft);window.addEventListener("beforeunload",warnPending);
      setError("관리 초안을 보관하지 못했습니다. 입력은 현재 페이지 메모리에 유지됩니다. 새로고침 전에 보관을 다시 시도해 주세요.");
    }
  },[draftKey,restored,blocked,viewer,current,name,template,templateNotes,policy,retry]);
  return (
    <section className="grid gap-4" aria-label="관리 화면">
      <p className="rounded-lg bg-violet-50 p-3 text-xs text-violet-800">
        {draftKey?"개인 작업공간 화면 초안 · 이 탭에만 보관 · 실제 조직 설정 변경 없음":"화면 예시 · 실제 설정·저장 없음 · 닫으면 입력 초기화"}
      </p>
      {!restored&&<p role="status">관리 초안을 불러오고 있습니다.</p>}
      {error&&<p role="alert">{error}</p>}
      {error&&!blocked&&<Button type="button" variant="outline" onClick={()=>setRetry(value=>value+1)}>관리 초안 보관 다시 시도</Button>}
      <nav aria-label="관리 항목" className="grid grid-cols-2 gap-2">
        {(
          [
            ["organization", "조직·역할"],
            ["retention", "보존·복구"],
            ["templates", "템플릿 관리"],
            ["usage", "사용 범위"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            type="button"
            disabled={!restored||blocked}
            variant={current === id ? "default" : "outline"}
            aria-pressed={current === id}
            onClick={() => setCurrent(id)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {current === "usage" ? (
        <dl className="grid grid-cols-2 gap-3 rounded-xl border p-4 text-sm">
          <dt>저장 공간</dt>
          <dd>사용량 미집계</dd>
          <dt>구성원 한도</dt>
          <dd>요금제 미연결</dd>
          <dt>플랜·청구</dt>
          <dd>결제 미연결</dd>
          <dt>현재 체험 범위</dt>
          <dd>로컬 화면 예시</dd>
        </dl>
      ) : (
        <fieldset
          disabled={viewer||!restored||blocked}
          className="grid gap-4 rounded-xl border p-4"
        >
          {current === "organization" ? (
            <>
              <label className="grid gap-2 text-sm">
                조직 이름
                <input
                  maxLength={80}
                  className="min-h-10 rounded-lg border bg-background px-3"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <p className="text-sm">
                표시 예시: {name.trim() || "조직 이름 미입력"}
              </p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt>관리자</dt>
                <dd>구성원·보존 정책</dd>
                <dt>편집자</dt>
                <dd>도면·레이어·속성</dd>
                <dt>댓글 작성자</dt>
                <dd>댓글·수정 요청</dd>
                <dt>검토자</dt>
                <dd>검토 결정·수정 요청</dd>
                <dt>승인자</dt>
                <dd>검토된 개정의 최종 승인</dd>
                <dt>보기 전용</dt>
                <dd>조회</dd>
              </dl>
              <p className="text-xs text-muted-foreground">
                실제 역할 배정·구성원 정보 미연결
              </p>
              <p className="text-xs text-muted-foreground">검토 완료만으로 최종 승인 권한이 생기지 않습니다. 화면 체험 역할과 실제 계정 권한은 별개입니다.</p>
            </>
          ) : current === "retention" ? (
            <>
              <label className="grid gap-2 text-sm">
                보존 정책 예시
                <select
                  className="min-h-10 rounded-lg border bg-background px-3"
                  value={policy}
                  onChange={(e) => setPolicy(e.target.value)}
                >
                  <option>미설정</option>
                  <option>프로젝트 종료 후 보존 · 예시</option>
                  <option>관리자 검토 후 정리 · 예시</option>
                </select>
              </label>
              <p className="text-sm">선택: {policy}</p>
              <p className="rounded-lg bg-muted p-3 text-sm">
                복구 가능한 백업 미연결
              </p>
              <Button type="button" disabled variant="outline">
                복구 대상 없음
              </Button>
              <p className="text-xs text-muted-foreground">
                삭제·보존 기간 변경·복원은 실행하지 않습니다.
              </p>
            </>
          ) : (
            <>
              <label className="grid gap-2 text-sm">
                템플릿 선택
                <select
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  className="min-h-10 rounded-lg border bg-background px-3"
                >
                  <option>사무실 평면 · 예시</option>
                  <option>주택 평면 · 예시</option>
                  <option>카페 평면 · 예시</option>
                </select>
              </label>
              <p className="text-sm font-semibold">{template}</p>
              <label className="grid gap-2 text-sm">
                관리 메모
                <textarea
                  maxLength={500}
                  value={templateNotes[template] ?? ""}
                  onChange={(event) => setTemplateNotes(notes => ({...notes, [template]: event.target.value}))}
                  className="min-h-20 rounded-lg border bg-background p-3"
                  placeholder="회사 표준·사용 목적을 화면에서만 작성"
                />
              </label>
              <p className="text-xs text-muted-foreground">
                샘플 이미지 템플릿 · 실제 회사 라이브러리 등록·게시 없음
              </p>
            </>
          )}
        </fieldset>
      )}
      {viewer && (
        <p className="text-xs text-muted-foreground">
          Viewer · 관리 양식은 보기 전용입니다.
        </p>
      )}
    </section>
  );
}
