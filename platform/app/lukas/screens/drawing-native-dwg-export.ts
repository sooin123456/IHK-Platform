import type { Route } from "./+types/drawing-native-dwg-export";

import { nativeDrawingDwgExportRouteRequest } from "~/lukas/lib/drawing-native-dwg-export.server";

export async function loader(args: Route.LoaderArgs) {
  return nativeDrawingDwgExportRouteRequest(args);
}

export async function action(args: Route.ActionArgs) {
  return nativeDrawingDwgExportRouteRequest(args);
}
