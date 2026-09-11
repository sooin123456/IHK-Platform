import { createHash } from "node:crypto";
import { buildNativeDrawingDwgImportPlan } from "../../app/lukas/lib/drawing-native-dwg-import-plan.server.ts";

export const uuid = (n) =>
  `93000000-0000-4000-8900-${String(n).padStart(12, "0")}`;
export const hash = (s) => createHash("sha256").update(s).digest("hex");
const unavailable = (error) =>
  error.code === "NATIVE_DWG_RESAVE_SOURCE_UNAVAILABLE";

// Literal approved data: cm LINE (1,2) → (3,4) projects to mm (10,20) → (30,40).
// Independent current IDs represent a trusted clone; only source anchors bind it.
export function fixture() {
  const report = {
    schemaVersion: "1hk-dwg-import/1",
    qualification: "experimental-unqualified",
    source: { sha256: "b".repeat(64), byteSize: 1234, headerVersion: "AC1024" },
    engine: { name: "ACadSharp", version: "3.7.1" },
    coordinateSystem: "WCS_NATIVE_UNITS",
    unitCode: 5,
    modelSpaceHandle: "1F",
    layers: [{ handle: "10", name: "0", visible: true, locked: false }],
    entities: [
      {
        handle: "2A",
        ownerHandle: "1F",
        layerHandle: "10",
        type: "LINE",
        geometry: { start: [1, 2, 0], end: [3, 4, 0] },
      },
    ],
    coverage: {
      modelSpaceEntities: 1,
      importedEntities: 1,
      unsupportedEntities: 0,
      nonModelSpaceEntities: 0,
    },
    unsupported: [],
    readerNotificationCount: 0,
  };
  const reportText = JSON.stringify(report),
    reportSha256 = hash(reportText);
  const canonical = {
    schemaVersion: 2,
    revision: {
      id: uuid(3),
      projectId: uuid(1),
      documentId: uuid(2),
      sequence: 2,
      version: 7,
    },
    operationSequence: 19,
    pages: [
      {
        id: uuid(4),
        revisionId: uuid(3),
        name: "Page",
        sortOrder: 0,
        version: 1,
      },
    ],
    canvases: [
      {
        id: uuid(5),
        pageId: uuid(4),
        name: "Canvas",
        spaceKind: "paper",
        widthMillimeters: 21000,
        heightMillimeters: 14850,
        background: null,
        outputProfile: {
          paper: "A3",
          orientation: "landscape",
          widthMillimeters: 420,
          heightMillimeters: 297,
          scaleDenominator: 50,
        },
        sortOrder: 0,
        version: 1,
      },
    ],
    layers: [
      {
        id: uuid(6),
        canvasId: uuid(5),
        pageId: uuid(4),
        name: "0",
        visible: true,
        locked: false,
        systemKind: "custom",
        sortOrder: 1,
        version: 2,
      },
      {
        id: uuid(16),
        canvasId: uuid(5),
        pageId: uuid(4),
        name: "Work",
        visible: true,
        locked: false,
        systemKind: "work",
        sortOrder: 0,
        version: 1,
      },
    ],
    objects: [
      {
        id: uuid(7),
        lineageId: uuid(17),
        pageId: uuid(4),
        type: "line",
        name: "DWG LINE 2A",
        layerId: uuid(6),
        geometry: {
          type: "line",
          start: { x: 10, y: 20 },
          end: { x: 30, y: 40 },
        },
        styleId: null,
        style: { stroke: "#111827", strokeWidth: 1, fill: null },
        version: 3,
      },
    ],
    sources: [
      {
        id: uuid(8),
        objectId: uuid(7),
        revisionId: uuid(3),
        sourceFileId: uuid(9),
        sourceSha256: report.source.sha256,
        sourceKind: "dwg_entity",
        analysisJobId: uuid(10),
        reportSha256,
        handle: "2A",
        ownerHandle: "1F",
        layerHandle: "10",
        entityType: "LINE",
        sourceLayer: "0",
        unitCode: 5,
        unitSource: "declared",
        importerVersion: 1,
        version: 3,
      },
    ],
    styles: [],
    blocks: [],
    blockInstances: [],
    propertySchemas: [],
    propertyValues: [],
    tables: [],
    issues: [],
  };
  const payload = {
    approved: {
      projectId: uuid(1),
      documentId: uuid(2),
      canvasId: uuid(5),
      revision: { id: uuid(3), sequence: 2, version: 7, status: "approved" },
      snapshot: {
        sha256: "",
        schemaVersion: 2,
        operationSequence: 19,
        canonicalJsonText: "",
      },
      approvalDecision: "approved",
    },
    analysis: {
      scope: {
        projectId: uuid(1),
        documentId: uuid(12),
        revisionId: uuid(13),
        canvasId: uuid(15),
        sourceFileId: uuid(9),
        sourceSha256: report.source.sha256,
        unitOverride: null,
      },
      result: {
        receipt: {
          jobId: uuid(10),
          attemptNumber: 1,
          readerImageId: "sha256:" + "a".repeat(64),
          reportSha256,
          reportByteSize: Buffer.byteLength(reportText),
          source: {
            verificationId: uuid(11),
            fileId: uuid(9),
            ...report.source,
          },
          qualification: "experimental-unqualified",
          persistenceAuthority: "not-issued",
        },
        reportText,
      },
    },
  };
  const scope = {
    projectId: uuid(1),
    documentId: uuid(2),
    revisionId: uuid(3),
    revisionVersion: 7,
    canvasId: uuid(5),
    snapshotSha256: "",
  };
  const rehash = () => {
    payload.approved.snapshot.canonicalJsonText = JSON.stringify(canonical);
    scope.snapshotSha256 = payload.approved.snapshot.sha256 = hash(
      payload.approved.snapshot.canonicalJsonText,
    );
  };
  rehash();
  return { scope, payload, canonical, report, rehash };
}

