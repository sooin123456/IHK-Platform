import assert from "node:assert/strict";
import test from "node:test";

import {
  collectExportPrimitives,
  exportDrawingSvg,
} from "../app/lukas/lib/drawing-export.ts";
import { measureDrawingObject } from "../app/lukas/lib/drawing-measurements.ts";
import { getNativeDrawingSymbol } from "../app/lukas/lib/drawing-native-symbols.ts";
import { resolveDrawingOpening } from "../app/lukas/lib/drawing-semantic-geometry.ts";
import {
  buildNativeDrawingTemplate,
  listNativeDrawingTemplateKeys,
} from "../app/lukas/lib/drawing-native-templates.ts";
import { validateDrawingStructureState } from "../app/lukas/lib/drawing-structure.ts";
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
} from "../app/lukas/lib/drawing-workspace.types.ts";

const keys = [
  "measured-plan",
  "office-layout",
  "remodel-phases",
  "finishes-takeoff",
];
const assumption = "예제·가정값 — 현장 확인 필요";

function values(record) {
  return Object.values(record);
}

function documentFor(template) {
  return {
    revisionId: template.structure.revisionId,
    objects: template.structure.objects,
    layers: template.structure.layers,
    operations: [],
    undoStackByActor: {},
    redoStackByActor: {},
    structure: template.structure,
  };
}

function assertEntitySchemas(structure) {
  for (const value of values(structure.pages)) DrawingPageSchema.parse(value);
  for (const value of values(structure.canvases))
    DrawingCanvasSchema.parse(value);
  for (const value of values(structure.layers))
    DrawingStructureLayerSchema.parse(value);
  for (const value of values(structure.objects))
    DrawingObjectSchema.parse(value);
  for (const value of values(structure.styles))
    DrawingStyleDefinitionSchema.parse(value);
  for (const value of values(structure.blocks)) DrawingBlockSchema.parse(value);
  for (const value of values(structure.blockInstances))
    DrawingBlockInstanceSchema.parse(value);
  for (const value of values(structure.propertySchemas))
    DrawingPropertySchemaSchema.parse(value);
  for (const value of values(structure.propertyValues))
    DrawingPropertyValueSchema.parse(value);
  for (const value of values(structure.tables)) DrawingTableSchema.parse(value);
}

test("the release exposes four valid editable A3 1:50 native graphs", () => {
  assert.deepEqual(listNativeDrawingTemplateKeys(), keys);

  for (const key of keys) {
    const template = buildNativeDrawingTemplate(key);
    assert.equal(template.schemaVersion, "1hk-native-template/1");
    assert.equal(template.key, key);
    assert.equal(template.version, 1);
    assert.equal(template.units, "mm");
    assert.deepEqual(template.outputProfile, {
      paper: "A3",
      orientation: "landscape",
      widthMillimeters: 420,
      heightMillimeters: 297,
      scaleDenominator: 50,
    });
    assert.deepEqual(template.provenance, {
      author: "1HK",
      sourcePath: "platform/app/lukas/lib/drawing-native-templates.ts",
      attribution: "1HK가 독립 제작한 편집 가능한 예제 도면",
      license: "NOASSERTION",
      origin: "first-party-generated",
    });

    assert.doesNotThrow(() =>
      validateDrawingStructureState(template.structure),
    );
    assertEntitySchemas(template.structure);
    assert.ok(values(template.structure.layers).some((layer) => !layer.locked));
    assert.ok(values(template.structure.styles).length >= 2);
    assert.ok(
      values(template.structure.objects).some(
        (object) => object.geometry.type === "dimension",
      ),
    );
    assert.ok(
      values(template.structure.objects).some(
        (object) =>
          object.geometry.type === "text" &&
          object.geometry.text.includes(assumption),
      ),
    );
    assert.ok(values(template.structure.blockInstances).length >= 1);
    assert.ok(values(template.structure.propertySchemas).length >= 1);
    assert.ok(values(template.structure.propertyValues).length >= 1);
    assert.ok(values(template.structure.tables).length >= 1);

    const linkedObjectIds = new Set(
      values(template.structure.propertyValues)
        .map((value) => value.objectId)
        .filter(Boolean),
    );
    assert.ok(
      values(template.structure.tables).some((table) =>
        table.rows.some(
          (row) => row.objectId && linkedObjectIds.has(row.objectId),
        ),
      ),
    );
    assert.ok(
      values(template.structure.propertyValues).some(
        (value) => value.value === assumption,
      ),
    );

    const canvas = values(template.structure.canvases)[0];
    assert.equal(canvas.widthMillimeters, 21_000);
    assert.equal(canvas.heightMillimeters, 14_850);
    const traversal = collectExportPrimitives(documentFor(template), canvas.id);
    assert.ok(
      traversal.primitives.length > values(template.structure.objects).length,
    );
    assert.ok(
      traversal.primitives.some((primitive) =>
        values(template.structure.blockInstances).some((instance) =>
          primitive.id.startsWith(`${instance.id}/`),
        ),
      ),
    );
    assert.ok(
      traversal.primitives.every(
        (primitive) => primitive.geometry.type && primitive.style.stroke,
      ),
    );
    for (const object of values(template.structure.objects)) {
      const rendered = traversal.primitives.find(
        (primitive) => primitive.id === object.id,
      );
      assert.ok(rendered, `${key} omitted object ${object.id}`);
      assert.equal(rendered.geometry.type, object.geometry.type);
      if (object.geometry.type === "space" || object.geometry.type === "area")
        assert.equal(rendered.style.fontSize, 140);
    }
  }
});

