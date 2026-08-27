import { useState } from "react";
import { Form, Link } from "react-router";

import type { DrawingObjectQuantityLineageRow } from "../lib/drawing-quantity-lineage.server.ts";
import type { DrawingDocumentState } from "../lib/drawing-commands.ts";
import {
  formatDrawingMeasurement,
  measureDrawingObject,
} from "../lib/drawing-measurements.ts";
import type {
  DrawingMeasurementEvidenceLineage,
  DrawingServerMeasurementEvidence,
} from "../lib/drawing-semantic-schedules.ts";
import type {
  DrawingObject,
  DrawingSemanticGeometry,
} from "../lib/drawing-workspace.types.ts";

type Props = {
  canCreateQuantity: boolean;
  evidence?: DrawingServerMeasurementEvidence | null;
  hasUnconfirmedChanges: boolean;
  lineage?: DrawingMeasurementEvidenceLineage | null;
  object: DrawingObject & { geometry: DrawingSemanticGeometry };
  projectId: string;
  quantityLineage?: {
    rows: DrawingObjectQuantityLineageRow[];
    nextCursor: string | null;
  } | null;
  revisionStatus: string;
  state: Pick<DrawingDocumentState, "objects">;
};

const kindLabel = { length: "길이", area: "면적", count: "개수" } as const;

export function DrawingQuantityInspector({
  canCreateQuantity,
  evidence,
  hasUnconfirmedChanges,
  lineage,
  object,
  projectId,
  quantityLineage,
  revisionStatus,
  state,
}: Props) {
  const [stableIds] = useState(() => ({
    length: crypto.randomUUID(),
    area: crypto.randomUUID(),
    count: crypto.randomUUID(),
  }));
  let preview = null;
  try {
    preview = measureDrawingObject(object, state.objects);
  } catch {
    preview = null;
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
      preview: preview ? formatDrawingMeasurement(preview, "meters") : null,
      confirmed: current
        ? formatDrawingMeasurement(confirmed.measurement, "meters")
        : null,
    },
    {
      kind: "area" as const,
      preview: preview
        ? formatDrawingMeasurement(preview, "squareMeters")
        : null,
      confirmed: current
        ? formatDrawingMeasurement(confirmed.measurement, "squareMeters")
        : null,
    },
    {
      kind: "count" as const,
      preview: preview ? formatDrawingMeasurement(preview, "count") : null,
      confirmed: current
        ? formatDrawingMeasurement(confirmed.measurement, "count")
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
      className="mt-6 border-t border-white/10 pt-4"
    >
      <h3 className="text-sm font-bold" id="drawing-quantity-title">
        도면 수량 계보
      </h3>
      <p className="mt-2 text-xs text-slate-400">
        승인 스냅샷 {lineage?.snapshotSha256.slice(0, 12) ?? "없음"} ·{" "}
        {object.name} · {object.geometry.type} · 객체 V{object.version}
      </p>
      <p className="mt-1 break-all font-mono text-[10px] text-slate-500">
        객체 {object.id}
      </p>

      {measurements.length ? (
        <ul className="mt-3 grid gap-2">
          {measurements.map((row) => (
            <li
              className="rounded border border-white/10 p-2 text-xs"
              key={row.kind}
            >
              <p className="font-semibold text-slate-200">
                {kindLabel[row.kind]}
              </p>
              <p className="mt-1 text-slate-400">
                미리보기 · {row.preview ?? "계산 불가"}
              </p>
              <p className="mt-1 text-emerald-300">
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
                    className="min-h-9 rounded border border-emerald-400/40 px-2 font-semibold text-emerald-200"
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
        <p className="mt-3 text-xs text-slate-400">
          사용 가능한 길이·면적·개수 측정이 없습니다.
        </p>
      )}

      {persisted.length ? (
        <ul className="mt-3 grid gap-2">
          {persisted.map((row) => (
            <li
              className="rounded border border-emerald-400/30 bg-emerald-950/20 p-2 text-xs"
              key={row.quantity.id}
            >
              <p className="font-semibold text-emerald-200">
                확정 근거 · {kindLabel[row.quantity.measurementKind]}{" "}
                {row.quantity.rawQuantity} {row.quantity.unit}
              </p>
              <p className="mt-1 break-all font-mono text-[10px] text-slate-400">
                {row.quantity.drawingSnapshotSha256.slice(0, 12)} · 계보{" "}
                {row.quantity.drawingObjectLineageId} · V
                {row.quantity.drawingObjectVersion}
              </p>
              {row.boqLinks.length ? (
                <ul className="mt-2 grid gap-1">
                  {row.boqLinks.map((link) => (
                    <li key={link.id}>
                      <Link
                        className="font-semibold text-indigo-300 underline"
                        to={`/projects/${projectId}/boq?version=${link.boqVersionId}`}
                      >
                        BOQ {link.itemCode} · 배분 {link.allocationFactor}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <Link
                  className="mt-2 inline-block font-semibold text-indigo-300 underline"
                  to={`/projects/${projectId}/boq`}
                >
                  BOQ 매핑 열기
                </Link>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
