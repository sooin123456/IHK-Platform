import assert from "node:assert/strict";
import test from "node:test";

const estimateModule = await import(
  "../app/lukas/lib/drawing-estimate.ts"
).catch(() => ({}));
const { drawingEstimateMetadataForSubject, drawingEstimateQuantityForSubject } =
  estimateModule;
const estimateServerModule = await import(
  "../app/lukas/lib/drawing-estimate.server.ts"
).catch(() => ({}));
const {
  bindDrawingEstimate,
  deriveDraftDrawingEstimateSummary,
  loadDrawingEstimateOptions,
  loadDrawingEstimateSummary,
} = estimateServerModule;

const ids = {
  revision: "20000000-0000-4000-8000-000000000001",
  page: "20000000-0000-4000-8000-000000000002",
  canvas: "20000000-0000-4000-8000-000000000003",
  layer: "20000000-0000-4000-8000-000000000004",
  object: "20000000-0000-4000-8000-000000000005",
  block: "20000000-0000-4000-8000-000000000006",
  classification: "20000000-0000-4000-8000-000000000011",
  trade: "20000000-0000-4000-8000-000000000012",
  itemCode: "20000000-0000-4000-8000-000000000013",
  evidenceKind: "20000000-0000-4000-8000-000000000014",
  evidenceReason: "20000000-0000-4000-8000-000000000015",
};

const schema = (id, name) => ({
  id,
  revisionId: ids.revision,
  name,
  valueType: name === "적산 분류" || name === "근거 상태" ? "enum" : "text",
  enumOptions:
    name === "적산 분류"
      ? ["바닥"]
      : name === "근거 상태"
        ? ["현장 실측", "가정값"]
        : [],
  appliesTo: ["line", "rectangle", "block_instance"],
  required: false,
  version: 1,
});
const schemas = [
  schema(ids.classification, "적산 분류"),
  schema(ids.trade, "공종"),
  schema(ids.itemCode, "품목 코드"),
  schema(ids.evidenceKind, "근거 상태"),
  schema(ids.evidenceReason, "근거 사유"),
  schema("20000000-0000-4000-8000-000000000016", "적산분류"),
];
const propertyValue = (id, schemaId, value, subject) => ({
  id,
  schemaId,
  objectId: subject.kind === "object" ? subject.id : null,
  blockInstanceId: subject.kind === "block_instance" ? subject.id : null,
  value,
  version: 1,
});
const objectSubject = { kind: "object", id: ids.object };
const blockSubject = { kind: "block_instance", id: ids.block };
const values = [
  propertyValue(
    "21000000-0000-4000-8000-000000000001",
    ids.classification,
    "바닥",
    objectSubject,
  ),
  propertyValue(
    "21000000-0000-4000-8000-000000000002",
    ids.trade,
    "마감",
    objectSubject,
  ),
  propertyValue(
    "21000000-0000-4000-8000-000000000003",
    ids.itemCode,
    "F-001",
    objectSubject,
  ),
  propertyValue(
    "21000000-0000-4000-8000-000000000004",
    ids.evidenceKind,
    "현장 실측",
    objectSubject,
  ),
  propertyValue(
    "21000000-0000-4000-8000-000000000005",
    ids.classification,
    "문",
    blockSubject,
  ),
  propertyValue(
    "21000000-0000-4000-8000-000000000006",
    ids.evidenceKind,
    "가정값",
    blockSubject,
  ),
  propertyValue(
    "21000000-0000-4000-8000-000000000007",
    ids.evidenceReason,
    "  현장 확인 필요  ",
    blockSubject,
  ),
  propertyValue(
    "21000000-0000-4000-8000-000000000008",
    "20000000-0000-4000-8000-000000000016",
    "천장",
    objectSubject,
  ),
];

const style = { stroke: "#000000", strokeWidth: 1, fill: null };
const line = {
  id: ids.object,
  name: "L-01",
  layerId: ids.layer,
  geometry: { type: "line", start: { x: 0, y: 0 }, end: { x: 3000, y: 4000 } },
  style,
  version: 1,
};
const rectangle = {
  ...line,
  geometry: {
    type: "rectangle",
    origin: { x: 0, y: 0 },
    width: 2000,
    height: 1000,
    rotation: 37,
  },
};
const blockInstance = {
  id: ids.block,
  lineageId: "20000000-0000-4000-8000-000000000007",
  blockId: "20000000-0000-4000-8000-000000000008",
  layerId: ids.layer,
  name: "Door 1",
  origin: { x: 0, y: 0 },
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  version: 1,
};
const canvas = (background = null) => ({
  id: ids.canvas,
  pageId: ids.page,
  name: "Paper",
  spaceKind: "paper",
  widthMillimeters: 100,
  heightMillimeters: 100,
  background,
  sortOrder: 0,
  version: 1,
});

function requireEstimate() {
  assert.equal(typeof drawingEstimateMetadataForSubject, "function");
  assert.equal(typeof drawingEstimateQuantityForSubject, "function");
}

test("metadata joins exact Korean schema names, IDs, and subject discriminators", () => {
  requireEstimate();
  assert.deepEqual(
    drawingEstimateMetadataForSubject(objectSubject, schemas, values),
    {
      classification: "바닥",
      trade: "마감",
      itemCode: "F-001",
      evidenceKind: "현장 실측",
      evidenceReason: null,
    },
  );
  assert.deepEqual(
    drawingEstimateMetadataForSubject(blockSubject, schemas, values),
    {
      classification: "문",
      trade: null,
      itemCode: null,
      evidenceKind: "가정값",
      evidenceReason: "현장 확인 필요",
    },
  );
  assert.throws(
    () =>
      drawingEstimateMetadataForSubject(objectSubject, schemas, [
        ...values,
        propertyValue(
          "21000000-0000-4000-8000-000000000009",
          ids.classification,
          "벽",
          objectSubject,
        ),
      ]),
    /duplicate|중복/i,
  );
});

