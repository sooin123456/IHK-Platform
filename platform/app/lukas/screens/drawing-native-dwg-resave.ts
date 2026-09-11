import type { Route } from "./+types/drawing-native-dwg-resave";
import { nativeDrawingDwgResaveRouteRequest } from "~/lukas/lib/drawing-native-dwg-resave-resource.server";
export async function loader(args: Route.LoaderArgs) {
  return nativeDrawingDwgResaveRouteRequest(args);
}
export async function action(args: Route.ActionArgs) {
  return nativeDrawingDwgResaveRouteRequest(args);
}
