import assert from "node:assert/strict";
import test from "node:test";

const measurementModule = await import(
  "../app/lukas/lib/drawing-measurements.ts"
).catch(() => ({}));
const {
  DRAWING_MEASUREMENT_RULE_VERSION,
  formatDrawingMeasurement,
  measureDrawingObject,
} = measurementModule;

const HOST_ID = "00000000-0000-4000-8000-000000000201";
const LAYER_ID = "00000000-0000-4000-8000-000000000202";
const ids = {
  line: "00000000-0000-4000-8000-000000000212",
  closed: "00000000-0000-4000-8000-000000000213",
  openLength: "00000000-0000-4000-8000-000000000214",
  closedLength: "00000000-0000-4000-8000-000000000215",
  rectangle: "00000000-0000-4000-8000-000000000216",
  circle: "00000000-0000-4000-8000-000000000217",
};
const style = { stroke: "#000000", strokeWidth: 1, fill: null };

function object(id, geometry, name = geometry.type) {
  return { id, name, layerId: LAYER_ID, geometry, style, version: 1 };
}

const wallGeometry = {
  type: "wall",
  semanticVersion: 1,
  start: { x: 0, y: 0 },
  end: { x: 3000, y: 4000 },
  thicknessMillimeters: 200,
  heightMillimeters: 3000,
};
const wallObject = object(HOST_ID, wallGeometry);
const objects = { [HOST_ID]: wallObject };

function requireKernel() {
  assert.equal(DRAWING_MEASUREMENT_RULE_VERSION, "P4_MEASUREMENT_V1");
  assert.equal(typeof measureDrawingObject, "function");
  assert.equal(typeof formatDrawingMeasurement, "function");
}

test("3-4-5 wall and diagonal grid lengths round to micromillimeters", () => {
  requireKernel();
  assert.deepEqual(measureDrawingObject(wallObject, objects), {
    ruleVersion: "P4_MEASUREMENT_V1",
    lengthMillimeters: "5000",
    areaSquareMillimeters: null,
    count: "1",
  });
  assert.deepEqual(
    measureDrawingObject(
      object("00000000-0000-4000-8000-000000000203", {
        type: "grid",
        semanticVersion: 1,
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
      }),
      objects,
    ),
    {
      ruleVersion: "P4_MEASUREMENT_V1",
      lengthMillimeters: "1.414214",
      areaSquareMillimeters: null,
      count: "1",
    },
  );
});

test("primitive line, polyline, rectangle, and circle measurements are exact", () => {
  requireKernel();
  assert.deepEqual(
    measureDrawingObject(
      object(ids.line, {
        type: "line",
        start: { x: 0, y: 0 },
        end: { x: 3000, y: 4000 },
      }),
    ),
    {
      ruleVersion: "P4_MEASUREMENT_V1",
      lengthMillimeters: "5000",
      areaSquareMillimeters: null,
      count: "1",
    },
  );
  assert.equal(
    measureDrawingObject(
      object(ids.closed, {
        type: "polyline",
        points: [
          { x: 0, y: 0 },
          { x: 2000, y: 0 },
          { x: 2000, y: 1000 },
          { x: 0, y: 1000 },
        ],
        closed: true,
      }),
    ).areaSquareMillimeters,
    "2000000",
  );
  for (const [closed, expected] of [
    [false, "7000"],
    [true, "12000"],
  ]) {
    assert.equal(
      measureDrawingObject(
        object(closed ? ids.closedLength : ids.openLength, {
          type: "polyline",
          points: [
            { x: 0, y: 0 },
            { x: 3000, y: 0 },
            { x: 3000, y: 4000 },
          ],
          closed,
        }),
      ).lengthMillimeters,
      expected,
    );
  }
  assert.equal(
    measureDrawingObject(
      object(ids.rectangle, {
        type: "rectangle",
        origin: { x: 0, y: 0 },
        width: 2500,
        height: 1200,
        rotation: 37,
      }),
    ).areaSquareMillimeters,
    "3000000",
  );
  assert.equal(
    measureDrawingObject(
      object(ids.rectangle, {
        type: "rectangle",
        origin: { x: 0, y: 0 },
        width: 2500,
        height: 1200,
        rotation: 37,
      }),
    ).lengthMillimeters,
    "7400",
  );
  const circleMeasurement = measureDrawingObject(
    object(ids.circle, {
      type: "circle",
      center: { x: 0, y: 0 },
      radius: 1000,
    }),
  );
  assert.equal(circleMeasurement.areaSquareMillimeters, "3141592.65359");
  assert.equal(circleMeasurement.lengthMillimeters, "6283.185307");
  assert.equal(
    measureDrawingObject(
      object(ids.openLength, {
        type: "polyline",
        points: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 0, y: 0 },
        ],
        closed: false,
      }),
    ).areaSquareMillimeters,
    null,
  );
});

test("opening measurement is clear width and width times height", () => {
  requireKernel();
  const openingObject = object("00000000-0000-4000-8000-000000000204", {
    type: "opening",
    semanticVersion: 1,
    hostWallId: HOST_ID,
    offsetMillimeters: 2500,
    widthMillimeters: 900,
    heightMillimeters: 2100,
    sillHeightMillimeters: 0,
    openingKind: "door",
  });
  assert.deepEqual(measureDrawingObject(openingObject, objects), {
    ruleVersion: "P4_MEASUREMENT_V1",
    lengthMillimeters: "900",
    areaSquareMillimeters: "1890000",
    count: "1",
  });
});

