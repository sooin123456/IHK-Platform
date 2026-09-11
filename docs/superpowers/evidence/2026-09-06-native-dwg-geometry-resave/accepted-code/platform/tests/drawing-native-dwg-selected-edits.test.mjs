import assert from "node:assert/strict";
import { test } from "node:test";

import { buildNativeDrawingDwgSelectedEdits } from "../app/lukas/lib/drawing-native-dwg-selected-edits.server.ts";
import { projectNativeDrawingDwgImport } from "../app/lukas/lib/drawing-native-dwg-import.server.ts";

const ids = {
  revision: "92000000-0000-4000-8000-000000000001",
  canvas: "92000000-0000-4000-8000-000000000002",
  sourceFile: "92000000-0000-4000-8000-000000000003",
};
const expectedSource = {
  sha256: "b".repeat(64),
  byteSize: 8192,
  headerVersion: "AC1024",
};
const report = {
  schemaVersion: "1hk-dwg-import/1",
  qualification: "experimental-unqualified",
  source: { ...expectedSource },
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
      geometry: { start: [10, -5, 0], end: [125, 25, 0] },
    },
    {
      handle: "2B",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "LINE",
      geometry: {
        start: [20, 30, 0],
        end: [125.123456789, 25.000000001, 0],
      },
    },
    {
      handle: "1B",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "TEXT",
      geometry: {
        insert: [1.123456789, 2.000000001, 0],
        height: 2.123456789,
        text: "Room A",
      },
    },
    {
      handle: "20",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "LWPOLYLINE",
      geometry: {
        points: [
          [0.123456789, 0.000000001, 0],
          [2, 3, 0],
          [4.000000001, 5.123456789, 0],
        ],
        closed: false,
      },
    },
    {
      handle: "30",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "CIRCLE",
      geometry: { center: [4, 5, 0], radius: 2 },
    },
    {
      handle: "31",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "ARC",
      geometry: {
        center: [7.123456789, 8.000000001, 0],
        radius: 3.123456789,
        startAngleRadians: 0.5235987755982988,
        endAngleRadians: 2.6179938779914944,
      },
    },
    {
      handle: "32",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "ARC",
      geometry: {
        center: [10, 11, 0],
        radius: 4.123456789,
        startAngleRadians: 5.5,
        endAngleRadians: 0.5,
      },
    },
    {
      handle: "33",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "ARC",
      geometry: {
        center: [12, 13, 0],
        radius: 5,
        startAngleRadians: 0,
        endAngleRadians: 6.283185307179586,
      },
    },
  ],
  coverage: {
    modelSpaceEntities: 8,
    importedEntities: 8,
    unsupportedEntities: 0,
    nonModelSpaceEntities: 0,
  },
  unsupported: [],
  readerNotificationCount: 0,
};

function importInput() {
  return {
    report: structuredClone(report),
    expectedSource: { ...expectedSource },
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.sourceFile,
  };
}

function baseline(input = importInput()) {
  return projectNativeDrawingDwgImport(input);
}

function objectForHandle(projected, handle) {
  const binding = projected.bindings.find(
    (candidate) => candidate.handle === handle,
  );
  assert.ok(binding, `missing fixture binding ${handle}`);
  const object = projected.objects.find(
    (candidate) => candidate.id === binding.objectId,
  );
  assert.ok(object, `missing fixture object ${handle}`);
  return object;
}

function build(objects, input = importInput()) {
  return buildNativeDrawingDwgSelectedEdits({ importInput: input, objects });
}

