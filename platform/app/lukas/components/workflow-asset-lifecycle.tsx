import {useState} from 'react';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {setAssetArchived,type AssetEntry} from '../lib/workflow-handover';
export function WorkflowAssetLifecycle({doc,asset,onChange}:{doc:WorkflowBlankDocument;asset:AssetEntry;onChange:(doc:WorkflowBlankDocument)=>void}){
 const [confirm,setConfirm]=useState(false);
 if(asset.archived)return <button aria-label={`${asset.code} 자산대장 복원`} onClick={()=>onChange(setAssetArchived(doc,'author',asset.objectId,false))}>자산대장 복원</button>;
 return confirm?<section aria-label={`${asset.code} 보관 확인`}><p>{asset.code} · {asset.name}을 자산대장에서 보관할까요? 새 인계 대상에서는 제외되지만 기존 인계본·점검·매뉴얼 기록과 도면 객체는 삭제하지 않습니다. 보관 목록에서 복원할 수 있습니다.</p><button aria-label={`${asset.code} 보관 취소`} onClick={()=>setConfirm(false)}>취소</button><button aria-label={`${asset.code} 보관 확정`} onClick={()=>{onChange(setAssetArchived(doc,'author',asset.objectId,true));setConfirm(false);}}>보관 확정</button></section>:<button aria-label={`${asset.code} 자산대장에서 보관`} onClick={()=>setConfirm(true)}>자산대장에서 보관</button>;
}
