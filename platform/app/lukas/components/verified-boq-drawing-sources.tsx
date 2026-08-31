import { useState } from "react";
import { Form, Link } from "react-router";

import type { VerifiedBoqDrawingSourceRow } from "../lib/drawing-quantity-lineage.server.ts";

type LineOption = {
  id: string;
  itemCode: string;
  itemName: string;
  unit: string;
};

type Props = {
  boqVersionId: string;
  editable: boolean;
  lines: LineOption[];
  rows: Array<
    VerifiedBoqDrawingSourceRow & {
      links: Array<
        VerifiedBoqDrawingSourceRow["links"][number] & {
          workspaceHref?: string | null;
        }
      >;
    }
  >;
};

const inputClass = "h-10 rounded-md border bg-background px-3 text-sm";

function SourceCard({
  boqVersionId,
  editable,
  lines,
  row,
}: Omit<Props, "rows"> & { row: Props["rows"][number] }) {
  const [operationId] = useState(() => crypto.randomUUID());
  const compatibleLines = lines.filter(
    (line) => line.unit === row.quantity.unit,
  );
  return (
    <li className="rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            확정 근거 · {row.quantity.measurementKind}{" "}
            {row.quantity.rawQuantity} {row.quantity.unit}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
            객체 {row.quantity.drawingObjectId} · 계보{" "}
            {row.quantity.drawingObjectLineageId}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            승인 개정 V{row.quantity.drawingRevisionVersion} · 객체 V
            {row.quantity.drawingObjectVersion} ·{" "}
            {row.quantity.measurementRuleVersion}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
            스냅샷 {row.quantity.drawingSnapshotSha256}
          </p>
        </div>
        <p className="rounded-full bg-muted px-3 py-1 text-xs font-semibold">
          배분 합계 {row.allocationTotal}
        </p>
      </div>

      {row.links.length ? (
        <ul className="mt-3 grid gap-2">
          {row.links.map((link) => {
            const line = lines.find(
              (candidate) => candidate.id === link.boqLineId,
            );
            return (
              <li className="rounded-lg bg-muted p-3 text-sm" key={link.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {line?.itemCode ?? "품목"} {line?.itemName ?? ""} · 배분{" "}
                    {link.allocationFactor} · OCC V{link.version}
                  </span>
                  {link.workspaceHref || link.evidenceHrefs.length ? (
                    <span className="flex flex-wrap gap-2">
                      {link.workspaceHref ? (
                        <Link
                          className="font-semibold text-primary underline"
                          to={link.workspaceHref}
                        >
                          도면 작업실 열기
                        </Link>
                      ) : null}
                      {link.evidenceHrefs.map((evidence) => (
                        <Link
                          className="font-semibold text-primary underline"
                          key={`${link.id}:${evidence.sourceFileId}`}
                          to={evidence.href}
                        >
                          {evidence.sourceKind === "ifc_element"
                            ? "IFC 근거 열기"
                            : "PDF 근거 열기"}
                        </Link>
                      ))}
                    </span>
                  ) : null}
                </div>
                {editable ? (
                  <div className="mt-2 hidden gap-2 lg:flex">
                    <Form className="flex min-w-0 flex-1 gap-2" method="post">
                      <input
                        name="intent"
                        type="hidden"
                        value="drawing_boq_put"
                      />
                      <input name="id" type="hidden" value={link.id} />
                      <input
                        name="quantity_link_id"
                        type="hidden"
                        value={link.quantityLinkId}
                      />
                      <input
                        name="version_id"
                        type="hidden"
                        value={link.boqVersionId}
                      />
                      <input
                        name="line_id"
                        type="hidden"
                        value={link.boqLineId}
                      />
                      <input
                        name="base_version"
                        type="hidden"
                        value={link.version}
                      />
                      <input
                        aria-label={`${line?.itemCode ?? "품목"} Drawing 배분 계수`}
                        className={`${inputClass} min-w-0 flex-1`}
                        defaultValue={link.allocationFactor}
                        inputMode="decimal"
                        name="allocation_factor"
                      />
                      <button
                        className="rounded-md border px-3 font-semibold"
                        type="submit"
                      >
                        수정
                      </button>
                    </Form>
                    <Form method="post">
                      <input
                        name="intent"
                        type="hidden"
                        value="drawing_boq_delete"
                      />
                      <input name="id" type="hidden" value={link.id} />
                      <input
                        name="base_version"
                        type="hidden"
                        value={link.version}
                      />
                      <button
                        className="h-10 rounded-md border px-3 font-semibold"
                        type="submit"
                      >
                        해제
                      </button>
                    </Form>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          미연결 근거 · 내역 행에 아직 배분되지 않았습니다.
        </p>
      )}

      {editable && compatibleLines.length ? (
        <Form
          className="mt-3 hidden gap-2 border-t pt-3 lg:grid lg:grid-cols-[1fr_8rem_auto]"
          method="post"
        >
          <input name="intent" type="hidden" value="drawing_boq_put" />
          <input name="id" type="hidden" value={operationId} />
          <input
            name="quantity_link_id"
            type="hidden"
            value={row.quantity.id}
          />
          <input name="version_id" type="hidden" value={boqVersionId} />
          <input name="base_version" type="hidden" value="" />
          <select
            aria-label="Drawing 근거를 연결할 품목"
            className={inputClass}
            name="line_id"
          >
            {compatibleLines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.itemCode} {line.itemName}
              </option>
            ))}
          </select>
          <input
            aria-label="새 Drawing 배분 계수"
            className={inputClass}
            defaultValue="1"
            inputMode="decimal"
            name="allocation_factor"
          />
          <button
            className="rounded-md bg-primary px-3 font-semibold text-primary-foreground"
            type="submit"
          >
            연결
          </button>
        </Form>
      ) : null}
    </li>
  );
}

export function VerifiedBoqDrawingSources({
  boqVersionId,
  editable,
  lines,
  rows,
}: Props) {
  return (
    <section
      aria-labelledby="verified-boq-drawing-sources-title"
      className="rounded-2xl border bg-card p-5"
    >
      <h2 className="font-semibold" id="verified-boq-drawing-sources-title">
        Drawing 원수량 근거
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        서버가 승인 스냅샷에서 확정한 값입니다. 데스크톱에서만 배분을
        편집합니다.
      </p>
      {rows.length ? (
        <ul className="mt-4 grid gap-3">
          {rows.map((row) => (
            <SourceCard
              boqVersionId={boqVersionId}
              editable={editable}
              key={row.quantity.id}
              lines={lines}
              row={row}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          사용할 수 있는 Drawing 확정 근거가 없습니다.
        </p>
      )}
    </section>
  );
}
