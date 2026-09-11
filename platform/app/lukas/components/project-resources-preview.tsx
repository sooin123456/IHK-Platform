import {useEffect,useState} from "react";
import {Button} from "~/core/components/ui/button";
import {ProjectResourceReader} from "./project-resource-reader";

const kinds={quote:"견적서",spec:"시방서",schedule:"일정표",minutes:"회의록",other:"기타 자료"};
type Resource={id:string;projectId:string;name:string;kind:keyof typeof kinds;note:string;createdAt:string};
type Draft={name:string;kind:keyof typeof kinds;note:string};
const emptyDraft:Draft={name:"",kind:"quote",note:""};
const validDraft=(d:Draft)=>Boolean(d && typeof d.name==="string" && d.name.length<=180 && Object.hasOwn(kinds,d.kind) && typeof d.note==="string" && d.note.length<=2000);
export function parseProjectResources(raw:string,projectId:string):Resource[]|null {
  try {
    const rows=JSON.parse(raw);
    if(!Array.isArray(rows)||rows.length>100)return null;
    const ids=new Set();
    for(const row of rows){
      if(!validDraft(row)||!row.name.trim()||row.projectId!==projectId||typeof row.id!=="string"||!row.id.trim()||row.id.length>100||ids.has(row.id)||typeof row.createdAt!=="string"||!Number.isFinite(Date.parse(row.createdAt)))return null;
      ids.add(row.id);
    }
    return rows;
  }catch{return null;}
}

