import type {PriceBookDraft} from "../lib/workflow-pricebook-draft";
import { useEffect,useState } from "react";
import {WorkflowPriceBookFile} from './workflow-pricebook-file';
import {
  previewPriceBookCsv,
  type PriceBookEntry,
} from "../lib/workflow-pricebook";
export function WorkflowPriceBookImport({
  entries,
  draft,
  onDraft,
  locked,
  onImport,
}: {
  entries: PriceBookEntry[];
  draft?:PriceBookDraft;
  onDraft:(patch:Partial<PriceBookDraft>)=>void;
  locked: boolean;
  onImport: (csv: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [showPreview, setShowPreview] = useState(false),
    [message, setMessage] = useState("");
  const csv=draft?.csv??"",setCsv=(csv:string)=>onDraft({csv});
  const hasDraft=Boolean(draft?.file||draft?.csv);
  useEffect(()=>{if(hasDraft)setOpen(true);},[hasDraft]);
  const preview = showPreview ? previewPriceBookCsv(csv, entries) : null;
  return (
    <section aria-label="CSV 단가표 가져오기">
      <button aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        CSV 단가표 가져오기
      </button>
      {open && (
        <div className="flow-card">
          <h3>입력 → 미리보기 → 새 버전 보관</h3>
          <WorkflowPriceBookFile locked={locked} draft={draft?.file} onDraft={file=>onDraft({file})} onUse={value=>{onDraft({csv:value,file:undefined});setShowPreview(false);setMessage('파일 열을 연결했습니다. 아래 미리보기에서 오류를 확인하세요.');}}/>
          <p>
            CSV 텍스트를 붙여 넣으세요. 첫 행: 코드,품목명,단위,단가,출처.
            금액은 쉼표 없이 입력하고, 쉼표가 있는 품목·출처는 큰따옴표로
            감싸세요. 단위는 m, m², m³, 개입니다.
          </p>
          <p>
            파일의 CSV 텍스트·열 연결·미등록 입력도 이 탭과 작업 백업에 보관됩니다. 서버 업로드·Excel 파일 변환·금액 확정은 하지
            않습니다. 기존 연결 단가는 자동으로 바뀌지 않습니다.
          </p>
          <label className="flow-input">
            단가 CSV 내용
            <textarea
              aria-label="단가 CSV 내용"
              rows={7}
              maxLength={100000}
              value={csv}
              disabled={locked}
              placeholder={
                "코드,품목명,단위,단가,출처\nFIN-A,바닥 마감,m²,45000,단가표 1쪽"
              }
              onChange={(event) => {
                setCsv(event.target.value);
                setShowPreview(false);
                setMessage("");
              }}
            />
          </label>
          <div className="flow-actions">
            <button
              disabled={locked || !csv.trim()}
              onClick={() => {
                setShowPreview(true);
                setMessage("");
              }}
            >
              가져오기 미리보기
            </button>
            <button
              onClick={() => {
                setOpen(false);
                setShowPreview(false);
              }}
            >
              입력 유지하고 닫기
            </button>
          </div>
          {preview && (
            <section aria-label="단가 가져오기 미리보기" className="flow-card">
              <h4>
                정상 {preview.entries.length}건 · 오류 {preview.errors.length}건
              </h4>
              {preview.errors.length > 0 && (
                <div role="alert">
                  <p>
                    아직 보관되지 않았습니다. 모든 오류를 수정한 뒤 다시
                    확인하세요.
                  </p>
                  <ul>
                    {preview.errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
              {preview.entries.map((entry) => (
                <article key={entry.code}>
                  <p>
                    {entry.code} · v{entry.version} ·{" "}
                    {entry.version > 1 ? "기존 코드의 수정본" : "신규 코드"}
                  </p>
                  <p>
                    {entry.name} · {entry.rate.toLocaleString("ko-KR")}원/
                    {entry.unit}
                    <br />
                    출처: {entry.source}
                  </p>
                </article>
              ))}
              <button
                disabled={
                  locked || preview.errors.length > 0 || !preview.entries.length
                }
                onClick={() => {
                  if (
                    locked ||
                    preview.errors.length ||
                    !preview.entries.length
                  )
                    return;
                  onImport(csv);
                  setMessage(
                    `${preview.entries.length}건을 이 탭의 새 단가 버전으로 보관했습니다.`,
                  );
                  setCsv("");
                  setShowPreview(false);
                }}
              >
                전체 새 버전 보관
              </button>
            </section>
          )}
          {message && <p role="status">{message}</p>}
        </div>
      )}
    </section>
  );
}
