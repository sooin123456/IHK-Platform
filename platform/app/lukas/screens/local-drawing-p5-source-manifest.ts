import { localP5SourceManifest } from "./local-drawing-workspace-preview";

export async function loader({ request }: { request: Request }) {
  const hostname = new URL(request.url).hostname;
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(hostname)
  )
    return new Response("Not Found", { status: 404 });
  return Response.json(localP5SourceManifest(), {
    headers: { "Cache-Control": "no-store" },
  });
}
