import type { Route } from "./+types/takeoff-artifact";

import { ArrowLeft, Calculator, Download, ShieldCheck } from "lucide-react";
import { Link, redirect } from "react-router";

import { Button } from "~/core/components/ui/button";
import makeServerClient from "~/core/lib/supa-client.server";
import { verifyConcreteTakeoffBundle } from "~/lukas/lib/concrete-takeoff-artifact.server";

const maxDisplayRows = 1000;

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: data?.project
      ? `산출 근거 | ${data.project.name} | 한길시스템`
      : "산출 근거 | 한길시스템",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const [client] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw redirect("/login");
  const { data: project } = await client
    .from("lukas_qto_projects")
    .select("id, name")
    .eq("id", params.projectId)
    .single();
  if (!project)
    throw new Response("프로젝트를 찾을 수 없습니다.", { status: 404 });
  const { data: artifact } = await client
    .from("lukas_qto_takeoff_artifacts")
    .select(
      "id, format_version, report_file_id, manifest_file_id, report_sha256, manifest_sha256, row_count, input_sha256, status_counts, created_at",
    )
    .eq("id", params.artifactId)
    .eq("project_id", project.id)
    .single();
  if (!artifact)
    throw new Response("산출 근거를 찾을 수 없습니다.", { status: 404 });
  const { data: inputLinks, error: inputLinksError } = await client
    .from("lukas_qto_takeoff_inputs")
    .select("input_role, file_id, source_sha256")
    .eq("artifact_id", artifact.id);
  if (inputLinksError || !inputLinks || inputLinks.length !== 7)
    throw new Response("산출 근거의 7개 입력 파일 연결이 완전하지 않습니다.", {
      status: 409,
    });
  const linkedFileIds = [
    ...new Set([
      artifact.report_file_id,
      artifact.manifest_file_id,
      ...inputLinks.map((link) => link.file_id),
    ]),
  ];
  const { data: files, error: filesError } = await client
    .from("lukas_qto_files")
    .select("id, kind, original_filename, storage_path, sha256, byte_size")
    .eq("project_id", project.id)
    .in("id", linkedFileIds);
  if (
    filesError ||
    !files ||
    linkedFileIds.some((id) => !files.some((file) => file.id === id))
  )
    throw new Response("산출 근거 원본 파일을 찾을 수 없습니다.", {
      status: 409,
    });
  const reportFile = files.find((file) => file.id === artifact.report_file_id);
  const manifestFile = files.find(
    (file) => file.id === artifact.manifest_file_id,
  );
  if (!reportFile || !manifestFile)
    throw new Response("산출 근거 파일 연결이 끊어졌습니다.", { status: 409 });
  const inputEvidence = inputLinks
    .map((link) => {
      const file = files.find((candidate) => candidate.id === link.file_id);
      const registeredHashes =
        artifact.input_sha256 &&
        typeof artifact.input_sha256 === "object" &&
        !Array.isArray(artifact.input_sha256)
          ? (artifact.input_sha256 as Record<string, unknown>)
          : {};
      if (
        !file ||
        file.sha256 !== link.source_sha256 ||
        registeredHashes[link.input_role] !== link.source_sha256
      )
        throw new Response(
          "입력 파일의 등록 정보와 산출 근거 기록이 일치하지 않습니다.",
          { status: 409 },
        );
      return {
        role: link.input_role,
        fileId: file.id,
        filename: file.original_filename,
        kind: file.kind,
        sha256: file.sha256,
      };
    })
    .sort((left, right) => left.role.localeCompare(right.role));
  if (
    reportFile.byte_size > 20 * 1024 * 1024 ||
    manifestFile.byte_size > 20 * 1024 * 1024
  )
    throw new Response("웹 검증 허용 크기를 초과했습니다.", { status: 413 });
  const [
    { data: reportBlob, error: reportError },
    { data: manifestBlob, error: manifestError },
  ] = await Promise.all([
    client.storage.from("lukas-qto").download(reportFile.storage_path),
    client.storage.from("lukas-qto").download(manifestFile.storage_path),
  ]);
  if (reportError || manifestError || !reportBlob || !manifestBlob)
    throw new Response("산출 근거 파일을 다시 읽지 못했습니다.", {
      status: 500,
    });
  let verified: ReturnType<typeof verifyConcreteTakeoffBundle>;
  try {
    verified = verifyConcreteTakeoffBundle(
      new Uint8Array(await reportBlob.arrayBuffer()),
      reportFile.original_filename,
      new Uint8Array(await manifestBlob.arrayBuffer()),
    );
  } catch (error) {
    throw new Response(
      error instanceof Error
        ? `산출 근거 파일 변경 확인 실패: ${error.message}`
        : "산출 근거 파일이 등록 당시 상태와 같은지 확인하지 못했습니다.",
      { status: 409 },
    );
  }
  if (
    verified.reportSha256 !== artifact.report_sha256 ||
    verified.manifestSha256 !== artifact.manifest_sha256 ||
    verified.reportSha256 !== reportFile.sha256 ||
    verified.manifestSha256 !== manifestFile.sha256 ||
    verified.rowCount !== artifact.row_count ||
    canonical(verified.inputSha256) !== canonical(artifact.input_sha256) ||
    canonical(verified.statusCounts) !== canonical(artifact.status_counts)
  ) {
    throw new Response(
      "등록된 메타데이터와 다시 검증한 산출 근거가 일치하지 않습니다.",
      { status: 409 },
    );
  }
  const [{ data: reportLink }, { data: manifestLink }] = await Promise.all([
    client.storage
      .from("lukas-qto")
      .createSignedUrl(reportFile.storage_path, 300),
    client.storage
      .from("lukas-qto")
      .createSignedUrl(manifestFile.storage_path, 300),
  ]);
  const { data: approvals, error: approvalsError } = await client
    .from("lukas_qto_takeoff_approvals")
    .select("id, decision, note, decision_sequence, created_at")
    .eq("artifact_id", artifact.id)
    .order("decision_sequence", { ascending: true });
  if (approvalsError)
    throw new Response("사람 승인 이력을 불러오지 못했습니다.", {
      status: 500,
    });
  return {
    project,
    artifact,
    inputSha256: verified.inputSha256,
    inputEvidence,
    statusCounts: verified.statusCounts,
    approvals: approvals ?? [],
    rows: verified.rows.slice(0, maxDisplayRows),
    totalRows: verified.rows.length,
    reportFilename: reportFile.original_filename,
    reportUrl: reportLink?.signedUrl ?? null,
    manifestFilename: manifestFile.original_filename,
    manifestUrl: manifestLink?.signedUrl ?? null,
  };
}

