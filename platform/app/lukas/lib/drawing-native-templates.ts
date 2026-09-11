import {
  getNativeDrawingSymbol,
  type NativeAssetProvenance,
} from "./drawing-native-symbols.ts";
import {
  validateDrawingStructureState,
  type DrawingStructureState,
} from "./drawing-structure.ts";
import { resolveDrawingOpening } from "./drawing-semantic-geometry.ts";
import {
  DrawingBlockInstanceSchema,
  DrawingBlockSchema,
  DrawingCanvasSchema,
  DrawingObjectSchema,
  DrawingPageSchema,
  DrawingPropertySchemaSchema,
  DrawingPropertyValueSchema,
  DrawingStructureLayerSchema,
  DrawingStyleDefinitionSchema,
  DrawingTableSchema,
  type DrawingBlock,
  type DrawingBlockInstance,
  type DrawingGeometry,
  type DrawingObject,
  type DrawingStructureLayer,
} from "./drawing-workspace.types.ts";

export type NativeDrawingTemplateKey =
  | "measured-plan"
  | "office-layout"
  | "remodel-phases"
  | "finishes-takeoff";

export type NativeDrawingTemplate = {
  schemaVersion: "1hk-native-template/1";
  key: NativeDrawingTemplateKey;
  version: 1;
  name: string;
  description: string;
  units: "mm";
  provenance: NativeAssetProvenance;
  outputProfile: {
    paper: "A3";
    orientation: "landscape";
    widthMillimeters: 420;
    heightMillimeters: 297;
    scaleDenominator: 50;
  };
  structure: DrawingStructureState;
};

const templateKeys = [
  "measured-plan",
  "office-layout",
  "remodel-phases",
  "finishes-takeoff",
] as const;

const assumption = "예제·가정값 — 현장 확인 필요";
const provenance: NativeAssetProvenance = {
  author: "1HK",
  sourcePath: "platform/app/lukas/lib/drawing-native-templates.ts",
  attribution: "1HK가 독립 제작한 편집 가능한 예제 도면",
  license: "NOASSERTION",
  origin: "first-party-generated",
};
const outputProfile = {
  paper: "A3",
  orientation: "landscape",
  widthMillimeters: 420,
  heightMillimeters: 297,
  scaleDenominator: 50,
} as const;

type Draft = {
  structure: DrawingStructureState;
  canvasId: string;
  workLayerId: string;
  lineStyleId: string;
  annotationStyleId: string;
  id: () => string;
};

function makeIdFactory(templateOrdinal: number) {
  let sequence = 0;
  return () =>
    `${templateOrdinal}0000000-0000-4000-8${templateOrdinal}00-${String(++sequence).padStart(12, "0")}`;
}

function createDraft(templateOrdinal: number, name: string): Draft {
  const id = makeIdFactory(templateOrdinal);
  const revisionId = id();
  const pageId = id();
  const canvasId = id();
  const workLayerId = id();
  const lineStyleId = id();
  const annotationStyleId = id();
  return {
    id,
    canvasId,
    workLayerId,
    lineStyleId,
    annotationStyleId,
    structure: {
      revisionId,
      pages: {
        [pageId]: {
          id: pageId,
          revisionId,
          name,
          sortOrder: 0,
          version: 1,
        },
      },
      canvases: {
        [canvasId]: {
          id: canvasId,
          pageId,
          name: "A3 1:50 작업 캔버스",
          spaceKind: "paper",
          widthMillimeters: 21_000,
          heightMillimeters: 14_850,
          background: null,
          sortOrder: 0,
          version: 1,
        },
      },
      layers: {
        [workLayerId]: {
          id: workLayerId,
          canvasId,
          name: "작업",
          visible: true,
          locked: false,
          systemKind: "work",
          sortOrder: 0,
          version: 1,
        },
      },
      objects: {},
      sources: {},
      styles: {
        [lineStyleId]: {
          id: lineStyleId,
          revisionId,
          name: "기본 선",
          value: {
            stroke: "#27313a",
            strokeWidth: 25,
            fill: null,
            fontSize: 140,
          },
          version: 1,
        },
        [annotationStyleId]: {
          id: annotationStyleId,
          revisionId,
          name: "치수와 주석",
          value: {
            stroke: "#285c88",
            strokeWidth: 18,
            fill: null,
            fontSize: 140,
          },
          version: 1,
        },
      },
      blocks: {},
      blockInstances: {},
      propertySchemas: {},
      propertyValues: {},
      tables: {},
    },
  };
}

