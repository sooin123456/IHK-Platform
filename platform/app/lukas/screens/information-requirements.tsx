import type { Route } from "./+types/information-requirements";

import { createHash } from "node:crypto";

import { ArrowLeft, ClipboardCheck, Download } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import makeServerClient from "~/core/lib/supa-client.server";
import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { authLoginPath } from "~/features/auth/lib/auth-link.server";
import { recordProjectExport } from "~/lukas/lib/project-export-audit.server";
import {
  buildBcf21FromRequirementFindings,
  checkIdsAgainstElementLedger,
} from "~/lukas/lib/information-requirements.server";
import { storageObjectPath } from "~/lukas/lib/storage-object-key.server";

const maxIdsBytes = 5 * 1024 * 1024;
const maxLedgerBytes = 20 * 1024 * 1024;

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page?.project
      ? `${page.project.name} 정보요구 | 한길시스템`
      : "정보요구 | 한길시스템",
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
      .select("id, name, owner_id")
      .eq("id", params.projectId)
      .single();
    if (!project)
      throw new Response("프로젝트를 찾을 수 없습니다.", { status: 404 });
    const { data: ledgers } = await client
      .from("lukas_qto_files")
      .select("id, original_filename, sha256, created_at")
      .eq("project_id", project.id)
      .eq("kind", "element_ledger")
      .order("created_at", { ascending: false });
    return data({ project, ledgers: ledgers ?? [] }, { headers });
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous)
    throw redirect(authLoginPath(request.url), { headers });
  const form = await request.formData();
  const idsFile = form.get("ids_file");
  const ledgerId = String(form.get("ledger_id") ?? "");
  const intent = String(form.get("intent") ?? "validate");
  if (!(idsFile instanceof File) || idsFile.size === 0)
    return data(
      { error: "buildingSMART IDS 1.0 파일을 선택하세요." },
      { status: 400, headers },
    );
  if (idsFile.size > maxIdsBytes)
    return data(
      { error: "IDS 파일은 5MB까지 지원합니다." },
      { status: 413, headers },
    );
  const { data: project } = await client
    .from("lukas_qto_projects")
    .select("id, owner_id")
    .eq("id", params.projectId)
    .single();
  if (!project)
    return data(
      { error: "프로젝트 접근 권한이 없습니다." },
      { status: 403, headers },
    );
  const { data: ledger } = await client
    .from("lukas_qto_files")
    .select("id, storage_path, original_filename, sha256, byte_size")
    .eq("project_id", project.id)
    .eq("id", ledgerId)
    .eq("kind", "element_ledger")
    .single();
  if (!ledger || ledger.byte_size > maxLedgerBytes)
    return data(
      { error: "선택한 요소 원장을 읽을 수 없거나 20MB를 초과했습니다." },
      { status: 400, headers },
    );
  const { data: ledgerBlob, error: ledgerError } = await client.storage
    .from("lukas-qto")
    .download(ledger.storage_path);
  if (ledgerError || !ledgerBlob)
    return data(
      { error: "요소 원장을 다시 읽지 못했습니다." },
      { status: 500, headers },
    );
  try {
    const idsBytes = new Uint8Array(await idsFile.arrayBuffer());
    const ledgerBytes = new Uint8Array(await ledgerBlob.arrayBuffer());
    const result = checkIdsAgainstElementLedger(idsBytes, ledgerBytes);
    if (result.ledgerSha256 !== ledger.sha256)
      throw new Error("등록 당시 요소 원장과 현재 파일이 다릅니다.");
    if (intent === "bcf") {
      const bcf = buildBcf21FromRequirementFindings(
        result,
        new Date().toISOString(),
      );
      await recordProjectExport(client, project.id, "ids_bcfzip", bcf);
      return mergeResponseHeaders(
        new Response(bcf as BodyInit, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="lukas-ids-review-${result.idsSha256.slice(0, 12)}.bcfzip"`,
            "Cache-Control": "private, no-store",
          },
        }),
        headers,
      );
    }
    if (intent !== "validate") throw new Error("지원하지 않는 작업입니다.");
    const storagePath = storageObjectPath({
      ownerId: project.owner_id,
      projectId: project.id,
      directory: "information-requirements",
      originalFilename: idsFile.name,
    });
    const { error: uploadError } = await client.storage
      .from("lukas-qto")
      .upload(storagePath, idsBytes, {
        contentType: idsFile.type || "application/xml",
        upsert: false,
      });
    if (uploadError)
      throw new Error(`IDS 원본 보관 실패: ${uploadError.message}`);
    const { error: metadataError } = await client
      .from("lukas_qto_files")
      .insert({
        project_id: project.id,
        uploaded_by: user.id,
        kind: "other",
        storage_path: storagePath,
        original_filename: idsFile.name || "requirements.ids",
        content_type: idsFile.type || "application/xml",
        byte_size: idsFile.size,
        sha256: createHash("sha256").update(idsBytes).digest("hex"),
        immutable: true,
      });
    if (metadataError) {
      await client.storage.from("lukas-qto").remove([storagePath]);
      throw new Error(`IDS 원본 기록 실패: ${metadataError.message}`);
    }
    return data({ result }, { headers });
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error ? error.message : "IDS 확인에 실패했습니다.",
      },
      { status: 400, headers },
    );
  }
}

export default function InformationRequirements({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground underline underline-offset-4"
        to={`/projects/${loaderData.project.id}`}
      >
        <ArrowLeft className="size-4" /> 프로젝트로 돌아가기
      </Link>
      <header className="mt-5 border-b pb-8">
        <p className="text-sm font-bold text-primary">
          OPENBIM INFORMATION REQUIREMENTS
        </p>
        <h1 className="mt-2 text-3xl font-bold">IDS 요구사항 확인</h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          buildingSMART IDS 1.0 요구사항 중 현재 Revit 요소 원장이 증명할 수
          있는 카테고리·패밀리·타입·레벨·부피·길이·높이만 판정합니다. 나머지는
          억지로 통과시키지 않고 REVIEW로 분리해 BCF 2.1 검토 파일로 돌려줍니다.
        </p>
      </header>
      <section className="mt-8 rounded-2xl border bg-card p-6 shadow-sm">
        <Form
          className="grid gap-4"
          encType="multipart/form-data"
          method="post"
        >
          <div className="grid gap-2">
            <Label htmlFor="ledger-id">검사할 요소 원장</Label>
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              id="ledger-id"
              name="ledger_id"
              required
            >
              <option value="">선택하세요</option>
              {loaderData.ledgers.map((ledger) => (
                <option key={ledger.id} value={ledger.id}>
                  {ledger.original_filename} · {ledger.sha256.slice(0, 12)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ids-file">IDS 1.0 파일</Label>
            <Input
              accept=".ids,.xml,application/xml,text/xml"
              id="ids-file"
              name="ids_file"
              required
              type="file"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button name="intent" type="submit" value="validate">
              <ClipboardCheck className="size-4" /> 확인하고 원본 보관
            </Button>
            <Button name="intent" type="submit" value="bcf" variant="outline">
              <Download className="size-4" /> FAIL·REVIEW BCF 받기
            </Button>
          </div>
        </Form>
      </section>
      {actionData && "error" in actionData ? (
        <p className="mt-6 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {actionData.error}
        </p>
      ) : null}
      {actionData && "result" in actionData ? (
        <section className="mt-8 rounded-2xl border bg-card p-6">
          <h2 className="text-xl font-semibold">
            {actionData.result.idsTitle}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            IDS 원본 확인번호 {actionData.result.idsSha256}
          </p>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="pb-3">상태</th>
                  <th>요구사항</th>
                  <th>검사</th>
                  <th>실패</th>
                  <th>설명</th>
                </tr>
              </thead>
              <tbody>
                {actionData.result.findings.map((finding) => (
                  <tr className="border-b last:border-0" key={finding.key}>
                    <td className="py-4 font-semibold">{finding.status}</td>
                    <td>
                      {finding.specification} · {finding.requirement}
                    </td>
                    <td>{finding.checkedCount}</td>
                    <td>{finding.failedCount}</td>
                    <td>{finding.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
