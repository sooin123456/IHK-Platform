import { useEffect, useId, useRef, useState } from "react";
import {
  BookOpen,
  Layers,
  ListFilter,
  Palette,
  Search,
  TableProperties,
  Files,
  Command,
  PanelsTopLeft,
} from "lucide-react";
import { Button } from "~/core/components/ui/button";
import { SourcePreviewBody } from "./drawing-source-preview";
import type {ReviewLoopState} from "./drawing-review-loop";
import { AuthoringPreviewBody, DrawingAuthoringLauncher } from "./drawing-authoring-preview";
import { DrawingStatePreview } from "./drawing-state-preview";
import type {ScreenShape,ScreenObjectProperties,ScreenShapeKind} from "./drawing-screen-object-preview";
import {DrawingObjectPropertiesPreview} from "./drawing-object-properties-preview";
type AppliedStyle=Pick<ScreenShape,"color"|"lineWidth"|"fill">;
import {
  DrawingDocumentPreview,
  type PreviewLayer,
} from "./drawing-document-preview";

type Section =
  | "blocks"
  | "styles"
  | "properties"
  | "schedules"
  | "sources"
  | "authoring"
  | "documents"
  | "states";
type Context = {
  reviewLoop?: ReviewLoopState;
  onReview?: () => void;
  documentName: string;
  page: number;
  ready: boolean;
  viewer: boolean;
  layers?: PreviewLayer[];
  onLayersChange?: (layers: PreviewLayer[]) => void;
  selectedObjects?:ScreenShape[];
  styleReadOnly?:boolean;
  onApplyStyle?:(style:AppliedStyle)=>void;
  drawingObjects?:ScreenShape[];
  onLocateObject?:(id:string)=>void;
  onApplyProperties?:(properties:ScreenObjectProperties)=>void;
  onChooseTool?:(kind:ScreenShapeKind)=>void;
  onChooseBlock?:(code:ScreenBlockCode)=>void;
  authoringReadOnly?:boolean;
};
const sections = [
  { id: "authoring", label: "작성 도구·명령", icon: Command },
  { id: "documents", label: "페이지·레이어", icon: PanelsTopLeft },
  { id: "blocks", label: "블록·라이브러리", icon: BookOpen },
  { id: "styles", label: "스타일", icon: Palette },
  { id: "properties", label: "사용자 속성", icon: ListFilter },
  { id: "schedules", label: "표·스케줄", icon: TableProperties },
  { id: "sources", label: "원본·개정", icon: Files },
  { id: "states", label: "상태 화면 예시", icon: Files },
] as const;
const field =
  "min-h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm disabled:opacity-60";
import {screenBlocks as blocks,ScreenBlockGlyph,type ScreenBlockCode} from "./drawing-screen-blocks";

function BlockSymbol({block,decorative=false}:{block:(typeof blocks)[number];decorative?:boolean}) {
  return <svg viewBox="0 0 180 110" className="my-3 h-28 w-full rounded-lg bg-background text-violet-700 dark:text-violet-300" role={decorative?undefined:"img"} aria-hidden={decorative||undefined} aria-label={decorative?undefined:`${block.name} 평면 기호 예시`}>
    <ScreenBlockGlyph code={block.code}/>
  </svg>;
}