function addLayer(draft: Draft, name: string, sortOrder: number) {
  const id = draft.id();
  const layer: DrawingStructureLayer = {
    id,
    canvasId: draft.canvasId,
    name,
    visible: true,
    locked: false,
    systemKind: "custom",
    sortOrder,
    version: 1,
  };
  draft.structure.layers[id] = layer;
  return id;
}

function addLineStyle(draft: Draft, name: string, stroke: string) {
  const id = draft.id();
  draft.structure.styles[id] = {
    id,
    revisionId: draft.structure.revisionId,
    name,
    value: { stroke, strokeWidth: 25, fill: null, fontSize: 140 },
    version: 1,
  };
  return id;
}

function addObject(
  draft: Draft,
  name: string,
  layerId: string,
  geometry: DrawingGeometry,
  styleId = draft.lineStyleId,
  style: DrawingObject["style"] = {},
) {
  const id = draft.id();
  draft.structure.objects[id] = {
    id,
    name,
    layerId,
    geometry,
    styleId,
    style,
    version: 1,
  };
  return id;
}

function addDimension(
  draft: Draft,
  layerId: string,
  name: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  offset: number,
) {
  return addObject(
    draft,
    name,
    layerId,
    { type: "dimension", start, end, offset, calibrationId: null },
    draft.annotationStyleId,
  );
}

function addSymbolBlock(draft: Draft, symbolKey: string) {
  const symbol = getNativeDrawingSymbol(symbolKey);
  const id = draft.id();
  const block: DrawingBlock = {
    id,
    revisionId: draft.structure.revisionId,
    name: symbol.name,
    primitives: symbol.primitives,
    version: 1,
  };
  draft.structure.blocks[id] = block;
  return id;
}

function addBlockInstance(
  draft: Draft,
  blockId: string,
  layerId: string,
  name: string,
  x: number,
  y: number,
  rotation = 0,
) {
  const id = draft.id();
  const instance: DrawingBlockInstance = {
    id,
    lineageId: draft.id(),
    blockId,
    layerId,
    name,
    origin: { x, y },
    rotation,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  };
  draft.structure.blockInstances[id] = instance;
  return id;
}

function addDoorSymbolForOpening(
  draft: Draft,
  openingId: string,
  layerId: string,
  name: string,
) {
  const opening = draft.structure.objects[openingId];
  if (opening.geometry.type !== "opening")
    throw new Error("Native door symbol requires an opening object.");
  const resolved = resolveDrawingOpening(
    opening.geometry,
    draft.structure.objects,
  );
  const doorBlockId = addSymbolBlock(draft, "door-single-900");
  return addBlockInstance(
    draft,
    doorBlockId,
    layerId,
    name,
    resolved.start.x,
    resolved.start.y,
    resolved.wallAngleDegrees,
  );
}

