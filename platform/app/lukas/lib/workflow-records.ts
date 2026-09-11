import type {WorkflowBlankDocument} from './workflow-blank-document';
import {inspectionPhase} from './workflow-inspections';
export const recordKinds={drawing:'도면 검토',quantity:'수량 검산',rfi:'설계 질의',submittal:'제출물',delivery:'배포',daily:'작업일보',payment:'기성',handover:'준공 인계',material:'자재',inspection:'검측',carbon:'탄소 근거',comment:'댓글',field:'현장 기록',share:'공유'};
export type WorkflowRecord={key:string;documentId:string;documentTitle:string;kind:keyof typeof recordKinds;title:string;status:string;summary:string;destination:Record<string,string>};
const phases:Record<string,string>={requested:'검토 대기',reviewed:'검토 완료',approved:'승인',changes:'보완 요청',draft:'초안',submitted:'검토 대기',accepted:'확인 완료',answered:'답변 완료',closed:'종결',prepared:'준비',received:'수신 확인',correction:'보완 필요',reinspection:'재검측 대기',new:'미검측',active:'활성',expired:'만료'};
export function workflowRecords(documents:WorkflowBlankDocument[]):WorkflowRecord[]{
 return documents.flatMap(doc=>{const rows:WorkflowRecord[]=[];
  const add=(kind:WorkflowRecord['kind'],id:string|number,title:string,status:string,summary:string,destination:Record<string,string>)=>rows.push({key:JSON.stringify([doc.id,kind,id]),documentId:doc.id,documentTitle:doc.title,kind,title,status:phases[status]??status,summary,destination:{scope:'local',...(doc.projectId?{project:doc.projectId}:{}),...destination}});
  for(const row of doc.reviewRounds??[])add('drawing',row.revision,`도면 검토 R${row.revision}`,row.phase,row.approvalNote??row.reviewNote??row.message,row.phase==='approved'?{page:'workspace',blank:doc.id,snapshot:String(row.revision),target:row.targetId,localRole:'viewer'}:{page:'overview',recordReviewDocument:doc.id,recordReviewRevision:String(row.revision)});
  for(const row of doc.quantityReviews??[])add('quantity',row.sequence,`검산 #${row.sequence} · R${row.revision}`,row.phase,row.source.name,{page:'quantities',quantityDocument:doc.id,comparisonSequence:String(row.sequence)});
  for(const row of doc.rfis??[])add('rfi',row.id,`RFI #${row.id} · ${row.title}`,row.phase,row.closure??row.answer??row.text,{page:'issues',rfiDocument:doc.id,rfiSearch:row.title,rfiRole:'viewer'});
  for(const row of doc.submittals??[])add('submittal',row.id,`제출 #${row.id} · ${row.title}`,row.phase,row.decision??row.message,{page:'submittals',submissionDocument:doc.id,submissionItem:String(row.id),submissionRole:'viewer'});
  for(const row of [...(doc.deliveryHistory??[]),...(doc.delivery?[doc.delivery]:[])])add('delivery',row.sequence??0,`배포 #${row.sequence??0} · R${row.revision}`,row.status,[row.reference,row.recipient,row.feedback].filter(Boolean).join(' · '),{page:'transmittals',transmittalSearch:row.reference??doc.title});
  for(const row of doc.dailyReports??[])add('daily',row.id,`일보 #${row.id} · ${row.date}`,row.phase,row.work,{page:'daily',dailyDocument:doc.id,dailyReport:String(row.id),dailyRole:'viewer'});
  for(const row of doc.paymentClaims??[])add('payment',row.id,`기성 #${row.id} · ${row.period}`,row.phase,row.note,{page:'payments',paymentDocument:doc.id,paymentRole:'viewer'});
  for(const row of doc.handovers??[])add('handover',row.id,`준공 인계 #${row.id} · R${row.revision}`,row.phase,row.recipient,{page:'handover',handoverDocument:doc.id,handoverRevision:String(row.revision),handoverRole:'viewer'});
  const actions:Record<string,string>={order:'발주',receive:'입고',install:'설치','cancel-order':'발주 취소',return:'반품',uninstall:'설치 취소'};
  for(const row of doc.materialEvents??[])add('material',row.id,`${actions[row.kind]} #${row.id} · ${row.amount}`,'기록',row.reason,{page:'materials',materialDocument:doc.id,materialSequence:String(row.sequence),materialObject:row.objectId});
  for(const row of doc.inspections??[])add('inspection',row.fieldNoteId,`현장 기록 #${row.fieldNoteId} 검측`,inspectionPhase(row),row.events.at(-1)?.note??'',{page:'field',fieldDocument:doc.id});
  for(const row of doc.carbonAssessments??[])add('carbon',row.id,`탄소 근거 #${row.id} · ${row.stage}`,'보관',row.note,{page:'carbon',carbonDocument:doc.id});
  for(const row of doc.objectComments??[])add('comment',row.id,`댓글 #${row.id} · ${row.objectLabel}`,'보관',row.text,{page:'issues',commentSearch:row.text.slice(0,80)});
  for(const row of doc.fieldNotes??[])add('field',row.id,`현장 #${row.id} · ${row.objectLabel}`,'보관',row.location,{page:'field',fieldDocument:doc.id});
  for(const row of doc.shares??[])add('share',row.sequence,`공유 #${row.sequence}`,row.status,row.recipient,{page:'workspace',blank:doc.id,localRole:'viewer'});
  return rows;
 });
}
export function filterWorkflowRecords(rows:WorkflowRecord[],filters:{kind?:string;search?:string;document?:string}){
 const search=filters.search?.trim().toLocaleLowerCase()??'';
 return rows.filter(row=>(!filters.kind||row.kind===filters.kind)&&(!filters.document||row.documentId===filters.document)&&(!search||`${row.documentTitle} ${row.title} ${row.status} ${row.summary}`.toLocaleLowerCase().includes(search)));
}