export function ProjectResourcesPreview({projectId,viewer}:{projectId:string;viewer:boolean}) {
  const key=`1hk:preview:resources:${projectId}`;
  const [rows,setRows]=useState<Resource[]>([]);
  const [draft,setDraft]=useState<Draft>(emptyDraft);
  const [selected,setSelected]=useState("");
  const [query,setQuery]=useState("");
  const [loaded,setLoaded]=useState(false);
  const [blocked,setBlocked]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    try{
      const parsed=parseProjectResources(sessionStorage.getItem(key)??"[]",projectId);
      if(!parsed)throw Error("invalid records");
      setRows(parsed);
      const raw=sessionStorage.getItem(`${key}:draft`);
      if(raw){const saved=JSON.parse(raw);if(!validDraft(saved))throw Error("invalid draft");setDraft(saved);}
      setSelected(sessionStorage.getItem(`${key}:selected`)??"");
    }catch{setBlocked(true);setError("자료 목록 또는 작성 중 내용을 복원하지 못했습니다. 기존 기록 보호를 위해 보관을 중지했습니다.");}
    setLoaded(true);
  },[key,projectId]);
  const updateDraft=(next:Draft)=>{
    if(viewer||!loaded||blocked)return;
    setDraft(next);
    try{sessionStorage.setItem(`${key}:draft`,JSON.stringify(next));setError("");}
    catch{setError("입력을 보관하지 못했습니다. 현재 창에는 남아 있지만 닫으면 유실될 수 있습니다.");}
  };
  const select=(id:string)=>{
    setSelected(id);
    try{sessionStorage.setItem(`${key}:selected`,id);}catch{setError("선택 위치를 보관하지 못했습니다. 자료 내용은 변경하지 않았습니다.");}
  };
  const active=rows.find(row=>row.id===selected);
  return <section className="grid gap-4" aria-label="일반 프로젝트 자료">
    <p className="text-sm text-muted-foreground">도면 원본·자재와 별개의 업무 자료입니다. 목록 정보와 입력 설명만 이 탭에 보관합니다. 상세에서 직접 선택한 로컬 PDF를 열람할 수 있으며 파일 업로드·참여자 공유는 하지 않습니다.</p>
    {!loaded&&<p role="status">자료 목록을 복원하고 있습니다.</p>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {viewer?<p className="text-sm">보기 전용 · 자료 추가와 설명 변경은 작성자에게 요청하세요.</p>:<form className="grid gap-3 rounded-xl border p-4" onSubmit={e=>{
      e.preventDefault();if(!loaded||blocked||!draft.name.trim()||rows.length>=100)return;
      const row:Resource={...draft,name:draft.name.trim(),id:crypto.randomUUID(),projectId,createdAt:new Date().toISOString()};
      const next=[...rows,row];
      try{sessionStorage.setItem(key,JSON.stringify(next));setRows(next);setError("");select(row.id);}catch{setError("자료 목록을 보관하지 못했습니다. 파일명과 설명을 유지했습니다. 다시 시도해 주세요.");return;}
      // Draft clearing is separate from the successful list write; report failures.
      updateDraft(emptyDraft);
    }}>
      <fieldset disabled={!loaded||blocked} className="grid gap-3">
        <legend className="font-semibold">자료 추가 준비 · 로컬 예시</legend>
        <label className="grid gap-1 text-sm">자료 파일 선택<input type="file" accept=".pdf,.xlsx,.xls,.docx,.doc,.hwp,.hwpx,.txt,.csv,.png,.jpg,.jpeg" onChange={e=>{const file=e.currentTarget.files?.[0];if(file){if(!file.size||file.size>50*1024*1024){setError("내용이 있는 50MB 이하 파일을 선택해 주세요.");}else updateDraft({...draft,name:file.name.normalize("NFC").slice(0,180)});}e.currentTarget.value="";}}/></label>
        <label className="grid gap-1 text-sm">자료 이름<input className="rounded border p-2" value={draft.name} required maxLength={180} onChange={e=>updateDraft({...draft,name:e.target.value})}/></label>
        <label className="grid gap-1 text-sm">자료 분류<select className="rounded border p-2" value={draft.kind} onChange={e=>updateDraft({...draft,kind:e.target.value as Draft["kind"]})}>{Object.entries(kinds).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <label className="grid gap-1 text-sm">자료 설명<textarea className="min-h-24 rounded border p-2" maxLength={2000} value={draft.note} onChange={e=>updateDraft({...draft,note:e.target.value})}/></label>
        <p className="text-xs text-muted-foreground">파일을 선택하면 이름만 가져옵니다. 설명은 직접 입력한 내용이며 파일에서 추출한 본문이 아닙니다.</p>
        <Button type="submit" disabled={!draft.name.trim()||rows.length>=100}>자료 목록에 보관 · 이 탭</Button>
        {rows.length>=100&&<p>이 탭의 자료 예시 한도 100개에 도달했습니다.</p>}
        {error&&!blocked&&<Button type="button" variant="outline" onClick={()=>updateDraft(draft)}>작성 내용 보관 다시 시도</Button>}
      </fieldset>
    </form>}
    <label className="grid gap-1 text-sm">자료 검색<input className="rounded border p-2" disabled={!loaded} value={query} onChange={e=>setQuery(e.target.value)}/></label>
    {loaded&&!blocked&&!rows.length&&<p>아직 보관한 자료가 없습니다. 견적서·시방서·일정표·회의록을 준비하세요.</p>}
    <ul className="grid gap-2">{rows.filter(row=>`${row.name} ${kinds[row.kind]}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(row=><li key={row.id}><Button className="h-auto w-full justify-start whitespace-normal break-all text-left" variant={selected===row.id?"secondary":"outline"} onClick={()=>select(row.id)}>{kinds[row.kind]} · {row.name}</Button></li>)}</ul>
    {loaded&&rows.length>0&&!rows.some(row=>`${row.name} ${kinds[row.kind]}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))&&<p>검색 결과가 없습니다.</p>}
    {active&&<article className="grid gap-2 rounded-xl border p-4" aria-label="자료 상세">
      <h3 className="break-all font-semibold">{active.name}</h3><p className="text-sm">{kinds[active.kind]} · {new Date(active.createdAt).toLocaleString("ko-KR")} · 원본 미업로드</p>
      <h4 className="text-sm font-medium">작성자가 입력한 설명</h4><p className="whitespace-pre-wrap break-words text-sm">{active.note||"설명 없음"}</p>
      <ProjectResourceReader key={active.id}/>
      <Button variant="outline" onClick={()=>select("")}>자료 상세 닫기</Button>
    </article>}
  </section>;
}
