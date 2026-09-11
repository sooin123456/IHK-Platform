import type { Route } from "./+types/suggestion-pilot";

import { createHash } from "node:crypto";

import type { Json } from "database.types";
import { ArrowLeft, FlaskConical, Upload } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { z } from "zod";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import makeServerClient from "~/core/lib/supa-client.server";
import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { authLoginPath } from "~/features/auth/lib/auth-link.server";
import { verifyAiSuggestionImport } from "~/lukas/lib/ai-suggestion-import.server";
import { storageObjectPath } from "~/lukas/lib/storage-object-key.server";
import { buildSuggestionEvaluation } from "~/lukas/lib/suggestion-feedback.server";

const maxPayloadBytes = 10 * 1024 * 1024;
const maxSourceBytes = 200 * 1024 * 1024;
const allowedSourceKinds = [
  "ifc",
  "qto_csv",
  "element_ledger",
  "formwork_ledger",
  "estimate",
  "mapping",
] as const;

function enabled() {
  return process.env.LUKAS_ENABLE_AI_PILOT === "true";
}

async function context(request: Request, projectId: string) {
  if (!enabled())
    throw new Response("제안 파일럿이 비활성화되어 있습니다.", { status: 404 });
  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous)
    throw redirect(authLoginPath(request.url), { headers });
  if (user.app_metadata.role !== "hangil_staff")
    throw mergeResponseHeaders(
      new Response("한길 담당자만 제안 파일럿을 운영할 수 있습니다.", {
        status: 403,
      }),
      headers,
    );
  const { data: project } = await client
    .from("lukas_qto_projects")
    .select("id, name, owner_id")
    .eq("id", projectId)
    .single();
  if (!project)
    throw mergeResponseHeaders(
      new Response("프로젝트를 찾을 수 없습니다.", { status: 404 }),
      headers,
    );
  return { client, headers, user, project };
}

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page?.project
      ? `${page.project.name} 제안 파일럿 | 한길시스템`
      : "제안 파일럿",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { client, headers, project } = await context(
    request,
    params.projectId!,
  );
  try {
    const [
      { data: files, error: filesError },
      { data: suggestions, error: suggestionsError },
    ] = await Promise.all([
      client
        .from("lukas_qto_files")
        .select(
          "id, kind, original_filename, sha256, byte_size, storage_path, created_at",
        )
        .eq("project_id", project.id)
        .in("kind", [...allowedSourceKinds])
        .order("created_at", { ascending: false }),
      client
        .from("lukas_qto_suggestions")
        .select(
          "id, producer_kind, producer_version, suggestion_kind, created_at",
        )
        .eq("project_id", project.id)
        .eq("producer_kind", "ai")
        .order("created_at", { ascending: false }),
    ]);
    if (filesError || suggestionsError)
      throw new Response("제안 파일럿 자료를 불러오지 못했습니다.", {
        status: 500,
      });
    const ids = (suggestions ?? []).map((item) => item.id);
    const { data: decisions, error: decisionError } =
      ids.length === 0
        ? { data: [], error: null }
        : await client
            .from("lukas_qto_suggestion_decisions")
            .select(
              "id, suggestion_id, decision, decision_sequence, created_at",
            )
            .in("suggestion_id", ids)
            .order("decision_sequence", { ascending: false });
    if (decisionError)
      throw new Response("제안 검토 이력을 불러오지 못했습니다.", {
        status: 500,
      });
    return data(
      {
        project,
        files: files ?? [],
        importedCount: suggestions?.length ?? 0,
        evaluation: buildSuggestionEvaluation(
          suggestions ?? [],
          decisions ?? [],
        ),
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { client, headers, user, project } = await context(
    request,
    params.projectId!,
  );
  const form = await request.formData();
  const payload = form.get("payload");
  try {
    const sourceFileId = z.string().uuid().parse(form.get("source_file_id"));
    if (
      !(payload instanceof File) ||
      payload.size === 0 ||
      payload.size > maxPayloadBytes
    )
      throw new Error("제안 JSON은 1바이트 이상 10MB 이하여야 합니다.");
    const { data: source } = await client
      .from("lukas_qto_files")
      .select("id, sha256, byte_size, storage_path, kind")
      .eq("project_id", project.id)
      .eq("id", sourceFileId)
      .in("kind", [...allowedSourceKinds])
      .single();
    if (!source || source.byte_size > maxSourceBytes)
      throw new Error("선택한 원본이 없거나 200MB를 초과합니다.");
    const { data: sourceBlob, error: sourceError } = await client.storage
      .from("lukas-qto")
      .download(source.storage_path);
    if (sourceError || !sourceBlob)
      throw new Error("선택한 원본을 다시 읽지 못했습니다.");
    const sourceBytes = new Uint8Array(await sourceBlob.arrayBuffer());
    if (
      createHash("sha256").update(sourceBytes).digest("hex") !== source.sha256
    )
      throw new Error("등록 당시 원본과 현재 파일이 다릅니다.");
    const payloadBytes = new Uint8Array(await payload.arrayBuffer());
    const verified = verifyAiSuggestionImport(payloadBytes, source.sha256);
    const { data: duplicate } = await client
      .from("lukas_qto_suggestions")
      .select("id")
      .eq("project_id", project.id)
      .eq("producer_kind", "ai")
      .eq("payload_sha256", verified.payloadSha256)
      .limit(1)
      .maybeSingle();
    if (duplicate) throw new Error("같은 제안 파일은 이미 가져왔습니다.");

    const storagePath = storageObjectPath({
      ownerId: project.owner_id,
      projectId: project.id,
      directory: "suggestion-pilot",
      originalFilename: payload.name,
    });
    const { error: uploadError } = await client.storage
      .from("lukas-qto")
      .upload(storagePath, payloadBytes, {
        contentType: "application/json",
        upsert: false,
      });
    if (uploadError)
      throw new Error(`제안 원본 보관 실패: ${uploadError.message}`);
    let payloadFileId: string | null = null;
    try {
      const { data: stored, error: metadataError } = await client
        .from("lukas_qto_files")
        .insert({
          project_id: project.id,
          uploaded_by: user.id,
          kind: "other",
          storage_path: storagePath,
          original_filename: payload.name || "suggestions.json",
          content_type: "application/json",
          byte_size: payload.size,
          sha256: verified.payloadSha256,
          immutable: true,
        })
        .select("id")
        .single();
      if (metadataError || !stored)
        throw new Error(
          metadataError?.message ?? "제안 파일 기록을 만들지 못했습니다.",
        );
      payloadFileId = stored.id;
      const { default: admin } = await import(
        "~/core/lib/supa-admin-client.server"
      );
      const batchId = crypto.randomUUID();
      const { error: insertError } = await admin
        .from("lukas_qto_suggestions")
        .insert(
          verified.suggestions.map((suggestion) => ({
            batch_id: batchId,
            project_id: project.id,
            file_id: source.id,
            created_by: user.id,
            producer_kind: "ai",
            producer_version: verified.producerVersion,
            source_sha256: verified.sourceSha256,
            suggestion_kind: suggestion.suggestionKind,
            subject_key: suggestion.subjectKey,
            title: suggestion.title,
            detail: suggestion.detail,
            confidence: suggestion.confidence,
            evidence: suggestion.evidence as Json,
            payload_file_id: stored.id,
            payload_sha256: verified.payloadSha256,
          })),
        );
      if (insertError) throw new Error(insertError.message);
    } catch (error) {
      if (payloadFileId)
        await client.from("lukas_qto_files").delete().eq("id", payloadFileId);
      await client.storage.from("lukas-qto").remove([storagePath]);
      throw error;
    }
    return redirect(`/projects/${project.id}`, { headers });
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error
            ? error.message
            : "제안 파일을 가져오지 못했습니다.",
      },
      { status: 400, headers },
    );
  }
}

