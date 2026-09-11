import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

import DxfParser, { type IDxf } from "dxf-parser";
import { z } from "zod";

import {
  DRAWING_COLLABORATION_LIMITS,
  DRAWING_COLLABORATION_SCHEMA_VERSION,
  DrawingCollaborationOperationSchema,
} from "./drawing-collaboration-protocol.ts";
import {
  DrawingLayerNameSchema,
  DrawingObjectSchema,
  DrawingOperationInputSchema,
  type DrawingGeometry,
  type DrawingObject,
  type DrawingOperationInput,
  type DrawingStyle,
  type DrawingStructureLayer,
} from "./drawing-workspace.types.ts";

export const DRAWING_DXF_IMPORT_LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxEntities: 10_000,
  maxPoints: 100_000,
  maxBlockDepth: 4,
  maxCoordinateMillimeters: 9_000_000_000,
  maxElapsedMilliseconds: 5_000,
  maxReportIssues: 100,
});

type ImportLimits = typeof DRAWING_DXF_IMPORT_LIMITS;
type UnknownRecord = Record<string, unknown>;

export type DrawingDxfImportIssue = {
  code: string;
  detail: string;
  entityType?: string;
  entityKey?: string;
  count?: number;
};

export type DrawingDxfImportedEntityLineage = {
  objectId: string;
  entityKey: string;
  entityType: string;
  sourceLayer: string;
  rawHandle: string | null;
};

export type DrawingDxfImportResult = {
  sourceSha256: string | null;
  units: {
    code: number;
    label: string;
    millimetersPerUnit: number;
    source: "declared" | "user_selected";
  } | null;
  layers: DrawingStructureLayer[];
  objects: DrawingObject[];
  entityLineage: DrawingDxfImportedEntityLineage[];
  operations: DrawingOperationInput[];
  report: {
    imported: number;
    converted: DrawingDxfImportIssue[];
    skipped: DrawingDxfImportIssue[];
    blocking: DrawingDxfImportIssue[];
  };
};

const DrawingDxfUnitSelectionSchema = z.union([
  z.object({ code: z.literal(1), label: z.literal("in") }).strict(),
  z.object({ code: z.literal(2), label: z.literal("ft") }).strict(),
  z.object({ code: z.literal(4), label: z.literal("mm") }).strict(),
  z.object({ code: z.literal(5), label: z.literal("cm") }).strict(),
  z.object({ code: z.literal(6), label: z.literal("m") }).strict(),
]);

export type DrawingDxfUnitSelection = z.infer<
  typeof DrawingDxfUnitSelectionSchema
>;

const InputSchema = z
  .object({
    revisionId: z.string().uuid(),
    canvasId: z.string().uuid(),
    createdAt: z.string().datetime(),
    unitOverride: DrawingDxfUnitSelectionSchema.optional(),
  })
  .strict();

const unitDefinitions = new Map([
  [1, { label: "in", millimetersPerUnit: 25.4 }],
  [2, { label: "ft", millimetersPerUnit: 304.8 }],
  [4, { label: "mm", millimetersPerUnit: 1 }],
  [5, { label: "cm", millimetersPerUnit: 10 }],
  [6, { label: "m", millimetersPerUnit: 1_000 }],
]);

const defaultStyle: DrawingStyle = Object.freeze({
  stroke: "#111827",
  strokeWidth: 1,
  fill: null,
});

if (typeof DxfParser !== "function")
  throw new Error("DXF parser dependency is unavailable.");
const require = createRequire(import.meta.url);
const dxfParserPath = require.resolve("dxf-parser");
const parserWorkerSource = `
const { parentPort, workerData } = require("node:worker_threads");
try {
  const DxfParser = require(workerData.parserPath);
  parentPort.postMessage({
    ok: true,
    value: new DxfParser().parseSync(workerData.source),
  });
} catch {
  parentPort.postMessage({ ok: false });
}
`;
const collaborationActorId = "71000000-0000-4000-8000-000000000000";

class BlockingImportError extends Error {
  readonly issue: DrawingDxfImportIssue;

  constructor(issue: DrawingDxfImportIssue) {
    super(issue.detail);
    this.issue = issue;
  }
}

function parseDxfInWorker(source: string, timeoutMilliseconds: number) {
  return new Promise<IDxf | null>((resolve, reject) => {
    const worker = new Worker(parserWorkerSource, {
      eval: true,
      workerData: { parserPath: dxfParserPath, source },
    });
    let settled = false;
    const stop = () => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      return true;
    };
    const timer = setTimeout(() => {
      if (!stop()) return;
      void worker.terminate();
      reject(
        new BlockingImportError(
          issue(
            "ELAPSED_LIMIT",
            "DXF parsing 시간이 안전 한도를 초과했습니다.",
          ),
        ),
      );
    }, timeoutMilliseconds);
    worker.once("message", (message: unknown) => {
      if (!stop()) return;
      void worker.terminate();
      const result = record(message);
      if (result?.ok === true) resolve((result.value as IDxf | null) ?? null);
      else reject(new Error("DXF parser worker rejected the input."));
    });
    worker.once("error", (error) => {
      if (!stop()) return;
      void worker.terminate();
      reject(error);
    });
    worker.once("exit", (code) => {
      if (settled || code === 0) return;
      if (!stop()) return;
      reject(new Error("DXF parser worker exited unexpectedly."));
    });
  });
}

type Transform = {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
  scale: number;
  rotationDegrees: number;
};

const identityTransform: Transform = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
  scale: 1,
  rotationDegrees: 0,
};

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function issue(
  code: string,
  detail: string,
  entity?: UnknownRecord,
  entityKey?: string,
): DrawingDxfImportIssue {
  return {
    code,
    detail,
    ...(typeof entity?.type === "string" ? { entityType: entity.type } : {}),
    ...(entityKey ? { entityKey } : {}),
  };
}

type DrawingDxfIssueBuffer = {
  limit: number;
  retained: DrawingDxfImportIssue[];
  omitted: number;
};

function createIssueBuffer(limit: number): DrawingDxfIssueBuffer {
  return { limit, retained: [], omitted: 0 };
}

function appendIssue(
  buffer: DrawingDxfIssueBuffer,
  value: DrawingDxfImportIssue,
) {
  if (buffer.retained.length < buffer.limit) buffer.retained.push(value);
  else buffer.omitted += 1;
}

function issueBufferValues(buffer: DrawingDxfIssueBuffer) {
  if (buffer.omitted === 0) return buffer.retained;
  const detailLimit = buffer.limit - 1;
  const count = buffer.omitted + buffer.retained.length - detailLimit;
  return [
    ...buffer.retained.slice(0, detailLimit),
    {
      code: "REPORT_TRUNCATED",
      detail: `DXF 보고서 상세 ${count}건을 생략했습니다.`,
      count,
    },
  ];
}

