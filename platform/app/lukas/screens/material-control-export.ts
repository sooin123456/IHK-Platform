import type { Route } from "./+types/material-control-export";

import { buildMaterialControlCsv } from "~/lukas/lib/material-control.server";
import { recordProjectExport } from "~/lukas/lib/project-export-audit.server";
import makeServerClient from "~/core/lib/supa-client.server";
import { loader as loadMaterialControl } from "~/lukas/screens/material-control";

export async function loader(args: Route.LoaderArgs) {
  const result = await loadMaterialControl(args as never);
  const exportedAt = new Date().toISOString();
  const csv = buildMaterialControlCsv(
    String(result.project.id),
    exportedAt,
    result.summaries,
  );
  const artifact = `\uFEFF${csv}`;
  const [client] = makeServerClient(args.request);
  await recordProjectExport(
    client as any,
    String(result.project.id),
    "material_csv",
    artifact,
  );
  return new Response(artifact, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="lukas-material-control-${result.project.id}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
