import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Route } from "./+types/local-drawing-pdf-current";

const representativeDrawing = path.resolve(
  process.cwd(),
  "tests/fixtures/p5-current-revision.pdf",
);

export async function loader({ request }: Route.LoaderArgs) {
  const hostname = new URL(request.url).hostname;
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(hostname)
  )
    return new Response("Not Found", { status: 404 });
  return new Response(await readFile(representativeDrawing), {
    headers: { "Cache-Control": "no-store", "Content-Type": "application/pdf" },
  });
}