function deterministicUuid(seed: string) {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function boundedUnicodeScalarLength(value: string, limit: number) {
  let length = 0;
  for (const _character of value) {
    length += 1;
    if (length > limit) return null;
  }
  return length;
}

function normalizeNumber(value: number) {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function compose(parent: Transform, local: Transform): Transform {
  return {
    a: parent.a * local.a + parent.c * local.b,
    b: parent.b * local.a + parent.d * local.b,
    c: parent.a * local.c + parent.c * local.d,
    d: parent.b * local.c + parent.d * local.d,
    tx: parent.a * local.tx + parent.c * local.ty + parent.tx,
    ty: parent.b * local.tx + parent.d * local.ty + parent.ty,
    scale: parent.scale * local.scale,
    rotationDegrees: parent.rotationDegrees + local.rotationDegrees,
  };
}

function insertionTransform(
  position: { x: number; y: number },
  base: { x: number; y: number },
  scale: number,
  rotationDegrees: number,
): Transform {
  const radians = (rotationDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians) * scale;
  const sine = Math.sin(radians) * scale;
  return {
    a: cosine,
    b: sine,
    c: -sine,
    d: cosine,
    tx: position.x - cosine * base.x + sine * base.y,
    ty: position.y - sine * base.x - cosine * base.y,
    scale,
    rotationDegrees,
  };
}

function rawPoint(value: unknown) {
  const point = record(value);
  if (!point || typeof point.x !== "number" || typeof point.y !== "number")
    return null;
  if (typeof point.z === "number" && point.z !== 0) return null;
  return { x: point.x, y: point.y };
}

function isDefaultExtrusion(value: unknown) {
  if (value === undefined) return true;
  const direction = record(value);
  return (
    direction !== null &&
    direction.x === 0 &&
    direction.y === 0 &&
    direction.z === 1
  );
}

function hasDefaultArcExtrusion(entity: UnknownRecord) {
  const values = [
    entity.extrusionDirectionX,
    entity.extrusionDirectionY,
    entity.extrusionDirectionZ,
  ];
  return (
    values.every((value) => value === undefined) ||
    (values[0] === 0 && values[1] === 0 && values[2] === 1)
  );
}

function makeBlockedResult(
  sourceSha256: string | null,
  blocking: DrawingDxfImportIssue[],
  skipped: DrawingDxfImportIssue[] = [],
  converted: DrawingDxfImportIssue[] = [],
): DrawingDxfImportResult {
  return {
    sourceSha256,
    units: null,
    layers: [],
    objects: [],
    entityLineage: [],
    operations: [],
    report: { imported: 0, converted, skipped, blocking },
  };
}

const dxfParserEntityTypes = new Set([
  "3DFACE",
  "ARC",
  "ATTDEF",
  "CIRCLE",
  "DIMENSION",
  "ELLIPSE",
  "INSERT",
  "LINE",
  "LWPOLYLINE",
  "MTEXT",
  "POINT",
  "POLYLINE",
  "SOLID",
  "SPLINE",
  "TEXT",
  "VERTEX",
]);
const rawEntityControls = new Set(["BLOCK", "ENDBLK", "SEQEND"]);
type DxfLayerMetadata = {
  name: string;
  visible: boolean;
  locked: boolean;
  styleNormalized: boolean;
};
type RawDxfEntityIdentity = {
  rawKey: string;
  entityType: string;
  sourceLayer: string;
  rawHandle: string | null;
  rawHandleNormalized: boolean;
};

function isRawDxfCoordinateCode(entityType: string, code: number) {
  return (
    (code >= 10 && code <= 18) ||
    (code >= 20 && code <= 28) ||
    (code >= 30 && code <= 38) ||
    (entityType.toUpperCase() === "HATCH" && code >= 43 && code <= 46) ||
    (code >= 110 && code <= 118) ||
    (code >= 120 && code <= 128) ||
    (code >= 130 && code <= 138)
  );
}

function isRawDxfPointStartCode(entityType: string, code: number) {
  return (
    (code >= 10 && code <= 18) ||
    (entityType.toUpperCase() === "HATCH" && code === 43) ||
    (code >= 110 && code <= 118)
  );
}

function inspectRawDxf(
  source: string,
  limits: ImportLimits,
  startedAt: number,
  now: () => number,
) {
  const skipped = createIssueBuffer(limits.maxReportIssues);
  const layers = new Map<string, DxfLayerMetadata>();
  const rawEntities: RawDxfEntityIdentity[] = [];
  const rawBlockEntities = new Map<string, RawDxfEntityIdentity[]>();
  const blockNames = new Set<string>();
  let rawEntityDraft: RawDxfEntityIdentity | null = null;
  let rawEntityTarget: RawDxfEntityIdentity[] | null = null;
  let currentBlockName: string | null = null;
  let currentBlockDefinitionOrdinal: number | null = null;
  let awaitingBlockName = false;
  let insideLegacyPolyline = false;
  let entitiesOrdinal = 0;
  let blockOrdinal = 0;
  let nextBlockDefinitionOrdinal = 0;
  const finishRawEntity = () => {
    if (rawEntityDraft && rawEntityTarget) rawEntityTarget.push(rawEntityDraft);
    rawEntityDraft = null;
    rawEntityTarget = null;
  };
  const beginRawEntity = (type: string) => {
    if (type === "SEQEND") {
      insideLegacyPolyline = false;
      return;
    }
    if (rawEntityControls.has(type)) return;
    const target =
      section === "ENTITIES"
        ? rawEntities
        : section === "BLOCKS" && currentBlockName
          ? (rawBlockEntities.get(currentBlockName.toUpperCase()) ?? [])
          : null;
    const ordinal = section === "ENTITIES" ? entitiesOrdinal++ : blockOrdinal++;
    if (section === "BLOCKS" && currentBlockName && target)
      rawBlockEntities.set(currentBlockName.toUpperCase(), target);
    const isNestedVertex = type === "VERTEX" && insideLegacyPolyline;
    if (type === "POLYLINE") insideLegacyPolyline = true;
    if (isNestedVertex || !target || !dxfParserEntityTypes.has(type)) return;
    rawEntityDraft = {
      rawKey:
        section === "ENTITIES"
          ? `raw:ENTITIES:${ordinal}`
          : `raw:BLOCKS:${currentBlockDefinitionOrdinal}:${ordinal}`,
      entityType: type,
      sourceLayer: "0",
      rawHandle: null,
      rawHandleNormalized: false,
    };
    rawEntityTarget = target;
  };
  let layerDraft: {
    name: string | null;
    visible: boolean;
    locked: boolean;
    styleNormalized: boolean;
  } | null = null;
  let layerBlocking: DrawingDxfImportIssue | null = null;
  let droppedPointCount = 0;
  let maxAbsoluteDroppedCoordinate = 0;
  const finishLayer = () => {
    if (
      layerDraft?.name &&
      DrawingLayerNameSchema.safeParse(layerDraft.name).success
    )
      if (layers.has(layerDraft.name.toUpperCase()))
        layerBlocking ??= issue(
          "DUPLICATE_LAYER_NAME",
          "대소문자만 다른 중복 DXF layer 이름을 안전하게 병합하지 않습니다.",
        );
      else
        layers.set(layerDraft.name.toUpperCase(), {
          name: layerDraft.name,
          visible: layerDraft.visible,
          locked: layerDraft.locked,
          styleNormalized: layerDraft.styleNormalized,
        });
    layerDraft = null;
  };
  const blocked = (blocking: DrawingDxfImportIssue) => ({
    blocking,
    skipped,
    layers,
    rawEntities,
    rawBlockEntities,
    droppedPointCount,
    maxAbsoluteDroppedCoordinate,
  });
  const validSymbolName = (rawValue: string, value: string) =>
    value.length > 0 &&
    boundedUnicodeScalarLength(value, 255) !== null &&
    rawValue === value &&
    !/[\u0000-\u001f\u007f]/u.test(value);
  const nextLine = () => {
    if (cursor >= source.length) return null;
    const start = cursor;
    while (
      cursor < source.length &&
      source.charCodeAt(cursor) !== 10 &&
      source.charCodeAt(cursor) !== 13
    )
      cursor += 1;
    const value = source.slice(start, cursor);
    if (source.charCodeAt(cursor) === 13) cursor += 1;
    if (source.charCodeAt(cursor) === 10) cursor += 1;
    return value;
  };
  let cursor = 0;
  let pairIndex = 0;
  let entityCount = 0;
  let section = "";
  let awaitingSectionName = false;
  let entityType = "";
  while (true) {
    if (now() - startedAt > limits.maxElapsedMilliseconds)
      return blocked(
        issue(
          "ELAPSED_LIMIT",
          "DXF raw preflight 시간이 안전 한도를 초과했습니다.",
        ),
      );
    const rawCodeLine = nextLine();
    const rawValue = nextLine();
    if (rawCodeLine === null || rawValue === null) break;
    const code = Number.parseInt(rawCodeLine.trim(), 10);
    const value = rawValue.trim();
    if (code === 0) finishRawEntity();
    if (code === 0 && value === "SECTION") {
      currentBlockName = null;
      currentBlockDefinitionOrdinal = null;
      awaitingBlockName = false;
      insideLegacyPolyline = false;
      awaitingSectionName = true;
      entityType = "";
      pairIndex += 1;
      continue;
    }
    if (awaitingSectionName && code === 2) {
      section = value;
      awaitingSectionName = false;
      pairIndex += 1;
      continue;
    }
    if (code === 0 && value === "ENDSEC") {
      if (section === "TABLES") {
        finishLayer();
        if (layerBlocking) return blocked(layerBlocking);
      }
      currentBlockName = null;
      currentBlockDefinitionOrdinal = null;
      awaitingBlockName = false;
      insideLegacyPolyline = false;
      section = "";
      entityType = "";
      pairIndex += 1;
      continue;
    }
    if (code === 0) {
      if (section === "TABLES") {
        finishLayer();
        if (layerBlocking) return blocked(layerBlocking);
        if (value === "LAYER")
          layerDraft = {
            name: null,
            visible: true,
            locked: false,
            styleNormalized: false,
          };
      }
      entityType = value;
      if (section === "BLOCKS" && value === "BLOCK") {
        currentBlockName = null;
        currentBlockDefinitionOrdinal = nextBlockDefinitionOrdinal++;
        awaitingBlockName = true;
        insideLegacyPolyline = false;
        blockOrdinal = 0;
      } else if (section === "BLOCKS" && value === "ENDBLK") {
        currentBlockName = null;
        currentBlockDefinitionOrdinal = null;
        awaitingBlockName = false;
        insideLegacyPolyline = false;
      } else if (section === "ENTITIES" || section === "BLOCKS") {
        awaitingBlockName = false;
        beginRawEntity(value);
      }
      if (
        (section === "ENTITIES" || section === "BLOCKS") &&
        !rawEntityControls.has(value)
      ) {
        entityCount += 1;
        if (!dxfParserEntityTypes.has(value))
          appendIssue(
            skipped,
            issue(
              "UNSUPPORTED_RAW_ENTITY",
              `dxf-parser가 보존하지 않는 DXF entity ${value}입니다.`,
              { type: value },
              `raw:${section}:${pairIndex}`,
            ),
          );
        if (entityCount > limits.maxEntities)
          return blocked(
            issue("ENTITY_LIMIT", "DXF entity 수가 안전 한도를 초과했습니다."),
          );
      }
    }
    pairIndex += 1;
    if (
      section === "BLOCKS" &&
      awaitingBlockName &&
      entityType === "BLOCK" &&
      code === 2
    ) {
      if (!validSymbolName(rawValue, value))
        return blocked(
          issue(
            "INVALID_BLOCK_NAME",
            "DXF BLOCK 이름은 공백·제어문자 없이 255자 이하여야 합니다.",
          ),
        );
      const canonicalBlockName = value.toUpperCase();
      if (blockNames.has(canonicalBlockName))
        return blocked(
          issue(
            "DUPLICATE_BLOCK_NAME",
            "대소문자를 구분하지 않는 중복 DXF BLOCK 이름이 있습니다.",
          ),
        );
      blockNames.add(canonicalBlockName);
      currentBlockName = value;
      rawBlockEntities.set(canonicalBlockName, []);
      continue;
    }
    if (section === "TABLES") {
      if (entityType !== "LAYER" || !layerDraft) continue;
      if (code === 2) layerDraft.name = value;
      if (
        code === 6 &&
        !["BYLAYER", "CONTINUOUS"].includes(value.toUpperCase())
      )
        layerDraft.styleNormalized = true;
      if (code === 62) {
        const color = Number.parseInt(value, 10);
        if (Number.isFinite(color)) {
          layerDraft.visible &&= color >= 0;
          layerDraft.styleNormalized = true;
        }
      }
      if (code === 70) {
        const flags = Number.parseInt(value, 10);
        if (Number.isFinite(flags)) {
          layerDraft.visible &&= (flags & 3) === 0;
          layerDraft.locked ||= (flags & 4) !== 0;
        }
      }
      if (code === 370 && Number.parseInt(value, 10) >= 0)
        layerDraft.styleNormalized = true;
      if (code === 420) layerDraft.styleNormalized = true;
      continue;
    }
    if (section !== "ENTITIES" && section !== "BLOCKS") continue;
    if (
      !dxfParserEntityTypes.has(entityType) &&
      isRawDxfCoordinateCode(entityType, code)
    ) {
      const coordinate = Number(value);
      if (!Number.isFinite(coordinate))
        return blocked(
          issue("NON_FINITE_NUMBER", "DXF에 NaN 또는 Infinity가 있습니다."),
        );
      maxAbsoluteDroppedCoordinate = Math.max(
        maxAbsoluteDroppedCoordinate,
        Math.abs(coordinate),
      );
      if (isRawDxfPointStartCode(entityType, code)) {
        droppedPointCount += 1;
        if (droppedPointCount > limits.maxPoints)
          return blocked(
            issue("POINT_LIMIT", "DXF point 수가 안전 한도를 초과했습니다."),
          );
      }
    }
    if (
      entityType === "TEXT" &&
      code === 1 &&
      boundedUnicodeScalarLength(rawValue, 10_000) === null
    )
      return blocked(
        issue(
          "TEXT_LENGTH_LIMIT",
          "DXF TEXT는 Unicode 문자 10,000자를 초과할 수 없습니다.",
        ),
      );
    if (
      entityType === "INSERT" &&
      code === 2 &&
      !validSymbolName(rawValue, value)
    )
      return blocked(
        issue(
          "INVALID_BLOCK_NAME",
          "DXF INSERT symbol 이름은 공백·제어문자 없이 255자 이하여야 합니다.",
        ),
      );
    const currentRawEntity = rawEntityDraft as RawDxfEntityIdentity | null;
    if (currentRawEntity) {
      if (code === 5) {
        if (!/^[0-9A-Fa-f]{1,32}$/.test(rawValue))
          return blocked(
            issue(
              "INVALID_HANDLE",
              "DXF handle은 1~32자의 16진수 문자열이어야 합니다.",
            ),
          );
        currentRawEntity.rawHandle = rawValue.toUpperCase();
        currentRawEntity.rawHandleNormalized =
          rawValue !== rawValue.toUpperCase();
      }
      if (code === 8 && value.length > 0) currentRawEntity.sourceLayer = value;
    }
    if (code === 39 && Number.parseFloat(value) !== 0)
      return blocked(
        issue(
          "UNSUPPORTED_THICKNESS",
          "두께가 있는 DXF entity를 2D 선으로 근사하지 않습니다.",
        ),
      );
    if (
      (entityType === "POLYLINE" || entityType === "VERTEX") &&
      (code === 40 || code === 41) &&
      Number.parseFloat(value) !== 0
    )
      return blocked(
        issue(
          "UNSUPPORTED_POLYLINE_WIDTH",
          "legacy POLYLINE vertex 폭을 무시하지 않습니다.",
        ),
      );
    if (
      entityType === "VERTEX" &&
      code === 70 &&
      Number.parseInt(value, 10) !== 0
    )
      return blocked(
        issue(
          "UNSUPPORTED_POLYLINE_VERTEX_FLAGS",
          "곡선·spline·3D·mesh VERTEX를 직선 점으로 근사하지 않습니다.",
        ),
      );
    if (
      entityType === "POLYLINE" &&
      code === 30 &&
      Number.parseFloat(value) !== 0
    )
      return blocked(
        issue(
          "UNSUPPORTED_NON_PLANAR",
          "elevation이 있는 legacy POLYLINE을 2D로 투영하지 않습니다.",
        ),
      );
    if (entityType === "TEXT" && code === 51 && Number.parseFloat(value) !== 0)
      return blocked(
        issue(
          "UNSUPPORTED_TEXT_OBLIQUE",
          "기울어진 TEXT를 일반 TEXT로 근사하지 않습니다.",
        ),
      );
    if (entityType === "TEXT" && code === 41 && Number.parseFloat(value) !== 1)
      return blocked(
        issue(
          "UNSUPPORTED_TEXT_SCALE",
          "가로 배율이 적용된 TEXT를 일반 TEXT로 근사하지 않습니다.",
        ),
      );
    if (
      entityType === "TEXT" &&
      code === 71 &&
      Number.parseInt(value, 10) !== 0
    )
      return blocked(
        issue(
          "UNSUPPORTED_TEXT_GENERATION",
          "뒤집히거나 반전된 TEXT를 일반 TEXT로 근사하지 않습니다.",
        ),
      );
    if (code === 210 || code === 220 || code === 230) {
      const coordinate = Number.parseFloat(value);
      const expected = code === 230 ? 1 : 0;
      if (!Number.isFinite(coordinate))
        return blocked(
          issue("NON_FINITE_NUMBER", "DXF에 NaN 또는 Infinity가 있습니다."),
        );
      if (coordinate !== expected)
        return blocked(
          issue(
            "UNSUPPORTED_EXTRUSION",
            "기본 OCS가 아닌 DXF entity를 2D로 투영하지 않습니다.",
          ),
        );
    }
  }
  finishRawEntity();
  finishLayer();
  if (layerBlocking) return blocked(layerBlocking);
  return {
    blocking: null,
    skipped,
    layers,
    rawEntities,
    rawBlockEntities,
    droppedPointCount,
    maxAbsoluteDroppedCoordinate,
  };
}

function resolvedLimits(overrides: Partial<ImportLimits> | undefined) {
  const limits = { ...DRAWING_DXF_IMPORT_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value < 0)
      throw new TypeError(`Invalid DXF import limit: ${key}.`);
  }
  if (
    !Number.isSafeInteger(limits.maxReportIssues) ||
    limits.maxReportIssues < 1
  )
    throw new TypeError("Invalid DXF import limit: maxReportIssues.");
  return limits;
}

function preflightParsedDxf(
  header: UnknownRecord,
  blocks: Record<string, UnknownRecord>,
  entities: UnknownRecord[],
  limits: ImportLimits,
  unitScale: number,
  droppedPointCount: number,
  maxAbsoluteDroppedCoordinate: number,
) {
  let entityCount = entities.length;
  const entityGroups = [entities];
  for (const block of Object.values(blocks)) {
    const values = Array.isArray(block.entities)
      ? block.entities.map(record).filter((value) => value !== null)
      : [];
    entityCount += values.length;
    entityGroups.push(values);
  }
  if (entityCount > limits.maxEntities)
    throw new BlockingImportError(
      issue("ENTITY_LIMIT", "DXF entity 수가 안전 한도를 초과했습니다."),
    );

  if (
    maxAbsoluteDroppedCoordinate * unitScale >
    limits.maxCoordinateMillimeters
  )
    throw new BlockingImportError(
      issue(
        "COORDINATE_LIMIT",
        "DXF 좌표가 안전한 millimeter 범위를 초과했습니다.",
      ),
    );

  let pointCount = droppedPointCount;
  const visited = new Set<object>();
  const visit = (value: unknown) => {
    if (typeof value === "number") {
      if (!Number.isFinite(value))
        throw new BlockingImportError(
          issue("NON_FINITE_NUMBER", "DXF에 NaN 또는 Infinity가 있습니다."),
        );
      return;
    }
    if (typeof value === "string") {
      if (value.includes("\0"))
        throw new BlockingImportError(
          issue("NUL_BYTE", "DXF 문자열에 NUL 문자가 있습니다."),
        );
      return;
    }
    if (value === null || typeof value !== "object" || visited.has(value))
      return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    const candidate = value as UnknownRecord;
    if (typeof candidate.x === "number" && typeof candidate.y === "number") {
      pointCount += 1;
      if (pointCount > limits.maxPoints)
        throw new BlockingImportError(
          issue("POINT_LIMIT", "DXF point 수가 안전 한도를 초과했습니다."),
        );
      for (const coordinate of [candidate.x, candidate.y, candidate.z]) {
        if (typeof coordinate !== "number") continue;
        if (!Number.isFinite(coordinate))
          throw new BlockingImportError(
            issue("NON_FINITE_NUMBER", "DXF에 NaN 또는 Infinity가 있습니다."),
          );
        if (Math.abs(coordinate * unitScale) > limits.maxCoordinateMillimeters)
          throw new BlockingImportError(
            issue(
              "COORDINATE_LIMIT",
              "DXF 좌표가 안전한 millimeter 범위를 초과했습니다.",
            ),
          );
      }
    }
    for (const child of Object.values(candidate)) visit(child);
  };
  for (const group of entityGroups) visit(group);
  visit(Object.values(blocks));
  const extentMinimum = record(header.$EXTMIN);
  const extentMaximum = record(header.$EXTMAX);
  const hasUnusedExtentSentinels =
    extentMinimum?.x === 1e20 &&
    extentMinimum.y === 1e20 &&
    extentMinimum.z === 1e20 &&
    extentMaximum?.x === -1e20 &&
    extentMaximum.y === -1e20 &&
    extentMaximum.z === -1e20;
  for (const [key, value] of Object.entries(header))
    if (!hasUnusedExtentSentinels || (key !== "$EXTMIN" && key !== "$EXTMAX"))
      visit(value);
}

type ConversionContext = {
  sourceSha256: string;
  revisionId: string;
  canvasId: string;
  createdAt: string;
  blocks: Record<string, UnknownRecord>;
  unitScale: number;
  unitKey: string;
  limits: ImportLimits;
  startedAt: number;
  now: () => number;
  expandedEntities: number;
  expandedPoints: number;
  objects: DrawingObject[];
  entityLineage: DrawingDxfImportedEntityLineage[];
  layerIds: Map<string, { id: string; name: string }>;
  sourceLayers: Map<string, DxfLayerMetadata>;
  rawEntities: RawDxfEntityIdentity[];
  rawBlockEntities: Map<string, RawDxfEntityIdentity[]>;
  converted: DrawingDxfIssueBuffer;
  skipped: DrawingDxfIssueBuffer;
};

function checkElapsed(context: ConversionContext) {
  if (context.now() - context.startedAt > context.limits.maxElapsedMilliseconds)
    throw new BlockingImportError(
      issue("ELAPSED_LIMIT", "DXF 변환 시간이 안전 한도를 초과했습니다."),
    );
}

function transformedPoint(
  context: ConversionContext,
  transform: Transform,
  value: unknown,
) {
  const point = rawPoint(value);
  if (!point) return null;
  context.expandedPoints += 1;
  if (context.expandedPoints > context.limits.maxPoints)
    throw new BlockingImportError(
      issue("POINT_LIMIT", "평탄화된 DXF point 수가 안전 한도를 초과했습니다."),
    );
  const x =
    (transform.a * point.x + transform.c * point.y + transform.tx) *
    context.unitScale;
  const y =
    (transform.b * point.x + transform.d * point.y + transform.ty) *
    context.unitScale;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    Math.abs(x) > context.limits.maxCoordinateMillimeters ||
    Math.abs(y) > context.limits.maxCoordinateMillimeters
  )
    throw new BlockingImportError(
      issue(
        Number.isFinite(x) && Number.isFinite(y)
          ? "COORDINATE_LIMIT"
          : "NON_FINITE_NUMBER",
        "DXF 변환 좌표가 안전 범위를 벗어났습니다.",
      ),
    );
  return { x: normalizeNumber(x), y: normalizeNumber(y) };
}

