import {useRef,useState} from 'react';import {useSearchParams} from 'react-router';
import {useSceneGallery,WorkflowSceneGallery} from './workflow-scene-gallery';
import type {GalleryFrame} from '../lib/workflow-scene-gallery';
import type {Workflow} from '../lib/workflow-prototype';
import {readScene,savedScenes,type WorkflowScene} from '../lib/workflow-scenes';
import {SampleModel,type ModelCameraPose,type ModelFrame} from './workflow-prototype-canvas';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '~/core/components/ui/dialog';
export function WorkflowPresentation({state,drafts,onSave,onWorkspace}:{state:Workflow;drafts:Record<string,string>;onSave:(key:string,value:string)=>void;onWorkspace:()=>void}){
 const gallery=useSceneGallery();
 const [params,setParams]=useSearchParams();const sample=params.get('scope')==='sample';const scenes=savedScenes(drafts,state.scenario);const selected=params.get('scene');const scene=scenes.find(scene=>scene.id===selected);
 const startButton=useRef<HTMLButtonElement>(null);const playing=sample&&params.get('present')==='1';
 const [deleteId,setDeleteId]=useState<string|null>(null);const deleting=scenes.find(scene=>scene.id===deleteId);
 const move=(id:string,direction:number)=>{const order=scenes.map(scene=>scene.id),index=order.indexOf(id),target=index+direction;if(index<0||target<0||target>=order.length)return;[order[index],order[target]]=[order[target],order[index]];onSave(`scene-order:${state.scenario}`,JSON.stringify(order));};
 const presented=scenes.find(scene=>scene.id===(params.get('presentScene')??selected));const index=presented?scenes.indexOf(presented):-1;
 const close=()=>setParams(previous=>{const next=new URLSearchParams(previous);next.delete('present');next.delete('presentScene');return next;});
 const slide=(index:number)=>{if(!scenes[index])return;setParams(previous=>{const next=new URLSearchParams(previous);next.set('presentScene',scenes[index].id);return next;});};
 return <section aria-label="3D 장면·프레젠테이션"><header className="flow-card"><h2>3D 장면·프레젠테이션</h2><p>시점·단면·격리 상태를 보관해 다시 설명할 수 있는 화면입니다. 장면은 카메라 설정이며 모델 개정이나 승인본을 복제하지 않습니다.</p></header>
 {!sample?<section className="flow-card"><p>실제 모델 원본이 연결되지 않았습니다. 아래 체험은 생성된 예시 형상이며 실제 IFC·DWG·2D 자동 모델링 결과가 아닙니다.</p><button onClick={()=>setParams({page:'presentation',scenario:'ifc',scope:'sample'})}>3D 예시로 장면 체험</button></section>:<>
  <div className="flow-card"><strong>{state.document} · 예시 R{state.revision}</strong><p>실제 IFC 미연결 · 실사 렌더링·동영상·AI 생성 기능이 아닙니다.</p><button onClick={onWorkspace}>같은 예시 작업실로</button><button onClick={()=>setParams({page:'presentation'})}>예시 체험 나가기</button></div>
  <nav className="flow-card" aria-label="보관한 3D 장면"><h3>보관한 장면 {scenes.length}개</h3><p>위에서 아래 순서로 발표합니다. 장면을 삭제해도 모델·도면·승인 기록은 유지됩니다.</p><button onClick={()=>setParams({page:'presentation',scope:'sample',scenario:state.scenario})}>기본 시점에서 새 장면</button>{scenes.map((scene,index)=><div key={scene.id} data-scene-row className="flow-actions"><button aria-label={`${scene.name} 장면 열기`} aria-pressed={selected===scene.id} onClick={()=>setParams({page:'presentation',scope:'sample',scenario:state.scenario,scene:scene.id})}>{index+1}. {scene.name}</button><button disabled={index===0} aria-label={`${scene.name} 앞으로`} onClick={()=>move(scene.id,-1)}>앞으로</button><button disabled={index===scenes.length-1} aria-label={`${scene.name} 뒤로`} onClick={()=>move(scene.id,1)}>뒤로</button><button aria-label={`${scene.name} 삭제`} onClick={()=>setDeleteId(scene.id)}>삭제</button></div>)}
   {deleting&&<div role="group" aria-label="장면 삭제 확인"><p>‘{deleting.name}’의 저장 시점을 삭제할까요? 현재 탭에서는 복구할 수 없습니다. 필요한 경우 먼저 작업 백업을 내려받으세요.</p><button onClick={()=>{onSave(`scene:${deleting.id}`,'');setDeleteId(null);if(selected===deleting.id)setParams({page:'presentation',scope:'sample',scenario:state.scenario});}}>장면 삭제 확인</button><button onClick={()=>setDeleteId(null)}>장면 삭제 취소</button></div>}
  </nav>
  <button ref={startButton} disabled={!scene} onClick={()=>setParams(previous=>{const next=new URLSearchParams(previous);next.set('present','1');next.delete('presentScene');return next;})}>보관한 장면 발표 시작</button><p>저장된 장면을 선택한 뒤 시작하세요. 보관 전 편집 입력은 발표에 적용하지 않습니다.</p>
  <Dialog open={playing} onOpenChange={open=>{if(!open)close();}}><DialogContent className="flow-dialog flow-scene-player" style={{width:'calc(100vw - 32px)',maxWidth:1100,maxHeight:'94dvh',overflowY:'auto'}} onCloseAutoFocus={event=>{event.preventDefault();startButton.current?.focus();}}>
   <DialogHeader><DialogTitle>장면 발표 · 예시 모델</DialogTitle><DialogDescription>생성된 예시 형상의 보관 시점입니다. 실제 IFC·실사 렌더링·승인 결과가 아닙니다.</DialogDescription></DialogHeader>
   {presented?<><h2 aria-live="polite">{index+1} / {scenes.length} · {presented.name}</h2><div className="flow-actions"><button disabled={index<=0} onClick={()=>slide(index-1)}>이전 장면</button><button disabled={index>=scenes.length-1} onClick={()=>slide(index+1)}>다음 장면</button><button onClick={close}>발표 종료</button></div><PresentationStage key={`present:${presented.id}`} state={state} scene={presented} count={scenes.length} readOnly/></>:<><p role="alert">발표할 장면을 찾을 수 없습니다. 다른 장면으로 대체하지 않습니다.</p><button onClick={close}>발표 종료</button></>}
  </DialogContent></Dialog>
  {selected&&!scene?<p role="alert">선택한 장면을 찾을 수 없습니다. 다른 시점으로 대체하지 않습니다. 기본 시점 또는 보관한 장면을 선택하세요.</p>:<PresentationStage key={`${state.scenario}:${selected??'new'}`} state={state} scene={scene} count={scenes.length} onStore={frame=>gallery.add({...frame,scenario:state.scenario})} onSave={scene=>{onSave(`scene:${scene.id}`,JSON.stringify(scene));setParams({page:'presentation',scope:'sample',scenario:state.scenario,scene:scene.id});}}/>}
  <WorkflowSceneGallery gallery={gallery} scenario={state.scenario}/>
 </>}
 </section>;
}
function PresentationStage({state,scene,count,onSave,onStore,readOnly=false}:{state:Workflow;scene?:WorkflowScene;count:number;onSave?:(scene:WorkflowScene)=>void;readOnly?:boolean;onStore?:(frame:Omit<GalleryFrame,'id'|'scenario'>)=>boolean}){
 const captureFrame=useRef<((width?:1280|1920)=>ModelFrame)|null>(null);
 const [image,setImage]=useState<(ModelFrame&{name:string;revision:number})|null>(null);
 const [stored,setStored]=useState(false),[outputWidth,setOutputWidth]=useState<1280|1920|undefined>(undefined);
 const camera=useRef<ModelCameraPose|null>(scene?{scenario:scene.scenario,position:scene.position,target:scene.target}:null);
 const [name,setName]=useState(scene?.name??''),[section,setSection]=useState(scene?.section??false),[grid,setGrid]=useState(scene?.grid??true),[isolated,setIsolated]=useState(scene?.isolated??false),[error,setError]=useState('');
 return <div className="flow-card">
  {scene&&scene.revision!==state.revision&&<p role="status">장면은 R{scene.revision}에서 보관했습니다. 현재 R{state.revision} 예시 형상에 시점만 적용합니다. 과거 형상 복원이 아닙니다.</p>}
  <SampleModel captureFrame={captureFrame} cameraPose={camera} scenario={state.scenario} selected={true} hidden={false} isolated={isolated} section={section} grid={grid} geometryChanged={state.revision>1}/>
  {!readOnly&&<><section aria-label="장면 이미지 출력"><h3>장면 이미지</h3><p>현재 시점의 예시 형상을 PNG로 캡처합니다. 실사 렌더링·AI 생성·실제 IFC 출력이 아닙니다. 준비한 결과는 임시입니다. 내려받거나 이 브라우저에 보관하면 다시 확인할 수 있습니다.</p><label className="flow-input">이미지 출력 크기<select aria-label="이미지 출력 크기" value={outputWidth??'viewport'} onChange={event=>setOutputWidth(event.target.value==='1280'?1280:event.target.value==='1920'?1920:undefined)}><option value="viewport">현재 화면 크기</option><option value="1280">가로 1280px</option><option value="1920">가로 1920px</option></select></label><p>현재 화면 비율로 다시 렌더링하며 하단 안내문 48px이 추가됩니다. 출력 크기는 사진처럼 사실적인 렌더 품질을 의미하지 않습니다.</p><button onClick={()=>{try{const frame=captureFrame.current?.(outputWidth);if(!frame){setError('모델 로딩 후 이미지 준비를 다시 시도하세요.');return;}setStored(false);setImage({...frame,name:name.trim()||'이름 없는 장면',revision:state.revision});setError('');}catch{setError('이미지를 준비하지 못했습니다. 모델이 보이는지 확인하고 다시 시도하세요.');}}}>현재 화면 이미지 준비</button>
  {image&&<section className="flow-card" aria-label="장면 이미지 결과"><h4>{image.name} · 이미지 결과</h4><p>예시 R{image.revision} · {image.width} × {image.height}px · PNG</p><img src={image.dataUrl} alt={image.name+' 예시 모델 이미지'} style={{display:'block',maxWidth:'100%',height:'auto'}}/><p>준비 시점의 고정 이미지입니다. 시점이나 단면을 바꿨다면 다시 준비하세요.</p><button onClick={()=>{const link=document.createElement('a');link.href=image.dataUrl;link.download='1hk-sample-scene.png';link.click();}}>예시 장면 PNG 다운로드</button><button disabled={stored} onClick={()=>{if(onStore?.(image))setStored(true);}}>이미지를 이 브라우저에 보관</button>{stored&&<p role="status">브라우저 보관함에 저장했습니다.</p>}<button onClick={()=>setImage(null)}>이미지 결과 닫기</button></section>}
  </section><div className="flow-actions"><label><input type="checkbox" aria-label="장면 단면" checked={section} onChange={event=>setSection(event.target.checked)}/>단면</label><label><input type="checkbox" aria-label="장면 격자" checked={grid} onChange={event=>setGrid(event.target.checked)}/>격자</label><label><input type="checkbox" aria-label="장면 대상만 표시" checked={isolated} onChange={event=>setIsolated(event.target.checked)}/>대상만 표시</label></div>
  <label className="flow-input">장면 이름<input aria-label="장면 이름" maxLength={80} value={name} onChange={event=>setName(event.target.value)}/></label>
  <button disabled={count>=12} onClick={()=>{const pose=camera.current;const next=pose&&readScene(JSON.stringify({id:crypto.randomUUID(),name,scenario:state.scenario,revision:state.revision,position:pose.position,target:pose.target,section,grid,isolated}));if(!next){setError('모델 로딩과 장면 이름·시점을 확인하세요.');return;}onSave?.(next);}}>현재 시점을 새 장면으로 보관</button>
  {count>=12&&<p>시나리오별 장면은 최대 12개입니다. 기존 장면은 덮어쓰지 않습니다.</p>}{error&&<p role="alert">{error}</p>}</>}
 </div>;
}
