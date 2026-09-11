import { useState } from "react";
import {ReviewHistory, reviewLoopLabels, type ReviewLoopState} from "./drawing-review-loop";

export function ConnectedRevisionPreview({state,onReview}: {state:ReviewLoopState;onReview?:()=>void}) {
  return <section className="grid gap-3" aria-label="현재 도면 개정">
    <h3 className="font-semibold">R{state.revision} · {state.page}쪽 · {reviewLoopLabels[state.phase]}</h3>
    <p className="text-sm text-muted-foreground">검토 패널과 같은 도면의 화면 기록입니다. 실제 원본 개정이나 서버 승인 기록은 아닙니다.</p>
    <ReviewHistory history={state.history}/>
    {!state.history.length && <p className="text-sm">이 도면에 보관된 이전 개정이 없습니다.</p>}
    {onReview && <Button variant="outline" onClick={onReview}>현재 도면에서 검토 계속하기</Button>}
  </section>;
}
import { Box, FileClock, FileWarning, Link2 } from "lucide-react";
import { Button } from "~/core/components/ui/button";

const field =
  "min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm";
type DwgState =
  | "uninspected"
  | "dependencies"
  | "readonly"
  | "failed"
  | "ready";
const dwgStates: Record<
  DwgState,
  { label: string; description: string; next: string }
> = {
  uninspected: {
    label: "미검사",
    description: "파일 버전·객체·글꼴·외부참조를 확인하기 전입니다.",
    next: "실제 파일 검사 연동 전에는 편집·납품 가능 여부를 판단할 수 없습니다.",
  },
  dependencies: {
    label: "의존 파일 보완 필요 · 상태 예시",
    description: "글꼴과 외부참조가 누락된 경우의 안내입니다.",
    next: "권한이 있는 의존 파일을 준비한 뒤 다시 검사하는 흐름입니다. 여기서는 파일을 요청하거나 읽지 않습니다.",
  },
  readonly: {
    label: "보기 전용 · 상태 예시",
    description: "일부 객체의 왕복 보존을 확인할 수 없는 경우입니다.",
    next: "편집·재저장은 제한하고 원본 보기와 진단 보고서를 제공할 화면입니다.",
  },
  failed: {
    label: "검사 실패 · 납품 차단 · 상태 예시",
    description: "재열기 검증에 실패한 파일의 안내입니다.",
    next: "원본은 유지합니다. 원인을 확인하고 재검사하기 전까지 납품을 진행하지 않습니다.",
  },
  ready: {
    label: "납품 준비 가능 · 상태 예시",
    description:
      "검증된 범위가 있는 경우의 화면 구성입니다. 실제 파일 판정이 아닙니다.",
    next: "지원 객체·글꼴·개정·출력 조건을 확인하고 최종 출력 검증을 거쳐야 합니다.",
  },
};

export function IfcViewportPreview({
  onInspect,
  onReturn,
}: {
  onInspect: () => void;
  onReturn: () => void;
}) {
  return (
    <section className="pdf-ifc-viewport" aria-label="IFC 모델 화면">
      <div className="pdf-ifc-heading">
        <Box size={16} />
        <span>IFC 3D · 화면 구성</span>
        <span>미연결</span>
      </div>
      <div className="pdf-ifc-empty">
        <Box size={32} aria-hidden="true" />
        <h2>연결된 IFC 모델이 없습니다.</h2>
        <p>
          모델을 가져온 뒤 요소와 2D 근거를 함께 볼 자리입니다. 현재 3D 형상을
          표시하거나 분석하지 않습니다.
        </p>
        <div>
          <button className="pdf-primary-button" onClick={onInspect}>
            IFC 연결 정보 보기
          </button>
          <button className="pdf-subtle-button" onClick={onReturn}>
            2D 도면으로 돌아가기
          </button>
        </div>
      </div>
    </section>
  );
}

