import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";

import type { DrawingObjectQuantityLineageRow } from "../lib/drawing-quantity-lineage.server.ts";
import type { DrawingDocumentState } from "../lib/drawing-commands.ts";
import { geometryBounds } from "../lib/drawing-geometry.ts";
import {
  formatDrawingMeasurementForDisplay,
  measureDrawingObjectForCanvas,
} from "../lib/drawing-measurements.ts";
import type {
  DrawingMeasurementEvidenceLineage,
  DrawingServerMeasurementEvidence,
} from "../lib/drawing-semantic-schedules.ts";
import type {
  DrawingCanvas,
  DrawingObject,
} from "../lib/drawing-workspace.types.ts";
import { verifiedBoqComparisonRowHash } from "../lib/verified-boq-comparison-links.ts";

type Props = {
  canCreateQuantity: boolean;
  canvas?: DrawingCanvas | null;
  evidence?: DrawingServerMeasurementEvidence | null;
  hasUnconfirmedChanges: boolean;
  lineage?: DrawingMeasurementEvidenceLineage | null;
  object: DrawingObject;
  projectId: string;
  quantityLineage?: {
    rows: DrawingObjectQuantityLineageRow[];
    nextCursor: string | null;
  } | null;
  revisionStatus: string;
  state: Pick<DrawingDocumentState, "objects">;
};

const kindLabel = { length: "길이", area: "면적", count: "개수" } as const;
const boqStatusLabel: Record<
  DrawingObjectQuantityLineageRow["boqLinks"][number]["boqVersionStatus"],
  string
> = {
  draft: "작성 중",
  in_review: "검토 중",
  approved: "승인 완료",
  superseded: "이전 승인 개정",
};

