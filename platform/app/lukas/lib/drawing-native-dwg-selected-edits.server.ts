import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  NativeDrawingDwgImportReportSchema,
  projectNativeDrawingDwgImport,
  type NativeDrawingDwgBinding,
} from "./drawing-native-dwg-import.server.ts";
import { geometryBounds } from "./drawing-geometry.ts";
import {
  DrawingObjectSchema,
  type DrawingObject,
  type Point,
} from "./drawing-workspace.types.ts";

const MAXIMUM_NATIVE_COORDINATE = 999_999_999_999;
const MAXIMUM_PROJECTED_COORDINATE_MILLIMETERS = 9_000_000_000;
const MAXIMUM_EDIT_COUNT = 10_000;
const MAXIMUM_POLYLINE_VERTICES = 100_000;
const MAXIMUM_REQUEST_BYTES = 2 * 1024 * 1024;

type NativePoint = [number, number, number];

type NativeDrawingDwgLineEdit = {
  handle: string;
  type: "LINE";
  start: NativePoint;
  end: NativePoint;
};

type NativeDrawingDwgPolylineEdit = {
  handle: string;
  type: "LWPOLYLINE";
  points: NativePoint[];
  closed: boolean;
};

type NativeDrawingDwgCircleEdit = {
  handle: string;
  type: "CIRCLE";
  center: NativePoint;
  radius: number;
};

type NativeDrawingDwgArcEdit = {
  handle: string;
  type: "ARC";
  center: NativePoint;
  radius: number;
  startAngleRadians: number;
  endAngleRadians: number;
};

type NativeDrawingDwgTextEdit = {
  handle: string;
  type: "TEXT";
  insert: NativePoint;
  height: number;
  text: string;
};

type NativeDrawingDwgSelectedEdit =
  | NativeDrawingDwgLineEdit
  | NativeDrawingDwgPolylineEdit
  | NativeDrawingDwgCircleEdit
  | NativeDrawingDwgArcEdit
  | NativeDrawingDwgTextEdit;

export type NativeDrawingDwgSelectedEditsRequest = {
  schemaVersion: "1hk-dwg-edits/2";
  sourceSha256: string;
  coordinateSystem: "WCS_NATIVE_UNITS";
  edits: NativeDrawingDwgSelectedEdit[];
};

export type NativeDrawingDwgSelectedEditsResult = {
  request: NativeDrawingDwgSelectedEditsRequest | null;
  qualification: "experimental-unqualified";
  persistenceAuthority: "not-issued";
};

type ImportInput = Parameters<typeof projectNativeDrawingDwgImport>[0];

function samePoint(left: Point, right: Point) {
  return left.x === right.x && left.y === right.y;
}

function validUnicodeScalarText(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

function assertSelectedDwgPlainText(value: string) {
  if (
    value.length === 0 ||
    value.length > 10_000 ||
    !validUnicodeScalarText(value) ||
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value) ||
    value.includes("%%") ||
    value.includes("%<")
  )
    throw new Error("DWG TEXT edit must be bounded valid plain text.");
}

function nativePoint(point: Point, millimetersPerUnit: number): NativePoint {
  const x = point.x / millimetersPerUnit;
  const y = point.y / millimetersPerUnit;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    Math.abs(x) > MAXIMUM_NATIVE_COORDINATE ||
    Math.abs(y) > MAXIMUM_NATIVE_COORDINATE
  )
    throw new Error("DWG edit coordinate is outside the native domain.");
  return [Object.is(x, -0) ? 0 : x, Object.is(y, -0) ? 0 : y, 0];
}

function nativeSize(value: number, millimetersPerUnit: number) {
  const size = value / millimetersPerUnit;
  if (!Number.isFinite(size) || size <= 0 || size > MAXIMUM_NATIVE_COORDINATE)
    throw new Error("DWG edit size is outside the native domain.");
  return size;
}

