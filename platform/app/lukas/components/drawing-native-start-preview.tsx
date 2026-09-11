import {useState} from "react";
import {Button} from "~/core/components/ui/button";

type RegistrationDocument = {id: string; title: string};
export type RegistrationChoice = {mode: "new" | "revision"; targetId: string; reason: string};
export type RegistrationRecord = {mode: "new" | "revision"; fileName: string; targetTitle: string; reason: string};
export function parseRegistrationRecord(value: unknown): RegistrationRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as RegistrationRecord;
  if (record.mode !== "new" && record.mode !== "revision") return null;
  for (const field of [record.fileName, record.targetTitle, record.reason]) if (typeof field !== "string" || field.length > 500) return null;
  if (!record.fileName.trim() || (record.mode === "revision" && (!record.targetTitle.trim() || !record.reason.trim()))) return null;
  return {mode: record.mode, fileName: record.fileName, targetTitle: record.targetTitle, reason: record.reason};
}
export function DrawingRegistrationNotice({record,localListing=false}: {record: RegistrationRecord;localListing?:boolean}) {
  return <details className="mx-3 my-2 max-h-40 shrink-0 overflow-y-auto rounded-lg border bg-background p-3 text-sm" aria-label="등록 준비 기록">
    <summary className="cursor-pointer font-medium">등록 준비 기록 · {record.mode === "revision" ? "새 개정 준비 · 미등록" : localListing ? "목록 정보 보관 · 이 탭" : "새 도면 준비 · 미등록"}</summary>
    {localListing && record.mode === "new" && <p className="mt-2">프로젝트의 도면 목록 정보만 이 브라우저 탭에 보관했습니다. 원본 파일은 서버에 업로드되지 않았으며 다시 열 때 재선택해야 합니다.</p>}
    <dl className="mt-3 grid gap-2 break-words"><div><dt>선택한 파일 이름</dt><dd>{record.fileName}</dd></div>{record.mode === "revision" && <><div><dt>대상 도면</dt><dd>{record.targetTitle}</dd></div><div><dt>변경 사유</dt><dd>{record.reason}</dd></div></>}</dl>
    <p className="mt-2 text-xs text-muted-foreground">가져오기에서 확인한 준비 내용입니다. 기존 도면·원본·승인 개정을 변경하지 않았으며 아래 검토 예시와 별개입니다. 이 탐색 기록에만 연결되며 공유 URL에는 포함되지 않습니다.</p>
  </details>;
}
export function registrationPreviewError(choice: RegistrationChoice, documents: RegistrationDocument[]) {
  if (choice.mode === "new") return null;
  if (!documents.some(document => document.id === choice.targetId)) return "같은 프로젝트의 대상 도면을 선택해 주세요.";
  if (!choice.reason.trim()) return "변경 사유를 입력해 주세요.";
  if (choice.reason.length > 300) return "변경 사유는 300자 이내로 입력해 주세요.";
  return null;
}

