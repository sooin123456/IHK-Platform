import { useState } from "react";
import {measurementValue} from '../lib/workflow-measurement';
import {WorkflowMeasurementEvidence} from './workflow-measurement-evidence';
import type { WorkflowBlankDocument } from "../lib/workflow-blank-document";
import type { PriceBookEntry } from "../lib/workflow-pricebook";
import {
  documentQuantityRow,
  documentQuantitySchema,
  documentDemoRates,
  type DocumentQuantity,
} from "../lib/workflow-document-quantity";
type Shape = WorkflowBlankDocument["shapes"][number];
const number = (value: number) =>
  value.toLocaleString("ko-KR", { maximumFractionDigits: 3 });

export function WorkflowQuantityEditor({
  document,
  shape,
  writable,
  onSave,
  onOpen,
  pricebook = [],
  pricebookLabel = "",
}: {
  document: WorkflowBlankDocument;
  shape: Shape;
  writable: boolean;
  onSave: (value: Omit<DocumentQuantity, "basis">) => void;
  onOpen: () => void;
  pricebook?: PriceBookEntry[];
  pricebookLabel?: string;
}) {
  const saved = shape.quantity;
  const [measurementSource,setMeasurementSource]=useState(saved?.measurementSource);
  const measurements=(document.measurements??[]).filter(record=>record.source.sha256===document.source?.sha256&&record.page===(shape.page??1)&&record.revision===(document.revision??1));
  const [raw, setRaw] = useState(saved ? String(saved.raw) : "");
  const [correction, setCorrection] = useState(String(saved?.correction ?? 0));
  const [rate, setRate] = useState(saved ? String(saved.rate) : "");
  const [unit, setUnit] = useState<DocumentQuantity["unit"]>(
    saved?.unit ?? "m²",
  );
  const [reason, setReason] = useState(saved?.reason ?? "");
  const [message, setMessage] = useState("");
  const [rateReference, setRateReference] = useState<
    DocumentQuantity["rateReference"]
  >(saved?.rateReference);
  const [rateSource, setRateSource] = useState<DocumentQuantity["rateSource"]>(
    saved?.rateSource,
  );
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [rateQuery, setRateQuery] = useState("");
  const candidates = documentDemoRates.filter((item) =>
    `${item.code} ${item.name} ${item.trade}`
      .toLowerCase()
      .includes(rateQuery.trim().toLowerCase()),
  );
  const selectedRate = documentDemoRates.find(
    (item) => item.code === rateReference?.code,
  );
  const registered = pricebook.filter((item) =>
    `${item.code} ${item.name} ${item.source}`
      .toLowerCase()
      .includes(rateQuery.trim().toLowerCase()),
  );
  const row = documentQuantityRow(document, shape);
  const input = {
    raw: Number(raw),
    correction: Number(correction),
    rate: Number(rate),
    unit,
    reason,
    rateReference,
    rateSource,
    measurementSource,
  };
  const valid =
    raw.trim() !== "" &&
    correction.trim() !== "" &&
    rate.trim() !== "" &&
    documentQuantitySchema.safeParse({ ...input, basis: "preview" }).success;
  return (
    <section aria-label="객체 수량 근거" className="flow-card">
      <h3>수량·단가 연결</h3>
      <p>
        수동 입력 또는 측정 기록 연결 · 미확정. 화면 도형의 크기에서 자동 측정하지 않습니다. 단가는
        원/선택 단위이며 금액은 원 단위 반올림 미리보기입니다.
      </p>
      {!document.source && (
        <p>PDF 원본을 연결한 뒤 입력 근거를 저장할 수 있습니다.</p>
      )}
      {row && (
        <p role="status">
          {row.stale ? "근거 변경 · 재확인 필요" : "입력 근거 연결됨 · 미확정"}{" "}
          · {number(row.final)} {row.unit} · {number(row.amount)}원
        </p>
      )}
      <fieldset disabled={!writable || !document.source}>
        {measurements.length>0&&<details><summary>보관된 측정값으로 입력</summary>
          <p>같은 원본·페이지·개정의 기록만 표시합니다. 가져오면 원수량·단위를 채우고 보정과 단가를 초기화합니다. 객체와의 대응은 직접 확인해야 하며 저장 전에는 반영되지 않습니다.</p>
          {measurements.map(record=><button key={record.id} onClick={()=>{
            const value=measurementValue(record);if(value===null)return;
            setMeasurementSource(structuredClone(record));setRaw(String(Number(value.toFixed(6))));setUnit(record.kind==='area'?'m²':'m');setCorrection('0');setRate('');setRateReference(undefined);setRateSource(undefined);setMessage('측정값을 불러왔습니다. 단가·보정·사유를 확인한 뒤 연결하세요.');
          }}>측정 기록 #{record.id} 가져오기</button>)}
        </details>}
        <WorkflowMeasurementEvidence evidence={measurementSource}/>
        {measurementSource&&<p>원수량이나 단위를 직접 바꾸면 측정 연결이 해제됩니다. 차이는 보정수량으로 입력하세요.</p>}
        {(
          [
            ["수동 원수량", raw, setRaw],
            ["수량 보정", correction, setCorrection],
            ["단가 원", rate, setRate],
          ] as const
        ).map(([label, value, set]) => (
          <label className="flow-input" key={label}>
            {label}
            <input
              aria-label={label}
              type="number"
              step="any"
              value={value}
              onChange={(event) => {
                set(event.target.value);
                if(label==='수동 원수량')setMeasurementSource(undefined);
                if (label === "단가 원") {
                  setRateReference(undefined);
                  setRateSource(undefined);
                }
                setMessage("");
              }}
            />
          </label>
        ))}
        <label className="flow-input">
          수량 단위
          <select
            aria-label="수량 단위"
            value={unit}
            onChange={(event) => {
              setUnit(event.target.value as DocumentQuantity["unit"]);
              if (event.target.value !== unit) {
                setMeasurementSource(undefined);
                setRateReference(undefined);
                setRateSource(undefined);
                setRate("");
              }
            }}
          >
            {["m", "m²", "m³", "개"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <p>
          {rateSource
            ? `선택한 등록 단가: ${rateSource.name} · ${rateSource.code} · v${rateSource.version} · 출처: ${rateSource.source}`
            : selectedRate
              ? `선택한 단가: ${selectedRate.trade} · ${selectedRate.name} · DEMO-RATES-01 · ${selectedRate.code}`
              : "직접 입력 단가 · 단가표 연결 없음"}
        </p>
        <button
          aria-expanded={catalogOpen}
          onClick={() => setCatalogOpen((value) => !value)}
        >
          단가표에서 선택
        </button>
        {catalogOpen && (
          <section className="flow-card" aria-label="화면 체험 단가표">
            <h4>화면 체험 단가표</h4>
            <p>
              DEMO-RATES-01 · 임의 시연 금액입니다. 실제 회사·시장 단가가
              아닙니다. 선택만으로 저장되지 않으며 ‘수량 근거 연결’로
              반영합니다.
            </p>
            <label className="flow-input">
              연결할 단가 검색
              <input
                aria-label="연결할 단가 검색"
                value={rateQuery}
                onChange={(event) => setRateQuery(event.target.value)}
                placeholder="공종·항목 이름·코드"
              />
            </label>
            <h4>로컬 등록 단가 · {pricebookLabel}</h4>
            <p>
              회사 단가 화면에서 이 시나리오에 등록한 자료입니다. 실제 회사 공유
              자료가 아닙니다. 버전을 선택해 저장하면 이후 수정본이 생겨도 연결
              금액을 유지합니다.
            </p>
            {registered.map((item) => (
              <article key={`${item.code}:${item.version}`}>
                <p>
                  {item.name} · {item.code} · v{item.version}
                  <br />
                  {number(item.rate)}원/{item.unit} · 출처: {item.source}
                </p>
                {item.unit !== unit && <p>단위 불일치: 현재 수량은 {unit}</p>}
                <button
                  aria-label={`${item.name} v${item.version} 등록 단가 선택`}
                  disabled={item.unit !== unit}
                  onClick={() => {
                    setRate(String(item.rate));
                    setRateReference(undefined);
                    setRateSource({ ...item });
                    setCatalogOpen(false);
                  }}
                >
                  이 버전 선택
                </button>
              </article>
            ))}
            {!registered.length && (
              <p>
                조건에 맞는 등록 단가가 없습니다. 회사 단가 화면에서 등록하거나
                아래 체험 단가를 선택하세요.
              </p>
            )}
            <h4>체험용 예시 단가</h4>
            {candidates.map((item) => (
              <article key={item.code}>
                <p>
                  {item.trade} · {item.name} · {item.code}
                  <br />
                  {number(item.rate)}원/{item.unit}
                </p>
                {item.unit !== unit && <p>단위 불일치: 현재 수량은 {unit}</p>}
                <button
                  aria-label={`${item.name} 선택`}
                  disabled={item.unit !== unit}
                  onClick={() => {
                    setRate(String(item.rate));
                    setRateSource(undefined);
                    setRateReference({
                      catalogVersion: "DEMO-RATES-01",
                      code: item.code,
                    });
                    setCatalogOpen(false);
                  }}
                >
                  이 단가 선택
                </button>
              </article>
            ))}
            {!candidates.length && (
              <p role="status">
                검색 결과가 없습니다. 검색어를 지워 전체 항목을 확인하세요.
              </p>
            )}
            <button onClick={() => setCatalogOpen(false)}>단가표 닫기</button>
          </section>
        )}
        <label className="flow-input">
          수량 입력 근거
          <textarea
            aria-label="수량 입력 근거"
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="예: 산출서 3행, 가로×세로, 보정 사유"
          />
        </label>
        <p>
          보정 후 수량 0~1,000,000, 단가 0~1,000,000,000원. 원수량·단가·근거를
          모두 입력해 주세요.
        </p>
        <button
          disabled={!valid}
          onClick={() => {
            if (valid) {
              onSave(input);
              setMessage("수량 근거를 연결했습니다.");
            }
          }}
        >
          수량 근거 연결
        </button>
      </fieldset>
      {message && <p role="status">{message}</p>}
      <button onClick={onOpen}>내 수량·내역 보기</button>
    </section>
  );
}

export function WorkflowDocumentQuantities({
  documents,
  onOpen,
}: {
  documents: WorkflowBlankDocument[];
  onOpen: (id: string, target: string, page: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const rows = documents.flatMap((document) =>
    document.shapes.map((shape) => ({
      document,
      shape,
      row: documentQuantityRow(document, shape),
    })),
  );
  const current = rows.filter((item) => item.row && !item.row.stale);
  const term = query.trim().toLocaleLowerCase();
  const visible = rows.filter(({ document, shape, row }) => {
    const kind = !row ? "missing" : row.stale ? "stale" : "current";
    return (
      (status === "all" || kind === status) &&
      [document.title, document.source?.name, shape.label, row?.reason]
        .join(" ")
        .toLocaleLowerCase()
        .includes(term)
    );
  });
  const visibleCurrent = visible.filter((item) => item.row && !item.row.stale);
  return (
    <section className="flow-card" aria-label="내 도면 수량·내역">
      <h2>내 도면 수량·내역</h2>
      <p>
        직접 만든 객체의 수동 입력 내역입니다. 도면 검토 승인과 적산 승인은
        별개이며, 모든 금액은 미확정·부가세 및 제경비 미포함입니다.
      </p>
      <p>
        {current.length
          ? `연결 ${current.length}건 · 전체 미확정 합계 ${number(current.reduce((sum, item) => sum + (item.row?.amount ?? 0), 0))}원`
          : "집계 대상 없음"}{" "}
        · 미연결·재확인 항목은 합계에서 제외
      </p>
      <div className="flow-actions">
        <label className="flow-input">
          수량 항목 검색
          <input
            aria-label="수량 항목 검색"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="객체·도면·파일 이름 또는 입력 근거"
          />
        </label>
        <label className="flow-input">
          수량 연결 상태
          <select
            aria-label="수량 연결 상태"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">전체 ({rows.length})</option>
            <option value="missing">
              미연결 ({rows.filter((item) => !item.row).length})
            </option>
            <option value="stale">
              재확인 필요 ({rows.filter((item) => item.row?.stale).length})
            </option>
            <option value="current">연결됨 · 미확정 ({current.length})</option>
          </select>
        </label>
        <button
          onClick={() => {
            setQuery("");
            setStatus("all");
          }}
        >
          검색·필터 초기화
        </button>
      </div>
      <p role="status">
        표시 {visible.length} / 전체 {rows.length}건 · 표시 항목 미확정 합계{" "}
        {number(
          visibleCurrent.reduce(
            (sum, item) => sum + (item.row?.amount ?? 0),
            0,
          ),
        )}
        원
      </p>
      {!rows.length && (
        <p>
          도면 객체가 없습니다. 작업실에서 객체를 만든 뒤 속성에서 수량 근거를
          연결하세요.
        </p>
      )}
      {rows.length > 0 && visible.length === 0 && (
        <p>
          조건에 맞는 항목이 없습니다. 검색·필터를 초기화해 전체 항목을
          확인하세요.
        </p>
      )}
      {visible.map(({ document, shape, row }) => (
        <article className="flow-card" key={`${document.id}:${shape.id}`}>
          <h3>{shape.label || "이름 없는 객체"}</h3>
          <p>
            {document.title} · R{document.revision ?? 1} ·{" "}
            {document.source?.name ?? "원본 미연결"} · {shape.page ?? 1}페이지
          </p>
          <p>
            {!row
              ? "수량 미연결"
              : row.stale
                ? "근거 변경 · 재확인 필요"
                : "입력 근거 연결됨 · 미확정"}
          </p>
          {row && (
            <>
              <p>
                원수량 {number(row.raw)} + 보정 {number(row.correction)} ={" "}
                {number(row.final)} {row.unit}
              </p>
              <p>
                단가 {number(row.rate)}원/{row.unit} · 금액 {number(row.amount)}
                원
              </p>
              <p>입력 근거: {row.reason}</p>
              <WorkflowMeasurementEvidence evidence={row.measurementSource}/>
              <p>
                단가 근거:{" "}
                {row.rateSource
                  ? `${row.rateSource.name} · ${row.rateSource.code} · v${row.rateSource.version} · ${row.rateSource.source} · 로컬 등록 단가`
                  : row.rateReference
                    ? `${documentDemoRates.find((item) => item.code === row.rateReference?.code)?.name} · ${row.rateReference.catalogVersion} · ${row.rateReference.code} · 임의 시연 금액`
                    : "직접 입력 단가"}
              </p>
            </>
          )}
          <button
            onClick={() => onOpen(document.id, shape.id, shape.page ?? 1)}
          >
            도면 근거 열기
          </button>
        </article>
      ))}
    </section>
  );
}
