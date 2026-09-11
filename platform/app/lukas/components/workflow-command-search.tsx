import { useEffect, useRef, useState } from "react";
import { workflowPages, type WorkflowPage } from "../lib/workflow-prototype";
import type { WorkflowBlankDocument } from "../lib/workflow-blank-document";
export function WorkflowCommandSearch({
  documents,
  onGo,
  onOpen,
}: {
  documents: WorkflowBlankDocument[];
  onGo: (page: WorkflowPage) => void;
  onOpen: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const open = () => {
    dialog.current?.showModal();
    input.current?.focus();
  };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !event.altKey
      ) {
        if (document.querySelector('[role="dialog"]') && !dialog.current?.open)
          return;
        event.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else open();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);
  const term = query.trim().toLowerCase();
  const results = [
    ...documents.map((doc) => ({
      id: `doc:${doc.id}`,
      label: `작업: ${doc.title}`,
      description: doc.source?.name ?? "원본 없는 로컬 구상",
      run: () => onOpen(doc.id),
    })),
    ...workflowPages.map(([id, label, group]) => ({
      id: `page:${id}`,
      label: `화면: ${label}`,
      description: `${group} · 프론트엔드 화면`,
      run: () => onGo(id),
    })),
  ].filter((item) =>
    `${item.label} ${item.description}`.toLowerCase().includes(term),
  );
  const visit = (item: (typeof results)[number]) => {
    dialog.current?.close();
    setQuery("");
    item.run();
  };
  return (
    <>
      <button aria-label="화면·작업 검색" onClick={open}>
        검색 <kbd>⌘/Ctrl K</kbd>
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="workflow-search-title"
        className="flow-command-search"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div>
          <header>
            <h2 id="workflow-search-title">화면·작업 검색</h2>
            <button onClick={() => dialog.current?.close()}>닫기</button>
          </header>
          <p>
            화면 이름과 이 탭의 작업·파일 이름을 검색합니다. PDF 본문이나 서버
            자료를 검색하지 않습니다.
          </p>
          <label className="flow-input">
            검색어
            <input
              ref={input}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && results[0]) {
                  event.preventDefault();
                  visit(results[0]);
                }
              }}
              placeholder="예: 검토, 납품, 내 도면 이름"
            />
          </label>
          <div className="flow-command-results">
            {results.length ? (
              results.map((item) => (
                <button
                  key={item.id}
                  aria-label={item.label}
                  onClick={() => visit(item)}
                >
                  <span>{item.label}</span>
                  <small>{item.description}</small>
                </button>
              ))
            ) : (
              <p role="status">
                검색 결과가 없습니다. 다른 이름으로 검색해 주세요.
              </p>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
