import type {ScreenShape,ScreenObjectProperties} from "./drawing-screen-object-preview";
const fields=[['classification','공종'],['code','회사 코드'],['note','검토 메모'],['required','후속 검토 표시']] as const;
function value(properties:ScreenObjectProperties|undefined,key:keyof ScreenObjectProperties){
 if(!properties)return "미등록";
 if(key==="required")return properties.required?"있음":"없음";
 return properties[key]||"미입력";
}
export function DrawingObjectPropertiesRecord({object,before,showAbsent=false}:{object:ScreenShape;before?:ScreenShape;showAbsent?:boolean}){
 if(!showAbsent&&!object.properties&&!before?.properties)return null;
 return <section aria-label="사용자 속성 기록" className="mt-3 rounded border p-3 text-sm">
  <h4 className="font-semibold">사용자 속성{before?" · 이전 → 현재":" · 기록 값"}</h4>
  <dl className="mt-2 grid gap-2">{fields.map(([key,label])=><div key={key}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words">{before?`${value(before.properties,key)} → `:""}{value(object.properties,key)}</dd></div>)}</dl>
  <p className="mt-2 text-xs text-muted-foreground">후속 검토 표시는 요청·승인 상태가 아닙니다.</p>
 </section>;
}