function layerNameFor(
  context: ConversionContext,
  entity: UnknownRecord,
  inheritedLayer?: string,
) {
  const candidate =
    typeof entity.layer === "string" && entity.layer !== "0"
      ? entity.layer
      : (inheritedLayer ??
        (typeof entity.layer === "string" ? entity.layer : "0"));
  if (!DrawingLayerNameSchema.safeParse(candidate).success) return null;
  const key = candidate.toUpperCase();
  return {
    key,
    name:
      context.sourceLayers.get(key)?.name ??
      context.layerIds.get(key)?.name ??
      candidate,
  };
}

function normalizesEntityStyle(entity: UnknownRecord) {
  return (
    (typeof entity.lineType === "string" &&
      !["BYLAYER", "CONTINUOUS"].includes(entity.lineType.toUpperCase())) ||
    (typeof entity.lineTypeScale === "number" && entity.lineTypeScale !== 1) ||
    (typeof entity.colorIndex === "number" && entity.colorIndex !== 256) ||
    typeof entity.color === "number" ||
    (typeof entity.lineweight === "number" && entity.lineweight >= 0) ||
    entity.hasContinuousLinetypePattern === true
  );
}

function pushSkip(
  context: ConversionContext,
  entity: UnknownRecord,
  entityKey: string,
  code: string,
  detail: string,
) {
  appendIssue(context.skipped, issue(code, detail, entity, entityKey));
}