function rawNativeLineGeometry(binding: NativeDrawingDwgBinding) {
  if (
    binding.entityType !== "LINE" ||
    !("start" in binding.nativeGeometry) ||
    !("end" in binding.nativeGeometry)
  )
    throw new Error("Native DWG LINE binding is inconsistent.");
  return binding.nativeGeometry;
}

function rawNativePolylineGeometry(binding: NativeDrawingDwgBinding) {
  if (
    binding.entityType !== "LWPOLYLINE" ||
    !("points" in binding.nativeGeometry) ||
    !("closed" in binding.nativeGeometry)
  )
    throw new Error("Native DWG LWPOLYLINE binding is inconsistent.");
  return binding.nativeGeometry;
}

function rawNativeCircleGeometry(binding: NativeDrawingDwgBinding) {
  if (
    binding.entityType !== "CIRCLE" ||
    !("center" in binding.nativeGeometry) ||
    !("radius" in binding.nativeGeometry) ||
    "startAngleRadians" in binding.nativeGeometry
  )
    throw new Error("Native DWG CIRCLE binding is inconsistent.");
  return binding.nativeGeometry;
}

function rawNativeArcGeometry(binding: NativeDrawingDwgBinding) {
  if (
    binding.entityType !== "ARC" ||
    !("center" in binding.nativeGeometry) ||
    !("radius" in binding.nativeGeometry) ||
    !("startAngleRadians" in binding.nativeGeometry) ||
    !("endAngleRadians" in binding.nativeGeometry)
  )
    throw new Error("Native DWG ARC binding is inconsistent.");
  return binding.nativeGeometry;
}

function rawNativeTextGeometry(binding: NativeDrawingDwgBinding) {
  if (
    binding.entityType !== "TEXT" ||
    !("insert" in binding.nativeGeometry) ||
    !("height" in binding.nativeGeometry) ||
    !("text" in binding.nativeGeometry)
  )
    throw new Error("Native DWG TEXT binding is inconsistent.");
  return binding.nativeGeometry;
}

function assertProjectedBounds(geometry: DrawingObject["geometry"]) {
  const bounds = geometryBounds(geometry);
  if (
    [
      bounds.x,
      bounds.y,
      bounds.x + bounds.width,
      bounds.y + bounds.height,
    ].some(
      (value) =>
        !Number.isFinite(value) ||
        Math.abs(value) > MAXIMUM_PROJECTED_COORDINATE_MILLIMETERS,
    )
  )
    throw new Error("Native DWG edited geometry exceeds the projected extent.");
}

function validateObjectEnvelope(
  current: DrawingObject,
  baseline: DrawingObject,
) {
  if (current.version < baseline.version)
    throw new Error("Native DWG projected object version cannot decrease.");
  if (current.name !== baseline.name)
    throw new Error("Native DWG projected object name is immutable.");
  if (current.layerId !== baseline.layerId)
    throw new Error("Native DWG projected object layer is immutable.");
  if (current.styleId !== baseline.styleId)
    throw new Error("Native DWG projected object style is immutable.");
  const { fontSize: _currentFontSize, ...currentStyle } = current.style;
  const { fontSize: _baselineFontSize, ...baselineStyle } = baseline.style;
  if (
    !isDeepStrictEqual(
      baseline.geometry.type === "text" ? currentStyle : current.style,
      baseline.geometry.type === "text" ? baselineStyle : baseline.style,
    )
  )
    throw new Error("Native DWG projected object style is immutable.");
  if (current.geometry.type !== baseline.geometry.type)
    throw new Error("Native DWG projected object geometry kind is immutable.");
}

