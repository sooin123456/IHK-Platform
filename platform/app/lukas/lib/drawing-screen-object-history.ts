import type {ScreenShape} from "../components/drawing-screen-object-preview";
export type ScreenObjectHistory<T=ScreenShape>={past:T[][];present:T[];future:T[][];group?:string};
type Action<T=ScreenShape>={type:"record";update:(objects:T[])=>T[];group?:string}|{type:"reset";objects?:T[]}|{type:"undo"|"redo"};
export function screenObjectHistory(state:ScreenObjectHistory,action:Action):ScreenObjectHistory{return editObjectHistory(state,action);}
export function editObjectHistory<T>(state:ScreenObjectHistory<T>,action:Action<T>):ScreenObjectHistory<T>{
  if(action.type==="reset")return {past:[],present:action.objects??state.present,future:[]};
  if(action.type==="record"){
    const present=action.update(state.present);
    if(JSON.stringify(present)===JSON.stringify(state.present))return state;
    return {past:action.group&&action.group===state.group?state.past:[...state.past,state.present].slice(-100),present,future:[],group:action.group};
  }
  if(action.type==="undo"&&state.past.length)return {past:state.past.slice(0,-1),present:state.past.at(-1)!,future:[state.present,...state.future]};
  if(action.type==="redo"&&state.future.length)return {past:[...state.past,state.present],present:state.future[0],future:state.future.slice(1)};
  return state;
}
export function canRestoreScreenObjects(current:ScreenShape[],next:ScreenShape[],layers:{id:string;locked:boolean}[],targetId?:string):boolean{
  const before=new Map(current.map(shape=>[shape.id,shape]));
  const after=new Map(next.map(shape=>[shape.id,shape]));
  for(const id of new Set([...before.keys(),...after.keys()])){
    const a=before.get(id),b=after.get(id);
    if(JSON.stringify(a)===JSON.stringify(b))continue;
    if((id===targetId&&(!a||!b||a.page!==b.page||a.kind!==b.kind))||[a,b].some(shape=>shape&&!layers.some(layer=>layer.id===shape.layer&&!layer.locked)))return false;
  }
  return true;
}
