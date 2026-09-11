import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {ScreenBlockGlyph,type ScreenBlockCode} from "./drawing-screen-blocks";

export const screenShapeKinds = ["선", "폴리라인", "사각형", "원", "텍스트", "치수", "블록"] as const;
export type ScreenShapeKind = typeof screenShapeKinds[number];
export type ScreenShapeStyle = {name:string;layer:string;color:string;lineWidth:string;fill:string;text:string};
export const initialScreenShapeStyle:ScreenShapeStyle = {name:"",layer:"",color:"#6650f5",lineWidth:"0.25 mm",fill:"없음",text:"도면 메모"};
export const screenPropertyClassifications=["미분류","건축 마감","구조","기계 설비","전기 통신"] as const;
export type ScreenObjectProperties={classification:typeof screenPropertyClassifications[number];code:string;note:string;required:boolean};
export function validScreenObjectProperties(value:unknown):value is ScreenObjectProperties{
 if(!value||typeof value!=="object"||Array.isArray(value))return false;
 const properties=value as ScreenObjectProperties;
 return screenPropertyClassifications.includes(properties.classification)&&typeof properties.code==="string"&&properties.code.length<=40&&typeof properties.note==="string"&&properties.note.length<=500&&typeof properties.required==="boolean";
}
export type ScreenPoint={x:number;y:number};
export type ScreenPathGeometry={width:number;height:number;points:ScreenPoint[]};
export type ScreenShape = ScreenShapeStyle & {id:string;kind:ScreenShapeKind;page:number;x:number;y:number;width?:number;height?:number;rotation?:number;properties?:ScreenObjectProperties;blockCode?:ScreenBlockCode;points?:ScreenPoint[]};

export function moveScreenSelection(objects:ScreenShape[],ids:string[],anchorId:string,x:number,y:number):ScreenShape[]{
  const selected=new Set(ids),members=objects.filter(object=>selected.has(object.id));
  const anchor=members.find(object=>object.id===anchorId);
  if(!anchor||!Number.isFinite(x)||!Number.isFinite(y))return objects;
  const dx=Math.max(-Math.min(...members.map(object=>object.x)),Math.min(1000-Math.max(...members.map(object=>object.x)),x-anchor.x));
  const dy=Math.max(-Math.min(...members.map(object=>object.y)),Math.min(700-Math.max(...members.map(object=>object.y)),y-anchor.y));
  if(!dx&&!dy)return objects;
  return objects.map(object=>selected.has(object.id)?{...object,x:object.x+dx,y:object.y+dy}:object);
}

