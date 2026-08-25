import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Form } from "react-router";

import {
  applyDrawingStyleSelection,
  detachDrawingStyleSelection,
  isEditableDrawingLayer,
  resetDrawingStyleOverrides,
  updateDrawingSelectionProperties,
  type DrawingCommand,
  type DrawingDocumentState,
  type DrawingInspectorPatch,
} from "~/lukas/lib/drawing-commands";
import {
  DRAWING_MIXED_STYLE_ID,
  createDrawingStyleResolutionCache,
  sharedDrawingStyleId,
} from "~/lukas/lib/drawing-style-resolution";
import type { DrawingObject, DrawingStyle } from "~/lukas/lib/drawing-workspace.types";
import type {
  DrawingObjectIssueLink,
  DrawingWorkspaceIssue,
} from "~/lukas/lib/drawing-workspace.server";

type Props = {
  actorId: string;
  canEdit: boolean;
  canLinkIssues: boolean;
  issueLinks: DrawingObjectIssueLink[];
  issues: DrawingWorkspaceIssue[];
  onCommand: (command: DrawingCommand) => void;
  selectedIds: string[];
  state: Pick<DrawingDocumentState, "layers" | "objects" | "structure">;
};

function sharedValue(
  objects: DrawingObject[],
  value: (object: DrawingObject) => string,
) {
  const first = objects[0] ? value(objects[0]) : "";
  return objects.every((object) => value(object) === first) ? first : "";
}

function sharedStyleValue(
  styles: DrawingStyle[],
  value: (style: DrawingStyle) => string,
) {
  const first = styles[0] ? value(styles[0]) : "";
  return styles.every((style) => value(style) === first) ? first : "";
}

function inspectorError(error: unknown) {
  return error instanceof Error ? error.message : "속성을 변경하지 못했습니다.";
}

