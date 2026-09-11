import {useEffect,useState} from 'react';
import {WorkflowSceneComparison} from './workflow-scene-comparison';
import {addGalleryFrame,readGallery,sceneGalleryKey,type GalleryFrame} from '../lib/workflow-scene-gallery';
export function useSceneGallery(){
 const [items,setItems]=useState<GalleryFrame[]>([]),[error,setError]=useState(''),[ready,setReady]=useState(false);
 const reload=()=>{try{setItems(readGallery(localStorage.getItem(sceneGalleryKey)));setReady(true);setError('');}catch{setReady(false);setError('브라우저 이미지 보관함을 읽지 못했습니다. 저장된 내용을 덮어쓰지 않습니다. PNG를 따로 내려받고 다시 시도하세요.');}};
 useEffect(()=>{reload();const changed=(event:StorageEvent)=>{if(event.key===sceneGalleryKey||event.key===null)reload();};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[]);
 const commit=(change:(current:GalleryFrame[])=>GalleryFrame[])=>{try{const next=change(readGallery(localStorage.getItem(sceneGalleryKey)));localStorage.setItem(sceneGalleryKey,JSON.stringify(next));setItems(next);setError('');return true;}catch(error){setError(error instanceof Error?error.message:'이미지 보관에 실패했습니다. PNG로 내려받으세요.');return false;}};
 return {items,error,ready,reload,add:(frame:Omit<GalleryFrame,'id'>)=>ready&&commit(current=>{const result=addGalleryFrame(current,{...frame,id:crypto.randomUUID()});if(!result.ok)throw new Error(result.error);return result.items;}),remove:(id:string)=>ready&&commit(current=>current.filter(item=>item.id!==id))};
}
export function WorkflowSceneGallery({gallery,scenario}:{gallery:ReturnType<typeof useSceneGallery>;scenario:string}){
 const [confirm,setConfirm]=useState<string|null>(null);const items=gallery.items.filter(item=>item.scenario===scenario);
 return <section className="flow-card" aria-label="보관한 장면 이미지"><h3>보관한 장면 이미지 · {items.length}개</h3><p>이 브라우저에만 보관합니다. 새로고침 후에도 유지되지만 다른 기기·서버·작업 백업과 공유되지 않습니다. 브라우저 데이터 삭제 시 사라집니다. 전체 예시에서 최대 6개·약 3MB이며 실제 IFC·승인 결과가 아닙니다.</p>
 {gallery.error&&<p role="alert">{gallery.error}</p>}{!gallery.ready&&<button onClick={gallery.reload}>이미지 보관함 다시 읽기</button>}
 {!items.length&&<p>아직 보관한 이미지가 없습니다. 현재 화면 이미지를 준비한 뒤 브라우저에 보관하세요.</p>}
 <WorkflowSceneComparison items={items} ready={gallery.ready}/>
 {items.map(item=><article key={item.id}><h4>{item.name} · 예시 R{item.revision}</h4><p>{item.width} × {item.height}px · 준비 당시 고정 이미지</p><img src={item.dataUrl} alt={item.name+' 보관 이미지'} style={{maxWidth:'100%',height:'auto'}}/><a href={item.dataUrl} download="1hk-saved-sample-scene.png">{item.name} 보관 PNG 다운로드</a><button aria-label={`${item.name} 보관 이미지 삭제`} onClick={()=>setConfirm(item.id)}>보관 이미지 삭제</button>{confirm===item.id&&<div role="group" aria-label="보관 이미지 삭제 확인"><p>브라우저의 이 이미지를 삭제할까요? 복구할 수 없으므로 필요한 경우 먼저 PNG를 내려받으세요. 저장 장면·도면은 유지됩니다.</p><button onClick={()=>{if(gallery.remove(item.id))setConfirm(null);}}>이미지 삭제 확정</button><button onClick={()=>setConfirm(null)}>이미지 삭제 취소</button></div>}</article>)}
 </section>;
}
