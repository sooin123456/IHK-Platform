import type { DocumentReviewRound } from "./workflow-document-review";
import type {DrawingSubmittal} from './workflow-submittals';
import type {Inspection} from './workflow-inspections';
import type {DailyReport} from './workflow-daily-reports';
import type {Contract,PaymentClaim} from './workflow-payments';
import type {AssetEntry,Handover} from './workflow-handover';
import type {CarbonAssessment} from './workflow-carbon';
import type {CustomProperties} from './workflow-property-standards';
import type {MeasurementRecord} from './workflow-measurement';
import type {DocumentFieldNote} from './workflow-document-field';
import type {MaterialEvent} from './workflow-document-materials';
import type {ObjectComment} from './workflow-document-comments';
import type {DocumentRfi,RfiDraft} from './workflow-document-rfi';
import type {OutputJob} from './workflow-output-job';
import type {DocumentShare} from './workflow-document-share';
import type {QuantityReviewRound} from './workflow-quantity-review';
import type { DocumentQuantity } from "./workflow-document-quantity";
import type { DocumentLayer } from "./workflow-document-layers";
import { editableDraftLayer } from "./workflow-document-layers.ts";
export type WorkflowDeliveryPackage = {
  batchId?:string;
  reference?:string;
  issuedOn?:string;
  output?:OutputJob;
  quantityReviewSequence?: number;
  sequence?: number;
  linkStatus?: "active" | "expired";
  revision: number;
  recipient: string;
  status: "prepared" | "received" | "correction";
  feedback?: string;
};
/** Local drafting data: no engineering units or quantity authority. */
export type WorkflowBlankDocument = {
  projectId?: string;
  id: string;
  title: string;
  source?: { name: string; sha256: string; pages: number };
  page?: number;
  revision?: number;
  layers?: DocumentLayer[];
  reviewRounds?: DocumentReviewRound[];
  quantityReviews?:QuantityReviewRound[];
  measurements?:MeasurementRecord[];
  fieldNotes?:DocumentFieldNote[];
  materialEvents?:MaterialEvent[];
  objectComments?:ObjectComment[];
  rfis?:DocumentRfi[];
  submittals?:DrawingSubmittal[];
  inspections?:Inspection[];
  dailyReports?:DailyReport[];
  contract?:Contract;
  paymentClaims?:PaymentClaim[];
  assetRegister?:AssetEntry[];
  handovers?:Handover[];
  carbonAssessments?:CarbonAssessment[];
  rfiDrafts?:RfiDraft[];
  shares?:DocumentShare[];
  delivery?: WorkflowDeliveryPackage;
  deliveryHistory?: WorkflowDeliveryPackage[];
  shapes: {
    id: string;
    layerId?: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    rotation?: number;
    label: string;
    page?: number;
    kind?: "rectangle" | "line" | "circle" | "text" | "polyline";
    points?: { x: number; y: number }[];
    closed?: boolean;
    stroke?: string;
    fill?: string;
    lineWidth?: number;
    quantity?: DocumentQuantity;
    customProperties?:CustomProperties;
  }[];
};

export function draftPositionLimit(
  shape: WorkflowBlankDocument["shapes"][number],
  axis: "x" | "y",
) {
  return axis === "x"
    ? Math.min(680, 800 - (shape.width ?? 120))
    : Math.min(440, 520 - (shape.height ?? 80));
}

export function draftPolylineGeometry(points: { x: number; y: number }[]) {
  if (
    points.length < 2 ||
    points.length > 100 ||
    points.some(
      (p) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < 0 ||
        p.x > 800 ||
        p.y < 0 ||
        p.y > 520,
    )
  )
    return null;
  if (points.every((p) => p.x === points[0].x && p.y === points[0].y))
    return null;
  const x = Math.min(680, ...points.map((p) => p.x)),
    y = Math.min(440, ...points.map((p) => p.y));
  const width = Math.max(10, ...points.map((p) => p.x - x)),
    height = Math.max(10, ...points.map((p) => p.y - y));
  if (width > 600 || height > 400) return null;
  return {
    kind: "polyline" as const,
    x,
    y,
    width,
    height,
    points: points.map((p) => ({
      x: (p.x - x) / width,
      y: (p.y - y) / height,
    })),
  };
}
export type DraftSelectionAction =
  | { type: "move"; dx: number; dy: number }
  | { type: "copy"; newIds: string[] }
  | { type: "delete" };
