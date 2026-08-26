import type { Route } from "./+types/local-drawing-workspace-preview";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import DrawingWorkspaceClient from "~/lukas/components/drawing-workspace";
import {
  connectedDrawingWorkspaceRealtimeView,
  createInertDrawingWorkspaceRealtimeAdapter,
  type DrawingWorkspaceRealtimeAdapter,
} from "~/lukas/lib/drawing-workspace-realtime";
import { localWorkspacePreviewTarget } from "~/features/auth/lib/local-workspace-preview.server";
import { validateDrawingStructureState } from "~/lukas/lib/drawing-structure";
import {
  parseWorkspaceMutation,
  type DrawingWorkspace,
} from "~/lukas/lib/drawing-workspace.server";
import type {
  DrawingBlock,
  DrawingBlockInstance,
  DrawingCanvas,
  DrawingLayer,
  DrawingObject,
  DrawingPage,
  DrawingPropertySchema,
  DrawingPropertyValue,
  DrawingStyleDefinition,
  DrawingStructureLayer,
  DrawingTable,
} from "~/lukas/lib/drawing-workspace.types";
import { drawingAwarenessColor } from "~/lukas/lib/drawing-awareness";
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
};

const sourceSha256 = "a".repeat(64);
const createdAt = "2026-08-25T09:00:00.000Z";
const previewAlternateUserId = "00000000-0000-4000-8000-000000000006";
const previewRealtimeAdapter = createInertDrawingWorkspaceRealtimeAdapter();
const previewCollaborationPersistenceFactory = async () => null;
function previewCollaborationConnectionFactory(testPeers = false) {
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
    const peerTwo = ids.user;
    const states = new Map<number, unknown>(
      testPeers
        ? [
            [
              2,
              peer(
                peerOne,
                "김도윤",
                { x: 450, y: 310 },
                [objects[1].id],
                [
                  {
                    entityId: objects[1].id,
                    leaseId: "00000000-0000-4000-8000-000000000703",
                    expiresAt,
                  },
                ],
              ),
            ],
            [
              3,
              peer(
                peerTwo,
                "나",
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
};

/** Canonical P2 data kept entirely in process for development-only visual review. */
export function localDrawingWorkspacePreviewFixture(): PreviewFixture {
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
    canvases,
    layers,
    objects,
    styles: [styleWall, styleNote],
    blocks,
    blockInstances,
    propertySchemas,
    propertyValues,
    tables,
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
    issueLinks: [
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
  };
  return {
    capability: "editor",
    currentUserId: ids.user,
    roomUrl: "/workspace-preview",
    sourceUrl: null,
    workspace: {
      file: {
        id: ids.file,
        project_id: ids.project,
        kind: "pdf",
        original_filename: "근린생활시설_A-101.pdf",
        storage_path: "local-preview/rayon-a101.pdf",
        content_type: "application/pdf",
        byte_size: 1_048_576,
        sha256: sourceSha256,
        immutable: true,
        created_at: createdAt,
      },
      templateCandidates: [],
      document: {
        id: ids.document,
        project_id: ids.project,
        source_file_id: ids.file,
        source_sha256: sourceSha256,
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
  const fixture = localDrawingWorkspacePreviewFixture();
  validateLocalDrawingWorkspacePreviewFixture(fixture);
  const realtimeTest =
    new URL(request.url).searchParams.get("realtimeTest") === "1";
  const collaborationRetryTest =
    new URL(request.url).searchParams.get("collaborationRetryTest") === "1";
  const bootstrapReadOnlyTest =
    new URL(request.url).searchParams.get("bootstrapReadOnlyTest") === "1";
  const awarenessTest =
    new URL(request.url).searchParams.get("awarenessTest") === "1";
  const revision = fixture.workspace.document.revision;
  return {
    ...fixture,
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
  };
}

export async function action({ request }: Route.ActionArgs) {
  if (!isLocalPreviewRequest(request))
    return Response.json({ ok: false, error: "Not Found" }, { status: 404 });
  try {
    const mutation = parseWorkspaceMutation(await request.formData());
    if (mutation.intent !== "apply_operation")
      return Response.json(
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
      return Response.json(
        {
          ok: false,
          error: "현재 로컬 미리보기 revision의 작업만 반영됩니다.",
        },
        { status: 400 },
      );
    return Response.json({
      ok: true,
      clientOperationId: mutation.operation.clientOperationId,
    });
  } catch {
    return Response.json(
      { ok: false, error: "도면 작업 요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
}

export default function LocalDrawingWorkspacePreview({
  loaderData,
}: Route.ComponentProps) {
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
            : previewCollaborationConnectionFactory(loaderData.awarenessTest)
        }
        collaborationPersistenceFactory={
          loaderData.collaborationRetryTest
            ? retryPersistenceFactory
            : previewCollaborationPersistenceFactory
        }
        realtimeAdapter={
          loaderData.realtimeTest ? realtimeAdapter : previewRealtimeAdapter
        }
        previewHarness={
          loaderData.realtimeTest
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
        P3 공동 편집 미리보기 · 로컬 복구 사용
        {loaderData.awarenessTest ? (
          <>
            <output aria-label="로컬 advisory 잠금" className="sr-only">
              {previewSoftLockRequest ?? "없음"}
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
