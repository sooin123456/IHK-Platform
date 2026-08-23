import { lazy, Suspense, useEffect, useState } from "react";

const WorkspacePreviewRoomClient = lazy(
  () => import("~/lukas/components/workspace-preview-room.client"),
);

export default function WorkspacePreviewRoom({
  projectId,
  fileId,
}: {
  projectId: string;
  fileId: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <main className="min-h-screen bg-[#f6f7f9] px-4 py-8 text-[#19191d] dark:bg-[#111214] dark:text-white">
        <div className="mx-auto max-w-[1700px] rounded-2xl border bg-white p-6 dark:border-white/10 dark:bg-[#1a1b1e]">
          <p className="text-sm font-semibold text-[#2925d9] dark:text-[#aaa7ff]">
            근린생활시설 도면 협업 · 도면 작업실
          </p>
          <h1 className="mt-3 text-2xl font-bold">
            도면 작업실을 준비하고 있습니다.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            도면 파일과 도면 이슈를 불러오는 중입니다.
          </p>
        </div>
      </main>
    );
  }

  return (
    <Suspense
      fallback={
        <p className="p-6" role="status">
          도면 작업실을 불러오는 중입니다.
        </p>
      }
    >
      <WorkspacePreviewRoomClient fileId={fileId} projectId={projectId} />
    </Suspense>
  );
}
