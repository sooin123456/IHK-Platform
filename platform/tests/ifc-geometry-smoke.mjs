import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { IfcAPI } from "web-ifc";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run test:ifc -- /absolute/path/model.ifc");
  process.exit(2);
}

const filePath = path.resolve(input);
const bytes = new Uint8Array(await readFile(filePath));
const api = new IfcAPI();
let modelId = -1;

try {
  await api.Init();
  modelId = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true });
  assert.ok(modelId >= 0, "IFC model did not open");

  let elementCount = 0;
  for (const type of api.GetAllTypesOfModel(modelId)) {
    if (!api.IsIfcElement(type.typeID)) continue;
    elementCount += api.GetLineIDsWithType(modelId, type.typeID, false).size();
  }

  let geometricElements = 0;
  let placements = 0;
  let triangles = 0;
  api.StreamAllMeshes(modelId, (mesh) => {
    geometricElements += 1;
    placements += mesh.geometries.size();
    for (let index = 0; index < mesh.geometries.size(); index += 1) {
      const placed = mesh.geometries.get(index);
      const geometry = api.GetGeometry(modelId, placed.geometryExpressID);
      try {
        triangles += geometry.GetIndexDataSize() / 3;
      } finally {
        geometry.delete();
      }
    }
  });

  assert.ok(elementCount > 0, "IFC contains no selectable elements");
  assert.ok(geometricElements > 0, "IFC contains no renderable geometry");
  assert.ok(placements > 0, "IFC contains no placed geometry");
  assert.ok(triangles > 0, "IFC contains no triangles");

  console.log(
    JSON.stringify(
      {
        bytes: bytes.byteLength,
        elementCount,
        geometricElements,
        placements,
        triangles,
      },
      null,
      2,
    ),
  );
  console.log("IFC geometry smoke test passed.");
} finally {
  if (modelId >= 0) api.CloseModel(modelId);
  api.Dispose();
}