export function DrawingRegistrationPreview({fileName, documents, initial, onContinue, onBack,localListing=false}: {
  fileName: string; documents: RegistrationDocument[]; initial?: RegistrationChoice;
  onContinue: (choice: RegistrationChoice) => void; onBack: (choice: RegistrationChoice) => void;
  localListing?:boolean;
}) {
  const [choice, setChoice] = useState<RegistrationChoice>(initial ?? {mode: "new", targetId: "", reason: ""});
  const error = registrationPreviewError(choice, documents);
  const normalized = (name: string) => name.normalize("NFC").trim().replace(/\.(pdf|dwg|ifc)$/i, "").toLocaleLowerCase();
  const matches = documents.filter(document => normalized(document.title) === normalized(fileName));
  return <form className="grid gap-3 rounded-xl border p-4" aria-label="도면 등록 방식" onSubmit={event => {event.preventDefault(); if (!error) onContinue({...choice, reason: choice.reason.trim()});}}>
    <h3 className="font-semibold">도면 등록 방식 · 화면 예시</h3>
    {matches.length > 0 && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">같은 이름의 도면이 있습니다: {matches.map(document => document.title).join(", ")}. 이름 기준 안내이며 동일 파일인지 분석한 결과는 아닙니다.</p>}
    <label className="grid gap-2 text-sm">등록 방식<select className="min-h-10 rounded-lg border px-3" value={choice.mode} onChange={event => setChoice({...choice, mode: event.target.value as RegistrationChoice["mode"]})}><option value="new">별도 새 도면으로 시작</option><option value="revision" disabled={!documents.length}>기존 도면의 새 개정으로 준비</option></select></label>
    {!documents.length && <p className="text-sm text-muted-foreground">이 프로젝트에 대상 도면이 없어 새 개정을 선택할 수 없습니다.</p>}
    {choice.mode === "revision" && <>
      <label className="grid gap-2 text-sm">대상 도면<select className="min-h-10 min-w-0 rounded-lg border px-3" value={choice.targetId} onChange={event => setChoice({...choice, targetId: event.target.value})}><option value="">도면 선택</option>{documents.map(document => <option key={document.id} value={document.id}>{document.title}</option>)}</select></label>
      <label className="grid gap-2 text-sm">변경 사유<textarea maxLength={300} className="min-h-24 rounded-lg border p-3" value={choice.reason} onChange={event => setChoice({...choice, reason: event.target.value})}/></label>
      <p className="text-sm">기존 원본·승인 개정·검토 기록을 덮어쓰지 않습니다. 실제 등록 시 새 개정에서 페이지·객체 근거의 재연결 검토가 필요합니다.</p>
    </>}
    <p className="text-xs text-muted-foreground">{localListing ? "새 도면을 선택하면 목록 정보만 이 탭에 보관합니다. 새 개정 선택은 준비 예시이며 개정 번호를 발급하거나 기존 도면을 덮어쓰지 않습니다. 원본 파일 업로드·서버 저장은 하지 않습니다." : "기존 도면을 덮어쓰지 않습니다. 현재는 등록 의도를 확인하는 화면입니다. 실제 도면 추가·개정 번호 발급·원본 교체·저장은 실행되지 않습니다."}</p>
    {error && <p role="status" className="text-sm text-amber-800">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={Boolean(error)}>등록 방식 확인 후 준비</Button><Button type="button" variant="outline" onClick={()=>onBack(choice)}>준비 조건으로 돌아가기</Button></div>
  </form>;
}

export function NativePreparationProgress({onCancel, onFailure, onContinue}: {onCancel: () => void; onFailure: () => void; onContinue: () => void}) {
  return <section className="grid gap-3 rounded-xl border p-4" aria-label="가져오기 준비 예시">
    <h3 className="font-semibold" role="status">작업실 준비 중 · 화면 예시</h3>
    <p className="text-sm text-muted-foreground">실제 파일 처리나 업로드는 실행되지 않습니다. 아래에서 준비 이후의 화면을 선택해 흐름을 확인하세요.</p>
    <ul className="list-disc space-y-1 pl-5 text-sm"><li>선택한 표시 방식 유지</li><li>원본·참조 연결 확인 대기 · 엔진 필요</li><li>미연결 작업실 화면으로 이동 가능</li></ul>
    <div className="flex flex-wrap gap-2">
      <Button onClick={onContinue}>작업실 화면으로 계속</Button>
      <Button variant="outline" onClick={onFailure}>실패 상태 체험</Button>
      <Button variant="ghost" onClick={onCancel}>준비 취소</Button>
    </div>
  </section>;
}

export function DrawingNativeStartPreview({kind, documents = [], onOpen}: {kind: "dwg" | "ifc"; documents?: RegistrationDocument[]; onOpen: (view: "2d" | "3d" | "split", title: string, record: RegistrationRecord) => void}) {
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [step, setStep] = useState<"select" | "check" | "registration" | "preparing" | "failed">("select");
  const [registration, setRegistration] = useState<RegistrationChoice>({mode: "new", targetId: "", reason: ""});
  const [space, setSpace] = useState("model");
  const [view, setView] = useState<"2d" | "3d" | "split">(kind === "dwg" ? "2d" : "split");
  const [dependencies, setDependencies] = useState(false);
  const [delivery, setDelivery] = useState(false);
  const label = kind.toUpperCase();
  return <div className="grid gap-4">
    <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">화면 예시 · {label} 엔진 미연결. 파일 내용을 해석하지 않습니다. 실제 객체 편집·변환·재저장·업로드는 하지 않습니다.</p>
    <ol className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="가져오기 단계"><li>1 파일 선택</li><li>2 준비 조건 확인</li><li>3 등록 방식</li><li>4 작업실 화면</li></ol>
    {step === "select" ? <>
      <label className="grid gap-2 rounded-xl border border-dashed p-4 text-sm">{label} 파일 선택 · 이름만 확인
        <input type="file" accept={`.${kind}`} onChange={e => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (!file.name.toLowerCase().endsWith(`.${kind}`)) {setFileName("");setError(`${label} 파일을 선택해 주세요.`);e.target.value="";return;}
          setFileName(file.name);setError("");
          e.target.value="";
        }} />
      </label>
      {fileName ? <p className="break-all text-sm">선택한 이름: {fileName}</p> : null}
      {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-2"><Button disabled={!fileName} onClick={()=>setStep("check")}>준비 조건 확인</Button><Button variant="outline" onClick={()=>{setFileName(`${label} 가져오기 예시`);setError("");setStep("check");}}>파일 없이 준비 화면 체험</Button></div>
    </> : <>
      <p className="break-all text-sm font-semibold">{fileName} · 실제 분석 결과 아님</p>
      {step === "registration" ? <DrawingRegistrationPreview fileName={fileName} documents={documents} initial={registration} onBack={choice=>{setRegistration(choice);setStep("check");}} onContinue={choice=>{setRegistration(choice);setStep("preparing");}}/> : step === "preparing" ? <>
        <p className="text-sm">{registration.mode === "revision" ? `${documents.find(document=>document.id===registration.targetId)?.title} · 새 개정 준비 예시 · ${registration.reason}` : "별도 새 도면 준비 예시"} · 등록·저장 없음</p>
        <NativePreparationProgress onCancel={()=>setStep("registration")} onFailure={()=>setStep("failed")} onContinue={()=>onOpen(view, registration.mode === "revision" ? `${documents.find(document=>document.id===registration.targetId)?.title} · 새 개정 준비 예시` : `${label} ${kind === "dwg" ? space === "model" ? "모델 공간" : "레이아웃" : "모델"} 화면 예시`, {mode: registration.mode, fileName, targetTitle: documents.find(document=>document.id===registration.targetId)?.title ?? "", reason: registration.reason})} />
      </> : step === "failed" ? <section role="alert" className="rounded-xl border border-red-200 p-4"><h3 className="font-semibold">준비 실패 · 화면 예시</h3><p className="mt-2 text-sm">형식을 확인할 수 없거나 의존 파일을 읽지 못한 경우입니다. 원본은 변경되지 않았습니다.</p><div className="mt-3 flex flex-wrap gap-2"><Button onClick={()=>setStep("registration")}>등록 방식 확인 후 재시도</Button><Button variant="outline" onClick={()=>setStep("check")}>준비 화면으로 돌아가기</Button></div></section> : <>
        {kind === "dwg" ? <label className="grid gap-2 text-sm">작업 공간 · 예시<select className="min-h-10 rounded-lg border px-3" value={space} onChange={e=>setSpace(e.target.value)}><option value="model">모델 공간</option><option value="layout">레이아웃 · Sheet 1 예시</option></select></label> : <label className="grid gap-2 text-sm">모델 표시 방식<select className="min-h-10 rounded-lg border px-3" value={view} onChange={e=>setView(e.target.value as "3d"|"split")}><option value="split">분할 보기</option><option value="3d">3D 모델</option></select></label>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dependencies} onChange={e=>setDependencies(e.target.checked)} />누락 항목 안내 예시 보기</label>
        {dependencies ? <p role="status" className="rounded-lg border p-3 text-sm">{kind === "dwg" ? "외부참조 XREF · SHX 글꼴 · 미지원 객체: 보완 파일 및 왕복 보존 검증이 필요합니다." : "좌표·단위·층 분류를 확인해야 합니다. IFC GlobalId 연결은 아직 수행되지 않았습니다."}</p> : null}
        <div className="flex flex-wrap gap-2"><Button onClick={()=>setStep("registration")}>작업실 준비 화면 체험</Button><Button variant="outline" onClick={()=>setStep("failed")}>실패 상태 체험</Button></div>
        {kind === "dwg" ? <Button variant="outline" onClick={()=>setDelivery(v=>!v)} aria-expanded={delivery}>DWG 납품 준비 조건</Button> : null}
        {delivery && kind === "dwg" ? <section className="rounded-xl border p-4"><h3 className="font-semibold">DWG 재저장·납품</h3><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm"><li>대상 개정과 모델·레이아웃 범위 고정</li><li>지원 객체·외부참조·글꼴 보존 확인</li><li>새 DWG 생성 후 재열기 비교</li><li>검증 결과와 함께 납품 패키지 구성</li></ol><p className="mt-3 text-sm text-amber-800">엔진 미연결로 실제 DWG 생성과 납품은 차단됩니다.</p><Button disabled className="mt-3">DWG 파일 생성 · 엔진 필요</Button></section> : null}
      </>}
      <Button variant="ghost" onClick={()=>{setStep("select");setDelivery(false);}}>파일 선택으로 돌아가기</Button>
    </>}
    <p className="text-xs text-muted-foreground">{kind === "dwg" ? "모델 공간·레이아웃 선택, 외부참조·폰트 점검, DWG 재저장 검증을 위한 준비 화면입니다." : "IFC 준비 후 3D 모델·분할 보기로 이어질 화면입니다. 실제 형상은 연결되지 않았습니다."}</p>
  </div>;
}
