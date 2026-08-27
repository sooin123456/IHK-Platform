import { Form, Link } from "react-router";

import { Button } from "~/core/components/ui/button";
import type { MaterialBoqLineageRow } from "~/lukas/lib/material-control.server";

type ApprovedBoqOption = {
  id: string;
  label: string;
  components: Array<{
    id: string;
    itemCode: string;
    resourceCode: string;
    resourceName: string;
    specification: string;
    unit: string;
    coefficient: string;
  }>;
};

export function MaterialBoqLineage({
  projectId,
  operationId,
  approvedBoqs,
  rows,
  nextCursor,
}: {
  projectId: string;
  operationId: string;
  approvedBoqs: ApprovedBoqOption[];
  rows: MaterialBoqLineageRow[];
  nextCursor: string | null;
}) {
  return (
    <section className="mt-8 rounded-2xl border bg-card p-6 shadow-sm">
      <p className="text-sm font-bold text-primary">승인 BOQ 자재 인계</p>
      <h2 className="mt-1 text-xl font-semibold">
        도면부터 현장·탄소 근거까지
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        승인된 내역의 재료 구성요소만 선택합니다. 설계수량은 최종수량×계수로
        확정하며 할증, 밀도, 체적, 탄소계수는 추정하지 않습니다.
      </p>

      <div className="mt-5 grid gap-4">
        {approvedBoqs.map((boq) => (
          <Form className="rounded-xl border p-4" key={boq.id} method="post">
            <input name="intent" type="hidden" value="boq_handoff" />
            <input name="version_id" type="hidden" value={boq.id} />
            <input name="operation_id" type="hidden" value={operationId} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <strong>{boq.label}</strong>
              <Button size="sm" type="submit">
                선택 자재계획 생성
              </Button>
            </div>
            <div className="mt-3 grid gap-2">
              {boq.components.map((component) => (
                <label
                  className="flex gap-3 rounded-lg bg-muted/40 p-3 text-sm"
                  key={component.id}
                >
                  <input
                    name="component_id"
                    type="checkbox"
                    value={component.id}
                  />
                  <span>
                    <b>{component.itemCode}</b> → {component.resourceCode} ·{" "}
                    {component.resourceName}
                    {component.specification
                      ? ` · ${component.specification}`
                      : ""}{" "}
                    · {component.unit} × {component.coefficient}
                  </span>
                </label>
              ))}
            </div>
          </Form>
        ))}
        {!approvedBoqs.length ? (
          <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            인계 가능한 승인 BOQ 1.1 재료 구성요소가 없습니다.
          </p>
        ) : null}
      </div>

      <div className="mt-7 grid gap-3">
        {rows.map((row) => {
          const factorIds = new Set(
            row.carbonFactors.map((factor) => factor.id),
          );
          const coveredTransactions = row.transactions.filter(
            (transaction) =>
              transaction.carbonFactorId &&
              factorIds.has(transaction.carbonFactorId),
          ).length;
          const complete =
            row.materialPlan.baselineFactorId !== null &&
            row.transactions.length === coveredTransactions;
          const coverage = complete
            ? "탄소 근거 완전"
            : row.carbonFactors.length
              ? "탄소 근거 부분"
              : "탄소 근거 없음";
          return (
            <article
              className="rounded-xl border p-4 text-sm"
              key={`${row.boqVersionId}:${row.rateComponentId}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>
                  {row.itemCode} → {row.materialPlan.materialCode} ·{" "}
                  {row.materialPlan.materialName}
                </strong>
                <span
                  className={
                    row.carbonFactors.length
                      ? "text-amber-700"
                      : "text-muted-foreground"
                  }
                >
                  {coverage}
                </span>
              </div>
              <p className="mt-2 text-muted-foreground">
                자재계획 {row.materialPlanId} · 설계 {row.derivedDesignQuantity}{" "}
                {row.materialPlan.unit}
              </p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                BOQ 결과 {row.boqResultSha256} · 승인 manifest 파일{" "}
                {row.manifestFileSha256}
              </p>
              <p className="mt-2">
                발주·입고·설치·반품·폐기·계산서 {row.transactions.length}건 ·
                탄소계수/파일 {row.carbonFactors.length}건
              </p>
              <Link
                className="mt-2 inline-block underline underline-offset-4"
                to={`/projects/${projectId}/verified-boq?version=${row.boqVersionId}`}
              >
                승인 BOQ 근거 열기
              </Link>
            </article>
          );
        })}
      </div>
      {nextCursor ? (
        <Link
          className="mt-4 inline-block text-sm underline underline-offset-4"
          to={`?lineageCursor=${encodeURIComponent(nextCursor)}`}
        >
          계보 다음 200건
        </Link>
      ) : null}
    </section>
  );
}
