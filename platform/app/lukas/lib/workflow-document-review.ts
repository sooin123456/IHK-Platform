import type { WorkflowBlankDocument } from "./workflow-blank-document";
import type { DocumentLayer } from "./workflow-document-layers";
import {fieldNoteMatches,type DocumentFieldNote} from './workflow-document-field';
export type DocumentReviewRole = "author" | "reviewer" | "approver" | "viewer";
export type DocumentReviewRound = {
  revision: number;
  source: NonNullable<WorkflowBlankDocument["source"]>;
  objects: WorkflowBlankDocument["shapes"];
  layers?: DocumentLayer[];
  targetId: string;
  message: string;
  phase: "requested" | "changes" | "reviewed" | "approved";
  reviewNote?: string;
  approvalNote?: string;
  fieldEvidence?:DocumentFieldNote;
};
export type DocumentReviewAction =
  | { type: "request"; targetId: string; message: string;fieldNoteId?:number }
  | { type: "changes" | "review" | "approve"; message: string }
  | { type: "new-revision" };
export function documentReviewPhase(doc: WorkflowBlankDocument) {
  const last = doc.reviewRounds?.at(-1);
  return last && last.revision === (doc.revision ?? 1) ? last.phase : "draft";
}
export function canEditDocument(
  doc: WorkflowBlankDocument,
  role: DocumentReviewRole,
) {
  return (
    role === "author" && ["draft", "changes"].includes(documentReviewPhase(doc))
  );
}
export function reduceDocumentReview(
  doc: WorkflowBlankDocument,
  role: DocumentReviewRole,
  action: DocumentReviewAction,
): WorkflowBlankDocument {
  const phase = documentReviewPhase(doc),
    rounds = doc.reviewRounds ?? [],
    last = rounds.at(-1);
  if (action.type === "new-revision")
    return role === "author" && phase === "approved"
      ? { ...doc, revision: (doc.revision ?? 1) + 1 }
      : doc;
  if (!action.message.trim() || action.message.length > 500) return doc;
  if (action.type === "request") {
    const evidence=action.fieldNoteId===undefined?undefined:doc.fieldNotes?.find(note=>note.id===action.fieldNoteId);
    if(action.fieldNoteId!==undefined&&(!evidence||evidence.objectId!==action.targetId||!fieldNoteMatches(doc,evidence)))return doc;
    if (
      !canEditDocument(doc, role) ||
      !doc.source ||
      rounds.length >= 30 ||
      !doc.shapes.some((shape) => shape.id === action.targetId)
    )
      return doc;
    const revision =
      phase === "changes" ? (doc.revision ?? 1) + 1 : (doc.revision ?? 1);
    const round: DocumentReviewRound = {
      revision,
      source: { ...doc.source },
      objects: doc.shapes.map((shape) => ({ ...shape })),
      ...(doc.layers
        ? { layers: doc.layers.map((layer) => ({ ...layer })) }
        : {}),
      targetId: action.targetId,
      message: action.message.trim(),
      phase: "requested",
      ...(evidence?{fieldEvidence:structuredClone(evidence)}:{}),
    };
    return { ...doc, revision, reviewRounds: [...rounds, round] };
  }
  if (!last) return doc;
  const allowed =
    (role === "reviewer" &&
      phase === "requested" &&
      (action.type === "changes" || action.type === "review")) ||
    (role === "approver" && phase === "reviewed" && action.type === "approve");
  if (!allowed) return doc;
  const updated: DocumentReviewRound =
    action.type === "approve"
      ? { ...last, phase: "approved", approvalNote: action.message.trim() }
      : {
          ...last,
          phase: action.type === "review" ? "reviewed" : "changes",
          reviewNote: action.message.trim(),
        };
  return { ...doc, reviewRounds: [...rounds.slice(0, -1), updated] };
}
