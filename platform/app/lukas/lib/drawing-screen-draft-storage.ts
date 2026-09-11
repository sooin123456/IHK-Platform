import {validTarget} from "../components/drawing-review-loop";
import type {ScreenShape} from "../components/drawing-screen-object-preview";
import type {PreviewLayer} from "../components/drawing-document-preview";

export function parseScreenDraft(raw:string,source:string):{objects:ScreenShape[];layers:PreviewLayer[]}{
  const value=JSON.parse(raw);
  if(!value||value.schemaVersion!==1||value.source!==source||!Array.isArray(value.objects)||!Array.isArray(value.layers)||!value.layers.length)throw Error("Invalid drawing draft");
  const layers=new Set<string>();
  for(const layer of value.layers){
    if(!layer||typeof layer.id!=="string"||!layer.id||layers.has(layer.id)||typeof layer.name!=="string"||typeof layer.visible!=="boolean"||typeof layer.locked!=="boolean")throw Error("Invalid drawing layer");
    layers.add(layer.id);
  }
  const ids=new Set<string>();
  for(const object of value.objects){
    if(!validTarget(object)||ids.has(object.id)||!layers.has(object.layer))throw Error("Invalid drawing object");
    ids.add(object.id);
  }
  return {objects:value.objects,layers:value.layers};
}
