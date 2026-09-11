import { z } from "zod";
import {
  documentQuantitySchema,
  documentQuantityRow,
} from "./workflow-document-quantity";
import type { WorkflowBlankDocument } from "./workflow-blank-document";
import type { DocumentReviewRole } from "./workflow-document-review";
export const quantityReviewSchema = z
  .object({
    sequence: z.number().int().min(1).max(20),
    revision: z.number().int().min(1),
    source: z.object({
      name: z.string().min(1).max(500),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      pages: z.number().int().min(1),
    }),
    items: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          label: z.string().max(120),
          page: z.number().int().min(1),
          quantity: documentQuantitySchema,
        }),
      )
      .min(1)
      .max(500),
    excludedCount: z.number().int().min(0).max(500),
    phase: z.enum(["requested", "changes", "reviewed", "approved"]),
    requestNote: z.string().trim().min(1).max(500),
    reviewNote: z.string().trim().min(1).max(500).optional(),
    approvalNote: z.string().trim().min(1).max(500).optional(),
  })
  .refine(
    (round) =>
      new Set(round.items.map((item) => item.id)).size === round.items.length &&
      round.items.every((item) => item.page <= round.source.pages),
  );
export type QuantityReviewRound = z.infer<typeof quantityReviewSchema>;
export function quantityReviewInput(doc: WorkflowBlankDocument) {
  const shapes = doc.shapes.filter((shape) => shape.quantity);
  return {
    items: shapes
      .map((shape) => ({
        id: shape.id,
        label: shape.label,
        page: shape.page ?? 1,
        quantity: shape.quantity!,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    excludedCount: doc.shapes.length - shapes.length,
    stale: shapes.some((shape) => documentQuantityRow(doc, shape)?.stale),
  };
}
export function quantityReviewMatches(
  doc: WorkflowBlankDocument,
  round: QuantityReviewRound,
) {
  const current = quantityReviewInput(doc);
  return (
    !current.stale &&
    doc.source?.sha256 === round.source.sha256 &&
    (doc.revision ?? 1) === round.revision &&
    JSON.stringify(current.items) === JSON.stringify(round.items)
  );
}
export function reduceQuantityReview(
  doc: WorkflowBlankDocument,
  role: DocumentReviewRole,
  action: {
    type: "request" | "changes" | "review" | "approve";
    message: string;
  },
): WorkflowBlankDocument {
  if (!action.message.trim() || action.message.length > 500) return doc;
  const rounds = doc.quantityReviews ?? [],
    last = rounds.at(-1),
    current = quantityReviewInput(doc);
  if (action.type === "request") {
    if (
      role !== "author" ||
      !doc.source ||
      !current.items.length ||
      current.stale ||
      rounds.length >= 20 ||
      (last && last.phase !== "changes" && quantityReviewMatches(doc, last))
    )
      return doc;
    const parsed = quantityReviewSchema.safeParse({
      sequence: rounds.length + 1,
      revision: doc.revision ?? 1,
      source: { ...doc.source },
      items: structuredClone(current.items),
      excludedCount: current.excludedCount,
      phase: "requested",
      requestNote: action.message.trim(),
    });
    return parsed.success
      ? { ...doc, quantityReviews: [...rounds, parsed.data] }
      : doc;
  }
  if (!last) return doc;
  const matched = quantityReviewMatches(doc, last);
  if (
    role === "reviewer" &&
    last.phase === "requested" &&
    (action.type === "changes" || (action.type === "review" && matched))
  ) {
    return {
      ...doc,
      quantityReviews: [
        ...rounds.slice(0, -1),
        {
          ...last,
          phase: action.type === "changes" ? "changes" : "reviewed",
          reviewNote: action.message.trim(),
        },
      ],
    };
  }
  if (
    role === "approver" &&
    last.phase === "reviewed" &&
    matched &&
    action.type === "approve"
  )
    return {
      ...doc,
      quantityReviews: [
        ...rounds.slice(0, -1),
        { ...last, phase: "approved", approvalNote: action.message.trim() },
      ],
    };
  return doc;
}
