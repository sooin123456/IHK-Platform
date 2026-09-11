import type {PriceBookFileDraft} from '../lib/workflow-pricebook-draft';
import {useEffect,useMemo,useRef,useState} from 'react';
import {mapPriceBookCsv,parsePriceBookCsvRows} from '../lib/workflow-pricebook';
const fields=['코드','품목명','단위','단가','출처'];
export function WorkflowPriceBookFile({locked,onUse,draft,onDraft}:{locked:boolean;draft?:PriceBookFileDraft;onDraft:(draft:PriceBookFileDraft|undefined)=>void;onUse:(csv:string)=>void}){
 const file=useMemo(()=>draft?{...draft,rows:parsePriceBookCsvRows(draft.text).rows}:null,[draft]);
 const mapping=draft?.mapping??[-1,-1,-1,-1,-1];
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);
 const clearFile=()=>onDraft(undefined);
 const attempt=useRef(0);useEffect(()=>()=>{attempt.current++;},[]);
 const result=file?mapPriceBookCsv(file.text,mapping):null;
 return <section aria-label="CSV 파일 준비"><label className="flow-input">단가 CSV 파일<input aria-label="단가 CSV 파일" type="file" accept=".csv,text/csv" disabled={locked} onChange={async event=>{
  const selected=event.target.files?.[0];event.target.value='';if(!selected)return;
  const token=++attempt.current;clearFile();setError('');setBusy(false);
  if(!selected.name.toLowerCase().endsWith('.csv')||selected.size>300000){setError('300KB 이하 UTF-8 CSV 파일을 선택하세요. XLSX는 CSV로 저장한 뒤 가져오세요.');return;}
  setBusy(true);try{const text=new TextDecoder('utf-8',{fatal:true}).decode(await selected.arrayBuffer());if(token!==attempt.current)return;const parsed=parsePriceBookCsvRows(text);if(parsed.errors.length){setError(parsed.errors.join(' '));return;}
   if(!parsed.rows.length){setError('CSV 제목 행이 없습니다.');return;}
   onDraft({name:selected.name,text,mapping:fields.map(field=>parsed.rows[0].findIndex(value=>value.trim()===field))});
  }catch{if(token===attempt.current)setError('파일을 읽을 수 없습니다. UTF-8 CSV로 저장한 뒤 다시 선택하세요.');}finally{if(token===attempt.current)setBusy(false);}
 }}/></label><p>파일은 서버에 전송하지 않습니다. 첫 행을 열 제목으로 사용합니다. 선택만으로 단가를 등록하거나 아래 입력을 바꾸지 않습니다.</p>
 {busy&&<p role="status">CSV 파일 읽는 중</p>}{error&&<p role="alert">{error}</p>}
 {file&&<section className="flow-card" aria-label="CSV 열 연결"><h4>열 연결 · {file.name}</h4><p>각 필수 항목에 서로 다른 열을 연결하세요. 선택하지 않은 열은 제외됩니다.</p>
 {fields.map((field,index)=><label className="flow-input" key={field}>{field}<select aria-label={`${field} 열`} disabled={locked} value={mapping[index]} onChange={event=>{if(draft)onDraft({...draft,mapping:mapping.map((value,i)=>i===index?Number(event.target.value):value)});}}><option value={-1}>열 선택</option>{file.rows[0].map((title,column)=><option value={column} key={column}>{column+1}열 · {title||'제목 없음'}</option>)}</select></label>)}
 <details><summary>원본 첫 데이터 행 확인</summary><ul>{file.rows[0].map((title,index)=><li key={index} style={{overflowWrap:'anywhere'}}>{index+1}열 · {title}: {file.rows[1]?.[index]??'데이터 없음'}</li>)}</ul></details>
 {!!result?.errors.length&&<p role="status">{result.errors.join(' ')}</p>}<p>‘열 연결 적용’은 아래 CSV 입력을 교체합니다. 이후 미리보기와 새 버전 보관을 진행해야 등록됩니다.</p>
 <button disabled={locked||!result||result.errors.length>0} onClick={()=>{if(!locked&&result&&!result.errors.length){onUse(result.csv);}}}>열 연결 적용</button><button onClick={()=>{attempt.current++;clearFile();setError('');}}>파일 선택 취소</button>
 </section>}
 </section>;
}