test("converts only a changed centimeter LINE endpoint back to the original handle and native units", () => {
  const projected = baseline();
  const objects = structuredClone(projected.objects);
  const line = objectForHandle({ ...projected, objects }, "2A");
  line.geometry.start = { x: 120, y: -70 };

  const result = build(objects);

  assert.deepEqual(result, {
    request: {
      schemaVersion: "1hk-dwg-edits/2",
      sourceSha256: "b".repeat(64),
      coordinateSystem: "WCS_NATIVE_UNITS",
      edits: [
        {
          handle: "2A",
          type: "LINE",
          start: [12, -7, 0],
          end: [125, 25, 0],
        },
      ],
    },
    qualification: "experimental-unqualified",
    persistenceAuthority: "not-issued",
  });
  assert.equal("operations" in result, false);
  assert.equal("authorization" in result, false);
});

test("retains an unchanged raw native endpoint instead of reconstructing it from six-decimal display geometry", () => {
  const projected = baseline();
  const objects = structuredClone(projected.objects);
  objectForHandle({ ...projected, objects }, "2B").geometry.start = {
    x: 210,
    y: 310,
  };

  const result = build(objects);

  assert.deepEqual(result.request.edits, [
    {
      handle: "2B",
      type: "LINE",
      start: [21, 31, 0],
      end: [125.123456789, 25.000000001, 0],
    },
  ]);
});

test("emits v2 CIRCLE geometry and converts a changed centimeter radius", () => {
  const projected = baseline();
  const objects = structuredClone(projected.objects);
  objectForHandle({ ...projected, objects }, "30").geometry.radius = 35;

  const result = build(objects);

  assert.equal(result.request.schemaVersion, "1hk-dwg-edits/2");
  assert.deepEqual(result.request.edits, [
    { handle: "30", type: "CIRCLE", center: [4, 5, 0], radius: 3.5 },
  ]);
});

test("retains unchanged raw LWPOLYLINE vertices while converting changed vertices and closed", () => {
  const projected = baseline();
  const objects = structuredClone(projected.objects);
  const polyline = objectForHandle({ ...projected, objects }, "20");
  polyline.geometry.points[1] = { x: 25, y: 35 };
  polyline.geometry.closed = true;

  assert.deepEqual(build(objects).request.edits, [
    {
      handle: "20",
      type: "LWPOLYLINE",
      points: [
        [0.123456789, 0.000000001, 0],
        [2.5, 3.5, 0],
        [4.000000001, 5.123456789, 0],
      ],
      closed: true,
    },
  ]);
});

test("rejects distinct projected LWPOLYLINE points that collapse to one native point", () => {
  const projected = baseline();
  const objects = structuredClone(projected.objects);
  objectForHandle({ ...projected, objects }, "20").geometry.points = [
    { x: 0, y: 0 },
    { x: Number.MIN_VALUE, y: 0 },
  ];

  assert.throws(() => build(objects), /LWPOLYLINE|distinct|native/i);
});

test("retains raw ARC angle pairs for geometry-only edits, including wrapped angles", () => {
  const projected = baseline();
  const objects = structuredClone(projected.objects);
  const normal = objectForHandle({ ...projected, objects }, "31");
  normal.geometry.radius = 40;
  const wrapped = objectForHandle({ ...projected, objects }, "32");
  wrapped.geometry.center = { x: 105, y: 115 };

  assert.deepEqual(build(objects).request.edits, [
    {
      handle: "31",
      type: "ARC",
      center: [7.123456789, 8.000000001, 0],
      radius: 4,
      startAngleRadians: 0.5235987755982988,
      endAngleRadians: 2.6179938779914944,
    },
    {
      handle: "32",
      type: "ARC",
      center: [10.5, 11.5, 0],
      radius: 4.123456789,
      startAngleRadians: 5.5,
      endAngleRadians: 0.5,
    },
  ]);
});

test("converts edited ARC angles to a positive non-normalized full turn", () => {
  const projected = baseline();
  const objects = structuredClone(projected.objects);
  const arc = objectForHandle({ ...projected, objects }, "33");
  arc.geometry.startAngleDegrees = 30;

  assert.deepEqual(build(objects).request.edits, [
    {
      handle: "33",
      type: "ARC",
      center: [12, 13, 0],
      radius: 5,
      startAngleRadians: 0.5235987755982988,
      endAngleRadians: 6.806784082777885,
    },
  ]);
});

