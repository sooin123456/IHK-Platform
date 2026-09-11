import {useState} from 'react';
const plans:Record<string,string>={individual:'개인',team:'팀',organization:'조직'};
const services:Record<string,string>={documents:'문서 저장소',accounting:'회계·내역 시스템',bim:'BIM·CAD 커넥터'};
export function WorkflowOrganization({drafts,onDraft}:{drafts:Record<string,string>;onDraft:(patch:Record<string,string>)=>void}){
 const get=(key:string,fallback='')=>drafts[`organization:${key}`]??fallback;
 const put=(values:Record<string,string>)=>onDraft(Object.fromEntries(Object.entries(values).map(([key,value])=>[`organization:${key}`,value])));
 const [notice,setNotice]=useState(''),[confirm,setConfirm]=useState(false),[checked,setChecked]=useState(false);
 const tab=get('tab','profile'),locked=get('role','admin')!=='admin',service=get('service','documents');
 const state=get(`integration:${service}`,'disconnected'),plan=get('plan','individual'),seats=get('seats','1');
 const valid=Object.hasOwn(plans,plan)&&/^\d+$/.test(seats)&&Number(seats)>=1&&Number(seats)<=10000&&(plan!=='individual'||Number(seats)===1);
 const reset=()=>{setConfirm(false);setChecked(false);setNotice('');};
 const connect=(value:string)=>{if(!locked&&Object.hasOwn(services,service))put({[`integration:${service}`]:value});};
 return <section className="flow-card" aria-label="조직 운영 설정">
  <h2>조직 운영 설정</h2><p>이 탭의 프론트엔드 체험입니다. 실제 조직·청구·접근 권한·외부 연결은 변경하지 않습니다. 비밀번호나 API 키를 입력하지 마세요.</p>
  <label className="flow-input">조직 설정 역할<select aria-label="조직 설정 역할" value={get('role','admin')} onChange={event=>{put({role:event.target.value});reset();}}><option value="admin">관리자 체험</option><option value="viewer">열람 체험</option></select></label>
  <nav className="flow-actions" aria-label="조직 운영 세부 화면">{[['profile','조직 정보'],['billing','요금·이용'],['integrations','외부 연동']].map(([key,label])=><button key={key} aria-current={tab===key?'page':undefined} onClick={()=>{put({tab:key});reset();}}>{label}</button>)}</nav>
  {notice&&<p role="status">{notice}</p>}
  {tab==='profile'&&<><h3>조직 정보</h3><p>보관된 조직: {get('saved:name')||'아직 없음'}</p><fieldset disabled={locked}>
   <label className="flow-input">조직 이름<input aria-label="조직 이름" maxLength={100} value={get('name')} onChange={event=>put({name:event.target.value})}/></label>
   <label className="flow-input">업무 분야<select aria-label="업무 분야" value={get('discipline','both')} onChange={event=>put({discipline:event.target.value})}><option value="both">건축·토목</option><option value="architecture">건축</option><option value="civil">토목·철도</option></select></label>
   <button disabled={!get('name').trim()} onClick={()=>{if(locked||!get('name').trim())return;put({'saved:name':get('name').trim(),'saved:discipline':get('discipline','both')});setNotice('조직 설정을 이 탭에 보관했습니다.');}}>조직 설정 보관</button>
  </fieldset></>}
  {tab==='billing'&&<><h3>요금·이용 검토</h3><p>요금제는 제품 구성 예시입니다. 가격·세금·계약 조건은 미정이며 결제되지 않습니다.</p><ul><li>개인: 도면 작성·측정·개인 라이브러리</li><li>팀: 공동 검토·물량 업무</li><li>조직: 회사 기준·감사·연동 관리</li></ul>
   {get('saved:plan')&&<p>보관된 검토안: {plans[get('saved:plan')]??'알 수 없는 요금제'} · {get('saved:seats')}석 · 청구 없음</p>}
   <fieldset disabled={locked}><label className="flow-input">검토 요금제<select aria-label="검토 요금제" value={plan} onChange={event=>put({plan:event.target.value})}>{Object.entries(plans).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="flow-input">계획 좌석 수<input type="number" min={1} max={10000} step={1} aria-label="계획 좌석 수" value={seats} onChange={event=>put({seats:event.target.value})}/></label>
   {!valid&&<p role="alert">좌석은 1~10,000의 정수이며 개인 요금제는 1석입니다.</p>}
   <button disabled={!valid} onClick={()=>{if(locked||!valid)return;put({'saved:plan':plan,'saved:seats':seats});setNotice('검토안만 보관했습니다. 구독이나 결제는 변경되지 않습니다.');}}>요금제 검토안 보관</button></fieldset></>}
  {tab==='integrations'&&<><h3>외부 연동</h3><label className="flow-input">연동 서비스<select aria-label="연동 서비스" value={service} onChange={event=>{put({service:event.target.value});reset();}}>{Object.entries(services).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <p>연동 범위 예시: {service==='accounting'?'승인 내역·수량 인계':service==='bim'?'모델·개정 메타데이터 참조':'승인 도면·납품 파일 참조'}. 실제 전송된 데이터는 없습니다.</p>
   <p role="status">{({disconnected:'연결 안 됨',configuring:'연결 설정 중',failed:'연결 실패 · 권한 거절 예시',connected:'연결됨 · 모의 상태'} as Record<string,string>)[state]??'알 수 없는 모의 상태'}</p>
   <fieldset disabled={locked}>
    {(state==='disconnected'||state==='failed')&&<button onClick={()=>connect('configuring')}>{state==='failed'?'다시 설정':'연결 설정 열기'}</button>}
    {state==='configuring'&&<><label className="flow-input">연결 결과 체험<select aria-label="연결 결과 체험" value={get('result','connected')} onChange={event=>put({result:event.target.value})}><option value="connected">연결 성공 예시</option><option value="failed">권한 거절 예시</option></select></label><button onClick={()=>connect(get('result','connected')==='connected'?'connected':'failed')}>연결 결과 확인</button><button onClick={()=>connect('disconnected')}>설정 취소</button></>}
    {state==='connected'&&!confirm&&<button onClick={()=>setConfirm(true)}>연결 해제</button>}
    {state==='connected'&&confirm&&<div><p>연결 상태만 해제하며 기존 도면·내역은 삭제하지 않습니다.</p><label><input type="checkbox" checked={checked} onChange={event=>setChecked(event.target.checked)}/>모의 연결 해제를 확인합니다</label><div className="flow-actions"><button disabled={!checked} onClick={()=>{if(!checked)return;connect('disconnected');reset();}}>해제 확인</button><button onClick={reset}>해제 취소</button></div></div>}
   </fieldset></>}
 </section>;
}