test("measured plan contains a 6000 by 4000 room, 24 square metres, and a hosted opening", () => {
  const structure = buildNativeDrawingTemplate("measured-plan").structure;
  const room = values(structure.objects).find(
    (object) => object.geometry.type === "space",
  );
  const horizontalDimension = values(structure.objects).find(
    (object) =>
      object.geometry.type === "dimension" &&
      Math.abs(object.geometry.end.x - object.geometry.start.x) === 6_000,
  );
  const opening = values(structure.objects).find(
    (object) => object.geometry.type === "opening",
  );

  assert.ok(room);
  assert.deepEqual(measureDrawingObject(room, structure.objects), {
    ruleVersion: "P4_MEASUREMENT_V1",
    lengthMillimeters: "20000",
    areaSquareMillimeters: "24000000",
    count: "1",
  });
  assert.ok(horizontalDimension);
  assert.ok(opening);
  assert.deepEqual(
    values(structure.objects)
      .map((object) => object.geometry.type)
      .sort(),
    [
      "dimension",
      "dimension",
      "opening",
      "space",
      "text",
      "wall",
      "wall",
      "wall",
      "wall",
    ],
  );
  assert.equal(
    structure.objects[opening.geometry.hostWallId].geometry.type,
    "wall",
  );
  assert.doesNotThrow(() => measureDrawingObject(opening, structure.objects));
});

test("office layout places four desks and one meeting table", () => {
  const structure = buildNativeDrawingTemplate("office-layout").structure;
  const instances = values(structure.blockInstances);

  assert.equal(instances.length, 5);
  assert.equal(
    instances.filter((instance) => instance.name.startsWith("업무 책상 "))
      .length,
    4,
  );
  assert.equal(
    instances.filter((instance) => instance.name === "4인 회의 테이블").length,
    1,
  );

  const desk = getNativeDrawingSymbol("furniture-desk-1200x600");
  const meeting = getNativeDrawingSymbol(
    "furniture-meeting-table-4-seat-1800x900",
  );
  const canvas = values(structure.canvases)[0];
  const traversal = collectExportPrimitives(
    documentFor({ structure }),
    canvas.id,
  );
  for (const instance of instances) {
    const expected = instance.name.startsWith("업무 책상 ") ? desk : meeting;
    assert.deepEqual(
      structure.blocks[instance.blockId].primitives,
      expected.primitives,
    );
    for (const expectedPrimitive of expected.primitives) {
      const rendered = traversal.primitives.find(
        (primitive) =>
          primitive.id === `${instance.id}/${expectedPrimitive.localId}`,
      );
      assert.ok(rendered);
      assert.deepEqual(rendered.geometry, expectedPrimitive.geometry);
    }
  }
});

test("remodel template separates existing, demolition, and new wall work", () => {
  const structure = buildNativeDrawingTemplate("remodel-phases").structure;
  const layers = Object.fromEntries(
    values(structure.layers).map((layer) => [layer.name, layer]),
  );
  assert.ok(layers["기존"]);
  assert.ok(layers["철거"]);
  assert.ok(layers["신설"]);

  for (const name of ["기존", "철거", "신설"]) {
    assert.ok(
      values(structure.objects).some(
        (object) =>
          object.layerId === layers[name].id && object.geometry.type === "wall",
      ),
    );
  }
  const wallIds = values(structure.objects)
    .filter((object) => object.geometry.type === "wall")
    .map((object) => object.id);
  assert.equal(new Set(wallIds).size, wallIds.length);
});

