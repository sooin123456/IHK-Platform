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