function attachExampleSchedule(
  draft: Draft,
  objectId: string,
  objectKind: DrawingGeometry["type"],
  quantity: number,
  unit: string,
  tableName: string,
) {
  const schemaId = draft.id();
  const propertyValueId = draft.id();
  const tableId = draft.id();
  const objectNameColumnId = draft.id();
  const assumptionColumnId = draft.id();
  const quantityColumnId = draft.id();
  const unitColumnId = draft.id();
  const noteColumnId = draft.id();
  const rowId = draft.id();
  draft.structure.propertySchemas[schemaId] = {
    id: schemaId,
    revisionId: draft.structure.revisionId,
    name: "예제 상태",
    valueType: "text",
    enumOptions: [],
    appliesTo: [objectKind],
    required: true,
    version: 1,
  };
  draft.structure.propertyValues[propertyValueId] = {
    id: propertyValueId,
    schemaId,
    objectId,
    blockInstanceId: null,
    value: assumption,
    version: 1,
  };
  draft.structure.tables[tableId] = {
    id: tableId,
    revisionId: draft.structure.revisionId,
    name: tableName,
    columns: [
      {
        id: objectNameColumnId,
        name: "대상",
        kind: "object_name",
        propertySchemaId: null,
      },
      {
        id: assumptionColumnId,
        name: "상태",
        kind: "property",
        propertySchemaId: schemaId,
      },
      {
        id: quantityColumnId,
        name: "예제 수량",
        kind: "number",
        propertySchemaId: null,
      },
      {
        id: unitColumnId,
        name: "단위",
        kind: "text",
        propertySchemaId: null,
      },
      {
        id: noteColumnId,
        name: "주의",
        kind: "text",
        propertySchemaId: null,
      },
    ],
    rows: [
      {
        id: rowId,
        objectId,
        blockInstanceId: null,
        cells: {
          [quantityColumnId]: quantity,
          [unitColumnId]: unit,
          [noteColumnId]: assumption,
        },
      },
    ],
    version: 1,
  };
}

function addWall(
  draft: Draft,
  name: string,
  layerId: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
  styleId = draft.lineStyleId,
) {
  return addObject(
    draft,
    name,
    layerId,
    {
      type: "wall",
      semanticVersion: 1,
      start,
      end,
      thicknessMillimeters: 150,
      heightMillimeters: 2_700,
    },
    styleId,
  );
}

function measuredPlan(): NativeDrawingTemplate {
  const draft = createDraft(1, "치수 평면 예제");
  const annotations = addLayer(draft, "치수", 1);
  const x = 2_500;
  const y = 3_000;
  const width = 6_000;
  const height = 4_000;
  const southWallId = addWall(
    draft,
    "남측 벽",
    draft.workLayerId,
    { x, y },
    { x: x + width, y },
  );
  addWall(
    draft,
    "동측 벽",
    draft.workLayerId,
    { x: x + width, y },
    {
      x: x + width,
      y: y + height,
    },
  );
  addWall(
    draft,
    "북측 벽",
    draft.workLayerId,
    { x: x + width, y: y + height },
    { x, y: y + height },
  );
  addWall(draft, "서측 벽", draft.workLayerId, { x, y: y + height }, { x, y });
  const openingId = addObject(draft, "출입문 개구부", draft.workLayerId, {
    type: "opening",
    semanticVersion: 1,
    hostWallId: southWallId,
    offsetMillimeters: 2_300,
    widthMillimeters: 900,
    heightMillimeters: 2_100,
    sillHeightMillimeters: 0,
    openingKind: "door",
  });
  const roomId = addObject(
    draft,
    "예제실 24㎡",
    draft.workLayerId,
    {
      type: "space",
      semanticVersion: 1,
      boundary: [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ],
      number: "E-01",
      finishes: { floor: "예제 마감", wall: "예제 마감", ceiling: "예제 마감" },
    },
    draft.lineStyleId,
    { fill: "#f4f7fa" },
  );
  addDimension(
    draft,
    annotations,
    "가로 6000 예제 치수",
    { x, y },
    { x: x + width, y },
    -600,
  );
  addDimension(
    draft,
    annotations,
    "세로 4000 예제 치수",
    { x, y },
    { x, y: y + height },
    -600,
  );
  addDoorSymbolForOpening(
    draft,
    openingId,
    draft.workLayerId,
    "900 문 여닫이 도식",
  );
  attachExampleSchedule(draft, roomId, "space", 24, "m²", "예제 면적표");
  return finishTemplate(
    "measured-plan",
    "치수 평면 예제",
    "가정한 6000×4000 mm 공간과 호스트 벽 개구부를 편집하는 예제",
    draft,
  );
}

