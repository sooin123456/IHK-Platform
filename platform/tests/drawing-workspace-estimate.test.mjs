import assert from "node:assert/strict";
import test from "node:test";

const estimateModule = await import(
  "../app/lukas/lib/drawing-estimate.ts"
).catch(() => ({}));
const { drawingEstimateMetadataForSubject, drawingEstimateQuantityForSubject } =
  estimateModule;

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
