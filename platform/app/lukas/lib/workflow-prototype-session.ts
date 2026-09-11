import {deliveryIdentityFields} from "./workflow-delivery-identity";
import { z } from "zod";
import {projectsSchema,type LocalProject} from './workflow-projects';
import {submittalsSchema} from './workflow-submittals';
import {inspectionsSchema} from './workflow-inspections';
import {dailyReportsSchema} from './workflow-daily-reports';
import {contractSchema,paymentClaimsSchema} from './workflow-payments';
import {assetRegisterSchema,handoversSchema} from './workflow-handover';
import {carbonAssessmentsSchema} from './workflow-carbon';
import {propertyStandardsSchema,customPropertiesSchema,type PropertyStandard} from './workflow-property-standards';
import type {SavedDrawingTemplate} from './workflow-saved-templates';
import {objectCommentSchema} from './workflow-document-comments';
import {rfiSchema,rfiDraftSchema} from './workflow-document-rfi';
import {outputJobSchema,validOutputJobs} from './workflow-output-job';
import {importManifestSchema,type ImportRecord} from './workflow-import-manifest';
import {shareAccessSchema} from './workflow-document-share';
import {documentFieldNoteSchema} from './workflow-document-field';
import {materialEventSchema,validMaterialHistory} from './workflow-document-materials';
import {measurementRecordSchema as measurementRecord} from './workflow-measurement-schema';
import { deliveryQuantityReview } from './workflow-document-delivery';
import {quantityReviewSchema} from './workflow-quantity-review';
import {documentLayersSchema,draftLayer} from './workflow-document-layers';
import {priceBookEntrySchema} from './workflow-pricebook';
import {priceBookDraftSchema} from './workflow-pricebook-draft';
import { documentQuantitySchema } from "./workflow-document-quantity";
import type { Scenario, Workflow } from "./workflow-prototype";
import type { WorkflowBlankDocument } from "./workflow-blank-document";
export const workflowSessionKey = "1hk:workflow-preview:session:v1";
const text = z.string().max(2000),
  amount = z.number().finite().nonnegative(),
  revision = z.number().int().positive();
