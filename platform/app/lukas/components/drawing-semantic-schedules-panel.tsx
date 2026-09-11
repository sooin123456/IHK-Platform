import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "~/core/components/ui/table";
import type { DrawingDocumentState } from "~/lukas/lib/drawing-commands";
import {
  drawingMeasurementEvidenceCurrent,
  resolveDrawingSemanticSchedulePreview,
  resolveDrawingServerEvidenceStatus,
  type DrawingMeasurementEvidenceLineage,
  type DrawingMeasurementEvidenceError,
  type DrawingSemanticSchedule,
  type DrawingSemanticScheduleKind,
  type DrawingServerMeasurementEvidence,
} from "~/lukas/lib/drawing-semantic-schedules";

type Props = {
  evidence?: DrawingServerMeasurementEvidence | null;
  evidenceError?: DrawingMeasurementEvidenceError | null;
  hasUnconfirmedChanges: boolean;
  lineage?: DrawingMeasurementEvidenceLineage | null;
  state: DrawingDocumentState;
};

const scheduleKinds: DrawingSemanticScheduleKind[] = ["room", "door", "finish"];

function SemanticScheduleTable({
  schedule,
  source,
}: {
  schedule: DrawingSemanticSchedule;
  source: "서버 증거" | "미리보기";
}) {
  return (
    <section
      aria-label={`${schedule.caption} · ${source}`}
      className="mt-4 rounded-md border border-white/10 p-2"
    >
      <Table aria-label={`${schedule.caption} · ${source}`}>
        <TableCaption>
          {schedule.caption} · {source}
        </TableCaption>
        <TableHeader>
          <TableRow>
            {schedule.columns.map((column) => (
              <TableHead key={column.key} scope="col">
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedule.rows.map((row) => (
            <TableRow key={row.objectId}>
              {schedule.columns.map((column) => (
                <TableCell key={column.key}>{row.cells[column.key]}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            {schedule.columns.map((column, index) => (
              <TableCell key={column.key}>
                {index === 0
                  ? schedule.totals.label
                  : schedule.totals.cells[column.key]}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      </Table>
    </section>
  );
}

export function DrawingSemanticSchedulesPanel({
  evidence,
  evidenceError,
  hasUnconfirmedChanges,
  lineage,
  state,
}: Props) {
  const status = resolveDrawingServerEvidenceStatus(
    evidence,
    drawingMeasurementEvidenceCurrent(lineage, state, hasUnconfirmedChanges),
  );
  const confirmed = status.status === "confirmed" && evidence;
  const previews = Object.fromEntries(
    scheduleKinds.map((kind) => [
      kind,
      resolveDrawingSemanticSchedulePreview(kind, state),
    ]),
  ) as Record<
    DrawingSemanticScheduleKind,
    ReturnType<typeof resolveDrawingSemanticSchedulePreview>
  >;
  const schedules = confirmed
    ? evidence.schedules
    : Object.fromEntries(
        scheduleKinds.map((kind) => [kind, previews[kind].schedule]),
      );
  const previewErrors = scheduleKinds.filter(
    (kind) => previews[kind].status === "error",
  );
  const source = confirmed ? "서버 증거" : "미리보기";

  return (
    <section
      aria-labelledby="drawing-semantic-schedules-title"
      data-drawing-server-evidence={confirmed ? "confirmed" : undefined}
      data-drawing-server-evidence-document-id={
        confirmed ? evidence.documentId : undefined
      }
      data-drawing-server-evidence-operation-checkpoint={
        confirmed ? evidence.operationCheckpoint : undefined
      }
      data-drawing-server-evidence-revision-id={
        confirmed ? evidence.revisionId : undefined
      }
      data-drawing-server-evidence-revision-version={
        confirmed ? evidence.revisionVersion : undefined
      }
      data-drawing-server-evidence-rule-version={
        confirmed ? evidence.ruleVersion : undefined
      }
      data-drawing-server-evidence-snapshot-sha256={
        confirmed ? evidence.snapshotSha256 : undefined
      }
    >
      <h2 className="text-sm font-bold" id="drawing-semantic-schedules-title">
        건축 일람표
      </h2>
      <div className="mt-3 grid gap-2 rounded-md bg-white/5 p-3 text-xs">
        <p>
          <span className="font-semibold text-slate-200">일람표 미리보기</span>
          <span className="ml-2 text-slate-400">
            현재 revision 전체 객체에서 브라우저가 파생하며 확정 근거가
            아닙니다.
          </span>
        </p>
        {evidenceError || previewErrors.length ? (
          <p className="text-rose-200" role="alert">
            계산 오류 · 미확정 · {evidenceError?.message ?? ""}
            {previewErrors.length
              ? ` ${previewErrors.map((kind) => `${kind} 일람표`).join(", ")} 브라우저 일람표를 계산하지 못했습니다.`
              : ""}
          </p>
        ) : null}
        {confirmed ? (
          <p className="text-emerald-200" role="status">
            <span className="font-semibold">서버 증거</span> ·{" "}
            {evidence.ruleVersion}
            {" · "}체크포인트 {evidence.operationCheckpoint} · Postgres 권한
            확인 로드 · revision {evidence.revisionId}
          </p>
        ) : evidence ? (
          <p className="text-amber-200" role="status">
            서버 증거 오래됨 · 현재 revision/checkpoint/object lineage와
            일치하지 않아 미확정입니다. {evidence.ruleVersion} · 체크포인트{" "}
            {evidence.operationCheckpoint} · Postgres 권한 확인 로드
          </p>
        ) : (
          <p className="text-amber-200" role="status">
            서버 증거 없음 · 미리보기만 표시합니다.
          </p>
        )}
        <p className="text-slate-400">원본 수정 · 속성 검사기</p>
      </div>
      {scheduleKinds.map((kind) => (
        <SemanticScheduleTable
          key={kind}
          schedule={schedules[kind]}
          source={source}
        />
      ))}
    </section>
  );
}
