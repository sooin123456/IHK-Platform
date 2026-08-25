import {
  resolveDrawingStyle,
} from "./drawing-structure.ts";
import type {
  DrawingObject,
  DrawingStyle,
  DrawingStyleDefinition,
  DrawingStyleOverride,
} from "./drawing-workspace.types.ts";

type StyledDrawing = Pick<DrawingObject, "styleId" | "style"> | {
  styleId: string | null;
  style: DrawingStyleOverride;
};

type InspectorStyledDrawing = Pick<
  DrawingObject,
  "id" | "version" | "styleId" | "style"
>;

export const DRAWING_MIXED_STYLE_ID = "__drawing_mixed_style__";

/** Gives controlled style selectors a non-colliding value for mixed selections. */
export function sharedDrawingStyleId(
  objects: ReadonlyArray<Pick<DrawingObject, "styleId">>,
): string {
  const first = objects[0]?.styleId ?? "";
  return objects.every((object) => (object.styleId ?? "") === first)
    ? first
    : DRAWING_MIXED_STYLE_ID;
}

/**
 * Supplies resolved defaults and a remount key for an inspector selection.
 * Definition versions and resolved values are both part of the key so a live
 * style update discards any now-stale uncontrolled form draft.
 */
export function drawingStyleSelectionFormModel(
  objects: ReadonlyArray<InspectorStyledDrawing>,
  styles: Record<string, DrawingStyleDefinition>,
) {
  const resolver = createDrawingStyleResolutionCache(styles);
  const resolved = objects.map((object) => resolver.resolve(object));
  const shared = (value: (style: DrawingStyle) => string) => {
    const first = resolved[0] ? value(resolved[0]) : "";
    return resolved.every((style) => value(style) === first) ? first : "";
  };
  const resetKey = objects
    .map((object, index) => {
      const definitionVersion = object.styleId
        ? styles[object.styleId]?.version ?? "missing"
        : "inline";
      return `${object.id}:${object.version}:${definitionVersion}:${JSON.stringify(resolved[index])}`;
    })
    .join("|");
  return {
    resetKey,
    styles: resolved,
    defaults: {
      stroke: shared((style) => style.stroke),
      strokeWidth: shared((style) => String(style.strokeWidth)),
      fill: shared((style) => style.fill ?? ""),
      fontSize: shared((style) => String(style.fontSize ?? "")),
    },
  };
}

/** A render-pass-local effective-style cache; callers create a fresh instance. */
export function createDrawingStyleResolutionCache(
  styles: Record<string, DrawingStyleDefinition>,
) {
  const cache = new Map<string, DrawingStyle>();
  let resolveCount = 0;
  return {
    resolve(styled: StyledDrawing): DrawingStyle {
      const styleId = styled.styleId ?? null;
      const version = styleId === null ? "inline" : styles[styleId]?.version ?? "missing";
      const key = `${styleId ?? "inline"}:${version}:${JSON.stringify(styled.style)}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const resolved = resolveDrawingStyle(styled, styles);
      cache.set(key, resolved);
      resolveCount += 1;
      return resolved;
    },
    get resolveCount() {
      return resolveCount;
    },
  };
}
