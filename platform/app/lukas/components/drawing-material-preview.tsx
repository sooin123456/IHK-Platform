import { useEffect, useState } from "react";
import { Button } from "~/core/components/ui/button";
import { ProjectResourceReader } from "./project-resource-reader";
type Stage = "material" | "order" | "receipt" | "evidence";
export type MaterialSourceReference = { page: number; revision: number; source?: { kind: "pdf" | "office" | "house" | "blank"; paper: "A2" | "A3" | "A4"; fingerprint?: string } };
export function isMaterialSourceReference(value: unknown): value is MaterialSourceReference {
  if (!value || typeof value !== "object") return false;
  const ref = value as MaterialSourceReference;
  return [ref.page, ref.revision].every(number => Number.isSafeInteger(number) && number > 0) && (ref.source === undefined || Boolean(ref.source && ["pdf","office","house","blank"].includes(ref.source.kind) && ["A2","A3","A4"].includes(ref.source.paper) && (ref.source.kind === "pdf" || ref.page === 1) && (ref.source.fingerprint === undefined || typeof ref.source.fingerprint === "string" && /^[a-f0-9]{64}$/.test(ref.source.fingerprint))));
}
export function DrawingMaterialPreview({
  documentName,
  page,
  ready,
  viewer,
  onReturn,
  stage = "material",
  draftKey,
  onSaveFailure,
  sourceCandidate,
}: {
  documentName: string;
  page: number;
  ready: boolean;
  viewer: boolean;
  onReturn: () => void;
  stage?: Stage;
  draftKey?: string;
  onSaveFailure?: (failed:boolean)=>void;
  sourceCandidate?: MaterialSourceReference;
}) {
  const [current, setCurrent] = useState<Stage>(stage);
  const [name, setName] = useState("마감 자재 · 예시");
  const [supplier, setSupplier] = useState("");
  const [memo, setMemo] = useState("");
  const [receipt, setReceipt] = useState("미확인");
  const [linkedEvidence, setLinkedEvidence] = useState(false);
  const [sourceReference, setSourceReference] = useState<MaterialSourceReference | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [restored,setRestored]=useState(!draftKey);
  const [blocked,setBlocked]=useState(false);
  const [error,setError]=useState("");
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!draftKey)return;
    try{
      const raw=sessionStorage.getItem(draftKey);
      if(raw!==null){
        const saved=JSON.parse(raw);
        if(!saved||!["material","order","receipt","evidence"].includes(saved.current)||typeof saved.name!=="string"||saved.name.length>80||typeof saved.supplier!=="string"||saved.supplier.length>80||typeof saved.memo!=="string"||saved.memo.length>500||!["미확인","수량 차이 확인 필요","파손 확인 필요","검수 표시 예시"].includes(saved.receipt)||typeof saved.linkedEvidence!=="boolean")throw Error("invalid draft");
        if(saved.sourceReference!=null&&!isMaterialSourceReference(saved.sourceReference))throw Error("invalid source reference");
        setSourceReference(saved.sourceReference??null);
        setCurrent(saved.current);setName(saved.name);setSupplier(saved.supplier);setMemo(saved.memo);setReceipt(saved.receipt);setLinkedEvidence(saved.linkedEvidence);
      }
    }catch{setBlocked(true);setError("자재 초안을 복원하지 못했습니다. 기존 초안을 덮어쓰지 않았습니다.");}
    setRestored(true);
  },[draftKey]);
  useEffect(()=>{
    if(!draftKey||!restored||blocked||viewer)return;
    try{sessionStorage.setItem(draftKey,JSON.stringify({current,name,supplier,memo,receipt,linkedEvidence,sourceReference}));setError("");onSaveFailure?.(false);}
    catch{setError("자재 초안을 보관하지 못했습니다. 현재 입력을 유지한 채 다시 시도해 주세요.");onSaveFailure?.(true);}
  },[draftKey,restored,blocked,viewer,current,name,supplier,memo,receipt,linkedEvidence,sourceReference,retry,onSaveFailure]);
  if (!ready)
    return (
      <p className="rounded-xl border p-4">
        도면을 먼저 열어 주세요. 연결된 자재가 없습니다.
      </p>
    );
  return (
    <section className="grid gap-4" aria-label="자재 업무 화면 예시">
      <p className="rounded-lg bg-violet-50 p-3 text-xs text-violet-800">
        {draftKey?"도면별 초안 · 이 탭에만 보관 · 실제 발주·입고 없음":"화면 예시 · 실제 발주·입고·저장 없음"}
      </p>
      {draftKey&&<p className="text-xs text-muted-foreground">{page}쪽 A01은 연결 설명용 예시이며 실제 자재의 페이지·개정 매핑은 미등록입니다.</p>}
      {draftKey && <section className="grid gap-2 rounded-lg border p-3 text-sm" aria-label="자재 지정 근거">
        <strong>{sourceReference ? `지정 근거: R${sourceReference.revision} · ${sourceReference.page}쪽` : "지정 근거 없음"}</strong>
        <p className="text-xs text-muted-foreground">페이지·개정 번호와 원본 식별 정보를 기록합니다. 원본 파일 자체나 편집 오버레이를 보관하지 않으며 실제 자재 객체 매핑은 아닙니다.</p>
        {sourceReference && sourceCandidate && sourceReference.revision !== sourceCandidate.revision && <p role="status" className="text-xs text-amber-800">현재 R{sourceCandidate.revision}과 지정 근거가 다릅니다. 기존 지정을 자동 변경하지 않았습니다.</p>}
        {sourceCandidate && isMaterialSourceReference(sourceCandidate) ? <Button type="button" variant="outline" disabled={viewer || !restored || blocked} onClick={() => setSourceReference({...sourceCandidate})}>현재 페이지·개정을 자재 근거로 지정</Button> : <p className="text-xs text-muted-foreground">도면 작업실에서 페이지·개정을 확인한 뒤 지정할 수 있습니다.</p>}
        {sourceCandidate && <p className="text-xs text-muted-foreground">현재 화면: R{sourceCandidate.revision} · {sourceCandidate.page}쪽</p>}
        {sourceReference && <details onToggle={event => setSourceOpen(event.currentTarget.open)}>
          <summary className="cursor-pointer py-2 font-medium">지정 근거 열기</summary>
          {sourceOpen && <div className="grid min-w-0 gap-3" key={JSON.stringify(sourceReference)}>
            <p className="text-xs">지정 R{sourceReference.revision} · {sourceReference.page}쪽의 배경 원본 확인 · 읽기 전용. 당시 편집 객체의 복원은 미지원입니다.</p>
            {!sourceReference.source ? <p role="status">이전 지정 기록에 원본 식별 정보가 없습니다. 작업실에서 원본을 확인하고 다시 지정하세요. 현재 도면으로 대신 열지 않습니다.</p> : sourceReference.source.kind === "pdf" ? sourceReference.source.fingerprint ? <ProjectResourceReader fixedLabel="지정" fixed={{fingerprint:sourceReference.source.fingerprint,page:sourceReference.page}}/> : <p role="status">지정 당시 PDF 식별 정보가 없어 원본을 열 수 없습니다. 작업실에서 PDF를 확인하고 다시 지정하세요.</p> : sourceReference.source.kind === "blank" ? <p className="rounded border p-5">빈 도면 · {sourceReference.source.paper} · 지정 당시 작성 객체는 보관되지 않았습니다.</p> : <><img className="w-full rounded border" src={`/images/workspace-start/${sourceReference.source.kind}-plan.png`} alt={`${documentName} · 지정 원본 템플릿 예시`}/><p className="text-xs text-muted-foreground">{sourceReference.source.paper} · 템플릿 배경 예시이며 실제 CAD 편집 결과가 아닙니다.</p></>}
          </div>}
        </details>}
      </section>}
      {!restored&&<p role="status">자재 초안을 불러오고 있습니다.</p>}
      {error&&<p role="alert">{error}</p>}
      {error&&!blocked&&<Button type="button" variant="outline" onClick={()=>setRetry(value=>value+1)}>자재 초안 보관 다시 시도</Button>}
      <nav
        aria-label="자재 업무 단계"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {(
          [
            ["material", "자재"],
            ["order", "발주 초안"],
            ["receipt", "입고 확인"],
            ["evidence", "근거·탄소"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            type="button"
            disabled={!restored||blocked}
            variant={id === current ? "default" : "outline"}
            onClick={() => setCurrent(id)}
            aria-pressed={id === current}
          >
            {label}
          </Button>
        ))}
      </nav>
      <div className="rounded-xl border p-4 text-sm">
        <p className="break-words font-semibold">
          {documentName} · {page}쪽
        </p>
        <p className="mt-2 text-xs text-violet-800">
          A01 → Q01 → B01 → M01 · 연결 예시
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          발주수량 미확정 · 금액 미확정 · 실제 자재 매핑 없음
        </p>
      </div>
      <h3 className="text-lg font-semibold">
        {
          {
            material: "M01 자재 상세",
            order: "발주 초안",
            receipt: "입고 확인 양식",
            evidence: "자재 근거·탄소",
          }[current]
        }
      </h3>
      {current === "evidence" ? (
        <div className="grid gap-3 rounded-xl border p-4 text-sm">
          <p>원본 근거: {page}쪽 A01 · 예시</p>
          <p>제품 사양서: 미등록</p>
          <p>EPD / 환경성적표지: 미등록</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setLinkedEvidence((value) => !value)}
            disabled={!restored||blocked}
          >
            {linkedEvidence
              ? "근거 미등록 상태로 돌아가기"
              : "근거 연결 예시 보기"}
          </Button>
          {linkedEvidence && (
            <div className="rounded-lg bg-violet-50 p-3 text-xs text-violet-800">
              <strong>근거 메타데이터 연결 · 가상 예시</strong>
              <p>M01 ↔ E01 제품 자료</p>
              <p>문서명: 제품 환경자료 샘플 · 실제 문서 없음</p>
              <p>발행기관·유효기간·검증 상태: 미확인</p>
              <p>
                연결 방식을 설명할 뿐, 실제 EPD 인증이나 탄소 계산의 근거로
                사용할 수 없습니다.
              </p>
            </div>
          )}
          <p>운송 거리·배출계수: 미설정</p>
          <strong>탄소량 미산정</strong>
          <p className="text-xs text-muted-foreground">
            자료 부재는 배출량 0을 뜻하지 않습니다. 실제 제품과 계산 기준을
            연결해야 합니다.
          </p>
        </div>
      ) : (
        <fieldset
          disabled={viewer||!restored||blocked}
          className="grid gap-3 rounded-xl border p-4"
        >
          {current === "material" ? (
            <>
              <label className="grid gap-2 text-sm">
                자재 이름
                <input
                  className="min-h-10 rounded-lg border bg-background px-3"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                규격·제품 코드 미등록 · 수량표의 예시값을 발주수량으로 사용하지
                않습니다.
              </p>
            </>
          ) : current === "order" ? (
            <>
              <p className="text-sm">{name.trim() || "이름 없는 자재"}</p>
              <label className="grid gap-2 text-sm">
                공급사 초안
                <input
                  className="min-h-10 rounded-lg border bg-background px-3"
                  maxLength={80}
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  placeholder="거래처 연결 없이 화면에만 입력"
                />
              </label>
              <label className="grid gap-2 text-sm">
                요청 메모
                <textarea
                  className="min-h-20 rounded-lg border bg-background p-3"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  maxLength={500}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                발주번호·발주일 미발급 · 전송 없음
              </p>
            </>
          ) : (
            <>
              <p className="text-sm">
                {name.trim() || "이름 없는 자재"} ·{" "}
                {supplier.trim() || "공급사 미지정"}
              </p>
              <label className="grid gap-2 text-sm">
                검수 상태 예시
                <select
                  className="min-h-10 rounded-lg border bg-background px-3"
                  value={receipt}
                  onChange={(e) => setReceipt(e.target.value)}
                >
                  <option>미확인</option>
                  <option>수량 차이 확인 필요</option>
                  <option>파손 확인 필요</option>
                  <option>검수 표시 예시</option>
                </select>
              </label>
              <p role="status" className="text-sm">
                {receipt} · 실제 입고 기록 없음
              </p>
              <p className="text-xs text-muted-foreground">
                입고수량·증빙사진 미등록
              </p>
            </>
          )}
        </fieldset>
      )}
      {viewer && (
        <p className="text-xs text-muted-foreground">
          Viewer · 양식 변경 없이 단계만 확인합니다.
        </p>
      )}
      <Button variant="outline" type="button" onClick={onReturn}>
        도면의 A01 위치로 돌아가기
      </Button>
    </section>
  );
}