test("clockwise and counter-clockwise polygons have identical perimeter and area", () => {
  requireKernel();
  const boundary = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 500 },
    { x: 0, y: 500 },
  ];
  const expected = {
    ruleVersion: "P4_MEASUREMENT_V1",
    lengthMillimeters: "3000",
    areaSquareMillimeters: "500000",
    count: "1",
  };
  for (const points of [boundary, [...boundary].reverse()]) {
    assert.deepEqual(
      measureDrawingObject(
        object("00000000-0000-4000-8000-000000000205", {
          type: "space",
          semanticVersion: 1,
          boundary: points,
          number: "101",
          finishes: { floor: null, wall: null, ceiling: null },
        }),
        objects,
      ),
      expected,
    );
  }
});

test("half-square-millimeter area is retained exactly", () => {
  requireKernel();
  const measurement = measureDrawingObject(
    object("00000000-0000-4000-8000-000000000206", {
      type: "area",
      semanticVersion: 1,
      boundary: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
    }),
    objects,
  );
  assert.deepEqual(measurement, {
    ruleVersion: "P4_MEASUREMENT_V1",
    lengthMillimeters: "3.414214",
    areaSquareMillimeters: "0.5",
    count: "1",
  });

  const halfQuantum = measureDrawingObject(
    object("00000000-0000-4000-8000-000000000210", {
      type: "area",
      semanticVersion: 1,
      boundary: [
        { x: 0, y: 0 },
        { x: 0.000001, y: 0 },
        { x: 0, y: 1 },
      ],
    }),
    objects,
  );
  assert.equal(halfQuantum.areaSquareMillimeters, "0.000001");
});

test("polygon perimeter preserves edge magnitudes and rounds only the final sum", () => {
  requireKernel();
  const measurement = measureDrawingObject(
    object("00000000-0000-4000-8000-000000000211", {
      type: "area",
      semanticVersion: 1,
      boundary: [
        { x: 0, y: 0 },
        { x: 0.000001, y: 0 },
        { x: 0.000002, y: 0.000001 },
      ],
    }),
    objects,
  );
  assert.equal(measurement.lengthMillimeters, "0.000005");
});

test("90, 180, and 360 degree arcs use the fixed V1 PI rational", () => {
  requireKernel();
  const expected = new Map([
    [90, "1570.796327"],
    [180, "3141.592654"],
    [360, "6283.185307"],
  ]);
  for (const [sweepAngleDegrees, lengthMillimeters] of expected) {
    assert.deepEqual(
      measureDrawingObject(
        object("00000000-0000-4000-8000-000000000207", {
          type: "arc",
          semanticVersion: 1,
          center: { x: 0, y: 0 },
          radius: 1000,
          startAngleDegrees: -45,
          sweepAngleDegrees,
        }),
        objects,
      ),
      {
        ruleVersion: "P4_MEASUREMENT_V1",
        lengthMillimeters,
        areaSquareMillimeters: null,
        count: "1",
      },
    );
  }
});

test("large safe coordinates measure their delta without precision loss", () => {
  requireKernel();
  const measurement = measureDrawingObject(
    object("00000000-0000-4000-8000-000000000208", {
      ...wallGeometry,
      start: { x: 8_999_995_000, y: 8_999_995_000 },
      end: { x: 8_999_998_000, y: 8_999_999_000 },
    }),
    objects,
  );
  assert.equal(measurement.lengthMillimeters, "5000");
});

test("unavailable quantities are null rather than numeric zero", () => {
  requireKernel();
  assert.deepEqual(
    measureDrawingObject(
      object("00000000-0000-4000-8000-000000000209", {
        type: "text",
        origin: { x: 0, y: 0 },
        width: 10,
        text: "unmeasured",
      }),
      objects,
    ),
    {
      ruleVersion: "P4_MEASUREMENT_V1",
      lengthMillimeters: null,
      areaSquareMillimeters: null,
      count: "1",
    },
  );
});

test("measurement and formatting are byte-stable and locale-independent", () => {
  requireKernel();
  const measurement = measureDrawingObject(wallObject, objects);
  const first = JSON.stringify(measurement);
  for (let index = 0; index < 10; index += 1)
    assert.equal(
      JSON.stringify(measureDrawingObject(wallObject, objects)),
      first,
    );

  const originalLocale = process.env.LANG;
  const originalToLocaleString = Number.prototype.toLocaleString;
  Number.prototype.toLocaleString = () => {
    throw new Error("locale formatting is forbidden");
  };
  try {
    process.env.LANG = "ko_KR.UTF-8";
    const korean = [
      formatDrawingMeasurement(measurement, "millimeters"),
      formatDrawingMeasurement(measurement, "meters"),
      formatDrawingMeasurement(measurement, "count"),
    ];
    process.env.LANG = "en_US.UTF-8";
    assert.deepEqual(
      [
        formatDrawingMeasurement(measurement, "millimeters"),
        formatDrawingMeasurement(measurement, "meters"),
        formatDrawingMeasurement(measurement, "count"),
      ],
      korean,
    );
    assert.deepEqual(korean, ["5000 mm", "5 m", "1"]);
  } finally {
    Number.prototype.toLocaleString = originalToLocaleString;
    if (originalLocale === undefined) delete process.env.LANG;
    else process.env.LANG = originalLocale;
  }

  const areaMeasurement = {
    ruleVersion: "P4_MEASUREMENT_V1",
    lengthMillimeters: null,
    areaSquareMillimeters: "500000",
    count: "1",
  };
  assert.equal(
    formatDrawingMeasurement(areaMeasurement, "squareMillimeters"),
    "500000 mm²",
  );
  assert.equal(
    formatDrawingMeasurement(areaMeasurement, "squareMeters"),
    "0.5 m²",
  );
  assert.equal(formatDrawingMeasurement(areaMeasurement, "millimeters"), null);
});
