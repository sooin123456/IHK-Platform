import {useEffect,useRef,useState} from 'react';
import {inspectFieldPhoto,recallFieldPhoto,type FieldPhoto} from '../lib/workflow-field-photo';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '~/core/components/ui/dialog';
export function FieldPhotoPreview({photo}:{photo:FieldPhoto}){
 const [file,setFile]=useState(()=>recallFieldPhoto(photo.sha256)),[url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [expanded,setExpanded]=useState(false),[zoom,setZoom]=useState(100);const trigger=useRef<HTMLButtonElement>(null);
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(!file)return;const next=URL.createObjectURL(file);setUrl(next);return()=>URL.revokeObjectURL(next);},[file]);
 return <figure style={{margin:'12px 0'}}>
  <figcaption style={{overflowWrap:'anywhere'}}>{photo.name} · {(photo.size/1024).toFixed(1)}KB</figcaption>
  {url?<><img src={url} alt={`현장 사진 ${photo.name}`} style={{maxWidth:'100%',maxHeight:240,objectFit:'contain'}}/><div><button type="button" ref={trigger} aria-label={`${photo.name} 사진 확대`} onClick={()=>{setZoom(100);setExpanded(true);}}>사진 크게 보기</button></div></>:
   <label className="flow-input">같은 원본 사진 다시 연결
    <input aria-label={`${photo.name} 사진 다시 연결`} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={async event=>{
     const next=event.target.files?.[0];event.target.value='';if(!next)return;setBusy(true);setError('');
     try{await inspectFieldPhoto(next,photo);if(mounted.current)setFile(next);}
     catch(error){if(mounted.current)setError(error instanceof Error?error.message:'사진을 열 수 없습니다.');}
     finally{if(mounted.current)setBusy(false);}
    }}/>
   </label>}
  {error&&<p role="alert">{error}</p>}
  <Dialog open={expanded&&Boolean(url)} onOpenChange={setExpanded}><DialogContent className="flow-dialog" style={{width:'calc(100vw - 32px)',maxWidth:1200,maxHeight:'94dvh',overflowY:'auto'}} onCloseAutoFocus={event=>{event.preventDefault();trigger.current?.focus();}}><DialogHeader><DialogTitle style={{overflowWrap:'anywhere'}}>{photo.name} 사진 보기</DialogTitle><DialogDescription>연결한 원본 사진의 화면 확대입니다. 화질 개선·변경 감지·시공 적합 판정이 아닙니다.</DialogDescription></DialogHeader>
   <label>사진 표시 배율<select aria-label="사진 표시 배율" value={zoom} onChange={event=>setZoom(Number(event.target.value))}><option value={100}>화면 맞춤</option><option value={200}>2배</option><option value={400}>4배</option></select></label><p>확대 후 아래 사진 영역에서 가로·세로로 스크롤해 확인하세요.</p>
   <div tabIndex={0} role="region" aria-label="확대 사진 탐색 영역" style={{maxHeight:'60dvh',overflow:'auto',border:'1px solid #dce2ed'}}><img src={url} alt={`확대 사진 ${photo.name}`} style={{display:'block',width:`${zoom}%`,maxWidth:'none',height:'auto'}}/></div><button type="button" onClick={()=>setExpanded(false)}>사진 보기 닫기</button>
  </DialogContent></Dialog>
 </figure>;
}
export function FieldPhotoInput({photos,onChange,onBusy}:{photos:FieldPhoto[];onChange:(photos:FieldPhoto[])=>void;onBusy:(busy:boolean)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 return <section aria-label="현장 사진 첨부"><h4>사진 근거 · {photos.length}/3</h4><p>기록에는 파일명·해시만 보관합니다. 사진은 서버에 전송하지 않으며 새로고침 후 같은 원본을 다시 연결해야 합니다. 탭 임시 보관 한도는 12장·30MB입니다.</p><input aria-label="현장 사진 선택" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||photos.length>=3} onChange={async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;setBusy(true);onBusy(true);setError('');try{const photo=await inspectFieldPhoto(file);if(mounted.current){if(photos.some(item=>item.sha256===photo.sha256))setError('이미 첨부한 사진입니다.');else onChange([...photos,photo]);}}catch(error){if(mounted.current)setError(error instanceof Error?error.message:'사진을 열 수 없습니다.');}finally{if(mounted.current){setBusy(false);onBusy(false);}}}}/>{error&&<p role="alert">{error}</p>}{photos.map(photo=><div key={photo.sha256}><FieldPhotoPreview photo={photo}/><button type="button" disabled={busy} onClick={()=>onChange(photos.filter(item=>item.sha256!==photo.sha256))}>{photo.name} 첨부 제거</button></div>)}</section>;
}
