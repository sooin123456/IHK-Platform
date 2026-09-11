import type { Route } from "./+types/verified-boq-export";

import { loader as loadVerifiedBoq } from "./verified-boq";

export function requireVerifiedBoqAttachmentResponse(value: unknown) {
  if (
    !(value instanceof Response) ||
    value.status < 200 ||
    value.status >= 300 ||
    !value.headers.get("Content-Disposition")?.startsWith("attachment;")
  )
    throw new Response("현재 상태에서는 내보낼 파일이 없습니다.", {
      status: 409,
      headers: { "Cache-Control": "private, no-store" },
    });
  return value;
}

export async function loader(args: Route.LoaderArgs) {
  return requireVerifiedBoqAttachmentResponse(
    await loadVerifiedBoq(args, {
      verifiedBoqExport: true,
      format: args.params.format,
    }),
  );
}
