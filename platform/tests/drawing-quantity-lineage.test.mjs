import assert from "node:assert/strict";
import test from "node:test";

import {
  P6LineageError,
  convertDrawingMeasurement,
  deriveP6MaterialPlans,
  drawingObjectFingerprintSha256,
} from "../app/lukas/lib/drawing-quantity-lineage.ts";

const measurement = {
  ruleVersion: "P4_MEASUREMENT_V1",
  lengthMillimeters: "1234.567891",
  areaSquareMillimeters: "2500000.123456",
  count: "1",
};

const unavailable = {
  ruleVersion: "P4_MEASUREMENT_V1",
  lengthMillimeters: null,
  areaSquareMillimeters: null,
  count: "1",
};

const wallObject = {
  id: "00000000-0000-4000-8000-000000000101",
  name: "W-01",
  layerId: "00000000-0000-4000-8000-000000000102",
  geometry: {
    type: "wall",
    semanticVersion: 1,
    start: { x: 0, y: 0 },
    end: { x: 1000, y: 0 },
    thicknessMillimeters: 200,
    heightMillimeters: 3000,
  },
  styleId: null,
  style: {},
  version: 1,
};

const materialA = {
  boqVersionId: "00000000-0000-4000-8000-000000000201",
  lineId: "00000000-0000-4000-8000-000000000202",
  rateComponentId: "00000000-0000-4000-8000-000000000203",
  resourceId: "00000000-0000-4000-8000-000000000204",
  resourceCode: "M-001",
  resourceName: "석고보드",
  resourceSpecification: "12.5T",
  resourceUnit: "m2",
  resourceCoefficient: "1.234567",
  finalQuantity: "10",
};

const materialB = {
  ...materialA,
  rateComponentId: "00000000-0000-4000-8000-000000000205",
  resourceCoefficient: "0.2962975",
};

function p6Code(error) {
  assert.ok(error instanceof P6LineageError);
  return error.code;
}

test("P6 converts P4 length, area, and count exactly", () => {
  assert.deepEqual(convertDrawingMeasurement(measurement, "length"), {
    measurementKind: "length",
    rawQuantity: "1.234567891",
    unit: "m",
    measurementRuleVersion: "P4_MEASUREMENT_V1",
  });
  assert.equal(
    convertDrawingMeasurement(measurement, "area").rawQuantity,
    "2.500000123456",
  );
  assert.equal(convertDrawingMeasurement(measurement, "count").rawQuantity, "1");
  assert.equal(
    convertDrawingMeasurement(
      {
        ruleVersion: "P4_MEASUREMENT_V1",
        lengthMillimeters: "0.000001",
        areaSquareMillimeters: "0.000001",
        count: "1",
      },
      "length",
    ).rawQuantity,
    "0.000000001",
  );
  assert.equal(
    convertDrawingMeasurement(
      {
        ruleVersion: "P4_MEASUREMENT_V1",
        lengthMillimeters: "0",
        areaSquareMillimeters: "0.000001",
        count: "1",
      },
      "area",
    ).rawQuantity,
    "0.000000000001",
  );
  assert.equal(
    convertDrawingMeasurement(
      {
        ruleVersion: "P4_MEASUREMENT_V1",
        lengthMillimeters: null,
        areaSquareMillimeters: "12345678901234567890123.123456",
        count: "1",
      },
      "area",
    ).rawQuantity,
    "12345678901234567.890123123456",
  );
});

test("P6 rejects unavailable, wrong-rule, and volume measurements", () => {
  for (const [value, kind] of [
    [unavailable, "length"],
    [unavailable, "area"],
    [measurement, "volume"],
    [measurement, "m3"],
    [{ ...measurement, ruleVersion: "P4_MEASUREMENT_V0" }, "count"],
  ])
    assert.throws(
      () => convertDrawingMeasurement(value, kind),
      (error) => p6Code(error) === "P6Q01",
    );
});

test("P6 conversion rejects quantities outside the approved numeric(29,12) contract", () => {
  for (const [value, kind] of [
    [
      {
        ruleVersion: "P4_MEASUREMENT_V1",
        lengthMillimeters: "-1",
        areaSquareMillimeters: null,
        count: "1",
      },
      "length",
    ],
    [
      {
        ruleVersion: "P4_MEASUREMENT_V1",
        lengthMillimeters: null,
        areaSquareMillimeters: null,
        count: "2",
      },
      "count",
    ],
    [
      {
        ruleVersion: "P4_MEASUREMENT_V1",
        lengthMillimeters: null,
        areaSquareMillimeters: null,
        count: "1.0",
      },
      "count",
    ],
    [
      {
        ruleVersion: "P4_MEASUREMENT_V1",
        lengthMillimeters: null,
        areaSquareMillimeters: "0.0000001",
        count: "1",
      },
      "area",
    ],
    [
      {
        ruleVersion: "P4_MEASUREMENT_V1",
        lengthMillimeters: "100000000000000000000",
        areaSquareMillimeters: null,
        count: "1",
      },
      "length",
    ],
  ])
    assert.throws(
      () => convertDrawingMeasurement(value, kind),
      (error) => p6Code(error) === "P6Q01",
    );
});

