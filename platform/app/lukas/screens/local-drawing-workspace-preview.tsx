import type { Route } from "./+types/local-drawing-workspace-preview";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { data, useLocation } from "react-router";
import { parseRegistrationRecord } from "~/lukas/components/drawing-native-start-preview";

import DrawingWorkspaceClient from "~/lukas/components/drawing-workspace";
import { DrawingPdfScreenPreview } from "~/lukas/components/drawing-pdf-screen-preview";
import { ExternalRequestWorkspacePreview } from "~/lukas/components/external-request-workspace-preview";
import { openDrawingCollaborationConnection } from "~/lukas/lib/drawing-collaboration-client";
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
  expectedOperationResultVersions,
  type DrawingWorkspace,
  type DrawingWorkspaceSourceBundle,
} from "~/lukas/lib/drawing-workspace.server";
import { parseDrawingWorkspaceViewState } from "~/lukas/lib/drawing-workspace-view";
import { parseRelinkDrawingAnchorForm } from "~/lukas/lib/drawing-revision.server";
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
  DrawingOperationInput,
} from "~/lukas/lib/drawing-workspace.types";
import { drawingAwarenessColor } from "~/lukas/lib/drawing-awareness";
import { adaptIfcRenderBundleDescriptor } from "~/lukas/lib/ifc-render-descriptor";
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
// Public synthetic current PDF: scripts/generate-p5-current-pdf.mjs.
const representativePdfByteSize = 8_289;
const representativePdfSha256 =
  "298cdc57f86b73f96ad6c743e20d9fb76e08d9f8dc7b827b6558ff068f95c8db";
const representativePreviousPdfByteSize = 63_118;
const representativePreviousPdfSha256 =
  "ea75a7e655dee16a460672131424f00112f70467e495f751d77de80e409fc9bc";
const createdAt = "2026-08-25T09:00:00.000Z";
const previewAlternateUserId = "00000000-0000-4000-8000-000000000006";
const localMultiplayerCollaborationUrl = "ws://127.0.0.1:12347";
const previewRealtimeAdapter = createInertDrawingWorkspaceRealtimeAdapter();
const previewIfcFileId = "00000000-0000-4000-8000-0000000000a1";
const previewAlternateIfcFileId = "00000000-0000-4000-8000-0000000000a2";
const previewIfcSha256 =
  "db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d";
/** Source-catalog-only fixture URL; the preview renderer uses the GLB below. */
const previewIfcFixtureSourceUrl =
  "https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/3f6f3640b8317664194911fad63bcd407f7e32ca/examples/example.ifc";
const previewIfcGeometrySha256 =
  "cb450586de90c234831a6a206c0cb83078d65eca1870ac642680df5b5056270f";
export function previewIfcDerivative(fileId: string, sourceSha256: string) {
  const alternate = fileId === previewAlternateIfcFileId;
  return {
    status: "ready" as const,
    version: 1,
    sourceSha256,
    geometrySha256: previewIfcGeometrySha256,
    geometryByteSize: 16_196,
    geometrySignedUrl: "/examples/synthetic-ifc-mapping.glb",
    manifestSha256: alternate
      ? "5c417a92f4e3feb6e61d19204e94eca0a131e89bc00c93c7aa5d1b5978147b82"
      : "65dc191d9089409f37d4757707e4a191bb7774ac4a64ac191384a67e3e85a17c",
    manifestByteSize: 84_033,
    manifestSignedUrl: alternate
      ? "/examples/synthetic-ifc-mapping-copy.manifest.json"
      : "/examples/synthetic-ifc-mapping.manifest.json",
  };
}
const previewNotApplicableDerivative = {
  status: "not_applicable" as const,
  version: null,
  sourceSha256: null,
  manifestByteSize: null,
  geometryByteSize: null,
  manifestSha256: null,
  geometrySha256: null,
  manifestSignedUrl: null,
  geometrySignedUrl: null,
};
const previewPreviousPdfFileId = "00000000-0000-4000-8000-0000000000b1";
const previewPdfRevisionEdgeId = "00000000-0000-4000-8000-0000000000b2";
const previewRevisionAnchorId = "00000000-0000-4000-8000-0000000000b3";

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
      label: "합성 매핑 예제 · 원본 IFC 형상 아님",
      byteSize: 413_681,
      sha256: previewIfcSha256,
      fixtureSourceUrl: previewIfcFixtureSourceUrl,
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

