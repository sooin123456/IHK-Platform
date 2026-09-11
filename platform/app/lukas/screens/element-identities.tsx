import type { Route } from "./+types/element-identities";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "database.types";
import { ArrowLeft, Link2 } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";
import { z } from "zod";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import makeServerClient from "~/core/lib/supa-client.server";
import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { authLoginPath } from "~/features/auth/lib/auth-link.server";
import { verifyElementIdentityPair } from "~/lukas/lib/element-identity-link.server";

const maxLedgerBytes = 20 * 1024 * 1024;
const maxIfcBytes = 200 * 1024 * 1024;
type IdentityRow = {
  id: string;
  project_id: string;
  element_ledger_file_id: string;
  element_ledger_sha256: string;
  revit_element_id: string;
  ifc_file_id: string;
  ifc_sha256: string;
  ifc_global_id: string;
  classification_namespace: string;
  classification_code: string;
  classification_version: string;
  classification_label: string;
  confirmed_by: string;
  created_at: string;
};
type IdentityDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      lukas_qto_element_identity_links: {
        Row: IdentityRow;
        Insert: Omit<IdentityRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
    };
  };
};

async function context(request: Request, projectId: string) {
  const [rawClient, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await rawClient.auth.getUser();
  if (!user || user.is_anonymous)
    throw redirect(authLoginPath(request.url), { headers });
  const { data: project } = await rawClient
    .from("lukas_qto_projects")
    .select("id, name")
    .eq("id", projectId)
    .single();
  if (!project)
    throw mergeResponseHeaders(
      new Response("프로젝트를 찾을 수 없습니다.", { status: 404 }),
      headers,
    );
  return {
    client: rawClient as unknown as SupabaseClient<IdentityDatabase>,
    headers,
    project,
    user,
  };
}

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page?.project
      ? `${page.project.name} 요소 연결 | 한길시스템`
      : "요소 연결",
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
      { data: links, error: linksError },
    ] = await Promise.all([
      client
        .from("lukas_qto_files")
        .select(
          "id, kind, original_filename, sha256, storage_path, byte_size, created_at",
        )
        .eq("project_id", project.id)
        .in("kind", ["element_ledger", "ifc"])
        .order("created_at", { ascending: false }),
      client
        .from("lukas_qto_element_identity_links")
        .select(
          "id, revit_element_id, ifc_global_id, classification_namespace, classification_code, classification_version, classification_label, created_at",
        )
        .eq("project_id", project.id)
        .order("created_at", { ascending: false }),
    ]);
    if (filesError || linksError)
      throw new Response("요소 연결 자료를 불러오지 못했습니다.", {
        status: 500,
      });
    return data(
      { project, files: files ?? [], links: links ?? [] },
      { headers },
    );
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  const { client, headers, project, user } = await context(
    request,
    params.projectId!,
  );
  const form = await request.formData();
  try {
    const input = z
      .object({
        ledger_id: z.string().uuid(),
        ifc_id: z.string().uuid(),
        revit_element_id: z.string().regex(/^[1-9][0-9]{0,18}$/),
        ifc_global_id: z.string().regex(/^[0-9A-Za-z_$]{22}$/),
        classification_namespace: z.string().trim().min(1).max(200),
        classification_code: z.string().trim().min(1).max(200),
        classification_version: z.string().trim().min(1).max(120),
        classification_label: z.string().trim().max(240),
        confirmed: z.literal("yes"),
      })
      .parse(Object.fromEntries(form));
    const { data: selected, error: fileError } = await client
      .from("lukas_qto_files")
      .select("id, kind, storage_path, sha256, byte_size")
      .eq("project_id", project.id)
      .in("id", [input.ledger_id, input.ifc_id]);
    if (fileError || !selected || selected.length !== 2)
      throw new Error("선택한 두 원본 파일을 찾지 못했습니다.");
    const ledger = selected.find(
      (file) => file.id === input.ledger_id && file.kind === "element_ledger",
    );
    const ifc = selected.find(
      (file) => file.id === input.ifc_id && file.kind === "ifc",
    );
    if (!ledger || !ifc)
      throw new Error("요소 원장과 IFC 파일 종류가 올바르지 않습니다.");
    if (ledger.byte_size > maxLedgerBytes || ifc.byte_size > maxIfcBytes)
      throw new Error("요소 원장 20MB, IFC 200MB 한도를 확인하세요.");
    const [
      { data: ledgerBlob, error: ledgerError },
      { data: ifcBlob, error: ifcError },
    ] = await Promise.all([
      client.storage.from("lukas-qto").download(ledger.storage_path),
      client.storage.from("lukas-qto").download(ifc.storage_path),
    ]);
    if (ledgerError || ifcError || !ledgerBlob || !ifcBlob)
      throw new Error("등록된 원본을 다시 읽지 못했습니다.");
    const verified = verifyElementIdentityPair(
      new Uint8Array(await ledgerBlob.arrayBuffer()),
      new Uint8Array(await ifcBlob.arrayBuffer()),
      input.revit_element_id,
      input.ifc_global_id,
    );
    if (
      verified.ledgerSha256 !== ledger.sha256 ||
      verified.ifcSha256 !== ifc.sha256
    )
      throw new Error("등록 당시 원본과 현재 파일이 다릅니다.");
    const { error } = await client
      .from("lukas_qto_element_identity_links")
      .insert({
        project_id: project.id,
        element_ledger_file_id: ledger.id,
        element_ledger_sha256: ledger.sha256,
        revit_element_id: input.revit_element_id,
        ifc_file_id: ifc.id,
        ifc_sha256: ifc.sha256,
        ifc_global_id: input.ifc_global_id,
        classification_namespace: input.classification_namespace,
        classification_code: input.classification_code,
        classification_version: input.classification_version,
        classification_label: input.classification_label,
        confirmed_by: user.id,
      });
    if (error) throw error;
    return redirect(`/projects/${project.id}/element-identities`, { headers });
  } catch (error) {
    return data(
      {
        error:
          error instanceof Error
            ? error.message
            : "요소 연결을 저장하지 못했습니다.",
      },
      { status: 400, headers },
    );
  }
}

