import { buildNativeDrawingTemplate } from "../../app/lukas/lib/drawing-native-templates.ts";

export const cadId = (n) =>
  `90000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export function cadInput(key = "measured-plan") {
  const template = buildNativeDrawingTemplate(key);
  return {
    projectId: cadId(1),
    documentId: cadId(2),
    operationSequence: 0,
    canvasId: Object.keys(template.structure.canvases)[0],
    structure: template.structure,
    outputProfile: template.outputProfile,
  };
}
export function blankCadInput() {
  const input = cadInput();
  for (const collection of [
    "objects",
    "blocks",
    "blockInstances",
    "propertySchemas",
    "propertyValues",
    "tables",
  ])
    input.structure[collection] = {};
  return input;
}
export function addCadObject(input, n, geometry, overrides = {}) {
  const object = {
    id: cadId(n),
    name: `독립 객체 ${n}`,
    layerId: Object.keys(input.structure.layers)[0],
    geometry,
    styleId: null,
    style: { stroke: "#123456", strokeWidth: 5, fill: null },
    version: 1,
    ...overrides,
  };
  input.structure.objects[object.id] = object;
  return object;
}
export function wallCadInput() {
  const input = blankCadInput();
  const wall = addCadObject(input, 100, {
    type: "wall",
    semanticVersion: 1,
    start: { x: 0, y: 0 },
    end: { x: 6000, y: 0 },
    thicknessMillimeters: 150,
    heightMillimeters: 2700,
  });
  const opening = addCadObject(input, 101, {
    type: "opening",
    semanticVersion: 1,
    hostWallId: wall.id,
    offsetMillimeters: 2750,
    widthMillimeters: 900,
    heightMillimeters: 2100,
    sillHeightMillimeters: 0,
    openingKind: "door",
  });
  return { input, wall, opening };
}