test("remodel SVG paints its range before visibly distinct phase walls", () => {
  const template = buildNativeDrawingTemplate("remodel-phases");
  const { structure } = template;
  const canvas = values(structure.canvases)[0];
  const area = values(structure.objects).find(
    (object) => object.geometry.type === "area",
  );
  assert.ok(area);
  const walls = ["기존", "철거", "신설"].map((layerName) => {
    const layer = values(structure.layers).find(
      (candidate) => candidate.name === layerName,
    );
    assert.ok(layer);
    const wall = values(structure.objects).find(
      (object) =>
        object.layerId === layer.id && object.geometry.type === "wall",
    );
    assert.ok(wall);
    return wall;
  });
  const strokes = walls.map(
    (wall) => structure.styles[wall.styleId].value.stroke,
  );
  assert.equal(new Set(strokes).size, 3);
  const opening = values(structure.objects).find(
    (object) => object.geometry.type === "opening",
  );
  const door = values(structure.blockInstances).find(
    (instance) => instance.name === "신설 문 도식",
  );
  assert.ok(opening);
  assert.ok(door);
  const resolvedOpening = resolveDrawingOpening(
    opening.geometry,
    structure.objects,
  );
  assert.deepEqual(door.origin, resolvedOpening.start);
  assert.equal(door.rotation, resolvedOpening.wallAngleDegrees);

  const svg = exportDrawingSvg(documentFor(template), canvas.id);
  const areaIndex = svg.indexOf(`data-export-id="${area.id}"`);
  assert.ok(areaIndex >= 0);
  for (const [index, wall] of walls.entries()) {
    const wallIndex = svg.indexOf(`data-export-id="${wall.id}"`);
    assert.ok(wallIndex > areaIndex);
    const group = svg.slice(wallIndex, svg.indexOf("</g>", wallIndex));
    assert.match(group, new RegExp(`stroke="${strokes[index]}"`));
  }
});

test("door symbol jamb transforms match literal hosted opening endpoints", () => {
  const cases = [
    {
      key: "measured-plan",
      instanceName: "900 문 여닫이 도식",
      start: { x: 4_350, y: 3_000 },
      end: { x: 5_250, y: 3_000 },
      transform: [1, 0, 0, 1, 4_350, 3_000],
    },
    {
      key: "remodel-phases",
      instanceName: "신설 문 도식",
      start: { x: 7_500, y: 5_000 },
      end: { x: 7_500, y: 5_900 },
      transform: [0, 1, -1, 0, 7_500, 5_000],
    },
  ];

  for (const expected of cases) {
    const template = buildNativeDrawingTemplate(expected.key);
    const { structure } = template;
    const opening = values(structure.objects).find(
      (object) => object.geometry.type === "opening",
    );
    const instance = values(structure.blockInstances).find(
      (candidate) => candidate.name === expected.instanceName,
    );
    assert.ok(opening);
    assert.ok(instance);
    const resolved = resolveDrawingOpening(opening.geometry, structure.objects);
    assert.deepEqual(resolved.start, expected.start);
    assert.deepEqual(resolved.end, expected.end);
    assert.deepEqual(instance.origin, expected.start);
    assert.equal(instance.rotation, resolved.wallAngleDegrees);

    const canvas = values(structure.canvases)[0];
    const traversal = collectExportPrimitives(documentFor(template), canvas.id);
    const leftJamb = traversal.primitives.find(
      (primitive) => primitive.id === `${instance.id}/jamb-left`,
    );
    const rightJamb = traversal.primitives.find(
      (primitive) => primitive.id === `${instance.id}/jamb-right`,
    );
    assert.ok(leftJamb);
    assert.ok(rightJamb);
    assert.deepEqual(leftJamb.transform, expected.transform);
    assert.deepEqual(rightJamb.transform, expected.transform);
    assert.deepEqual(leftJamb.geometry.start, { x: 0, y: 0 });
    assert.deepEqual(rightJamb.geometry.start, { x: 900, y: 0 });
  }
});

test("finishes template links its 24 square metre area to an example quantity row", () => {
  const structure = buildNativeDrawingTemplate("finishes-takeoff").structure;
  const area = values(structure.objects).find(
    (object) => object.geometry.type === "area",
  );
  assert.ok(area);
  assert.equal(
    measureDrawingObject(area, structure.objects).areaSquareMillimeters,
    "24000000",
  );

  const row = values(structure.tables)
    .flatMap((table) => table.rows)
    .find((candidate) => candidate.objectId === area.id);
  assert.ok(row);
  assert.ok(Object.values(row.cells).includes(24));
  assert.ok(Object.values(row.cells).includes("m²"));
  assert.ok(Object.values(row.cells).includes(assumption));
});

test("template calls are independent and unknown keys fail closed", () => {
  const first = buildNativeDrawingTemplate("measured-plan");
  first.name = "변조";
  values(first.structure.layers)[0].name = "변조";
  values(first.structure.objects)[0].geometry = {
    type: "line",
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  };

  const second = buildNativeDrawingTemplate("measured-plan");
  assert.notEqual(second.name, "변조");
  assert.notEqual(values(second.structure.layers)[0].name, "변조");
  assert.notDeepEqual(values(second.structure.objects)[0].geometry, {
    type: "line",
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  });
  assert.throws(
    () => buildNativeDrawingTemplate("not-a-template"),
    /Unknown native drawing template/,
  );
});
