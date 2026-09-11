import {z} from 'zod';
import type {WorkflowBlankDocument} from './workflow-blank-document';
const inputs={start:z.number().int().min(1).max(30),end:z.number().int().min(1).max(30),progress:z.number().min(0).max(100),predecessorId:z.string().min(1).max(100).optional()};
const inputSchema=z.object(inputs).refine(value=>value.start<=value.end);
const planSchema=z.object({objectId:z.string().min(1).max(100),revision:z.number().int().min(1),page:z.number().int().min(1),x:z.number().finite(),y:z.number().finite(),hash:z.union([z.literal(''),z.string().regex(/^[a-f0-9]{64}$/)]),...inputs}).refine(value=>value.start<=value.end);
export type ObjectSchedule=z.infer<typeof planSchema>;
export const scheduleCalendarKey=(documentId:string)=>`schedule-calendar:${encodeURIComponent(documentId)}`;
function dateMillis(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const time=Date.parse(`${value}T00:00:00Z`);return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value?time:null;}
export function scheduleDate(base:string,day:number):string|null{const time=dateMillis(base);if(time===null||!Number.isInteger(day)||day<1||day>30)return null;const result=new Date(time+(day-1)*86400000).toISOString();return /^\d{4}-/.test(result)?result.slice(0,10):null;}
export function scheduleDay(base:string,date:string):number|null{const first=dateMillis(base),last=dateMillis(date);if(first===null||last===null)return null;const day=(last-first)/86400000+1;return Number.isInteger(day)&&day>=1&&day<=30?day:null;}
export const scheduleKey=(documentId:string,objectId:string)=>`schedule:${encodeURIComponent(documentId)}:${encodeURIComponent(objectId)}`;
export function readObjectSchedule(raw?:string):ObjectSchedule|null{try{const parsed=planSchema.safeParse(JSON.parse(raw??''));return parsed.success?parsed.data:null;}catch{return null;}}
export function makeObjectSchedule(document:WorkflowBlankDocument,objectId:string,input:{start:number;end:number;progress:number;predecessorId?:string}):ObjectSchedule|null{
 const shape=document.shapes.find(shape=>shape.id===objectId);const value=inputSchema.safeParse(input);if(!shape||!value.success)return null;
 return {objectId,revision:document.revision??1,page:shape.page??1,x:shape.x,y:shape.y,hash:document.source?.sha256??'',...value.data};
}
export function scheduleMatches(document:WorkflowBlankDocument,plan:ObjectSchedule){const shape=document.shapes.find(shape=>shape.id===plan.objectId);return Boolean(shape&&(document.revision??1)===plan.revision&&(document.source?.sha256??'')===plan.hash&&(shape.page??1)===plan.page&&shape.x===plan.x&&shape.y===plan.y);}
export function scheduleProgress(plan:ObjectSchedule,day:number){return Math.round(Math.min(1,Math.max(0,(day-plan.start+1)/(plan.end-plan.start+1)))*100);}
export function scheduleDependencyIssue(document:WorkflowBlankDocument,plan:ObjectSchedule,plans:ObjectSchedule[]):string|null{
 const byId=new Map([...plans,plan].map(item=>[item.objectId,item]));const visited=new Set<string>();let current=plan,overlap=false;
 while(current.predecessorId){
  if(visited.has(current.objectId))return '선행 작업이 순환합니다. 연결을 바꿔주세요.';
  visited.add(current.objectId);const prior=byId.get(current.predecessorId);
  if(!prior)return '선행 작업의 공정 기록이 없습니다. 먼저 기간을 등록하세요.';
  if(!scheduleMatches(document,prior))return '선행 작업의 도면 근거가 바뀌었습니다. 연결을 재확인하세요.';
  if(current.start<=prior.end)overlap=true;current=prior;
 }
 return overlap?'선행 작업 종료 후 시작해야 합니다. 연결된 기간을 확인하세요.':null;
}
export function scheduleVisualState(document:WorkflowBlankDocument,objectId:string,plans:ObjectSchedule[],day:number){
 if(!Number.isInteger(day)||day<1||day>30)return 'unavailable';
 const plan=plans.find(plan=>plan.objectId===objectId);if(!plan)return 'unplanned';
 if(!scheduleMatches(document,plan))return 'stale';
 if(scheduleDependencyIssue(document,plan,plans))return 'conflict';
 return day<plan.start?'waiting':day>=plan.end?'complete':'active';
}