export function DrawingQuantityInspector({
  canCreateQuantity,
  canvas,
  evidence,
  hasUnconfirmedChanges,
  lineage,
  object,
  projectId,
  quantityLineage,
  revisionStatus,
  state,
}: Props) {
  const navigation = useNavigation();
  const [stableIds] = useState(() => ({
    length: crypto.randomUUID(),
    area: crypto.randomUUID(),
    count: crypto.randomUUID(),
  }));
  let preview = null;
  let boundsText: string | null = null;
  try {
    preview = measureDrawingObjectForCanvas(object, canvas, state.objects);
    const bounds = geometryBounds(object.geometry, state.objects);
    const coordinate = (value: number) =>
      String(Object.is(value, -0) ? 0 : value);
    boundsText = `X ${coordinate(bounds.x)}–${coordinate(bounds.x + bounds.width)} · Y ${coordinate(bounds.y)}–${coordinate(bounds.y + bounds.height)}`;
  } catch {
    preview = null;
    boundsText = null;
  }
  const confirmed = evidence?.measurements[object.id];
  const current =
    Boolean(confirmed) &&
    !hasUnconfirmedChanges &&
    confirmed?.objectVersion === object.version &&
    confirmed.revisionId === lineage?.revisionId &&
    confirmed.snapshotSha256 === lineage?.snapshotSha256;
  const measurements = [
    {
      kind: "length" as const,
      preview: preview
        ? formatDrawingMeasurementForDisplay(preview, "meters")
        : null,
      confirmed: current
        ? formatDrawingMeasurementForDisplay(confirmed.measurement, "meters")
        : null,
    },
    {
      kind: "area" as const,
      preview: preview
        ? formatDrawingMeasurementForDisplay(preview, "squareMeters")
        : null,
      confirmed: current
        ? formatDrawingMeasurementForDisplay(
            confirmed.measurement,
            "squareMeters",
          )
        : null,
    },
    {
      kind: "count" as const,
      preview: preview
        ? formatDrawingMeasurementForDisplay(preview, "count")
        : null,
      confirmed: current
        ? formatDrawingMeasurementForDisplay(confirmed.measurement, "count")
        : null,
    },
  ].filter((row) => row.preview !== null || row.confirmed !== null);
  const persisted = (quantityLineage?.rows ?? []).filter(
    (row) => row.quantity.drawingObjectId === object.id,
  );
  const approved = ["approved", "superseded"].includes(revisionStatus);

  return (
    <section
      aria-labelledby="drawing-quantity-title"
      className="mt-6 border-t border-slate-200 pt-4"
    >
      <h3 className="text-sm font-bold" id="drawing-quantity-title">
        도면 수량 계보
      </h3>
      <p className="mt-2 text-xs text-slate-600">
        승인 스냅샷 {lineage?.snapshotSha256.slice(0, 12) ?? "없음"} ·{" "}
        {object.name} · {object.geometry.type} · 객체 V{object.version}
      </p>
      <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
        객체 {object.id}
      </p>
      {boundsText ? (
        <p
          aria-label="선택 객체 경계"
          className="mt-1 font-mono text-[10px] text-slate-600"
        >
          {boundsText}
        </p>
      ) : null}

      {measurements.length ? (
        <ul className="mt-3 grid gap-2">
          {measurements.map((row) => (
            <li
              aria-label={`${kindLabel[row.kind]} 수량`}
              className="rounded border border-slate-200 p-2 text-xs"
              key={row.kind}
            >
              <p className="font-semibold text-slate-900">
                {kindLabel[row.kind]}
              </p>
              <p className="mt-1 text-slate-600">
                미리보기 · {row.preview ?? "계산 불가"}
              </p>
              <p className="mt-1 text-emerald-700">
                서버 측정 · {row.confirmed ?? "현재 확정값 없음"}
              </p>
              {approved &&
              canCreateQuantity &&
              row.confirmed &&
              !persisted.some(
                (entry) => entry.quantity.measurementKind === row.kind,
              ) ? (
                <Form className="mt-2" method="post">
                  <input
                    name="intent"
                    type="hidden"
                    value="create_drawing_quantity_link"
                  />
                  <input
                    name="link_id"
                    type="hidden"
                    value={stableIds[row.kind]}
                  />
                  <input
                    name="revision_id"
                    type="hidden"
                    value={lineage?.revisionId}
                  />
                  <input name="object_id" type="hidden" value={object.id} />
                  <input
                    name="measurement_kind"
                    type="hidden"
                    value={row.kind}
                  />
                  <button
                    aria-label={`${kindLabel[row.kind]} 확정 근거 만들기`}
                    className="min-h-9 rounded border border-emerald-300 px-2 font-semibold text-emerald-700 disabled:cursor-wait disabled:opacity-50"
                    disabled={navigation.state !== "idle"}
                    type="submit"
                  >
                    확정 근거 만들기
                  </button>
                </Form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-slate-600">
          사용 가능한 길이·면적·개수 측정이 없습니다.
        </p>
      )}

      {persisted.length ? (
        <ul className="mt-3 grid gap-2">
          {persisted.map((row) => (
            <li
              className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs"
              key={row.quantity.id}
            >
              <p className="font-semibold text-emerald-800">
                확정 근거 · {kindLabel[row.quantity.measurementKind]}{" "}
                {row.quantity.rawQuantity} {row.quantity.unit}
              </p>
              <p className="mt-1 break-all font-mono text-[10px] text-slate-600">
                {row.quantity.drawingSnapshotSha256.slice(0, 12)} · 계보{" "}
                {row.quantity.drawingObjectLineageId} · V
                {row.quantity.drawingObjectVersion}
              </p>
              {row.boqLinks.length ? (
                <ul className="mt-2 grid gap-1">
                  {row.boqLinks.map((link) => {
                    const progress = link.materialProgress ?? {
                      handoff: link.hasMaterialLineage,
                      purchaseOrder: false,
                      goodsReceipt: false,
                      siteActivity: false,
                      carbonEvidence: false,
                    };
                    const stages = [
                      ["자재 인계", progress.handoff],
                      ["발주", progress.purchaseOrder],
                      ["입고", progress.goodsReceipt],
                      ["시공·폐기", progress.siteActivity],
                      ["탄소 근거", progress.carbonEvidence],
                    ] as const;
                    return (
                      <li key={link.id}>
                        <article
                          aria-label={`객체 업무 계보 레코드 ${link.itemCode}`}
                          className="rounded border border-slate-200 bg-white p-2"
                        >
                          <p className="font-semibold text-slate-900">
                            객체 업무 계보 레코드
                          </p>
                          <p className="mt-1 text-[10px] leading-4 text-slate-600">
                            객체 → 승인 스냅샷 → 확정 수량 → BOQ·금액 → 자재
                            인계
                            {link.hasMaterialLineage ? "" : "(대기)"}
                          </p>
                          <dl className="mt-2 grid gap-1 text-[10px] text-slate-700">
                            <div>
                              <dt className="inline font-semibold text-slate-600">
                                객체 ·{" "}
                              </dt>
                              <dd className="inline break-all">
                                {row.quantity.drawingObjectLineageId} · V
                                {row.quantity.drawingObjectVersion}
                              </dd>
                            </div>
                            <div>
                              <dt className="inline font-semibold text-slate-600">
                                승인 스냅샷 ·{" "}
                              </dt>
                              <dd className="inline font-mono">
                                {row.quantity.drawingSnapshotSha256.slice(
                                  0,
                                  12,
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt className="inline font-semibold text-slate-600">
                                확정 수량 ·{" "}
                              </dt>
                              <dd className="inline">
                                {kindLabel[row.quantity.measurementKind]}{" "}
                                {row.quantity.rawQuantity} {row.quantity.unit}
                              </dd>
                            </div>
                            <div>
                              <dt className="inline font-semibold text-slate-600">
                                BOQ·금액 ·{" "}
                              </dt>
                              <dd className="inline">
                                {boqStatusLabel[link.boqVersionStatus]} ·{" "}
                                {link.itemCode} · 배분 {link.allocationFactor}
                              </dd>
                            </div>
                            <div>
                              <dt className="inline font-semibold text-slate-600">
                                자재 인계 ·{" "}
                              </dt>
                              <dd className="inline">
                                {progress.handoff ? "연결됨" : "대기"}
                              </dd>
                            </div>
                            <div>
                              <dt className="font-semibold text-slate-600">
                                자재 이후 진행
                              </dt>
                              <dd>
                                <ul
                                  aria-label={`자재 이후 진행 ${link.itemCode}`}
                                  className="mt-1 grid grid-cols-2 gap-1"
                                >
                                  {stages.map(([label, linked]) => (
                                    <li
                                      className={
                                        linked
                                          ? "text-emerald-700"
                                          : "text-slate-500"
                                      }
                                      data-material-progress-state={
                                        linked ? "linked" : "empty"
                                      }
                                      data-material-progress-step={label}
                                      key={label}
                                    >
                                      {label} · {linked ? "연결됨" : "대기"}
                                    </li>
                                  ))}
                                </ul>
                              </dd>
                            </div>
                          </dl>
                          <Link
                            className="mt-2 flex min-h-9 items-center font-semibold text-indigo-700 underline"
                            to={`/projects/${projectId}/boq?version=${link.boqVersionId}&line=${link.boqLineId}`}
                          >
                            BOQ {link.itemCode} · 배분 {link.allocationFactor}
                          </Link>
                          <Link
                            className="mt-1 flex min-h-9 items-center font-semibold text-violet-700 underline"
                            to={`/projects/${projectId}/boq?version=${link.boqVersionId}&line=${link.boqLineId}${verifiedBoqComparisonRowHash(link.itemCode)}`}
                          >
                            BOQ 수량·금액 상세 보기 · 비교 가능 시 변경 원인
                          </Link>
                          {link.hasMaterialLineage ? (
                            <Link
                              className="mt-1 flex min-h-9 items-center font-semibold text-cyan-700 underline"
                              to={`/projects/${projectId}/materials?version=${link.boqVersionId}&boqLineId=${link.boqLineId}`}
                            >
                              자재 인계 및 후속 기록 확인
                            </Link>
                          ) : (
                            <p className="mt-1 text-slate-600">
                              자재 계보 없음 · BOQ 행에서 자재 인계를
                              실행하세요.
                            </p>
                          )}
                        </article>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Link
                  className="mt-2 inline-block font-semibold text-indigo-700 underline"
                  to={`/projects/${projectId}/boq`}
                >
                  BOQ 매핑 열기
                </Link>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-slate-600">
          {approved
            ? "아직 연결된 확정 근거가 없습니다."
            : "승인된 도면에서 확정 근거를 만든 뒤 BOQ 내역에 연결할 수 있습니다."}
        </p>
      )}
    </section>
  );
}
