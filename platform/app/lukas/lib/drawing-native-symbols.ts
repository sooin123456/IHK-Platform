import { z } from "zod";

import {
  NATIVE_DRAWING_SYMBOL_ASSETS,
  type NativeDrawingSymbolAsset,
} from "./drawing-native-assets.ts";
import { geometryBounds } from "./drawing-geometry.ts";
import {
  BoundsSchema,
  DrawingBlockPrimitiveSchema,
  PointSchema,
} from "./drawing-workspace.types.ts";

export type { NativeAssetProvenance } from "./drawing-native-assets.ts";
export type NativeDrawingSymbol = NativeDrawingSymbolAsset;

export const NativeAssetProvenanceSchema = z
  .object({
    author: z.literal("1HK"),
    sourcePath: z.string().min(1),
    attribution: z.string().min(1),
    license: z.literal("NOASSERTION"),
    origin: z.literal("first-party-generated"),
  })
  .strict();

const NativeDrawingSymbolPrimitiveSchema =
  DrawingBlockPrimitiveSchema.superRefine((primitive, context) => {
    if (primitive.styleId !== null)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["styleId"],
        message: "Native symbol primitives must use complete inline styles.",
      });
  });

export const NativeDrawingSymbolSchema = z
  .object({
    schemaVersion: z.literal("1hk-native-symbol/1"),
    key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    version: z.literal(1),
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().min(1).max(1000),
    units: z.literal("mm"),
    classification: z.enum(["door", "window", "wall", "furniture"]),
    recommendedLayer: z.string().trim().min(1).max(255),
    insertionPoint: PointSchema,
    bounds: BoundsSchema,
    primitives: z.array(NativeDrawingSymbolPrimitiveSchema).min(1),
    provenance: NativeAssetProvenanceSchema,
  })
  .strict()
  .superRefine((symbol, context) => {
    if (symbol.bounds.width <= 0 || symbol.bounds.height <= 0)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bounds"],
        message: "Native symbol bounds must have positive extents.",
      });

    const right = symbol.bounds.x + symbol.bounds.width;
    const bottom = symbol.bounds.y + symbol.bounds.height;
    if (
      symbol.insertionPoint.x < symbol.bounds.x ||
      symbol.insertionPoint.x > right ||
      symbol.insertionPoint.y < symbol.bounds.y ||
      symbol.insertionPoint.y > bottom
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["insertionPoint"],
        message: "Native symbol insertion point must be inside its bounds.",
      });

    const localIds = new Set<string>();
    for (const [index, primitive] of symbol.primitives.entries()) {
      if (localIds.has(primitive.localId))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["primitives", index, "localId"],
          message: "Native symbol primitive local IDs must be unique.",
        });
      localIds.add(primitive.localId);
    }

    if (symbol.primitives.length === 0) return;
    const primitiveBounds = symbol.primitives.map(({ geometry }) =>
      geometryBounds(geometry),
    );
    const x = Math.min(...primitiveBounds.map((bounds) => bounds.x));
    const y = Math.min(...primitiveBounds.map((bounds) => bounds.y));
    const maxX = Math.max(
      ...primitiveBounds.map((bounds) => bounds.x + bounds.width),
    );
    const maxY = Math.max(
      ...primitiveBounds.map((bounds) => bounds.y + bounds.height),
    );
    if (
      symbol.bounds.x !== x ||
      symbol.bounds.y !== y ||
      right !== maxX ||
      bottom !== maxY
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bounds"],
        message:
          "Native symbol bounds must exactly match its geometric extents.",
      });
  });

const symbols: NativeDrawingSymbol[] = NATIVE_DRAWING_SYMBOL_ASSETS.map(
  (symbol) => NativeDrawingSymbolSchema.parse(symbol) as NativeDrawingSymbol,
);
const symbolsByKey = new Map(symbols.map((symbol) => [symbol.key, symbol]));
if (symbolsByKey.size !== symbols.length)
  throw new Error("Native drawing symbol keys must be unique.");

export function listNativeDrawingSymbols(): NativeDrawingSymbol[] {
  return structuredClone(symbols);
}

export function getNativeDrawingSymbol(key: string): NativeDrawingSymbol {
  const symbol = symbolsByKey.get(key);
  if (!symbol) throw new Error(`Unknown native drawing symbol: ${key}`);
  return structuredClone(symbol);
}

function canonicalJson(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON numbers must be finite.");
    return JSON.stringify(value);
  }
  if (typeof value !== "object")
    throw new TypeError("Canonical JSON supports only plain JSON values.");
  if (ancestors.has(value))
    throw new TypeError("Canonical JSON cannot contain cycles.");

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype)
        throw new TypeError("Canonical JSON arrays must be plain.");
      const keys = Object.keys(value);
      if (
        Reflect.ownKeys(value).length !== value.length + 1 ||
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index))
      )
        throw new TypeError(
          "Canonical JSON arrays must be dense without extra properties.",
        );
      const items = keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor))
          throw new TypeError("Canonical JSON cannot invoke getters.");
        return canonicalJson(descriptor.value, ancestors);
      });
      return `[${items.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError("Canonical JSON objects must be plain.");
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string"))
      throw new TypeError("Canonical JSON object keys must be strings.");
    const entries = (ownKeys as string[]).sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor))
        throw new TypeError(
          "Canonical JSON requires enumerable data properties.",
        );
      return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, ancestors)}`;
    });
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** Canonical finite JSON: sorted object keys and unchanged dense array order. */
export function nativeAssetCanonicalJson(value: unknown): string {
  return canonicalJson(value, new WeakSet());
}

/** SHA-256 of UTF-8 canonical JSON, implemented by the native Web Crypto API. */
export async function nativeAssetSha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(nativeAssetCanonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
