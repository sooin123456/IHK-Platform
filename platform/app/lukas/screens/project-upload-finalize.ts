import type { Route } from "./+types/project-upload-finalize";

import { redirect } from "react-router";
import { z } from "zod";

import makeServerClient from "~/core/lib/supa-client.server";
import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { authLoginPath } from "~/features/auth/lib/auth-link.server";
import { parseDrawingWorkspaceUploadReturnTarget } from "~/lukas/lib/drawing-entry";

import { action as projectAction } from "./project";

const maxFinalizationRequestBytes = 2 * 1024;
const finalizationPayloadSchema = z
  .object({
    returnTo: z.string().max(1024).optional(),
    verificationId: z.string().uuid(),
  })
  .strict();

function finalizationRequestError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
    status,
  });
}

async function readBoundedBody(request: Request) {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0)
      throw finalizationRequestError("요청 크기를 확인할 수 없습니다.", 400);
    if (length > maxFinalizationRequestBytes)
      throw finalizationRequestError("파일 등록 요청이 너무 큽니다.", 413);
  }
  if (!request.body)
    throw finalizationRequestError("파일 등록 요청이 비어 있습니다.", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxFinalizationRequestBytes) {
        await reader.cancel();
        throw finalizationRequestError("파일 등록 요청이 너무 큽니다.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function parseProjectUploadFinalizationRequest(request: Request) {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json")
    throw finalizationRequestError(
      "파일 등록은 JSON 요청만 사용할 수 있습니다.",
      415,
    );

  let unknownPayload: unknown;
  try {
    unknownPayload = JSON.parse(await readBoundedBody(request));
  } catch (error) {
    if (error instanceof Response) throw error;
    throw finalizationRequestError("파일 등록 요청이 올바르지 않습니다.", 400);
  }
  const parsed = finalizationPayloadSchema.safeParse(unknownPayload);
  if (!parsed.success)
    throw finalizationRequestError("파일 등록 요청이 올바르지 않습니다.", 400);

  if (parsed.data.returnTo) {
    const projectId = new URL(request.url).pathname.match(
      /^\/projects\/([0-9a-f-]{36})\/files\/finalize-upload$/i,
    )?.[1];
    try {
      if (
        !projectId ||
        !parseDrawingWorkspaceUploadReturnTarget(
          projectId,
          parsed.data.returnTo,
        )
      )
        throw null;
    } catch {
      throw finalizationRequestError(
        "작업실 복귀 주소가 올바르지 않습니다.",
        400,
      );
    }
  }
  return parsed.data;
}

export async function action({ request, params }: Route.ActionArgs) {
  const [client, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user || user.is_anonymous)
    throw redirect(authLoginPath(request.url), { headers });

  let payload: Awaited<
    ReturnType<typeof parseProjectUploadFinalizationRequest>
  >;
  try {
    payload = await parseProjectUploadFinalizationRequest(request);
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }

  const formData = new FormData();
  formData.set("intent", "upload");
  formData.set("upload_response_mode", "browser_recovery");
  formData.set("upload_verification_id", payload.verificationId);
  if (payload.returnTo) formData.set("return_to", payload.returnTo);

  const url = new URL(request.url);
  url.pathname = `/projects/${params.projectId}/files`;
  return projectAction(
    {
      params,
      request: new Request(url, {
        body: formData,
        method: "POST",
        signal: request.signal,
      }),
    } as Parameters<typeof projectAction>[0],
    { client, headers, user },
  );
}
