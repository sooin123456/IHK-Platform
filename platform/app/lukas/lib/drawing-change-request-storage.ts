import type {ChangeRequestPreview} from "../components/drawing-change-request-preview";
import type {DrawingRequestSnapshot} from "../components/drawing-request-snapshot";
import {parseScreenDraft} from "./drawing-screen-draft-storage";

const record=(value:unknown):value is Record<string,unknown>=>typeof value==="object"&&value!==null&&!Array.isArray(value);
const text=(value:unknown)=>typeof value==="string";
const finite=(value:unknown)=>typeof value==="number"&&Number.isFinite(value);

export function parseDrawingRequestSnapshot(snapshot:unknown):DrawingRequestSnapshot{
  if(!record(snapshot)||typeof snapshot.documentName!=="string"||snapshot.documentName.length>500||!Number.isSafeInteger(snapshot.pageCount)||Number(snapshot.pageCount)<1||Number(snapshot.pageCount)>10000)throw Error("Invalid drawing snapshot");
  if(snapshot.source!==undefined){
    const source=snapshot.source;
    if(!record(source))throw Error("Invalid snapshot source");
    if(source.kind==="pdf"){
      if(typeof source.fileName!=="string"||!source.fileName||source.fileName.length>500||!Number.isSafeInteger(source.byteSize)||Number(source.byteSize)<=0||typeof source.fingerprint!=="string"||! /^[a-f0-9]{64}$/.test(source.fingerprint))throw Error("Invalid PDF snapshot source");
    }else if(!["blank","office","house"].includes(String(source.kind))||!["A2","A3","A4"].includes(String(source.paper)))throw Error("Invalid template snapshot source");
  }
  const parsed=parseScreenDraft(JSON.stringify({schemaVersion:1,source:"request",objects:snapshot.objects,layers:snapshot.layers}),"request");
  if(parsed.objects.some(object=>object.page>Number(snapshot.pageCount)))throw Error("Invalid snapshot page");
  return snapshot as DrawingRequestSnapshot;
}

/** Refuse invalid records instead of treating unreadable history as an empty document. */
export function parseChangeRequestStorage(raw:string):ChangeRequestPreview[]{
  const value:unknown=JSON.parse(raw);
  if(!record(value)||value.schemaVersion!==1||!Array.isArray(value.requests))throw Error("Invalid request history");
  let previous=0;
  for(const request of value.requests){
    if(!record(request)||!Number.isSafeInteger(request.round)||Number(request.round)<=previous||!text(request.message)||!Array.isArray(request.items)||!request.items.length||!record(request.decisions))throw Error("Invalid request");
    previous=Number(request.round);
    if(request.drawingRevision!==undefined&&(!Number.isSafeInteger(request.drawingRevision)||Number(request.drawingRevision)<1))throw Error("Invalid request drawing revision");
    if(request.snapshot!==undefined)parseDrawingRequestSnapshot(request.snapshot);
    const ids=new Set<string>();
    for(const item of request.items){
      if(!record(item)||typeof item.id!=="string"||!item.id||ids.has(item.id)||!Number.isSafeInteger(item.page)||Number(item.page)<1||!["added","modified","removed"].includes(String(item.kind))||typeof item.sample!=="boolean"||!["title","author","summary","before","after"].every(key=>text(item[key]))||!["x","y","width","height"].every(key=>finite(item[key])))throw Error("Invalid request item");
      ids.add(item.id);
      if(item.rotation!==undefined&&(!finite(item.rotation)||Number(item.rotation)<0||Number(item.rotation)>359))throw Error("Invalid request rotation");
    }
    for(const [id,decision] of Object.entries(request.decisions)){
      if(!ids.has(id)||!record(decision)||!["checked","changes"].includes(String(decision.kind))||typeof decision.note!=="string"||(decision.kind==="changes"&&!decision.note.trim()))throw Error("Invalid request decision");
    }
    if(request.approval!==undefined){
      if(!record(request.approval)||typeof request.approval.note!=="string"||request.approval.note.length>1000||typeof request.approval.at!=="string"||!Number.isFinite(Date.parse(request.approval.at))||[...ids].some(id=>!record((request.decisions as Record<string,unknown>)[id])||((request.decisions as Record<string,Record<string,unknown>>)[id]).kind!=="checked"))throw Error("Invalid request approval");
    }
  }
  return value.requests as ChangeRequestPreview[];
}