export function DrawingInspector({
  actorId,
  canEdit,
  canLinkIssues,
  issueLinks,
  issues,
  onCommand,
  selectedIds,
  state,
}: Props) {
  const dirtyFields = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [issueSearch, setIssueSearch] = useState("");
  const selectedObjects = useMemo(
    () => selectedIds.map((id) => state.objects[id]).filter(Boolean),
    [selectedIds, state.objects],
  );
  const styleResolution = useMemo(() => {
    const resolver = createDrawingStyleResolutionCache(state.structure?.styles ?? {});
    try {
      return { styles: selectedObjects.map((object) => resolver.resolve(object)), error: null };
    } catch (caught) {
      return { styles: [] as DrawingStyle[], error: inspectorError(caught) };
    }
  }, [selectedObjects, state.structure?.styles]);
  const selectedStyles = styleResolution.styles;
  const selectedStyleId = sharedDrawingStyleId(selectedObjects);
  const selectionKey = selectedObjects
    .map((object) => `${object.id}:${object.version}`)
    .join("|");
  useEffect(() => {
    dirtyFields.current.clear();
    setError(null);
    setIssueSearch("");
  }, [selectionKey]);

  const selectionEligible =
    selectedObjects.length === selectedIds.length &&
    selectedObjects.every((object) =>
      isEditableDrawingLayer(state.layers[object.layerId]),
    );
  const textOnly =
    selectedObjects.length > 0 &&
    selectedObjects.every((object) => object.geometry.type === "text");
  const editableLayers = Object.values(state.layers).filter(
    isEditableDrawingLayer,
  );
  const selectedObject =
    selectedObjects.length === 1 ? selectedObjects[0] : null;
  const linkedIssueIds = new Set(
    selectedObject
      ? issueLinks
          .filter((link) => link.object_id === selectedObject.id)
          .map((link) => link.issue_id)
      : [],
  );
  const linkedIssues = issues.filter((issue) => linkedIssueIds.has(issue.id));
  const issueQuery = issueSearch.trim().toLocaleLowerCase();
  const availableIssues = issues.filter(
    (issue) =>
      !linkedIssueIds.has(issue.id) &&
      (!issueQuery || issue.title.toLocaleLowerCase().includes(issueQuery)),
  );
  const issueSection = selectedObject ? (
    <section
      aria-labelledby="drawing-inspector-issues-title"
      className="mt-6 border-t border-white/10 pt-4"
    >
      <h3 className="text-sm font-bold" id="drawing-inspector-issues-title">
        연결된 이슈
      </h3>
      {linkedIssues.length ? (
        <ul className="mt-2 grid gap-2 text-sm">
          {linkedIssues.map((issue) => (
            <li className="rounded-md bg-white/5 p-2" key={issue.id}>
              <span className="font-medium">{issue.title}</span>
              <span className="ml-2 text-xs text-slate-400">
                {issue.status}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-slate-400">연결된 이슈가 없습니다.</p>
      )}
      {canLinkIssues ? (
        <Form
          aria-label="이슈 연결"
          className="mt-3 grid gap-2"
          data-drawing-shortcuts="ignore"
          method="post"
        >
          <input name="intent" type="hidden" value="link_issue" />
          <input name="object_id" type="hidden" value={selectedObject.id} />
          <label
            className="grid gap-1 text-xs"
            htmlFor="inspector-issue-search"
          >
            이슈 검색
            <input
              className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 text-sm"
              id="inspector-issue-search"
              onChange={(event) => setIssueSearch(event.target.value)}
              type="search"
              value={issueSearch}
            />
          </label>
          <label className="grid gap-1 text-xs" htmlFor="inspector-issue">
            이슈
            <select
              className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 text-sm"
              defaultValue=""
              disabled={availableIssues.length === 0}
              id="inspector-issue"
              name="issue_id"
              required
            >
              <option disabled value="">
                연결할 이슈 선택
              </option>
              {availableIssues.map((issue) => (
                <option key={issue.id} value={issue.id}>
                  {issue.title}
                </option>
              ))}
            </select>
          </label>
          <button
            className="min-h-10 rounded-md bg-indigo-500 px-3 text-sm font-semibold text-white disabled:opacity-50"
            disabled={availableIssues.length === 0}
            type="submit"
          >
            이슈 연결
          </button>
        </Form>
      ) : null}
    </section>
  ) : null;

  function markDirty(field: string) {
    dirtyFields.current.add(field);
  }

  function applyProperties(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const dirty = dirtyFields.current;
    const patch: DrawingInspectorPatch = {};
    if (dirty.has("name")) patch.name = String(data.get("name") ?? "");
    if (dirty.has("layerId")) patch.layerId = String(data.get("layerId") ?? "");
    if (dirty.has("stroke")) patch.stroke = String(data.get("stroke") ?? "");
    if (dirty.has("strokeWidth"))
      patch.strokeWidth = Number(data.get("strokeWidth"));
    if (dirty.has("fill")) {
      const fill = String(data.get("fill") ?? "");
      patch.fill = fill === "" ? null : fill;
    }
    if (dirty.has("fontSize")) patch.fontSize = Number(data.get("fontSize"));
    if (dirty.has("text")) patch.text = String(data.get("text") ?? "");
    try {
      const command = updateDrawingSelectionProperties(
        state,
        selectedIds,
        actorId,
        patch,
      );
      if (command) onCommand(command);
      dirty.clear();
      setError(null);
    } catch (caught) {
      setError(inspectorError(caught));
    }
  }

  function applyStyle(styleId: string) {
    try {
      if (!styleId || styleId === DRAWING_MIXED_STYLE_ID) return;
      onCommand(applyDrawingStyleSelection(state, selectedIds, actorId, styleId));
      setError(null);
    } catch (caught) { setError(inspectorError(caught)); }
  }

  function resetOverrides() {
    try { onCommand(resetDrawingStyleOverrides(state, selectedIds, actorId)); setError(null); }
    catch (caught) { setError(inspectorError(caught)); }
  }

  function detachStyle() {
    try { onCommand(detachDrawingStyleSelection(state, selectedIds, actorId)); setError(null); }
    catch (caught) { setError(inspectorError(caught)); }
  }

  if (selectedObjects.length === 0) {
    return (
      <section aria-labelledby="drawing-inspector-title">
        <h2 className="text-sm font-bold" id="drawing-inspector-title">
          속성
        </h2>
        <p className="mt-4 text-sm leading-6 text-slate-400">
          객체를 선택하면 속성을 편집할 수 있습니다.
        </p>
      </section>
    );
  }

  if (styleResolution.error) {
    return (
      <section aria-labelledby="drawing-inspector-title">
        <h2 className="text-sm font-bold" id="drawing-inspector-title">속성</h2>
        <p className="mt-4 text-sm text-red-300" role="alert">{styleResolution.error}</p>
      </section>
    );
  }

  if (!selectionEligible) {
    return (
      <section aria-labelledby="drawing-inspector-title">
        <h2 className="text-sm font-bold" id="drawing-inspector-title">
          속성
        </h2>
        <p className="mt-4 text-sm text-amber-300" role="status">
          숨김 또는 잠긴 레이어의 선택은 편집할 수 없습니다.
        </p>
        {issueSection}
      </section>
    );
  }

  if (!canEdit) {
    return (
      <section aria-labelledby="drawing-inspector-title">
        <h2 className="text-sm font-bold" id="drawing-inspector-title">
          속성
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          {selectedObjects.length}개 객체 선택 · 읽기 전용
        </p>
        <dl className="mt-4 grid gap-3 text-sm">
          <div>
            <dt className="text-xs text-slate-400">객체 이름</dt>
            <dd>{sharedValue(selectedObjects, (object) => object.name)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">레이어</dt>
            <dd>
              {sharedValue(
                selectedObjects,
                (object) => state.layers[object.layerId]?.name ?? "알 수 없음",
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">선 색상</dt>
            <dd>{sharedStyleValue(selectedStyles, (style) => style.stroke)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">선 두께</dt>
            <dd>{sharedStyleValue(selectedStyles, (style) => String(style.strokeWidth))}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">채우기</dt>
            <dd>{sharedStyleValue(selectedStyles, (style) => style.fill ?? "")}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">글꼴 크기</dt>
            <dd>{sharedStyleValue(selectedStyles, (style) => String(style.fontSize ?? ""))}</dd>
          </div>
          {textOnly ? (
            <div>
              <dt className="text-xs text-slate-400">텍스트</dt>
              <dd className="whitespace-pre-wrap">
                {sharedValue(selectedObjects, (object) =>
                  object.geometry.type === "text" ? object.geometry.text : "",
                )}
              </dd>
            </div>
          ) : null}
        </dl>
        {issueSection}
      </section>
    );
  }

  return (
    <section aria-labelledby="drawing-inspector-title">
      <h2 className="text-sm font-bold" id="drawing-inspector-title">
        속성
      </h2>
      <p className="mt-1 text-xs text-slate-400">
        {selectedObjects.length}개 객체 선택
      </p>
      {state.structure ? (
        <div className="mt-4 grid gap-2 border-t border-white/10 pt-4">
          <label className="grid gap-1 text-xs" htmlFor="inspector-style">
            공유 스타일
            <select
              className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 text-sm"
              id="inspector-style"
              onChange={(event) => applyStyle(event.currentTarget.value)}
              value={selectedStyleId}
            >
              <option disabled value="">인라인 스타일</option>
              <option disabled value={DRAWING_MIXED_STYLE_ID}>혼합 값</option>
              {Object.values(state.structure.styles).sort((left, right) => left.name.localeCompare(right.name)).map((style) => (
                <option key={style.id} value={style.id}>{style.name}</option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="min-h-9 rounded border border-white/20 px-2 text-sm" disabled={!selectedStyleId || selectedStyleId === DRAWING_MIXED_STYLE_ID} onClick={() => applyStyle(selectedStyleId)} type="button">스타일 다시 적용</button>
            <button className="min-h-9 rounded border border-white/20 px-2 text-sm" disabled={selectedObjects.some((object) => !object.styleId)} onClick={resetOverrides} type="button">재정의 초기화</button>
            <button className="min-h-9 rounded border border-white/20 px-2 text-sm" disabled={selectedObjects.some((object) => !object.styleId)} onClick={detachStyle} type="button">스타일 분리</button>
          </div>
        </div>
      ) : null}
      <form
        className="mt-4 grid gap-3"
        data-drawing-shortcuts="ignore"
        key={selectionKey}
        onSubmit={applyProperties}
      >
        <label className="grid gap-1 text-xs" htmlFor="inspector-object-name">
          객체 이름
          <input
            className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 text-sm"
            defaultValue={sharedValue(selectedObjects, (object) => object.name)}
            disabled={!canEdit}
            id="inspector-object-name"
            maxLength={255}
            name="name"
            onChange={() => markDirty("name")}
          />
        </label>

        <label className="grid gap-1 text-xs" htmlFor="inspector-layer">
          레이어
          <select
            className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 text-sm"
            defaultValue={sharedValue(
              selectedObjects,
              (object) => object.layerId,
            )}
            disabled={!canEdit}
            id="inspector-layer"
            name="layerId"
            onChange={() => markDirty("layerId")}
          >
            <option disabled value="">
              혼합 값
            </option>
            {editableLayers.map((layer) => (
              <option key={layer.id} value={layer.id}>
                {layer.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs" htmlFor="inspector-stroke">
          선 색상
          <input
            className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 font-mono text-sm"
            defaultValue={sharedStyleValue(
              selectedStyles,
              (style) => style.stroke,
            )}
            disabled={!canEdit}
            id="inspector-stroke"
            name="stroke"
            onChange={() => markDirty("stroke")}
            pattern="#[0-9a-fA-F]{6}"
            placeholder="#000000"
          />
        </label>

        <label className="grid gap-1 text-xs" htmlFor="inspector-stroke-width">
          선 두께
          <input
            className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 text-sm"
            defaultValue={sharedStyleValue(selectedStyles, (style) => String(style.strokeWidth))}
            disabled={!canEdit}
            id="inspector-stroke-width"
            max={1000}
            min={0.000001}
            name="strokeWidth"
            onChange={() => markDirty("strokeWidth")}
            step="any"
            type="number"
          />
        </label>

        <label className="grid gap-1 text-xs" htmlFor="inspector-fill">
          채우기
          <input
            className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 font-mono text-sm"
            defaultValue={sharedStyleValue(
              selectedStyles,
              (style) => style.fill ?? "",
            )}
            disabled={!canEdit}
            id="inspector-fill"
            name="fill"
            onChange={() => markDirty("fill")}
            pattern="#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?"
            placeholder="비우면 채우기 없음"
          />
        </label>

        {textOnly ? (
          <label className="grid gap-1 text-xs" htmlFor="inspector-font-size">
            글꼴 크기
            <input
              className="min-h-10 rounded-md border border-white/15 bg-slate-950 px-2 text-sm"
              defaultValue={selectedStyles.every((style) => style.fontSize === selectedStyles[0]?.fontSize) ? String(selectedStyles[0]?.fontSize ?? "") : ""}
              id="inspector-font-size"
              max={10000}
              min={0.000001}
              name="fontSize"
              onChange={() => markDirty("fontSize")}
              step="any"
              type="number"
            />
          </label>
        ) : null}

        {textOnly ? (
          <label className="grid gap-1 text-xs" htmlFor="inspector-text">
            텍스트
            <textarea
              className="min-h-24 rounded-md border border-white/15 bg-slate-950 p-2 text-sm"
              defaultValue={sharedValue(selectedObjects, (object) =>
                object.geometry.type === "text" ? object.geometry.text : "",
              )}
              disabled={!canEdit}
              id="inspector-text"
              maxLength={10000}
              name="text"
              onChange={() => markDirty("text")}
            />
          </label>
        ) : null}

        <button
          className="min-h-10 rounded-md bg-indigo-500 px-3 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!canEdit}
          type="submit"
        >
          속성 적용
        </button>
      </form>
      {error ? (
        <p className="mt-3 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {issueSection}
    </section>
  );
}
