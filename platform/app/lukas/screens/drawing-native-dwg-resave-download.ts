import type { Route } from "./+types/drawing-native-dwg-resave-download";
import { nativeDrawingDwgResaveDownloadRouteRequest } from "~/lukas/lib/drawing-native-dwg-resave-download.server";
export async function loader(args: Route.LoaderArgs) {
  return nativeDrawingDwgResaveDownloadRouteRequest(args);
}
