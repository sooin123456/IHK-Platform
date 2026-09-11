export type ChangeConversation={schemaVersion:1;drafts:Record<string,string>;notes:Record<string,{text:string;kind:string}[]>;noteKinds:Record<string,string>;checked:Record<string,boolean>;requestDraft?:{message:string;mode:"page"|"selected";ids:string[]}};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const text=(value:unknown)=>typeof value==="string"&&value.length<=1000;
const kind=(value:unknown)=>value==="의견"||value==="수정 요청";
export function parseChangeConversation(raw:string):ChangeConversation{
  if(raw.length>1000000)throw Error("Conversation too large");
  const value:unknown=JSON.parse(raw);
  if(!record(value)||value.schemaVersion!==1)throw Error("Invalid conversation");
  for(const field of ["drafts","notes","noteKinds","checked"]){
    const values=value[field];
    if(!record(values)||Object.keys(values).some(id=>!id||["__proto__","constructor","prototype"].includes(id)))throw Error("Invalid conversation fields");
    for(const entry of Object.values(values)){
      const valid=field==="drafts"?text(entry):field==="checked"?typeof entry==="boolean":field==="noteKinds"?kind(entry):Array.isArray(entry)&&entry.every(note=>record(note)&&text(note.text)&&kind(note.kind));
      if(!valid)throw Error("Invalid conversation entry");
    }
  }
  if(value.requestDraft!==undefined){
    const draft=value.requestDraft;
    if(!record(draft)||typeof draft.message!=="string"||draft.message.length>500||!["page","selected"].includes(String(draft.mode))||!Array.isArray(draft.ids)||draft.ids.some(id=>typeof id!=="string"||!id)||new Set(draft.ids).size!==draft.ids.length)throw Error("Invalid request draft");
  }
  return value as ChangeConversation;
}
