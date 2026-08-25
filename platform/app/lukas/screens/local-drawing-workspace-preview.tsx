import type { Route } from "./+types/local-drawing-workspace-preview";

import DrawingWorkspaceClient from "~/lukas/components/drawing-workspace.client";
import { localWorkspacePreviewTarget } from "~/features/auth/lib/local-workspace-preview.server";
import { hydrateDrawingDocumentState } from "~/lukas/lib/drawing-document-store.client";
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
        original_filename: "Rayon_근린생활시설_A-101.pdf",
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
        title: "Rayon / 1HK P2 도면 작업실",
        created_by: ids.user,
        created_at: createdAt,
        updated_at: createdAt,
        revision,
      },
    },
  } as unknown as PreviewFixture;
}

/** Hydrates the production P2 client graph and verifies source binding before render. */
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
  return hydrateDrawingDocumentState({
    revisionId: revision.id,
    pages: revision.pages as unknown as DrawingPage[],
    canvases: revision.canvases ?? [],
    layers: (revision.layers as DrawingLayer[]).map(
      (layer) =>
        ({
          ...layer,
          canvasId: layer.canvasId!,
          sortOrder: layer.sortOrder!,
        }) as DrawingStructureLayer,
    ),
    objects: revision.objects as DrawingObject[],
    styles: revision.styles ?? [],
    blocks: revision.blocks ?? [],
    blockInstances: revision.blockInstances ?? [],
    propertySchemas: revision.propertySchemas ?? [],
    propertyValues: revision.propertyValues ?? [],
    tables: revision.tables ?? [],
  });
}

export const meta: Route.MetaFunction = () => [
  { title: "P2 로컬 도면 작업실 미리보기 | 1HK Platform" },
];

function isLocalPreviewRequest(request: Request) {
  return Boolean(localWorkspacePreviewTarget(request.url));
}

export function loader({ request }: Route.LoaderArgs) {
  if (!isLocalPreviewRequest(request))
    throw new Response("Not Found", { status: 404 });
  const fixture = localDrawingWorkspacePreviewFixture();
  validateLocalDrawingWorkspacePreviewFixture(fixture);
  return fixture;
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
  return (
    <>
      <DrawingWorkspaceClient {...loaderData} />
      <aside
        className="fixed bottom-3 right-3 z-50 rounded-full bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 shadow-lg"
        role="status"
      >
        P2 로컬 기능 미리보기 · 서버 저장 안 됨
      </aside>
    </>
  );
}
