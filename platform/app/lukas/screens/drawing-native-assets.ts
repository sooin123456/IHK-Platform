import { z } from "zod";
import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
import { loadNativeDrawingCatalog } from "~/lukas/lib/drawing-native-catalog.server";
import { createDrawingDocumentState } from "~/lukas/lib/drawing-commands";
import { exportDrawingSvg } from "~/lukas/lib/drawing-export";

/** Authenticated builtin catalog metadata and canonical SVG previews. */
export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { projectId?: string };
}) {
  const { client, headers, project } = await drawingContext(
    request,
    params.projectId!,
  );
  const search = new URL(request.url).searchParams;
  if (
    [...search.keys()].some((key) => !["kind", "key"].includes(key)) ||
    [...search.keys()].length !== new Set(search.keys()).size
  )
    throw new Response("도면 목록 요청이 올바르지 않습니다.", {
      status: 400,
      headers,
    });
  const kind = z
    .enum(["workspace_template", "block"])
    .safeParse(search.get("kind"));
  if (!kind.success)
    throw new Response("도면 종류가 올바르지 않습니다.", {
      status: 400,
      headers,
    });
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  try {
    const catalog = await loadNativeDrawingCatalog(
      client as any,
      project.id,
      kind.data,
    );
    if (kind.data === "block" && !search.has("key"))
      return Response.json(
        {
          items: catalog.map(
            ({ key, name, description, version, definition }) => ({
              key,
              name,
              description,
              version,
              classification:
                "classification" in definition
                  ? definition.classification
                  : null,
              recommendedLayer:
                "recommendedLayer" in definition
                  ? definition.recommendedLayer
                  : null,
            }),
          ),
        },
        { headers },
      );
    const template = catalog.find(
      (item) => item.key === search.get("key"),
    )?.definition;
    if (!template || !("structure" in template))
      throw new Response("예제 도면을 찾을 수 없습니다.", {
        status: 404,
        headers,
      });
    const { revisionId, ...structure } = template.structure;
    for (const canvas of Object.values(structure.canvases))
      Object.assign(canvas, { outputProfile: { ...template.outputProfile } });
    const canvas = Object.values(structure.canvases)[0];
    const svg = exportDrawingSvg(
      createDrawingDocumentState({ revisionId, structure }),
      canvas.id,
    );
    headers.set("Content-Type", "image/svg+xml; charset=utf-8");
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    return new Response(svg, { headers });
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response("기본 도면을 불러오지 못했습니다.", {
      status: 503,
      headers,
    });
  }
}