function addObject(
  context: ConversionContext,
  entity: UnknownRecord,
  entityKey: string,
  rawIdentity: RawDxfEntityIdentity | undefined,
  inheritedLayer: string | undefined,
  geometry: DrawingGeometry,
  style: DrawingStyle = defaultStyle,
) {
  if (!rawIdentity || rawIdentity.entityType !== entity.type)
    throw new BlockingImportError(
      issue(
        "SOURCE_IDENTITY_MISMATCH",
        "DXF raw entity와 parser entity 순서가 일치하지 않습니다.",
        entity,
        entityKey,
      ),
    );
  const layer = layerNameFor(context, entity, inheritedLayer);
  if (!layer) {
    pushSkip(
      context,
      entity,
      entityKey,
      "INVALID_LAYER",
      "DXF layer 이름을 안전하게 보존할 수 없습니다.",
    );
    return;
  }
  const layerId =
    context.layerIds.get(layer.key)?.id ??
    deterministicUuid(
      `${context.revisionId}:${context.canvasId}:${context.sourceSha256}:${context.unitKey}:layer:${layer.key}`,
    );
  const object = DrawingObjectSchema.safeParse({
    id: deterministicUuid(
      `${context.revisionId}:${context.canvasId}:${context.sourceSha256}:${context.unitKey}:entity:${entityKey}`,
    ),
    name: `DXF ${String(entity.type)} ${context.objects.length + 1}`,
    layerId,
    geometry,
    styleId: null,
    style: { ...style },
    version: 1,
  });
  if (!object.success) {
    pushSkip(
      context,
      entity,
      entityKey,
      "INCOMPLETE_ENTITY",
      "DXF entity를 canonical drawing object로 검증할 수 없습니다.",
    );
    return;
  }
  context.layerIds.set(layer.key, { id: layerId, name: layer.name });
  context.objects.push(object.data);
  const lineageEntityKey = `${entityKey}@${rawIdentity.rawKey}`;
  if (lineageEntityKey.length > 1_024)
    throw new BlockingImportError(
      issue(
        "ENTITY_KEY_LIMIT",
        "DXF entity source key가 안전 한도를 초과했습니다.",
        entity,
        entityKey,
      ),
    );
  context.entityLineage.push({
    objectId: object.data.id,
    entityKey: lineageEntityKey,
    entityType: rawIdentity.entityType,
    sourceLayer: rawIdentity.sourceLayer,
    rawHandle: rawIdentity.rawHandle,
  });
  if (rawIdentity.rawHandleNormalized)
    appendIssue(
      context.converted,
      issue(
        "HANDLE_NORMALIZED",
        "소문자 DXF handle을 canonical 대문자 16진수로 정규화했습니다.",
        entity,
        entityKey,
      ),
    );
  if (
    normalizesEntityStyle(entity) ||
    context.sourceLayers.get(layer.key)?.styleNormalized === true
  )
    appendIssue(
      context.converted,
      issue(
        "STYLE_NORMALIZED",
        "현재 편집 스타일로 보존할 수 없는 DXF 선·색·굵기 정보를 기본 스타일로 정규화했습니다.",
        entity,
        entityKey,
      ),
    );
}

