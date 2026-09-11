import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { WorkflowBlankDocument } from "../lib/workflow-blank-document";
import {recalledWorkflowPdf,rememberWorkflowPdf,forgetWorkflowPdf} from '../lib/workflow-pdf-session';
import {
  localPdfFingerprint,
  localPdfSelectionError,
} from "../lib/drawing-pdf-screen-handoff";

type Renderer = typeof import("./drawing-pdf-screen-renderer.client");
export function WorkflowPdfBackground({
  source,
  page,
  onSource,
  onPage,
  onReady,
  children,
  fixedPage = false,
}: {
  source: WorkflowBlankDocument["source"];
  page: number;
  onSource: (source: NonNullable<WorkflowBlankDocument["source"]>) => void;
  onPage: (page: number) => void;
  onReady: (ready: boolean) => void;
  children: ReactNode;
  fixedPage?: boolean;
}) {
  const [file, setFile] = useState<File | null>(()=>source?recalledWorkflowPdf(source.sha256):null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(false);
  const callbacks = useRef({ source, onSource, onReady });
  callbacks.current = { source, onSource, onReady };
  useEffect(() => {
    if (!file) return;
    const controller = new AbortController();
    const url = URL.createObjectURL(file);
    let opened: { destroy: () => Promise<void> } | undefined;
    setLoading(true);
    setPdf(null);
    setError("");
    callbacks.current.onReady(false);
    void (async () => {
      const sha256 = await localPdfFingerprint(file);
      if (controller.signal.aborted) return;
      if (
        callbacks.current.source &&
        callbacks.current.source.sha256 !== sha256
      )
        throw new Error(
          "등록한 PDF와 내용이 다릅니다. 같은 원본을 다시 선택하세요. 기존 객체는 유지됩니다.",
        );
      const [reader, nextRenderer] = await Promise.all([
        import("../lib/pdf-page-renderer.client"),
        import("./drawing-pdf-screen-renderer.client"),
      ]);
      if (controller.signal.aborted) return;
      const result = await reader.openPdfDocument(url, controller.signal);
      if (controller.signal.aborted) {
        await result.destroy();
        return;
      }
      opened = result;
      rememberWorkflowPdf(sha256,file);
      setRenderer(nextRenderer);
      setPdf(result.document);
      callbacks.current.onSource({
        name: file.name,
        sha256,
        pages: result.document.numPages,
      });
      callbacks.current.onReady(true);
    })()
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error && reason.message.startsWith("등록한 PDF")
              ? reason.message
              : "PDF를 열 수 없습니다. 손상 여부와 암호 설정을 확인하고 다시 선택하세요.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      URL.revokeObjectURL(url);
      void opened?.destroy();
    };
  }, [file]);
  return (
    <div className="flow-pdf-background">
      <label className="flow-input">
        {source ? "원본 PDF 다시 연결" : "PDF 배경 연결"}
        <input
          aria-label="작업실 PDF 선택"
          type="file"
          accept=".pdf,application/pdf"
          disabled={loading}
          onChange={(event) => {
            const next = event.target.files?.[0];
            event.target.value = "";
            if (!next) return;
            const invalid = localPdfSelectionError(next);
            if (invalid) {
              setError(invalid);
              return;
            }
            setFile(next);
          }}
        />
      </label>
      <div className="flow-pdf-source-meta">
      <details className="flow-source-help">
        <summary>원본 보관·재연결 안내</summary>
        <p className="flow-note">
          파일은 서버에 업로드하지 않습니다. 확인된 원본은 이 탭 메모리에 최대 3개·합계 64MB까지 잠시 보관해 화면 이동 시 재사용합니다. 새로고침·탭 종료·보관 한도 초과 후에는 같은 PDF를 다시 선택해야 합니다. 재사용 시에도 SHA-256을 확인하며 실측 정합을 의미하지 않습니다.
        </p>
        {source&&file&&<button disabled={loading} onClick={()=>{forgetWorkflowPdf(source.sha256);setFile(null);setPdf(null);setRenderer(null);setError('');callbacks.current.onReady(false);}}>이 원본 임시 보관 해제</button>}
      </details>
      {source && (
        <p>
          {source.name} · {source.pages}쪽 · 원본 잠금
        </p>
      )}
      </div>
      {loading && <p role="status">PDF 원본을 확인하고 불러오는 중입니다.</p>}
      {error && <p role="alert">{error}</p>}
      {pdf && renderer ? (
        <>
          <div className="flow-actions">
            {!fixedPage&&<button disabled={page <= 1} onClick={() => onPage(page - 1)}>
              이전 PDF 쪽
            </button>}
            <span>
              {page} / {pdf.numPages}쪽
            </span>
            {!fixedPage&&<button
              disabled={page >= pdf.numPages}
              onClick={() => onPage(page + 1)}
            >
              다음 PDF 쪽
            </button>}
            <button
              disabled={zoom <= 0.5}
              onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
            >
              PDF 축소
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              disabled={zoom >= 3}
              onClick={() => setZoom((value) => Math.min(3, value + 0.25))}
            >
              PDF 확대
            </button>
            <button
              aria-pressed={pan}
              onClick={() => setPan((value) => !value)}
            >
              PDF 이동 모드
            </button>
          </div>
          <div className="flow-local-pdf-surface">
            <renderer.PdfScreenSurface
              document={pdf}
              pageNumber={Math.min(page, pdf.numPages)}
              zoom={zoom}
              panEnabled={pan}
              fitKey={0}
              overlay={
                <div
                  className="flow-local-pdf-overlay"
                  style={{ pointerEvents: pan ? "none" : "auto" }}
                >
                  {children}
                </div>
              }
            />
          </div>
        </>
      ) : source ? (
        <p role="status">
          원본 PDF를 다시 연결하면 저장된 페이지와 객체를 표시합니다. 다른 예시
          도면으로 대체하지 않습니다.
        </p>
      ) : (
        children
      )}
    </div>
  );
}
