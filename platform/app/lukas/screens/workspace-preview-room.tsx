import type { Route } from "./+types/workspace-preview-room";

import { data } from "react-router";

import { localWorkspacePreviewTarget } from "~/features/auth/lib/local-workspace-preview.server";
import WorkspacePreviewRoomClient from "~/lukas/components/workspace-preview-room";

export const meta: Route.MetaFunction = () => [
  { title: "로컬 도면 작업실 | 1HK Platform" },
];

export function loader({ request, params }: Route.LoaderArgs) {
  if (!localWorkspacePreviewTarget(request.url)) {
    throw new Response("Not Found", { status: 404 });
  }
  return data({
    projectId: params.projectId ?? "preview-community-center",
    fileId: params.fileId ?? "preview-drawing",
  });
}

export default function WorkspacePreviewRoom({
  loaderData,
}: Route.ComponentProps) {
  return <WorkspacePreviewRoomClient {...loaderData} />;
}
