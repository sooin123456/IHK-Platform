import type { Route } from "./+types/local-drawing-pdf-preview";

import { readFile } from "node:fs/promises";

const representativeDrawing = new URL(
  "../../../../.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-10-artifacts/representative-drawing.pdf",
  import.meta.url,
);

function isLocalPreviewRequest(request: Request) {
  if (process.env.NODE_ENV === "production") return false;
  const hostname = new URL(request.url).hostname;
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  if (!isLocalPreviewRequest(request))
    return new Response("Not Found", { status: 404 });
  return new Response(await readFile(representativeDrawing), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/pdf",
    },
  });
}
