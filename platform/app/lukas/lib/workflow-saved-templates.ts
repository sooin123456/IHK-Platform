import type {WorkflowBlankDocument} from './workflow-blank-document';
import {documentLayers,validDraftLayers,type DocumentLayer} from './workflow-document-layers';
export type SavedDrawingTemplate={id:string;name:string;layers:DocumentLayer[];shapes:WorkflowBlankDocument['shapes']};
export function captureDrawingTemplate(document:WorkflowBlankDocument,id:string,name:string,page:number):SavedDrawingTemplate|null{
 if(!id||id.length>80||!name.trim()||name.trim().length>120||!Number.isInteger(page)||page<1)return null;
 const shapes=document.shapes.filter(shape=>(shape.page??1)===page).map(({quantity,customProperties,...shape})=>({...structuredClone(shape),page:1}));
 const layers=structuredClone(documentLayers(document));if(!shapes.length||shapes.length>500||!validDraftLayers({shapes},layers))return null;
 return {id,name:name.trim(),shapes,layers};
}
export function instantiateDrawingTemplate(template:SavedDrawingTemplate,id:string,title:string):WorkflowBlankDocument|null{
 if(!id||id.length>80||!title.trim()||title.trim().length>120)return null;
 return {id,title:title.trim(),page:1,layers:structuredClone(template.layers),shapes:template.shapes.map(({quantity,customProperties,...shape},index)=>({...structuredClone(shape),id:`${id}:${index}`,page:1}))};
}
