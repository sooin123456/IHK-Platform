export type SelectedTakeoffDraft={name:string;trade:string;step:"area"|"quantity"|"estimate"};
export function parseSelectedTakeoffDrafts(raw:string):Record<string,SelectedTakeoffDraft>{
 const value=JSON.parse(raw);
 if(!value||value.schemaVersion!==1||!value.rows||typeof value.rows!=="object"||Array.isArray(value.rows)||Object.keys(value.rows).length>10000)throw Error("Invalid quantity drafts");
 for(const [id,row] of Object.entries(value.rows)){
  const item=row as SelectedTakeoffDraft;
  if(!id||id.length>200||["__proto__","constructor","prototype"].includes(id)||!item||typeof item.name!=="string"||item.name.length>80||!["미분류","건축 마감","구조","기계 설비"].includes(item.trade)||!["area","quantity","estimate"].includes(item.step))throw Error("Invalid quantity row");
 }
 return value.rows;
}