export function transformDraftSelection(
  doc: WorkflowBlankDocument,
  ids: string[],
  action: DraftSelectionAction,
): WorkflowBlankDocument["shapes"] | null {
  if (!ids.length || new Set(ids).size !== ids.length) return null;
  const selected = ids.map((id) => doc.shapes.find((shape) => shape.id === id));
  if (selected.some((shape) => !shape || !editableDraftLayer(doc, shape)))
    return null;
  const shapes = selected as WorkflowBlankDocument["shapes"];
  if (action.type === "delete")
    return doc.shapes.filter((shape) => !ids.includes(shape.id));
  if (
    action.type === "copy" &&
    (doc.shapes.length + ids.length > 500 ||
      action.newIds.length !== ids.length ||
      new Set(action.newIds).size !== ids.length ||
      action.newIds.some(
        (id) =>
          !id || id.length > 100 || doc.shapes.some((shape) => shape.id === id),
      ))
  )
    return null;
  const rawX = action.type === "move" ? action.dx : 20,
    rawY = action.type === "move" ? action.dy : 20;
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;
  const dx = Math.max(
    -Math.min(...shapes.map((shape) => shape.x)),
    Math.min(
      rawX,
      ...shapes.map((shape) => draftPositionLimit(shape, "x") - shape.x),
    ),
  );
  const dy = Math.max(
    -Math.min(...shapes.map((shape) => shape.y)),
    Math.min(
      rawY,
      ...shapes.map((shape) => draftPositionLimit(shape, "y") - shape.y),
    ),
  );
  if (action.type === "copy")
    return [
      ...doc.shapes,
      ...shapes.map((shape, index) => ({
        ...shape,
        id: action.newIds[index],
        x: shape.x + dx,
        y: shape.y + dy,
        label: `${shape.label} 복사`.slice(0, 120),
      })),
    ];
  return doc.shapes.map((shape) =>
    ids.includes(shape.id)
      ? { ...shape, x: shape.x + dx, y: shape.y + dy }
      : shape,
  );
}

export const workflowDraftTemplates = [
  {
    id: "office",
    title: "사무실 배치",
    description: "회의·업무·휴게 공간의 관계를 구상합니다.",
    labels: ["회의실", "업무 공간", "휴게 공간", "자료실"],
  },
  {
    id: "site",
    title: "현장 작업 구역",
    description: "작업·자재·출입 구역을 배치해 현장 논의를 시작합니다.",
    labels: ["작업 구역", "자재 적치", "출입 구역"],
  },
  {
    id: "civil",
    title: "철도·토목 구간 검토",
    description: "노선·검측·구조물·자재 구역의 관계를 구상합니다.",
    labels: ["노선 구상", "검측 구간", "구조물 검토", "자재 구역"],
  },
] as const;

export function createWorkflowTemplateDocument(
  templateId: string,
  id: string,
  title: string,
): WorkflowBlankDocument | null {
  const template = workflowDraftTemplates.find(
    (template) => template.id === templateId,
  );
  if (!template || !title.trim() || title.length > 120) return null;
  return {
    id,
    title: title.trim(),
    shapes: template.id==='civil'?[
      {...draftPolylineGeometry([{x:100,y:270},{x:380,y:170},{x:680,y:270}])!,id:`${id}:0`,label:'노선 구상',stroke:'#6554d7',lineWidth:3},
      {id:`${id}:1`,label:'검측 구간',x:130,y:310,width:150,height:80},
      {id:`${id}:2`,label:'구조물 검토',x:340,y:60,width:140,height:80},
      {id:`${id}:3`,label:'자재 구역',x:520,y:320,width:140,height:80},
    ]:template.labels.map((label, index) => ({
      id: `${id}:${index}`,
      label,
      x: 140 + (index % 2) * 280,
      y: 100 + Math.floor(index / 2) * 180,
    })),
  };
}