function positiveRadius(
  context: ConversionContext,
  entity: UnknownRecord,
  transform: Transform,
) {
  if (typeof entity.radius !== "number" || entity.radius <= 0) return null;
  const radius = entity.radius * transform.scale * context.unitScale;
  if (
    !Number.isFinite(radius) ||
    radius > context.limits.maxCoordinateMillimeters
  )
    throw new BlockingImportError(
      issue("COORDINATE_LIMIT", "DXF 반지름이 안전 범위를 초과했습니다."),
    );
  return normalizeNumber(radius);
}

function convertPrimitive(
  context: ConversionContext,
  entity: UnknownRecord,
  entityKey: string,
  rawIdentity: RawDxfEntityIdentity | undefined,
  transform: Transform,
  inheritedLayer?: string,
) {
  const type = entity.type;
  if (type === "LINE") {
    if (!isDefaultExtrusion(entity.extrusionDirection)) {
      pushSkip(
        context,
        entity,
        entityKey,
        "UNSUPPORTED_NON_PLANAR",
        "2D LINE만 지원합니다.",
      );
      return;
    }
    const vertices = Array.isArray(entity.vertices) ? entity.vertices : [];
    const start = transformedPoint(context, transform, vertices[0]);
    const end = transformedPoint(context, transform, vertices[1]);
    if (
      vertices.length !== 2 ||
      !start ||
      !end ||
      (start.x === end.x && start.y === end.y)
    ) {
      pushSkip(
        context,
        entity,
        entityKey,
        "INCOMPLETE_ENTITY",
        "LINE의 두 끝점을 확인할 수 없습니다.",
      );
      return;
    }
    addObject(context, entity, entityKey, rawIdentity, inheritedLayer, {
      type: "line",
      start,
      end,
    });
    return;
  }

  if (type === "LWPOLYLINE" || type === "POLYLINE") {
    if (
      entity.width !== undefined ||
      (typeof entity.elevation === "number" && entity.elevation !== 0) ||
      entity.is3dPolyline === true ||
      entity.is3dPolygonMesh === true ||
      entity.isPolyfaceMesh === true ||
      entity.includesCurveFitVertices === true ||
      entity.includesSplineFitVertices === true ||
      !isDefaultExtrusion(entity.extrusionDirection)
    ) {
      pushSkip(
        context,
        entity,
        entityKey,
        "UNSUPPORTED_POLYLINE",
        "폭·곡선·3D POLYLINE은 지원하지 않습니다.",
      );
      return;
    }
    const vertices = Array.isArray(entity.vertices)
      ? entity.vertices.map(record).filter((value) => value !== null)
      : [];
    if (
      vertices.some(
        (vertex) =>
          (typeof vertex.bulge === "number" && vertex.bulge !== 0) ||
          (typeof vertex.startWidth === "number" && vertex.startWidth !== 0) ||
          (typeof vertex.endWidth === "number" && vertex.endWidth !== 0),
      )
    ) {
      pushSkip(
        context,
        entity,
        entityKey,
        "UNSUPPORTED_BULGE",
        "bulge 또는 가변 폭을 직선으로 근사하지 않습니다.",
      );
      return;
    }
    const points = vertices.map((vertex) =>
      transformedPoint(context, transform, vertex),
    );
    if (points.length < 2 || points.some((point) => point === null)) {
      pushSkip(
        context,
        entity,
        entityKey,
        "INCOMPLETE_ENTITY",
        "POLYLINE 점을 확인할 수 없습니다.",
      );
      return;
    }
    addObject(context, entity, entityKey, rawIdentity, inheritedLayer, {
      type: "polyline",
      points: points as Array<{ x: number; y: number }>,
      closed: entity.shape === true,
    });
    return;
  }

  if (type === "CIRCLE") {
    const center = transformedPoint(context, transform, entity.center);
    const radius = positiveRadius(context, entity, transform);
    if (!center || radius === null) {
      pushSkip(
        context,
        entity,
        entityKey,
        "INCOMPLETE_ENTITY",
        "CIRCLE 중심과 반지름을 확인할 수 없습니다.",
      );
      return;
    }
    addObject(context, entity, entityKey, rawIdentity, inheritedLayer, {
      type: "circle",
      center,
      radius,
    });
    return;
  }

  if (type === "ARC") {
    if (!hasDefaultArcExtrusion(entity)) {
      pushSkip(
        context,
        entity,
        entityKey,
        "UNSUPPORTED_NON_PLANAR",
        "2D ARC만 지원합니다.",
      );
      return;
    }
    const center = transformedPoint(context, transform, entity.center);
    const radius = positiveRadius(context, entity, transform);
    if (
      !center ||
      radius === null ||
      typeof entity.startAngle !== "number" ||
      typeof entity.endAngle !== "number"
    ) {
      pushSkip(
        context,
        entity,
        entityKey,
        "INCOMPLETE_ENTITY",
        "ARC 각도와 반지름을 확인할 수 없습니다.",
      );
      return;
    }
    const start =
      (entity.startAngle * 180) / Math.PI + transform.rotationDegrees;
    let sweep = ((entity.endAngle - entity.startAngle) * 180) / Math.PI;
    if (sweep === 0) {
      pushSkip(
        context,
        entity,
        entityKey,
        "INCOMPLETE_ENTITY",
        "ARC 시작각과 끝각이 같습니다.",
      );
      return;
    }
    while (sweep <= 0) sweep += 360;
    if (sweep > 360) sweep %= 360;
    addObject(context, entity, entityKey, rawIdentity, inheritedLayer, {
      type: "arc",
      semanticVersion: 1,
      center,
      radius,
      startAngleDegrees: normalizeNumber(((start % 360) + 360) % 360),
      sweepAngleDegrees: normalizeNumber(sweep),
    });
    return;
  }

  if (type === "TEXT") {
    const totalRotation =
      (typeof entity.rotation === "number" ? entity.rotation : 0) +
      transform.rotationDegrees;
    const normalizedRotation = ((totalRotation % 360) + 360) % 360;
    if (normalizedRotation > 0.000001 && normalizedRotation < 359.999999) {
      pushSkip(
        context,
        entity,
        entityKey,
        "UNSUPPORTED_TEXT_ROTATION",
        "회전 TEXT는 현재 text geometry로 정확히 보존할 수 없습니다.",
      );
      return;
    }
    if (
      (typeof entity.halign === "number" && entity.halign !== 0) ||
      (typeof entity.valign === "number" && entity.valign !== 0)
    ) {
      pushSkip(
        context,
        entity,
        entityKey,
        "UNSUPPORTED_TEXT_ALIGNMENT",
        "정렬된 TEXT는 현재 text geometry로 정확히 보존할 수 없습니다.",
      );
      return;
    }
    const origin = transformedPoint(context, transform, entity.startPoint);
    const text = typeof entity.text === "string" ? entity.text : null;
    const textLength = text ? boundedUnicodeScalarLength(text, 10_000) : null;
    if (text && textLength === null) {
      pushSkip(
        context,
        entity,
        entityKey,
        "TEXT_LENGTH_LIMIT",
        "DXF TEXT는 Unicode 문자 10,000자를 초과할 수 없습니다.",
      );
      return;
    }
    const xScale = typeof entity.xScale === "number" ? entity.xScale : 1;
    const fontSize =
      typeof entity.textHeight === "number"
        ? normalizeNumber(
            entity.textHeight * transform.scale * context.unitScale,
          )
        : null;
    if (
      !origin ||
      !text ||
      !fontSize ||
      fontSize <= 0 ||
      fontSize > 10_000 ||
      xScale <= 0
    ) {
      pushSkip(
        context,
        entity,
        entityKey,
        "INCOMPLETE_ENTITY",
        "TEXT 위치·높이·내용을 확인할 수 없습니다.",
      );
      return;
    }
    const width = normalizeNumber(
      Math.max(fontSize, (textLength ?? 0) * fontSize * xScale * 0.6),
    );
    appendIssue(
      context.converted,
      issue(
        "TEXT_WIDTH_DERIVED",
        "기본 정렬 DXF TEXT의 글자 수와 높이로 편집 상자 폭을 만들었습니다.",
        entity,
        entityKey,
      ),
    );
    if (width > context.limits.maxCoordinateMillimeters)
      throw new BlockingImportError(
        issue("COORDINATE_LIMIT", "DXF TEXT 폭이 안전 범위를 초과했습니다."),
      );
    addObject(
      context,
      entity,
      entityKey,
      rawIdentity,
      inheritedLayer,
      { type: "text", origin, width, text },
      { ...defaultStyle, fontSize },
    );
    return;
  }

  pushSkip(
    context,
    entity,
    entityKey,
    "UNSUPPORTED_ENTITY",
    `지원하지 않는 DXF entity ${String(type)}입니다.`,
  );
}