function officeLayout(): NativeDrawingTemplate {
  const draft = createDraft(2, "사무실 배치 예제");
  const furnitureLayer = addLayer(draft, "가구", 1);
  const annotations = addLayer(draft, "치수", 2);
  const x = 2_000;
  const y = 2_500;
  const width = 10_000;
  const height = 6_000;
  const roomId = addObject(
    draft,
    "사무실 예제 공간",
    draft.workLayerId,
    {
      type: "space",
      semanticVersion: 1,
      boundary: [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ],
      number: "O-01",
      finishes: { floor: "예제", wall: "예제", ceiling: "예제" },
    },
    draft.lineStyleId,
    { fill: "#f7f7f2" },
  );
  addDimension(
    draft,
    annotations,
    "사무실 폭 예제 치수",
    { x, y },
    { x: x + width, y },
    -650,
  );
  const deskBlockId = addSymbolBlock(draft, "furniture-desk-1200x600");
  [
    [3_000, 3_500],
    [5_000, 3_500],
    [3_000, 5_000],
    [5_000, 5_000],
  ].forEach(([deskX, deskY], index) =>
    addBlockInstance(
      draft,
      deskBlockId,
      furnitureLayer,
      `업무 책상 ${index + 1}`,
      deskX,
      deskY,
    ),
  );
  const meetingBlockId = addSymbolBlock(
    draft,
    "furniture-meeting-table-4-seat-1800x900",
  );
  addBlockInstance(
    draft,
    meetingBlockId,
    furnitureLayer,
    "4인 회의 테이블",
    8_000,
    4_500,
  );
  attachExampleSchedule(draft, roomId, "space", 5, "배치", "예제 가구 배치표");
  return finishTemplate(
    "office-layout",
    "사무실 배치 예제",
    "책상 네 개와 4인 회의 테이블을 포함한 편집 가능한 배치 예제",
    draft,
  );
}

function remodelPhases(): NativeDrawingTemplate {
  const draft = createDraft(3, "리모델링 단계 예제");
  draft.structure.layers[draft.workLayerId].name = "공사 범위";
  const existingLayer = addLayer(draft, "기존", 1);
  const demolitionLayer = addLayer(draft, "철거", 2);
  const newLayer = addLayer(draft, "신설", 3);
  const annotations = addLayer(draft, "치수", 4);
  const demolitionStyleId = addLineStyle(draft, "철거선", "#c2413b");
  const newStyleId = addLineStyle(draft, "신설선", "#1769aa");
  addWall(
    draft,
    "존치 벽",
    existingLayer,
    { x: 2_500, y: 3_000 },
    { x: 10_500, y: 3_000 },
  );
  addWall(
    draft,
    "철거 벽",
    demolitionLayer,
    { x: 6_000, y: 3_000 },
    { x: 6_000, y: 7_500 },
    demolitionStyleId,
  );
  const newWallId = addWall(
    draft,
    "신설 벽",
    newLayer,
    { x: 7_500, y: 3_000 },
    { x: 7_500, y: 7_500 },
    newStyleId,
  );
  const phaseAreaId = addObject(
    draft,
    "공사 범위 예제",
    draft.workLayerId,
    {
      type: "area",
      semanticVersion: 1,
      boundary: [
        { x: 2_500, y: 3_000 },
        { x: 10_500, y: 3_000 },
        { x: 10_500, y: 7_500 },
        { x: 2_500, y: 7_500 },
      ],
    },
    draft.lineStyleId,
    { fill: "#eef7ed" },
  );
  addDimension(
    draft,
    annotations,
    "공사 범위 폭 예제 치수",
    { x: 2_500, y: 3_000 },
    { x: 10_500, y: 3_000 },
    -650,
  );
  const openingId = addObject(draft, "신설 벽 출입문", newLayer, {
    type: "opening",
    semanticVersion: 1,
    hostWallId: newWallId,
    offsetMillimeters: 2_450,
    widthMillimeters: 900,
    heightMillimeters: 2_100,
    sillHeightMillimeters: 0,
    openingKind: "door",
  });
  addDoorSymbolForOpening(draft, openingId, newLayer, "신설 문 도식");
  attachExampleSchedule(
    draft,
    phaseAreaId,
    "area",
    3,
    "단계",
    "예제 공사 구분표",
  );
  return finishTemplate(
    "remodel-phases",
    "리모델링 단계 예제",
    "기존·철거·신설 레이어를 분리한 공사 구분 예제",
    draft,
  );
}