export function allFiveEntityFixture() {
  const f = fixture();
  f.report.entities.push(
    {
      handle: "3",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "TEXT",
      geometry: { insert: [1, 2, 0], height: 2, text: "Base" },
    },
    {
      handle: "4",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "LWPOLYLINE",
      geometry: {
        points: [
          [0, 0, 0],
          [2, 3, 0],
        ],
        closed: false,
      },
    },
    {
      handle: "5",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "CIRCLE",
      geometry: { center: [4, 5, 0], radius: 2 },
    },
    {
      handle: "6",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "ARC",
      geometry: {
        center: [7, 8, 0],
        radius: 3,
        startAngleRadians: 0.25,
        endAngleRadians: 2.5,
      },
    },
  );
  f.report.coverage.modelSpaceEntities = f.report.coverage.importedEntities = 5;
  const result = f.payload.analysis.result;
  result.reportText = JSON.stringify(f.report);
  result.receipt.reportSha256 = hash(result.reportText);
  result.receipt.reportByteSize = Buffer.byteLength(result.reportText);
  const plan = buildNativeDrawingDwgImportPlan({
    report: f.report,
    expectedSource: f.report.source,
    revisionId: uuid(3),
    canvasId: uuid(5),
    sourceFileId: uuid(9),
    analysisJobId: uuid(10),
    reportSha256: result.receipt.reportSha256,
  });
  Object.assign(f.payload.analysis.scope, {
    documentId: uuid(2),
    revisionId: uuid(3),
    canvasId: uuid(5),
  });
  f.canonical.layers = plan.layers.map((layer) => ({
    ...layer,
    pageId: uuid(4),
  }));
  f.canonical.objects = plan.objects.map((object, index) => ({
    ...object,
    lineageId: uuid(30 + index),
    pageId: uuid(4),
    type: object.geometry.type,
  }));
  f.canonical.sources = structuredClone(plan.sources);
  f.rehash();
  return f;
}