test("emits changed TEXT insert, height, and text in native units", () => {
  const projected = baseline();
  const objects = structuredClone(projected.objects);
  const text = objectForHandle({ ...projected, objects }, "1B");
  text.geometry.origin.x = 25;
  text.geometry.text = "회의실 😀";
  text.style.fontSize = 31.75;

  assert.deepEqual(build(objects).request.edits, [
    {
      handle: "1B",
      type: "TEXT",
      insert: [2.5, 2, 0],
      height: 3.175,
      text: "회의실 😀",
    },
  ]);
});

test("compiles a nonzero-start full turn within the strict native angle bound", () => {
  const input = importInput();
  const projected = baseline(input);
  const objects = structuredClone(projected.objects);
  const arc = objectForHandle({ ...projected, objects }, "33");
  arc.geometry.startAngleDegrees = 300;
  const edit = build(objects, input).request.edits[0];
  assert.ok(edit.endAngleRadians - edit.startAngleRadians <= Math.PI * 2);
  assert.ok(Math.abs(edit.startAngleRadians - 5.235987755982989) <= 1e-9);
  assert.ok(Math.abs(edit.endAngleRadians - 11.519173063162574) <= 1e-9);
  const preview = structuredClone(input);
  preview.report.entities.find(({ handle }) => handle === "33").geometry = {
    center: edit.center,
    radius: edit.radius,
    startAngleRadians: edit.startAngleRadians,
    endAngleRadians: edit.endAngleRadians,
  };
  const reread = objectForHandle(baseline(preview), "33");
  assert.equal(reread.geometry.startAngleDegrees, 300);
  assert.equal(reread.geometry.sweepAngleDegrees, 360);
});

test("rejects prospective TEXT content and height extents with frozen units without mutating a batch", async (t) => {
  for (const [label, unitCode, unitOverride, insert, mutate] of [
    [
      "millimeter content growth",
      4,
      undefined,
      8_999_999_990,
      (text) => {
        text.geometry.text = "A".repeat(100);
      },
    ],
    [
      "millimeter height growth",
      4,
      undefined,
      8_999_999_990,
      (text) => {
        text.style.fontSize = 100;
      },
    ],
    [
      "declared centimeter content growth",
      5,
      undefined,
      899_999_990,
      (text) => {
        text.geometry.text = "A".repeat(100);
      },
    ],
    [
      "selected centimeter height growth",
      0,
      { code: 5, label: "cm" },
      899_999_990,
      (text) => {
        text.style.fontSize = 1_000;
      },
    ],
  ]) {
    await t.test(label, () => {
      const input = importInput();
      input.report.unitCode = unitCode;
      if (unitOverride) input.unitOverride = unitOverride;
      input.report.entities.find(({ handle }) => handle === "1B").geometry = {
        insert: [insert, 0, 0],
        height: 1,
        text: "A",
      };
      const projected = baseline(input);
      const objects = structuredClone(projected.objects);
      objectForHandle({ ...projected, objects }, "2A").geometry.end.x += 10;
      const text = objectForHandle({ ...projected, objects }, "1B");
      const frozenWidth = text.geometry.width;
      mutate(text);
      assert.equal(text.geometry.width, frozenWidth);
      const before = structuredClone({ input, objects });
      assert.throws(() => build(objects, input), /extent|coordinate|limit/i);
      assert.deepEqual({ input, objects }, before);
    });
  }
});

test("uses the frozen inch projection when compiling changed geometry", () => {
  const input = importInput();
  input.report.unitCode = 1;
  const projected = baseline(input);
  const objects = structuredClone(projected.objects);
  const circle = objectForHandle({ ...projected, objects }, "30");
  circle.geometry.center.x = 25.4;
  circle.geometry.radius = 63.5;

  assert.deepEqual(build(objects, input).request.edits, [
    { handle: "30", type: "CIRCLE", center: [1, 5, 0], radius: 2.5 },
  ]);
});

