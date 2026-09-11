/// <reference types="npm:@types/node" />

import { createHash } from "node:crypto";

import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const cors = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
};
const maxUploadBytes = 200 * 1024 * 1024;
const verificationLifetimeMs = 15 * 60 * 1000;
const uploadRoles = new Set(["owner", "staff", "estimator"]);
const kinds = new Set([
  "ifc",
  "pdf",
  "dxf",
  "dwg",
  "qto_csv",
  "element_ledger",
  "formwork_ledger",
  "estimate",
  "mapping",
  "other",
]);
const dxfContentTypes = new Set([
  "application/dxf",
  "application/x-dxf",
  "application/octet-stream",
  "image/vnd.dxf",
  "text/plain",
]);
const pdfContentTypes = new Set(["application/pdf"]);
const pdfMagic = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
const dwgContentTypes = new Set(["application/octet-stream"]);
const dwgHeaderPattern = /^AC[0-9]{4}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const extensionPattern = /\.([A-Za-z0-9]{1,16})$/;

type UploadInput = {
  byteSize: number;
  contentType: string;
  kind: string;
  originalFilename: string;
  storagePath: string;
};

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: cors, status });
}

function parseUploadInput(value: unknown): UploadInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError("파일 검증 요청이 올바르지 않습니다.", 400);
  const input = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(input.byteSize) ||
    (input.byteSize as number) <= 0 ||
    (input.byteSize as number) > maxUploadBytes ||
    typeof input.contentType !== "string" ||
    input.contentType.length > 255 ||
    typeof input.kind !== "string" ||
    !kinds.has(input.kind) ||
    typeof input.originalFilename !== "string" ||
    input.originalFilename.trim().length === 0 ||
    input.originalFilename.length > 255 ||
    typeof input.storagePath !== "string" ||
    input.storagePath.length > 1024
  )
    throw new HttpError("파일 검증 요청이 올바르지 않습니다.", 400);
  return {
    ...(input as UploadInput),
    originalFilename: (input.originalFilename as string).trim(),
  };
}

export function uploadKindMismatchMessage(kind: string, filename: string) {
  return kind === "dxf" && filename.trim().toLowerCase().endsWith(".dwg")
    ? "DWG 원본을 선택해 보관할 수 있지만 도면으로 직접 가져올 수 없습니다. DXF로 변환한 뒤 DXF 도면을 선택해 주세요."
    : null;
}

export function contentTypeMatchesKind(kind: string, contentType: string) {
  const normalized = contentType.trim().toLowerCase();
  if (kind === "dxf") return dxfContentTypes.has(normalized);
  if (kind === "pdf") return pdfContentTypes.has(normalized);
  if (kind === "dwg") return dwgContentTypes.has(normalized);
  return true;
}

function contentTypeMismatchMessage(kind: string) {
  const label = kind === "pdf" ? "PDF" : kind === "dwg" ? "DWG" : "DXF";
  return `${label} 파일 형식 정보가 허용되지 않습니다.`;
}

function missingStoredContentTypeMessage(kind: string) {
  const label = kind === "pdf" ? "PDF" : kind === "dwg" ? "DWG" : "DXF";
  return `${label} 저장소 파일 형식 정보를 확인할 수 없습니다. 파일을 다시 올려주세요.`;
}

export function authoritativeStoredContentType(
  kind: string,
  storedContentType: unknown,
  requestContentType: string,
) {
  if (
    typeof storedContentType === "string" &&
    storedContentType.trim().length > 0 &&
    storedContentType.length <= 255
  )
    return storedContentType;
  return kind === "dxf" || kind === "pdf" || kind === "dwg"
    ? null
    : requestContentType;
}

export function fileMatchesKind(kind: string, filename: string) {
  const lower = filename.trim().toLowerCase();
  if (kind === "other") return true;
  if (kind === "ifc") return lower.endsWith(".ifc");
  if (kind === "pdf") return lower.endsWith(".pdf");
  if (kind === "dxf") return lower.endsWith(".dxf");
  if (kind === "dwg") return lower.endsWith(".dwg");
  if (kind === "estimate")
    return [".csv", ".xls", ".xlsx"].some((extension) =>
      lower.endsWith(extension),
    );
  return lower.endsWith(".csv");
}

function validStoragePath(
  storagePath: string,
  ownerId: string,
  projectId: string,
  originalFilename: string,
) {
  const segments = storagePath.split("/");
  if (segments.length !== 4 || segments[2] !== "source-uploads") return false;
  const objectId = segments[3].slice(0, 36);
  if (!uuidPattern.test(objectId)) return false;
  const extension =
    originalFilename
      .normalize("NFKC")
      .match(extensionPattern)?.[0]
      .toLowerCase() ?? "";
  return (
    storagePath ===
    `${ownerId.toLowerCase()}/${projectId.toLowerCase()}/source-uploads/${objectId.toLowerCase()}${extension}`
  );
}

