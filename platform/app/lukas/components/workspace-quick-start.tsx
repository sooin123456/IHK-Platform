import {
  ArrowRight,
  ChevronDown,
  FileUp,
  LayoutTemplate,
  PencilLine,
} from "lucide-react";
import { Form, Link, useNavigation } from "react-router";
import type { ReactNode } from "react";
import { cn } from "~/core/lib/utils";

export type QuickStartKind = "blank" | "template" | "file";
export type QuickStartRequest = {
  clientRequestId: string;
  clientCreatedAt: string;
};
export type QuickStartRequests = Record<QuickStartKind, QuickStartRequest>;
export type QuickStartFailure = QuickStartRequest & {
  kind: QuickStartKind;
  message: string;
};
const choices = [
  { kind: "blank", label: "빈 도면 시작", icon: PencilLine },
  { kind: "template", label: "템플릿 선택", icon: LayoutTemplate },
  { kind: "file", label: "파일 열기", icon: FileUp },
] as const;

type Props = {
  requests?: QuickStartRequests;
  failure?: QuickStartFailure;
  previewMode?: boolean;
  presentation?: "menu" | "start";
  footer?: ReactNode;
};

export function WorkspaceQuickStart({
  requests,
  failure,
  previewMode = false,
  presentation = "menu",
  footer,
}: Props) {
  const navigation = useNavigation();
  const pendingIntent = navigation.formData?.get("intent");
  const pending =
    navigation.state !== "idle" &&
    typeof pendingIntent === "string" &&
    pendingIntent.startsWith("quick_");

  function action(kind: QuickStartKind, content: ReactNode, className: string) {
    const request = failure?.kind === kind ? failure : requests?.[kind];
    if (previewMode)
      return (
        <Link className={className} to={`/workspace-preview?state=${presentation === "start" ? "empty" : "default"}&start=${kind}`}>
          {content}
        </Link>
      );
    return (
      <Form method="post">
        <input name="intent" type="hidden" value={`quick_${kind}`} />
        <input
          name="client_request_id"
          type="hidden"
          value={request?.clientRequestId ?? ""}
        />
        <input
          name="client_created_at"
          type="hidden"
          value={request?.clientCreatedAt ?? ""}
        />
        <button
          className={cn(className, "disabled:cursor-wait disabled:opacity-50")}
          disabled={pending || !request}
          type="submit"
        >
          {content}
        </button>
      </Form>
    );
  }
  const error = failure ? (
    <div className="mt-4 rounded-xl bg-destructive/10 p-4 text-sm">
      <p className="text-destructive" role="alert">
        {failure.message}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        같은 요청으로 다시 시도할 수 있습니다. 보존·이동된 기본 프로젝트는 자동
        복구되지 않습니다.
      </p>
      <Link
        className="mt-2 inline-block text-xs font-semibold underline"
        to="#project-list-heading"
      >
        프로젝트에서 시작
      </Link>
    </div>
  ) : null;

  if (presentation === "start")
    return (
      <div>
        <section
          className="relative mt-6 grid min-h-64 overflow-hidden rounded-xl border bg-[#f7f6ff] sm:grid-cols-2 dark:bg-[#222131]"
          aria-label="빈 도면으로 시작"
        >
          <div className="relative z-10 flex flex-col items-start justify-center px-7 py-8 lg:px-8">
            <h2 className="text-xl font-semibold tracking-tight">
              아이디어를 바로 도면으로
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              업로드 없이 시작할 수 있어요.
            </p>
            <div className="mt-7">
              {action(
                "blank",
                pendingIntent === "quick_blank" && pending
                  ? "도면을 여는 중…"
                  : "빈 도면 시작",
                "inline-flex min-h-11 items-center justify-center rounded-lg bg-[#2925d9] px-7 text-sm font-semibold text-white hover:bg-[#211dc0] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2925d9]",
              )}
            </div>
          </div>
          <img
            alt=""
            className="h-full max-h-72 w-full object-cover mix-blend-multiply dark:mix-blend-normal"
            src="/images/workspace-start/hero-plan.png"
          />
        </section>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {choices.slice(1).map(({ kind, label, icon: Icon }) => (
            <div key={kind}>
              {action(
                kind,
                <>
                  <Icon className="size-6" strokeWidth={1.5} />
                  <span className="flex-1 text-left font-semibold">
                    {label}
                  </span>
                  <ArrowRight className="size-4" />
                </>,
                "flex min-h-20 w-full items-center gap-4 rounded-xl border bg-background px-6 text-sm transition hover:border-[#2925d9]/40 hover:bg-[#f7f7ff] focus-visible:outline-2 focus-visible:outline-[#2925d9] dark:hover:bg-white/5",
              )}
            </div>
          ))}
        </div>
        {error}
        <section className="mt-8" aria-label="템플릿 둘러보기">
          <h2 className="text-base font-semibold">템플릿 둘러보기</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            예시 이미지입니다. 실제 템플릿은 선택 화면에서 확인하세요.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {[
              ["office-plan.png", "사무실 평면"],
              ["house-plan.png", "주택 리모델링"],
            ].map(([image, label]) => (
              <div key={image}>
                {action(
                  "template",
                  <>
                    <img
                      alt=""
                      className="h-32 w-1/2 object-contain p-3"
                      src={`/images/workspace-start/${image}`}
                    />
                    <span className="px-3 text-sm font-medium">
                      {label}
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        템플릿 둘러보기
                      </span>
                    </span>
                  </>,
                  "flex min-h-36 w-full items-center overflow-hidden rounded-xl border bg-background text-left hover:border-[#2925d9]/40 focus-visible:outline-2 focus-visible:outline-[#2925d9]",
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    );

  return (
    <details className="group relative" open={failure ? true : undefined}>
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-5 rounded-lg border bg-background px-4 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-[#2925d9]">
        새 작업
        <ChevronDown className="size-4" />
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-[min(21rem,calc(100vw-2rem))] rounded-xl border bg-background p-3 shadow-lg">
        <p className="px-2 py-1 text-xs leading-5 text-muted-foreground">
          {previewMode
            ? "화면 미리보기로 시작합니다. 프로젝트에 저장되지 않습니다."
            : "내 개인 공간의 기본 프로젝트에 안전하게 저장됩니다."}
        </p>
        <div className="mt-2 grid gap-1">
          {choices.map(({ kind, label, icon: Icon }) => (
            <div key={kind}>
              {action(
                kind,
                <>
                  <Icon className="size-4" />
                  {label}
                </>,
                "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-[#2925d9]",
              )}
            </div>
          ))}
        </div>
        {footer ? <div className="mt-2 border-t pt-3">{footer}</div> : null}
        {error}
      </div>
    </details>
  );
}
