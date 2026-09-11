import { z } from "zod";
import type { WorkflowBlankDocument } from "./workflow-blank-document";
export const documentLayersSchema = z
  .array(
    z.object({
      id: z.string().min(1).max(100),
      name: z.string().trim().min(1).max(80),
      visible: z.boolean(),
      locked: z.boolean(),
    }),
  )
  .min(1)
  .max(30)
  .refine(
    (layers) =>
      new Set(layers.map((layer) => layer.id)).size === layers.length &&
      new Set(layers.map((layer) => layer.name)).size === layers.length &&
      layers.some((layer) => layer.id === "default"),
  );
export type DocumentLayer = z.infer<typeof documentLayersSchema>[number];
export function documentLayers(doc: { layers?: DocumentLayer[] }) {
  return (
    doc.layers ?? [
      { id: "default", name: "구상 표시", visible: true, locked: false },
    ]
  );
}
export function draftLayer(
  doc: { layers?: DocumentLayer[] },
  shape: { layerId?: string },
) {
  return documentLayers(doc).find(
    (layer) => layer.id === (shape.layerId ?? "default"),
  );
}
export function validDraftLayers(
  doc: Pick<WorkflowBlankDocument, "shapes">,
  layers: DocumentLayer[],
) {
  return (
    documentLayersSchema.safeParse(layers).success &&
    doc.shapes.every((shape) =>
      layers.some((layer) => layer.id === (shape.layerId ?? "default")),
    )
  );
}
export function orderedDraftShapes(
  doc: Pick<WorkflowBlankDocument, "shapes" | "layers">,
) {
  const order = new Map(
    documentLayers(doc).map((layer, index) => [layer.id, index]),
  );
  return [...doc.shapes].sort(
    (a, b) =>
      (order.get(b.layerId ?? "default") ?? 0) -
      (order.get(a.layerId ?? "default") ?? 0),
  );
}
export function editableDraftLayer(
  doc: { layers?: DocumentLayer[] },
  shape: { layerId?: string },
) {
  const layer = draftLayer(doc, shape);
  return Boolean(layer?.visible && !layer.locked);
}
export function canChangeDraftShapes(
  doc: WorkflowBlankDocument,
  next: WorkflowBlankDocument["shapes"],
) {
  const previous = new Map(doc.shapes.map((shape) => [shape.id, shape]));
  const updated = new Map(next.map((shape) => [shape.id, shape]));
  for (const shape of doc.shapes) {
    if (
      JSON.stringify(shape) !== JSON.stringify(updated.get(shape.id)) &&
      !editableDraftLayer(doc, shape)
    )
      return false;
  }
  return next.every(
    (shape) =>
      JSON.stringify(shape) === JSON.stringify(previous.get(shape.id)) ||
      editableDraftLayer(doc, shape),
  );
}