test("classified object length, area, and classified subject counts derive exact estimate units", () => {
  requireEstimate();
  const metadata = drawingEstimateMetadataForSubject(
    objectSubject,
    schemas,
    values,
  );
  assert.deepEqual(
    drawingEstimateQuantityForSubject(
      { subject: objectSubject, object: line, canvas: canvas(), metadata },
      "m",
    ),
    { status: "ready", unit: "m", quantity: "5" },
  );
  assert.deepEqual(
    drawingEstimateQuantityForSubject(
      { subject: objectSubject, object: rectangle, canvas: canvas(), metadata },
      "m2",
    ),
    { status: "ready", unit: "m2", quantity: "2" },
  );
  assert.deepEqual(
    drawingEstimateQuantityForSubject(
      { subject: objectSubject, object: line, canvas: canvas(), metadata },
      "EA",
    ),
    { status: "ready", unit: "EA", quantity: "1" },
  );
  assert.deepEqual(
    drawingEstimateQuantityForSubject(
      {
        subject: blockSubject,
        blockInstance,
        canvas: canvas(),
        metadata: drawingEstimateMetadataForSubject(
          blockSubject,
          schemas,
          values,
        ),
      },
      "EA",
    ),
    { status: "ready", unit: "EA", quantity: "1" },
  );
});

test("missing evidence, unsupported units, and block length stay explicit review states", () => {
  requireEstimate();
  const metadata = drawingEstimateMetadataForSubject(
    objectSubject,
    schemas,
    values,
  );
  assert.deepEqual(
    drawingEstimateQuantityForSubject(
      { subject: objectSubject, object: line, canvas: canvas(), metadata },
      "m3",
    ),
    {
      status: "review",
      unit: "m3",
      reason: "검토 필요: 지원하지 않는 단위입니다",
    },
  );
  assert.deepEqual(
    drawingEstimateQuantityForSubject(
      {
        subject: blockSubject,
        blockInstance,
        canvas: canvas(),
        metadata: drawingEstimateMetadataForSubject(
          blockSubject,
          schemas,
          values,
        ),
      },
      "m",
    ),
    { status: "review", unit: "m", reason: "검토 필요: 길이 근거가 없습니다" },
  );
  assert.deepEqual(
    drawingEstimateQuantityForSubject(
      { subject: objectSubject, object: line, canvas: canvas(), metadata },
      "m2",
    ),
    { status: "review", unit: "m2", reason: "검토 필요: 면적 근거가 없습니다" },
  );
  assert.deepEqual(
    drawingEstimateQuantityForSubject(
      {
        subject: blockSubject,
        blockInstance,
        canvas: canvas(),
        metadata: {
          classification: "문",
          trade: null,
          itemCode: null,
          evidenceKind: "가정값",
          evidenceReason: " ",
        },
      },
      "EA",
    ),
    {
      status: "missing_evidence",
      unit: "EA",
      reason: "검토 필요: 가정 근거 사유가 없습니다",
    },
  );
});

test("PDF quantities require calibration and deterministically use normalized page coordinates", () => {
  requireEstimate();
  const pdfBackground = {
    sourceFileId: "20000000-0000-4000-8000-000000000009",
    sourceSha256: "a".repeat(64),
    pdfPageNumber: 1,
    calibration: null,
  };
  const pdfLine = {
    ...line,
    geometry: { type: "line", start: { x: 0, y: 0 }, end: { x: 50, y: 0 } },
  };
  const metadata = drawingEstimateMetadataForSubject(
    objectSubject,
    schemas,
    values,
  );
  assert.deepEqual(
    drawingEstimateQuantityForSubject(
      {
        subject: objectSubject,
        object: pdfLine,
        canvas: canvas(pdfBackground),
        metadata,
      },
      "m",
    ),
    {
      status: "missing_evidence",
      unit: "m",
      reason: "검토 필요: PDF 축척 근거가 없습니다",
    },
  );
  const calibrated = canvas({
    ...pdfBackground,
    calibration: {
      normalizedStart: { x: 0, y: 0 },
      normalizedEnd: { x: 1, y: 0 },
      realLengthMillimeters: 1000,
      millimetersPerNormalizedUnit: 1000,
    },
  });
  const first = drawingEstimateQuantityForSubject(
    { subject: objectSubject, object: pdfLine, canvas: calibrated, metadata },
    "m",
  );
  assert.deepEqual(first, { status: "ready", unit: "m", quantity: "0.5" });
  assert.equal(
    JSON.stringify(
      drawingEstimateQuantityForSubject(
        {
          subject: objectSubject,
          object: pdfLine,
          canvas: calibrated,
          metadata,
        },
        "m",
      ),
    ),
    JSON.stringify(first),
  );
});

