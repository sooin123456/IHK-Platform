import type { Route } from "./+types/local-drawing-workspace-preview";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { data } from "react-router";

import DrawingWorkspaceClient from "~/lukas/components/drawing-workspace";
import {
  connectedDrawingWorkspaceRealtimeView,
  createInertDrawingWorkspaceRealtimeAdapter,
  type DrawingWorkspaceRealtimeAdapter,
} from "~/lukas/lib/drawing-workspace-realtime";
import { localWorkspacePreviewTarget } from "~/features/auth/lib/local-workspace-preview.server";
import { validateDrawingStructureState } from "~/lukas/lib/drawing-structure";
import {
  parseDrawingWorkspacePreviousPdfForm,
  parseWorkspaceMutation,
  type DrawingWorkspace,
  type DrawingWorkspaceSourceBundle,
} from "~/lukas/lib/drawing-workspace.server";
import { parseDrawingWorkspaceViewState } from "~/lukas/lib/drawing-workspace-view";
import type {
  DrawingBlock,
  DrawingBlockInstance,
  DrawingCanvas,
  DrawingLayer,
  DrawingObject,
  DrawingObjectSource,
  DrawingPage,
  DrawingPropertySchema,
  DrawingPropertyValue,
  DrawingStyleDefinition,
  DrawingStructureLayer,
  DrawingTable,
} from "~/lukas/lib/drawing-workspace.types";
import { drawingAwarenessColor } from "~/lukas/lib/drawing-awareness";
import { startDrawingWorkspaceStage } from "~/lukas/lib/drawing-runtime";
import type { DrawingObjectQuantityLineageRow } from "~/lukas/lib/drawing-quantity-lineage.server";
import { buildDrawingP4PerformanceFixture } from "~/lukas/lib/drawing-p4-performance";
import {
  DrawingBlockInstanceSchema,
  DrawingBlockSchema,
  DrawingCanvasSchema,
  DrawingObjectSchema,
  DrawingObjectSourceSchema,
  DrawingPageSchema,
  DrawingPropertySchemaSchema,
  DrawingPropertyValueSchema,
  DrawingStructureLayerSchema,
  DrawingStyleDefinitionSchema,
  DrawingTableSchema,
} from "~/lukas/lib/drawing-workspace.types";

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  file: "00000000-0000-4000-8000-000000000002",
  document: "00000000-0000-4000-8000-000000000003",
  revision: "00000000-0000-4000-8000-000000000004",
  user: "00000000-0000-4000-8000-000000000005",
  pagePlan: "00000000-0000-4000-8000-000000000010",
  pageModel: "00000000-0000-4000-8000-000000000011",
  pageDetail: "00000000-0000-4000-8000-000000000012",
  canvasPlanPaper: "00000000-0000-4000-8000-000000000020",
  canvasPlanModel: "00000000-0000-4000-8000-000000000021",
  canvasModelPaper: "00000000-0000-4000-8000-000000000022",
  canvasDetailPaper: "00000000-0000-4000-8000-000000000023",
  layerPlanSource: "00000000-0000-4000-8000-000000000030",
  layerPlanWork: "00000000-0000-4000-8000-000000000031",
  layerPlanNotes: "00000000-0000-4000-8000-000000000032",
  layerPlanModel: "00000000-0000-4000-8000-000000000033",
  layerModelWork: "00000000-0000-4000-8000-000000000034",
  layerDetailWork: "00000000-0000-4000-8000-000000000035",
  styleWall: "00000000-0000-4000-8000-000000000040",
  styleNote: "00000000-0000-4000-8000-000000000041",
  blockDoor: "00000000-0000-4000-8000-000000000050",
  blockWindow: "00000000-0000-4000-8000-000000000051",
  issue: "00000000-0000-4000-8000-000000000060",
  semanticWall: "00000000-0000-4000-8000-000000000100",
  semanticWallConnected: "00000000-0000-4000-8000-000000000108",
  semanticDoor: "00000000-0000-4000-8000-000000000101",
  semanticWindow: "00000000-0000-4000-8000-000000000102",
  semanticSpace: "00000000-0000-4000-8000-000000000103",
  semanticArea: "00000000-0000-4000-8000-000000000104",
  semanticGrid: "00000000-0000-4000-8000-000000000105",
  semanticArc: "00000000-0000-4000-8000-000000000106",
  checkpoint: "00000000-0000-4000-8000-000000000107",
};

const sourceSha256 = "a".repeat(64);
const representativePdfByteSize = 62_602;
const representativePdfSha256 =
  "4dbe58c133a1ce84e1b4da4fce93694ec4f69585bed20e71408a86b7f704e326";
const representativePreviousPdfByteSize = 63_118;
const representativePreviousPdfSha256 =
  "ea75a7e655dee16a460672131424f00112f70467e495f751d77de80e409fc9bc";
const createdAt = "2026-08-25T09:00:00.000Z";
const previewAlternateUserId = "00000000-0000-4000-8000-000000000006";
const previewRealtimeAdapter = createInertDrawingWorkspaceRealtimeAdapter();
const previewIfcFileId = "00000000-0000-4000-8000-0000000000a1";
const previewAlternateIfcFileId = "00000000-0000-4000-8000-0000000000a2";
const previewIfcSha256 =
  "db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d";
const previewIfcUrl =
  "https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/3f6f3640b8317664194911fad63bcd407f7e32ca/examples/example.ifc";
const previewPreviousPdfFileId = "00000000-0000-4000-8000-0000000000b1";
const previewPdfRevisionEdgeId = "00000000-0000-4000-8000-0000000000b2";

