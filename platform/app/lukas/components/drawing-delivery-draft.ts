import {parseReviewLoopSession} from "./drawing-review-loop";
import {parseChangeRequestStorage,parseDrawingRequestSnapshot} from "../lib/drawing-change-request-storage";
import type {DeliveryConfiguration,DeliveryStage} from "./drawing-delivery-preview";
import type {DrawingScreenWorkflowProps,DrawingScreenExportSelection} from "./drawing-screen-workflow";

type DeliveryPackage={
  deliveryConfiguration:DeliveryConfiguration;
  deliverySource:Pick<DrawingScreenWorkflowProps,"documentName"|"page"|"pageCount"|"reviewState"|"reviewContext"|"reviewLoop"|"approvedRequest"|"drawingSnapshot">|null;
  deliveryStage:DeliveryStage;
  exportSelection:DrawingScreenExportSelection|null;
};
export type DeliveryRecord=DeliveryPackage&{id:string;createdAt:string};
export type DeliveryDraft=DeliveryPackage&{deliveryHistory:DeliveryRecord[];pendingApprovedRequest?:DrawingScreenWorkflowProps["approvedRequest"]};

export function parseDeliveryDraft(raw:string):DeliveryDraft|null {
  try{
    // Browser storage enforces capacity; validate records instead of rejecting valid snapshot histories by text size.
    const value=JSON.parse(raw) as DeliveryDraft&{schema:number};
    if(!value||value.schema!==1||!["package","preparing","failed","recipient"].includes(value.deliveryStage))return null;
    const config=value.deliveryConfiguration;
    if(!config||!["발주 담당 · 예시","현장 담당 · 예시","협력사 담당 · 예시"].includes(config.recipient)||typeof config.includeEvidence!=="boolean"||typeof config.includeBoq!=="boolean"||!["xlsx","csv"].includes(config.boqFormat))return null;
    const selection=value.exportSelection,source=value.deliverySource;
    if(value.pendingApprovedRequest!==undefined){
      const [request]=parseChangeRequestStorage(JSON.stringify({schemaVersion:1,requests:[value.pendingApprovedRequest]}));
      if(!request.approval)return null;
      value.pendingApprovedRequest=request;
    }
    if(selection===null){if(source!==null||value.deliveryStage!=="package")return null;}
    else {
      if(!selection||!["pdf","png","svg","dwg"].includes(selection.format)||!["current","all"].includes(selection.pageRange)||typeof selection.includeComments!=="boolean")return null;
      if(!source||typeof source.documentName!=="string"||source.documentName.length>500||![source.page,source.pageCount].every(n=>Number.isSafeInteger(n)&&n>0)||source.page>source.pageCount||!["draft","requested","reviewed","changes","approved"].includes(source.reviewState))return null;
      const context=source.reviewContext;
      if(source.drawingSnapshot!==undefined){
        source.drawingSnapshot=parseDrawingRequestSnapshot(source.drawingSnapshot);
        if(source.drawingSnapshot.pageCount!==source.pageCount||source.drawingSnapshot.documentName!==source.documentName)return null;
      }
      if(source.approvedRequest!==undefined){
        const [request]=parseChangeRequestStorage(JSON.stringify({schemaVersion:1,requests:[source.approvedRequest]}));
        if(!request.approval)return null;
        source.approvedRequest=request;
      }
      if(context!==undefined&&(!context||![context.revision,context.page].every(n=>Number.isSafeInteger(n)&&n>0)||context.page>source.pageCount||context.targetName!==undefined&&(typeof context.targetName!=="string"||context.targetName.length>80)))return null;
      if(source.reviewLoop!==undefined){
        const record=parseReviewLoopSession(JSON.stringify(source.reviewLoop));
        if(!record||record.page>source.pageCount||context&&(record.revision!==context.revision||record.page!==context.page)||(["changed","revised"].includes(record.phase)?"draft":record.phase)!==source.reviewState)return null;
        source.reviewLoop=record;
      }
    }
    const history=value.deliveryHistory===undefined?[]:value.deliveryHistory;
    if(!Array.isArray(history))return null;
    const deliveryHistory:DeliveryRecord[]=[];
    const ids=new Set<string>();
    for(const item of history){
      if(!item||typeof item.id!=="string"||!item.id||item.id.length>100||ids.has(item.id)||typeof item.createdAt!=="string"||!Number.isFinite(Date.parse(item.createdAt)))return null;
      const saved=parseDeliveryDraft(JSON.stringify({...item,schema:1,deliveryHistory:[]}));
      if(!saved?.deliverySource||!saved.exportSelection)return null;
      const {deliveryHistory:ignored,...snapshot}=saved;
      deliveryHistory.push({...snapshot,id:item.id,createdAt:item.createdAt});ids.add(item.id);
    }
    return {deliveryConfiguration:{recipient:config.recipient,includeEvidence:config.includeEvidence,includeBoq:config.includeBoq,boqFormat:config.boqFormat},deliverySource:source,deliveryStage:value.deliveryStage,exportSelection:selection,deliveryHistory,...(value.pendingApprovedRequest?{pendingApprovedRequest:value.pendingApprovedRequest}:{})};
  }catch{return null;}
}