function validatePermittedGeometry(
  current: DrawingObject,
  baseline: DrawingObject,
) {
  switch (baseline.geometry.type) {
    case "line":
      if (current.geometry.type !== "line")
        throw new Error("Native DWG projected LINE kind is immutable.");
      return;
    case "polyline":
      if (current.geometry.type !== "polyline")
        throw new Error("Native DWG projected LWPOLYLINE kind is immutable.");
      if (current.geometry.points.length > MAXIMUM_POLYLINE_VERTICES)
        throw new Error(
          "Native DWG edited LWPOLYLINE exceeds 100,000 vertices.",
        );
      return;
    case "circle":
      if (current.geometry.type !== "circle")
        throw new Error("Native DWG projected CIRCLE kind is immutable.");
      return;
    case "arc":
      if (current.geometry.type !== "arc")
        throw new Error("Native DWG projected ARC kind is immutable.");
      if (current.geometry.sweepAngleDegrees < 0)
        throw new Error("Native DWG edited ARC sweep must be positive.");
      return;
    case "text":
      if (current.geometry.type !== "text")
        throw new Error("Native DWG projected TEXT kind is immutable.");
      if (current.geometry.width !== baseline.geometry.width)
        throw new Error("Native DWG TEXT display width is immutable.");
      return;
    default:
      if (!isDeepStrictEqual(current.geometry, baseline.geometry))
        throw new Error(
          "Native DWG projected shape geometry change is unsupported.",
        );
  }
}