test("anisotropic PDF calibration reviews shapes that no longer have an exact primitive representation", () => {
  requireEstimate();
  const metadata = drawingEstimateMetadataForSubject(
    objectSubject,
    schemas,
    values,
  );
  const calibrated = {
    ...canvas({
      sourceFileId: "20000000-0000-4000-8000-000000000009",
      sourceSha256: "a".repeat(64),
      pdfPageNumber: 1,
      calibration: {
        normalizedStart: { x: 0, y: 0 },
        normalizedEnd: { x: 1, y: 0 },
        realLengthMillimeters: 1000,
        millimetersPerNormalizedUnit: 1000,
      },
    }),
    widthMillimeters: 200,
    heightMillimeters: 100,
  };
  const cases = [
    {
      object: {
        ...rectangle,
        geometry: { ...rectangle.geometry, rotation: 37 },
      },
      units: ["m", "m2"],
    },
    {
      object: {
        ...line,
        geometry: {
          type: "circle",
          center: { x: 50, y: 50 },
          radius: 10,
        },
      },
      units: ["m", "m2"],
    },
    {
      object: {
        ...line,
        geometry: {
          type: "arc",
          semanticVersion: 1,
          center: { x: 50, y: 50 },
          radius: 10,
          startAngleDegrees: 0,
          sweepAngleDegrees: 90,
        },
      },
      units: ["m"],
    },
  ];
  for (const candidate of cases)
    for (const unit of candidate.units) {
      const result = drawingEstimateQuantityForSubject(
        {
          subject: objectSubject,
          object: candidate.object,
          canvas: calibrated,
          metadata,
        },
        unit,
      );
      assert.equal(result.status, "review");
      assert.match(result.reason, /검토 필요/);
    }
});

test("PDF opening and host use the same calibrated coordinate map without throwing", () => {
  requireEstimate();
  const metadata = drawingEstimateMetadataForSubject(
    objectSubject,
    schemas,
    values,
  );
  const hostId = "20000000-0000-4000-8000-000000000020";
  const host = {
    ...line,
    id: hostId,
    geometry: {
      type: "wall",
      semanticVersion: 1,
      start: { x: 0, y: 20 },
      end: { x: 100, y: 20 },
      thicknessMillimeters: 10,
      heightMillimeters: 30,
    },
  };
  const opening = {
    ...line,
    geometry: {
      type: "opening",
      semanticVersion: 1,
      hostWallId: hostId,
      offsetMillimeters: 20,
      widthMillimeters: 10,
      heightMillimeters: 10,
      sillHeightMillimeters: 0,
      openingKind: "door",
    },
  };
  const calibrated = {
    ...canvas({
      sourceFileId: "20000000-0000-4000-8000-000000000009",
      sourceSha256: "a".repeat(64),
      pdfPageNumber: 1,
      calibration: {
        normalizedStart: { x: 0, y: 0 },
        normalizedEnd: { x: 1, y: 0 },
        realLengthMillimeters: 1000,
        millimetersPerNormalizedUnit: 1000,
      },
    }),
    widthMillimeters: 200,
    heightMillimeters: 100,
  };
  assert.deepEqual(
    drawingEstimateQuantityForSubject(
      {
        subject: objectSubject,
        object: opening,
        objects: { [hostId]: host, [opening.id]: opening },
        canvas: calibrated,
        metadata,
      },
      "m",
    ),
    { status: "ready", unit: "m", quantity: "0.05" },
  );
  assert.deepEqual(
    drawingEstimateQuantityForSubject(
      {
        subject: objectSubject,
        object: opening,
        objects: { [hostId]: host, [opening.id]: opening },
        canvas: calibrated,
        metadata,
      },
      "m2",
    ),
    { status: "ready", unit: "m2", quantity: "0.005" },
  );
});

const estimateIds = {
  actor: "30000000-0000-4000-8000-000000000001",
  viewer: "30000000-0000-4000-8000-000000000002",
  owner: "30000000-0000-4000-8000-000000000003",
  project: "30000000-0000-4000-8000-000000000004",
  otherProject: "30000000-0000-4000-8000-000000000005",
  document: "30000000-0000-4000-8000-000000000006",
  revision: "30000000-0000-4000-8000-000000000007",
  binding: "30000000-0000-4000-8000-000000000008",
  version: "30000000-0000-4000-8000-000000000009",
  priceBook: "30000000-0000-4000-8000-000000000010",
  page: "30000000-0000-4000-8000-000000000011",
  canvas: "30000000-0000-4000-8000-000000000012",
  pdfCanvas: "30000000-0000-4000-8000-000000000013",
  layer: "30000000-0000-4000-8000-000000000014",
  pdfLayer: "30000000-0000-4000-8000-000000000015",
  wallFive: "30000000-0000-4000-8000-000000000021",
  wallTwo: "30000000-0000-4000-8000-000000000022",
  floor: "30000000-0000-4000-8000-000000000023",
  door: "30000000-0000-4000-8000-000000000024",
  wallLine: "30000000-0000-4000-8000-000000000031",
  floorLine: "30000000-0000-4000-8000-000000000032",
  doorLine: "30000000-0000-4000-8000-000000000033",
  wallResource: "30000000-0000-4000-8000-000000000041",
  floorResource: "30000000-0000-4000-8000-000000000042",
  wallComponent: "30000000-0000-4000-8000-000000000043",
  floorComponent: "30000000-0000-4000-8000-000000000044",
  classification: "30000000-0000-4000-8000-000000000051",
  trade: "30000000-0000-4000-8000-000000000052",
  itemCode: "30000000-0000-4000-8000-000000000053",
  evidenceKind: "30000000-0000-4000-8000-000000000054",
  evidenceReason: "30000000-0000-4000-8000-000000000055",
};

function requireServerEstimate() {
  assert.equal(typeof bindDrawingEstimate, "function");
  assert.equal(typeof deriveDraftDrawingEstimateSummary, "function");
  assert.equal(typeof loadDrawingEstimateOptions, "function");
  assert.equal(typeof loadDrawingEstimateSummary, "function");
}