function Blocks({onChoose,disabled}:{onChoose?:(code:ScreenBlockCode)=>void;disabled:boolean}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("전체");
  const [selectedCode, setSelectedCode] = useState<ScreenBlockCode>(blocks[0].code);
  const found = blocks.filter(
    (b) =>
      (group === "전체" || b.group === group) &&
      `${b.name} ${b.code}`.includes(query.trim()),
  );
  const selected=found.find(block=>block.code===selectedCode)??found[0]??blocks[0];
  return (
    <div className="grid gap-4">
      <label className="relative block">
        <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
        <input
          aria-label="블록 검색"
          className={`${field} pl-9`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름 또는 블록 번호 검색"
        />
      </label>
      <div className="flex flex-wrap gap-2" aria-label="블록 분류">
        {["전체", "문·창", "가구", "벽체"].map((value) => (
          <Button
            key={value}
            size="sm"
            variant={group === value ? "default" : "outline"}
            aria-pressed={group === value}
            onClick={() => setGroup(value)}
          >
            {value}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {found.map((block) => (
          <button
            key={block.code}
            aria-pressed={block.code === selected.code}
            onClick={() => setSelectedCode(block.code)}
            className={`rounded-xl border p-4 text-left hover:bg-muted/40 ${block.code === selected.code ? "border-violet-400 bg-violet-50/50 dark:bg-violet-950/30" : ""}`}
          >
            <span className="text-xs text-muted-foreground">
              {block.group} · {block.code}
            </span>
            <strong className="mt-1 block text-sm">{block.name}</strong>
            <BlockSymbol block={block} decorative/>
            <span className="mt-1 block text-xs text-muted-foreground">
              {block.size}
            </span>
          </button>
        ))}
      </div>
      {!found.length ? (
        <div className="rounded-xl border border-dashed p-5 text-center">
          <p role="status" className="text-sm">
            검색 결과가 없습니다.
          </p>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => {
              setQuery("");
              setGroup("전체");
            }}
          >
            검색 초기화
          </Button>
        </div>
      ) : (
        <section
          className="rounded-xl border bg-muted/30 p-4"
          aria-label="선택한 블록 상세"
        >
          <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">
            블록 상세 · 정의 예시
          </span>
          <h3 className="mt-1 font-semibold">{selected.name}</h3>
          <BlockSymbol block={selected}/>
          <p className="text-xs text-muted-foreground">평면 기호 예시 · 실제 축척·CAD 블록 아님</p>
          {onChoose&&<Button className="mt-3" disabled={disabled} onClick={()=>{if(!disabled)onChoose(selected.code);}}>이 블록 도면에 배치</Button>}
          <p className="mt-2 text-sm text-muted-foreground">
            {selected.detail}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <dt>기준 크기</dt>
            <dd>{selected.size}</dd>
            <dt>배치 상태</dt>
            <dd>미배치</dd>
          </dl>
        </section>
      )}
      <p className="text-xs text-muted-foreground">
        {onChoose?"배치 버튼을 누른 뒤 도면의 위치를 클릭하세요. 화면 기호이며 실제 CAD 블록·축척 배치는 아닙니다.":"속성 정의를 살펴보는 화면입니다. 블록을 선택해도 도면에 배치되지 않습니다."}
      </p>
    </div>
  );
}

function SelectedStyles({objects,disabled,onApply}:{objects:ScreenShape[];disabled:boolean;onApply?:(style:AppliedStyle)=>void}){
 const [style,setStyle]=useState<AppliedStyle>(()=>({color:objects[0].color,lineWidth:objects[0].lineWidth,fill:objects[0].fill}));
 const [applied,setApplied]=useState(false);
 const update=(patch:Partial<AppliedStyle>)=>{setStyle(current=>({...current,...patch}));setApplied(false);};
 return <section aria-label="선택 도형 스타일" className="grid gap-4">
  <div className="rounded-lg border p-3"><strong>선택 도형 {objects.length}개</strong><p className="mt-1 break-words text-sm">{objects.map(object=>object.name||object.kind).join(" · ")}</p><p className="mt-2 text-xs text-muted-foreground">첫 도형의 설정으로 시작합니다. 적용하면 아래 세 속성이 선택한 모든 도형에 반영됩니다.</p></div>
  <fieldset disabled={disabled||!onApply} className="grid gap-3 sm:grid-cols-2">
   <label className="grid gap-1 text-sm">선 색상<input aria-label="적용할 선 색상" type="color" className={field} value={style.color} onChange={event=>update({color:event.target.value})}/></label>
   <label className="grid gap-1 text-sm">선 굵기<select aria-label="적용할 선 굵기" className={field} value={style.lineWidth} onChange={event=>update({lineWidth:event.target.value})}>{["0.25 mm","0.50 mm","1.00 mm"].map(value=><option key={value}>{value}</option>)}</select></label>
   <label className="grid gap-1 text-sm">채움<select aria-label="적용할 채움" className={field} value={style.fill} onChange={event=>update({fill:event.target.value})}>{["없음","연한 보라","연한 회색"].map(value=><option key={value}>{value}</option>)}</select></label>
  </fieldset>
  <Button disabled={disabled||!onApply} onClick={()=>{onApply?.(style);setApplied(true);}}>선택한 도형에 스타일 적용</Button>
  {disabled&&<p role="status" className="text-sm">읽기 전용 또는 잠긴 선택입니다. 작성 가능한 도형에서 적용할 수 있습니다.</p>}
  {applied&&objects.every(object=>object.color===style.color&&object.lineWidth===style.lineWidth&&object.fill===style.fill)&&<p role="status" className="text-sm">화면 도형에 적용했습니다. 도면에서 실행 취소로 함께 되돌릴 수 있습니다.</p>}
  <p className="text-xs text-muted-foreground">원본 PDF·CAD와 출력 설정은 변경하지 않습니다. 선 종류·문자 크기·스타일 라이브러리 저장은 아직 연결하지 않았습니다.</p>
 </section>;
}

function Styles({ viewer }: { viewer: boolean }) {
  const [color, setColor] = useState("#6d28d9");
  const [width, setWidth] = useState("0.25");
  const [line, setLine] = useState("solid");
  const [textSize, setTextSize] = useState("14");
  const [preset, setPreset] = useState("검토 표시");
  return (
    <div className="grid gap-4">
      <fieldset disabled={viewer} className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          스타일 이름
          <input
            className={field}
            value={preset}
            maxLength={60}
            onChange={(e) => setPreset(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          선 색상
          <input
            type="color"
            className={field}
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          선 굵기
          <select
            className={field}
            value={width}
            onChange={(e) => setWidth(e.target.value)}
          >
            {["0.13", "0.25", "0.50", "0.70"].map((value) => (
              <option key={value} value={value}>
                {value} mm
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          선 종류
          <select
            className={field}
            value={line}
            onChange={(e) => setLine(e.target.value)}
          >
            <option value="solid">실선</option>
            <option value="dashed">파선</option>
            <option value="dotted">점선</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          문자 크기
          <select
            className={field}
            value={textSize}
            onChange={(e) => setTextSize(e.target.value)}
          >
            {["12", "14", "18", "24"].map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
        </label>
      </fieldset>
      <section className="rounded-xl border p-5" aria-label="스타일 미리보기">
        <p className="text-xs text-muted-foreground">
          스타일 미리보기 · 화면 픽셀 표시
        </p>
        <div
          className="my-5"
          style={{
            borderTopColor: color,
            borderTopWidth: `${Number(width) * 8}px`,
            borderTopStyle: line as "solid" | "dashed" | "dotted",
          }}
        />
        <p style={{ color, fontSize: `${textSize}px` }} className="break-words">
          {preset.trim() || "이름 없는 스타일"} · Aa 가나다 123
        </p>
      </section>
      <p className="text-xs text-muted-foreground">
        이 미리보기만 변경됩니다. 도면 선 굵기나 출력 설정에는 반영되지
        않습니다.
      </p>
    </div>
  );
}

function Properties({ viewer }: { viewer: boolean }) {
  const [classification, setClassification] = useState("미분류");
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [required, setRequired] = useState(false);
  return (
    <div className="grid gap-4">
      <div className="rounded-xl border p-4">
        <h3 className="font-semibold">객체 속성 템플릿</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          선택 객체는 없습니다. 아래 값은 속성 양식 체험용입니다.
        </p>
      </div>
      <fieldset disabled={viewer} className="grid gap-3">
        <label className="grid gap-1 text-sm">
          공종 분류
          <select
            className={field}
            value={classification}
            onChange={(e) => setClassification(e.target.value)}
          >
            {["미분류", "건축 마감", "구조", "기계 설비", "전기 통신"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          회사 항목 코드
          <input
            className={field}
            placeholder="예: FIN-001"
            maxLength={40}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          검토 메모
          <textarea
            className={field}
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          후속 검토 필요 · 예시
        </label>
      </fieldset>
      <dl className="grid grid-cols-[7rem_1fr] gap-2 rounded-xl bg-muted/40 p-4 text-sm">
        <dt>분류</dt>
        <dd>{classification}</dd>
        <dt>코드</dt>
        <dd className="break-all">{code.trim() || "미입력"}</dd>
        <dt>검토 표시</dt>
        <dd>{required ? "검토 필요 · 예시" : "지정 안 함"}</dd>
      </dl>
    </div>
  );
}

function ObjectSchedule({objects,layers,onLocate}:{objects:ScreenShape[];layers:PreviewLayer[];onLocate?:(id:string)=>void}){
 const [query,setQuery]=useState("");
 const layerMap=new Map(layers.map(layer=>[layer.id,layer]));
 const found=objects.filter(object=>`${object.name} ${object.kind} ${layerMap.get(object.layer)?.name??object.layer}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 return <section aria-label="현재 도면 객체 목록" className="grid gap-4">
  <label className="grid gap-1 text-sm">도면 객체 검색<input aria-label="도면 객체 검색" className={field} value={query} onChange={event=>setQuery(event.target.value)} placeholder="이름·종류·레이어 검색"/></label>
  <p className="text-xs text-muted-foreground">표시 {found.length} / 전체 {objects.length}개 · 화면 도형 수이며 물량 산출 결과가 아닙니다.</p>
  {!objects.length?<p className="rounded-lg border border-dashed p-5">작성한 도형이 없습니다. 도면으로 돌아가 도형을 추가하세요.</p>:!found.length?<p role="status">검색 결과가 없습니다. 다른 이름이나 레이어로 검색하세요.</p>:<div role="region" aria-label="도면 객체 표 가로 스크롤" tabIndex={0} className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[480px] text-left text-sm"><caption className="p-3 text-left">현재 도면 객체</caption><thead className="border-y bg-muted/40"><tr>{['이름','종류','페이지','레이어','상태'].map(label=><th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead><tbody>{found.map(object=>{const layer=layerMap.get(object.layer);return <tr key={object.id} className="border-b last:border-0"><td className="max-w-60 break-words p-3"><button className="text-left text-violet-700 underline disabled:text-muted-foreground" aria-label={`${object.name||object.kind} · 도형 위치 확인`} disabled={!onLocate} onClick={()=>onLocate?.(object.id)}>{object.name||object.kind}</button></td><td className="p-3">{object.kind}</td><td className="p-3">{object.page}쪽</td><td className="p-3">{layer?.name??'레이어 없음'}</td><td className="p-3">{layer?.visible===false?'숨김':'표시'}{layer?.locked?' · 잠금':''}</td></tr>;})}</tbody></table></div>}
  <p className="text-xs text-muted-foreground">행을 누르면 같은 도형 위치를 확인합니다. 숨긴 레이어는 위치 확인을 위해 표시됩니다. 공간·문·마감 분류와 면적·수량 집계는 아직 연결하지 않았습니다.</p>
 </section>;
}

function Schedules({ ready }: { ready: boolean }) {
  const [kind, setKind] = useState<"공간" | "문" | "마감">("공간");
  if (!ready)
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <h3 className="font-semibold">도면을 먼저 열어 주세요.</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          도면 없이 공간·문·마감 집계가 있다고 표시하지 않습니다.
        </p>
      </div>
    );
  const rows = {
    공간: [
      ["R-01", "회의실", "업무 공간", "미측정"],
      ["R-02", "업무실", "업무 공간", "미측정"],
    ],
    문: [
      ["D-01", "단일 여닫이문", "문·창", "미집계"],
      ["D-02", "양개 여닫이문", "문·창", "미집계"],
    ],
    마감: [
      ["FIN-01", "바닥 마감", "사양 미정", "미집계"],
      ["FIN-02", "벽 마감", "사양 미정", "미집계"],
    ],
  }[kind];
  return (
    <div className="grid gap-4">
      <div className="flex gap-2" aria-label="스케줄 종류">
        {(["공간", "문", "마감"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={kind === value ? "default" : "outline"}
            aria-pressed={kind === value}
            onClick={() => setKind(value)}
          >
            {value}
          </Button>
        ))}
      </div>
      <div
        role="region"
        aria-label="스케줄 가로 스크롤"
        tabIndex={0}
        className="overflow-x-auto rounded-xl border"
      >
        <table className="w-full min-w-[440px] text-left text-sm">
          <caption className="p-3 text-left text-xs text-muted-foreground">
            {kind} 스케줄 · 행 구성 예시
          </caption>
          <thead className="border-y bg-muted/40">
            <tr>
              {["번호", "항목", "분류", "수량 상태"].map((h) => (
                <th key={h} className="p-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row[0]} className="border-b last:border-0">
                {row.map((value, index) => (
                  <td key={index} className="p-3">
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        화면 구성 예시이며 도면에서 추출한 결과가 아닙니다. 개수·면적·수량은
        집계하지 않습니다.
      </p>
    </div>
  );
}

export function WorkbenchPreviewBody({
  section,
  documentName,
  page,
  ready,
  viewer,
  layers = [],
  onLayersChange = () => {},
  reviewLoop,
  onReview,
  selectedObjects=[],
  styleReadOnly=false,
  onApplyStyle,
  drawingObjects,
  onLocateObject,
  onApplyProperties,
  onChooseTool,
  onChooseBlock,
  authoringReadOnly=false,
}: Context & { section: Section }) {
  return (
    <div className="min-w-0 space-y-4">
      {section==="authoring"&&onChooseTool?<p className="rounded-lg bg-violet-50 p-3 text-xs text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">도면 배치 도구는 현재 캔버스와 연결됩니다. 고급 옵션 예시는 별도이며 원본 파일은 수정하지 않습니다.</p>:<p className="rounded-lg bg-violet-50 p-3 text-xs leading-relaxed text-violet-800 dark:bg-violet-950/40 dark:text-violet-200">
        {section==="blocks"&&onChooseBlock?"라이브러리 기호를 현재 도면에 배치합니다. 배치한 기호는 화면 도형으로 보관되며, 실제 CAD 블록·축척 배치가 아닙니다.":section==="schedules"&&drawingObjects!==undefined?"현재 도면에 작성한 화면 도형 목록입니다. 원본 파일에서 자동 추출한 물량표가 아닙니다.":(section==="styles"||section==="properties")&&selectedObjects.length?"선택한 화면 도형의 설정을 변경합니다. 원본 파일은 수정하지 않습니다.":"화면 예시 · 변경은 원본 도면에 적용되지 않습니다. 이 메뉴의 양식과 레이어 목록은 현재 도면을 열어 둔 동안 유지됩니다. 새로고침하면 초기화됩니다."}
      </p>}
      <p className="break-words text-sm text-muted-foreground">
        {ready ? `${documentName} · ${page}쪽` : "도면 미선택"}
        {viewer ? " · 보기 전용" : " · 로컬 화면 체험"}
      </p>
      {section === "blocks" && <Blocks onChoose={onChooseBlock} disabled={!ready||viewer||authoringReadOnly}/>}
      {section === "authoring" && (
        onChooseTool?<DrawingAuthoringLauncher ready={ready} disabled={viewer||authoringReadOnly} onChoose={onChooseTool}/>:<AuthoringPreviewBody ready={ready} viewer={viewer} />
      )}
      {section === "states" && <DrawingStatePreview />}
      {section === "documents" && (
        <DrawingDocumentPreview
          ready={ready}
          viewer={viewer}
          layers={layers}
          onLayersChange={onLayersChange}
        />
      )}
      {section === "styles" && (selectedObjects.length?<SelectedStyles key={selectedObjects.map(object=>object.id).join("|")} objects={selectedObjects} disabled={viewer||styleReadOnly} onApply={onApplyStyle}/>:<><p className="text-sm">선택한 도형이 없습니다. 도면에서 도형을 선택하면 스타일을 적용할 수 있습니다.</p><Styles viewer={viewer}/></>)}
      {section === "properties" && (selectedObjects.length===1?<DrawingObjectPropertiesPreview key={selectedObjects[0].id} object={selectedObjects[0]} disabled={viewer||styleReadOnly} onApply={onApplyProperties}/>:selectedObjects.length>1?<p className="rounded-lg border p-4">도형 {selectedObjects.length}개를 선택했습니다. 도형별 속성을 확인하려면 도면에서 하나만 선택해 주세요.</p>:<Properties viewer={viewer}/>)}
      {section === "schedules" && (ready&&drawingObjects!==undefined?<ObjectSchedule objects={drawingObjects} layers={layers} onLocate={onLocateObject}/>:<Schedules ready={ready}/>)}
      {section === "sources" && (
        <SourcePreviewBody ready={ready} viewer={viewer} reviewLoop={reviewLoop} onReview={onReview}/>
      )}
    </div>
  );
}

export function DrawingWorkbenchPreview({
  open,
  onOpenChange,
  initialSection = "blocks",
  ...context
}: Context & {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  initialSection?: Section;
}) {
  const [section, setSection] = useState<Section>(initialSection);
  const [visitedSections, setVisitedSections] = useState<Section[]>([initialSection]);
  const [hasOpened, setHasOpened] = useState(open);
  const bodyId = useId();
  const opener = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) {
      setHasOpened(true);
      setSection(initialSection);
      setVisitedSections(visited => visited.includes(initialSection) ? visited : [...visited, initialSection]);
    }
  }, [open, initialSection]);
  useEffect(() => {
    const dialog = contentRef.current;
    if (!dialog) return;
    if (open && hasOpened && !dialog.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      if (initialSection === "authoring") dialog.querySelector<HTMLInputElement>('input[aria-label="도구·명령 검색"]')?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
      if (opener.current?.isConnected) opener.current.focus();
    }
  }, [open, hasOpened, initialSection]);
  return (
      <dialog
        ref={contentRef}
        aria-labelledby={`${bodyId}-title`}
        aria-describedby={`${bodyId}-description`}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-xl border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/50 open:grid open:gap-5"
        onCancel={event => {event.preventDefault();onOpenChange(false);}}
      >
        {hasOpened && <>
        <header>
          <h2 id={`${bodyId}-title`} className="text-lg font-semibold">작업실 메뉴</h2>
          <p id={`${bodyId}-description`} className="mt-1 text-sm text-muted-foreground">
            도면의 구성과 반복 작업을 위한 보조 화면입니다.
          </p>
        </header>
        <div className="grid min-w-0 gap-5 sm:grid-cols-[170px_minmax(0,1fr)]">
          <nav
            aria-label="작업실 도구"
            className="flex flex-wrap content-start gap-1 sm:flex-col"
          >
            {sections.map((item) => (
              <button
                key={item.id}
                aria-current={section === item.id ? "page" : undefined}
                aria-controls={bodyId}
                className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm ${section === item.id ? "bg-violet-100 font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-200" : "text-muted-foreground hover:bg-muted"}`}
                onClick={() => {
                  setSection(item.id);
                  setVisitedSections((visited) => visited.includes(item.id) ? visited : [...visited, item.id]);
                }}
              >
                <item.icon className="size-4 shrink-0" />
                {item.label}
              </button>
            ))}
          </nav>
          <section id={bodyId} className="min-w-0">
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
              <Layers className="size-4" />
              {sections.find((item) => item.id === section)?.label}
            </h2>
            {visitedSections.map((visited) => (
              <div key={visited} hidden={visited !== section}>
                <WorkbenchPreviewBody section={visited} {...context} />
              </div>
            ))}
          </section>
        </div>
        <div className="flex justify-end border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            도면으로 돌아가기
          </Button>
        </div>
        </>}
      </dialog>
  );
}
