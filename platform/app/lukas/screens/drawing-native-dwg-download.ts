import type { Route } from "./+types/drawing-native-dwg-download";

import { nativeDrawingDwgDownloadRouteRequest } from "~/lukas/lib/drawing-native-dwg-download.server";

export async function loader(args: Route.LoaderArgs) {
  return nativeDrawingDwgDownloadRouteRequest(args);
}