test("P6 fingerprints the existing canonical P4 object fingerprint", () => {
  const digest = drawingObjectFingerprintSha256(wallObject);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(
    digest,
    drawingObjectFingerprintSha256(structuredClone(wallObject)),
  );
  assert.notEqual(
    digest,
    drawingObjectFingerprintSha256({ ...wallObject, version: 2 }),
  );
});

test("P6 derives exact material quantities with six-place half-away rounding", () => {
  const [plan] = deriveP6MaterialPlans([materialB, materialA]);
  assert.deepEqual(plan, {
    materialCode: "M-001",
    materialName: "석고보드",
    specification: "12.5T",
    unit: "m2",
    designQuantity: "15.308645",
    allowanceRate: "0",
    requiredQuantity: "15.308645",
    ruleId: "P6_MATERIAL_HANDOFF_V1",
    components: [
      {
        rateComponentId: "00000000-0000-4000-8000-000000000203",
        derivedDesignQuantity: "12.34567",
      },
      {
        rateComponentId: "00000000-0000-4000-8000-000000000205",
        derivedDesignQuantity: "2.962975",
      },
    ],
  });
  assert.equal(
    deriveP6MaterialPlans([
      { ...materialA, finalQuantity: "0", resourceCoefficient: "0" },
    ])[0].designQuantity,
    "0",
  );
  assert.equal(
    deriveP6MaterialPlans([
      { ...materialA, finalQuantity: "1", resourceCoefficient: "0.0000005" },
    ])[0].designQuantity,
    "0.000001",
  );
});

test("P6 preserves an intentionally blank material specification", () => {
  const [plan] = deriveP6MaterialPlans([
    { ...materialA, resourceSpecification: "" },
  ]);
  assert.equal(plan.specification, "");
  assert.equal(plan.designQuantity, "12.34567");
});

test("P6 material handoff rejects incompatible, duplicate, negative, and overflowing components", () => {
  for (const components of [
    [materialA, { ...materialA }],
    [{ ...materialA, resourceSpecification: undefined }],
    [{ ...materialA, resourceSpecification: "x".repeat(201) }],
    ...["resourceCode", "resourceName", "resourceSpecification", "resourceUnit"].map(
      (field) => [
        materialA,
        { ...materialB, [field]: `다른-${field}` },
      ],
    ),
    [{ ...materialA, finalQuantity: "-1" }],
    [
      {
        ...materialA,
        finalQuantity: "99999999999999999999999999999",
        resourceCoefficient: "99999999999999999999999999999",
      },
    ],
  ])
    assert.throws(
      () => deriveP6MaterialPlans(components),
      (error) => p6Code(error) === "P6M01",
    );
});

test("P6 rejects conflicting material identities in either input order", () => {
  const first = {
    ...materialA,
    resourceId: "00000000-0000-4000-8000-000000000210",
  };
  const second = {
    ...materialB,
    resourceId: "00000000-0000-4000-8000-000000000211",
    resourceName: "다른 석고보드",
  };
  for (const components of [
    [first, second],
    [second, first],
  ])
    assert.throws(
      () => deriveP6MaterialPlans(components),
      (error) => p6Code(error) === "P6M01",
    );
});

test("P6 material plans are bytewise sorted and byte-identical across 100 runs", () => {
  const components = [
    {
      ...materialA,
      resourceId: "00000000-0000-4000-8000-000000000206",
      resourceCode: "Z-001",
      resourceSpecification: "B",
    },
    {
      ...materialB,
      resourceId: "00000000-0000-4000-8000-000000000207",
      resourceCode: "A-002",
      resourceSpecification: "Z",
    },
    {
      ...materialA,
      rateComponentId: "00000000-0000-4000-8000-000000000209",
      resourceId: "00000000-0000-4000-8000-000000000208",
      resourceCode: "A-001",
      resourceSpecification: "A",
    },
  ];
  const expected = JSON.stringify(deriveP6MaterialPlans(components));
  assert.deepEqual(
    deriveP6MaterialPlans(components).map((plan) => plan.materialCode),
    ["A-001", "A-002", "Z-001"],
  );
  for (let run = 0; run < 100; run += 1)
    assert.equal(JSON.stringify(deriveP6MaterialPlans(components)), expected);
});
