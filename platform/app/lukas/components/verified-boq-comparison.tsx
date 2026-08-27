import { useState } from "react";

import type {
  VerifiedBoqCause,
  VerifiedBoqV1_1Comparison,
} from "../lib/verified-boq-comparison-v1-1.server.ts";

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

export function VerifiedBoqComparison({
  comparison,
}: {
  comparison: VerifiedBoqV1_1Comparison;
}) {
  const [filter, setFilter] = useState<VerifiedBoqCause | null>(null);
  const rows = filter
    ? comparison.rows.filter((row) =>
        row.causes.some((cause) => cause.cause === filter),
      )
    : comparison.rows;
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
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="pb-3">품목</th>
                  <th className="pb-3">행 상태</th>
                  <th className="pb-3">모든 원인</th>
                  <th className="pb-3">이전 금액</th>
                  <th className="pb-3">현재 금액</th>
                  <th className="pb-3">증감</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr className="border-b" key={row.itemCode}>
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
                        {!row.causes.length ? "없음" : null}
                      </div>
                    </td>
                    <td>{row.previousAmountKrw}원</td>
                    <td>{row.currentAmountKrw}원</td>
                    <td className="font-semibold">{row.amountDeltaKrw}원</td>
                  </tr>
                ))}
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
