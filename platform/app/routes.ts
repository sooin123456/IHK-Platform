import {
  type RouteConfig,
  index,
  layout,
  prefix,
  route,
} from "@react-router/dev/routes";

export default [
  route("/robots.txt", "core/screens/robots.ts"),
  route("/sitemap.xml", "core/screens/sitemap.ts"),
  route("/news.xml", "features/blog/screens/feed.ts"),
  route(
    "/workspace-preview/projects/:projectId/drawings/:fileId",
    "lukas/screens/workspace-preview-room.tsx",
  ),
  route(
    "/workspace-preview/drawing-workspace",
    "lukas/screens/local-drawing-workspace-preview.tsx",
  ),
  route(
    "/workspace-preview/drawing-workspace/operation",
    "lukas/screens/local-drawing-workspace-operation.ts",
  ),
  route("/__p5-current.pdf", "lukas/screens/local-drawing-pdf-current.ts"),
  route("/__p5-previous.pdf", "lukas/screens/local-drawing-pdf-preview.ts"),
  route(
    "/__p5-source-manifest",
    "lukas/screens/local-drawing-p5-source-manifest.ts",
  ),
  layout("core/layouts/navigation.layout.tsx", [
    route("/auth/confirm", "features/auth/screens/confirm.tsx"),
    index("features/home/screens/home.tsx"),
    route("/inquiry", "features/home/screens/inquiry.tsx"),
    route("/privacy", "features/home/screens/privacy.tsx"),
    route("/download", "features/home/screens/download.tsx"),
    route("/download/revit-2025", "features/home/screens/revit-download.ts"),
    route("/news", "features/blog/screens/posts.tsx"),
    route("/news/:slug", "features/blog/screens/post.tsx"),
    route("/share/:token", "lukas/screens/shared-project.tsx"),
    route("/workspace-preview", "lukas/screens/workspace-preview.tsx"),
    layout("core/layouts/public.layout.tsx", [
      route("/login", "features/auth/screens/login-redirect.tsx"),
      route("/join", "features/auth/screens/join.tsx"),
      ...prefix("/auth", [
        route("/magic-link", "features/auth/screens/magic-link.tsx"),
        route("/api/resend", "features/auth/api/resend.tsx"),
      ]),
    ]),
    layout("core/layouts/private.layout.tsx", { id: "private-workspace" }, [
      route("/workspace", "lukas/screens/workspace.tsx"),
      route(
        "/organizations/:organizationId/drawing-library",
        "lukas/screens/organization-drawing-library.tsx",
      ),
      route("/notifications", "lukas/screens/drawing-notifications.tsx"),
      route("/staff/inquiries", "lukas/screens/staff-inquiries.tsx"),
      route("/projects/:projectId", "lukas/screens/project.tsx"),
      route(
        "/projects/:projectId/drawings",
        "lukas/screens/project-drawings.tsx",
      ),
      route(
        "/projects/:projectId/drawings/:fileId",
        "lukas/screens/drawing-room.tsx",
      ),
      route(
        "/projects/:projectId/drawings/:fileId/workspace",
        "lukas/screens/drawing-workspace.tsx",
      ),
      route(
        "/projects/:projectId/drawings/:fileId/workspace/operation",
        "lukas/screens/drawing-workspace-operation.ts",
      ),
      route("/projects/:projectId/files", "lukas/screens/project-files.tsx"),
      route(
        "/projects/:projectId/quantities",
        "lukas/screens/project-quantities.tsx",
      ),
      route("/projects/:projectId/boq", "lukas/screens/verified-boq.tsx"),
      route(
        "/projects/:projectId/reviews",
        "lukas/screens/project-reviews.tsx",
      ),
      route(
        "/projects/:projectId/materials",
        "lukas/screens/material-control.tsx",
      ),
      route(
        "/projects/:projectId/materials.csv",
        "lukas/screens/material-control-export.ts",
      ),
      route(
        "/projects/:projectId/information-requirements",
        "lukas/screens/information-requirements.tsx",
      ),
      route(
        "/projects/:projectId/members",
        "lukas/screens/project-members.tsx",
      ),
      route(
        "/projects/:projectId/element-identities",
        "lukas/screens/element-identities.tsx",
      ),
      route(
        "/projects/:projectId/suggestion-pilot",
        "lukas/screens/suggestion-pilot.tsx",
      ),
      route(
        "/projects/:projectId/ifc/:fileId",
        "lukas/screens/ifc-browser.tsx",
      ),
      route(
        "/projects/:projectId/takeoff/:artifactId",
        "lukas/screens/takeoff-artifact.tsx",
      ),
      route(
        "/projects/:projectId/preflight/:artifactId",
        "lukas/screens/preflight-artifact.tsx",
      ),
      route("/logout", "features/auth/screens/logout.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