/** Normalized screen mockup only; no CAD geometry, source mutation or measured dimensions. */
export function DrawingScreenObjectPreview({objects,selected,selectedIds,tool,onCreate,onSelect,onMove,controlsHost,onCancelTool,onChangePoints,onBoxSelect}:{objects:ScreenShape[];selected:string|null;selectedIds?:string[];tool:string;onCreate:(kind:ScreenShapeKind,x:number,y:number,geometry?:ScreenPathGeometry)=>void;onSelect:(id:string,extend?:boolean)=>void;onMove?:(id:string,x:number,y:number)=>void;controlsHost?:HTMLElement|null;onCancelTool?:()=>void;onChangePoints?:(id:string,points:ScreenPoint[])=>void;onBoxSelect?:(ids:string[],extend:boolean)=>void}) {
  const placing=screenShapeKinds.includes(tool as ScreenShapeKind);
  const surface=useRef<SVGSVGElement>(null);
  const [viewport,setViewport]=useState({width:1000,height:700});
  const [pathPoints,setPathPoints]=useState<ScreenPoint[]>([]);
  useEffect(()=>setPathPoints([]),[tool]);
  const finishPath=()=>{
    if(tool!=="폴리라인"||pathPoints.length<2)return;
    const x=Math.min(...pathPoints.map(point=>point.x)),y=Math.min(...pathPoints.map(point=>point.y));
    const width=Math.max(1,Math.max(...pathPoints.map(point=>point.x))-x);
    const yScale=viewport.height/700/viewport.width*1000;
    const height=Math.max(1,(Math.max(...pathPoints.map(point=>point.y))-y)*yScale);
    if(height>10000)return;
    const points=pathPoints.map(point=>({x:Math.min(140,Math.max(0,Math.round((point.x-x)/width*140*1e6)/1e6)),y:Math.min(90,Math.max(0,Math.round((point.y-y)*yScale/height*90*1e6)/1e6))}));
    onCreate("폴리라인",x,y,{width,height,points});setPathPoints([]);
  };
  const drag=useRef<{id:string;pointer:number;clientX:number;clientY:number;x:number;y:number;width:number;height:number}|null>(null);
  const [preview,setPreview]=useState<{id:string;x:number;y:number}|null>(null);
  const suppressClick=useRef(false);
  const boxStart=useRef<{x:number;y:number;pointer:number;extend:boolean}|null>(null);
  const [selectionBox,setSelectionBox]=useState<{x:number;y:number;width:number;height:number}|null>(null);
  const cancelBox=()=>{boxStart.current=null;setSelectionBox(null);};
  const boxAt=(x:number,y:number)=>{const start=boxStart.current;return start?{left:Math.min(start.x,x),top:Math.min(start.y,y),right:Math.max(start.x,x),bottom:Math.max(start.y,y)}:null;};
  useEffect(cancelBox,[Boolean(onBoxSelect),placing]);
  const ids=selectedIds??(selected?[selected]:[]);
  const vertexDrag=useRef<{id:string;index:number;pointer:number;inverse:DOMMatrix;points:ScreenPoint[]}|null>(null);
  const [vertexPreview,setVertexPreview]=useState<{id:string;points:ScreenPoint[]}|null>(null);
  const cancelVertex=()=>{vertexDrag.current=null;setVertexPreview(null);};
  useEffect(cancelVertex,[Boolean(onChangePoints),tool,selected,ids.join("|"),objects]);
  const vertexAt=(clientX:number,clientY:number)=>{
    const start=vertexDrag.current;if(!start)return null;
    const point=new DOMPoint(clientX,clientY).matrixTransform(start.inverse);
    return start.points.map((original,index)=>index===start.index?{x:Math.round(Math.max(0,Math.min(140,point.x))*1e6)/1e6,y:Math.round(Math.max(0,Math.min(90,point.y))*1e6)/1e6}:original);
  };
  const cancelDrag=()=>{drag.current=null;setPreview(null);};
  const dragPosition=(clientX:number,clientY:number)=>{
    const start=drag.current;if(!start)return null;
    return {id:start.id,x:Math.round(Math.max(0,Math.min(1000,start.x+(clientX-start.clientX)/start.width*1000))),y:Math.round(Math.max(0,Math.min(700,start.y+(clientY-start.clientY)/start.height*700)))};
  };
  useEffect(()=>{cancelDrag();},[Boolean(onMove),placing,selected,ids.join("|")]);
  useEffect(()=>{
    const node=surface.current;if(!node)return;
    const observer=new ResizeObserver(([entry])=>{
      const {width,height}=entry.contentRect;
      if(width>0&&height>0)setViewport(previous=>previous.width===width&&previous.height===height?previous:{width,height});
    });
    observer.observe(node);
    return()=>observer.disconnect();
  },[]);
  const pathControls=tool==="폴리라인"&&<div role="group" aria-label="폴리라인 작성 조작" style={{position:controlsHost?"relative":"absolute",top:controlsHost?undefined:8,left:controlsHost?undefined:8,maxWidth:controlsHost?"100%":"calc(100% - 16px)",zIndex:5,background:"white",border:"1px solid #ddd6fe",borderRadius:8,padding:6,display:"grid",gap:4,fontSize:12,lineHeight:"16px",boxShadow:"0 2px 8px #0f172a14"}} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
    <span role="status">{pathPoints.length}/256점 · 도면을 눌러 점 추가</span>
    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
      <button style={{minHeight:36,padding:"0 8px"}} disabled={!pathPoints.length} onClick={()=>{setPathPoints(points=>points.slice(0,-1));surface.current?.focus();}} aria-label="폴리라인 마지막 점 취소">↶ 한 점 취소</button>
      <button style={{minHeight:36,padding:"0 8px"}} disabled={!pathPoints.length} onClick={()=>{setPathPoints([]);surface.current?.focus();}} aria-label="폴리라인 점 초기화">전체 지우기</button>
      {onCancelTool&&<button style={{minHeight:36,padding:"0 8px"}} onClick={()=>{setPathPoints([]);onCancelTool();surface.current?.focus();}} aria-label="폴리라인 작성 취소">작성 취소</button>}
      <button style={{minHeight:36,padding:"0 10px",borderRadius:6,background:pathPoints.length<2?"#ede9fe":"#6650f5",color:pathPoints.length<2?"#64748b":"white"}} disabled={pathPoints.length<2} onClick={finishPath} aria-label="폴리라인 완료">완료 ↵</button>
    </div>
  </div>;
  return <><svg ref={surface} role="region" tabIndex={-1} aria-label="화면 도형 오버레이" viewBox={`0 0 ${viewport.width} ${viewport.height}`} style={{position:"absolute",inset:0,width:"100%",height:"100%",zIndex:3,pointerEvents:placing||onBoxSelect?"auto":"none",touchAction:onBoxSelect||tool==="폴리라인"?"none":undefined}}
    onPointerDown={event=>{if(placing){event.stopPropagation();return;}if(!onBoxSelect||event.target!==event.currentTarget||event.button!==0)return;event.preventDefault();event.stopPropagation();event.currentTarget.focus();boxStart.current={x:event.clientX,y:event.clientY,pointer:event.pointerId,extend:event.shiftKey};event.currentTarget.setPointerCapture(event.pointerId);}}
    onPointerMove={event=>{if(boxStart.current?.pointer!==event.pointerId)return;event.stopPropagation();const box=boxAt(event.clientX,event.clientY),bounds=event.currentTarget.getBoundingClientRect();if(box&&bounds.width&&bounds.height)setSelectionBox({x:(box.left-bounds.left)/bounds.width*viewport.width,y:(box.top-bounds.top)/bounds.height*viewport.height,width:(box.right-box.left)/bounds.width*viewport.width,height:(box.bottom-box.top)/bounds.height*viewport.height});}}
    onPointerUp={event=>{const start=boxStart.current;if(!start||start.pointer!==event.pointerId)return;event.stopPropagation();const box=boxAt(event.clientX,event.clientY);if(box&&onBoxSelect&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>=3){const found=[...event.currentTarget.querySelectorAll<SVGGElement>('[data-screen-shape]')].filter(node=>{const bounds=node.getBoundingClientRect();return bounds.left>=box.left&&bounds.right<=box.right&&bounds.top>=box.top&&bounds.bottom<=box.bottom;}).map(node=>node.getAttribute('data-screen-shape')!);onBoxSelect(found,start.extend);}cancelBox();}}
    onPointerCancel={cancelBox} onLostPointerCapture={cancelBox}
    onKeyDown={event=>{
      if(tool==="폴리라인"&&!event.nativeEvent.isComposing){
        if(event.key==="Enter"){event.preventDefault();event.stopPropagation();finishPath();return;}
        if(event.key==="Escape")setPathPoints([]);
        if(event.key==="Backspace"||((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="z")){event.preventDefault();event.stopPropagation();setPathPoints(points=>points.slice(0,-1));return;}
      }
      if(event.key==="Escape"&&boxStart.current){event.preventDefault();event.stopPropagation();cancelBox();}
    }}
    onClick={event=>{if(!placing)return;event.stopPropagation();const bounds=event.currentTarget.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
      if(tool==="폴리라인"){
        event.currentTarget.focus();const point={x:Math.max(0,Math.min(1000,(event.clientX-bounds.left)/bounds.width*1000)),y:Math.max(0,Math.min(700,(event.clientY-bounds.top)/bounds.height*700))};
        setPathPoints(points=>points.length>=256||points.some((last,index)=>index===points.length-1&&Math.hypot(last.x-point.x,last.y-point.y)<.1)?points:[...points,point]);return;
      }
      onCreate(tool as ScreenShapeKind,Math.max(0,Math.min(840,(event.clientX-bounds.left)/bounds.width*1000)),Math.max(0,Math.min(580,(event.clientY-bounds.top)/bounds.height*700)));
    }}>
    {(preview?moveScreenSelection(objects,ids,preview.id,preview.x,preview.y):objects).map(object=>{
      const fill=object.fill==="연한 보라"?"#ede9fe":object.fill==="연한 회색"?"#e2e8f0":"transparent";
      const width=object.lineWidth==="1.00 mm"?5:object.lineWidth==="0.50 mm"?3:2;
      const position=object;
      const points=vertexPreview?.id===object.id?vertexPreview.points:object.points;
      const isSelected=selectedIds?selectedIds.includes(object.id):object.id===selected;
      return <g key={object.id} data-screen-shape={object.id} role="button" tabIndex={placing?-1:0} aria-label={`${object.name} · 화면 도형`} aria-pressed={isSelected} transform={`translate(${position.x*viewport.width/1000} ${position.y*viewport.height/700}) scale(${viewport.width/1000}) rotate(${object.rotation??0} ${(object.width??140)/2} ${(object.height??90)/2}) scale(${(object.width??140)/140} ${(object.height??90)/90})`} style={{pointerEvents:placing?"none":"all",cursor:onMove&&isSelected?"move":"pointer",touchAction:"none"}}
        onPointerDown={event=>{event.stopPropagation();suppressClick.current=false;if(event.shiftKey||!onMove||placing||!isSelected||event.button!==0)return;const bounds=surface.current?.getBoundingClientRect();if(!bounds?.width||!bounds.height)return;event.preventDefault();event.currentTarget.focus();drag.current={id:object.id,pointer:event.pointerId,clientX:event.clientX,clientY:event.clientY,x:object.x,y:object.y,width:bounds.width,height:bounds.height};event.currentTarget.setPointerCapture(event.pointerId);}}
        onPointerMove={event=>{if(drag.current?.pointer!==event.pointerId)return;setPreview(dragPosition(event.clientX,event.clientY));}}
        onPointerUp={event=>{if(drag.current?.pointer!==event.pointerId)return;const next=dragPosition(event.clientX,event.clientY);const moved=Math.hypot(event.clientX-drag.current.clientX,event.clientY-drag.current.clientY)>=3;suppressClick.current=moved;cancelDrag();if(moved&&next&&onMove)onMove(next.id,next.x,next.y);}}
        onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
        onClick={event=>{event.stopPropagation();if(suppressClick.current){suppressClick.current=false;return;}onSelect(object.id,event.shiftKey);}} onKeyDown={event=>{
          if(event.key==="Escape"&&drag.current){event.preventDefault();event.stopPropagation();suppressClick.current=true;cancelDrag();return;}
          if(drag.current&&(event.ctrlKey||event.metaKey)&&["z","y"].includes(event.key.toLowerCase())){event.preventDefault();event.stopPropagation();return;}
          if(onMove&&isSelected&&!drag.current&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)){
            event.preventDefault();event.stopPropagation();const step=event.shiftKey?10:1;
            onMove(object.id,Math.max(0,Math.min(1000,object.x+(event.key==="ArrowLeft"?-step:event.key==="ArrowRight"?step:0))),Math.max(0,Math.min(700,object.y+(event.key==="ArrowUp"?-step:event.key==="ArrowDown"?step:0))));return;
          }
          if(event.key==="Enter"||event.key===" "){event.preventDefault();onSelect(object.id,event.shiftKey);}
        }}>
        {object.kind==="폴리라인"?<polyline points={points?.map(point=>`${point.x},${point.y}`).join(" ")} stroke={object.color} strokeWidth={width} fill="none"/>:object.kind==="블록"&&object.blockCode?<g data-block-code={object.blockCode} transform="scale(.7777778 .8181818)" style={{color:object.color}}><ScreenBlockGlyph code={object.blockCode} strokeWidth={width} fill={fill}/></g>:object.kind==="사각형"?<rect width="140" height="90" stroke={object.color} strokeWidth={width} fill={fill}/>:object.kind==="원"?<circle cx="70" cy="45" r="45" stroke={object.color} strokeWidth={width} fill={fill}/>:object.kind==="텍스트"?<text x="0" y="25" fontSize="24" fill={object.color}>{object.text}</text>:<><path d="M0 75 L140 15" stroke={object.color} strokeWidth={width} fill="none"/>{object.kind==="치수"&&<text x="25" y="30" fontSize="18" fill={object.color}>치수 미확정</text>}</>}
        <rect x="-5" y="-5" width="150" height="100" fill="transparent" stroke={isSelected?"#7c3aed":"transparent"} strokeDasharray="6 4"/>
        {object.kind==="폴리라인"&&isSelected&&ids.length===1&&onChangePoints&&!tool&&points?.map((point,index)=><ellipse key={index} role="button" tabIndex={0} aria-label={`폴리라인 꼭짓점 ${index+1} 이동`} cx={point.x} cy={point.y} rx={6/(viewport.width/1000*(object.width??140)/140)} ry={6/(viewport.width/1000*(object.height??90)/90)} fill="white" stroke="#7c3aed" strokeWidth="2" vectorEffect="non-scaling-stroke" style={{cursor:"crosshair",touchAction:"none"}}
          onPointerDown={event=>{event.preventDefault();event.stopPropagation();if(event.button!==0)return;const matrix=event.currentTarget.getScreenCTM();if(!matrix)return;event.currentTarget.focus();vertexDrag.current={id:object.id,index,pointer:event.pointerId,inverse:matrix.inverse(),points:object.points!};event.currentTarget.setPointerCapture(event.pointerId);}}
          onPointerMove={event=>{event.stopPropagation();if(vertexDrag.current?.pointer!==event.pointerId)return;const next=vertexAt(event.clientX,event.clientY);if(next)setVertexPreview({id:object.id,points:next});}}
          onPointerUp={event=>{event.stopPropagation();if(vertexDrag.current?.pointer!==event.pointerId)return;const next=vertexAt(event.clientX,event.clientY),original=vertexDrag.current.points;cancelVertex();if(next&&next.some((p,i)=>Math.abs(p.x-original[i].x)>.001||Math.abs(p.y-original[i].y)>.001))onChangePoints(object.id,next);}}
          onPointerCancel={cancelVertex} onLostPointerCapture={cancelVertex}
          onClick={event=>event.stopPropagation()}
          onKeyDown={event=>{if(!vertexDrag.current&&(event.ctrlKey||event.metaKey))return;event.stopPropagation();if(event.key==="Escape"){event.preventDefault();cancelVertex();return;}if(vertexDrag.current){event.preventDefault();return;}if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key)){event.preventDefault();const step=event.shiftKey?10:1;onChangePoints(object.id,points.map((p,i)=>i===index?{x:Math.max(0,Math.min(140,p.x+(event.key==="ArrowLeft"?-step:event.key==="ArrowRight"?step:0))),y:Math.max(0,Math.min(90,p.y+(event.key==="ArrowUp"?-step:event.key==="ArrowDown"?step:0)))}:p));}}}
        ><title>끌어서 꼭짓점 이동 · 방향키 미세 조정 · Esc 취소 · 현재 틀 안에서 이동</title></ellipse>)}
      </g>;
    })}
    {selectionBox&&<rect role="img" aria-label="도형 선택 영역" {...selectionBox} fill="#7c3aed18" stroke="#7c3aed" strokeWidth="1" strokeDasharray="5 3" pointerEvents="none"/>}
    {tool==="폴리라인"&&pathPoints.length>0&&<g pointerEvents="none" aria-label="작성 중 폴리라인"><polyline points={pathPoints.map(point=>`${point.x/1000*viewport.width},${point.y/700*viewport.height}`).join(" ")} fill="none" stroke="#7c3aed" strokeWidth="2" strokeDasharray="5 3"/>{pathPoints.map((point,index)=><circle key={index} cx={point.x/1000*viewport.width} cy={point.y/700*viewport.height} r="4" fill="#7c3aed"/>)}</g>}
  </svg>{controlsHost?createPortal(pathControls,controlsHost):pathControls}</>;
}
