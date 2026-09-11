import {SupportingFileInput,SupportingFileRow} from './workflow-supporting-files';
import {WorkflowAssetLifecycle} from './workflow-asset-lifecycle';
import {WorkflowHandoverExport} from './workflow-handover-export';
import {readSupportingFileDraft,supportingFileDraftPatch,recallSupportingFile} from '../lib/workflow-supporting-files';
import {useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'react-router';
import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
import {saveAsset,handoverReadiness,prepareHandover,decideHandover,type AssetEntry,type Handover} from '../lib/workflow-handover';
const fields=[['code','자산번호'],['name','자산명'],['location','설치 위치'],['manufacturer','제조사'],['model','모델명'],['manual','참고문서 표기']] as const;
const maintenanceFields=[['warrantyEnd','보증 종료일'],['maintenanceContact','유지관리 연락처'],['maintenancePlan','유지관리 계획']] as const;
function AssetMaintenance({asset}:{asset:AssetEntry}){return <><p>보증 종료일: {asset.warrantyEnd??'미등록'} · 유지관리 연락처: {asset.maintenanceContact??'미등록'}</p><p style={{whiteSpace:'pre-wrap'}}>유지관리 계획: {asset.maintenancePlan??'미등록'}</p></>;}
export function WorkflowHandover({documents,drafts,onDraft,onChange,onOpen}:{documents:WorkflowBlankDocument[];drafts:Record<string,string>;onDraft:(patch:Record<string,string>)=>void;onChange:(doc:WorkflowBlankDocument)=>void;onOpen:(id:string,item:Handover,asset:AssetEntry)=>void}){
 const [params,setParams]=useSearchParams(),[error,setError]=useState('');const pending=useRef(params.toString());useEffect(()=>{pending.current=params.toString();},[params]);
 const change=(values:Record<string,string>)=>{const next=new URLSearchParams(pending.current);for(const [key,value]of Object.entries(values)){if(value)next.set(key,value);else next.delete(key);}pending.current=next.toString();setParams(next,{replace:true});setError('');};
 const doc=documents.find(doc=>doc.id===(params.get('handoverDocument')??documents[0]?.id)),role=params.get('handoverRole')??'author';
 const rounds=doc?.reviewRounds?.filter(row=>row.phase==='approved')??[],revision=Number(params.get('handoverRevision')??rounds.at(-1)?.revision??0);
 const check=doc?handoverReadiness(doc,revision):undefined;
 const object=doc?.shapes.find(shape=>shape.id===(params.get('handoverObject')??doc.shapes[0]?.id));
 const asset=doc?.assetRegister?.find(row=>row.objectId===object?.id),key=`handover:${doc?.id??'none'}:`,assetKey=key+`asset:${object?.id??'none'}:`;
 const value=(name:string,fallback='')=>drafts[key+name]??fallback,edit=(name:string,text:string)=>onDraft({[key+name]:text});
 const assetValue=(name:typeof fields[number][0]|typeof maintenanceFields[number][0])=>drafts[assetKey+name]??asset?.[name]??(name==='name'?object?.label??'':'');
 const selectedRows=check?.rows.filter(row=>value(`include:${row.asset.objectId}`,'yes')!=='no')??[],selectedIds=selectedRows.map(row=>row.asset.objectId),selectionReady=Boolean(check?.round)&&selectedRows.length>0&&selectedRows.every(row=>row.ready);
 const [fileBusy,setFileBusy]=useState(false),[,refreshFiles]=useState(0);const verified=()=>refreshFiles(value=>value+1);
 const filePrefix=assetKey+'files',manualFiles=drafts[filePrefix+':edited']==='1'?readSupportingFileDraft(drafts,filePrefix):asset?.manualFiles??[];
 const previous=value('previous')?Number(value('previous')):undefined,items=doc?.handovers??[];
 return <section aria-label="준공·자산 인계">
  <header className="flow-card"><h2>준공·자산 인계</h2><p>승인 도면의 등록 자산과 종결된 점검 근거를 묶는 로컬 화면입니다. 실제 준공 승인·파일 전송·자산 시스템 등록·법적 인계 증명이 아닙니다.</p>
   <label className="flow-input">인계 도면<select aria-label="인계 도면" value={doc?.id??''} onChange={event=>change({handoverDocument:event.target.value,handoverObject:'',handoverRevision:''})}>{!doc&&<option value="">도면 선택</option>}{documents.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
   <label className="flow-input">인계 처리 역할<select aria-label="인계 처리 역할" value={role} onChange={event=>change({handoverRole:event.target.value})}><option value="author">인계 작성자 체험</option><option value="recipient">수신자 체험</option><option value="viewer">열람 체험</option></select></label>
  </header>
  {!doc?<p>선택한 로컬 도면이 없습니다. 도면 작성·승인과 현장 점검을 먼저 준비하세요.</p>:<>
   {role==='author'&&<section className="flow-card" aria-label="자산 정보 작성"><h3>자산 정보 등록·수정</h3>
    <label className="flow-input">연결할 객체<select aria-label="자산 연결 객체" value={object?.id??''} onChange={event=>change({handoverObject:event.target.value})}>{!object&&<option value="">객체 선택</option>}{doc.shapes.map(shape=><option key={shape.id} value={shape.id}>{shape.label}</option>)}</select></label>
    {fields.map(([name,label])=><label className="flow-input" key={name}>{label}<input aria-label={label} maxLength={name==='manual'?500:120} value={assetValue(name)} onChange={event=>onDraft({[assetKey+name]:event.target.value})}/></label>)}
    {maintenanceFields.map(([name,label])=><label className="flow-input" key={name}>{label} (선택)<input aria-label={label} type={name==='warrantyEnd'?'date':'text'} maxLength={name==='maintenancePlan'?500:120} value={assetValue(name)} onChange={event=>onDraft({[assetKey+name]:event.target.value})}/></label>)}
    <p>보증·유지관리 정보는 직접 입력한 참고사항이며 보증 유효성이나 점검 이행을 증명하지 않습니다.</p>
    <p>참고문서 표기와 실제 매뉴얼 첨부는 별개입니다. 첨부 원본은 서버·백업에 포함되지 않습니다.</p>
    <SupportingFileInput key={assetKey} label="자산 매뉴얼 파일 선택" files={manualFiles} onChange={files=>onDraft({...supportingFileDraftPatch(files,filePrefix),[filePrefix+':edited']:'1'})} onBusy={setFileBusy} onVerified={verified}/>
    <button disabled={!object||fileBusy||asset?.archived} onClick={()=>{const updated=saveAsset(doc,role,{objectId:object?.id,manualFiles,...Object.fromEntries(fields.map(([name])=>[name,assetValue(name)])),...Object.fromEntries(maintenanceFields.map(([name])=>[name,assetValue(name).trim()||undefined]))});if(updated===doc){setError('필수 자산 항목, 자산번호 중복, 보증 날짜와 입력 길이를 확인하세요. 등록 한도는 100개입니다.');return;}onChange(updated);setError('');}}>자산 정보 보관</button>
    {asset?.archived&&<p>보관한 자산입니다. 아래 보관 목록에서 복원한 뒤 수정하세요.</p>}
   </section>}
   <section className="flow-card" aria-label="인계 준비 점검"><h3>등록 자산 {check?.rows.length??0}개</h3><p>선택한 등록 자산만 인계합니다. 제외한 자산은 자산대장과 기존 인계본에서 삭제되지 않습니다.</p>
    <label className="flow-input">승인 도면 개정<select aria-label="인계 승인 개정" value={check?.round?.revision??''} onChange={event=>change({handoverRevision:event.target.value})}>{!check?.round&&<option value="">승인 개정 선택</option>}{rounds.map(round=><option key={round.revision} value={round.revision}>승인 R{round.revision}</option>)}</select></label>
    {!check?.round&&<p>승인된 도면 개정이 필요합니다.</p>}
    {check?.rows.map(row=><article key={row.asset.objectId}><h4>{row.asset.code} · {row.asset.name}</h4>{role==='author'&&<label><input type="checkbox" aria-label={`${row.asset.code} 인계 포함`} checked={selectedIds.includes(row.asset.objectId)} onChange={event=>edit(`include:${row.asset.objectId}`,event.target.checked?'yes':'no')}/> 인계 포함</label>}<AssetMaintenance asset={row.asset}/><p>{row.asset.location} · {row.asset.manufacturer} · {row.asset.model}</p><p>참고문서 표기: {row.asset.manual}</p><p>{row.ready?'점검 근거 확인됨':'승인 객체·종결 점검 근거 확인 필요'}</p>{role==='author'&&<WorkflowAssetLifecycle key={`${doc.id}:${row.asset.objectId}`} doc={doc} asset={row.asset} onChange={onChange}/>}</article>)}
    <p role="status">선택 자산 {selectedRows.length}개 / 등록 자산 {check?.rows.length??0}개</p>{!selectionReady&&<p>선택한 자산 모두에 승인 객체·종결 점검 근거가 필요합니다. 준비되지 않은 자산은 제외할 수 있습니다.</p>}
    {role==='author'&&<><label className="flow-input">인계 대상<input aria-label="인계 대상" maxLength={120} value={value('recipient')} onChange={event=>edit('recipient',event.target.value)}/></label><p>작성자 체험에서 준비한 뒤 수신자 체험으로 전환해 검토합니다.</p>
     <button disabled={!selectionReady||items.some(item=>item.phase==='prepared')||items.length>=20} onClick={()=>{const updated=prepareHandover(doc,role,revision,value('recipient'),previous,selectedIds);if(updated===doc){setError('인계 대상과 승인·점검 근거, 보완 연결을 확인하세요.');return;}onChange(updated);edit('previous','');setError('');}}>{previous?'보완 인계본 준비':'인계본 준비'}</button>{previous&&<button onClick={()=>edit('previous','')}>보완 연결 해제</button>}
     {items.some(item=>item.phase==='prepared')&&<p>준비된 인계본의 수신 검토를 먼저 진행하세요.</p>}{items.length>=20&&<p>인계본 20건 한도입니다. 기존 이력을 보존합니다.</p>}
    </>}
   </section>
   {Boolean(doc.assetRegister?.some(asset=>asset.archived))&&<section className="flow-card" aria-label="보관 자산"><h3>보관 자산</h3><p>새 인계 대상에서 제외됐습니다. 기록을 보존하므로 보관 자산도 등록 한도 100개에 포함됩니다.</p>{doc.assetRegister!.filter(asset=>asset.archived).map(asset=><article key={asset.objectId}><h4>{asset.code} · {asset.name}</h4><p>{asset.location}</p>{role==='author'&&<WorkflowAssetLifecycle key={doc.id} doc={doc} asset={asset} onChange={onChange}/>}</article>)}</section>}
   {error&&<p role="alert">{error}</p>}
   <section aria-label="인계본 이력"><h3>인계본 이력 · {items.length}건</h3>{!items.length&&<p>아직 준비한 인계본이 없습니다.</p>}
    {[...items].reverse().map(item=>{const next=items.find(row=>row.previous===item.id);return <article className="flow-card" key={item.id}>
     <h3>인계본 #{item.id} · R{item.revision}</h3><p><strong>{{prepared:'수신 검토 대기',changes:'보완 요청',received:'수신 확인 기록됨 (체험)'}[item.phase]}</strong> · {item.recipient} · 자산 {item.assets.length}개</p>
     {item.previous&&<p>인계본 #{item.previous}의 보완본</p>}{next&&<p>인계본 #{next.id}로 보완됨</p>}{item.feedback&&<p>수신 의견: {item.feedback}</p>}
     <details><summary>인계 당시 자산·점검 목록</summary>{item.assets.map(entry=>{
      const round=doc.reviewRounds?.find(round=>round.phase==='approved'&&round.revision===item.revision&&round.source.sha256===entry.evidence.source.sha256),available=round?.objects.some(object=>object.id===entry.objectId);
      return <article key={entry.objectId}><h4>{entry.code} · {entry.name}</h4><AssetMaintenance asset={entry}/>{Boolean(entry.manualFiles?.length)&&<section aria-label={`인계본 #${item.id} ${entry.code} 매뉴얼`}><h4>인계 당시 매뉴얼 · {entry.manualFiles!.length}개</h4><p>수신 확인 전 동일 원본을 연결하세요. 파일 내용의 적합성·안전성을 자동 검증하지 않습니다.</p>{entry.manualFiles!.map(file=><SupportingFileRow key={file.sha256} file={file} onVerified={verified}/>)}</section>}<p>{entry.location} · {entry.manufacturer} · {entry.model}</p><p>참고문서 표기: {entry.manual}</p><p>{entry.evidence.source.name} · {entry.evidence.page}쪽 · 점검 기록 #{entry.evidence.id}</p>{entry.inspection.events.map((event,index)=><p key={index}>{index+1}. {event.note}</p>)}
       <button disabled={!available} aria-label={`인계본 #${item.id} ${entry.code} 승인 위치`} onClick={()=>onOpen(doc.id,item,entry)}>승인 도면 위치</button>{!available&&<p>해당 승인 위치를 찾을 수 없습니다. 현재 도면으로 대체하지 않습니다.</p>}
      </article>;
     })}</details>
     <WorkflowHandoverExport key={`${doc.id}:${item.id}`} documentId={doc.id} item={item}/>
     {role==='recipient'&&item.phase==='prepared'&&<><label className="flow-input">수신 의견<textarea aria-label={`인계본 #${item.id} 수신 의견`} maxLength={500} value={value(`feedback:${item.id}`)} onChange={event=>edit(`feedback:${item.id}`,event.target.value)}/></label><div className="flow-actions">{(['changes','received'] as const).map(phase=><button key={phase} aria-label={`인계본 #${item.id} ${phase==='changes'?'보완 요청':'수신 확인'}`} onClick={()=>{const updated=decideHandover(doc,item.id,role,phase,value(`feedback:${item.id}`),item.assets.flatMap(asset=>(asset.manualFiles??[]).filter(file=>recallSupportingFile(file.sha256)).map(file=>file.sha256)));if(updated===doc){setError('수신 의견을 입력하고, 수신 확인 시 모든 매뉴얼 원본을 다시 연결하세요.');return;}onChange(updated);edit(`feedback:${item.id}`,'');setError('');}}>{phase==='changes'?'보완 요청':'수신 확인 기록 (체험)'}</button>)}</div></>}
     {role==='author'&&item.phase==='changes'&&!next&&<button aria-label={`인계본 #${item.id} 보완 준비`} onClick={()=>{onDraft({[key+'previous']:String(item.id),[key+'recipient']:item.recipient,...Object.fromEntries((doc.assetRegister??[]).map(asset=>[key+`include:${asset.objectId}`,item.assets.some(entry=>entry.objectId===asset.objectId)?'yes':'no']))});change({handoverRevision:String(item.revision)});}}>보완 인계본 준비하기</button>}
    </article>;})}
   </section>
  </>}
 </section>;
}
