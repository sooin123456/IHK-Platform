import type makeServerClient from "../app/core/lib/supa-client.server.ts";
import type { prepareNativeDrawingDwgProjectImport } from "../app/lukas/lib/drawing-native-dwg-import-source.server.ts";

declare const applicationClient: ReturnType<typeof makeServerClient>[0];

const preparationClient: Parameters<
  typeof prepareNativeDrawingDwgProjectImport
>[0] = applicationClient;

void preparationClient;
