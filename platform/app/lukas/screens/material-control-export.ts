import type { Route } from "./+types/material-control-export";

import { buildMaterialControlCsv } from "~/lukas/lib/material-control.server";
import { loader as loadMaterialControl } from "~/lukas/screens/material-control";

export async function loader(args: Route.LoaderArgs) {
  const result = await loadMaterialControl(args as never);
  const exportedAt = new Date().toISOString();
  const csv = buildMaterialControlCsv(
    String(result.project.id),
    exportedAt,
    result.summaries,
  );
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="lukas-material-control-${result.project.id}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
