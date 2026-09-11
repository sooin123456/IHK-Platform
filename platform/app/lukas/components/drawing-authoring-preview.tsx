import { useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "~/core/components/ui/button";
import type {ScreenShapeKind} from "./drawing-screen-object-preview";

const fieldClass =
  "min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm disabled:opacity-60";
const tools = [
  {
    id: "line",
    label: "선",
    keywords: "line l",
    fields: ["시작 X", "시작 Y", "끝 X", "끝 Y"],
  },
  {
    id: "polyline",
    label: "폴리라인",
    keywords: "polyline pl 경로",
    fields: ["꼭짓점 입력 방식"],
  },
  {
    id: "rectangle",
    label: "사각형",
    keywords: "rectangle rect",
    fields: ["가로 길이", "세로 길이"],
  },
  { id: "circle", label: "원", keywords: "circle c", fields: ["반지름"] },
  {
    id: "arc",
    label: "호",
    keywords: "arc a",
    fields: ["반지름", "시작 각도", "끝 각도"],
  },
  {
    id: "text",
    label: "텍스트",
    keywords: "text t 문자",
    fields: ["문자 내용"],
  },
  {
    id: "dimension",
    label: "치수·축척",
    keywords: "dimension dim scale 측정 거리",
    fields: ["기준 길이"],
  },
  {
    id: "wall",
    label: "벽",
    keywords: "wall 벽체",
    fields: ["벽 두께", "벽 높이"],
  },
  {
    id: "opening",
    label: "개구부",
    keywords: "opening 문 창",
    fields: ["개구부 폭", "개구부 높이"],
  },
  {
    id: "space",
    label: "공간",
    keywords: "space room 영역",
    fields: ["공간 이름"],
  },
] as const;
type ToolId = (typeof tools)[number]["id"];

const canvasTools: {kind:ScreenShapeKind;keywords:string;description:string}[] = [
 {kind:"선",keywords:"line l",description:"선으로 위치와 범위를 표시합니다."},
 {kind:"폴리라인",keywords:"polyline pl 경로",description:"점을 차례로 지정하고 완료 또는 Enter로 경로를 만듭니다."},
 {kind:"사각형",keywords:"rectangle rect",description:"검토할 영역을 표시합니다."},
 {kind:"원",keywords:"circle c",description:"확인이 필요한 지점을 둘러쌉니다."},
 {kind:"텍스트",keywords:"text t 문자",description:"도면 위에 메모를 놓습니다."},
 {kind:"치수",keywords:"dimension dim scale 측정 거리",description:"치수 표시 예시입니다. 실제 길이는 산출하지 않습니다."},
];

export function DrawingAuthoringLauncher({ready,disabled,onChoose}:{ready:boolean;disabled:boolean;onChoose:(kind:ScreenShapeKind)=>void}){
 const [query,setQuery]=useState("");
 const [examples,setExamples]=useState(false);
 const search=useRef<HTMLInputElement>(null);
 const found=canvasTools.filter(tool=>`${tool.kind} ${tool.keywords}`.toLowerCase().includes(query.trim().toLowerCase()));
 const choose=(kind:ScreenShapeKind)=>{if(ready&&!disabled)onChoose(kind);};
 if(examples)return <div className="space-y-4"><Button variant="outline" onClick={()=>setExamples(false)}>도면 배치 도구로 돌아가기</Button><p className="text-sm">아래 옵션은 독립 예시이며 도면에 반영되지 않습니다.</p><AuthoringPreviewBody ready={ready} viewer={disabled}/></div>;
 return <section aria-label="도면 작성 도구" className="space-y-4" onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();event.stopPropagation();search.current?.focus();}}}>
  <div><h3 className="font-semibold">도면 위에 무엇을 표시할까요?</h3><p className="mt-1 text-sm text-muted-foreground">도구 선택 → 도면에서 위치 클릭 → 검사기에서 수정</p></div>
  <input ref={search} aria-label="도구·명령 검색" className={fieldClass} placeholder="선, 사각형, text…" value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&!event.nativeEvent.isComposing&&found[0]){event.preventDefault();choose(found[0].kind);}}}/>
  {!ready&&<p role="status">빈 도면이나 원본 도면을 먼저 열어 주세요.</p>}
  {disabled&&<p role="status">읽기 전용 상태입니다. 작성 가능한 도면에서 배치할 수 있습니다.</p>}
  <div className="grid gap-3 sm:grid-cols-2">{found.map(tool=><button key={tool.kind} disabled={!ready||disabled} onClick={()=>choose(tool.kind)} aria-label={`${tool.kind} · 도면에 배치`} className="rounded-xl border p-4 text-left hover:border-violet-400 hover:bg-violet-50/50 disabled:opacity-50"><strong>{tool.kind}</strong><span className="mt-1 block text-xs text-muted-foreground">{tool.description}</span><span className="mt-3 block text-xs text-violet-700">도면에 배치 →</span></button>)}</div>
  {!found.length&&<div role="status" className="rounded-lg border border-dashed p-4"><p>배치 가능한 도구가 없습니다.</p><Button variant="outline" className="mt-2" onClick={()=>{setQuery("");search.current?.focus();}}>검색 초기화</Button></div>}
  <p className="text-xs text-muted-foreground">Ctrl/⌘ K 검색 · Enter 첫 결과 배치 · Esc 배치 취소. 화면 도형이며 원본 PDF·CAD는 변경하지 않습니다.</p>
  <Button variant="outline" onClick={()=>setExamples(true)}>고급 도구·변형 옵션 예시 보기</Button>
 </section>;
}