test("emits null for an unchanged projection even when object order changes or versions increase", () => {
  const projected = baseline();
  const objects = structuredClone(projected.objects).reverse();
  objects[0].version += 1;

  assert.deepEqual(build(objects), {
    request: null,
    qualification: "experimental-unqualified",
    persistenceAuthority: "not-issued",
  });
});

test("a valid TEXT value change retains raw placement and edits sort by numeric native handle", () => {
  const projected = baseline();
  const objects = structuredClone(projected.objects);
  objectForHandle({ ...projected, objects }, "2A").geometry.end = {
    x: 1300,
    y: 260,
  };
  objectForHandle({ ...projected, objects }, "1B").geometry.text = "회의실 😀";

  assert.deepEqual(build(objects).request.edits, [
    {
      handle: "1B",
      type: "TEXT",
      insert: [1.123456789, 2.000000001, 0],
      height: 2.123456789,
      text: "회의실 😀",
    },
    {
      handle: "2A",
      type: "LINE",
      start: [10, -5, 0],
      end: [130, 26, 0],
    },
  ]);
});

test("rejects new, missing, and duplicate object identities", async (context) => {
  const projected = baseline();

  await context.test("new object", () => {
    const objects = structuredClone(projected.objects);
    objects.push({ ...structuredClone(objects[0]), id: ids.revision });
    assert.throws(() => build(objects), /object|identity|set/i);
  });

  await context.test("missing object", () => {
    assert.throws(
      () => build(structuredClone(projected.objects).slice(1)),
      /object|identity|set/i,
    );
  });

  await context.test("duplicate object", () => {
    const objects = structuredClone(projected.objects);
    objects[1] = structuredClone(objects[0]);
    assert.throws(() => build(objects), /duplicate|identity|set/i);
  });
});

test("rejects immutable object metadata and geometry-kind changes", async (context) => {
  const projected = baseline();
  const mutations = [
    ["name", (object) => (object.name = "Renamed")],
    ["layer", (object) => (object.layerId = ids.revision)],
    ["style", (object) => (object.style.stroke = "#ff0000")],
    [
      "style binding",
      (object) => (object.styleId = "92000000-0000-4000-8000-000000000004"),
    ],
    [
      "geometry kind",
      (object) =>
        (object.geometry = {
          type: "circle",
          center: { x: 100, y: -50 },
          radius: 10,
        }),
    ],
  ];

  for (const [label, mutate] of mutations) {
    await context.test(label, () => {
      const objects = structuredClone(projected.objects);
      mutate(objectForHandle({ ...projected, objects }, "2A"));
      assert.throws(
        () => build(objects),
        /name|layer|style|kind|type|immutable/i,
      );
    });
  }
});

test("rejects TEXT width changes atomically after an otherwise valid edit", () => {
  const projected = baseline();
  const objects = structuredClone(projected.objects);
  const text = objectForHandle({ ...projected, objects }, "1B");
  text.geometry.text = "valid earlier change";
  text.geometry.width = 100;

  assert.throws(() => build(objects), /text|width|geometry|unsupported/i);
});

test("rejects negative edited ARC sweeps and non-font TEXT style changes atomically", async (context) => {
  const projected = baseline();

  await context.test("negative sweep", () => {
    const objects = structuredClone(projected.objects);
    objectForHandle({ ...projected, objects }, "2A").geometry.start = {
      x: 120,
      y: -70,
    };
    objectForHandle(
      { ...projected, objects },
      "31",
    ).geometry.sweepAngleDegrees = -120;
    assert.throws(() => build(objects), /arc|sweep|positive/i);
  });

  await context.test("TEXT stroke", () => {
    const objects = structuredClone(projected.objects);
    const text = objectForHandle({ ...projected, objects }, "1B");
    text.geometry.origin = { x: 15, y: 20 };
    text.style.stroke = "#ff0000";
    assert.throws(() => build(objects), /style|immutable/i);
  });
});

