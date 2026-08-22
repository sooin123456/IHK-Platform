import {
  Calculator,
  FileUp,
  Home,
  ListChecks,
  PackageCheck,
} from "lucide-react";
import { Link } from "react-router";

import { cn } from "~/core/lib/utils";

export type ProjectWorkspaceView =
  | "overview"
  | "files"
  | "quantities"
  | "reviews"
  | "materials";

const items = [
  { key: "overview", label: "개요", icon: Home, suffix: "" },
  { key: "files", label: "파일", icon: FileUp, suffix: "/files" },
  {
    key: "quantities",
    label: "물량",
    icon: Calculator,
    suffix: "/quantities",
  },
  { key: "reviews", label: "검토", icon: ListChecks, suffix: "/reviews" },
  {
    key: "materials",
    label: "자재",
    icon: PackageCheck,
    suffix: "/materials",
  },
] as const;

export function ProjectWorkspaceNav({
  projectId,
  current,
  pendingQuantities = 0,
  pendingReviews = 0,
}: {
  projectId: string;
  current: ProjectWorkspaceView;
  pendingQuantities?: number;
  pendingReviews?: number;
}) {
  return (
    <>
      <nav
        aria-label="프로젝트 업무"
        className="mt-6 hidden grid-cols-5 gap-1 rounded-2xl border bg-card p-1.5 shadow-sm sm:grid"
      >
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.key === current;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-[#3024d8] text-white"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              key={item.key}
              to={`/projects/${projectId}${item.suffix}`}
            >
              <Icon className="size-4" />
              {item.label}
              {item.key === "quantities" && pendingQuantities > 0 ? (
                <span
                  aria-label={`물량 확인 대기 ${pendingQuantities}건`}
                  className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                >
                  {pendingQuantities > 99 ? "99+" : pendingQuantities}
                </span>
              ) : item.key === "reviews" && pendingReviews > 0 ? (
                <span
                  aria-label={`검토 대기 ${pendingReviews}건`}
                  className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                >
                  {pendingReviews > 99 ? "99+" : pendingReviews}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <nav
        aria-label="프로젝트 모바일 업무"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background/95 px-1 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:hidden"
      >
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.key === current;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold",
                active ? "text-[#3024d8]" : "text-muted-foreground",
              )}
              key={item.key}
              to={`/projects/${projectId}${item.suffix}`}
            >
              <Icon className="size-5" strokeWidth={active ? 2.5 : 2} />
              {item.label}
              {item.key === "quantities" && pendingQuantities > 0 ? (
                <span
                  aria-label={`물량 확인 대기 ${pendingQuantities}건`}
                  className="absolute right-[20%] top-1.5 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[9px] font-bold leading-4 text-white"
                >
                  {pendingQuantities > 99 ? "99+" : pendingQuantities}
                </span>
              ) : item.key === "reviews" && pendingReviews > 0 ? (
                <span
                  aria-label={`검토 대기 ${pendingReviews}건`}
                  className="absolute right-[20%] top-1.5 min-w-4 rounded-full bg-amber-500 px-1 text-center text-[9px] font-bold leading-4 text-white"
                >
                  {pendingReviews > 99 ? "99+" : pendingReviews}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
