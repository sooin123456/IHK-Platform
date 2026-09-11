export type MeasurementPoint={x:number;y:number};
export type MeasurementRecord={id:number;source:{name:string;sha256:string;pages:number};page:number;revision:number;kind:'distance'|'path'|'area';reference:MeasurementPoint[];target:MeasurementPoint[];length:number;aspect:number};
export function measurementValue(record:Omit<MeasurementRecord,'id'|'source'|'page'|'revision'>) {
 return record.kind==='distance'?previewDistance(record.reference,record.target,record.length,record.aspect):previewMeasure(record.kind,record.reference,record.target,record.length,record.aspect);
}
export function previewDistance(reference:MeasurementPoint[],target:MeasurementPoint[],length:number,aspect:number):number|null {
 if(reference.length!==2||target.length!==2||![length,aspect].every(value=>Number.isFinite(value)&&value>0)||![...reference,...target].every(point=>[point.x,point.y].every(value=>Number.isFinite(value)&&value>=0&&value<=1)))return null;
 const distance=(points:MeasurementPoint[])=>Math.hypot((points[1].x-points[0].x)*aspect,points[1].y-points[0].y);
 const basis=distance(reference);if(basis<1e-8)return null;
 const result=distance(target)/basis*length;return Number.isFinite(result)?result:null;
}
export function previewMeasure(kind:'path'|'area',reference:MeasurementPoint[],points:MeasurementPoint[],length:number,aspect:number):number|null {
 if(points.length<(kind==='area'?3:2)||points.length>100||previewDistance(reference,reference,length,aspect)===null||!points.every(point=>[point.x,point.y].every(value=>Number.isFinite(value)&&value>=0&&value<=1)))return null;
 if(kind==='path'){
  const segments=points.slice(1).map((point,i)=>previewDistance(reference,[points[i],point],length,aspect));
  if(segments.some(value=>value===null))return null;
  const total=segments.reduce<number>((sum,value)=>sum+value!,0);return Number.isFinite(total)?total:null;
 }
 const cross=(a:MeasurementPoint,b:MeasurementPoint,c:MeasurementPoint)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
 const onSegment=(a:MeasurementPoint,b:MeasurementPoint,p:MeasurementPoint)=>Math.abs(cross(a,b,p))<1e-10&&p.x>=Math.min(a.x,b.x)-1e-10&&p.x<=Math.max(a.x,b.x)+1e-10&&p.y>=Math.min(a.y,b.y)-1e-10&&p.y<=Math.max(a.y,b.y)+1e-10;
 for(let i=0;i<points.length;i++) {
  const a=points[i],b=points[(i+1)%points.length];
  if(Math.hypot(a.x-b.x,a.y-b.y)<1e-10)return null;
  for(let j=i+1;j<points.length;j++) {
   if(j===i+1||(i===0&&j===points.length-1))continue;
   const c=points[j],d=points[(j+1)%points.length];
   if((cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b))return null;
  }
 }
 const area=Math.abs(points.reduce((sum,p,i)=>{const next=points[(i+1)%points.length];return sum+p.x*next.y-next.x*p.y;},0))/2;
 if(area<1e-10)return null;
 const basis=Math.hypot((reference[1].x-reference[0].x)*aspect,reference[1].y-reference[0].y);
 const result=area*aspect*(length/basis)**2;return Number.isFinite(result)?result:null;
}