function convertInsert(
  context: ConversionContext,
  entity: UnknownRecord,
  entityKey: string,
  parentTransform: Transform,
  inheritedLayer: string | undefined,
  depth: number,
  stack: readonly string[],
) {
  if (depth >= context.limits.maxBlockDepth)
    throw new BlockingImportError(
      issue(
        "BLOCK_DEPTH_LIMIT",
        "DXF BLOCK 중첩 깊이가 안전 한도를 초과했습니다.",
        entity,
        entityKey,
      ),
    );
  const name = typeof entity.name === "string" ? entity.name : "";
  const blockKey = name.toUpperCase();
  const block = context.blocks[blockKey];
  const position = rawPoint(entity.position);
  const parsedBase = rawPoint(block?.position);
  const xScale = typeof entity.xScale === "number" ? entity.xScale : 1;
  const yScale = typeof entity.yScale === "number" ? entity.yScale : 1;
  const zScale = typeof entity.zScale === "number" ? entity.zScale : 1;
  const rotation = typeof entity.rotation === "number" ? entity.rotation : 0;
  const rows = typeof entity.rowCount === "number" ? entity.rowCount : 1;
  const columns =
    typeof entity.columnCount === "number" ? entity.columnCount : 1;
  const blockType = typeof block?.type === "number" ? block.type : 0;
  if (
    !name ||
    !block ||
    !Array.isArray(block.entities) ||
    !position ||
    !parsedBase ||
    xScale <= 0 ||
    xScale !== yScale ||
    zScale !== 1 ||
    rows !== 1 ||
    columns !== 1 ||
    !isDefaultExtrusion(entity.extrusionDirection) ||
    Boolean(block.xrefPath) ||
    (blockType & 124) !== 0
  ) {
    pushSkip(
      context,
      entity,
      entityKey,
      "UNSAFE_BLOCK_TRANSFORM",
      "로컬 2D·균일 스케일 INSERT만 평탄화합니다.",
    );
    return;
  }
  if (stack.includes(blockKey))
    throw new BlockingImportError(
      issue(
        "BLOCK_CYCLE",
        "DXF BLOCK 순환 참조를 발견했습니다.",
        entity,
        entityKey,
      ),
    );
  const resolvedLayer = layerNameFor(context, entity, inheritedLayer);
  if (!resolvedLayer) {
    pushSkip(
      context,
      entity,
      entityKey,
      "INVALID_LAYER",
      "INSERT layer 이름을 보존할 수 없습니다.",
    );
    return;
  }
  const transform = compose(
    parentTransform,
    insertionTransform(position, parsedBase, xScale, rotation),
  );
  appendIssue(
    context.converted,
    issue(
      "BLOCK_FLATTENED",
      `BLOCK ${name}을 검증된 2D 변환으로 평탄화했습니다.`,
      entity,
      entityKey,
    ),
  );
  if (
    normalizesEntityStyle(entity) ||
    context.sourceLayers.get(resolvedLayer.key)?.styleNormalized === true
  )
    appendIssue(
      context.converted,
      issue(
        "STYLE_NORMALIZED",
        "INSERT/BYBLOCK 색·선 스타일 상속을 기본 편집 스타일로 정규화했습니다.",
        entity,
        entityKey,
      ),
    );
  const nextStack = [...stack, blockKey];
  const blockEntities = block.entities
    .map(record)
    .filter((value) => value !== null);
  const rawBlockEntities = context.rawBlockEntities.get(blockKey) ?? [];
  for (let index = 0; index < blockEntities.length; index += 1)
    convertEntity(
      context,
      blockEntities[index],
      `${entityKey}/block:${index}`,
      rawBlockEntities[index],
      transform,
      resolvedLayer.name,
      depth + 1,
      nextStack,
    );
}

