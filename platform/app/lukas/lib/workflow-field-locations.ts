import type {WorkflowBlankDocument} from './workflow-blank-document';
import type {DocumentFieldNote} from './workflow-document-field';
export function fieldRecordPath(record:DocumentFieldNote){
 const path=record.locationPath;
 return !path?['free',record.location]:path.kind==='building'?['building',path.building,path.floor,path.room]:['civil',path.route,path.section,path.station];
}
export function indexFieldLocations(documents:WorkflowBlankDocument[]){
 const groups=new Map<string,{key:string;label:string;records:{document:WorkflowBlankDocument;record:DocumentFieldNote}[]}>();
 for(const document of documents)for(const record of document.fieldNotes??[]){const path=fieldRecordPath(record);for(let depth=1;depth<=path.length;depth++){
  const key=JSON.stringify(path.slice(0,depth));let group=groups.get(key);if(!group){group={key,label:[path[0]==='building'?'건축':path[0]==='civil'?'토목':'직접 입력',...path.slice(1,depth)].join(' / '),records:[]};groups.set(key,group);}group.records.push({document,record});
 }}return [...groups.values()];
}