export default function SuggestionPilot({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8">
      <Link
        className="inline-flex items-center gap-1 text-sm text-muted-foreground underline underline-offset-4"
        to={`/projects/${loaderData.project.id}`}
      >
        <ArrowLeft className="size-4" /> 프로젝트로 돌아가기
      </Link>
      <header className="mt-5 border-b pb-8">
        <p className="text-sm font-bold text-violet-700">
          STAFF-ONLY · FEATURE FLAG
        </p>
        <h1 className="mt-2 text-3xl font-bold">외부 모델 제안 파일럿</h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          모델을 이 웹앱에서 호출하지 않습니다. 별도 환경에서 만든 제안 JSON을
          검증해 가져오며, 수량·금액·상태·승인 필드가 하나라도 있으면 전체
          파일을 거부합니다. 사람 결정 전에는 아무 효력이 없습니다.
        </p>
      </header>
      {actionData?.error ? (
        <p className="mt-6 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {actionData.error}
        </p>
      ) : null}
      <section className="mt-8 rounded-2xl border bg-card p-6">
        <div className="flex items-center gap-3">
          <FlaskConical className="size-6 text-violet-700" />
          <div>
            <h2 className="font-semibold">검증된 JSON 가져오기</h2>
            <p className="text-sm text-muted-foreground">
              현재 외부 제안 {loaderData.importedCount}건
            </p>
          </div>
        </div>
        <Form
          className="mt-5 grid gap-4"
          encType="multipart/form-data"
          method="post"
        >
          <div className="grid gap-2">
            <Label htmlFor="pilot-source">제안이 참조한 원본</Label>
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              id="pilot-source"
              name="source_file_id"
              required
            >
              <option value="">선택하세요</option>
              {loaderData.files.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.original_filename} · {file.sha256.slice(0, 12)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pilot-payload">LUKAS_AI_SUGGESTIONS_V1 JSON</Label>
            <Input
              accept="application/json,.json"
              id="pilot-payload"
              name="payload"
              required
              type="file"
            />
          </div>
          <Button className="w-fit" type="submit">
            <Upload className="size-4" /> 안전 검사 후 가져오기
          </Button>
        </Form>
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">생산자별 검토 품질</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          확정 표본 30건 미만은 통계적으로 충분하다고 표시하지 않으며 자동 승격
          기능은 존재하지 않습니다.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {loaderData.evaluation.map((metric) => (
            <article
              className="rounded-2xl border bg-card p-5"
              key={`${metric.producer_version}/${metric.suggestion_kind}`}
            >
              <p className="font-semibold">{metric.producer_version}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {metric.suggestion_kind} · 총 {metric.total}건
              </p>
              <p className="mt-4 text-sm">
                승인 {metric.accepted} · 기각 {metric.rejected} · 보류{" "}
                {metric.deferred} · 대기 {metric.pending}
              </p>
              <p className="mt-2 text-xs font-medium text-amber-700">
                확정 표본 {metric.accepted + metric.rejected}/
                {metric.minimum_sample_size} · 자동 승격 없음
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
