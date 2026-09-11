import type { Route } from "./+types/drawing-workspace-export";

import { drawingWorkspaceExportAction } from "./drawing-workspace-export.server";

export async function action(args: Route.ActionArgs) {
  return drawingWorkspaceExportAction(args);
}
