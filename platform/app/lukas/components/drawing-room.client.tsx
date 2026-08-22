import { useEffect, useRef, useState } from "react";

import { Box, FileText } from "lucide-react";
import { Link, useRevalidator } from "react-router";

import DrawingIssuePanel from "~/lukas/components/drawing-issue-panel";
import IfcPropertyBrowser from "~/lukas/components/ifc-property-browser.client";
import PdfDrawingViewer from "~/lukas/components/pdf-drawing-viewer.client";
import type { DrawingProjectRole } from "~/lukas/lib/drawing-collaboration-policy";
import type { DrawingAssignee } from "~/lukas/lib/drawing-collaboration.server";
import type { DrawingFile, DrawingIssue } from "~/lukas/lib/drawing-collaboration.types";
import type { DrawingRevisionReviewItem } from "~/lukas/lib/drawing-revision.server";

type Comment = {
  id: string;
  issue_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

export default function DrawingRoomClient({
  projectId,
  file,
  files,
  signedUrl,
  issues,
  comments,
  role,
  initialGlobalId,
  initialIssueId,
  revisionReview,
  assignees,
}: {
  projectId: string;
  file: DrawingFile;
  files: DrawingFile[];
  signedUrl: string;
  issues: DrawingIssue[];
  comments: Comment[];
  role: DrawingProjectRole;
  initialGlobalId: string | null;
  initialIssueId: string | null;
  revisionReview: DrawingRevisionReviewItem[];
  assignees: DrawingAssignee[];
}) {
  const revalidator = useRevalidator();
  const revalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mobileTab, setMobileTab] = useState<"drawing" | "issues">("drawing");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(
    issues.some((issue) => issue.id === initialIssueId)
      ? initialIssueId
      : (issues[0]?.id ?? null),
  );
  const [pendingAnchor, setPendingAnchor] = useState<object | null>(null);

  useEffect(() => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    let cancelled = false;
    let cleanupChannel: (() => void) | null = null;
    const refresh = () => {
      if (revalidateTimer.current) clearTimeout(revalidateTimer.current);
      revalidateTimer.current = setTimeout(() => revalidator.revalidate(), 250);
    };
    void import("@supabase/ssr").then(({ createBrowserClient }) => {
      if (cancelled) return;
      const client = createBrowserClient(url, key);
      const channel = client
        .channel(`drawing-room:${projectId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "lukas_drawing_issues", filter: `project_id=eq.${projectId}` },
          refresh,
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "lukas_drawing_issue_comments", filter: `project_id=eq.${projectId}` },
          refresh,
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "lukas_drawing_issue_events", filter: `project_id=eq.${projectId}` },
          refresh,
        )
        .subscribe();
      cleanupChannel = () => void client.removeChannel(channel);
    });
    return () => {
      cancelled = true;
      if (revalidateTimer.current) clearTimeout(revalidateTimer.current);
      cleanupChannel?.();
    };
  }, [projectId, revalidator]);

  return (
    <>
      <div className="mt-5 grid grid-cols-2 rounded-xl border p-1 lg:hidden">
        <button
          aria-pressed={mobileTab === "drawing"}
          className={`min-h-11 rounded-lg text-sm font-semibold ${mobileTab === "drawing" ? "bg-primary text-primary-foreground" : ""}`}
          onClick={() => setMobileTab("drawing")}
          type="button"
        >
          도면
        </button>
        <button
          aria-pressed={mobileTab === "issues"}
          className={`min-h-11 rounded-lg text-sm font-semibold ${mobileTab === "issues" ? "bg-primary text-primary-foreground" : ""}`}
          onClick={() => setMobileTab("issues")}
          type="button"
        >
          이슈 {issues.length}
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_360px]">
        <aside className={`${mobileTab === "drawing" ? "block" : "hidden"} order-2 rounded-2xl border bg-card p-3 lg:order-1 lg:block`}>
          <h2 className="px-2 py-2 text-sm font-bold">프로젝트 도면</h2>
          <div className="mt-1 flex gap-2 overflow-x-auto lg:block lg:space-y-1">
            {files.map((drawing) => {
              const Icon = drawing.kind === "ifc" ? Box : FileText;
              const active = drawing.id === file.id;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`flex min-w-52 items-center gap-2 rounded-xl px-3 py-3 text-sm lg:min-w-0 ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  key={drawing.id}
                  to={`/projects/${projectId}/drawings/${drawing.id}`}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{drawing.original_filename}</span>
                </Link>
              );
            })}
          </div>
        </aside>

        <section className={`${mobileTab === "drawing" ? "block" : "hidden"} order-1 min-w-0 rounded-2xl border bg-card p-3 lg:order-2 lg:block`}>
          {file.kind === "ifc" ? (
            <IfcPropertyBrowser
              byteSize={file.byte_size}
              fileName={file.original_filename}
              initialGlobalId={initialGlobalId}
              onAnchorSelected={(anchor) => {
                setPendingAnchor({
                  kind: "ifc_element",
                  fileId: file.id,
                  ...anchor,
                  label: `IFC #${anchor.elementId}`,
                });
                setMobileTab("issues");
              }}
              signedUrl={signedUrl}
            />
          ) : (
            <PdfDrawingViewer
              fileName={file.original_filename}
              onRegionSelected={(region) => {
                setPendingAnchor({
                  kind: "pdf_region",
                  fileId: file.id,
                  ...region,
                  label: `${region.pageNumber}쪽 선택 영역`,
                });
                setMobileTab("issues");
              }}
              signedUrl={signedUrl}
            />
          )}
        </section>

        <aside className={`${mobileTab === "issues" ? "block" : "hidden"} order-3 lg:block`}>
          <DrawingIssuePanel
            assignees={assignees}
            comments={comments}
            issues={issues}
            onSelectIssue={setSelectedIssueId}
            pendingAnchor={pendingAnchor}
            projectId={projectId}
            currentFileId={file.id}
            revisionReview={revisionReview}
            role={role}
            selectedIssueId={selectedIssueId}
          />
        </aside>
      </div>
    </>
  );
}