function finishesTakeoff(): NativeDrawingTemplate {
  const draft = createDraft(4, "마감 수량 예제");
  const annotations = addLayer(draft, "치수", 1);
  const furnitureLayer = addLayer(draft, "참고 가구", 2);
  const x = 3_000;
  const y = 3_000;
  const width = 6_000;
  const height = 4_000;
  const areaId = addObject(
    draft,
    "바닥 마감 예제 영역 24㎡",
    draft.workLayerId,
    {
      type: "area",
      semanticVersion: 1,
      boundary: [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ],
    },
    draft.lineStyleId,
    { fill: "#f5efe2" },
  );
  addDimension(
    draft,
    annotations,
    "마감 폭 예제 치수",
    { x, y },
    { x: x + width, y },
    -600,
  );
  const deskBlockId = addSymbolBlock(draft, "furniture-desk-1200x600");
  addBlockInstance(
    draft,
    deskBlockId,
    furnitureLayer,
    "축척 참고 책상",
    10_500,
    4_000,
  );
  attachExampleSchedule(draft, areaId, "area", 24, "m²", "예제 마감 수량표");
  return finishTemplate(
    "finishes-takeoff",
    "마감 수량 예제",
    "24㎡ 바닥 영역과 객체 연결 예제 수량표를 포함한 도면",
    draft,
  );
}

function finishTemplate(
  key: NativeDrawingTemplateKey,
  name: string,
  description: string,
  draft: Draft,
): NativeDrawingTemplate {
  addObject(
    draft,
    "예제 안내",
    draft.workLayerId,
    {
      type: "text",
      origin: { x: 1_500, y: 900 },
      width: 12_000,
      text: `${name}\n${assumption}`,
    },
    draft.annotationStyleId,
  );
  validateEntities(draft.structure);
  validateDrawingStructureState(draft.structure);
  return {
    schemaVersion: "1hk-native-template/1",
    key,
    version: 1,
    name,
    description,
    units: "mm",
    provenance: { ...provenance },
    outputProfile: { ...outputProfile },
    structure: draft.structure,
  };
}

function validateEntities(structure: DrawingStructureState) {
  for (const value of Object.values(structure.pages))
    DrawingPageSchema.parse(value);
  for (const value of Object.values(structure.canvases))
    DrawingCanvasSchema.parse(value);
  for (const value of Object.values(structure.layers))
    DrawingStructureLayerSchema.parse(value);
  for (const value of Object.values(structure.objects))
    DrawingObjectSchema.parse(value);
  for (const value of Object.values(structure.styles))
    DrawingStyleDefinitionSchema.parse(value);
  for (const value of Object.values(structure.blocks))
    DrawingBlockSchema.parse(value);
  for (const value of Object.values(structure.blockInstances))
    DrawingBlockInstanceSchema.parse(value);
  for (const value of Object.values(structure.propertySchemas))
    DrawingPropertySchemaSchema.parse(value);
  for (const value of Object.values(structure.propertyValues))
    DrawingPropertyValueSchema.parse(value);
  for (const value of Object.values(structure.tables))
    DrawingTableSchema.parse(value);
}

export function listNativeDrawingTemplateKeys(): NativeDrawingTemplateKey[] {
  return [...templateKeys];
}

export function buildNativeDrawingTemplate(
  key: NativeDrawingTemplateKey,
): NativeDrawingTemplate {
  switch (key) {
    case "measured-plan":
      return measuredPlan();
    case "office-layout":
      return officeLayout();
    case "remodel-phases":
      return remodelPhases();
    case "finishes-takeoff":
      return finishesTakeoff();
    default:
      throw new Error(`Unknown native drawing template: ${String(key)}`);
  }
}
