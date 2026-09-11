import type { Route } from "./+types/material-control-export";

import {
  assertCompleteMaterialControlExport,
  buildMaterialControlCsv,
} from "~/lukas/lib/material-control.server";
import { recordProjectExport } from "~/lukas/lib/project-export-audit.server";
import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { loader as loadMaterialControl } from "~/lukas/screens/material-control";

export async function loader(args: Route.LoaderArgs) {
  const {
    payload: result,
    client,
    headers,
  } = await loadMaterialControl(args, { materialControlExport: true });
  try {
    assertCompleteMaterialControlExport({
      cursor: result.materialPlanPage.cursor,
      nextCursor: result.materialPlanPage.nextCursor,
      materialPlanId: result.materialPlanId,
    });
    const exportedAt = new Date().toISOString();
    const csv = buildMaterialControlCsv(
      String(result.project.id),
      exportedAt,
      result.summaries,
    );
    const artifact = `\uFEFF${csv}`;
    await recordProjectExport(
      client as any,
      String(result.project.id),
      "material_csv",
      artifact,
    );
    return mergeResponseHeaders(
      new Response(artifact, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="lukas-material-control-${result.project.id}.csv"`,
          "Content-Type": "text/csv; charset=utf-8",
        },
      }),
      headers,
    );
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }
}