const workflow = z.object({
  pricebook:z.array(priceBookEntrySchema).max(200).optional(),
  pricebookDraft:priceBookDraftSchema.optional(),
  members:z.array(z.object({name:z.string().trim().min(1).max(80),email:z.string().max(254).regex(/^\S+@\S+\.\S+$/),role:z.enum(['author','reviewer','approver','viewer'])})).max(50).optional(),
  layers: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        kind: z.enum(["source", "overlay"]),
        visible: z.boolean(),
        locked: z.boolean(),
      }),
    )
    .max(30)
    .optional(),
  deliveryPackage: z
    .object({
      revision,
      formats: z
        .array(z.enum(["PDF", "DWG", "XLSX", "CSV"]))
        .min(1)
        .max(4),
      recipient: z.string().max(120),
    })
    .optional(),
  sharePreview: z
    .object({
      recipient: z.string().max(254),
      permission: z.enum(["view", "comment"]),
      revision,
      objectId: text,
      sourceId: text,
      objectName: text,
      document: text,
      quantity: amount,
      unit: text,
      amount: amount.optional(),
      status: z.enum(["active", "expired"]),
      feedback: z.string().max(500).optional(),
    })
    .optional(),
  fieldNotes: z
    .array(
      z.object({
        id: text,
        objectId: text,
        sourceId: text,
        revision,
        location: text,
        title: z.string().max(120),
        note: z.string().max(1000),
        condition: z.enum(["changed", "conforming", "needs-check"]),
        photoName: z.string().max(160).optional(),
      }),
    )
    .max(1000)
    .optional(),
  materials: z
    .object({
      approvedRevision: revision,
      ordered: amount,
      received: amount,
      installed: amount,
      reason: z.string().max(500),
    })
    .optional(),
  measurement: z
    .object({
      raw: amount,
      correction: z.number().finite(),
      reason: z.string().max(500),
      revision,
      rule: z.literal("DEMO-QTY-01"),
    })
    .optional(),
  aiDecision: z
    .object({
      revision,
      decision: z.enum(["accepted", "dismissed"]),
      reason: z.string().max(500),
    })
    .optional(),
  persistence: z.literal("demo-only"),
  scenario: z.enum(["architecture", "ifc", "civil"]),
  project: text,
  document: text,
  revision,
  role: z.enum(["author", "reviewer", "approver", "viewer"]),
  phase: z.enum(["draft", "requested", "changes", "reviewed", "approved"]),
  calibrated: z.boolean(),
  scale: z
    .object({
      length: z.number().finite().positive().max(1e9),
      unit: z.enum(["mm", "m"]),
    })
    .optional(),
  quantityStatus: z.enum(["missing", "current", "stale"]),
  object: z.object({
    rateSource:priceBookEntrySchema.optional(),
    geometryChanged: z.boolean().optional(),
    appearance: z
      .object({
        layer: z.string().max(80),
        stroke: z.string().regex(/^#[0-9a-f]{6}$/i),
        fill: z.string().regex(/^#[0-9a-f]{6}$/i),
        lineWidth: z.number().min(0.1).max(20),
      })
      .optional(),
    id: text,
    sourceId: text,
    name: text,
    location: text,
    unit: text,
    quantity: amount,
    baseline: amount,
    rate: amount,
  }),
  request: z.object({ objectId: text, revision, message: text }).nullable(),
  approved: z
    .object({
      rateSource:priceBookEntrySchema.optional(),
      revision,
      quantity: amount,
      amount,
      objectId: text.optional(),
      sourceId: text.optional(),
      objectName: text.optional(),
      document: text.optional(),
      unit: text.optional(),
      rate: amount.optional(),
    })
    .nullable(),
  history: z.array(z.object({ revision, label: text })).max(10000),
  delivery: z.enum(["unprepared", "prepared"]),
  importSetup: z
    .object({
      format: z.enum(["PDF", "IFC", "DWG"]),
      unit: z.enum(["mm", "m"]),
      page: z.number().int().min(1).max(9999),
    })
    .optional(),
});
const documentShape = z.object({
  customProperties:customPropertiesSchema.optional(),
  layerId:z.string().min(1).max(100).optional(),
  quantity: documentQuantitySchema.optional(),
  kind: z.enum(["rectangle", "line", "circle", "text", "polyline"]).optional(),
  points:z.array(z.object({x:z.number().finite().min(0).max(1),y:z.number().finite().min(0).max(1)})).min(2).max(100).optional(),
  closed:z.boolean().optional(),
  stroke: z
    .string()
    .regex(/^#[a-fA-F0-9]{6}$/)
    .optional(),
  fill: z
    .string()
    .regex(/^(none|#[a-fA-F0-9]{6})$/)
    .optional(),
  lineWidth: z.number().finite().min(0.5).max(12).optional(),
  id: z.string().min(1).max(100),
  x: z.number().finite().min(0).max(680),
  y: z.number().finite().min(0).max(440),
  width: z.number().finite().min(10).max(600).optional(),
  height: z.number().finite().min(10).max(400).optional(),
  rotation: z.number().finite().min(-180).max(180).optional(),
  label: z.string().max(120),
  page: z.number().int().min(1).optional(),
}).refine(shape=>shape.x+(shape.width??120)<=800&&shape.y+(shape.height??80)<=520)
.refine(shape=>shape.kind==='polyline'?Boolean(shape.points&&(!shape.closed||shape.points.length>=3)):!shape.points&&!shape.closed);
const documentDelivery = z.object({
  batchId:z.string().min(1).max(100).optional(),
  ...deliveryIdentityFields,
  output:outputJobSchema.optional(),
  quantityReviewSequence: z.number().int().min(1).max(20).optional(),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  linkStatus: z.enum(["active", "expired"]).optional(),
  revision: z.number().int().min(1),
  recipient: z.string().min(1).max(120),
  status: z.enum(["prepared", "received", "correction"]),
  feedback: z.string().max(500).optional(),
}).refine(value=>Boolean(value.reference)===Boolean(value.issuedOn));
const documentSource = z.object({
  name: z.string().min(1).max(500),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  pages: z.number().int().min(1),
});
const documentReviewRound = z.object({
  fieldEvidence:documentFieldNoteSchema.optional(),
  layers:documentLayersSchema.optional(),
  revision: z.number().int().min(1),
  source: documentSource,
  objects: z.array(documentShape).max(500),
  targetId: z.string().min(1).max(100),
  message: z.string().min(1).max(500),
  phase: z.enum(["requested", "changes", "reviewed", "approved"]),
  reviewNote: z.string().max(500).optional(),
  approvalNote: z.string().max(500).optional(),
}).refine(round=>{
  const evidence=round.fieldEvidence;
  if(!evidence)return true;
  const shape=round.objects.find(shape=>shape.id===round.targetId);
  return Boolean(shape&&evidence.objectId===round.targetId&&evidence.source.sha256===round.source.sha256&&evidence.page===(shape.page??1)&&evidence.x===shape.x&&evidence.y===shape.y&&evidence.revision<=round.revision);
});
const snapshot = z
  .object({
    version: z.literal(1),
    projects:projectsSchema.optional(),
    propertyStandards:propertyStandardsSchema.optional(),
    savedTemplates:z.array(z.object({id:z.string().min(1).max(80),name:z.string().trim().min(1).max(120),layers:documentLayersSchema,shapes:z.array(documentShape.refine(shape=>!shape.quantity&&shape.page===1)).min(1).max(500)}).strict().refine(template=>new Set(template.shapes.map(shape=>shape.id)).size===template.shapes.length&&template.shapes.every(shape=>draftLayer(template,shape)))).max(20).refine(templates=>new Set(templates.map(template=>template.id)).size===templates.length).optional(),
    importRecords:z.array(importManifestSchema).max(100).refine(records=>new Set(records.map(record=>record.id)).size===records.length).optional(),
    blankDocuments: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          title: z.string().min(1).max(120),
          projectId:z.string().min(1).max(100).optional(),
          layers:documentLayersSchema.optional(),
          revision: z.number().int().min(1).optional(),
          reviewRounds: z.array(documentReviewRound).max(30).optional(),
          quantityReviews:z.array(quantityReviewSchema).max(20).optional(),
          measurements:z.array(measurementRecord).max(100).refine(records=>new Set(records.map(record=>record.id)).size===records.length).optional(),
          fieldNotes:z.array(documentFieldNoteSchema).max(100).refine(records=>new Set(records.map(record=>record.id)).size===records.length).optional(),
          materialEvents:z.array(materialEventSchema).max(500).refine(records=>new Set(records.map(record=>record.id)).size===records.length).optional(),
          objectComments:z.array(objectCommentSchema).max(200).refine(records=>new Set(records.map(record=>record.id)).size===records.length).optional(),
          rfis:z.array(rfiSchema).max(100).refine(records=>new Set(records.map(record=>record.id)).size===records.length).optional(),
          submittals:submittalsSchema.optional(),
          inspections:inspectionsSchema.optional(),
          dailyReports:dailyReportsSchema.optional(),
          contract:contractSchema.optional(),
          paymentClaims:paymentClaimsSchema.optional(),
          assetRegister:assetRegisterSchema.optional(),
          handovers:handoversSchema.optional(),
          carbonAssessments:carbonAssessmentsSchema.optional(),
          rfiDrafts:z.array(rfiDraftSchema).max(200).refine(records=>new Set(records.map(record=>record.key)).size===records.length).optional(),
          shares:z.array(z.object({sequence:z.number().int().min(1).max(20),recipient:z.string().email().max(254),permission:z.enum(['view','comment']),includeQuantity:z.boolean(),title:z.string().min(1).max(120),revision:z.number().int().positive(),source:documentSource.optional(),objects:z.array(documentShape).max(500),status:z.enum(['active','expired']),invitation:z.enum(['pending','accepted','declined']).optional(),feedback:z.array(z.string().trim().min(1).max(500)).max(50),accessRequests:z.array(shareAccessSchema).max(20).refine(requests=>requests.every((request,index)=>request.id===index+1)&&requests.filter(request=>request.status==='pending').length<=1).optional()}).refine(share=>share.includeQuantity||share.objects.every(object=>!object.quantity)).refine(share=>share.status==='expired'||!share.accessRequests?.some(request=>request.status==='pending'))).max(20).refine(shares=>new Set(shares.map(share=>share.sequence)).size===shares.length).optional(),
          delivery: documentDelivery.optional(),
          deliveryHistory: z.array(documentDelivery).max(100).optional(),
          source: z
            .object({
              name: z.string().min(1).max(500),
              sha256: z.string().regex(/^[a-f0-9]{64}$/),
              pages: z.number().int().min(1),
            })
            .optional(),
          page: z.number().int().min(1).optional(),
          shapes: z.array(documentShape).max(500),
        }),
      )
      .max(30)
      .optional(),
    scenarios: z.object({
      architecture: workflow,
      ifc: workflow,
      civil: workflow,
    }),
    drafts: z.record(z.string().max(500)),
  })
  .superRefine((data, ctx) => {
    for (const document of data.blankDocuments ?? []) {
      if(document.projectId&&!data.projects?.some(project=>project.id===document.projectId))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Document project reference is missing'});
      if(!validOutputJobs(document))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Output job approval source is missing or changed'});
      if(!validMaterialHistory(document))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Material history has missing approval or invalid quantity progression'});
      for(const group of [{layers:document.layers,objects:document.shapes},...(document.reviewRounds??[])]) {
        if(group.objects.some(shape=>!draftLayer(group,shape)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Object layer reference is missing'});
      }
      for (const delivery of [
        ...(document.deliveryHistory ?? []),
        ...(document.delivery ? [document.delivery] : []),
      ]) {
        if (delivery.quantityReviewSequence !== undefined && !deliveryQuantityReview(document, delivery.revision, delivery.quantityReviewSequence)) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Delivery quantity approval does not match its drawing snapshot'});
        if (
          !document.reviewRounds?.some(
            (round) =>
              round.revision === delivery.revision &&
              round.phase === "approved",
          )
        )
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Delivery requires an approved document revision",
          });
      }
    }
    for (const [key, state] of Object.entries(data.scenarios)) {
      if (
        state.scenario !== key ||
        (state.request && state.request.objectId !== state.object.id)
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Scenario evidence mismatch",
        });
    }
  });
