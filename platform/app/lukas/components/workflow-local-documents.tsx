import type {WorkflowBlankDocument} from '../lib/workflow-blank-document';
export function WorkflowLocalDocuments({documents,search,onSearch,onOpen,onStart}:{documents:WorkflowBlankDocument[];search:string;onSearch:(value:string)=>void;onOpen:(id:string)=>void;onStart:()=>void}){
 const query=search.trim().toLocaleLowerCase();const filtered=documents.filter(document=>`${document.title} ${document.source?.name??''}`.toLocaleLowerCase().includes(query));
 return <section className="flow-card" aria-label="내 도면 목록"><h2>내 도면 · {documents.length}개</h2><p>직접 만든 작업 도면입니다. 아래 가져오기 목록의 원본 파일과 구분하며, 예시 프로젝트 자료는 포함하지 않습니다.</p>
 <label className="flow-input">도면 검색<input aria-label="내 도면 검색" value={search} onChange={event=>onSearch(event.target.value)}/></label>{search&&<button onClick={()=>onSearch('')}>도면 검색 초기화</button>}
 <button onClick={onStart}>새 도면 시작</button><p role="status">표시 {filtered.length}개</p>
 {!documents.length?<p>아직 만든 도면이 없습니다. 빈 작업을 만들거나 아래 PDF 파일에서 작업실을 여세요.</p>:!filtered.length?<p>검색 결과가 없습니다. 제목이나 원본 파일명을 확인하세요.</p>:filtered.map(document=><article className="flow-project-work" key={document.id} style={{overflowWrap:'anywhere'}}><div><h3>{document.title}</h3><p>{document.source?`${document.source.name} · ${document.source.pages}쪽`:'원본 없는 빈 도면'} · 작업 R{document.revision??1} · 객체 {document.shapes.length}개</p></div><button onClick={()=>onOpen(document.id)}>{document.title} 열기</button></article>)}
 </section>;
}