export function localP5SourceManifest() {
  return [
    {
      kind: "pdf_current",
      id: ids.file,
      byteSize: representativePdfByteSize,
      sha256: representativePdfSha256,
      signedUrl: "/__p5-current.pdf",
    },
    {
      kind: "pdf_previous",
      id: previewPreviousPdfFileId,
      byteSize: representativePreviousPdfByteSize,
      sha256: representativePreviousPdfSha256,
      signedUrl: "/__p5-previous.pdf",
    },
    {
      kind: "ifc",
      id: previewIfcFileId,
      byteSize: 413_681,
      sha256: previewIfcSha256,
      signedUrl: previewIfcUrl,
    },
  ] as const;
}
function previewCollaborationConnectionFactory(
  testPeers = false,
  onLocalState?: (state: unknown) => void,
  p5IfcTest = false,
) {
  return async ({
    onPhase,
  }: {
    onPhase?: (phase: "connected" | "connecting" | "degraded") => void;
  }) => {
    const listeners = new Set<() => void>();
    const expiresAt = Date.now() + 10_000;
    const peer = (
      id: string,
      displayName: string,
      cursorWorld: { x: number; y: number },
      selectedIds: string[],
      softLocks: Array<{
        entityId: string;
        leaseId: string;
        expiresAt: number;
      }>,
    ) => ({
      user: { id, displayName, color: drawingAwarenessColor(id) },
      pageId: ids.pagePlan,
      canvasId: ids.canvasPlanPaper,
      cursorWorld,
      selectedIds,
      activeTool: "select",
      softLocks,
    });
    const peerOne = "00000000-0000-4000-8000-000000000701";
    const peerTwo = previewAlternateUserId;
    const states = new Map<number, unknown>(
      testPeers
        ? [
            [
              2,
              peer(
                peerOne,
                "김도윤",
                { x: 450, y: 310 },
                p5IfcTest ? [objects[0].id] : [objects[1].id, ids.semanticDoor],
                [
                  {
                    entityId: objects[1].id,
                    leaseId: "00000000-0000-4000-8000-000000000703",
                    expiresAt,
                  },
                  {
                    entityId: ids.semanticDoor,
                    leaseId: "00000000-0000-4000-8000-000000000705",
                    expiresAt,
                  },
                ],
              ),
            ],
            [
              3,
              peer(
                peerTwo,
                "박서연",
                { x: 700, y: 470 },
                [blockInstances[0].id],
                [
                  {
                    entityId: blockInstances[0].id,
                    leaseId: "00000000-0000-4000-8000-000000000704",
                    expiresAt,
                  },
                ],
              ),
            ],
          ]
        : [],
    );
    onPhase?.("connected");
    return {
      phase: "connected" as const,
      flush() {},
      async refreshToken() {},
      awareness: {
        clientId: 1,
        getStates: () => states,
        setLocalState(state: unknown) {
          if (state === null) states.delete(1);
          else states.set(1, state);
          onLocalState?.(state);
          for (const listener of listeners) listener();
        },
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      dispose() {
        listeners.clear();
        onPhase?.("degraded");
      },
    };
  };
}

type PreviewRealtimeAdapter = DrawingWorkspaceRealtimeAdapter & {
  emit(): void;
  readonly subscribed: boolean;
  ready: Promise<void>;
};

function createPreviewRealtimeAdapter(): PreviewRealtimeAdapter {
  let emit: (() => void) | null = null;
  let subscribed = false;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  return {
    ready,
    get subscribed() {
      return subscribed;
    },
    emit() {
      emit?.();
    },
    initialView: connectedDrawingWorkspaceRealtimeView(),
    subscribe({ onEvent, onStatus }) {
      emit = onEvent;
      subscribed = true;
      onStatus("SUBSCRIBED");
      resolveReady();
      return () => {
        if (emit === onEvent) emit = null;
        subscribed = false;
      };
    },
  };
}

const styleWall: DrawingStyleDefinition = {
  id: ids.styleWall,
  revisionId: ids.revision,
  name: "벽체",
  value: { stroke: "#0f172a", strokeWidth: 1.5, fill: null },
  version: 1,
};
const styleNote: DrawingStyleDefinition = {
  id: ids.styleNote,
  revisionId: ids.revision,
  name: "검토 주석",
  value: { stroke: "#ef4444", strokeWidth: 1, fill: "#fee2e2", fontSize: 14 },
  version: 1,
};

const pages: DrawingPage[] = [
  {
    id: ids.pagePlan,
    revisionId: ids.revision,
    name: "A-101 평면도",
    sortOrder: 0,
    version: 1,
  },
  {
    id: ids.pageModel,
    revisionId: ids.revision,
    name: "M-201 모델 검토",
    sortOrder: 1,
    version: 1,
  },
  {
    id: ids.pageDetail,
    revisionId: ids.revision,
    name: "A-501 상세도",
    sortOrder: 2,
    version: 1,
  },
];
const canvases: DrawingCanvas[] = [
  {
    id: ids.canvasPlanPaper,
    pageId: ids.pagePlan,
    name: "평면 용지",
    spaceKind: "paper",
    widthMillimeters: 1189,
    heightMillimeters: 841,
    background: null,
    sortOrder: 0,
    version: 1,
  },
  {
    id: ids.canvasPlanModel,
    pageId: ids.pagePlan,
    name: "1층 모델",
    spaceKind: "model",
    widthMillimeters: 24000,
    heightMillimeters: 18000,
    background: null,
    sortOrder: 1,
    version: 1,
  },
  {
    id: ids.canvasModelPaper,
    pageId: ids.pageModel,
    name: "모델 시트",
    spaceKind: "paper",
    widthMillimeters: 1189,
    heightMillimeters: 841,
    background: null,
    sortOrder: 0,
    version: 1,
  },
  {
    id: ids.canvasDetailPaper,
    pageId: ids.pageDetail,
    name: "상세 용지",
    spaceKind: "paper",
    widthMillimeters: 841,
    heightMillimeters: 594,
    background: null,
    sortOrder: 0,
    version: 1,
  },
];
const layers: DrawingLayer[] = [
  {
    id: ids.layerPlanSource,
    name: "원본 기준선",
    canvasId: ids.canvasPlanPaper,
    sortOrder: 0,
    visible: true,
    locked: true,
    systemKind: "source",
    version: 1,
  },
  {
    id: ids.layerPlanWork,
    name: "건축 작업",
    canvasId: ids.canvasPlanPaper,
    sortOrder: 1,
    visible: true,
    locked: false,
    systemKind: "work",
    version: 1,
  },
  {
    id: ids.layerPlanNotes,
    name: "검토 주석",
    canvasId: ids.canvasPlanPaper,
    sortOrder: 2,
    visible: true,
    locked: false,
    systemKind: "custom",
    version: 1,
  },
  {
    id: ids.layerPlanModel,
    name: "모델 기준",
    canvasId: ids.canvasPlanModel,
    sortOrder: 0,
    visible: true,
    locked: false,
    systemKind: "work",
    version: 1,
  },
  {
    id: ids.layerModelWork,
    name: "모델 마크업",
    canvasId: ids.canvasModelPaper,
    sortOrder: 0,
    visible: true,
    locked: false,
    systemKind: "work",
    version: 1,
  },
  {
    id: ids.layerDetailWork,
    name: "상세 작업",
    canvasId: ids.canvasDetailPaper,
    sortOrder: 0,
    visible: true,
    locked: false,
    systemKind: "work",
    version: 1,
  },
];
const objects: DrawingObject[] = [
  {
    id: "00000000-0000-4000-8000-000000000070",
    name: "외벽",
    layerId: ids.layerPlanWork,
    geometry: {
      type: "line",
      start: { x: 140, y: 140 },
      end: { x: 880, y: 140 },
    },
    styleId: ids.styleWall,
    style: {},
    version: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000071",
    name: "코어",
    layerId: ids.layerPlanWork,
    geometry: {
      type: "rectangle",
      origin: { x: 360, y: 250 },
      width: 180,
      height: 120,
      rotation: 0,
    },
    styleId: ids.styleWall,
    style: { fill: "#e2e8f0" },
    version: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000072",
    name: "동선",
    layerId: ids.layerPlanWork,
    geometry: {
      type: "polyline",
      points: [
        { x: 180, y: 500 },
        { x: 430, y: 420 },
        { x: 720, y: 510 },
      ],
      closed: false,
    },
    styleId: null,
    style: { stroke: "#2563eb", strokeWidth: 2, fill: null },
    version: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000073",
    name: "검토 구역",
    layerId: ids.layerPlanNotes,
    geometry: { type: "circle", center: { x: 690, y: 280 }, radius: 54 },
    styleId: ids.styleNote,
    style: { fill: "#fef2f2" },
    version: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000074",
    name: "창호 간섭 확인",
    layerId: ids.layerPlanNotes,
    geometry: {
      type: "text",
      origin: { x: 580, y: 230 },
      width: 220,
      text: "창호 간섭 확인",
    },
    styleId: ids.styleNote,
    style: { fontSize: 16 },
    version: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000075",
    name: "복도 폭",
    layerId: ids.layerPlanNotes,
    geometry: {
      type: "dimension",
      start: { x: 240, y: 630 },
      end: { x: 640, y: 630 },
      offset: 24,
      calibrationId: null,
    },
    styleId: ids.styleNote,
    style: {},
    version: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000076",
    name: "모델 그리드",
    layerId: ids.layerPlanModel,
    geometry: { type: "line", start: { x: 0, y: 0 }, end: { x: 12000, y: 0 } },
    styleId: null,
    style: { stroke: "#64748b", strokeWidth: 1, fill: null },
    version: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000077",
    name: "상세 단면",
    layerId: ids.layerDetailWork,
    geometry: {
      type: "polyline",
      points: [
        { x: 100, y: 300 },
        { x: 300, y: 120 },
        { x: 540, y: 300 },
      ],
      closed: true,
    },
    styleId: ids.styleWall,
    style: {},
    version: 1,
  },
  {
    id: ids.semanticWall,
    name: "회의실 외벽",
    layerId: ids.layerPlanWork,
    geometry: {
      type: "wall",
      semanticVersion: 1,
      start: { x: 120, y: 720 },
      end: { x: 900, y: 720 },
      thicknessMillimeters: 18,
      heightMillimeters: 3000,
    },
    styleId: ids.styleWall,
    style: {},
    version: 1,
  },
  {
    id: ids.semanticWallConnected,
    name: "회의실 동측벽",
    layerId: ids.layerPlanWork,
    geometry: {
      type: "wall",
      semanticVersion: 1,
      start: { x: 900, y: 720 },
      end: { x: 900, y: 520 },
      thicknessMillimeters: 18,
      heightMillimeters: 3000,
    },
    styleId: ids.styleWall,
    style: {},
    version: 1,
  },
  {
    id: ids.semanticDoor,
    name: "D-101",
    layerId: ids.layerPlanWork,
    geometry: {
      type: "opening",
      semanticVersion: 1,
      openingKind: "door",
      hostWallId: ids.semanticWall,
      offsetMillimeters: 230,
      widthMillimeters: 90,
      heightMillimeters: 2100,
      sillHeightMillimeters: 0,
    },
    styleId: ids.styleWall,
    style: {},
    version: 1,
  },
  {
    id: ids.semanticWindow,
    name: "W-101",
    layerId: ids.layerPlanWork,
    geometry: {
      type: "opening",
      semanticVersion: 1,
      openingKind: "window",
      hostWallId: ids.semanticWall,
      offsetMillimeters: 570,
      widthMillimeters: 140,
      heightMillimeters: 1200,
      sillHeightMillimeters: 900,
    },
    styleId: ids.styleWall,
    style: {},
    version: 1,
  },
  {
    id: ids.semanticSpace,
    name: "회의실",
    layerId: ids.layerPlanWork,
    geometry: {
      type: "space",
      semanticVersion: 1,
      number: "101",
      finishes: { floor: "카펫 타일", wall: "도장", ceiling: "흡음 텍스" },
      boundary: [
        { x: 140, y: 540 },
        { x: 430, y: 540 },
        { x: 430, y: 680 },
        { x: 140, y: 680 },
      ],
    },
    styleId: null,
    style: { stroke: "#2563eb", strokeWidth: 2, fill: "#dbeafe66" },
    version: 1,
  },
  {
    id: ids.semanticArea,
    name: "외부 포장",
    layerId: ids.layerPlanWork,
    geometry: {
      type: "area",
      semanticVersion: 1,
      boundary: [
        { x: 500, y: 530 },
        { x: 830, y: 530 },
        { x: 830, y: 680 },
        { x: 500, y: 680 },
      ],
    },
    styleId: null,
    style: { stroke: "#ca8a04", strokeWidth: 2, fill: "#fde68a66" },
    version: 1,
  },
  {
    id: ids.semanticGrid,
    name: "A",
    layerId: ids.layerPlanWork,
    geometry: {
      type: "grid",
      semanticVersion: 1,
      start: { x: 100, y: 450 },
      end: { x: 920, y: 450 },
    },
    styleId: null,
    style: { stroke: "#475569", strokeWidth: 1, fill: null },
    version: 1,
  },
  {
    id: ids.semanticArc,
    name: "처마 호",
    layerId: ids.layerPlanWork,
    geometry: {
      type: "arc",
      semanticVersion: 1,
      center: { x: 950, y: 610 },
      radius: 80,
      startAngleDegrees: 90,
      sweepAngleDegrees: 180,
    },
    styleId: null,
    style: { stroke: "#7c3aed", strokeWidth: 2, fill: null },
    version: 1,
  },
];
const blocks: DrawingBlock[] = [
  {
    id: ids.blockDoor,
    revisionId: ids.revision,
    name: "단문 D-01",
    primitives: [
      {
        localId: "door-leaf",
        name: "문짝",
        geometry: { type: "line", start: { x: 0, y: 0 }, end: { x: 90, y: 0 } },
        styleId: ids.styleWall,
        style: {},
      },
      {
        localId: "door-swing",
        name: "열림",
        geometry: {
          type: "polyline",
          points: [
            { x: 0, y: 0 },
            { x: 60, y: 60 },
            { x: 90, y: 0 },
          ],
          closed: false,
        },
        styleId: null,
        style: { stroke: "#475569", strokeWidth: 1, fill: null },
      },
    ],
    version: 1,
  },
  {
    id: ids.blockWindow,
    revisionId: ids.revision,
    name: "창호 W-01",
    primitives: [
      {
        localId: "window-frame",
        name: "창호 프레임",
        geometry: {
          type: "rectangle",
          origin: { x: 0, y: 0 },
          width: 120,
          height: 20,
          rotation: 0,
        },
        styleId: ids.styleWall,
        style: { fill: "#dbeafe" },
      },
    ],
    version: 1,
  },
];
const blockInstances: DrawingBlockInstance[] = [
  {
    id: "00000000-0000-4000-8000-000000000080",
    lineageId: "00000000-0000-4000-8000-000000000081",
    blockId: ids.blockDoor,
    layerId: ids.layerPlanWork,
    name: "D-01 북측",
    origin: { x: 290, y: 140 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000082",
    lineageId: "00000000-0000-4000-8000-000000000083",
    blockId: ids.blockWindow,
    layerId: ids.layerPlanWork,
    name: "W-01 동측",
    origin: { x: 650, y: 140 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  },
  {
    id: "00000000-0000-4000-8000-000000000084",
    lineageId: "00000000-0000-4000-8000-000000000085",
    blockId: ids.blockWindow,
    layerId: ids.layerDetailWork,
    name: "W-01 상세",
    origin: { x: 260, y: 180 },
    rotation: 0,
    scaleX: 1.5,
    scaleY: 1.5,
    version: 1,
  },
];
const propertySchemas: DrawingPropertySchema[] = [
  {
    id: "00000000-0000-4000-8000-000000000090",
    revisionId: ids.revision,
    name: "검토 상태",
    valueType: "enum",
    enumOptions: ["확인 필요", "완료"],
    appliesTo: ["rectangle", "block_instance"],
    required: false,
    version: 1,
  },
];
const propertyValues: DrawingPropertyValue[] = [
  {
    id: "00000000-0000-4000-8000-000000000091",
    schemaId: propertySchemas[0].id,
    objectId: objects[1].id,
    blockInstanceId: null,
    value: "확인 필요",
    version: 1,
  },
];
const tables: DrawingTable[] = [
  {
    id: "00000000-0000-4000-8000-000000000092",
    revisionId: ids.revision,
    name: "창호 점검",
    columns: [
      {
        id: "00000000-0000-4000-8000-000000000093",
        name: "메모",
        kind: "text",
        propertySchemaId: null,
      },
    ],
    rows: [
      {
        id: "00000000-0000-4000-8000-000000000094",
        objectId: null,
        blockInstanceId: blockInstances[1].id,
        cells: { "00000000-0000-4000-8000-000000000093": "현장 치수 확인" },
      },
    ],
    version: 1,
  },
];

type PreviewFixture = {
  workspace: DrawingWorkspace & {
    document: NonNullable<DrawingWorkspace["document"]>;
  };
  capability: "editor";
  currentUserId: string;
  roomUrl: string;
  sourceUrl: null;
  quantityLineage?: {
    rows: DrawingObjectQuantityLineageRow[];
    nextCursor: string | null;
  } | null;
  sourceBundle?: DrawingWorkspaceSourceBundle;
  selectedIfcFileId?: string | null;
  viewMode?: "2d" | "3d" | "split";
};

/** Canonical P2 data kept entirely in process for development-only visual review. */
export function localDrawingWorkspacePreviewFixture(options?: {
  disableDefaultIfc?: boolean;
  hiddenHostTest?: boolean;
  p5IfcTest?: boolean;
  p5Integrated?: boolean;
  p5PdfTest?: boolean;
  p7PerformanceTest?: boolean;
  selectedIfcFileId?: string | null;
  viewMode?: "2d" | "3d" | "split";
  performanceObjects?: DrawingObject[];
}): PreviewFixture {
  const activePdfByteSize = options?.p5Integrated
    ? representativePdfByteSize
    : 1_048_576;
  const activePdfSha256 = options?.p5Integrated
    ? representativePdfSha256
    : sourceSha256;
  const activeIfcByteSize = 413_681;
  const activeIfcSha256 = previewIfcSha256;
  const activeIfcUrl = previewIfcUrl;
  const fixtureObjects = options?.performanceObjects
    ? options.performanceObjects
    : options?.hiddenHostTest
      ? objects.map((object) =>
          object.id === ids.semanticDoor || object.id === ids.semanticWindow
            ? { ...object, layerId: ids.layerPlanNotes }
            : object,
        )
      : objects;
  const fixtureLayers = options?.hiddenHostTest
    ? layers.map((layer) =>
        layer.id === ids.layerPlanWork ? { ...layer, visible: false } : layer,
      )
    : layers;
  const fixtureCanvases =
    options?.p5PdfTest || options?.p5Integrated
      ? canvases.map((canvas) =>
          canvas.id === ids.canvasPlanPaper
            ? {
                ...canvas,
                background: {
                  sourceFileId: ids.file,
                  sourceSha256: activePdfSha256,
                  pdfPageNumber: 1,
                  calibration: null,
                },
              }
            : canvas,
        )
      : canvases;
  const performance = Boolean(options?.performanceObjects);
  const fixturePropertyValues = performance ? [] : propertyValues;
  const fixtureTables = performance ? [] : tables;
  const fixtureSources: DrawingObjectSource[] =
    options?.p5Integrated && options.performanceObjects
      ? fixtureObjects
          .slice(0, options.p7PerformanceTest ? 2 : 2_000)
          .map((object, index) => ({
            id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
            objectId: object.id,
            revisionId: ids.revision,
            sourceFileId: previewIfcFileId,
            sourceSha256: activeIfcSha256,
            sourceKind: "ifc_element" as const,
            ifcGlobalId: `P5${String(index + 1).padStart(20, "0")}`,
            elementId: null,
            camera: null,
            version: 1,
          }))
      : options?.p5IfcTest || options?.p5Integrated
        ? [
            {
              id: "00000000-0000-4000-8000-0000000000a0",
              objectId: objects[0].id,
              revisionId: ids.revision,
              sourceFileId: previewIfcFileId,
              sourceSha256: activeIfcSha256,
              sourceKind: "ifc_element",
              ifcGlobalId: "0VNYAWfXv8JvIRVfOzYH1j",
              elementId: "2863",
              camera: null,
              version: 1,
            },
          ]
        : [];
  const revision = {
    id: ids.revision,
    document_id: ids.document,
    project_id: ids.project,
    parent_revision_id: null,
    sequence: 1,
    status: "draft" as const,
    version: 1,
    created_by: ids.user,
    review_requested_at: null,
    approved_at: null,
    created_at: createdAt,
    updated_at: createdAt,
    activePageId: ids.pagePlan,
    activeCanvasId: ids.canvasPlanPaper,
    pages,
    canvases: fixtureCanvases,
    layers: fixtureLayers,
    objects: fixtureObjects,
    styles: [styleWall, styleNote],
    blocks,
    blockInstances,
    propertySchemas,
    propertyValues: fixturePropertyValues,
    tables: fixtureTables,
    sources: fixtureSources,
    issues: [
      {
        id: ids.issue,
        project_id: ids.project,
        title: "창호 치수 확인",
        priority: "high" as const,
        status: "open" as const,
        updated_at: createdAt,
      },
    ],
    issueLinks: performance
      ? []
      : [
          {
            id: "00000000-0000-4000-8000-000000000095",
            object_id: objects[4].id,
            revision_id: ids.revision,
            issue_id: ids.issue,
            project_id: ids.project,
            created_by: ids.user,
            created_at: createdAt,
          },
        ],
    reviewEvidence: null,
    checkpoints: performance
      ? []
      : [
          {
            id: ids.checkpoint,
            createdAt,
            canonicalJson: {
              operationSequence: 0,
              revision: {
                id: ids.revision,
                documentId: ids.document,
                version: 1,
              },
              pages,
              canvases: fixtureCanvases,
              layers: fixtureLayers,
              objects: fixtureObjects,
              styles: [styleWall, styleNote],
              blocks,
              blockInstances,
              propertySchemas,
              propertyValues: fixturePropertyValues,
              tables: fixtureTables,
            },
          },
        ],
  };
  const primary = {
    id: ids.file,
    kind: "pdf" as const,
    originalFilename: "근린생활시설_A-101.pdf",
    byteSize: activePdfByteSize,
    sha256: activePdfSha256,
  };
  const ifcCatalog = [previewIfcFileId, previewAlternateIfcFileId].map(
    (id, index) => ({
      id,
      kind: "ifc" as const,
      originalFilename: index === 0 ? "example.ifc" : "example-copy.ifc",
      byteSize: activeIfcByteSize,
      sha256: activeIfcSha256,
    }),
  );
  const selectedIfc = options?.disableDefaultIfc
    ? undefined
    : ifcCatalog.find(
        (item) => item.id === (options?.selectedIfcFileId ?? previewIfcFileId),
      );
  const pdfSourceBundle: DrawingWorkspaceSourceBundle = {
    primary: { ...primary, signedUrl: "/__p5-current.pdf" },
    pdf: { ...primary, signedUrl: "/__p5-current.pdf" },
    ifc: null,
    previousPdf: {
      id: previewPreviousPdfFileId,
      kind: "pdf",
      originalFilename: "근린생활시설_A-101-r1.pdf",
      byteSize: options?.p5Integrated
        ? representativePreviousPdfByteSize
        : activePdfByteSize,
      sha256: options?.p5Integrated
        ? representativePreviousPdfSha256
        : "b".repeat(64),
    },
    revisionEdge: {
      id: previewPdfRevisionEdgeId,
      previousFileId: previewPreviousPdfFileId,
      previousSha256: options?.p5Integrated
        ? representativePreviousPdfSha256
        : "b".repeat(64),
      currentFileId: ids.file,
      currentSha256: activePdfSha256,
    },
    catalog: [
      primary,
      {
        id: previewPreviousPdfFileId,
        kind: "pdf",
        originalFilename: "근린생활시설_A-101-r1.pdf",
        byteSize: options?.p5Integrated
          ? representativePreviousPdfByteSize
          : activePdfByteSize,
        sha256: options?.p5Integrated
          ? representativePreviousPdfSha256
          : "b".repeat(64),
      },
      ...ifcCatalog,
    ],
  };
  return {
    capability: "editor",
    currentUserId: ids.user,
    roomUrl: "/workspace-preview",
    quantityLineage: options?.p5Integrated
      ? { rows: [], nextCursor: null }
      : null,
    sourceUrl: null,
    sourceBundle: options?.p5Integrated
      ? {
          ...pdfSourceBundle,
          ifc:
            options.viewMode === "2d" || !selectedIfc
              ? null
              : { ...selectedIfc, signedUrl: activeIfcUrl },
        }
      : options?.p5PdfTest
        ? pdfSourceBundle
        : options?.p5IfcTest && selectedIfc
          ? {
              primary,
              pdf: null,
              ifc:
                options.viewMode === "2d"
                  ? null
                  : { ...selectedIfc, signedUrl: activeIfcUrl },
              previousPdf: null,
              revisionEdge: null,
              catalog: [primary, ...ifcCatalog],
            }
          : undefined,
    selectedIfcFileId: selectedIfc?.id ?? null,
    viewMode: options?.viewMode,
    workspace: {
      file: {
        id: ids.file,
        project_id: ids.project,
        kind: "pdf",
        original_filename: "근린생활시설_A-101.pdf",
        storage_path: "local-preview/rayon-a101.pdf",
        content_type: "application/pdf",
        byte_size: activePdfByteSize,
        sha256: activePdfSha256,
        immutable: true,
        created_at: createdAt,
      },
      templateCandidates: [],
      document: {
        id: ids.document,
        project_id: ids.project,
        source_file_id: ids.file,
        source_sha256: activePdfSha256,
        title: "A-101 도면 작업실",
        created_by: ids.user,
        created_at: createdAt,
        updated_at: createdAt,
        revision,
      },
    },
  } as unknown as PreviewFixture;
}

function validatedRecord<T extends { id: string }>(
  values: unknown[],
  parse: (value: unknown) => T,
) {
  const entries = values.map((value) => {
    const parsed = parse(value);
    return [parsed.id, parsed] as const;
  });
  if (new Set(entries.map(([id]) => id)).size !== entries.length)
    throw new Error("Local preview drawing entities must have unique IDs.");
  return Object.fromEntries(entries) as Record<string, T>;
}

/** Validates the P2 graph on the server before the client hydrates it. */
export function validateLocalDrawingWorkspacePreviewFixture(
  fixture: PreviewFixture,
) {
  const { workspace } = fixture;
  const revision = workspace.document.revision;
  if (workspace.document.source_sha256 !== workspace.file.sha256)
    throw new Error("Local preview source SHA must remain bound to the file.");
  if (revision.parent_revision_id !== null || revision.status !== "draft")
    throw new Error(
      "Local preview must start at its canonical draft revision.",
    );
  if (!revision.activePageId || !revision.activeCanvasId)
    throw new Error("Local preview requires an active page and canvas.");
  return validateDrawingStructureState({
    revisionId: revision.id,
    pages: validatedRecord(revision.pages, (value) =>
      DrawingPageSchema.parse(value),
    ),
    canvases: validatedRecord(revision.canvases ?? [], (value) =>
      DrawingCanvasSchema.parse(value),
    ),
    layers: validatedRecord(revision.layers, (value) =>
      DrawingStructureLayerSchema.parse(value),
    ),
    objects: validatedRecord(revision.objects, (value) =>
      DrawingObjectSchema.parse(value),
    ),
    styles: validatedRecord(revision.styles ?? [], (value) =>
      DrawingStyleDefinitionSchema.parse(value),
    ),
    blocks: validatedRecord(revision.blocks ?? [], (value) =>
      DrawingBlockSchema.parse(value),
    ),
    blockInstances: validatedRecord(revision.blockInstances ?? [], (value) =>
      DrawingBlockInstanceSchema.parse(value),
    ),
    propertySchemas: validatedRecord(revision.propertySchemas ?? [], (value) =>
      DrawingPropertySchemaSchema.parse(value),
    ),
    propertyValues: validatedRecord(revision.propertyValues ?? [], (value) =>
      DrawingPropertyValueSchema.parse(value),
    ),
    tables: validatedRecord(revision.tables ?? [], (value) =>
      DrawingTableSchema.parse(value),
    ),
    sources: validatedRecord(revision.sources ?? [], (value) =>
      DrawingObjectSourceSchema.parse(value),
    ),
  });
}

export const meta: Route.MetaFunction = () => [
  { title: "로컬 도면 작업실 미리보기 | 1HK Platform" },
];

function isLocalPreviewRequest(request: Request) {
  return Boolean(localWorkspacePreviewTarget(request.url));
}

export function loader({ request }: Route.LoaderArgs) {
  if (!isLocalPreviewRequest(request))
    throw new Response("Not Found", { status: 404 });
  const finishLoaderStage = startDrawingWorkspaceStage("loader");
  const performanceTest =
    new URL(request.url).searchParams.get("performanceTest") === "1";
  const performanceFixture = performanceTest
    ? buildDrawingP4PerformanceFixture(10_000, ids.layerPlanWork)
    : null;
  const hiddenHostTest =
    new URL(request.url).searchParams.get("hiddenHostTest") === "1";
  const p5IfcTest = new URL(request.url).searchParams.get("p5IfcTest") === "1";
  const p5PdfTest = new URL(request.url).searchParams.get("p5PdfTest") === "1";
  const p5BaselineTest =
    new URL(request.url).searchParams.get("p5BaselineTest") === "1";
  const p5ReleaseTest =
    new URL(request.url).searchParams.get("p5ReleaseTest") === "1";
  const legacyPreviewTest = [
    "realtimeTest",
    "collaborationRetryTest",
    "bootstrapReadOnlyTest",
    "awarenessTest",
    "verticalTest",
  ].some((name) => new URL(request.url).searchParams.get(name) === "1");
  const canonicalP5 =
    !performanceTest &&
    !hiddenHostTest &&
    !p5IfcTest &&
    !p5PdfTest &&
    !p5ReleaseTest &&
    !legacyPreviewTest;
  const viewState = parseDrawingWorkspaceViewState(
    new URL(request.url).searchParams,
  );
  const viewMode =
    (canonicalP5 || performanceTest) &&
    !new URL(request.url).searchParams.has("view")
      ? "split"
      : viewState.view;
  const fixture = localDrawingWorkspacePreviewFixture({
    disableDefaultIfc:
      p5BaselineTest &&
      new URL(request.url).searchParams.has("view") &&
      viewState.view === "2d",
    hiddenHostTest,
    p5IfcTest,
    p5Integrated:
      performanceTest || canonicalP5 || p5BaselineTest || p5ReleaseTest,
    p5PdfTest,
    p7PerformanceTest: performanceTest,
    selectedIfcFileId: viewState.ifcFileId,
    viewMode,
    performanceObjects:
      performanceFixture?.objects ??
      (p5BaselineTest
        ? buildDrawingP4PerformanceFixture(10_000, ids.layerPlanWork).objects
        : undefined),
  });
  validateLocalDrawingWorkspacePreviewFixture(fixture);
  const realtimeTest =
    new URL(request.url).searchParams.get("realtimeTest") === "1";
  const collaborationRetryTest =
    new URL(request.url).searchParams.get("collaborationRetryTest") === "1";
  const bootstrapReadOnlyTest =
    new URL(request.url).searchParams.get("bootstrapReadOnlyTest") === "1";
  const awarenessTest =
    new URL(request.url).searchParams.get("awarenessTest") === "1";
  const verticalTest =
    new URL(request.url).searchParams.get("verticalTest") === "1";
  const revision = fixture.workspace.document.revision;
  const payload = {
    ...fixture,
    assignees: [
      { userId: ids.user, role: "estimator" },
      { userId: previewAlternateUserId, role: "reviewer" },
    ],
    activityPage: {
      items: [
        {
          kind: "operation" as const,
          id: "00000000-0000-4000-8000-000000000098",
          clientOperationId: "00000000-0000-4000-8000-000000000099",
          revisionId: revision.id,
          actorId: previewAlternateUserId,
          action: "revert_operation",
          detail: { type: "compound", actions: [{ type: "put_object" }] },
          provenance: {
            originalOperationId: "00000000-0000-4000-8000-000000000091",
          },
          createdAt,
        },
      ],
      nextCursor: null,
    },
    collaborationRoom: {
      issues: revision.issues,
      anchors: [],
      comments: [
        {
          id: "00000000-0000-4000-8000-000000000096",
          issue_id: ids.issue,
          author_id: previewAlternateUserId,
          body: "창호 치수 근거를 확인해 주세요.",
          created_at: createdAt,
        },
      ],
      mentions: [
        {
          comment_id: "00000000-0000-4000-8000-000000000096",
          user_id: ids.user,
        },
      ],
      canvasRegionAnchors: [
        {
          id: "00000000-0000-4000-8000-000000000097",
          issue_id: ids.issue,
          revision_id: revision.id,
          page_id: ids.pagePlan,
          canvas_id: ids.canvasPlanPaper,
          project_id: ids.project,
          x_mm: 120,
          y_mm: 80,
          width_mm: 640,
          height_mm: 320,
          label: "창호 상세 검토 영역",
          created_by: previewAlternateUserId,
          created_at: createdAt,
        },
      ],
    },
    collaborationBootstrap: bootstrapReadOnlyTest
      ? {
          canonicalJson: {
            schemaVersion: 2 as const,
            revision: {
              id: revision.id,
              documentId: revision.document_id,
              projectId: revision.project_id,
              sequence: revision.sequence,
              version: revision.version,
            },
            sources: [],
            pages: revision.pages,
            canvases: revision.canvases ?? [],
            layers: revision.layers,
            objects: revision.objects,
            styles: revision.styles ?? [],
            blocks: revision.blocks ?? [],
            blockInstances: revision.blockInstances ?? [],
            propertySchemas: revision.propertySchemas ?? [],
            propertyValues: revision.propertyValues ?? [],
            tables: revision.tables ?? [],
            issues: revision.issues,
            operationSequence: 0,
          },
          operationSequence: 0,
          schemaVersion: 2 as const,
          sha256: sourceSha256,
          revisionStatus: "review_requested" as const,
          capability: "editor" as const,
          canWrite: false,
          recentOutcomes: [],
        }
      : undefined,
    previewLoaderNonce: realtimeTest ? crypto.randomUUID() : null,
    collaborationRetryTest,
    awarenessTest,
    realtimeTest,
    verticalTest,
    performanceTest,
    p5IfcTest,
    p5PdfTest,
    p5BaselineTest,
    p5ReleaseTest,
    canonicalP5,
  };
  const loaderMs = finishLoaderStage();
  return data(
    { ...payload, drawingWorkspaceLoaderMs: loaderMs },
    {
      headers: {
        "Server-Timing": `drawing-workspace-loader;dur=${loaderMs.toFixed(3)}`,
      },
    },
  );
}

export async function action({ request }: Route.ActionArgs) {
  if (!isLocalPreviewRequest(request))
    return data({ ok: false, error: "Not Found" }, { status: 404 });
  try {
    const form = await request.formData();
    const intent = form.get("intent");
    if (intent === "cancel_pdf_compare")
      return data({ ok: true, kind: "pdf_compare_cancelled", error: null });
    if (intent === "load_pdf_compare") {
      const input = parseDrawingWorkspacePreviousPdfForm(form);
      const parameters = new URL(request.url).searchParams;
      const integratedPdf =
        parameters.get("p5BaselineTest") === "1" ||
        (parameters.get("p5PdfTest") !== "1" && !parameters.has("p5IfcTest"));
      const expectedCurrentSha = integratedPdf
        ? representativePdfSha256
        : sourceSha256;
      const expectedPreviousSha = integratedPdf
        ? representativePreviousPdfSha256
        : "b".repeat(64);
      if (
        (parameters.get("p5PdfTest") !== "1" &&
          parameters.get("p5BaselineTest") !== "1" &&
          parameters.has("p5IfcTest")) ||
        input.revisionEdgeId !== previewPdfRevisionEdgeId ||
        input.currentFileId !== ids.file ||
        input.currentSha256 !== expectedCurrentSha ||
        input.previousFileId !== previewPreviousPdfFileId ||
        input.previousSha256 !== expectedPreviousSha ||
        input.pageNumber !== 1
      )
        return data(
          { ok: false, error: "PDF 개정 비교 증거가 일치하지 않습니다." },
          { status: 409 },
        );
      return data({
        ok: true,
        kind: "pdf_compare",
        error: null,
        previousPdf: {
          id: previewPreviousPdfFileId,
          kind: "pdf",
          originalFilename: "근린생활시설_A-101-r1.pdf",
          byteSize: integratedPdf
            ? representativePreviousPdfByteSize
            : 1_048_576,
          sha256: expectedPreviousSha,
          signedUrl: "/__p5-previous.pdf",
        },
      });
    }
    const mutation = parseWorkspaceMutation(form);
    if (
      mutation.intent === "request_review" &&
      new URL(request.url).searchParams.get("reviewFreezeTest") === "1"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return data(
        {
          ok: false,
          kind: "retryable",
          error: "로컬 동결 실패 복구 시험",
        },
        { status: 503 },
      );
    }
    if (mutation.intent !== "apply_operation")
      return data(
        {
          ok: false,
          error: "로컬 미리보기에서는 작업 operation만 반영됩니다.",
        },
        { status: 400 },
      );
    if (
      mutation.operation.revisionId !==
      localDrawingWorkspacePreviewFixture().workspace.document.revision.id
    )
      return data(
        {
          ok: false,
          error: "현재 로컬 미리보기 revision의 작업만 반영됩니다.",
        },
        { status: 400 },
      );
    return data({
      ok: true,
      clientOperationId: mutation.operation.clientOperationId,
    });
  } catch {
    return data(
      { ok: false, error: "도면 작업 요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
}

export default function LocalDrawingWorkspacePreview({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const [hydrated, setHydrated] = useState(false);
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [realtimeInvalidations, setRealtimeInvalidations] = useState(0);
  const [alternateUser, setAlternateUser] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [localResources, setLocalResources] = useState(0);
  const [providers, setProviders] = useState(0);
  const [retryLifecycle, setRetryLifecycle] = useState("starting");
  const [localSyncs, setLocalSyncs] = useState(0);
  const [providerFailures, setProviderFailures] = useState(0);
  const [previewSoftLockRequest, setPreviewSoftLockRequest] = useState<
    string | null
  >(null);
  const [localAwarenessPayload, setLocalAwarenessPayload] =
    useState<unknown>(null);
  const [verticalSnapshot, setVerticalSnapshot] = useState<unknown>(null);
  const [ifcLifecycleEvidence, setIfcLifecycleEvidence] = useState({
    ownedDisposals: 0,
    contextLossRequests: 0,
  });
  const persistenceAttempts = useRef(0);
  const providerAttempts = useRef(0);
  const realtimeAdapter = useMemo(() => createPreviewRealtimeAdapter(), []);
  const onInvalidate = useCallback(
    () => setRealtimeInvalidations((count) => count + 1),
    [],
  );
  const previewHarness = useMemo(() => ({ onInvalidate }), [onInvalidate]);
  const awarenessPreviewHarness = useMemo(
    () => ({ onSoftLockChange: setPreviewSoftLockRequest }),
    [],
  );
  const verticalPreviewHarness = useMemo(
    () => ({ onStateChange: setVerticalSnapshot, verticalTest: true }),
    [],
  );
  const p5PreviewHarness = useMemo(
    () => ({
      onStateChange: setVerticalSnapshot,
      p5IfcTest: true,
      onIfcViewerDispose: (evidence: { contextLossRequested: true }) =>
        setIfcLifecycleEvidence((current) => ({
          ownedDisposals: current.ownedDisposals + 1,
          contextLossRequests:
            current.contextLossRequests +
            (evidence.contextLossRequested ? 1 : 0),
        })),
    }),
    [],
  );
  const p5PdfPreviewHarness = useMemo(
    () => ({ onStateChange: setVerticalSnapshot, p5PdfTest: true }),
    [],
  );
  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    if (!loaderData.realtimeTest) return;
    let active = true;
    if (realtimeAdapter.subscribed) setRealtimeReady(true);
    void realtimeAdapter.ready.then(() => {
      if (active) setRealtimeReady(true);
    });
    return () => {
      active = false;
    };
  }, [loaderData.realtimeTest, realtimeAdapter]);
  const retryPersistenceFactory = useMemo(
    () => async () => {
      const number = ++persistenceAttempts.current;
      let disposed = false;
      setLocalResources((count) => count + 1);
      return {
        name: `preview-retry-${number}`,
        get closed() {
          return disposed;
        },
        async whenSynced() {
          if (number === 1) {
            setRetryLifecycle("local-failed");
            throw new Error("preview IndexedDB open failed");
          }
          setLocalSyncs((count) => count + 1);
          setRetryLifecycle("local-ready");
        },
        async flush() {},
        async dispose() {
          if (disposed) return;
          disposed = true;
          setLocalResources((count) => count - 1);
        },
      };
    },
    [],
  );
  const retryConnectionFactory = useMemo(
    () =>
      async ({
        onPhase,
      }: {
        onPhase?: (phase: "connected" | "connecting" | "degraded") => void;
      }) => {
        const number = ++providerAttempts.current;
        onPhase?.("connecting");
        if (number === 1) {
          setProviderFailures((count) => count + 1);
          setRetryLifecycle("provider-failed");
          throw new Error("preview provider creation failed");
        }
        let disposed = false;
        setProviders((count) => count + 1);
        onPhase?.("connected");
        setRetryLifecycle("connected");
        return {
          phase: "connected" as const,
          flush() {},
          async refreshToken() {},
          dispose() {
            if (disposed) return;
            disposed = true;
            setProviders((count) => count - 1);
          },
        };
      },
    [],
  );
  return (
    <>
      <DrawingWorkspaceClient
        {...loaderData}
        actionError={
          actionData && "error" in actionData ? actionData.error : undefined
        }
        projectId={ids.project}
        capability={
          loaderData.realtimeTest && viewer ? "viewer" : loaderData.capability
        }
        currentUserId={
          loaderData.realtimeTest && alternateUser
            ? previewAlternateUserId
            : loaderData.currentUserId
        }
        previewMode
        collaborationConnectionFactory={
          loaderData.collaborationRetryTest
            ? retryConnectionFactory
            : previewCollaborationConnectionFactory(
                loaderData.awarenessTest,
                setLocalAwarenessPayload,
                loaderData.p5IfcTest,
              )
        }
        collaborationPersistenceFactory={
          loaderData.collaborationRetryTest
            ? retryPersistenceFactory
            : undefined
        }
        realtimeAdapter={
          loaderData.realtimeTest ? realtimeAdapter : previewRealtimeAdapter
        }
        previewHarness={
          loaderData.verticalTest
            ? verticalPreviewHarness
            : loaderData.p5ReleaseTest
              ? p5PreviewHarness
              : loaderData.p5BaselineTest
                ? p5PreviewHarness
                : loaderData.p5IfcTest
                  ? p5PreviewHarness
                  : loaderData.p5PdfTest
                    ? p5PdfPreviewHarness
                    : loaderData.canonicalP5
                      ? undefined
                      : loaderData.realtimeTest
                        ? previewHarness
                        : loaderData.awarenessTest
                          ? awarenessPreviewHarness
                          : undefined
        }
      />
      <aside
        className="fixed bottom-3 right-3 z-50 rounded-full bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 shadow-lg"
        role="status"
      >
        로컬 예제 데이터 · 브라우저 자동 복구
        <output aria-label="미리보기 hydration 상태" className="sr-only">
          {hydrated ? "준비됨" : "준비 중"}
        </output>
        {loaderData.performanceTest ? (
          <>
            <output aria-label="P7 loader duration" className="sr-only">
              {loaderData.drawingWorkspaceLoaderMs}
            </output>
            <output aria-label="P7 source link count" className="sr-only">
              {loaderData.workspace.document.revision.sources?.length ?? 0}
            </output>
          </>
        ) : null}
        {loaderData.verticalTest ? (
          <output
            aria-label="P4 mounted workspace snapshot"
            className="sr-only"
          >
            {JSON.stringify(verticalSnapshot)}
          </output>
        ) : null}
        {loaderData.p5IfcTest ||
        loaderData.p5PdfTest ||
        loaderData.p5ReleaseTest ? (
          <output
            aria-label="P5 mounted workspace snapshot"
            className="sr-only"
          >
            {JSON.stringify(verticalSnapshot)}
          </output>
        ) : null}
        {loaderData.p5BaselineTest ? (
          <>
            <output aria-label="P5 baseline object count">
              {loaderData.workspace.document.revision.objects.length}
            </output>
            <output aria-label="P5 baseline source link count">
              {loaderData.workspace.document.revision.sources?.length ?? 0}
            </output>
            <output
              aria-label="P5 IFC owned lifecycle evidence"
              className="sr-only"
            >
              {JSON.stringify(ifcLifecycleEvidence)}
            </output>
          </>
        ) : null}
        {loaderData.awarenessTest ? (
          <>
            <output aria-label="로컬 임시 잠금" className="sr-only">
              {previewSoftLockRequest ?? "없음"}
            </output>
            <output aria-label="로컬 Awareness payload" className="sr-only">
              {JSON.stringify(localAwarenessPayload)}
            </output>
          </>
        ) : null}
      </aside>
      {loaderData.realtimeTest ? (
        <aside className="fixed bottom-3 left-3 z-50 flex items-center gap-2 rounded-md bg-slate-950 p-2 text-xs text-white">
          <p
            aria-label={
              realtimeReady
                ? "실시간 미리보기 준비됨"
                : "실시간 미리보기 준비 중"
            }
            role="status"
          >
            {realtimeReady
              ? "실시간 미리보기 준비됨"
              : "실시간 미리보기 준비 중"}
          </p>
          <output aria-label="실시간 갱신 횟수">{realtimeInvalidations}</output>
          <output aria-label="미리보기 loader nonce">
            {loaderData.previewLoaderNonce}
          </output>
          <button
            disabled={!realtimeReady}
            onClick={() => realtimeAdapter.emit()}
            type="button"
          >
            실시간 갱신 시험
          </button>
          <button onClick={() => setAlternateUser(true)} type="button">
            테스트 사용자 전환
          </button>
          <button onClick={() => setViewer(true)} type="button">
            테스트 보기 권한
          </button>
        </aside>
      ) : null}
      {loaderData.collaborationRetryTest ? (
        <aside className="fixed bottom-3 left-3 z-50 rounded-md bg-slate-950 p-2 text-xs text-white">
          <output aria-label="협업 재시도 상태">{retryLifecycle}</output>
          <output aria-label="협업 로컬 동기화 횟수">{localSyncs}</output>
          <output aria-label="협업 provider 실패 횟수">
            {providerFailures}
          </output>
          <output aria-label="협업 로컬 리소스 수">{localResources}</output>
          <output aria-label="협업 provider 수">{providers}</output>
        </aside>
      ) : null}
    </>
  );
}
