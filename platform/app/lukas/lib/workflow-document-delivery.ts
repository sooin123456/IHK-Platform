import {deliveryIdentitySchema} from "./workflow-delivery-identity";
import {z} from 'zod';
import type { WorkflowBlankDocument } from "./workflow-blank-document";
import { quantityReviewMatches } from "./workflow-quantity-review";
export function deliveryQuantityReview(document: WorkflowBlankDocument, revision: number, sequence: number) {
  const drawing = document.reviewRounds?.find(round => round.revision === revision && round.phase === 'approved');
  const matches = document.quantityReviews?.filter(round => round.sequence === sequence) ?? [];
  const quantity = matches.length === 1 ? matches[0] : undefined;
  return drawing && quantity?.phase === 'approved' && quantityReviewMatches({...document, source:drawing.source, revision:drawing.revision, shapes:drawing.objects, layers:drawing.layers}, quantity) ? quantity : undefined;
}
export type DocumentDeliveryAction =
  | { type: "expire" }
  | { type: "prepare"; revision: number; recipient: string; reference?:string; issuedOn?:string; quantityReviewSequence?: number }
  | { type: "receive" | "correction"; message: string };
const distributionBatchSchema=z.object({id:z.string().min(1).max(100),recipient:z.string().trim().min(1).max(120),reference:z.string().trim().min(1).max(80),issuedOn:z.string(),items:z.array(z.object({id:z.string().min(1),revision:z.number().int().positive()})).min(2).max(20).refine(items=>new Set(items.map(item=>item.id)).size===items.length)});
export function prepareDistributionBatch(documents:WorkflowBlankDocument[],input:unknown):WorkflowBlankDocument[]{
 const parsed=distributionBatchSchema.safeParse(input);if(!parsed.success)return documents;
 const batch=parsed.data;
 if(documents.some(doc=>[doc.delivery,...(doc.deliveryHistory??[])].some(delivery=>delivery?.batchId===batch.id)))return documents;
 const sources=batch.items.map(item=>documents.find(doc=>doc.id===item.id));
 const projectId=sources[0]?.projectId;
 if(!projectId||sources.some(doc=>!doc||doc.projectId!==projectId))return documents;
 const prepared=sources.map((doc,index)=>reduceDocumentDelivery(doc!,{type:'prepare',revision:batch.items[index].revision,recipient:batch.recipient,reference:batch.reference,issuedOn:batch.issuedOn}));
 if(prepared.some((doc,index)=>doc===sources[index]))return documents;
 const updates=new Map(prepared.map(doc=>[doc.id,{...doc,delivery:{...doc.delivery!,batchId:batch.id}}]));
 return documents.map(doc=>updates.get(doc.id)??doc);
}
export function reduceDocumentDelivery(
  document: WorkflowBlankDocument,
  action: DocumentDeliveryAction,
): WorkflowBlankDocument {
  if (action.type === "expire")
    return document.delivery
      ? {
          ...document,
          delivery: { ...document.delivery, linkStatus: "expired" },
        }
      : document;
  if (action.type === "prepare") {
    const identity=deliveryIdentitySchema.safeParse(action);if(!identity.success)return document;
    if (
      (action.quantityReviewSequence !== undefined && !deliveryQuantityReview(document, action.revision, action.quantityReviewSequence)) ||
      (document.deliveryHistory?.length ?? 0) >= 100 ||
      (document.delivery?.sequence ?? 0) >= Number.MAX_SAFE_INTEGER ||
      !action.recipient.trim() ||
      action.recipient.length > 120 ||
      !document.reviewRounds?.some(
        (round) =>
          round.revision === action.revision && round.phase === "approved",
      )
    )
      return document;
    return {
      ...document,
      ...(document.delivery
        ? {
            deliveryHistory: [
              ...(document.deliveryHistory ?? []),
              { ...document.delivery },
            ],
          }
        : {}),
      delivery: {
        ...identity.data,
        ...(action.quantityReviewSequence !== undefined ? {quantityReviewSequence:action.quantityReviewSequence} : {}),
        sequence: (document.delivery?.sequence ?? 0) + 1,
        linkStatus: "active",
        revision: action.revision,
        recipient: action.recipient.trim(),
        status: "prepared",
      },
    };
  }
  if (
    !document.delivery ||
    document.delivery.linkStatus === "expired" ||
    !action.message.trim() ||
    action.message.length > 500 ||
    document.delivery.status !== "prepared"
  )
    return document;
  return {
    ...document,
    delivery: {
      ...document.delivery,
      status: action.type === "receive" ? "received" : "correction",
      feedback: action.message.trim(),
    },
  };
}
