import { Form, Link } from "react-router";

import type { DrawingEstimateSummary } from "~/lukas/lib/drawing-estimate";
import type { DrawingWorkspaceCapability } from "~/lukas/lib/drawing-workspace.server";

type EstimateOption = {
  id: string;
  title: string;
  versionNo: number;
  priceBookName: string;
};

type Props = {
  capability: DrawingWorkspaceCapability;
  drawingRevisionId: string;
  estimateOptions: EstimateOption[];
  projectId: string;
  summary: DrawingEstimateSummary;
  workspaceId: string;
};

const money = new Intl.NumberFormat("ko-KR");

function moneyText(value: string | null) {
  if (value === null || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value))
    return "—";
  const negative = value.startsWith("-");
  const [integer, fraction] = (negative ? value.slice(1) : value).split(".");
  return `${negative ? "-" : ""}${money.format(BigInt(integer))}${fraction ? `.${fraction}` : ""}원`;
}

const rowState = {
  draft: "초안",
  assumption: "가정값",
  needs_review: "검토 필요",
  missing_evidence: "근거 누락",
  confirmed: "확정",
} as const;

function boqHref(
  projectId: string,
  workspaceId: string,
  versionId?: string,
  download?: "csv" | "xlsx" | "manifest",
) {
  const query = new URLSearchParams({
    returnTo: `/projects/${projectId}/workspaces/${workspaceId}`,
  });
  if (versionId) query.set("version", versionId);
  if (download) query.set("download", download);
  return `/projects/${projectId}/boq?${query}`;
}

export function DrawingEstimateResultRail({
  capability,
  drawingRevisionId,
  estimateOptions,
  projectId,
  summary,
  workspaceId,
}: Props) {
  const mayBind = capability === "admin" || capability === "editor";
  const evidenceGapCount = summary.rows.filter(
    (row) => row.state === "missing_evidence",
  ).length;
  const approved =
    summary.boq &&
    (summary.boq.status === "approved" || summary.boq.status === "superseded");

  return (
    <section aria-label="견적 결과" className="space-y-3 text-xs">
      <header className="rounded-lg border border-white/15 bg-slate-950/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold text-white">견적 결과</h2>
          <span className="rounded-full border border-white/15 px-2 py-1 font-bold text-slate-200">
            {summary.status === "confirmed" ? "확정" : "초안"}
          </span>
        </div>
        <p
          aria-label="총 예상 금액"
          className="mt-3 text-xl font-bold text-white"
        >
          {moneyText(summary.directCostKrw)}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-1 text-center text-[10px]">
          <span aria-label={`단가 누락 ${summary.missingRateCount}건`}>
            단가 {summary.missingRateCount}
          </span>
          <span aria-label={`근거 누락 ${evidenceGapCount}건`}>
            근거 {evidenceGapCount}
          </span>
          <span aria-label={`검토 필요 ${summary.reviewCount}건`}>
            검토 {summary.reviewCount}
          </span>
        </div>
      </header>

      {summary.status === "unbound" && mayBind ? (
        estimateOptions.length ? (
          <Form
            className="grid gap-2 rounded-lg border border-white/15 p-3"
            method="post"
          >
            <input name="intent" type="hidden" value="bind_drawing_estimate" />
            <input
              name="drawing_revision_id"
              type="hidden"
              value={drawingRevisionId}
            />
            <label
              className="font-bold text-white"
              htmlFor="estimate-boq-version"
            >
              연결할 내역 버전
            </label>
            <select
              className="min-h-10 rounded border border-white/20 bg-slate-950 px-2 text-white"
              id="estimate-boq-version"
              name="boq_version_id"
              required
            >
              <option value="">연결할 초안 선택</option>
              {estimateOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  V{option.versionNo} {option.title} · {option.priceBookName}
                </option>
              ))}
            </select>
            <button
              className="min-h-10 rounded bg-indigo-500 px-3 font-bold text-white"
              type="submit"
            >
              내역 연결
            </button>
          </Form>
        ) : (
          <p className="rounded-lg border border-white/15 p-3 text-slate-300">
            연결할 수 있는 미연결 초안 BOQ가 없습니다.
          </p>
        )
      ) : null}

      <ul aria-label="견적 항목" className="space-y-2">
        {summary.rows.map((row) => (
          <li
            className="rounded-lg border border-white/15 bg-slate-950/60 p-3"
            key={`${row.itemCode}:${row.subjectRefs.map(({ kind, id }) => `${kind}:${id}`).join(",")}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold text-white">
                  {row.classification ?? "미분류"} · {row.itemName}
                </p>
                <p className="mt-1 font-mono text-[10px] text-slate-400">
                  {row.itemCode}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-white/15 px-2 py-1 font-bold text-slate-200">
                {rowState[row.state]}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2">
              <div>
                <dt className="text-slate-400">수량</dt>
                <dd className="mt-1 text-white">
                  {row.quantity ?? "—"} {row.unit}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">단가</dt>
                <dd className="mt-1 text-white">
                  {moneyText(row.totalUnitRateKrw)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">금액</dt>
                <dd className="mt-1 font-bold text-white">
                  {moneyText(row.amountKrw)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-slate-300">
              근거{" "}
              {row.evidence.length > 0 ? `${row.evidence.length}건` : "없음"}
            </p>
            {row.reason ? (
              <p className="mt-1 text-amber-200">{row.reason}</p>
            ) : null}
          </li>
        ))}
      </ul>

      <nav aria-label="견적 이동" className="grid gap-2">
        <Link
          className="min-h-10 rounded border border-white/20 px-3 py-2 text-center font-bold text-white"
          to={boqHref(projectId, workspaceId)}
        >
          단가표 가져오기
        </Link>
        <Link
          aria-label="BOQ 상세 열기"
          className="min-h-10 rounded border border-white/20 px-3 py-2 text-center font-bold text-white"
          to={boqHref(projectId, workspaceId, summary.boq?.id)}
        >
          BOQ 상세 열기
        </Link>
        {approved ? (
          <div className="grid grid-cols-3 gap-2">
            {(["csv", "xlsx", "manifest"] as const).map((format) => (
              <a
                className="rounded border border-white/20 px-2 py-2 text-center uppercase text-white"
                href={boqHref(projectId, workspaceId, summary.boq!.id, format)}
                key={format}
              >
                {format}
              </a>
            ))}
          </div>
        ) : null}
      </nav>
    </section>
  );
}
