import { useEffect, useRef, useState } from "react";
import {
  Box,
  Layers3,
  MousePointer2,
  Move,
  ZoomIn,
  ZoomOut,
  Maximize,
  Eye,
  Scissors,
  SplitSquareHorizontal,
} from "lucide-react";
import type {
  Workflow,
  WorkflowAction,
  WorkflowPage,
} from "../lib/workflow-prototype";
import { phaseLabels,getWorkflowLayers } from "../lib/workflow-prototype";
import {WorkflowLayerControls} from './workflow-prototype-layers';

export type ModelCameraPose = {
  scenario: Workflow["scenario"];
  position: [number, number, number];
  target: [number, number, number];
};

export function WorkflowPrototypeCanvas({
  state: s,
  open,
  go,
  dispatch,
}: {
  state: Workflow;
  open: (panel: string) => void;
  go: (page: WorkflowPage) => void;
  dispatch: (action: WorkflowAction) => void;
}) {
  const modelCameraPose = useRef<ModelCameraPose | null>(null);
  const [mode, setMode] = useState<"author" | "review">(
    s.role === "author" ? "author" : "review",
  );
  const [detailVisible, setDetailVisible] = useState(false);
  const targetReviewProps = {
    className: "flow-review-target",
    "aria-describedby":
      mode === "review" && detailVisible ? "flow-object-review-tip" : undefined,
    onMouseEnter: () => setDetailVisible(true),
    onMouseLeave: () => setDetailVisible(false),
    onFocus: () => setDetailVisible(true),
    onBlur: () => setDetailVisible(false),
    onKeyUp: (event: React.KeyboardEvent<SVGGElement>) => {
      if (event.key === "Escape") setDetailVisible(false);
    },
  };
  const [view, setView] = useState<"2d" | "3d" | "split">(
    s.scenario === "ifc" ? "split" : "2d",
  );
  const [selected, setSelected] = useState(true),
    [locallyHidden, setHidden] = useState(false),
    [isolated, setIsolated] = useState(false),
    [section, setSection] = useState(false),
    [grid, setGrid] = useState(true);
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [tool, setTool] = useState<"select" | "pan">("select");
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const layers=getWorkflowLayers(s);
  const objectLayer=layers.find(layer=>layer.name===(s.object.appearance?.layer??'물량 근거'));
  const sourceHidden=layers.find(layer=>layer.kind==='source')?.visible===false;
  const hidden=locallyHidden||objectLayer?.visible===false;
  const o = s.object,
    editable =
      mode === "author" &&
      s.role === "author" &&
      !objectLayer?.locked &&
      ["draft", "changes"].includes(s.phase);
  const focus = () => {
    setHidden(false);
    setSelected(true);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  return (
    <section
      className={`flow-workspace flow-mode-${mode}${sourceHidden?' flow-source-hidden':''}`}
      aria-label="도면·모델 작업 캔버스"
    >
      <header className="flow-workspace-bar">
        <div>
          <b>{s.document}</b>
          <small>
            R{s.revision} · {o.sourceId} · 시나리오 도면/모델
          </small>
        </div>
        <div className="flow-view-switch">
          {(
            [
              ["2d", "2D 도면"],
              ["3d", "3D 모델"],
              ["split", "분할 보기"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-label={label}
              aria-pressed={view === id}
              onClick={() => setView(id)}
            >
              {id === "split" ? (
                <SplitSquareHorizontal size={15} />
              ) : id === "3d" ? (
                <Box size={15} />
              ) : (
                <Layers3 size={15} />
              )}
              <span>{label}</span>
            </button>
          ))}
        </div>
        <button onClick={() => open("share")}>외부 검토 공유</button>
      </header>
      <div className="flow-workspace-modebar">
        <div role="group" aria-label="작업 모드">
          <button
            aria-pressed={mode === "author"}
            onClick={() => setMode("author")}
          >
            작성 모드
          </button>
          <button
            aria-pressed={mode === "review"}
            onClick={() => setMode("review")}
          >
            검토 모드
          </button>
        </div>
        <span>
          {mode === "review"
            ? "검토 중 · 도형 편집 잠김 · 같은 위치에서 근거 확인"
            : "작성 중 · 변경안을 만든 뒤 검토 요청"}
        </span>
        <button onClick={() => open("model")}>모델 구조·근거</button>
      </div>
      <div className="flow-workspace-grid">
        <aside className="flow-object-tree">
          <small>페이지 / 모델 구조</small>
          <WorkflowLayerControls state={s} dispatch={dispatch}/>
          <button onClick={focus} aria-pressed={selected}>
            {o.location}
          </button>
          <button
            onClick={focus}
            aria-label={`${o.id} 객체 선택`}
            aria-pressed={selected}
          >
            <span className="flow-tree-dot" />
            {o.id}
            <small>{o.name}</small>
          </button>
          <hr />
          <small>표시 설정</small>
          <label>
            <input
              type="checkbox"
              checked={!hidden}
              onChange={(e) => setHidden(!e.target.checked)}
            />
            검토 대상
          </label>
          <label>
            <input
              type="checkbox"
              checked={grid}
              onChange={(e) => setGrid(e.target.checked)}
            />
            그리드·축선
          </label>
          <p>
            시나리오 모델
            <br />
            실측·IFC 변환 아님
          </p>
        </aside>
        <div className="flow-viewport-area">
          {mode === "review" && detailVisible && !hidden && view !== "3d" && (
            <div
              id="flow-object-review-tip"
              role="tooltip"
              className="flow-object-review-tip"
            >
              <strong>{o.name}</strong>
              <p>
                {o.sourceId} / {o.id} / R{s.revision}
              </p>
              <p>{s.history.at(-1)?.label ?? "변경 기록 없음 · 검토 대상"}</p>
              <small>
                현재 수량 {o.quantity} {o.unit} ·{" "}
                {s.quantityStatus === "current"
                  ? "예시 산출 확인"
                  : "재확인 필요"}
              </small>
            </div>
          )}
          <div className="flow-canvas-tools">
            <button
              aria-label="객체 선택 도구"
              aria-pressed={tool === "select"}
              onClick={() => setTool("select")}
            >
              <MousePointer2 size={16} />
            </button>
            <button
              aria-label="도면 이동 도구"
              aria-pressed={tool === "pan"}
              onClick={() => setTool("pan")}
            >
              <Move size={16} />
            </button>
            <button
              aria-label="도면 확대"
              onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
            >
              <ZoomIn size={16} />
            </button>
            <button
              aria-label="도면 축소"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            >
              <ZoomOut size={16} />
            </button>
            <button aria-label="전체 맞춤" onClick={focus}>
              <Maximize size={16} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              aria-label="선택 객체 단독 표시"
              aria-pressed={isolated}
              onClick={() => setIsolated((v) => !v)}
            >
              <Eye size={16} />
              <span>단독</span>
            </button>
            <button
              aria-label="모델 단면"
              aria-pressed={section}
              onClick={() => setSection((v) => !v)}
            >
              <Scissors size={16} />
              <span>단면</span>
            </button>
          </div>
          <div className={`flow-viewport-panes flow-view-${view}`}>
            {view !== "3d" && (
              <div
                className="flow-plan-viewport"
                aria-label="2D 시나리오 도면"
                onPointerDown={(e) => {
                  if (tool !== "pan") return;
                  drag.current = {
                    x: e.clientX,
                    y: e.clientY,
                    left: pan.x,
                    top: pan.y,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  if (drag.current)
                    setPan({
                      x: drag.current.left + e.clientX - drag.current.x,
                      y: drag.current.top + e.clientY - drag.current.y,
                    });
                }}
                onPointerUp={() => {
                  drag.current = null;
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
              >
                <svg
                  viewBox="0 0 900 640"
                  role="img"
                  aria-label={`${s.document} 예시 평면`}
                  style={{
                    transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
                  }}
                >
                  <rect
                    x="25"
                    y="25"
                    width="850"
                    height="590"
                    fill="white"
                    stroke="#c1c9d0"
                  />
                  {grid && (
                    <g stroke="#d6dce1" strokeWidth=".7" strokeDasharray="6 6">
                      {[150, 350, 550, 750].map((x, i) => (
                        <g key={x}>
                          <line x1={x} y1="80" x2={x} y2="505" />
                          <circle cx={x} cy="65" r="14" fill="white" />
                          <text
                            x={x}
                            y="70"
                            textAnchor="middle"
                            fill="#8993a0"
                            stroke="none"
                            fontSize="13"
                          >
                            {i + 1}
                          </text>
                        </g>
                      ))}
                      {[150, 310, 470].map((y, i) => (
                        <g key={y}>
                          <line x1="100" y1={y} x2="800" y2={y} />
                          <circle cx="80" cy={y} r="14" fill="white" />
                          <text
                            x="80"
                            y={y + 5}
                            textAnchor="middle"
                            fill="#8993a0"
                            stroke="none"
                            fontSize="13"
                          >
                            {String.fromCharCode(65 + i)}
                          </text>
                        </g>
                      ))}
                    </g>
                  )}
                  {s.scenario === "civil" ? (
                    <g>
                      <path
                        className="flow-review-reference"
                        d="M110 370 Q330 200 480 280 T790 170"
                        fill="none"
                        stroke="#aebbb4"
                        strokeWidth="70"
                      />
                      <path
                        d="M110 370 Q330 200 480 280 T790 170"
                        fill="none"
                        stroke="white"
                        className="flow-review-reference"
                        strokeWidth="2"
                        strokeDasharray="18 12"
                      />
                      {!isolated && (
                        <g
                          className="flow-review-reference"
                          fill="#ebf1eb"
                          stroke="#8fa89c"
                        >
                          <rect x="180" y="120" width="110" height="75" />
                          <rect x="570" y="330" width="140" height="100" />
                          <text x="590" y="375" fill="#667b71" stroke="none">
                            역사 진입부
                          </text>
                        </g>
                      )}
                      {!hidden && (
                        <g
                          {...targetReviewProps}
                          role="button"
                          tabIndex={0}
                          aria-label={`${o.id} 도면 객체 선택`}
                          onClick={() => setSelected(true)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelected(true);
                            }
                          }}
                        >
                          <path
                            d="M180 408 Q350 278 480 342 T760 253"
                            fill="none"
                            stroke={
                              o.appearance?.stroke ??
                              (selected ? "#6358e8" : "#8295a0")
                            }
                            strokeWidth={o.appearance?.lineWidth ?? 12}
                          />
                          <text x="435" y="375" fill="#554bcc" fontSize="15">
                            {o.id} · {o.quantity} m 예시
                          </text>
                        </g>
                      )}
                    </g>
                  ) : (
                    <g>
                      {!isolated && (
                        <g
                          className="flow-review-reference"
                          fill="none"
                          stroke="#727d87"
                          strokeWidth="7"
                        >
                          <path d="M150 150H750V470H150Z M350 150V280 M350 340V470 M550 150V470 M150 310H310 M390 310H550" />
                          <path
                            d="M350 280A60 60 0 0 1 410 340M350 280V340H410"
                            strokeWidth="1.2"
                          />
                          <path
                            d="M200 150H290M590 150H700M200 470H290M590 470H700"
                            stroke="#81a4b9"
                            strokeWidth="3"
                          />
                        </g>
                      )}
                      {!isolated && (
                        <g
                          className="flow-review-reference"
                          stroke="#ccd2d7"
                          fill="#f7f8fa"
                        >
                          <rect x="405" y="190" width="95" height="50" />
                          <rect x="595" y="190" width="105" height="45" />
                          <rect x="595" y="350" width="105" height="45" />
                          <g fill="#8c96a0" stroke="none" fontSize="13">
                            <text x="430" y="275">
                              회의실 102
                            </text>
                            <text x="615" y="285">
                              업무 공간
                            </text>
                            <text x="620" y="430">
                              자료실
                            </text>
                            <text x="225" y="395">
                              라운지
                            </text>
                          </g>
                        </g>
                      )}
                      {!hidden && (
                        <g
                          {...targetReviewProps}
                          role="button"
                          tabIndex={0}
                          aria-label={`${o.id} 도면 객체 선택`}
                          onClick={() => setSelected(true)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelected(true);
                            }
                          }}
                        >
                          <rect
                            x="157"
                            y="157"
                            width={o.geometryChanged ? 190 : 180}
                            height="146"
                            fill={
                              o.appearance?.fill ??
                              (selected ? "#ece8ff" : "#f0f2f5")
                            }
                            stroke={
                              o.appearance?.stroke ??
                              (selected ? "#7563dc" : "#a4adb7")
                            }
                            strokeWidth={o.appearance?.lineWidth ?? 2}
                            strokeDasharray="6 4"
                          />
                          <text
                            x="245"
                            y="220"
                            textAnchor="middle"
                            fill="#5c53ba"
                            fontSize="16"
                          >
                            {o.id}
                          </text>
                          <text
                            x="245"
                            y="245"
                            textAnchor="middle"
                            fill="#796fb5"
                            fontSize="12"
                          >
                            {o.quantity} {o.unit} · 예시
                          </text>
                          <circle cx="335" cy="165" r="12" fill="#7865dc" />
                          <text
                            x="335"
                            y="170"
                            textAnchor="middle"
                            fill="white"
                            fontSize="12"
                          >
                            1
                          </text>
                        </g>
                      )}
                    </g>
                  )}
                  <g stroke="#b0b9c2" strokeWidth=".8" fill="none">
                    <path d="M150 500v25 M750 500v25 M150 515H750" />
                  </g>
                  <text
                    x="450"
                    y="510"
                    textAnchor="middle"
                    fill="#8c96a3"
                    fontSize="11"
                  >
                    치수·수량은 시나리오 예시
                  </text>
                  <path
                    d="M25 550H875M570 550V615M730 550V615"
                    stroke="#bbc3cc"
                  />
                  <text x="50" y="577" fill="#667384" fontSize="15">
                    {s.document}
                  </text>
                  <text x="50" y="600" fill="#8c96a3" fontSize="10">
                    1HK FRONTEND WORKFLOW / NOT FOR CONSTRUCTION
                  </text>
                  <text x="590" y="578" fill="#8994a0" fontSize="11">
                    {o.sourceId} · R{s.revision}
                  </text>
                  <text x="750" y="592" fill="#707b8c" fontSize="24">
                    1HK
                  </text>
                </svg>
              </div>
            )}
            {view !== "2d" && (
              <SampleModel
                cameraPose={modelCameraPose}
                scenario={s.scenario}
                selected={selected}
                hidden={hidden}
                isolated={isolated||sourceHidden}
                section={section}
                grid={grid}
                geometryChanged={Boolean(o.geometryChanged)}
                onSelect={() => setSelected(true)}
              />
            )}
          </div>
          <div className="flow-canvas-status">
            <span>
              {hidden
                ? "대상 숨김"
                : selected
                  ? `${o.id} 선택됨`
                  : "객체를 선택하세요"}{" "}
              · {section ? "단면 켜짐" : "전체 보기"}
            </span>
            <span>예시 자료 · 실측/실제 IFC 아님</span>
          </div>
        </div>
        <aside className="flow-canvas-inspector">
          <small>
            {mode === "review" ? "검토 대상 · 같은 도면" : "선택 객체"}
          </small>
          <h3>{o.name}</h3>
          <span className="flow-badge">{o.id}</span>
          <dl>
            <dt>위치</dt>
            <dd>{o.location}</dd>
            <dt>수량</dt>
            <dd>
              {s.quantityStatus === "current"
                ? `${o.quantity} ${o.unit}`
                : "확인 필요"}
            </dd>
            <dt>금액 예시</dt>
            <dd>
              {s.quantityStatus === "current"
                ? `${(o.quantity * o.rate).toLocaleString("ko-KR")}원`
                : "미산출"}
            </dd>
          </dl>
          {mode === "author" && (
            <button onClick={() => open("properties")}>속성·레이어</button>
          )}
          <button onClick={() => open("formula")}>산출 근거 확인</button>
          <button onClick={() => go("estimate")}>연결 내역 보기</button>
          <button
            className="flow-primary"
            disabled={!editable}
            onClick={() => dispatch({ type: "revise" })}
          >
            변경안 적용
          </button>
          <button onClick={() => open("compare")}>변경 전후 비교</button>
          <button onClick={() => open("request")}>검토 요청</button>
          <button onClick={() => open("findings")}>확인할 항목·AI</button>
          {mode === "review" && (
            <section
              className="flow-review-thread"
              aria-label="현재 도면 검토 기록"
            >
              <h3>변경·검토 기록</h3>
              <p>
                {o.sourceId} / {o.id} / R{s.revision}
              </p>
              <span className="flow-badge">{phaseLabels[s.phase]}</span>
              {s.request && (
                <blockquote>
                  {s.request.message}
                  <small>요청 기준 R{s.request.revision}</small>
                </blockquote>
              )}
              {!s.history.length ? (
                <p>
                  아직 변경 기록이 없습니다. 검토 요청 전에 대상과 근거를
                  확인하세요.
                </p>
              ) : (
                <ol>
                  {s.history
                    .slice()
                    .reverse()
                    .map((entry, index) => (
                      <li key={`${entry.revision}-${index}`}>
                        <small>R{entry.revision}</small>
                        {entry.label}
                      </li>
                    ))}
                </ol>
              )}
              <button
                onClick={() =>
                  open(
                    s.phase === "requested"
                      ? "review"
                      : s.phase === "reviewed" || s.phase === "approved"
                        ? "approval"
                        : "request",
                  )
                }
              >
                {s.phase === "requested"
                  ? "검토 의견 작성"
                  : s.phase === "reviewed" || s.phase === "approved"
                    ? "승인 근거 확인"
                    : "이 도면의 검토 요청"}
              </button>
              <p className="flow-note">
                예시 작업 기록입니다. 실제 참여자·시간·실시간 댓글은 연결되지
                않았습니다.
              </p>
            </section>
          )}
        </aside>
      </div>
    </section>
  );
}

export type ModelFrame={dataUrl:string;width:number;height:number};
export function SampleModel({
  captureFrame,
  cameraPose,
  scenario,
  selected,
  hidden,
  isolated,
  section,
  grid,
  geometryChanged,
  onSelect,
}: {
  cameraPose: { current: ModelCameraPose | null };
  captureFrame?: {current:((width?:1280|1920)=>ModelFrame)|null};
  scenario: Workflow["scenario"];
  selected: boolean;
  hidden: boolean;
  isolated: boolean;
  section: boolean;
  grid: boolean;
  geometryChanged: boolean;
  onSelect?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    [error, setError] = useState(false);
  const controlsRef = useRef<{ reset: () => void } | null>(null);
  const selection = useRef(onSelect);
  selection.current = onSelect;
  useEffect(() => {
    let cancelled = false,
      dispose = () => {};
    setError(false);
    Promise.all([
      import("three"),
      import("three/examples/jsm/controls/OrbitControls.js"),
    ])
      .then(([T, { OrbitControls }]) => {
        if (cancelled || !host.current) return;
        const node = host.current;
        let renderer: InstanceType<typeof T.WebGLRenderer>;
        try {
          renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
        } catch {
          setError(true);
          return;
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0xf0f3f7, 1);
        renderer.localClippingEnabled = true;
        node.appendChild(renderer.domElement);
        const scene = new T.Scene(),
          camera = new T.PerspectiveCamera(42, 1, 0.1, 1000);
        camera.position.set(18, 16, 20);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 1, 0);
        controls.update();
        controls.saveState();
        if (cameraPose.current?.scenario === scenario) {
          camera.position.set(...cameraPose.current.position);
          controls.target.set(...cameraPose.current.target);
          controls.update();
        }
        controlsRef.current = controls;
        scene.add(new T.HemisphereLight(0xffffff, 0x64748b, 2.4));
        const sun = new T.DirectionalLight(0xffffff, 2);
        sun.position.set(8, 15, 5);
        scene.add(sun);
        if (grid) scene.add(new T.GridHelper(30, 30, 0xb2bbc6, 0xdbe0e6));
        const plane = new T.Plane(new T.Vector3(0, -1, 0), 1.5);
        const meshes: InstanceType<typeof T.Mesh>[] = [];
        const box = (
          x: number,
          y: number,
          z: number,
          w: number,
          h: number,
          d: number,
          target = false,
        ) => {
          if (target ? hidden : isolated) return;
          const material = new T.MeshStandardMaterial({
            color: target && selected ? 0x8271df : target ? 0x9d9bbb : 0xd3dae0,
            roughness: 0.8,
            metalness: 0,
            clippingPlanes: section ? [plane] : [],
          });
          const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), material);
          mesh.position.set(x, y, z);
          mesh.userData.target = target;
          scene.add(mesh);
          meshes.push(mesh);
          const edges = new T.LineSegments(
            new T.EdgesGeometry(mesh.geometry),
            new T.LineBasicMaterial({
              color: target ? 0x625394 : 0xa7b2be,
              clippingPlanes: section ? [plane] : [],
            }),
          );
          mesh.add(edges);
        };
        if (scenario === "civil") {
          box(0, 0.05, 0, 18, 0.1, 6);
          box(0, 0.3, 3, geometryChanged ? 14 : 12, 0.5, 0.5, true);
          for (let i = -2; i <= 2; i++) box(i * 3, 0.2, -1, 1, 0.4, 0.4);
          box(5, 1.5, -6, 5, 3, 4);
        } else {
          box(0, 0.05, 0, 12, 0.1, 8);
          box(0, 1.5, -4, 12, 3, 0.15);
          box(-6, 1.5, 0, 0.15, 3, 8);
          box(6, 1.5, 0, 0.15, 3, 8);
          box(2, 1.5, 0, 0.15, 3, 8);
          box(-2, 1.5, 2, 0.15, 3, 4);
          box(
            -4,
            scenario === "ifc" ? 1.5 : 0.15,
            -2,
            geometryChanged ? 4.2 : 4,
            scenario === "ifc" ? 3 : 0.2,
            scenario === "ifc" ? 0.18 : 4,
            true,
          );
          for (const x of [3.5, 5])
            for (const z of [-2, 2]) box(x, 0.65, z, 1, 0.1, 1.5);
        }
        const raycaster = new T.Raycaster();
        let pointerStart = { x: 0, y: 0 };
        const down = (e: PointerEvent) => {
          pointerStart = { x: e.clientX, y: e.clientY };
        };
        const up = (e: PointerEvent) => {
          if (
            Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) >
            5
          )
            return;
          const r = node.getBoundingClientRect();
          raycaster.setFromCamera(
            new T.Vector2(
              ((e.clientX - r.left) / r.width) * 2 - 1,
              (-(e.clientY - r.top) / r.height) * 2 + 1,
            ),
            camera,
          );
          if (
            raycaster
              .intersectObjects(meshes)
              .some((hit) => hit.object.userData.target)
          )
            selection.current?.();
        };
        renderer.domElement.addEventListener("pointerdown", down);
        renderer.domElement.addEventListener("pointerup", up);
        const resize = () => {
          if (!node.clientWidth || !node.clientHeight) return;
          camera.aspect = node.clientWidth / node.clientHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(node.clientWidth, node.clientHeight);
          renderer.render(scene, camera);
        };
        const observer = new ResizeObserver(resize);
        observer.observe(node);
        const rememberPose=()=>{cameraPose.current={scenario,position:[camera.position.x,camera.position.y,camera.position.z],target:[controls.target.x,controls.target.y,controls.target.z]};};
        controls.addEventListener("change", () => {rememberPose();renderer.render(scene, camera);});
        rememberPose();
        resize();
        if(captureFrame)captureFrame.current=(width)=>{
          if(!renderer.domElement.width||!renderer.domElement.height||!node.isConnected)throw new Error('Model not ready');
          if(width!==undefined&&width!==1280&&width!==1920)throw new Error('Unsupported output size');
          const originalSize=renderer.getSize(new T.Vector2()),originalRatio=renderer.getPixelRatio();
          try{
          if(width){const height=Math.round(width/camera.aspect);if(height<1||height>4096)throw new Error('Output size too large');renderer.setPixelRatio(1);renderer.setSize(width,height,false);}
          renderer.render(scene,camera);
          const output=document.createElement('canvas');
          output.width=renderer.domElement.width;output.height=renderer.domElement.height+48;
          const context=output.getContext('2d');if(!context)throw new Error('Image canvas unavailable');
          context.drawImage(renderer.domElement,0,0);
          context.fillStyle='#172554';context.fillRect(0,output.height-48,output.width,48);
          context.fillStyle='#ffffff';context.font='12px sans-serif';
          context.fillText('1HK | GENERATED SAMPLE - NOT IFC / NOT APPROVED',12,output.height-28,output.width-24);
          context.fillText('Viewport capture - not photorealistic or AI rendering',12,output.height-10,output.width-24);
          return {dataUrl:output.toDataURL('image/png'),width:output.width,height:output.height};
          }finally{if(width){renderer.setPixelRatio(originalRatio);renderer.setSize(originalSize.x,originalSize.y,false);renderer.render(scene,camera);}}
        };
        dispose = () => {
          if(captureFrame)captureFrame.current=null;
          cameraPose.current = {
            scenario,
            position: [camera.position.x, camera.position.y, camera.position.z],
            target: [controls.target.x, controls.target.y, controls.target.z],
          };
          observer.disconnect();
          controls.dispose();
          controlsRef.current = null;
          renderer.domElement.removeEventListener("pointerdown", down);
          renderer.domElement.removeEventListener("pointerup", up);
          scene.traverse((object) => {
            const item = object as InstanceType<typeof T.Mesh>;
            item.geometry?.dispose();
            if (item.material) {
              const materials = Array.isArray(item.material)
                ? item.material
                : [item.material];
              materials.forEach((m) => m.dispose());
            }
          });
          renderer.dispose();
          renderer.domElement.remove();
        };
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      dispose();
    };
  }, [scenario, selected, hidden, isolated, section, grid, geometryChanged, captureFrame]);
  return (
    <div className="flow-model-viewport">
      <div
        ref={host}
        className="flow-model-host"
        role="img"
        aria-label="회전 가능한 시나리오 3D 모델"
      />
      {error ? (
        <p role="alert">
          3D 렌더러를 시작하지 못했습니다. 2D 도면에서 계속 확인할 수 있습니다.
        </p>
      ) : (
        <div className="flow-model-controls">
          <span>드래그 회전 · 휠 확대</span>
          <button onClick={() => controlsRef.current?.reset()}>
            시점 초기화
          </button>
          {onSelect&&<button onClick={onSelect}>검토 부재 선택</button>}
        </div>
      )}
    </div>
  );
}
