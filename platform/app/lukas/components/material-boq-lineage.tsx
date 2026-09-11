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

const transactionLabels: Record<
  MaterialBoqLineageRow["transactions"][number]["transactionType"],
  string
> = {
  purchase_order: "발주",
  goods_receipt: "입고",
  invoice_evidence: "계산서",
  installation: "설치",
  return_to_supplier: "반품",
  waste_disposal: "폐기",
};

const carbonSourceLabels: Record<
  MaterialBoqLineageRow["carbonFactors"][number]["sourceType"],
  string
> = {
  product_epd: "제품 EPD",
  industry_average: "산업 평균",
  generic: "일반 계수",
};

export function MaterialBoqLineage({
  projectId,
  operationId,
  approvedBoqs,
  rows,
  nextCursor,
  materialPlanId,
  transactionId,
  carbonFactorId,
  boqLineId,
  selectedBoqVersionId,
  canHandoff,
}: {
  projectId: string;
  operationId: string;
  approvedBoqs: ApprovedBoqOption[];
  rows: MaterialBoqLineageRow[];
  nextCursor: string | null;
  materialPlanId?: string;
  transactionId?: string;
  carbonFactorId?: string;
  boqLineId?: string;
  selectedBoqVersionId?: string | null;
  canHandoff: boolean;
}) {
  const lineageHref = (input: {
    cursor?: string;
    materialPlanId?: string;
    transactionId?: string;
    carbonFactorId?: string;
    boqLineId?: string;
    boqVersionId?: string;
  }) => {
    const search = new URLSearchParams();
    if (input.cursor) search.set("lineageCursor", input.cursor);
    if (input.materialPlanId)
      search.set("materialPlanId", input.materialPlanId);
    if (input.transactionId) search.set("transactionId", input.transactionId);
    if (input.carbonFactorId)
      search.set("carbonFactorId", input.carbonFactorId);
    if (input.boqLineId) search.set("boqLineId", input.boqLineId);
    const versionId = input.boqVersionId ?? selectedBoqVersionId;
    if (versionId) search.set("version", versionId);
    return `?${search.toString()}`;
  };
  return (
    <section className="mt-8 rounded-2xl border bg-card p-6 shadow-sm">
      <p className="text-sm font-bold text-primary">
        {canHandoff ? "승인 BOQ 자재 인계" : "승인 BOQ 자재 계보"}
      </p>
      <h2 className="mt-1 text-xl font-semibold">
        도면부터 현장·탄소 근거까지
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {canHandoff
          ? "승인된 내역의 재료 구성요소만 선택합니다. 설계수량은 최종수량×계수로 확정하며 할증, 밀도, 체적, 탄소계수는 추정하지 않습니다."
          : "승인 BOQ에서 현장 거래와 탄소 근거까지 이어지는 읽기 전용 계보입니다."}
      </p>

      {canHandoff ? (
        <div className="mt-5 grid gap-4">
          {approvedBoqs.map((boq) => (
            <Form className="rounded-xl border p-4" key={boq.id} method="post">
              <input name="intent" type="hidden" value="boq_handoff" />
              <input name="version_id" type="hidden" value={boq.id} />
              <input name="operation_id" type="hidden" value={operationId} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <strong>{boq.label}</strong>
                  {boq.id === selectedBoqVersionId ? (
                    <span className="ml-2 rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                      선택한 승인 BOQ
                    </span>
                  ) : null}
                </div>
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
      ) : null}

      <div className="mt-7 grid gap-3">
        {rows.map((row) => {
          const coverage = {
            complete: "탄소 근거 완전",
            partial: "탄소 근거 부분",
            missing: "탄소 근거 없음",
          }[row.carbonCoverage];
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
              <p className="mt-1 flex flex-wrap gap-3 text-xs">
                <Link
                  className="underline underline-offset-4"
                  to={lineageHref({ materialPlanId: row.materialPlanId })}
                >
                  이 자재계획 계보만 보기
                </Link>
                <Link
                  className="underline underline-offset-4"
                  to={lineageHref({
                    boqLineId: row.boqLineId,
                    boqVersionId: row.boqVersionId,
                  })}
                >
                  이 BOQ 행 계보만 보기
                </Link>
              </p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                BOQ 결과 {row.boqResultSha256} · 승인 manifest 파일{" "}
                {row.manifestFileId} · SHA {row.manifestFileSha256}
              </p>
              <div className="mt-3 grid gap-2">
                {row.transactions.map((transaction) => (
                  <div
                    className="rounded-lg bg-muted/40 p-3"
                    data-material-transaction-id={transaction.id}
                    key={transaction.id}
                  >
                    <b>{transactionLabels[transaction.transactionType]}</b> ·{" "}
                    {transaction.documentNumber} · {transaction.supplierName} ·{" "}
                    {transaction.quantity} {row.materialPlan.unit}
                    {transaction.relatedOrderId ? (
                      <span className="block break-all text-xs text-muted-foreground">
                        연결 발주 {transaction.relatedOrderId}
                      </span>
                    ) : null}
                    {transaction.evidenceSha256 ? (
                      <span className="block break-all text-xs text-muted-foreground">
                        거래 증빙 SHA {transaction.evidenceSha256}
                      </span>
                    ) : null}
                    {transaction.carbonFactorId ? (
                      <span className="block break-all text-xs text-muted-foreground">
                        탄소계수 {transaction.carbonFactorId}
                      </span>
                    ) : null}
                    <Link
                      className="mt-1 block text-xs underline underline-offset-4"
                      to={lineageHref({ transactionId: transaction.id })}
                    >
                      이 거래 계보만 보기
                    </Link>
                  </div>
                ))}
                {!row.transactions.length ? (
                  <p className="text-muted-foreground">
                    발주·입고·설치·반품·폐기·계산서 기록 없음
                  </p>
                ) : null}
              </div>
              <div className="mt-3 grid gap-2">
                {row.carbonFactors.map((factor) => (
                  <div
                    className="rounded-lg border border-dashed p-3"
                    key={factor.id}
                  >
                    <b>{factor.productName}</b> ·{" "}
                    {carbonSourceLabels[factor.sourceType]} ·{" "}
                    {factor.gwpA1A3PerUnit} kgCO₂e/{factor.declaredUnit}
                    <span className="block break-all text-xs text-muted-foreground">
                      탄소계수 ID {factor.id} · 표준 {factor.standard} ·
                      유효기한 {factor.validUntil ?? "제한 없음"} · 원본 SHA{" "}
                      {factor.sourceSha256}
                    </span>
                    <Link
                      className="mt-1 block text-xs underline underline-offset-4"
                      to={lineageHref({ carbonFactorId: factor.id })}
                    >
                      이 탄소계수 계보만 보기
                    </Link>
                  </div>
                ))}
              </div>
              <Link
                className="mt-2 inline-block underline underline-offset-4"
                to={`/projects/${projectId}/boq?version=${row.boqVersionId}&line=${row.boqLineId}`}
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
          to={lineageHref({
            cursor: nextCursor,
            materialPlanId,
            transactionId,
            carbonFactorId,
            boqLineId,
          })}
        >
          계보 다음 200건
        </Link>
      ) : null}
    </section>
  );
}