type UploadVerifyDependencies = {
  createClient: typeof createClient;
  getEnv: (name: string) => string | undefined;
};

export function createUploadVerifyHandler({
  createClient: makeClient = createClient,
  getEnv = (name) => Deno.env.get(name),
}: Partial<UploadVerifyDependencies> = {}) {
  return async (request: Request) => {
    if (request.method === "OPTIONS")
      return new Response("ok", { headers: cors });
    if (request.method !== "POST")
      return json({ error: "지원하지 않는 요청입니다." }, 405);

    try {
      const authorization = request.headers.get("Authorization");
      if (!authorization) throw new HttpError("로그인이 필요합니다.", 401);
      const accessToken = authorization.match(/^Bearer\s+(\S+)$/i)?.[1];
      if (!accessToken) throw new HttpError("로그인이 필요합니다.", 401);
      const supabaseUrl = getEnv("SUPABASE_URL");
      const anonKey = getEnv("SUPABASE_ANON_KEY");
      const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !anonKey || !serviceKey)
        throw new HttpError("파일 검증 서버 설정이 없습니다.", 500);

      const input = parseUploadInput(await request.json());
      const storagePath = input.storagePath;
      if (!fileMatchesKind(input.kind, input.originalFilename))
        throw new HttpError(
          uploadKindMismatchMessage(input.kind, input.originalFilename) ??
            "선택한 자료 종류와 파일 형식이 맞지 않습니다.",
          400,
        );
      if (!contentTypeMatchesKind(input.kind, input.contentType))
        throw new HttpError(contentTypeMismatchMessage(input.kind), 400);

      const client = makeClient(supabaseUrl, anonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: authorization } },
      });
      const admin = makeClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const {
        data: { user },
        error: userError,
      } = await client.auth.getUser(accessToken);
      if (userError || !user || user.is_anonymous)
        throw new HttpError("로그인이 필요합니다.", 401);

      const pathProjectId = storagePath.split("/")[1] ?? "";
      if (!uuidPattern.test(pathProjectId))
        throw new HttpError("프로젝트 파일 경로가 올바르지 않습니다.", 400);
      const { data: project, error: projectError } = await client
        .from("lukas_qto_projects")
        .select("id, owner_id")
        .eq("id", pathProjectId)
        .maybeSingle();
      if (projectError || !project)
        throw new HttpError("프로젝트 접근 권한이 없습니다.", 404);

      let role =
        user.app_metadata?.role === "hangil_staff"
          ? "staff"
          : project.owner_id === user.id
            ? "owner"
            : null;
      if (!role) {
        const { data: membership, error: membershipError } = await client
          .from("lukas_qto_project_members")
          .select("role")
          .eq("project_id", project.id)
          .eq("user_id", user.id)
          .maybeSingle();
        if (membershipError)
          throw new HttpError("프로젝트 역할을 확인하지 못했습니다.", 500);
        role = membership?.role ?? null;
      }
      if (!role || !uploadRoles.has(role))
        throw new HttpError("이 프로젝트의 파일을 올릴 권한이 없습니다.", 403);
      if (
        !validStoragePath(
          storagePath,
          project.owner_id,
          project.id,
          input.originalFilename,
        )
      )
        throw new HttpError("프로젝트 파일 경로가 올바르지 않습니다.", 400);

      const { data: existingFile, error: existingFileError } = await client
        .from("lukas_qto_files")
        .select("id")
        .eq("storage_path", storagePath)
        .maybeSingle();
      if (existingFileError)
        throw new HttpError("파일 등록 상태를 확인하지 못했습니다.", 500);
      if (existingFile)
        throw new HttpError("이미 등록된 원본 파일입니다.", 409);

      const storage = client.storage.from("lukas-qto");
      const { data: storedObject, error: storedObjectError } =
        await storage.info(storagePath);
      if (storedObjectError || !storedObject)
        throw new HttpError("업로드된 파일을 찾지 못했습니다.", 400);
      if (storedObject.size !== input.byteSize)
        throw new HttpError("업로드된 파일 크기가 원본과 다릅니다.", 400);
      const storedContentType = authoritativeStoredContentType(
        input.kind,
        (storedObject as { contentType?: unknown }).contentType,
        input.contentType,
      );
      if (storedContentType === null)
        throw new HttpError(missingStoredContentTypeMessage(input.kind), 400);
      if (!contentTypeMatchesKind(input.kind, storedContentType))
        throw new HttpError(contentTypeMismatchMessage(input.kind), 400);

      const { data: sourceStream, error: sourceError } = await storage
        .download(storagePath)
        .asStream();
      if (sourceError || !sourceStream)
        throw new HttpError("업로드된 파일을 읽지 못했습니다.", 400);
      const hash = createHash("sha256");
      const reader = sourceStream.getReader();
      let byteSize = 0;
      const signature = new Uint8Array(
        input.kind === "dwg" ? 6 : pdfMagic.byteLength,
      );
      let signatureByteSize = 0;
      let dwgHeaderVersion: string | null = null;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          byteSize += value.byteLength;
          if (byteSize > maxUploadBytes) {
            await reader.cancel();
            throw new HttpError("파일은 200MB까지 올릴 수 있습니다.", 413);
          }
          if (
            (input.kind === "pdf" || input.kind === "dwg") &&
            signatureByteSize < signature.byteLength
          ) {
            const remaining = signature.byteLength - signatureByteSize;
            const inspectedByteSize = Math.min(remaining, value.byteLength);
            signature.set(
              value.subarray(0, inspectedByteSize),
              signatureByteSize,
            );
            signatureByteSize += inspectedByteSize;
            if (signatureByteSize === signature.byteLength) {
              if (
                input.kind === "pdf" &&
                signature.some((byte, index) => byte !== pdfMagic[index])
              ) {
                await reader.cancel();
                throw new HttpError("PDF 파일 내용이 올바르지 않습니다.", 400);
              }
              if (input.kind === "dwg") {
                const header = String.fromCharCode(...signature);
                if (!dwgHeaderPattern.test(header)) {
                  await reader.cancel();
                  throw new HttpError(
                    "DWG 파일 내용이 올바르지 않습니다.",
                    400,
                  );
                }
                dwgHeaderVersion = header;
              }
            }
          }
          hash.update(value);
        }
      } finally {
        reader.releaseLock();
      }
      if (input.kind === "pdf" && signatureByteSize < pdfMagic.byteLength)
        throw new HttpError("PDF 파일 내용이 올바르지 않습니다.", 400);
      if (input.kind === "dwg" && signatureByteSize < signature.byteLength)
        throw new HttpError("DWG 파일 내용이 올바르지 않습니다.", 400);
      if (byteSize !== input.byteSize)
        throw new HttpError("업로드된 파일 크기가 원본과 다릅니다.", 400);
      const sha256 = hash.digest("hex");

      const verifiedRecord = {
        actor_id: user.id,
        byte_size: byteSize,
        content_type: storedContentType,
        dwg_header_version: dwgHeaderVersion,
        kind: input.kind,
        original_filename: input.originalFilename,
        project_id: project.id,
        sha256,
        storage_path: storagePath,
      };
      const { data: verification, error: verificationError } = await admin
        .from("lukas_qto_verified_uploads")
        .insert(verifiedRecord)
        .select("id")
        .single();
      if (verificationError || !verification) {
        if (verificationError?.code !== "23505")
          throw new HttpError("파일 검증 기록을 저장하지 못했습니다.", 500);
        const { data: existingVerification, error: existingVerificationError } =
          await admin
            .from("lukas_qto_verified_uploads")
            .select(
              "id, actor_id, byte_size, consumed_file_id, content_type, dwg_header_version, expires_at, kind, original_filename, project_id, sha256, storage_path",
            )
            .eq("storage_path", storagePath)
            .maybeSingle();
        const sameEvidence =
          existingVerification?.actor_id === verifiedRecord.actor_id &&
          existingVerification?.byte_size === verifiedRecord.byte_size &&
          existingVerification?.content_type === verifiedRecord.content_type &&
          existingVerification?.dwg_header_version ===
            verifiedRecord.dwg_header_version &&
          existingVerification?.kind === verifiedRecord.kind &&
          existingVerification?.original_filename ===
            verifiedRecord.original_filename &&
          existingVerification?.project_id === verifiedRecord.project_id &&
          existingVerification?.sha256 === verifiedRecord.sha256 &&
          existingVerification?.storage_path === verifiedRecord.storage_path;
        if (
          existingVerificationError ||
          !existingVerification ||
          !sameEvidence ||
          existingVerification.consumed_file_id
        )
          throw new HttpError(
            "이 파일 경로의 검증 기록이 이미 사용됐습니다. 파일을 다시 올려주세요.",
            409,
          );
        if (Date.parse(existingVerification.expires_at) <= Date.now()) {
          const { data: refreshedVerification, error: refreshError } =
            await admin
              .from("lukas_qto_verified_uploads")
              .update({
                expires_at: new Date(
                  Date.now() + verificationLifetimeMs,
                ).toISOString(),
              })
              .eq("id", existingVerification.id)
              .is("consumed_file_id", null)
              .select("id")
              .maybeSingle();
          if (refreshError || !refreshedVerification)
            throw new HttpError(
              "이 파일 경로의 검증 기록이 이미 사용됐습니다. 파일을 다시 올려주세요.",
              409,
            );
          return json({ verificationId: refreshedVerification.id });
        }
        return json({ verificationId: existingVerification.id });
      }

      return json({ verificationId: verification.id });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message =
        error instanceof HttpError
          ? error.message
          : "파일 검증 중 오류가 발생했습니다.";
      if (!(error instanceof HttpError)) console.error(error);
      return json({ error: message }, status);
    }
  };
}

Deno.serve(createUploadVerifyHandler());