function compileObjectEdit(
  current: DrawingObject,
  baseline: DrawingObject,
  binding: NativeDrawingDwgBinding,
  millimetersPerUnit: number,
): NativeDrawingDwgSelectedEdit | null {
  if (baseline.geometry.type === "line") {
    if (current.geometry.type !== "line")
      throw new Error("Native DWG projected LINE kind is immutable.");
    const startChanged = !samePoint(
      current.geometry.start,
      baseline.geometry.start,
    );
    const endChanged = !samePoint(current.geometry.end, baseline.geometry.end);
    if (!startChanged && !endChanged) return null;
    const nativeGeometry = rawNativeLineGeometry(binding);
    const start = startChanged
      ? nativePoint(current.geometry.start, millimetersPerUnit)
      : ([...nativeGeometry.start] as NativePoint);
    const end = endChanged
      ? nativePoint(current.geometry.end, millimetersPerUnit)
      : ([...nativeGeometry.end] as NativePoint);
    if (start.every((coordinate, index) => coordinate === end[index]))
      throw new Error("DWG edited LINE must have nonzero length.");
    return { handle: binding.handle, type: "LINE", start, end };
  }

  if (baseline.geometry.type === "polyline") {
    if (current.geometry.type !== "polyline")
      throw new Error("Native DWG projected LWPOLYLINE kind is immutable.");
    if (isDeepStrictEqual(current.geometry, baseline.geometry)) return null;
    const nativeGeometry = rawNativePolylineGeometry(binding);
    const points = current.geometry.points.map((point, index) =>
      baseline.geometry.type === "polyline" &&
      index < baseline.geometry.points.length &&
      samePoint(point, baseline.geometry.points[index])
        ? ([...nativeGeometry.points[index]] as NativePoint)
        : nativePoint(point, millimetersPerUnit),
    );
    if (
      !points.some((point) =>
        point.some((coordinate, index) => coordinate !== points[0][index]),
      )
    )
      throw new Error(
        "DWG edited LWPOLYLINE must contain distinct native points.",
      );
    return {
      handle: binding.handle,
      type: "LWPOLYLINE",
      points,
      closed: current.geometry.closed,
    };
  }

  if (baseline.geometry.type === "circle") {
    if (current.geometry.type !== "circle")
      throw new Error("Native DWG projected CIRCLE kind is immutable.");
    const centerChanged = !samePoint(
      current.geometry.center,
      baseline.geometry.center,
    );
    const radiusChanged = current.geometry.radius !== baseline.geometry.radius;
    if (!centerChanged && !radiusChanged) return null;
    const nativeGeometry = rawNativeCircleGeometry(binding);
    return {
      handle: binding.handle,
      type: "CIRCLE",
      center: centerChanged
        ? nativePoint(current.geometry.center, millimetersPerUnit)
        : ([...nativeGeometry.center] as NativePoint),
      radius: radiusChanged
        ? nativeSize(current.geometry.radius, millimetersPerUnit)
        : nativeGeometry.radius,
    };
  }

  if (baseline.geometry.type === "arc") {
    if (current.geometry.type !== "arc")
      throw new Error("Native DWG projected ARC kind is immutable.");
    const centerChanged = !samePoint(
      current.geometry.center,
      baseline.geometry.center,
    );
    const radiusChanged = current.geometry.radius !== baseline.geometry.radius;
    const anglesChanged =
      current.geometry.startAngleDegrees !==
        baseline.geometry.startAngleDegrees ||
      current.geometry.sweepAngleDegrees !==
        baseline.geometry.sweepAngleDegrees;
    if (!centerChanged && !radiusChanged && !anglesChanged) return null;
    const nativeGeometry = rawNativeArcGeometry(binding);
    const startAngleRadians = anglesChanged
      ? (current.geometry.startAngleDegrees * Math.PI) / 180
      : nativeGeometry.startAngleRadians;
    let endAngleRadians = nativeGeometry.endAngleRadians;
    if (anglesChanged) {
      const sweep = (current.geometry.sweepAngleDegrees * Math.PI) / 180;
      endAngleRadians = startAngleRadians + sweep;
      if (endAngleRadians - startAngleRadians > Math.PI * 2) {
        // Move only the rounded end one representable double down. Keep the
        // strict one-turn bound and the unnormalized end (including full turns).
        const bits = new DataView(new ArrayBuffer(8));
        bits.setFloat64(0, endAngleRadians);
        bits.setBigUint64(
          0,
          bits.getBigUint64(0) + (endAngleRadians > 0 ? -1n : 1n),
        );
        endAngleRadians = bits.getFloat64(0);
      }
      const representedSweep = endAngleRadians - startAngleRadians;
      if (
        representedSweep <= 0 ||
        representedSweep > Math.PI * 2 ||
        Math.abs(representedSweep - sweep) > 1e-9
      )
        throw new Error("DWG edited ARC sweep cannot retain native precision.");
    }
    return {
      handle: binding.handle,
      type: "ARC",
      center: centerChanged
        ? nativePoint(current.geometry.center, millimetersPerUnit)
        : ([...nativeGeometry.center] as NativePoint),
      radius: radiusChanged
        ? nativeSize(current.geometry.radius, millimetersPerUnit)
        : nativeGeometry.radius,
      startAngleRadians,
      endAngleRadians,
    };
  }

  if (baseline.geometry.type === "text") {
    if (current.geometry.type !== "text")
      throw new Error("Native DWG projected TEXT kind is immutable.");
    const insertChanged = !samePoint(
      current.geometry.origin,
      baseline.geometry.origin,
    );
    const height = current.style.fontSize;
    const baselineHeight = baseline.style.fontSize;
    if (height === undefined || baselineHeight === undefined)
      throw new Error("Native DWG TEXT height binding is inconsistent.");
    const heightChanged = height !== baselineHeight;
    if (
      !insertChanged &&
      !heightChanged &&
      current.geometry.text === baseline.geometry.text
    )
      return null;
    const nativeGeometry = rawNativeTextGeometry(binding);
    assertSelectedDwgPlainText(current.geometry.text);
    return {
      handle: binding.handle,
      type: "TEXT",
      insert: insertChanged
        ? nativePoint(current.geometry.origin, millimetersPerUnit)
        : ([...nativeGeometry.insert] as NativePoint),
      height: heightChanged
        ? nativeSize(height, millimetersPerUnit)
        : nativeGeometry.height,
      text: current.geometry.text,
    };
  }

  return null;
}

