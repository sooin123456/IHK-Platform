import {useSearchParams} from 'react-router';
import {useEffect,useRef} from 'react';
import type {GalleryFrame} from '../lib/workflow-scene-gallery';
export function WorkflowSceneComparison({items,ready}:{items:GalleryFrame[];ready:boolean}){
 const [params,setParams]=useSearchParams();const leftId=params.get('galleryLeft')??'',rightId=params.get('galleryRight')??'';
 const pending=useRef(params.toString());useEffect(()=>{pending.current=params.toString();},[params]);
 const left=items.find(item=>item.id===leftId),right=items.find(item=>item.id===rightId);
 const invalid=ready&&((leftId&&!left)||(rightId&&!right)),duplicate=Boolean(left&&right&&left.id===right.id);
 const change=(patch:Record<string,string>)=>{const next=new URLSearchParams(pending.current);for(const[key,value]of Object.entries(patch)){if(value)next.set(key,value);else next.delete(key);}pending.current=next.toString();setParams(next,{replace:true,preventScrollReset:true});};
 return <section className="flow-card" aria-label="보관 이미지 비교"><h3>보관 이미지 비교</h3><p>동일 예시의 고정 이미지 두 장을 나란히 확인합니다. 카메라·출력 크기가 다를 수 있으며 자동 정합·객체 변경 검출·실측 비교가 아닙니다.</p>
 {([['galleryLeft','비교 기준 이미지',leftId],['galleryRight','비교 대상 이미지',rightId]] as const).map(([key,label,value])=><label className="flow-input" key={key}>{label}<select aria-label={label} value={value} disabled={!ready} onChange={event=>change({[key]:event.target.value})}><option value="">이미지 선택</option>{value&&!items.some(item=>item.id===value)&&<option value={value}>선택했던 이미지 없음</option>}{items.map(item=><option key={item.id} value={item.id}>{item.name} · 예시 R{item.revision}</option>)}</select></label>)}
 <button onClick={()=>change({galleryLeft:'',galleryRight:''})}>이미지 비교 선택 초기화</button>
 {invalid?<p role="alert">선택한 이미지를 이 예시의 보관함에서 찾을 수 없습니다. 다른 이미지로 대체하지 않습니다. 다시 선택하거나 초기화하세요.</p>:duplicate?<p role="alert">서로 다른 이미지 두 장을 선택하세요.</p>:left&&right?<div className="flow-grid-two">{([['기준',left],['대상',right]] as const).map(([label,item])=><figure key={label} style={{minWidth:0,margin:0}}><figcaption>{label}: {item.name} · 예시 R{item.revision}<br/>{item.width} × {item.height}px</figcaption><img src={item.dataUrl} alt={`${label}: ${item.name}`} style={{display:'block',maxWidth:'100%',height:'auto'}}/></figure>)}</div>:<p>보관한 이미지 두 장을 선택하면 비교 화면이 나타납니다.</p>}
 </section>;
}
