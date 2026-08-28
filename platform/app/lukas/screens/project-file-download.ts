import type { Route } from "./+types/project-file-download";

import { redirect } from "react-router";

import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
import { resolveProjectFileDownload } from "~/lukas/lib/project-file-download.server";

/** Original-file capability is minted only after an explicit user navigation. */
export async function loader({ request, params }: Route.LoaderArgs) {
  const { client, headers, project } = await drawingContext(
    request,
    params.projectId!,
  );
  const signedUrl = await resolveProjectFileDownload(client, {
    projectId: project.id,
    fileId: params.fileId!,
  });
  throw redirect(signedUrl, { headers });
}