function compareNativeHandles(
  left: NativeDrawingDwgSelectedEdit,
  right: NativeDrawingDwgSelectedEdit,
) {
  const leftHandle = BigInt(`0x${left.handle}`);
  const rightHandle = BigInt(`0x${right.handle}`);
  return leftHandle < rightHandle ? -1 : leftHandle > rightHandle ? 1 : 0;
}

export function buildNativeDrawingDwgSelectedEdits(input: {
  importInput: ImportInput;
  objects: unknown;
}): NativeDrawingDwgSelectedEditsResult {
  const projected = projectNativeDrawingDwgImport(input.importInput);
  const objects = z
    .array(DrawingObjectSchema)
    .max(MAXIMUM_EDIT_COUNT)
    .parse(input.objects);
  const baselineById = new Map(
    projected.objects.map((object) => [object.id, object]),
  );
  const editedById = new Map<string, DrawingObject>();

  for (const object of objects) {
    if (editedById.has(object.id))
      throw new Error("Native DWG edited object identity is duplicated.");
    if (!baselineById.has(object.id))
      throw new Error(
        "Native DWG edited object identity is not in the projected set.",
      );
    editedById.set(object.id, object);
  }
  if (editedById.size !== baselineById.size)
    throw new Error("Native DWG edited object set is incomplete.");

  for (const baseline of projected.objects) {
    const current = editedById.get(baseline.id)!;
    validateObjectEnvelope(current, baseline);
    validatePermittedGeometry(current, baseline);
  }

  const bindingByObjectId = new Map(
    projected.bindings.map((binding) => [binding.objectId, binding]),
  );
  const edits: NativeDrawingDwgSelectedEdit[] = [];
  let polylineVertices = 0;
  for (const baseline of projected.objects) {
    const binding = bindingByObjectId.get(baseline.id);
    if (!binding)
      throw new Error("Native DWG projected object binding is missing.");
    const edit = compileObjectEdit(
      editedById.get(baseline.id)!,
      baseline,
      binding,
      projected.units.millimetersPerUnit,
    );
    if (edit) {
      if (edit.type === "LWPOLYLINE") {
        polylineVertices += edit.points.length;
        if (polylineVertices > MAXIMUM_POLYLINE_VERTICES)
          throw new Error(
            "Native DWG edits exceed 100,000 aggregate polyline vertices.",
          );
      }
      assertProjectedBounds(editedById.get(baseline.id)!.geometry);
      edits.push(edit);
    }
  }

  if (edits.length === 0)
    return {
      request: null,
      qualification: "experimental-unqualified",
      persistenceAuthority: "not-issued",
    };

  edits.sort(compareNativeHandles);
  const request: NativeDrawingDwgSelectedEditsRequest = {
    schemaVersion: "1hk-dwg-edits/2",
    sourceSha256: projected.source.sha256,
    coordinateSystem: "WCS_NATIVE_UNITS",
    edits,
  };
  if (
    new TextEncoder().encode(JSON.stringify(request)).byteLength >
    MAXIMUM_REQUEST_BYTES
  )
    throw new Error("Native DWG edit request exceeds 2 MiB.");

  // Internal preview only: use the real projector's native geometry, unit and
  // TEXT width rules. This constructed report is never source evidence.
  const sourceReport = NativeDrawingDwgImportReportSchema.parse(
    input.importInput.report,
  );
  const editsByHandle = new Map(edits.map((edit) => [edit.handle, edit]));
  projectNativeDrawingDwgImport({
    ...input.importInput,
    report: {
      ...sourceReport,
      entities: sourceReport.entities.map((entity) => {
        const edit = editsByHandle.get(entity.handle);
        if (!edit) return entity;
        const { handle: _handle, type: _type, ...geometry } = edit;
        return { ...entity, geometry };
      }),
    },
  });
  return {
    request,
    qualification: "experimental-unqualified",
    persistenceAuthority: "not-issued",
  };
}