export default function ElementIdentities({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const ledgers = loaderData.files.filter(
    (file) => file.kind === "element_ledger",
  );
  const ifcs = loaderData.files.filter((file) => file.kind === "ifc");
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
          TRACEABLE ELEMENT IDENTITY
        </p>
        <h1 className="mt-2 text-3xl font-bold">Revit·IFC·공종분류 연결</h1>
        <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
          자동 추정하지 않습니다. Revit Element ID와 IFC GlobalId가 각 원본에
          실제 존재하는지 다시 확인한 뒤, 담당자가 적용한 분류체계와 코드를
          기록합니다.
        </p>
      </header>
      {actionData?.error ? (
        <p className="mt-6 rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
          {actionData.error}
        </p>
      ) : null}
      <section className="mt-8 rounded-2xl border bg-card p-6">
        <Form className="grid gap-4 md:grid-cols-2" method="post">
          <div className="grid gap-2">
            <Label htmlFor="identity-ledger">요소 원장</Label>
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              id="identity-ledger"
              name="ledger_id"
              required
            >
              <option value="">선택하세요</option>
              {ledgers.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.original_filename} · {file.sha256.slice(0, 12)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="identity-ifc">IFC 파일</Label>
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              id="identity-ifc"
              name="ifc_id"
              required
            >
              <option value="">선택하세요</option>
              {ifcs.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.original_filename} · {file.sha256.slice(0, 12)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="revit-id">Revit Element ID</Label>
            <Input
              id="revit-id"
              inputMode="numeric"
              name="revit_element_id"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ifc-global-id">IFC GlobalId (22자리)</Label>
            <Input
              id="ifc-global-id"
              maxLength={22}
              minLength={22}
              name="ifc_global_id"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="classification-namespace">분류체계</Label>
            <Input
              id="classification-namespace"
              name="classification_namespace"
              placeholder="예: 조달청 공사코드, KOCS"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="classification-code">분류코드</Label>
            <Input
              id="classification-code"
              name="classification_code"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="classification-version">분류 버전</Label>
            <Input
              id="classification-version"
              name="classification_version"
              placeholder="예: 2026-01"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="classification-label">품목명</Label>
            <Input id="classification-label" name="classification_label" />
          </div>
          <label className="flex items-start gap-2 text-sm md:col-span-2">
            <input
              className="mt-1"
              name="confirmed"
              required
              type="checkbox"
              value="yes"
            />
            <span>
              두 원본의 식별자와 적용 분류를 직접 확인했습니다. 이 기록은 AI
              자동승인이 아닙니다.
            </span>
          </label>
          <Button className="w-fit md:col-span-2" type="submit">
            <Link2 className="size-4" /> 검증하고 연결 기록
          </Button>
        </Form>
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">
          확정된 연결 {loaderData.links.length}건
        </h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="p-4">Revit ID</th>
                <th>IFC GlobalId</th>
                <th>분류체계</th>
                <th>코드</th>
                <th>버전</th>
                <th>품목명</th>
              </tr>
            </thead>
            <tbody>
              {loaderData.links.map((item) => (
                <tr className="border-b last:border-0" key={item.id}>
                  <td className="p-4 font-mono">{item.revit_element_id}</td>
                  <td className="font-mono">{item.ifc_global_id}</td>
                  <td>{item.classification_namespace}</td>
                  <td>{item.classification_code}</td>
                  <td>{item.classification_version}</td>
                  <td>{item.classification_label || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
