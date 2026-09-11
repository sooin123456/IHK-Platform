import {useState} from 'react';
import type {Workflow} from '../lib/workflow-prototype';

export function WorkflowInvitation({shared,onAccept,onBack}:{shared:NonNullable<Workflow['sharePreview']>;onAccept:()=>void;onBack:()=>void}) {
 const [account,setAccount]=useState<'invited'|'other'|'signed-out'>('invited');
 const [declined,setDeclined]=useState(false);
 const unavailable=shared.status==='expired';
 return <section className="flow-evidence-summary" aria-label="초대 확인">
  <h3>도면 검토 초대 · 미리보기</h3>
  <p>초대 대상: {shared.recipient}</p>
  <p>{shared.document} · R{shared.revision}</p>
  <dl>
   <dt>허용 범위</dt><dd>{shared.permission==='view'?'보기 전용':'보기·의견 작성'}</dd>
   <dt>공개 정보</dt><dd>선택 객체의 근거·수량{shared.amount!==undefined?'·금액':''}</dd>
   <dt>제외 범위</dt><dd>객체 편집, 검토 승인, 다른 도면, 회사 단가표, 프로젝트 설정</dd>
  </dl>
  <p>실제 로그인·초대 발송·권한 부여가 없는 화면 체험입니다. 초대 수락 여부는 이 미리보기에서만 유지됩니다.</p>
  {unavailable?<p role="alert">종료된 초대입니다. 소유자의 재열람 허용이 필요합니다.</p>:declined?<>
   <p role="status">초대를 거절한 상태 예시입니다. 공유 내용은 열지 않았으며 소유자에게 통지하지 않았습니다.</p>
   <button onClick={()=>setDeclined(false)}>초대 다시 확인</button>
  </>:<>
   <label className="flow-input">접속 계정 체험<select aria-label="접속 계정 체험" value={account} onChange={event=>setAccount(event.target.value as typeof account)}>
    <option value="invited">초대받은 계정</option><option value="other">다른 계정</option><option value="signed-out">로그인 전</option>
   </select></label>
   {account!=='invited'&&<>
    <p role="alert">{account==='other'?'초대 대상과 다른 계정입니다.':'먼저 초대받은 계정으로 로그인해야 합니다.'} 현재 상태에서는 공유 내용을 열 수 없습니다.</p>
    <button onClick={()=>setAccount('invited')}>초대 계정으로 전환 체험</button>
   </>}
   <button disabled={account!=='invited'} onClick={onAccept}>초대 수락 후 열기 (체험)</button>
   <button onClick={()=>setDeclined(true)}>초대 거절 (체험)</button>
  </>}
  <button onClick={onBack}>공유 설정으로 돌아가기</button>
 </section>;
}