test("rejects decreasing versions and invalid edited-object schema before compiling any request", async (context) => {
  const projected = baseline();

  await context.test("decreased version", () => {
    const objects = structuredClone(projected.objects);
    objectForHandle({ ...projected, objects }, "2A").version = 0;
    assert.throws(() => build(objects), /version|object/i);
  });

  await context.test("unknown object field", () => {
    const objects = structuredClone(projected.objects);
    objectForHandle({ ...projected, objects }, "2A").nativeBinding = {
      handle: "DEADBEEF",
    };
    assert.throws(() => build(objects), /object|unrecognized|unknown/i);
  });

  await context.test("zero-length LINE", () => {
    const objects = structuredClone(projected.objects);
    const line = objectForHandle({ ...projected, objects }, "2A");
    line.geometry.end = { ...line.geometry.start };
    assert.throws(() => build(objects));
  });
});

test("rejects invalid selected-DWG plain TEXT values", async (context) => {
  const projected = baseline();
  const invalidValues = [
    ["empty", ""],
    ["too long", "x".repeat(10_001)],
    ["unpaired surrogate", "bad\ud800text"],
    ["terminal high surrogate", "bad\ud800"],
    ["control", "bad\u0085text"],
    ["line separator", "bad\u2028text"],
    ["CAD percent escape", "bad%%utext"],
    ["CAD field", "bad%<field>text"],
  ];

  for (const [label, value] of invalidValues) {
    await context.test(label, () => {
      const objects = structuredClone(projected.objects);
      objectForHandle({ ...projected, objects }, "1B").geometry.text = value;
      assert.throws(() => build(objects), /text|unicode|plain|object/i);
    });
  }
});

test("rejects edited geometry outside the projected extent", () => {
  const projected = baseline();
  const objects = structuredClone(projected.objects);
  const circle = objectForHandle({ ...projected, objects }, "30");
  circle.geometry.center = { x: 8_999_999_990, y: 0 };
  circle.geometry.radius = 20;

  assert.throws(() => build(objects), /extent|coordinate|limit/i);
});

test("rejects more than 100,000 aggregate edited LWPOLYLINE vertices", () => {
  const input = importInput();
  input.report.entities.push({
    handle: "21",
    ownerHandle: "1F",
    layerHandle: "10",
    type: "LWPOLYLINE",
    geometry: {
      points: [
        [10, 10, 0],
        [20, 20, 0],
      ],
      closed: false,
    },
  });
  input.report.coverage.modelSpaceEntities += 1;
  input.report.coverage.importedEntities += 1;
  const projected = baseline(input);
  const objects = structuredClone(projected.objects);
  for (const handle of ["20", "21"])
    objectForHandle({ ...projected, objects }, handle).geometry.points =
      Array.from({ length: 50_001 }, (_, index) => ({
        x: index % 2,
        y: Number(handle),
      }));

  assert.throws(() => build(objects, input), /100,000|vertex|point/i);
});

test("rejects a compact UTF-8 request above the native consumer's 2 MiB limit", () => {
  const oversized = structuredClone(report);
  oversized.entities = Array.from({ length: 110 }, (_, index) => ({
    handle: (0x100 + index).toString(16).toUpperCase(),
    ownerHandle: "1F",
    layerHandle: "10",
    type: "TEXT",
    geometry: { insert: [index, 0, 0], height: 1, text: `base ${index}` },
  }));
  oversized.coverage = {
    modelSpaceEntities: 110,
    importedEntities: 110,
    unsupportedEntities: 0,
    nonModelSpaceEntities: 0,
  };
  const input = importInput();
  input.report = oversized;
  const objects = structuredClone(baseline(input).objects);
  for (const object of objects) object.geometry.text = "😀".repeat(5_000);

  assert.throws(() => build(objects, input), /2 MiB|request/i);
});