function localMultiplayerConnectionFactory(
  options: Parameters<typeof openDrawingCollaborationConnection>[0],
) {
  return openDrawingCollaborationConnection({
    ...options,
    resolveToken: async () => "local-preview",
    url: localMultiplayerCollaborationUrl,
  });
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
    primary: {
      ...primary,
      signedUrl: "/__p5-current.pdf",
      derivative: previewNotApplicableDerivative,
    },
    pdf: {
      ...primary,
      signedUrl: "/__p5-current.pdf",
      derivative: previewNotApplicableDerivative,
    },
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
              : {
                  ...selectedIfc,
                  derivative: previewIfcDerivative(
                    selectedIfc.id,
                    selectedIfc.sha256,
                  ),
                },
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
                  : {
                      ...selectedIfc,
                      derivative: previewIfcDerivative(
                        selectedIfc.id,
                        selectedIfc.sha256,
                      ),
                    },
              previousPdf: null,
              revisionEdge: null,
              catalog: [primary, ...ifcCatalog],
            }
          : undefined,
    selectedIfcFileId: selectedIfc?.id ?? null,
    viewMode: options?.viewMode,
    workspace: {
      primarySource: {
        id: ids.file,
        project_id: ids.project,
        kind: "pdf",
        original_filename: "근린생활시설_A-101.pdf",
        storage_path: "local-preview/1hk-a101.pdf",
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
  if (workspace.document.source_sha256 !== workspace.primarySource?.sha256)
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
  const ifcLifecycleTest =
    new URL(request.url).searchParams.get("ifcLifecycleTest") === "1";
  const performanceFixture = performanceTest
    ? buildDrawingP4PerformanceFixture(10_000, ids.layerPlanWork)
    : null;
  const hiddenHostTest =
    new URL(request.url).searchParams.get("hiddenHostTest") === "1";
  const p5IfcTest = new URL(request.url).searchParams.get("p5IfcTest") === "1";
  const p5PdfTest = new URL(request.url).searchParams.get("p5PdfTest") === "1";
  const p5RevisionRelinkTest =
    new URL(request.url).searchParams.get("p5RevisionRelinkTest") === "1";
  const p5BaselineTest =
    new URL(request.url).searchParams.get("p5BaselineTest") === "1";
  const p5ReleaseTest =
    new URL(request.url).searchParams.get("p5ReleaseTest") === "1";
  const legacyPreviewTest = [
    "realtimeTest",
    "connectionLifecycleTest",
    "collaborationRetryTest",
    "bootstrapReadOnlyTest",
    "awarenessTest",
    "verticalTest",
    "localMultiplayerTest",
  ].some((name) => new URL(request.url).searchParams.get(name) === "1");
  const canonicalP5 =
    !performanceTest &&
    !hiddenHostTest &&
    !p5IfcTest &&
    !p5PdfTest &&
    !p5RevisionRelinkTest &&
    !p5ReleaseTest &&
    !legacyPreviewTest;
  const viewState = parseDrawingWorkspaceViewState(
    new URL(request.url).searchParams,
  );
  const viewMode =
    performanceTest && !new URL(request.url).searchParams.has("view")
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
      performanceTest ||
      canonicalP5 ||
      p5BaselineTest ||
      p5ReleaseTest ||
      p5RevisionRelinkTest,
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
  const connectionLifecycleTest =
    new URL(request.url).searchParams.get("connectionLifecycleTest") === "1";
  const realtimeTest =
    connectionLifecycleTest ||
    new URL(request.url).searchParams.get("realtimeTest") === "1";
  const collaborationRetryTest =
    new URL(request.url).searchParams.get("collaborationRetryTest") === "1";
  const bootstrapReadOnlyTest =
    new URL(request.url).searchParams.get("bootstrapReadOnlyTest") === "1";
  const awarenessTest =
    new URL(request.url).searchParams.get("awarenessTest") === "1";
  const verticalTest =
    new URL(request.url).searchParams.get("verticalTest") === "1";
  const localMultiplayerTest =
    new URL(request.url).searchParams.get("localMultiplayerTest") === "1";
  const alternateUser =
    localMultiplayerTest &&
    new URL(request.url).searchParams.get("alternateUser") === "1";
  const returnProject = new URL(request.url).searchParams.get("returnProject");
  const projectPreviewReturn =
    returnProject &&
    /^00000000-0000-4000-(?:8000-00000000010[1-3]|9000-[0-9a-f]{12})$/.test(returnProject)
      ? `/workspace-preview?project=${returnProject}`
      : null;
  const projectPreviewViewer =
    new URL(request.url).searchParams.get("role") === "viewer";
  const returnQuery = new URL(request.url).searchParams;
  const returnPanel = returnQuery.get("returnPanel");
  const workReturn = returnPanel === "project-quantities" || returnPanel === "project-materials" || returnPanel === "project-deliveries" || returnPanel === "project-reviews" ? `&panel=${returnPanel}` : "";
  const returnRequestStatus=returnQuery.get("returnRequestStatus");
  const requestStatusReturn=returnPanel==="project-reviews"&&returnRequestStatus&&["확인 대기","수정 요청","확인 완료","승인 확인"].includes(returnRequestStatus)?`&requestStatus=${encodeURIComponent(returnRequestStatus)}`:"";
  const returnSourceDrawing = returnQuery.get("returnSourceDrawing");
  const workSourceReturn = returnPanel === "project-materials" && returnSourceDrawing && /^[0-9a-f-]{36}$/i.test(returnSourceDrawing) ? `&sourceDrawing=${encodeURIComponent(returnSourceDrawing)}` : "";
  const returnState = returnQuery.get("returnState");
  const requestedScreenReviewState = returnQuery.get("reviewState");
  const screenReviewState = ["requested", "changes", "approved"].includes(
    requestedScreenReviewState ?? "",
  )
    ? (requestedScreenReviewState as "requested" | "changes" | "approved")
    : undefined;
  const revision = fixture.workspace.document.revision;
  const payload = {
    ...fixture,
    roomUrl: projectPreviewReturn
      ? `${projectPreviewReturn}${projectPreviewViewer ? "&role=viewer" : ""}${returnQuery.get("returnEmpty") === "1" ? "&empty=1" : ""}${returnQuery.get("returnTab") === "files" ? "&tab=files" : ""}${workReturn}${workSourceReturn}${requestStatusReturn}`
      : returnState === "empty" || returnState === "default"
        ? `/workspace-preview?state=${returnState}`
        : fixture.roomUrl,
    capability: projectPreviewViewer ? ("viewer" as const) : fixture.capability,
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
          detail: { type: "compound", itemCount: 1 },
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
      anchors: p5RevisionRelinkTest
        ? [
            {
              id: previewRevisionAnchorId,
              issue_id: ids.issue,
              project_id: ids.project,
              file_id: previewPreviousPdfFileId,
              anchor_kind: "pdf_region" as const,
              element_id: null,
              ifc_global_id: null,
              camera_json: null,
              page_number: 1,
              x: 0.12,
              y: 0.18,
              width: 0.2,
              height: 0.15,
              label: "이전 PDF 창호 영역",
              active: true,
              created_by: previewAlternateUserId,
              created_at: createdAt,
              deactivated_by: null,
              deactivated_at: null,
              deactivation_note: null,
              replaces_anchor_id: null,
            },
          ]
        : [],
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
    revisionReview: p5RevisionRelinkTest
      ? [
          {
            issueId: ids.issue,
            issueTitle: "창호 치수 확인",
            previousAnchorId: previewRevisionAnchorId,
            previousFileId: previewPreviousPdfFileId,
            sourceKind: "pdf_region" as const,
            kind: "manual_reanchor_required" as const,
            ifcGlobalId: null,
          },
        ]
      : [],
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
    connectionLifecycleTest,
    awarenessTest,
    realtimeTest,
    verticalTest,
    localMultiplayerTest,
    alternateUser,
    performanceTest,
    ifcLifecycleTest,
    p5IfcTest,
    p5PdfTest,
    p5RevisionRelinkTest,
    p5BaselineTest,
    p5ReleaseTest,
    canonicalP5,
    layoutPreview: new URL(request.url).searchParams.get("layout") === "pdf",
    pdfHandoffToken: returnQuery.get("pdf"),
    screenStartKind:
      returnQuery.get("startKind") === "blank"
        ? ("blank" as const)
        : returnQuery.get("startKind") === "office"
          ? ("office" as const)
          : returnQuery.get("startKind") === "house"
            ? ("house" as const)
            : ("pdf" as const),
    screenTitle: (returnQuery.get("title") ?? "").trim().slice(0, 80),
    screenDocumentId: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(returnQuery.get("screenDocument") ?? "") ? returnQuery.get("screenDocument")! : undefined,
    screenViewMode: returnQuery.get("view") === "3d" ? "3d" as const : returnQuery.get("view") === "split" ? "split" as const : "2d" as const,
    screenReviewPreview: returnQuery.get("reviewPreview") === "1",
    screenWorkflowPanel: ["review", "export", "share"].includes(returnQuery.get("workflowPanel") ?? "") ? returnQuery.get("workflowPanel") as "review" | "export" | "share" : undefined,
    screenTakeoffPreview: returnQuery.get("takeoffPreview") === "1",
    screenReviewState,
    screenPaper:
      returnQuery.get("paper") === "A4"
        ? ("A4" as const)
        : returnQuery.get("paper") === "A2"
          ? ("A2" as const)
          : ("A3" as const),
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

const legacyPreviewSequenceCeiling = 2_147_483_646;

/** Development-only receipt order that preserves the causal submit order. */
export function createPreviewOperationReceiptSequencer() {
  const receipts = new Map<
    string,
    { operationSignature: string; sequence: number }
  >();
  const lastSequenceByRevision = new Map<string, number>();

  return {
    issue(
      operation: Pick<
        DrawingOperationInput,
        "clientOperationId" | "revisionId" | "createdAt"
      >,
    ) {
      const key = `${operation.revisionId}:${operation.clientOperationId}`;
      const operationSignature = JSON.stringify(operation);
      const existing = receipts.get(key);
      if (existing) {
        if (existing.operationSignature !== operationSignature)
          throw new Error(
            "Local preview operation identity cannot be reused with different input.",
          );
        return existing.sequence;
      }

      // The timestamp floor keeps receipts created after a dev-server restart
      // above the former UUID-hash range and normally above earlier sessions.
      const timestampFloor = Date.parse(operation.createdAt) * 1_000;
      if (!Number.isSafeInteger(timestampFloor) || timestampFloor < 1)
        throw new Error("Local preview operation timestamp is invalid.");
      const sequence = Math.max(
        legacyPreviewSequenceCeiling + 1,
        timestampFloor,
        (lastSequenceByRevision.get(operation.revisionId) ?? 0) + 1,
      );
      if (!Number.isSafeInteger(sequence))
        throw new Error("Local preview operation sequence is exhausted.");
      receipts.set(key, { operationSignature, sequence });
      lastSequenceByRevision.set(operation.revisionId, sequence);
      return sequence;
    },
  };
}

const previewOperationReceipts = createPreviewOperationReceiptSequencer();

function previewOperationResultVersions(operation: DrawingOperationInput) {
  return Object.fromEntries(
    Object.entries(expectedOperationResultVersions(operation)).map(
      ([id, expectation]) => [
        id,
        expectation.kind === "deleted" ? null : expectation.version,
      ],
    ),
  );
}

export async function action({ request }: Route.ActionArgs) {
  if (!isLocalPreviewRequest(request))
    return data({ ok: false, error: "Not Found" }, { status: 404 });
  if (new URL(request.url).searchParams.get("layout") === "pdf")
    return new Response("Screen preview is read-only.", { status: 405 });
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
    if (
      intent === "relink_anchor" &&
      new URL(request.url).searchParams.get("p5RevisionRelinkTest") === "1"
    ) {
      const input = parseRelinkDrawingAnchorForm(form);
      if (
        input.previousAnchorId !== previewRevisionAnchorId ||
        input.currentFileId !== ids.file ||
        input.anchor.kind !== "pdf_region" ||
        input.anchor.fileId !== ids.file
      )
        return data(
          { ok: false, error: "개정 근거 후보가 일치하지 않습니다." },
          { status: 409 },
        );
      return data({
        ok: true as const,
        kind: "revision_anchor_relinked" as const,
        error: null,
        result: {
          previousAnchorId: input.previousAnchorId,
          newAnchorId: input.newAnchorId,
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
      result: {
        operationId: mutation.operation.clientOperationId,
        sequence: previewOperationReceipts.issue(mutation.operation),
        resultVersions: previewOperationResultVersions(mutation.operation),
      },
    });
  } catch {
    return data(
      { ok: false, error: "도면 작업 요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
}

function previewRevisionRelinkResult(value: unknown) {
  if (!value || typeof value !== "object" || !("result" in value)) return null;
  const result = value.result;
  if (
    !result ||
    typeof result !== "object" ||
    !("previousAnchorId" in result) ||
    typeof result.previousAnchorId !== "string" ||
    !("newAnchorId" in result) ||
    typeof result.newAnchorId !== "string"
  )
    return null;
  return {
    previousAnchorId: result.previousAnchorId,
    newAnchorId: result.newAnchorId,
  };
}

export default function LocalDrawingWorkspacePreview(
  props: Route.ComponentProps,
) {
  const location = useLocation();
  const [registrationHydrated, setRegistrationHydrated] = useState(false);
  useEffect(() => { setRegistrationHydrated(true); }, []);
  const registrationRecord = registrationHydrated ? parseRegistrationRecord(location.state?.registrationPreview) : null;
  const requestParams=new URLSearchParams(location.search);
  if(requestParams.has("externalRequest"))return <ExternalRequestWorkspacePreview key={`${requestParams.get("returnProject")}:${requestParams.get("screenDocument")}:${requestParams.get("externalRequest")}`} projectId={requestParams.get("returnProject")??""} documentId={requestParams.get("screenDocument")??""} requestId={requestParams.get("externalRequest")??""} viewer={props.loaderData.capability==="viewer"}/>;
  if (props.loaderData.layoutPreview) {
    return (
      <DrawingPdfScreenPreview
        key={`${props.loaderData.screenDocumentId}:${props.loaderData.pdfHandoffToken}:${props.loaderData.screenStartKind}:${props.loaderData.screenTitle}:${props.loaderData.screenReviewPreview}:${props.loaderData.screenReviewState ?? "draft"}:${props.loaderData.screenTakeoffPreview}:${props.loaderData.screenWorkflowPanel ?? "none"}:${new URLSearchParams(location.search).get("changeRound") ?? "current"}`}
        documentId={props.loaderData.screenDocumentId}
        initialRequestRound={new URLSearchParams(location.search).has("requestRound")?Number(new URLSearchParams(location.search).get("requestRound")):undefined}
        changeRoundId={new URLSearchParams(location.search).has("changeRound") ? new URLSearchParams(location.search).get("changeRound") ?? "" : undefined}
        registrationRecord={registrationRecord}
        handoffToken={props.loaderData.pdfHandoffToken}
        initialReviewState={props.loaderData.screenReviewState}
        returnHref={props.loaderData.roomUrl}
        startKind={props.loaderData.screenStartKind}
        title={props.loaderData.screenTitle}
        reviewPreview={props.loaderData.screenReviewPreview}
        initialWorkflowPanel={props.loaderData.screenWorkflowPanel}
        takeoffPreview={props.loaderData.screenTakeoffPreview}
        paper={props.loaderData.screenPaper}
        initialViewMode={props.loaderData.screenViewMode}
        viewer={props.loaderData.capability === "viewer"}
      />
    );
  }
  return <LegacyDrawingWorkspacePreview {...props} />;
}

function LegacyDrawingWorkspacePreview({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const [hydrated, setHydrated] = useState(false);
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [realtimeInvalidations, setRealtimeInvalidations] = useState(0);
  const [alternateUser, setAlternateUser] = useState(false);
  const [viewer, setViewer] = useState(false);
  const [heldConnections, setHeldConnections] = useState<number[]>([]);
  const [openedConnections, setOpenedConnections] = useState(0);
  const releaseConnectionsRef = useRef(new Map<number, () => void>());
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
  const [ifcLifecycleTransitioned, setIfcLifecycleTransitioned] =
    useState(false);
  const persistenceAttempts = useRef(0);
  const providerAttempts = useRef(0);
  const lifecycleConnectionFactory = useMemo(() => {
    let attempts = 0;
    const connect = previewCollaborationConnectionFactory();
    return async (
      options: Parameters<typeof openDrawingCollaborationConnection>[0],
    ) => {
      const attempt = ++attempts;
      if (attempt > 1) {
        setHeldConnections((held) => [...held, attempt]);
        await new Promise<void>((resolve) => {
          releaseConnectionsRef.current.set(attempt, () => {
            releaseConnectionsRef.current.delete(attempt);
            setHeldConnections((held) => held.filter((id) => id !== attempt));
            resolve();
          });
        });
      }
      const connection = await connect(options);
      setOpenedConnections((opened) => opened + 1);
      return connection;
    };
  }, []);
  useEffect(
    () => () => {
      for (const release of releaseConnectionsRef.current.values()) release();
    },
    [],
  );
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
  const localMultiplayerPreviewHarness = useMemo(
    () => ({
      onStateChange: setVerticalSnapshot,
      onSoftLockChange: setPreviewSoftLockRequest,
      verticalTest: true,
    }),
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
  const lifecycleSourceBundle = useMemo(() => {
    const bundle = loaderData.sourceBundle;
    if (
      !loaderData.ifcLifecycleTest ||
      !ifcLifecycleTransitioned ||
      !bundle?.pdf
    )
      return bundle;
    return {
      ...bundle,
      pdf: { ...bundle.pdf, sha256: "e".repeat(64) },
    };
  }, [
    ifcLifecycleTransitioned,
    loaderData.ifcLifecycleTest,
    loaderData.sourceBundle,
  ]);
  const ifcLifecycleKey = useMemo(() => {
    const revision = loaderData.workspace.document.revision;
    const selectedIfc = lifecycleSourceBundle?.catalog.find(
      (item) => item.kind === "ifc" && item.id === loaderData.selectedIfcFileId,
    );
    const renderBundle = adaptIfcRenderBundleDescriptor(
      lifecycleSourceBundle?.ifc,
    );
    return [
      revision.id,
      lifecycleSourceBundle?.pdf?.id ?? "no-pdf",
      lifecycleSourceBundle?.pdf?.sha256 ?? "no-pdf-sha",
      selectedIfc?.id ?? "no-ifc",
      selectedIfc?.sha256 ?? "no-ifc-sha",
      renderBundle?.derivative.version ?? "no-ifc-revision",
      renderBundle?.derivative.manifestSha256 ?? "no-ifc-manifest",
      renderBundle?.derivative.geometrySha256 ?? "no-ifc-glb",
    ].join(":");
  }, [
    lifecycleSourceBundle,
    loaderData.selectedIfcFileId,
    loaderData.workspace.document.revision,
  ]);
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
        sourceBundle={lifecycleSourceBundle}
        actionError={
          actionData && "error" in actionData ? actionData.error : undefined
        }
        revisionRelinkResult={previewRevisionRelinkResult(actionData)}
        projectId={ids.project}
        capability={
          loaderData.realtimeTest && viewer ? "viewer" : loaderData.capability
        }
        currentUserId={
          loaderData.localMultiplayerTest && loaderData.alternateUser
            ? previewAlternateUserId
            : loaderData.realtimeTest && alternateUser
              ? previewAlternateUserId
              : loaderData.currentUserId
        }
        previewMode
        collaborationConnectionFactory={
          loaderData.connectionLifecycleTest
            ? lifecycleConnectionFactory
            : loaderData.collaborationRetryTest
              ? retryConnectionFactory
              : loaderData.localMultiplayerTest
                ? localMultiplayerConnectionFactory
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
          loaderData.localMultiplayerTest
            ? localMultiplayerPreviewHarness
            : loaderData.verticalTest
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
        workspaceNotice={
          <>
            합성 매핑 예제 · 원본 IFC 형상 아님 ·{" "}
            <a
              className="underline underline-offset-2"
              href="/examples/IFC_FIXTURE_NOTICE.md"
              rel="license"
            >
              오픈소스·출처
            </a>
          </>
        }
      />
      <aside
        className={
          loaderData.ifcLifecycleTest
            ? "fixed bottom-3 right-3 z-50 rounded-lg bg-slate-900 p-3 text-sm text-white shadow-lg"
            : "sr-only"
        }
        role="status"
      >
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
        {loaderData.ifcLifecycleTest ? (
          <>
            <output
              aria-label="P7 IFC first-paint lifecycle"
              className="sr-only"
            >
              {ifcLifecycleTransitioned ? "next:" : "initial:"}
              {ifcLifecycleKey}
            </output>
            <button
              onClick={() => setIfcLifecycleTransitioned(true)}
              type="button"
            >
              P7 IFC lifecycle transition
            </button>
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
        {loaderData.localMultiplayerTest ? (
          <output
            aria-label="로컬 공동 편집 workspace snapshot"
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
          <button
            onClick={() => setAlternateUser((previous) => !previous)}
            type="button"
          >
            테스트 사용자 전환
          </button>
          {loaderData.connectionLifecycleTest ? (
            <>
              <output aria-label="실제 미리보기 연결 횟수">
                {openedConnections}
              </output>
              {heldConnections.map((attempt) => (
                <button
                  key={attempt}
                  onClick={() => releaseConnectionsRef.current.get(attempt)?.()}
                  type="button"
                >
                  연결 시도 {attempt} 허용
                </button>
              ))}
            </>
          ) : null}
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
