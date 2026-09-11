import {z} from 'zod';
import type {WorkflowBlankDocument} from './workflow-blank-document';
import {quantityReviewSchema,type QuantityReviewRound} from './workflow-quantity-review';
export const carbonStages=['A1-A3','A4','A5'] as const;
const factorSchema=z.object({value:z.number().finite().min(0).max(1e9),unit:z.string().trim().min(1).max(20),source:z.string().trim().min(1).max(500),version:z.string().trim().min(1).max(120)});
export type CarbonFactor=z.infer<typeof factorSchema>;
export function carbonPreview(round:QuantityReviewRound,factors:Record<string,unknown>){
 const rows=round.items.map(item=>{const parsed=factorSchema.safeParse(factors[item.id]),quantity=item.quantity.raw+item.quantity.correction;
  const factor=parsed.success&&parsed.data.unit===item.quantity.unit?parsed.data:null;
  const amount=factor&&quantity>=0?quantity*factor.value:null;
  return {id:item.id,label:item.label,quantity,unit:item.quantity.unit,factor,amount:amount!==null&&Number.isFinite(amount)?amount:null};
 });
 const total=rows.reduce((sum,row)=>sum+(row.amount??0),0),complete=round.phase==='approved'&&rows.length>0&&rows.every(row=>row.amount!==null)&&Number.isFinite(total);
 return {rows,total,complete};
}
const assessmentSchema=z.object({id:z.number().int().min(1).max(20),quantity:quantityReviewSchema,stage:z.enum(carbonStages),factors:z.record(z.string(),factorSchema),note:z.string().trim().min(1).max(500)}).refine(item=>Object.keys(item.factors).length===item.quantity.items.length&&carbonPreview(item.quantity,item.factors).complete);
export const carbonAssessmentsSchema=z.array(assessmentSchema).max(20).refine(items=>items.every((item,index)=>item.id===index+1));
export type CarbonAssessment=z.infer<typeof assessmentSchema>;
export function saveCarbon(doc:WorkflowBlankDocument,role:string,sequence:number,stage:string,factors:Record<string,unknown>,note:string):WorkflowBlankDocument{
 const items=doc.carbonAssessments??[];if(role!=='author'||items.length>=20)return doc;
 const parsed=assessmentSchema.safeParse({id:items.length+1,quantity:doc.quantityReviews?.find(row=>row.sequence===sequence),stage,factors,note});
 return parsed.success?{...doc,carbonAssessments:[...items,parsed.data]}:doc;
}
export function compareCarbon(before:CarbonAssessment,after:CarbonAssessment):number|null{
 const scope=(item:CarbonAssessment)=>JSON.stringify(item.quantity.items.map(row=>[row.id,row.quantity.unit]).sort((a,b)=>a[0].localeCompare(b[0])));
 if(before.stage!==after.stage||scope(before)!==scope(after))return null;
 return carbonPreview(after.quantity,after.factors).total-carbonPreview(before.quantity,before.factors).total;
}