function convertEntity(
  context: ConversionContext,
  entity: UnknownRecord,
  entityKey: string,
  rawIdentity: RawDxfEntityIdentity | undefined,
  transform: Transform,
  inheritedLayer: string | undefined,
  depth: number,
  stack: readonly string[],
) {
  checkElapsed(context);
  context.expandedEntities += 1;
  if (context.expandedEntities > context.limits.maxEntities)
    throw new BlockingImportError(
      issue(
        "ENTITY_LIMIT",
        "평탄화된 DXF entity 수가 안전 한도를 초과했습니다.",
      ),
    );
  if (entity.inPaperSpace === true) {
    pushSkip(
      context,
      entity,
      entityKey,
      "UNSUPPORTED_PAPER_SPACE",
      "target space가 없는 초기 import에서는 paper-space entity를 가져오지 않습니다.",
    );
    return;
  }
  if (entity.visible === false) {
    pushSkip(
      context,
      entity,
      entityKey,
      "HIDDEN_ENTITY",
      "숨김 DXF entity를 보이는 도형으로 가져오지 않습니다.",
    );
    return;
  }
  if (entity.type === "INSERT")
    convertInsert(
      context,
      entity,
      entityKey,
      transform,
      inheritedLayer,
      depth,
      stack,
    );
  else
    convertPrimitive(
      context,
      entity,
      entityKey,
      rawIdentity,
      transform,
      inheritedLayer,
    );
}

function operationFitsCollaborationContract(operation: DrawingOperationInput) {
  return DrawingCollaborationOperationSchema.safeParse({
    ...operation,
    actorId: collaborationActorId,
    schemaVersion: DRAWING_COLLABORATION_SCHEMA_VERSION,
  }).success;
}

function chunkForCollaboration<T>(
  context: ConversionContext,
  items: readonly T[],
  makeOperation: (
    chunk: readonly T[],
    chunkIndex: number,
  ) => DrawingOperationInput,
) {
  const operations: DrawingOperationInput[] = [];
  let chunk: T[] = [];
  for (const item of items) {
    checkElapsed(context);
    if (
      chunk.length >= Math.min(32, DRAWING_COLLABORATION_LIMITS.maxActionItems)
    ) {
      operations.push(makeOperation(chunk, operations.length));
      chunk = [];
    }
    const candidate = [...chunk, item];
    if (
      operationFitsCollaborationContract(
        makeOperation(candidate, operations.length),
      )
    ) {
      chunk = candidate;
      continue;
    }
    if (chunk.length === 0)
      throw new BlockingImportError(
        issue(
          "OPERATION_LIMIT",
          "DXF entity 하나가 협업 작업의 256-item 또는 64KiB 한도를 초과했습니다.",
        ),
      );
    operations.push(makeOperation(chunk, operations.length));
    chunk = [item];
    if (
      !operationFitsCollaborationContract(
        makeOperation(chunk, operations.length),
      )
    )
      throw new BlockingImportError(
        issue(
          "OPERATION_LIMIT",
          "DXF entity 하나가 협업 작업의 256-item 또는 64KiB 한도를 초과했습니다.",
        ),
      );
  }
  if (chunk.length > 0)
    operations.push(makeOperation(chunk, operations.length));
  return operations;
}

function buildOperations(context: ConversionContext) {
  if (context.objects.length === 0)
    return {
      layers: [] as DrawingStructureLayer[],
      operations: [] as DrawingOperationInput[],
    };
  const layers = [...context.layerIds.entries()]
    .sort(([left], [right]) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    )
    .map(([key, layer], index) => ({
      id: layer.id,
      name: layer.name,
      visible: context.sourceLayers.get(key)?.visible ?? true,
      locked: context.sourceLayers.get(key)?.locked ?? false,
      systemKind: "custom" as const,
      canvasId: context.canvasId,
      sortOrder: index + 1,
      version: 1,
    }));
  const layerOperations = chunkForCollaboration(
    context,
    layers,
    (chunk, chunkIndex) =>
      DrawingOperationInputSchema.parse({
        clientOperationId: deterministicUuid(
          `${context.revisionId}:${context.canvasId}:${context.sourceSha256}:${context.unitKey}:operation:layers:${chunkIndex}`,
        ),
        revisionId: context.revisionId,
        type: "mutate_structure",
        baseVersions: {},
        forward: {
          type: "mutate_structure",
          actions: chunk.map((layer) => ({
            kind: "put_layer",
            entity: layer,
            baseVersion: null,
          })),
        },
        inverse: {
          type: "mutate_structure",
          actions: [...chunk].reverse().map((layer) => ({
            kind: "delete_layer",
            id: layer.id,
            baseVersion: 1,
          })),
        },
        createdAt: context.createdAt,
      }),
  );
  const objectOperations = chunkForCollaboration(
    context,
    context.objects,
    (chunk, chunkIndex) =>
      DrawingOperationInputSchema.parse({
        clientOperationId: deterministicUuid(
          `${context.revisionId}:${context.canvasId}:${context.sourceSha256}:${context.unitKey}:operation:objects:${chunkIndex}`,
        ),
        revisionId: context.revisionId,
        type: "add_objects",
        baseVersions: {},
        forward: { type: "add_objects", objects: chunk },
        inverse: {
          type: "delete_objects",
          objectIds: chunk.map((object) => object.id),
        },
        createdAt: context.createdAt,
      }),
  );
  const operations = [...layerOperations, ...objectOperations];
  if (operations.length > DRAWING_COLLABORATION_LIMITS.maxOperations)
    throw new BlockingImportError(
      issue(
        "OPERATION_LIMIT",
        "DXF import 작업 수가 협업 ledger 한도를 초과했습니다.",
      ),
    );
  return { layers, operations };
}

