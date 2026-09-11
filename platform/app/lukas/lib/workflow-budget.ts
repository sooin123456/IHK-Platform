import {z} from 'zod';
import type {WorkflowBlankDocument} from './workflow-blank-document';
const money=z.number().int().min(0).max(1e12);
const budgetSchema=z.object({sequence:z.number().int().min(1).max(20),budget:money,reserve:money,note:z.string().trim().min(1).max(200)}).refine(plan=>plan.reserve<=plan.budget);
export type BudgetPlan=z.infer<typeof budgetSchema>;
export function readBudgetPlan(raw:string|undefined):BudgetPlan|null{try{const result=budgetSchema.safeParse(JSON.parse(raw??''));return result.success?result.data:null;}catch{return null;}}
export function budgetComparison(document:WorkflowBlankDocument,plan:BudgetPlan){
 const rounds=document.quantityReviews?.filter(round=>round.sequence===plan.sequence&&round.phase==='approved')??[];
 if(rounds.length!==1)return null;
 const amounts=rounds[0].items.map(item=>Math.round((item.quantity.raw+item.quantity.correction)*item.quantity.rate));
 const amount=amounts.reduce((sum,value)=>sum+value,0);if(amounts.some(value=>!Number.isSafeInteger(value)||value<0)||!Number.isSafeInteger(amount))return null;
 const available=plan.budget-plan.reserve;return {amount,available,balance:available-amount};
}