const estimateSchemas = [
  schema(estimateIds.classification, "적산 분류"),
  schema(estimateIds.trade, "공종"),
  schema(estimateIds.itemCode, "품목 코드"),
  schema(estimateIds.evidenceKind, "근거 상태"),
  schema(estimateIds.evidenceReason, "근거 사유"),
].map((value) => ({ ...value, revisionId: estimateIds.revision }));

function estimateObject(id, layerId, geometry) {
  return { id, name: id, layerId, geometry, style, version: 1 };
}

function estimateValue(schemaId, value, kind, id, index) {
  return {
    id: `31000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    schemaId,
    objectId: kind === "object" ? id : null,
    blockInstanceId: kind === "block_instance" ? id : null,
    value,
    version: 1,
  };
}

function subjectValues(
  kind,
  id,
  classification,
  itemCode,
  evidence,
  reason,
  n,
) {
  return [
    estimateValue(estimateIds.classification, classification, kind, id, n),
    estimateValue(estimateIds.itemCode, itemCode, kind, id, n + 1),
    estimateValue(estimateIds.evidenceKind, evidence, kind, id, n + 2),
    ...(reason === undefined
      ? []
      : [estimateValue(estimateIds.evidenceReason, reason, kind, id, n + 3)]),
  ];
}

function estimateWorkspace(overrides = {}) {
  const canvases = [
    {
      id: estimateIds.canvas,
      pageId: estimateIds.page,
      name: "Canvas",
      spaceKind: "paper",
      widthMillimeters: 10000,
      heightMillimeters: 10000,
      background: null,
      sortOrder: 0,
      version: 1,
    },
  ];
  const layers = [
    {
      id: estimateIds.layer,
      name: "Work",
      visible: true,
      locked: false,
      systemKind: "work",
      canvasId: estimateIds.canvas,
      sortOrder: 0,
      version: 1,
    },
  ];
  const objects = [
    estimateObject(estimateIds.wallFive, estimateIds.layer, {
      type: "line",
      start: { x: 0, y: 0 },
      end: { x: 5000, y: 0 },
    }),
    estimateObject(estimateIds.wallTwo, estimateIds.layer, {
      type: "line",
      start: { x: 0, y: 0 },
      end: { x: 2000, y: 0 },
    }),
    estimateObject(estimateIds.floor, estimateIds.layer, {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 2000,
      height: 1000,
      rotation: 0,
    }),
  ];
  const blockInstances = [
    {
      id: estimateIds.door,
      lineageId: "30000000-0000-4000-8000-000000000025",
      blockId: "30000000-0000-4000-8000-000000000026",
      layerId: estimateIds.layer,
      name: "Door",
      origin: { x: 0, y: 0 },
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      version: 1,
    },
  ];
  const propertyValues = [
    ...subjectValues(
      "object",
      estimateIds.wallFive,
      "벽",
      "W-001",
      "현장 실측",
      undefined,
      1,
    ),
    ...subjectValues(
      "object",
      estimateIds.wallTwo,
      "벽",
      "W-001",
      "현장 실측",
      undefined,
      10,
    ),
    ...subjectValues(
      "object",
      estimateIds.floor,
      "바닥",
      "F-001",
      "가정값",
      "기존 마감 철거 전 현장 확인 필요",
      20,
    ),
    ...subjectValues(
      "block_instance",
      estimateIds.door,
      "문",
      "D-001",
      "현장 실측",
      undefined,
      30,
    ),
  ];
  return {
    primarySource: null,
    templateCandidates: [],
    document: {
      id: estimateIds.document,
      project_id: estimateIds.project,
      title: "견적 작업실",
      revision: {
        id: estimateIds.revision,
        project_id: estimateIds.project,
        status: "draft",
        version: 4,
        canvases,
        layers,
        objects,
        blockInstances,
        propertySchemas: estimateSchemas,
        propertyValues,
      },
    },
    ...overrides,
  };
}

function draftBoq(overrides = {}) {
  return {
    id: estimateIds.version,
    projectId: estimateIds.project,
    title: "실내건축 내역",
    versionNo: 3,
    status: "draft",
    engineVersion: "VERIFIED-BOQ-1.1",
    calculationPolicy: "general_half_away",
    quantityScale: 6,
    priceBook: { id: estimateIds.priceBook, name: "2026 회사 단가" },
    lines: [
      {
        id: estimateIds.doorLine,
        sectionCode: "01",
        itemCode: "D-001",
        itemName: "문",
        specification: "",
        unit: "EA",
        signedAdjustment: "0",
        adjustmentReason: "",
      },
      {
        id: estimateIds.floorLine,
        sectionCode: "01",
        itemCode: "F-001",
        itemName: "바닥 마감",
        specification: "",
        unit: "m2",
        signedAdjustment: "0",
        adjustmentReason: "",
      },
      {
        id: estimateIds.wallLine,
        sectionCode: "01",
        itemCode: "W-001",
        itemName: "벽체",
        specification: "",
        unit: "m",
        signedAdjustment: "0",
        adjustmentReason: "",
      },
    ],
    resources: [
      {
        id: estimateIds.wallResource,
        code: "W-RATE",
        type: "material",
        unit: "m",
        unitPriceKrw: "10000",
      },
      {
        id: estimateIds.floorResource,
        code: "F-RATE",
        type: "material",
        unit: "m2",
        unitPriceKrw: "30000",
      },
    ],
    components: [
      {
        id: estimateIds.wallComponent,
        lineId: estimateIds.wallLine,
        resourceId: estimateIds.wallResource,
        coefficient: "1",
      },
      {
        id: estimateIds.floorComponent,
        lineId: estimateIds.floorLine,
        resourceId: estimateIds.floorResource,
        coefficient: "1",
      },
    ],
    ...overrides,
  };
}

function draftBinding() {
  return {
    id: estimateIds.binding,
    projectId: estimateIds.project,
    drawingRevisionId: estimateIds.revision,
    boqVersionId: estimateIds.version,
    createdAt: "2026-08-31T00:00:00.000Z",
  };
}

test("draft estimate groups classified subjects through the exact BOQ engine", () => {
  requireServerEstimate();
  const summary = deriveDraftDrawingEstimateSummary({
    binding: draftBinding(),
    boq: draftBoq(),
    workspace: estimateWorkspace(),
  });
  assert.deepEqual(
    summary.rows.map((row) => ({
      itemCode: row.itemCode,
      quantity: row.quantity,
      unit: row.unit,
      amountKrw: row.amountKrw,
      state: row.state,
    })),
    [
      {
        itemCode: "D-001",
        quantity: "1",
        unit: "EA",
        amountKrw: null,
        state: "missing_evidence",
      },
      {
        itemCode: "F-001",
        quantity: "2",
        unit: "m2",
        amountKrw: "60000",
        state: "assumption",
      },
      {
        itemCode: "W-001",
        quantity: "7",
        unit: "m",
        amountKrw: "70000",
        state: "draft",
      },
    ],
  );
  assert.deepEqual(
    summary.rows.find((row) => row.itemCode === "W-001").subjectRefs,
    [
      { kind: "object", id: estimateIds.wallFive },
      { kind: "object", id: estimateIds.wallTwo },
    ],
  );
  assert.match(summary.rows[0].evidence[0].evidenceSha256, /^[0-9a-f]{64}$/);
  assert.equal(summary.directCostKrw, "130000");
  assert.equal(summary.missingRateCount, 1);
});

test("one missing subject makes its whole item group expose no partial quantity or amount", () => {
  requireServerEstimate();
  const workspace = estimateWorkspace();
  workspace.document.revision.canvases.push({
    id: estimateIds.pdfCanvas,
    pageId: estimateIds.page,
    name: "Uncalibrated PDF",
    spaceKind: "paper",
    widthMillimeters: 100,
    heightMillimeters: 100,
    background: {
      sourceFileId: "30000000-0000-4000-8000-000000000099",
      sourceSha256: "a".repeat(64),
      pdfPageNumber: 1,
      calibration: null,
    },
    sortOrder: 1,
    version: 1,
  });
  workspace.document.revision.layers.push({
    id: estimateIds.pdfLayer,
    name: "PDF work",
    visible: true,
    locked: false,
    systemKind: "work",
    canvasId: estimateIds.pdfCanvas,
    sortOrder: 1,
    version: 1,
  });
  workspace.document.revision.objects.find(
    (object) => object.id === estimateIds.wallTwo,
  ).layerId = estimateIds.pdfLayer;

  const row = deriveDraftDrawingEstimateSummary({
    binding: draftBinding(),
    boq: draftBoq(),
    workspace,
  }).rows.find((candidate) => candidate.itemCode === "W-001");
  assert.deepEqual(
    { quantity: row.quantity, amountKrw: row.amountKrw, state: row.state },
    { quantity: null, amountKrw: null, state: "missing_evidence" },
  );
  assert.equal(row.evidence.length, 2);
});

test("draft state precedence keeps assumption reasons and unsupported units explicit", () => {
  requireServerEstimate();
  const missingReason = estimateWorkspace();
  missingReason.document.revision.propertyValues =
    missingReason.document.revision.propertyValues.filter(
      (value) =>
        !(
          value.objectId === estimateIds.floor &&
          value.schemaId === estimateIds.evidenceReason
        ),
    );
  const missingRow = deriveDraftDrawingEstimateSummary({
    binding: draftBinding(),
    boq: draftBoq(),
    workspace: missingReason,
  }).rows.find((row) => row.itemCode === "F-001");
  assert.deepEqual(
    { amountKrw: missingRow.amountKrw, state: missingRow.state },
    { amountKrw: null, state: "missing_evidence" },
  );

  const unsupported = draftBoq({
    lines: draftBoq().lines.map((line) =>
      line.itemCode === "F-001" ? { ...line, unit: "m3" } : line,
    ),
  });
  const unsupportedRow = deriveDraftDrawingEstimateSummary({
    binding: draftBinding(),
    boq: unsupported,
    workspace: estimateWorkspace(),
  }).rows.find((row) => row.itemCode === "F-001");
  assert.deepEqual(
    {
      quantity: unsupportedRow.quantity,
      amountKrw: unsupportedRow.amountKrw,
      state: unsupportedRow.state,
    },
    { quantity: null, amountKrw: null, state: "needs_review" },
  );
});

test("classified codes absent from the BOQ remain sorted synthetic missing-evidence rows", () => {
  requireServerEstimate();
  const workspace = estimateWorkspace();
  workspace.document.revision.propertyValues.find(
    (value) =>
      value.objectId === estimateIds.floor &&
      value.schemaId === estimateIds.itemCode,
  ).value = "A-MISSING";
  const summary = deriveDraftDrawingEstimateSummary({
    binding: draftBinding(),
    boq: draftBoq(),
    workspace,
  });
  assert.equal(summary.rows[0].itemCode, "A-MISSING");
  assert.deepEqual(
    {
      quantity: summary.rows[0].quantity,
      amountKrw: summary.rows[0].amountKrw,
      state: summary.rows[0].state,
    },
    { quantity: null, amountKrw: null, state: "missing_evidence" },
  );
});

function estimateClient(
  tableRows,
  { insertError = null, insertedRow = null } = {},
) {
  const client = {
    tableRows,
    inserted: [],
    filters: [],
    limits: [],
    orders: [],
    from(table) {
      let values = Array.isArray(tableRows[table])
        ? [...tableRows[table]]
        : tableRows[table] == null
          ? []
          : [tableRows[table]];
      let limit = Infinity;
      let insertion = null;
      const orders = [];
      const result = (single = false, optional = false) => {
        let data = [...values];
        data.sort((left, right) => {
          for (const { column, ascending } of orders) {
            const a = left[column];
            const b = right[column];
            const compared = a < b ? -1 : a > b ? 1 : 0;
            if (compared) return ascending ? compared : -compared;
          }
          return 0;
        });
        data = data.slice(0, limit);
        if (insertion !== null) {
          if (insertError) return { data: null, error: insertError };
          data = [insertedRow ?? insertion];
        }
        if (!single) return { data, error: null };
        if (data.length === 1) return { data: data[0], error: null };
        if (optional && data.length === 0) return { data: null, error: null };
        return {
          data: null,
          error: { code: "PGRST116", message: "single row required" },
        };
      };
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          client.filters.push([table, column, value]);
          values = values.filter((row) => row[column] === value);
          return query;
        },
        in(column, selected) {
          values = values.filter((row) => selected.includes(row[column]));
          return query;
        },
        order(column, options = {}) {
          const ascending = options.ascending !== false;
          orders.push({ column, ascending });
          client.orders.push([table, column, ascending]);
          return query;
        },
        limit(size) {
          client.limits.push([table, size]);
          limit = size;
          return query;
        },
        insert(row) {
          insertion = row;
          client.inserted.push([table, row]);
          return query;
        },
        single() {
          return Promise.resolve(result(true));
        },
        maybeSingle() {
          return Promise.resolve(result(true, true));
        },
        then(resolve, reject) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return query;
    },
  };
  return client;
}

function bindingTables(role = "estimator") {
  return {
    lukas_qto_projects: [
      { id: estimateIds.project, owner_id: estimateIds.owner },
    ],
    lukas_qto_project_members: [
      { project_id: estimateIds.project, user_id: estimateIds.actor, role },
    ],
    lukas_drawing_revisions: [
      {
        id: estimateIds.revision,
        project_id: estimateIds.project,
        status: "draft",
      },
    ],
    lukas_qto_boq_versions: [
      {
        id: estimateIds.version,
        project_id: estimateIds.project,
        status: "draft",
        engine_version: "VERIFIED-BOQ-1.1",
      },
    ],
  };
}

test("binding validates actor capability and same-project drafts before insert-only persistence", async () => {
  requireServerEstimate();
  const insertedRow = {
    id: estimateIds.binding,
    project_id: estimateIds.project,
    drawing_revision_id: estimateIds.revision,
    boq_version_id: estimateIds.version,
    created_at: "2026-08-31T00:00:00.000Z",
  };
  const client = estimateClient(bindingTables(), { insertedRow });
  assert.deepEqual(
    await bindDrawingEstimate(client, estimateIds.actor, {
      projectId: estimateIds.project,
      drawingRevisionId: estimateIds.revision,
      boqVersionId: estimateIds.version,
    }),
    draftBinding(),
  );
  assert.deepEqual(client.inserted, [
    [
      "lukas_drawing_estimate_bindings",
      {
        project_id: estimateIds.project,
        drawing_revision_id: estimateIds.revision,
        boq_version_id: estimateIds.version,
        created_by: estimateIds.actor,
      },
    ],
  ]);
});

test("binding rejects Viewer, cross-project ancestry, and unique collisions without rebinding", async () => {
  requireServerEstimate();
  const viewer = estimateClient(bindingTables("viewer"));
  await assert.rejects(
    bindDrawingEstimate(viewer, estimateIds.actor, {
      projectId: estimateIds.project,
      drawingRevisionId: estimateIds.revision,
      boqVersionId: estimateIds.version,
    }),
    /권한|editor|편집/i,
  );
  assert.equal(viewer.inserted.length, 0);

  const crossProjectRows = bindingTables();
  crossProjectRows.lukas_drawing_revisions[0].project_id =
    estimateIds.otherProject;
  const crossProject = estimateClient(crossProjectRows);
  await assert.rejects(
    bindDrawingEstimate(crossProject, estimateIds.actor, {
      projectId: estimateIds.project,
      drawingRevisionId: estimateIds.revision,
      boqVersionId: estimateIds.version,
    }),
    /project|프로젝트|revision|개정/i,
  );
  assert.equal(crossProject.inserted.length, 0);

  const collision = estimateClient(bindingTables(), {
    insertError: { code: "23505", message: "unique conflict" },
  });
  await assert.rejects(
    bindDrawingEstimate(collision, estimateIds.actor, {
      projectId: estimateIds.project,
      drawingRevisionId: estimateIds.revision,
      boqVersionId: estimateIds.version,
    }),
    (error) => error?.name === "DrawingWorkspaceConflictError",
  );
  assert.equal(collision.inserted.length, 1);
});

test("estimate options are the latest 100 same-project draft 1.1 versions with exact price-book names", async () => {
  requireServerEstimate();
  const versions = Array.from({ length: 101 }, (_, index) => ({
    id: `32000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    project_id: estimateIds.project,
    title: `내역 ${index + 1}`,
    version_no: index + 1,
    status: "draft",
    engine_version: "VERIFIED-BOQ-1.1",
    created_at: `2026-08-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    price_book: { name: `단가 ${index + 1}` },
  }));
  versions.push({
    ...versions[0],
    id: "32000000-0000-4000-8000-999999999998",
    project_id: estimateIds.otherProject,
  });
  versions.push({
    ...versions[0],
    id: "32000000-0000-4000-8000-999999999999",
    status: "in_review",
  });
  const client = estimateClient({ lukas_qto_boq_versions: versions });
  const options = await loadDrawingEstimateOptions(client, estimateIds.project);
  assert.equal(options.length, 100);
  assert.equal(options[0].id, "32000000-0000-4000-8000-000000000084");
  assert.equal(options.at(-1).id, "32000000-0000-4000-8000-000000000029");
  assert.deepEqual(Object.keys(options[0]).sort(), [
    "id",
    "priceBookName",
    "title",
    "versionNo",
  ]);
  assert.equal(
    options.every((option) => option.priceBookName.startsWith("단가 ")),
    true,
  );
});

test("bound draft summary loads the scoped ordered bounded BOQ graph before deriving preview", async () => {
  requireServerEstimate();
  const boq = draftBoq();
  const sectionId = "30000000-0000-4000-8000-000000000061";
  const otherVersion = "30000000-0000-4000-8000-000000000062";
  const tables = {
    lukas_drawing_estimate_bindings: [
      {
        id: estimateIds.binding,
        project_id: estimateIds.project,
        drawing_revision_id: estimateIds.revision,
        boq_version_id: estimateIds.version,
        created_at: "2026-08-31T00:00:00.000Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000063",
        project_id: estimateIds.otherProject,
        drawing_revision_id: estimateIds.revision,
        boq_version_id: otherVersion,
        created_at: "2026-09-01T00:00:00.000Z",
      },
    ],
    lukas_qto_boq_versions: [
      {
        id: estimateIds.version,
        project_id: estimateIds.project,
        version_no: boq.versionNo,
        title: boq.title,
        status: "draft",
        engine_version: "VERIFIED-BOQ-1.1",
        price_book_id: estimateIds.priceBook,
        calculation_policy: boq.calculationPolicy,
        quantity_scale: boq.quantityScale,
        result_sha256: null,
        manifest_sha256: null,
        price_book: { name: boq.priceBook.name },
      },
      {
        id: otherVersion,
        project_id: estimateIds.otherProject,
        version_no: 99,
        title: "다른 프로젝트 내역",
        status: "draft",
        engine_version: "VERIFIED-BOQ-1.1",
        price_book_id: estimateIds.priceBook,
        calculation_policy: boq.calculationPolicy,
        quantity_scale: boq.quantityScale,
      },
    ],
    lukas_qto_price_books: [
      {
        id: estimateIds.priceBook,
        project_id: estimateIds.project,
        name: boq.priceBook.name,
      },
      {
        id: estimateIds.priceBook,
        project_id: estimateIds.otherProject,
        name: "다른 프로젝트 단가",
      },
    ],
    lukas_qto_boq_sections: [
      {
        id: sectionId,
        project_id: estimateIds.project,
        version_id: estimateIds.version,
        code: "01",
        sort_order: 1,
      },
      {
        id: "30000000-0000-4000-8000-000000000064",
        project_id: estimateIds.project,
        version_id: otherVersion,
        code: "99",
        sort_order: 0,
      },
    ],
    lukas_qto_boq_lines: boq.lines
      .map((line, index) => ({
        id: line.id,
        project_id: estimateIds.project,
        version_id: estimateIds.version,
        section_id: sectionId,
        item_code: line.itemCode,
        item_name: line.itemName,
        specification: line.specification,
        unit: line.unit,
        signed_adjustment: line.signedAdjustment,
        adjustment_reason: line.adjustmentReason,
        sort_order: 30 - index * 10,
      }))
      .concat({
        id: "30000000-0000-4000-8000-000000000065",
        project_id: estimateIds.otherProject,
        version_id: estimateIds.version,
        section_id: sectionId,
        item_code: "X-OTHER",
        item_name: "다른 프로젝트 품목",
        specification: "",
        unit: "m",
        signed_adjustment: "0",
        adjustment_reason: "",
        sort_order: 0,
      }),
    lukas_qto_boq_rate_components: boq.components
      .map((component) => ({
        id: component.id,
        project_id: estimateIds.project,
        version_id: estimateIds.version,
        line_id: component.lineId,
        resource_id: component.resourceId,
        coefficient: component.coefficient,
      }))
      .concat({
        id: "30000000-0000-4000-8000-000000000066",
        project_id: estimateIds.project,
        version_id: otherVersion,
        line_id: estimateIds.wallLine,
        resource_id: estimateIds.wallResource,
        coefficient: "100",
      }),
    lukas_qto_price_resources: boq.resources.map((resource) => ({
      id: resource.id,
      project_id: estimateIds.project,
      price_book_id: estimateIds.priceBook,
      resource_code: resource.code,
      resource_type: resource.type,
      unit: resource.unit,
      unit_price_krw: resource.unitPriceKrw,
    })),
  };
  const client = estimateClient(tables);

  const summary = await loadDrawingEstimateSummary(client, {
    actorId: estimateIds.actor,
    projectId: estimateIds.project,
    workspace: estimateWorkspace(),
  });

  assert.deepEqual(
    summary.rows.map((row) => [row.itemCode, row.quantity, row.amountKrw]),
    [
      ["D-001", "1", null],
      ["F-001", "2", "60000"],
      ["W-001", "7", "70000"],
    ],
  );
  assert.equal(summary.directCostKrw, "130000");
  assert.deepEqual(client.limits, [
    ["lukas_drawing_estimate_bindings", 1],
    ["lukas_qto_boq_versions", 1],
    ["lukas_qto_boq_sections", 1001],
    ["lukas_qto_boq_lines", 1001],
    ["lukas_qto_boq_rate_components", 5001],
    ["lukas_qto_price_resources", 5001],
  ]);
  assert.deepEqual(
    client.orders.filter(([table]) =>
      [
        "lukas_qto_boq_sections",
        "lukas_qto_boq_lines",
        "lukas_qto_boq_rate_components",
        "lukas_qto_price_resources",
      ].includes(table),
    ),
    [
      ["lukas_qto_boq_sections", "sort_order", true],
      ["lukas_qto_boq_sections", "code", true],
      ["lukas_qto_boq_sections", "id", true],
      ["lukas_qto_boq_lines", "sort_order", true],
      ["lukas_qto_boq_lines", "item_code", true],
      ["lukas_qto_boq_lines", "id", true],
      ["lukas_qto_boq_rate_components", "line_id", true],
      ["lukas_qto_boq_rate_components", "id", true],
      ["lukas_qto_price_resources", "resource_code", true],
      ["lukas_qto_price_resources", "id", true],
    ],
  );
  assert.equal(
    client.filters.some(
      (filter) =>
        filter[0] === "lukas_qto_boq_rate_components" &&
        filter[1] === "version_id" &&
        filter[2] === estimateIds.version,
    ),
    true,
  );
  assert.equal(
    client.filters.some(
      (filter) =>
        filter[0] === "lukas_qto_price_resources" &&
        filter[1] === "project_id" &&
        filter[2] === estimateIds.project,
    ),
    true,
  );
});

function guardedBoundVersionRows(versionOverrides) {
  return new Proxy(
    {
      lukas_drawing_estimate_bindings: [
        {
          id: estimateIds.binding,
          project_id: estimateIds.project,
          drawing_revision_id: estimateIds.revision,
          boq_version_id: estimateIds.version,
          created_at: "2026-08-31T00:00:00.000Z",
        },
      ],
      lukas_qto_boq_versions: [
        {
          id: estimateIds.version,
          project_id: estimateIds.project,
          version_no: 3,
          title: "검토 내역",
          status: "draft",
          engine_version: "VERIFIED-BOQ-1.1",
          price_book_id: estimateIds.priceBook,
          calculation_policy: "general_half_away",
          quantity_scale: 6,
          result_sha256: null,
          manifest_sha256: null,
          price_book: { name: "검토 단가" },
          ...versionOverrides,
        },
      ],
    },
    {
      get(target, table, receiver) {
        if (Reflect.has(target, table))
          return Reflect.get(target, table, receiver);
        throw new Error(
          `unexpected estimate authority table: ${String(table)}`,
        );
      },
    },
  );
}

const unreachableApprovedEstimateAuthority = {
  async loadApprovedExport() {
    throw new Error("unexpected approved estimate authority");
  },
};

async function loadGuardedBoundVersion(versionOverrides) {
  return loadDrawingEstimateSummary(
    estimateClient(guardedBoundVersionRows(versionOverrides)),
    {
      actorId: estimateIds.actor,
      projectId: estimateIds.project,
      workspace: estimateWorkspace(),
    },
    unreachableApprovedEstimateAuthority,
  );
}

test("bound draft with a non-1.1 engine stops at bounded review before draft or approved authority", async () => {
  const summary = await loadGuardedBoundVersion({
    engine_version: "VERIFIED-BOQ-1.0",
  });

  assert.deepEqual(summary, {
    status: "needs_review",
    binding: draftBinding(),
    boq: {
      id: estimateIds.version,
      title: "검토 내역",
      versionNo: 3,
      priceBookName: "검토 단가",
      status: "draft",
      engineVersion: "VERIFIED-BOQ-1.0",
    },
    rows: [],
    directCostKrw: "0",
    missingRateCount: 0,
    reviewCount: 1,
  });
});

test("bound 1.1 version with an unsupported status stops at bounded review before draft or approved authority", async () => {
  const summary = await loadGuardedBoundVersion({ status: "in_review" });

  assert.deepEqual(summary, {
    status: "needs_review",
    binding: draftBinding(),
    boq: {
      id: estimateIds.version,
      title: "검토 내역",
      versionNo: 3,
      priceBookName: "검토 단가",
      status: "in_review",
      engineVersion: "VERIFIED-BOQ-1.1",
    },
    rows: [],
    directCostKrw: "0",
    missingRateCount: 0,
    reviewCount: 1,
  });
});

test("summary loading returns the exact unbound neutral shape without BOQ authority", async () => {
  requireServerEstimate();
  const summary = await loadDrawingEstimateSummary(
    estimateClient({ lukas_drawing_estimate_bindings: [] }),
    {
      actorId: estimateIds.actor,
      projectId: estimateIds.project,
      workspace: estimateWorkspace(),
    },
  );
  assert.deepEqual(summary, {
    status: "unbound",
    binding: null,
    boq: null,
    rows: [],
    directCostKrw: "0",
    missingRateCount: 0,
    reviewCount: 0,
  });
});