function canonical(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    ),
  );
}

function quantity(value: string | null) {
  return value === null ? "—" : value;
}
function decision(value: string) {
  return (
    (
      {
        approved: "승인",
        rejected: "수정 필요",
        deferred: "나중에 검토",
      } as Record<string, string>
    )[value] ?? value
  );
}

export default function TakeoffArtifact({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground underline underline-offset-4"
        to={`/projects/${loaderData.project.id}`}
      >
        <ArrowLeft className="size-4" />
        프로젝트로 돌아가기
      </Link>
      <header className="mt-5 flex flex-col gap-5 border-b pb-8 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-primary">
            <ShieldCheck className="size-4" />
            파일 변경 없음 · 재확인 완료
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            확정 숫자의 계산 근거
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
            {loaderData.project.name} · 웹은 계산을 다시 만들지 않습니다. 결과
            파일, 산출 근거 기록, 7개 입력 파일과 행별 근거가 등록 당시 상태와
            같은지 확인해 보여줍니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {loaderData.reportUrl ? (
            <Button asChild size="sm" variant="outline">
              <a href={loaderData.reportUrl}>
                <Download className="size-4" />
                결과 파일
              </a>
            </Button>
          ) : null}
          {loaderData.manifestUrl ? (
            <Button asChild size="sm" variant="outline">
              <a href={loaderData.manifestUrl}>
                <Download className="size-4" />
                산출 근거 기록
              </a>
            </Button>
          ) : null}
        </div>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border bg-card p-5">
          <p className="text-xs text-muted-foreground">검증 행</p>
          <p className="mt-2 text-2xl font-bold">
            {loaderData.totalRows.toLocaleString("ko-KR")}
          </p>
        </div>
        {Object.entries(loaderData.statusCounts).map(([status, count]) => (
          <div className="rounded-2xl border bg-card p-5" key={status}>
            <p className="text-xs text-muted-foreground">{status}</p>
            <p className="mt-2 text-2xl font-bold">
              {count.toLocaleString("ko-KR")}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-8 rounded-2xl border bg-card p-6">
        <div className="flex items-center gap-2">
          <Calculator className="size-5 text-primary" />
          <h2 className="font-semibold">입력 근거 7종</h2>
        </div>
        <dl className="mt-5 grid gap-3">
          {loaderData.inputEvidence.map((input) => (
            <div
              className="grid gap-1 border-b pb-3 text-sm sm:grid-cols-[160px_1fr]"
              key={input.role}
            >
              <dt className="font-medium">{input.role}</dt>
              <dd>
                <p className="font-medium">
                  {input.filename}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    ({input.kind})
                  </span>
                </p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  파일 확인번호 · {input.sha256}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-8 rounded-2xl border bg-card p-6">
        <h2 className="font-semibold">
          사람 승인 이력 ({loaderData.approvals.length})
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          기존 결정을 덮어쓰지 않습니다. 아래에서 가장 마지막 행이 현재
          결정입니다.
        </p>
        {loaderData.approvals.length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            아직 사람의 결정이 없습니다. PASS는 계산 규칙 검증 상태일 뿐 최종
            승인과 같지 않습니다.
          </p>
        ) : (
          <ol className="mt-5 space-y-3">
            {loaderData.approvals.map((approval, index) => (
              <li
                className="grid gap-2 border-l-2 border-primary/30 pl-4 sm:grid-cols-[120px_1fr_auto]"
                key={approval.id}
              >
                <p className="text-sm font-bold">
                  {index + 1}. {decision(approval.decision)}
                </p>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {approval.note || "근거 메모 없음"}
                </p>
                <time className="text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat("ko-KR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(approval.created_at))}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-8 rounded-2xl border bg-card p-6">
        <div className="mb-5">
          <h2 className="font-semibold">행별 산출식과 원본 근거</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            표시값은 반올림하지 않은 문자열입니다. PASS도 사람의 최종 승인과
            동일하지 않습니다.
          </p>
        </div>
        {loaderData.totalRows > loaderData.rows.length ? (
          <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            브라우저 성능을 위해 앞{" "}
            {loaderData.rows.length.toLocaleString("ko-KR")}행만 표시합니다.
            전체 {loaderData.totalRows.toLocaleString("ko-KR")}행은 report
            CSV에서 확인하세요.
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] text-left text-xs">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="pb-3">상태</th>
                <th className="pb-3">위치·부재</th>
                <th className="pb-3">규격</th>
                <th className="pb-3">정미량 m³</th>
                <th className="pb-3">공제 m³ (정미량에 포함)</th>
                <th className="pb-3">할증·반올림 m³</th>
                <th className="pb-3">최종 m³</th>
                <th className="pb-3">계산식</th>
                <th className="pb-3">규칙</th>
                <th className="pb-3">원본 근거</th>
                <th className="pb-3">요소 ID</th>
              </tr>
            </thead>
            <tbody>
              {loaderData.rows.map((row, index) => (
                <tr
                  className="border-b align-top last:border-0"
                  key={`${row.record_type}/${index}`}
                >
                  <td className="py-4 font-bold">{row.status}</td>
                  <td className="py-4">
                    <p>
                      {[row.building, row.floor].filter(Boolean).join(" / ") ||
                        "—"}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {row.member || "—"}
                    </p>
                  </td>
                  <td className="py-4">{row.spec || "—"}</td>
                  <td className="py-4 font-mono">{quantity(row.raw_m3)}</td>
                  <td className="py-4 font-mono">
                    {quantity(row.deduction_m3)}
                  </td>
                  <td className="py-4 font-mono">
                    {quantity(row.allowance_m3)}
                  </td>
                  <td className="py-4 font-mono font-bold">
                    {quantity(row.final_m3)}
                  </td>
                  <td className="max-w-72 whitespace-pre-wrap py-4">
                    {row.formula || row.message || "—"}
                  </td>
                  <td className="max-w-56 py-4">
                    <p>{row.rule_id || "—"}</p>
                    <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                      {row.rule_hash || ""}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {row.rule_source}
                    </p>
                  </td>
                  <td className="max-w-64 break-all py-4">
                    {row.source_evidence || "—"}
                  </td>
                  <td className="max-w-40 break-all py-4 font-mono">
                    {row.element_ids || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
