import type { Route } from "./+types/local-drawing-pdf-preview";

import { readFile } from "node:fs/promises";
import path from "node:path";

const representativeDrawing = path.resolve(
  process.cwd(),
  "tests/fixtures/p5-previous-revision.pdf",
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