/**
 * Server-only trust boundary for text DXF. It returns the existing canonical
 * operation format; callers persist it through the normal operation/outbox path.
 */
export async function buildDrawingDxfImport(input: {
  bytes: Uint8Array;
  revisionId: string;
  canvasId: string;
  createdAt: string;
  unitOverride?: DrawingDxfUnitSelection;
  limits?: Partial<ImportLimits>;
  now?: () => number;
}): Promise<DrawingDxfImportResult> {
  const canonicalInput = InputSchema.parse({
    revisionId: input.revisionId,
    canvasId: input.canvasId,
    createdAt: input.createdAt,
    unitOverride: input.unitOverride,
  });
  const limits = resolvedLimits(input.limits);
  if (!(input.bytes instanceof Uint8Array))
    throw new TypeError("DXF bytes must be a Uint8Array.");
  if (input.bytes.byteLength > limits.maxBytes)
    return makeBlockedResult(null, [
      issue("BYTE_LIMIT", "DXF byte 크기가 안전 한도를 초과했습니다."),
    ]);

  const now = input.now ?? (() => performance.now());
  const startedAt = now();
  const sourceSha256 = createHash("sha256").update(input.bytes).digest("hex");
  if (input.bytes.includes(0))
    return makeBlockedResult(sourceSha256, [
      issue("NUL_BYTE", "text DXF에 NUL byte가 있습니다."),
    ]);

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    return makeBlockedResult(sourceSha256, [
      issue("INVALID_TEXT_ENCODING", "DXF를 UTF-8 text로 읽을 수 없습니다."),
    ]);
  }
  const rawInspection = inspectRawDxf(source, limits, startedAt, now);
  if (rawInspection.blocking)
    return makeBlockedResult(
      sourceSha256,
      [rawInspection.blocking],
      issueBufferValues(rawInspection.skipped),
    );

  let parsedValue: unknown;
  try {
    const remainingMilliseconds =
      limits.maxElapsedMilliseconds - (now() - startedAt);
    if (remainingMilliseconds <= 0)
      throw new BlockingImportError(
        issue("ELAPSED_LIMIT", "DXF parsing 시간이 안전 한도를 초과했습니다."),
      );
    parsedValue = await parseDxfInWorker(
      source,
      Math.max(1, Math.ceil(remainingMilliseconds)),
    );
  } catch (error) {
    if (error instanceof BlockingImportError)
      return makeBlockedResult(sourceSha256, [error.issue]);
    return makeBlockedResult(sourceSha256, [
      issue("PARSE_FAILED", "DXF 구조를 안전하게 해석할 수 없습니다."),
    ]);
  }
  if (now() - startedAt > limits.maxElapsedMilliseconds)
    return makeBlockedResult(sourceSha256, [
      issue("ELAPSED_LIMIT", "DXF parsing 시간이 안전 한도를 초과했습니다."),
    ]);
  const parsed = record(parsedValue);
  if (!parsed || !Array.isArray(parsed.entities))
    return makeBlockedResult(sourceSha256, [
      issue("PARSE_FAILED", "DXF ENTITIES section을 확인할 수 없습니다."),
    ]);
  const entities = parsed.entities
    .map(record)
    .filter((value) => value !== null);
  const blocks = Object.fromEntries(
    Object.entries(record(parsed.blocks) ?? {})
      .map(([name, value]) => [name.toUpperCase(), record(value)] as const)
      .filter(
        (entry): entry is readonly [string, UnknownRecord] => entry[1] !== null,
      ),
  );
  const header = record(parsed.header) ?? {};
  const declaredUnitCode = header.$INSUNITS;
  if (
    declaredUnitCode !== undefined &&
    (typeof declaredUnitCode !== "number" ||
      !Number.isInteger(declaredUnitCode))
  )
    return makeBlockedResult(sourceSha256, [
      issue("UNIT_REQUIRED", "$INSUNITS 값이 올바르지 않습니다."),
    ]);
  if (
    typeof declaredUnitCode === "number" &&
    declaredUnitCode !== 0 &&
    canonicalInput.unitOverride &&
    canonicalInput.unitOverride.code !== declaredUnitCode
  )
    return makeBlockedResult(sourceSha256, [
      issue(
        "UNIT_CONFLICT",
        "사용자가 선택한 단위가 DXF $INSUNITS와 다릅니다.",
      ),
    ]);
  const unitCode =
    typeof declaredUnitCode === "number" && declaredUnitCode !== 0
      ? declaredUnitCode
      : canonicalInput.unitOverride?.code;
  if (unitCode === undefined)
    return makeBlockedResult(sourceSha256, [
      issue(
        "UNIT_REQUIRED",
        "$INSUNITS가 없어 millimeter 변환을 확정할 수 없습니다.",
      ),
    ]);
  const unit = unitDefinitions.get(unitCode);
  if (!unit)
    return makeBlockedResult(sourceSha256, [
      issue(
        "UNSUPPORTED_UNIT",
        `지원하지 않는 $INSUNITS 코드 ${unitCode}입니다.`,
      ),
    ]);
  const unitSource =
    typeof declaredUnitCode === "number" && declaredUnitCode !== 0
      ? ("declared" as const)
      : ("user_selected" as const);
  const { unitOverride: _unitOverride, ...target } = canonicalInput;
  const converted = createIssueBuffer(limits.maxReportIssues);
  if (unitSource === "user_selected")
    appendIssue(
      converted,
      issue(
        "USER_SELECTED_UNIT",
        `사용자가 선택한 ${unit.label} 단위로 millimeter 좌표를 확정했습니다.`,
      ),
    );

  const context: ConversionContext = {
    sourceSha256,
    ...target,
    blocks,
    unitScale: unit.millimetersPerUnit,
    unitKey: `unit:${unitCode}`,
    limits,
    startedAt,
    now,
    expandedEntities: 0,
    expandedPoints: 0,
    objects: [],
    entityLineage: [],
    layerIds: new Map(),
    sourceLayers: rawInspection.layers,
    rawEntities: rawInspection.rawEntities,
    rawBlockEntities: rawInspection.rawBlockEntities,
    converted,
    skipped: rawInspection.skipped,
  };
  try {
    preflightParsedDxf(
      header,
      blocks,
      entities,
      limits,
      unit.millimetersPerUnit,
      rawInspection.droppedPointCount,
      rawInspection.maxAbsoluteDroppedCoordinate,
    );
    for (let index = 0; index < entities.length; index += 1)
      convertEntity(
        context,
        entities[index],
        `entities:${index}`,
        rawInspection.rawEntities[index],
        identityTransform,
        undefined,
        0,
        [],
      );
    checkElapsed(context);
    const built = buildOperations(context);
    checkElapsed(context);
    return {
      sourceSha256,
      units: { code: unitCode, ...unit, source: unitSource },
      layers: built.layers,
      objects: context.objects,
      entityLineage: context.entityLineage,
      operations: built.operations,
      report: {
        imported: context.objects.length,
        converted: issueBufferValues(context.converted),
        skipped: issueBufferValues(context.skipped),
        blocking: [],
      },
    };
  } catch (error) {
    if (!(error instanceof BlockingImportError)) throw error;
    return makeBlockedResult(
      sourceSha256,
      [error.issue],
      issueBufferValues(context.skipped),
      issueBufferValues(context.converted),
    );
  }
}
