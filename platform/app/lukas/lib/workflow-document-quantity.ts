import { z } from "zod";
import {measurementRecordSchema} from './workflow-measurement-schema';
import {measurementValue} from './workflow-measurement';
import type { WorkflowBlankDocument } from "./workflow-blank-document";
import { canEditDocument } from "./workflow-document-review";
import { priceBookEntrySchema } from "./workflow-pricebook";
import { editableDraftLayer } from "./workflow-document-layers";

// Immutable versioned UI fixtures, not a market/company price database.
export const documentDemoRates = [
  {
    code: "FIN-01",
    name: "바닥 마감 예시",
    trade: "마감",
    unit: "m²",
    rate: 42000,
  },
  {
    code: "FIN-02",
    name: "벽 마감 예시",
    trade: "마감",
    unit: "m²",
    rate: 65000,
  },
  {
    code: "CIV-01",
    name: "배수관 예시",
    trade: "토목",
    unit: "m",
    rate: 85000,
  },
  {
    code: "STR-01",
    name: "콘크리트 예시",
    trade: "구조",
    unit: "m³",
    rate: 120000,
  },
  {
    code: "DOR-01",
    name: "문 설치 예시",
    trade: "창호",
    unit: "개",
    rate: 300000,
  },
] as const;

export const documentQuantitySchema = z
  .object({
    raw: z.number().finite().min(0).max(1e6),
    correction: z.number().finite().min(-1e6).max(1e6),
    unit: z.enum(["m", "m²", "m³", "개"]),
    rate: z.number().finite().min(0).max(1e9),
    reason: z.string().trim().min(1).max(500),
    basis: z.string().min(1).max(2000),
    rateSource: priceBookEntrySchema.optional(),
    measurementSource:measurementRecordSchema.optional(),
    rateReference: z
      .object({
        catalogVersion: z.literal("DEMO-RATES-01"),
        code: z.string().max(30),
      })
      .optional(),
  })
  .refine((q) => q.raw + q.correction >= 0 && q.raw + q.correction <= 1e6)
  .refine(q=>!q.measurementSource||(q.unit===(q.measurementSource.kind==='area'?'m²':'m')&&q.raw===Number(measurementValue(q.measurementSource)!.toFixed(6))))
  .refine(
    (q) =>
      !q.rateSource ||
      (!q.rateReference &&
        q.rateSource.unit === q.unit &&
        q.rateSource.rate === q.rate),
  )
  .refine(
    (q) =>
      !q.rateReference ||
      documentDemoRates.some(
        (item) =>
          item.code === q.rateReference?.code &&
          item.unit === q.unit &&
          item.rate === q.rate,
      ),
  );
export type DocumentQuantity = z.infer<typeof documentQuantitySchema>;
type Shape = WorkflowBlankDocument["shapes"][number];
function basis(doc: WorkflowBlankDocument, shape: Shape) {
  return JSON.stringify([
    doc.source?.sha256,
    shape.id,
    shape.page ?? 1,
    shape.x,
    shape.y,
    shape.kind ?? "rectangle",
    shape.label,
    ...(shape.kind === "polyline"
      ? [shape.points ?? [], Boolean(shape.closed)]
      : []),
    ...((shape.width ?? 120) !== 120 ||
    (shape.height ?? 80) !== 80 ||
    (shape.rotation ?? 0) !== 0
      ? [shape.width ?? 120, shape.height ?? 80, shape.rotation ?? 0]
      : []),
  ]);
}
export function setDocumentQuantity(
  doc: WorkflowBlankDocument,
  id: string,
  input: Omit<DocumentQuantity, "basis">,
): WorkflowBlankDocument {
  const shape = doc.shapes.find((item) => item.id === id);
  if (
    !shape ||
    !doc.source ||
    !canEditDocument(doc, "author") ||
    !editableDraftLayer(doc, shape)
  )
    return doc;
  const parsed = documentQuantitySchema.safeParse({
    ...input,
    basis: basis(doc, shape),
  });
  if (!parsed.success) return doc;
  const measured=parsed.data.measurementSource;
  if(measured){
    const stored=doc.measurements?.find(item=>item.id===measured.id);
    if(measured.source.sha256!==doc.source.sha256||measured.page!==(shape.page??1)||measured.revision!==(doc.revision??1)||!stored||JSON.stringify(measurementRecordSchema.parse(stored))!==JSON.stringify(measured))return doc;
  }
  return {
    ...doc,
    shapes: doc.shapes.map((item) =>
      item.id === id ? { ...item, quantity: parsed.data } : item,
    ),
  };
}
export function documentQuantityRow(doc: WorkflowBlankDocument, shape: Shape) {
  const q = shape.quantity;
  if (!q) return null;
  const final = q.raw + q.correction;
  return {
    ...q,
    final,
    amount: Math.round(final * q.rate),
    stale: !doc.source || q.basis !== basis(doc, shape) || Boolean(q.measurementSource&&q.measurementSource.revision!==(doc.revision??1)),
  };
}
