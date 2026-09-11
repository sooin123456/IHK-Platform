import type { Route } from "./+types/preflight-artifact";

import { ArrowLeft, ClipboardCheck, Download, ShieldCheck } from "lucide-react";
import { Link, data, redirect } from "react-router";

import { Button } from "~/core/components/ui/button";
import makeServerClient from "~/core/lib/supa-client.server";
import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { authLoginPath } from "~/features/auth/lib/auth-link.server";
import { verifyPreflightBundle } from "~/lukas/lib/preflight-artifact.server";

const maxDisplayRows = 1000;
export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: data?.project
      ? `사전검토 근거 | ${data.project.name} | 한길시스템`
      : "사전검토 근거 | 한길시스템",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous)
    throw redirect(authLoginPath(request.url), { headers });
  try {
    const { data: project } = await client
      .from("lukas_qto_projects")
      .select("id, name")
      .eq("id", params.projectId)
      .single();
    if (!project)
      throw new Response("프로젝트를 찾을 수 없습니다.", { status: 404 });
    const { data: artifact } = await client
      .from("lukas_qto_preflight_artifacts")
      .select(
        "id, format_version, ruleset_version, scope_id, report_file_id, manifest_file_id, report_sha256, manifest_sha256, quantity_tolerance, krw_tolerance, row_count, status_counts, created_at",
      )
      .eq("id", params.artifactId)
      .eq("project_id", project.id)
      .single();
    if (!artifact)
      throw new Response("사전검토 artifact를 찾을 수 없습니다.", {
        status: 404,
      });
    const { data: links, error: linksError } = await client
      .from("lukas_qto_preflight_inputs")
      .select("input_role, file_id, source_sha256, source_id")
      .eq("artifact_id", artifact.id);
    if (linksError || !links || links.length < 4 || links.length > 5)
      throw new Response("사전검토 입력 연결이 완전하지 않습니다.", {
        status: 409,
      });
    const ids = [
      ...new Set([
        artifact.report_file_id,
        artifact.manifest_file_id,
        ...links.map((link) => link.file_id),
      ]),
    ];
    const { data: files, error: filesError } = await client
      .from("lukas_qto_files")
      .select("id, kind, original_filename, storage_path, sha256, byte_size")
      .eq("project_id", project.id)
      .in("id", ids);
    if (
      filesError ||
      !files ||
      ids.some((id) => !files.some((file) => file.id === id))
    )
      throw new Response("사전검토 원본 파일을 찾을 수 없습니다.", {
        status: 409,
      });
    const reportFile = files.find(
      (file) => file.id === artifact.report_file_id,
    );
    const manifestFile = files.find(
      (file) => file.id === artifact.manifest_file_id,
    );
    if (
      !reportFile ||
      !manifestFile ||
      reportFile.byte_size > 20 * 1024 * 1024 ||
      manifestFile.byte_size > 20 * 1024 * 1024
    )
      throw new Response(
        "사전검토 bundle 파일 연결 또는 크기가 올바르지 않습니다.",
        { status: 409 },
      );
    const [
      { data: reportBlob, error: reportError },
      { data: manifestBlob, error: manifestError },
    ] = await Promise.all([
      client.storage.from("lukas-qto").download(reportFile.storage_path),
      client.storage.from("lukas-qto").download(manifestFile.storage_path),
    ]);
    if (reportError || manifestError || !reportBlob || !manifestBlob)
      throw new Response("사전검토 bundle을 다시 읽지 못했습니다.", {
        status: 500,
      });
    let verified: ReturnType<typeof verifyPreflightBundle>;
    try {
      verified = verifyPreflightBundle(
        new Uint8Array(await reportBlob.arrayBuffer()),
        reportFile.original_filename,
        new Uint8Array(await manifestBlob.arrayBuffer()),
      );
    } catch (error) {
      throw new Response(
        error instanceof Error
          ? `사전검토 파일 변경 확인 실패: ${error.message}`
          : "사전검토 파일이 등록 당시 상태와 같은지 확인하지 못했습니다.",
        { status: 409 },
      );
    }
    if (
      verified.reportSha256 !== artifact.report_sha256 ||
      verified.manifestSha256 !== artifact.manifest_sha256 ||
      verified.reportSha256 !== reportFile.sha256 ||
      verified.manifestSha256 !== manifestFile.sha256 ||
      verified.rowCount !== artifact.row_count ||
      verified.rulesetVersion !== artifact.ruleset_version ||
      verified.scopeId !== artifact.scope_id ||
      verified.quantityTolerance !== artifact.quantity_tolerance ||
      verified.krwTolerance !== artifact.krw_tolerance ||
      canonical(verified.statusCounts) !== canonical(artifact.status_counts)
    )
      throw new Response(
        "등록 메타데이터와 다시 검증한 사전검토 결과가 일치하지 않습니다.",
        { status: 409 },
      );
    const inputEvidence = links
      .map((link) => {
        const file = files.find((candidate) => candidate.id === link.file_id);
        const input = verified.inputs[link.input_role];
        if (
          !file ||
          !input ||
          file.sha256 !== link.source_sha256 ||
          input.sha256 !== link.source_sha256 ||
          input.sourceId !== link.source_id ||
          input.filename !== file.original_filename
        )
          throw new Response(
            "사전검토 입력 파일과 등록된 산출 근거가 일치하지 않습니다.",
            { status: 409 },
          );
        return {
          role: link.input_role,
          filename: file.original_filename,
          kind: file.kind,
          sha256: file.sha256,
          sourceId: link.source_id,
        };
      })
      .sort((left, right) => left.role.localeCompare(right.role));
    if (Object.keys(verified.inputs).length !== inputEvidence.length)
      throw new Response(
        "사전검토 산출 근거 기록과 등록된 입력 파일 수가 다릅니다.",
        {
          status: 409,
        },
      );
    const [
      { data: reportLink },
      { data: manifestLink },
      { data: approvals, error: approvalsError },
    ] = await Promise.all([
      client.storage
        .from("lukas-qto")
        .createSignedUrl(reportFile.storage_path, 300),
      client.storage
        .from("lukas-qto")
        .createSignedUrl(manifestFile.storage_path, 300),
      client
        .from("lukas_qto_preflight_approvals")
        .select("id, decision, note, created_at")
        .eq("artifact_id", artifact.id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
    ]);
    if (approvalsError)
      throw new Response("사전검토 승인 이력을 불러오지 못했습니다.", {
        status: 500,
      });
    return data(
      {
        project,
        artifact,
        inputEvidence,
        approvals: approvals ?? [],
        rows: verified.rows.slice(0, maxDisplayRows),
        totalRows: verified.rowCount,
        statusCounts: verified.statusCounts,
        reportUrl: reportLink?.signedUrl ?? null,
        manifestUrl: manifestLink?.signedUrl ?? null,
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }
}

function canonical(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? JSON.stringify(
        Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a.localeCompare(b),
          ),
        ),
      )
    : "";
}
function quantity(value: string | null) {
  return value ?? "—";
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

export default function PreflightArtifact({
  loaderData,
}: Route.ComponentProps) {
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
          <p className="flex items-center gap-2 text-sm font-bold text-emerald-700">
            <ShieldCheck className="size-4" />
            승인된 원본 · 파일 변경 없음
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            내역·QTO 사전검토 근거
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
            {loaderData.project.name} · 범위 {loaderData.artifact.scope_id} ·
            규칙 {loaderData.artifact.ruleset_version}. 웹은 판정을 다시 만들지
            않고 계산 결과와 사용한 입력 파일이 등록 당시 상태와 같은지
            확인합니다.
          </p>
        </div>
        <div className="flex gap-2">
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
          <p className="text-xs text-muted-foreground">전체 판정</p>
          <p className="mt-2 text-2xl font-bold">{loaderData.totalRows}</p>
        </div>
        {Object.entries(loaderData.statusCounts).map(([status, count]) => (
          <div className="rounded-2xl border bg-card p-5" key={status}>
            <p className="text-xs text-muted-foreground">{status}</p>
            <p className="mt-2 text-2xl font-bold">{count}</p>
          </div>
        ))}
      </section>
      <section className="mt-8 rounded-2xl border bg-card p-6">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="size-5 text-emerald-700" />
          <h2 className="font-semibold">실행 입력 근거</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          수량 허용오차 {loaderData.artifact.quantity_tolerance} · KRW 허용오차{" "}
          {loaderData.artifact.krw_tolerance}
        </p>
        <dl className="mt-5 grid gap-3">
          {loaderData.inputEvidence.map((input) => (
            <div
              className="grid gap-1 border-b pb-3 sm:grid-cols-[160px_1fr]"
              key={input.role}
            >
              <dt className="text-sm font-medium">{input.role}</dt>
              <dd>
                <p className="text-sm font-medium">
                  {input.filename}{" "}
                  <span className="font-normal text-muted-foreground">
                    ({input.sourceId})
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
        {loaderData.approvals.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            아직 사람 결정이 없습니다. Core PASS와 납품 승인은 다른 상태입니다.
          </p>
        ) : (
          <ol className="mt-5 space-y-3">
            {loaderData.approvals.map((item, index) => (
              <li
                className="grid gap-2 border-l-2 border-emerald-500/30 pl-4 sm:grid-cols-[120px_1fr_auto]"
                key={item.id}
              >
                <b className="text-sm">
                  {index + 1}. {decision(item.decision)}
                </b>
                <span className="text-sm text-muted-foreground">
                  {item.note || "근거 메모 없음"}
                </span>
                <time className="text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat("ko-KR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(item.created_at))}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="mt-8 rounded-2xl border bg-card p-6">
        <h2 className="font-semibold">규칙별 판정</h2>
        {loaderData.totalRows > loaderData.rows.length ? (
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            앞 {loaderData.rows.length}행만 표시합니다. 전체 결과는 report
            CSV에서 확인하세요.
          </p>
        ) : null}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[1300px] text-left text-xs">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="pb-3">규칙</th>
                <th className="pb-3">상태</th>
                <th className="pb-3">내역/QTO</th>
                <th className="pb-3">단위</th>
                <th className="pb-3">기대값</th>
                <th className="pb-3">실제값</th>
                <th className="pb-3">차이</th>
                <th className="pb-3">근거</th>
                <th className="pb-3">설명</th>
              </tr>
            </thead>
            <tbody>
              {loaderData.rows.map((row, index) => (
                <tr
                  className="border-b align-top last:border-0"
                  key={`${row.rule}/${index}`}
                >
                  <td className="py-4 font-bold">
                    {row.rule}
                    <p className="mt-1 font-normal text-muted-foreground">
                      {row.severity}
                    </p>
                  </td>
                  <td className="py-4 font-bold">{row.status}</td>
                  <td className="py-4">
                    {row.estimateLineId || "—"}
                    <p
                      className="mt-1 max-w-48 truncate font-mono text-muted-foreground"
                      title={row.qtoKey}
                    >
                      {row.qtoKey}
                    </p>
                  </td>
                  <td className="py-4">{row.unit || "—"}</td>
                  <td className="py-4 font-mono">{quantity(row.expected)}</td>
                  <td className="py-4 font-mono">{quantity(row.actual)}</td>
                  <td className="py-4 font-mono">{quantity(row.delta)}</td>
                  <td className="max-w-64 break-all py-4">
                    {row.evidence || "—"}
                  </td>
                  <td className="max-w-80 whitespace-pre-wrap py-4">
                    {row.message}
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
