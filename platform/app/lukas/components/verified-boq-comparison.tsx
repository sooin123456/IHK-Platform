import { useEffect, useRef, useState } from "react";

import type {
  VerifiedBoqCause,
  VerifiedBoqV1_1Comparison,
} from "../lib/verified-boq-comparison-v1-1.server.ts";
import {
  verifiedBoqComparisonRowHash,
  verifiedBoqComparisonRowId,
} from "../lib/verified-boq-comparison-links.ts";

const causes: Array<{ id: VerifiedBoqCause; label: string }> = [
  { id: "RAW", label: "원수량" },
  { id: "MAPPING", label: "연결·배분" },
  { id: "ADJUSTMENT", label: "보정" },
  { id: "PRICE", label: "단가" },
  { id: "FORMULA", label: "계산 규칙" },
];

const rowStateLabel = {
  added: "추가",
  removed: "제거",
  changed: "변경",
  unchanged: "동일",
} as const;

function quantityText(value: string | null, unit: string, absent = false) {
  return value === null ? (absent ? "없음" : "검토 필요") : `${value} ${unit}`;
}

export function focusVerifiedBoqComparisonRow(
  row: Pick<HTMLTableRowElement, "focus"> | null,
  locationHash: string,
  itemCode: string,
) {
  if (!row || locationHash !== verifiedBoqComparisonRowHash(itemCode))
    return false;
  row.focus();
  return true;
}

export function VerifiedBoqComparison({
  comparison,
  focusedItemCode = null,
  focusedLocationHash = "",
}: {
  comparison: VerifiedBoqV1_1Comparison;
  focusedItemCode?: string | null;
  focusedLocationHash?: string;
}) {
  const [filter, setFilter] = useState<VerifiedBoqCause | null>(null);
  const rows = filter
    ? comparison.rows.filter((row) =>
        row.causes.some((cause) => cause.cause === filter),
      )
    : comparison.rows;
  const focusedRowRef = useRef<HTMLTableRowElement>(null);
  const focusedRowRendered = Boolean(
    focusedItemCode && rows.some((row) => row.itemCode === focusedItemCode),
  );
  useEffect(() => {
    if (!focusedItemCode || !focusedRowRendered) return;
    focusVerifiedBoqComparisonRow(
      focusedRowRef.current,
      focusedLocationHash,
      focusedItemCode,
    );
  }, [focusedItemCode, focusedLocationHash, focusedRowRendered]);
  return (
    <section
      aria-labelledby="verified-boq-comparison-title"
      className="mt-5 rounded-2xl border bg-card p-5"
    >
      <h2 className="font-semibold" id="verified-boq-comparison-title">
        이전 승인 버전과 5원인 변경 비교
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{comparison.message}</p>
      {comparison.status === "review" ? (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          자동 설명을 표시하지 않습니다. 승인 입력과 계산 엔진을 직접
          검토하세요.
        </p>
      ) : (
        <>
          <div
            aria-label="변경 원인 필터"
            className="mt-4 flex flex-wrap gap-2"
          >
            <button
              aria-pressed={filter === null}
              className="rounded-full border px-3 py-1 text-xs font-semibold"
              onClick={() => setFilter(null)}
              type="button"
            >
              전체
            </button>
            {causes.map((cause) => (
              <button
                aria-pressed={filter === cause.id}
                className="rounded-full border px-3 py-1 text-xs font-semibold"
                key={cause.id}
                onClick={() => setFilter(cause.id)}
                type="button"
              >
                {cause.id} · {cause.label}
              </button>
            ))}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="pb-3">품목</th>
                  <th className="pb-3">행 상태</th>
                  <th className="pb-3">원인별 증감</th>
                  <th className="pb-3">원수량</th>
                  <th className="pb-3">최종수량</th>
                  <th className="pb-3">금액</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const linked = row.itemCode === focusedItemCode;
                  return (
                    <tr
                      className={`border-b ${linked ? "target:bg-indigo-50 target:outline target:outline-2 target:outline-indigo-500 dark:target:bg-indigo-950 dark:target:outline-indigo-300" : ""}`}
                      data-linked-item={linked || undefined}
                      id={verifiedBoqComparisonRowId(row.itemCode)}
                      key={row.itemCode}
                      ref={linked ? focusedRowRef : undefined}
                      tabIndex={-1}
                    >
                      <td className="py-3 font-semibold">{row.itemCode}</td>
                      <td>{rowStateLabel[row.rowState]}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {row.causes.map((cause) => (
                            <span
                              className="rounded bg-muted px-2 py-1 text-xs"
                              key={cause.cause}
                            >
                              {cause.cause} {cause.amountDeltaKrw}원
                            </span>
                          ))}
                          {row.quantityCauses.map((quantity) => (
                            <span
                              className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-900"
                              key={`${quantity.cause}-quantity`}
                            >
                              {quantity.cause} 수량 · 원수량{" "}
                              {quantity.rawQuantityDelta === null
                                ? "검토"
                                : `${quantity.rawQuantityDelta} ${quantity.unit}`}
                              {" · 최종 "}
                              {quantity.finalQuantityDelta === null
                                ? "검토"
                                : `${quantity.finalQuantityDelta} ${quantity.unit}`}
                            </span>
                          ))}
                          {!row.causes.length ? "없음" : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-xs leading-5">
                        <div>
                          이전 원수량 ·{" "}
                          {quantityText(
                            row.previousRawQuantity,
                            row.unit,
                            row.rowState === "added",
                          )}
                        </div>
                        <div>
                          현재 원수량 ·{" "}
                          {quantityText(
                            row.currentRawQuantity,
                            row.unit,
                            row.rowState === "removed",
                          )}
                        </div>
                        <div className="font-semibold">
                          원수량 증감 ·{" "}
                          {quantityText(row.rawQuantityDelta, row.unit)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-xs leading-5">
                        <div>
                          이전 최종수량 ·{" "}
                          {quantityText(
                            row.previousFinalQuantity,
                            row.unit,
                            row.rowState === "added",
                          )}
                        </div>
                        <div>
                          현재 최종수량 ·{" "}
                          {quantityText(
                            row.currentFinalQuantity,
                            row.unit,
                            row.rowState === "removed",
                          )}
                        </div>
                        <div className="font-semibold">
                          최종수량 증감 ·{" "}
                          {quantityText(row.finalQuantityDelta, row.unit)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap text-xs leading-5">
                        <div>이전 · {row.previousAmountKrw}원</div>
                        <div>현재 · {row.currentAmountKrw}원</div>
                        <div className="font-semibold">
                          증감 · {row.amountDeltaKrw}원
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt>전체 증감</dt>
              <dd>{comparison.amountDeltaKrw}원</dd>
            </div>
            <div>
              <dt>원인 합계</dt>
              <dd>{comparison.causeAmountDeltaKrw}원</dd>
            </div>
            <div>
              <dt>행 합계</dt>
              <dd>{comparison.rowAmountDeltaKrw}원</dd>
            </div>
            <div>
              <dt>정합성</dt>
              <dd>{comparison.amountCloses ? "일치" : "불일치"}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