function IfcConnectionPreview({
  ready,
  viewer,
}: {
  ready: boolean;
  viewer: boolean;
}) {
  const [example, setExample] = useState(false);
  const [selected, setSelected] = useState("벽체 예시");
  const [linked, setLinked] = useState(false);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4">
        <h3 className="font-semibold">IFC 연결 정보</h3>
        <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-2 text-sm">
          <dt className="text-muted-foreground">원본 모델</dt>
          <dd>미등록</dd>
          <dt className="text-muted-foreground">GlobalId</dt>
          <dd>미연결</dd>
          <dt className="text-muted-foreground">2D 근거</dt>
          <dd>{ready ? "현재 도면 · 요소 연결 전" : "도면 미선택"}</dd>
        </dl>
      </div>
      <p className="text-xs text-muted-foreground">
        IFC 파일을 읽거나 실제 요소를 찾지 않습니다. 도면과 모델 간 연결 양식을
        살펴볼 수 있습니다.
      </p>
      {!example ? (
        <Button variant="outline" onClick={() => setExample(true)}>
          요소 연결 예시 보기
        </Button>
      ) : (
        <div className="space-y-3 rounded-xl border border-violet-200 p-4">
          <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">
            가상 요소 · 실제 IFC에서 추출하지 않음
          </p>
          <label className="grid gap-1 text-sm">
            연결 대상 예시
            <select
              className={field}
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setLinked(false);
              }}
            >
              <option>벽체 예시</option>
              <option>문 예시</option>
              <option>공간 예시</option>
            </select>
          </label>
          <dl className="grid grid-cols-[6rem_1fr] gap-2 text-sm">
            <dt>선택 대상</dt>
            <dd>{selected}</dd>
            <dt>GlobalId</dt>
            <dd>미지정 · 예시 객체</dd>
            <dt>관계</dt>
            <dd>2D 영역 ↔ IFC 요소</dd>
          </dl>
          <Button disabled={viewer || !ready} onClick={() => setLinked(true)}>
            연결 결과 예시 보기
          </Button>
          {linked && (
            <p role="status" className="text-sm">
              {selected} ↔ 2D 영역 · 연결 표시 예시입니다. 실제 연결은 생성되지
              않았습니다.
            </p>
          )}
          {(viewer || !ready) && (
            <p className="text-xs text-muted-foreground">
              {viewer
                ? "보기 전용에서는 연결 상태만 살펴봅니다."
                : "도면을 먼저 열어 주세요."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function DwgReadinessPreview({
  state,
  onStateChange,
}: {
  state: DwgState;
  onStateChange: (state: DwgState) => void;
}) {
  const current = dwgStates[state];
  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        실제 DWG를 검사하지 않았습니다. 아래 상태 선택은 안내 화면 체험용이며
        파일의 편집·납품 가능 여부와 무관합니다.
      </p>
      <label className="grid gap-1 text-sm">
        DWG 점검 상태 예시
        <select
          className={field}
          value={state}
          onChange={(e) => onStateChange(e.target.value as DwgState)}
        >
          {Object.entries(dwgStates).map(([value, item]) => (
            <option key={value} value={value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <section
        className="rounded-xl border p-4"
        aria-label="DWG 점검 결과 예시"
      >
        <h3 className="flex items-center gap-2 font-semibold">
          <FileWarning className="size-4" />
          {current.label}
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {current.description}
        </p>
        <p className="mt-3 text-sm">{current.next}</p>
      </section>
      {state === "dependencies" && (
        <section className="rounded-xl border p-4">
          <h3 className="text-sm font-semibold">보완 목록 · 예시</h3>
          <ul className="mt-3 space-y-3 text-sm">
            <li>
              <strong>SHX 글꼴</strong>
              <p className="text-muted-foreground">
                문자 폭과 한글 표현 검증 전 · 권한 있는 원본 필요
              </p>
            </li>
            <li>
              <strong>외부참조 도면</strong>
              <p className="text-muted-foreground">
                도면 기준점 검증 전 · 외부 경로 자동 접근 없음
              </p>
            </li>
          </ul>
        </section>
      )}
      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          호환성 보고서 구성 보기
        </summary>
        <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-2 text-sm">
          <dt>입력/출력 버전</dt>
          <dd>미검증</dd>
          <dt>객체 보존</dt>
          <dd>미검증</dd>
          <dt>글꼴·외부참조</dt>
          <dd>미검증</dd>
          <dt>엔진/설정</dt>
          <dd>미연결</dd>
          <dt>출력 SHA-256</dt>
          <dd>출력 없음</dd>
          <dt>납품처 재열기</dt>
          <dd>미검증</dd>
        </dl>
      </details>
      {state !== "uninspected" && (
        <Button variant="outline" onClick={() => onStateChange("uninspected")}>
          미검사 화면으로 돌아가기
        </Button>
      )}
    </div>
  );
}

export function RevisionRestorePreview({
  viewer,
  revision,
  onCancel,
  onConfirm,
}: {
  viewer: boolean;
  revision: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section
      className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4 dark:bg-amber-950/20"
      aria-label="개정 복원 확인"
    >
      <h3 className="font-semibold">{revision}에서 새 개정 시작 · 예시</h3>
      <p className="text-sm">
        현재 도면과 승인된 버전은 덮어쓰지 않습니다. 선택한 예시 개정을 바탕으로
        새 개정을 만드는 확인 화면입니다.
      </p>
      <p className="text-xs text-muted-foreground">
        실제 개정·원본·댓글은 변경되지 않습니다.
        {viewer ? " 보기 전용에서는 복원을 요청할 수 없습니다." : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={viewer} onClick={onConfirm}>
          복원 결과 예시 보기
        </Button>
        <Button variant="outline" onClick={onCancel}>
          취소
        </Button>
      </div>
    </section>
  );
}

const changes = [
  {
    name: "출입문 폭",
    before: "900 mm",
    after: "1,000 mm",
    reason: "동선 검토에 따른 변경 사유 예시",
  },
  {
    name: "회의실 표기",
    before: "회의실 A",
    after: "협업 회의실",
    reason: "공간 명칭 조정 사유 예시",
  },
  {
    name: "벽 마감",
    before: "사양 미정",
    after: "마감 검토안",
    reason: "마감안 비교를 위한 분류 예시",
  },
];

export function RevisionComparisonPreview({
  ready,
  viewer,
}: {
  ready: boolean;
  viewer: boolean;
}) {
  const [example, setExample] = useState(false);
  const [selected, setSelected] = useState("R01");
  const [change, setChange] = useState(changes[0]);
  const [restore, setRestore] = useState(false);
  const [restored, setRestored] = useState(false);
  if (!ready)
    return (
      <div className="rounded-xl border border-dashed p-5 text-center">
        <h3 className="font-semibold">도면을 먼저 열어 주세요.</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          현재 도면의 개정과 비교 대상을 확인할 자리입니다.
        </p>
      </div>
    );
  if (!example)
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-dashed p-5">
          <h3 className="font-semibold">등록된 개정이 없습니다.</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            현재 로컬 도면은 서버에 저장된 개정과 연결되어 있지 않습니다.
          </p>
        </div>
        <Button variant="outline" onClick={() => setExample(true)}>
          개정 목록 예시 보기
        </Button>
      </div>
    );
  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-violet-50 p-3 text-xs text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">
        공통 예시 문서의 변경 목록입니다. 현재 도면의 전후 비교나 실제 저장
        기록이 아닙니다.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {["R01", "R02"].map((rev) => (
          <button
            className={`rounded-xl border p-3 text-left ${selected === rev ? "border-violet-400 bg-violet-50/50 dark:bg-violet-950/30" : ""}`}
            key={rev}
            aria-pressed={selected === rev}
            onClick={() => {
              setSelected(rev);
              setRestore(false);
              setRestored(false);
            }}
          >
            <strong className="block text-sm">
              {rev} · {rev === "R01" ? "이전안" : "검토안"} 예시
            </strong>
            <span className="text-xs text-muted-foreground">
              실제 개정 아님 · 변경자 미연결
            </span>
          </button>
        ))}
      </div>
      <h3 className="text-sm font-semibold">R01 → R02 변경 비교 · 예시</h3>
      <div className="flex flex-wrap gap-2" aria-label="변경 항목">
        {changes.map((item) => (
          <Button
            key={item.name}
            size="sm"
            variant={change.name === item.name ? "default" : "outline"}
            aria-pressed={change.name === item.name}
            onClick={() => setChange(item)}
          >
            {item.name}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-xl border border-rose-200 bg-rose-50/40 p-4 dark:bg-rose-950/20">
          <h4 className="text-xs text-muted-foreground">R01 · 이전 값</h4>
          <p className="mt-2 font-semibold">{change.before}</p>
        </section>
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 dark:bg-emerald-950/20">
          <h4 className="text-xs text-muted-foreground">R02 · 변경 값</h4>
          <p className="mt-2 font-semibold">{change.after}</p>
        </section>
      </div>
      <p className="text-sm text-muted-foreground">{change.reason}</p>
      {!restore && (
        <Button
          variant="outline"
          disabled={viewer}
          onClick={() => {
            setRestore(true);
            setRestored(false);
          }}
        >
          {selected}에서 새 개정 시작 · 화면 예시
        </Button>
      )}
      {viewer && (
        <p className="text-xs text-muted-foreground">
          보기 전용 · 개정 비교만 확인할 수 있습니다.
        </p>
      )}
      {restore && (
        <RevisionRestorePreview
          viewer={viewer}
          revision={selected}
          onCancel={() => setRestore(false)}
          onConfirm={() => {
            setRestore(false);
            setRestored(true);
          }}
        />
      )}
      {restored && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          새 개정 R03 준비 화면 예시 · {selected} 기준. 실제 복원·저장된 개정은
          없습니다.
        </p>
      )}
      <div>
        <Button
          variant="ghost"
          onClick={() => {
            setExample(false);
            setRestore(false);
            setRestored(false);
          }}
        >
          현재 도면의 개정 상태로 돌아가기
        </Button>
      </div>
    </div>
  );
}

export function SourcePreviewBody({
  ready,
  viewer,
  reviewLoop,
  onReview,
}: {
  ready: boolean;
  viewer: boolean;
  reviewLoop?: ReviewLoopState;
  onReview?: () => void;
}) {
  const [tab, setTab] = useState<"ifc" | "revisions" | "dwg">("ifc");
  const [visited, setVisited] = useState<Array<typeof tab>>(["ifc"]);
  const [dwgState, setDwgState] = useState<DwgState>("uninspected");
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2" aria-label="원본·개정 종류">
        {[
          { key: "ifc", title: "IFC 연결", icon: Link2 },
          { key: "revisions", title: "개정·비교", icon: FileClock },
          { key: "dwg", title: "DWG 점검", icon: FileWarning },
        ].map((item) => (
          <Button
            key={item.key}
            size="sm"
            variant={tab === item.key ? "default" : "outline"}
            aria-pressed={tab === item.key}
            onClick={() => {
              const next = item.key as typeof tab;
              setTab(next);
              setVisited(current => current.includes(next) ? current : [...current, next]);
            }}
          >
            <item.icon className="size-4" />
            {item.title}
          </Button>
        ))}
      </nav>
      {visited.map(key => <div key={key} hidden={tab !== key}>
        {key === "ifc" ? <IfcConnectionPreview ready={ready} viewer={viewer} /> : key === "revisions" ? reviewLoop && ready ? <ConnectedRevisionPreview state={reviewLoop} onReview={onReview}/> : <RevisionComparisonPreview ready={ready} viewer={viewer} /> : <DwgReadinessPreview state={dwgState} onStateChange={setDwgState} />}
      </div>)}
    </div>
  );
}