export type WorkflowSession = {
  projects?:LocalProject[];
  propertyStandards?:PropertyStandard[];
  savedTemplates?:SavedDrawingTemplate[];
  importRecords?:ImportRecord[];
  blankDocuments?: WorkflowBlankDocument[];
  scenarios: Record<Scenario, Workflow>;
  drafts: Record<string, string>;
};
export const workflowAutosaveLimit=2_000_000;
export const workflowBackupLimit=20_000_000;
export function encodeWorkflowSession(value: WorkflowSession,maxCharacters=workflowAutosaveLimit) {
  const raw=JSON.stringify(snapshot.parse({ ...value, version: 1 }));
  if(raw.length>Math.min(maxCharacters,workflowBackupLimit))throw new Error('작업 크기가 저장 한도를 초과했습니다.');
  return raw;
}
export function decodeWorkflowSession(raw: string,maxCharacters=workflowAutosaveLimit): WorkflowSession | null {
  if (raw.length > Math.min(maxCharacters,workflowBackupLimit)) return null;
  try {
    const result = snapshot.safeParse(JSON.parse(raw));
    return result.success
      ? {
          scenarios: result.data.scenarios,
          projects:result.data.projects??[],
          savedTemplates:result.data.savedTemplates??[],
          propertyStandards:result.data.propertyStandards??[],
          drafts: result.data.drafts,
          blankDocuments: result.data.blankDocuments ?? [],
          importRecords:result.data.importRecords??[],
        }
      : null;
  } catch {
    return null;
  }
}