export function AuthoringToolOptions({
  toolId,
  viewer,
  ready,
}: {
  toolId: ToolId;
  viewer: boolean;
  ready: boolean;
}) {
  const tool = tools.find((item) => item.id === toolId) ?? tools[0];
  if (!ready)
    return (
      <div className="rounded-xl border border-dashed p-5">
        <h3 className="font-semibold">도면을 먼저 열어 주세요.</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          빈 도면이나 템플릿으로도 작성 화면을 살펴볼 수 있습니다.
        </p>
      </div>
    );
  return (
    <section
      className="space-y-3 rounded-xl border p-4"
      aria-label={`${tool.label} 도구 옵션`}
    >
      <h3 className="font-semibold">{tool.label} 도구 · 옵션 예시</h3>
      <fieldset
        disabled={viewer}
        className="grid gap-3 sm:grid-cols-2"
        key={tool.id}
      >
        {tool.fields.map((label) => (
          <label key={label} className="grid gap-1 text-sm">
            {label}
            <input
              className={fieldClass}
              maxLength={80}
              placeholder="지정 전 · 화면 예시"
            />
          </label>
        ))}
        {tool.id === "polyline" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" />
            경로 닫기
          </label>
        )}
        {tool.id === "wall" && (
          <label className="grid gap-1 text-sm">
            기준선
            <select className={fieldClass}>
              <option>중심선</option>
              <option>안쪽 면</option>
              <option>바깥쪽 면</option>
            </select>
          </label>
        )}
        {tool.id === "opening" && (
          <label className="grid gap-1 text-sm">
            종류
            <select className={fieldClass}>
              <option>문</option>
              <option>창</option>
              <option>기타 개구부</option>
            </select>
          </label>
        )}
        {tool.id === "dimension" && (
          <>
            <label className="grid gap-1 text-sm">
              도면 단위
              <select className={fieldClass}>
                <option>미지정</option>
                <option>mm · 예시</option>
                <option>m · 예시</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              축척
              <select className={fieldClass}>
                <option>미확정</option>
                <option>1:50 · 예시</option>
                <option>1:100 · 예시</option>
                <option>1:200 · 예시</option>
              </select>
            </label>
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" defaultChecked />
          끝점 스냅 · 옵션 예시
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" />
          직교 제한 · 옵션 예시
        </label>
      </fieldset>
      {tool.id === "dimension" && (
        <p className="rounded-lg bg-muted/40 p-3 text-sm">
          기준선 미선택 · 축척/길이/면적 미확정
        </p>
      )}
      {tool.id === "space" && (
        <p className="rounded-lg bg-muted/40 p-3 text-sm">
          영역 경계 미선택 · 면적 미산출
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        입력은 실제 도형·측정에 반영되지 않습니다.
        {viewer ? " 보기 전용에서는 옵션을 변경할 수 없습니다." : ""}
      </p>
    </section>
  );
}

type History = { past: string[]; present: string; future: string[] };
type HistoryAction =
  | { type: "record"; label: string }
  | { type: "undo" | "redo" };
export function advanceAuthoringHistory(
  state: History,
  action: HistoryAction,
): History {
  if (action.type === "record")
    return {
      past: [...state.past, state.present].slice(-20),
      present: action.label,
      future: [],
    };
  if (action.type === "undo" && state.past.length)
    return {
      past: state.past.slice(0, -1),
      present: state.past[state.past.length - 1],
      future: [state.present, ...state.future],
    };
  if (action.type === "redo" && state.future.length)
    return {
      past: [...state.past, state.present],
      present: state.future[0],
      future: state.future.slice(1),
    };
  return state;
}

export function AuthoringSelectionPreview({
  ready,
  viewer,
}: {
  ready: boolean;
  viewer: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [rotation, setRotation] = useState("90°");
  const [alignment, setAlignment] = useState("왼쪽");
  const [history, setHistory] = useState<History>({
    past: [],
    present: "아직 변형 예시를 선택하지 않았습니다.",
    future: [],
  });
  const record = (label: string) =>
    setHistory((value) =>
      advanceAuthoringHistory(value, { type: "record", label }),
    );
  if (!ready)
    return (
      <p className="rounded-xl border border-dashed p-5 text-sm">
        도면을 먼저 열어 주세요. 실제 선택 객체는 없습니다.
      </p>
    );
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        아래 항목은 옵션 체험용이며 도면에서 선택한 객체가 아닙니다. 기록은 이
        패널 안의 안내 표시만 되돌립니다.
      </p>
      <fieldset disabled={viewer} className="grid gap-2 sm:grid-cols-2">
        {["예시 선 A", "예시 영역 B"].map((name) => (
          <label
            className="flex items-center gap-2 rounded-xl border p-4 text-sm"
            key={name}
          >
            <input
              type="checkbox"
              checked={selected.includes(name)}
              onChange={(event) =>
                setSelected((values) =>
                  event.target.checked
                    ? [...values, name]
                    : values.filter((value) => value !== name),
                )
              }
            />
            {name}
          </label>
        ))}
      </fieldset>
      <h3 className="text-sm font-semibold">선택 {selected.length}개 · 예시</h3>
      <fieldset
        disabled={viewer || selected.length === 0}
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            회전 각도
            <select
              className={fieldClass}
              value={rotation}
              onChange={(e) => setRotation(e.target.value)}
            >
              <option>90°</option>
              <option>180°</option>
              <option>270°</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            정렬 기준
            <select
              className={fieldClass}
              value={alignment}
              onChange={(e) => setAlignment(e.target.value)}
            >
              <option>왼쪽</option>
              <option>가운데</option>
              <option>오른쪽</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            "이동",
            "복사",
            "오프셋",
            "회전",
            "정렬",
            "그룹",
            "블록",
            "삭제",
          ].map((action) => (
            <Button
              key={action}
              variant="outline"
              size="sm"
              onClick={() =>
                record(
                  `${action}${action === "회전" ? ` ${rotation}` : action === "정렬" ? ` ${alignment}` : ""} · ${selected.join(", ")} · 옵션 표시 예시`,
                )
              }
            >
              {action} · 예시
            </Button>
          ))}
        </div>
      </fieldset>
      <section
        className="rounded-xl border bg-muted/30 p-4"
        aria-label="변형 기록 예시"
      >
        <p role="status" className="break-words text-sm">
          {history.present}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={viewer || history.past.length === 0}
            onClick={() =>
              setHistory((value) =>
                advanceAuthoringHistory(value, { type: "undo" }),
              )
            }
          >
            실행 취소 · 예시
          </Button>
          <Button
            variant="outline"
            disabled={viewer || history.future.length === 0}
            onClick={() =>
              setHistory((value) =>
                advanceAuthoringHistory(value, { type: "redo" }),
              )
            }
          >
            다시 실행 · 예시
          </Button>
        </div>
      </section>
      <p className="text-xs text-muted-foreground">
        실제 도형의 이동·복제·삭제·그룹화는 실행되지 않습니다.
        {viewer ? " 보기 전용입니다." : ""}
      </p>
    </div>
  );
}

export function AuthoringPreviewBody({
  ready,
  viewer,
}: {
  ready: boolean;
  viewer: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ToolId | "selection">("line");
  const [visited, setVisited] = useState<Array<ToolId | "selection">>(["line"]);
  const selectTool = (id: ToolId | "selection") => {
    setSelected(id);
    setVisited((current) => current.includes(id) ? current : [...current, id]);
    setQuery("");
  };
  const searchRef = useRef<HTMLInputElement>(null);
  const commands = [
    ...tools.map((tool) => ({ ...tool, label: `${tool.label} 도구` })),
    {
      id: "selection" as const,
      label: "선택·변형·실행 취소",
      keywords:
        "move copy offset rotate align group block delete undo redo 이동 복사 회전 정렬 그룹 삭제",
      fields: [],
    },
  ];
  const found = commands.filter((item) =>
    `${item.label} ${item.keywords}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <div
      className="space-y-4"
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "k"
        ) {
          event.preventDefault();
          event.stopPropagation();
          searchRef.current?.focus();
        }
      }}
    >
      <label className="relative block">
        <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
        <input
          ref={searchRef}
          aria-label="도구·명령 검색"
          className={`${fieldClass} pl-9`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="도구 이름, 복사, undo…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && found[0]) {
              e.preventDefault();
              selectTool(found[0].id);
            }
          }}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Ctrl/⌘ K 검색 · Enter 첫 결과 열기 · 도형 작성 명령은 실행하지 않습니다.
      </p>
      <div className="flex flex-wrap gap-2" aria-label="작성 도구 목록">
        {found.map((item) => (
          <Button
            key={item.id}
            size="sm"
            variant={selected === item.id ? "default" : "outline"}
            aria-pressed={selected === item.id}
            onClick={() => {
              selectTool(item.id);
            }}
          >
            {item.label}
          </Button>
        ))}
      </div>
      {!found.length && (
        <div className="rounded-xl border border-dashed p-4">
          <p role="status" className="text-sm">
            검색 결과가 없습니다.
          </p>
          <Button
            className="mt-2"
            variant="outline"
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
          >
            검색 초기화
          </Button>
        </div>
      )}
      {visited.map((id) => (
        <div key={id} hidden={selected !== id}>
          {id === "selection" ? (
            <AuthoringSelectionPreview ready={ready} viewer={viewer} />
          ) : (
            <AuthoringToolOptions toolId={id} ready={ready} viewer={viewer} />
          )}
        </div>
      ))}
    </div>
  );
}
