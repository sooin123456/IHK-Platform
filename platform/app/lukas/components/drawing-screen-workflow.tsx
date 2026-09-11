import {
  CheckCircle2,
  FileCheck2,
  MessageSquareText,
  Send,
} from "lucide-react";
import { type Dispatch, type SetStateAction, useEffect,useRef, useState } from "react";

import { Button } from "~/core/components/ui/button";
import { DrawingTeamPreview } from "./drawing-team-preview";
import { DrawingChangeReportPreview } from "./project-change-preview";
import type { ReviewLoopState } from "./drawing-review-loop";
import type {ChangeRequestPreview} from "./drawing-change-request-preview";
import type {DrawingRequestSnapshot} from "./drawing-request-snapshot";
import { DrawingDeliveryPreview, DrawingDeliveryHistory, DrawingDeliveryRequestEvidence, initialDeliveryConfiguration } from "./drawing-delivery-preview";
import {parseDeliveryDraft,type DeliveryDraft} from "./drawing-delivery-draft";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/core/components/ui/dialog";

export type DrawingScreenWorkflowPanel = "review" | "export" | "share" | null;
export type DrawingScreenReviewState =
  | "draft"
  | "requested"
  | "reviewed"
  | "changes"
  | "approved";

export type DrawingScreenWorkflowProps = {
  open: DrawingScreenWorkflowPanel;
  onOpenChange: (next: DrawingScreenWorkflowPanel) => void;
  documentName: string;
  page: number;
  pageCount: number;
  ready: boolean;
  viewer: boolean;
  returnHref: string;
  reviewState: DrawingScreenReviewState;
  reviewContext?: { revision: number; page: number;targetName?:string };
  reviewLoop?: ReviewLoopState;
  onLocateReview?: () => void;
  onReviewStateChange: (next: DrawingScreenReviewState) => void;
  deliveryDraftKey?:string;
  approvedRequest?:ChangeRequestPreview;
  drawingSnapshot?:DrawingRequestSnapshot;
  onClearApprovedRequest?:()=>void;
};

const fieldClassName =
  "min-h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#2925d9]/30";

function SimulationBadge() {
  return (
    <p className="rounded-lg border border-[#dedaef] bg-[#f4f3ff] px-3 py-2 text-xs font-semibold text-[#2925d9]">
      화면 시뮬레이션 · 전송·승인·파일 생성 없음
    </p>
  );
}

function PanelHeading({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="grid gap-2">
      <h2 className="text-lg font-semibold leading-none">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function DocumentContext({
  documentName,
  page,
  pageCount,
}: {
  documentName: string;
  page: number;
  pageCount: number;
}) {
  const total = Math.max(1, pageCount);
  const current = Math.min(Math.max(1, page), total);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border bg-muted/35 p-4 text-sm">
      <dt className="text-muted-foreground">도면</dt>
      <dd className="min-w-0 truncate font-medium">{documentName}</dd>
      <dt className="text-muted-foreground">페이지</dt>
      <dd className="font-medium tabular-nums">
        {pageCount > 0 ? `${current} / ${total}쪽` : "—"}
      </dd>
    </dl>
  );
}

function ViewerReview({
  onReturnToDrawing,
  returnHref,
  reviewState,
}: {
  onReturnToDrawing: () => void;
  returnHref: string;
  reviewState: DrawingScreenReviewState;
}) {
  const label = {
    approved: "승인 완료 화면 예시",
    changes: "변경 요청 화면 예시",
    draft: "검토 전 초안 화면 예시",
    requested: "검토 요청 상태 화면 예시",
    reviewed: "검토 완료 · 최종 승인 대기 화면 예시",
  }[reviewState];
  return (
    <section className="rounded-xl border p-4">
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        보기 전용입니다. 상태와 검토 안내만 확인할 수 있습니다.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button onClick={onReturnToDrawing} type="button" variant="outline">
          도면으로 돌아가기
        </Button>
        <Button asChild variant="outline">
          <a href={returnHref}>프로젝트/시작 화면으로 돌아가기</a>
        </Button>
      </div>
    </section>
  );
}

export type DrawingScreenReviewSession = {
  changeReason: string;
  checks: { comments: boolean; document: boolean };
  recipientRole: string;
  requestedMessage: string;
};

const initialReviewSession: DrawingScreenReviewSession = {
  changeReason: "",
  checks: { comments: false, document: false },
  recipientRole: "reviewer",
  requestedMessage: "",
};

function recipientRoleLabel(role: string) {
  return (
    {
      approver: "승인자 예시",
      reviewer: "검토자 예시",
      site: "현장 담당자 예시",
    }[role] ?? "검토자 예시"
  );
}

export function DrawingScreenReviewBody({
  documentName,
  onOpenChange,
  onReviewStateChange,
  page,
  pageCount,
  ready,
  returnHref,
  reviewState,
  reviewSession,
  setReviewSession,
  viewer,
}: Omit<DrawingScreenWorkflowProps, "open"> & {
  reviewSession: DrawingScreenReviewSession;
  setReviewSession: Dispatch<SetStateAction<DrawingScreenReviewSession>>;
}) {
  const checksComplete =
    reviewSession.checks.comments && reviewSession.checks.document;

  return (
    <>
      <PanelHeading
        description="현재 도면을 기준으로 요청부터 결정까지의 화면 흐름을 살펴봅니다."
        title="도면 검토"
      />
      <DocumentContext
        documentName={documentName}
        page={page}
        pageCount={pageCount}
      />
      {!ready ? (
        <section className="rounded-xl border border-dashed p-5 text-center">
          <h3 className="text-sm font-semibold">도면을 먼저 준비해 주세요</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            도면 화면으로 돌아가 페이지를 준비한 뒤 검토 흐름을 확인할 수
            있습니다.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Button
              onClick={() => onOpenChange(null)}
              type="button"
              variant="outline"
            >
              도면으로 돌아가기
            </Button>
            <Button asChild variant="outline">
              <a href={returnHref}>프로젝트/시작 화면으로 돌아가기</a>
            </Button>
          </div>
        </section>
      ) : viewer ? (
        <ViewerReview
          onReturnToDrawing={() => onOpenChange(null)}
          returnHref={returnHref}
          reviewState={reviewState}
        />
      ) : reviewState === "draft" ? (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const recipientRole = String(data.get("recipientRole") ?? "");
            setReviewSession((current) => ({
              ...current,
              changeReason: "",
              checks: { comments: false, document: false },
              recipientRole: ["reviewer", "approver", "site"].includes(
                recipientRole,
              )
                ? recipientRole
                : "reviewer",
              requestedMessage: String(data.get("message") ?? "").trim(),
            }));
            onReviewStateChange("requested");
          }}
        >
          <div className="grid gap-2">
            <label
              className="text-sm font-medium"
              htmlFor="review-recipient-role"
            >
              받는 역할
            </label>
            <select
              className={fieldClassName}
              defaultValue={reviewSession.recipientRole}
              id="review-recipient-role"
              name="recipientRole"
            >
              <option value="reviewer">검토자 예시</option>
              <option value="approver">승인자 예시</option>
              <option value="site">현장 담당자 예시</option>
            </select>
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="review-message">
              요청 메시지
            </label>
            <textarea
              className={fieldClassName + " min-h-28 resize-y py-3"}
              defaultValue={reviewSession.requestedMessage}
              id="review-message"
              maxLength={500}
              name="message"
              placeholder="확인이 필요한 내용을 입력하세요."
            />
            <p className="text-xs text-muted-foreground">최대 500자</p>
          </div>
          <Button type="submit">검토 요청 화면 보기</Button>
        </form>
      ) : reviewState === "reviewed" ? (
        <section className="rounded-xl border p-4"><h3>검토 완료 · 최종 승인 대기</h3><p>아직 승인된 개정이 아닙니다. 도면의 검토 패널에서 승인자 역할로 최종 결정을 확인하세요.</p><Button variant="outline" onClick={() => onOpenChange(null)}>도면으로 돌아가기</Button></section>
      ) : reviewState === "requested" ? (
        <div className="grid gap-4">
          <section className="rounded-xl border p-4">
            <div className="flex items-center gap-2">
              <MessageSquareText className="size-4 text-[#2925d9]" />
              <h3 className="text-sm font-semibold">
                검토 요청 상태 화면 예시
              </h3>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {reviewSession.requestedMessage ||
                "도면과 표시된 검토 항목을 확인해 주세요."}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              받는 역할 · {recipientRoleLabel(reviewSession.recipientRole)}
            </p>
          </section>
          <fieldset className="grid gap-3 rounded-xl border p-4">
            <legend className="px-1 text-sm font-semibold">검토 확인</legend>
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <input
                checked={reviewSession.checks.document}
                name="documentCheck"
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setReviewSession((current) => ({
                    ...current,
                    checks: { ...current.checks, document: checked },
                  }));
                }}
                type="checkbox"
              />
              도면명과 페이지 확인
            </label>
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <input
                checked={reviewSession.checks.comments}
                name="commentCheck"
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setReviewSession((current) => ({
                    ...current,
                    checks: { ...current.checks, comments: checked },
                  }));
                }}
                type="checkbox"
              />
              검토 의견 확인
            </label>
          </fieldset>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (checksComplete) onReviewStateChange("approved");
            }}
          >
            <Button className="w-full" disabled={!checksComplete} type="submit">
              승인 완료 화면 보기
            </Button>
          </form>
          <form
            className="grid gap-3 rounded-xl border p-4"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const reason = String(data.get("reason") ?? "").trim();
              if (!reason) return;
              setReviewSession((current) => ({
                ...current,
                changeReason: reason,
              }));
              onReviewStateChange("changes");
            }}
          >
            <label
              className="text-sm font-medium"
              htmlFor="review-change-reason"
            >
              변경 요청 사유
            </label>
            <textarea
              className={fieldClassName + " min-h-24 resize-y py-3"}
              id="review-change-reason"
              maxLength={500}
              name="reason"
              placeholder="수정이 필요한 이유를 입력하세요."
              required
            />
            <Button type="submit" variant="outline">
              변경 요청 화면 보기
            </Button>
          </form>
        </div>
      ) : reviewState === "changes" ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-5">
          <h3 className="text-sm font-semibold">변경 요청 화면 예시</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {reviewSession.changeReason ||
              "표시된 검토 의견을 반영한 뒤 다시 요청해 주세요."}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            요청 역할 · {recipientRoleLabel(reviewSession.recipientRole)}
          </p>
          <Button
            className="mt-5"
            onClick={() => {
              setReviewSession((current) => ({
                ...current,
                checks: { comments: false, document: false },
              }));
              onReviewStateChange("draft");
            }}
            type="button"
          >
            초안으로 돌아가기
          </Button>
        </section>
      ) : (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-5">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-700" />
            <h3 className="text-sm font-semibold">승인 완료 화면 예시</h3>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            화면에서만 승인 단계를 확인했습니다. 실제로 승인되지 않았습니다.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            요청 역할 · {recipientRoleLabel(reviewSession.recipientRole)}
          </p>
          <Button
            className="mt-5"
            onClick={() => onOpenChange("export")}
            type="button"
          >
            내보내기 설정 보기
          </Button>
        </section>
      )}
      {ready && !viewer ? (
        <div className="grid gap-2 border-t pt-4 sm:grid-cols-2">
          <Button
            onClick={() => onOpenChange(null)}
            type="button"
            variant="outline"
          >
            도면으로 돌아가기
          </Button>
          <Button asChild variant="outline">
            <a href={returnHref}>프로젝트/시작 화면으로 돌아가기</a>
          </Button>
        </div>
      ) : null}
    </>
  );
}

export type DrawingScreenExportSelection = {
  format: "pdf" | "png" | "svg" | "dwg";
  includeComments: boolean;
  pageRange: "current" | "all";
};

export type DrawingScreenExportBodyProps = {
  complete: boolean;
  documentName: string;
  onBackToReview: () => void;
  onComplete: (selection: DrawingScreenExportSelection) => void;
  onReturnToDrawing?: () => void;
  onResetExport: () => void;
  page: number;
  pageCount: number;
  ready: boolean;
  returnHref: string;
  selection?: DrawingScreenExportSelection | null;
  viewer: boolean;
};

export function DrawingScreenExportBody({
  complete,
  documentName,
  onBackToReview,
  onComplete,
  onReturnToDrawing,
  onResetExport,
  page,
  pageCount,
  ready,
  returnHref,
  selection,
  viewer,
}: DrawingScreenExportBodyProps) {
  if (complete) {
    const selected = selection ?? {
      format: "pdf",
      includeComments: false,
      pageRange: "current",
    };
    const formatLabel = selected.format.toUpperCase();
    return (
      <>
        <PanelHeading
          description="실제 파일은 생성되지 않았습니다. 선택한 설정의 완료 화면만 보여줍니다."
          title="내보내기 완료 화면 예시"
        />
        <section
          className="grid place-items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-5 py-8 text-center"
          role="status"
        >
          <FileCheck2 className="size-8 text-emerald-700" />
          <p className="font-semibold">{documentName}</p>
          <p className="text-sm text-muted-foreground">
            내보내기 완료 화면 예시 / 실제 파일은 생성되지 않았습니다
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">형식</dt>
            <dd>{formatLabel}</dd>
            <dt className="text-muted-foreground">범위</dt>
            <dd>
              {selected.pageRange === "all" ? "전체 페이지" : "현재 페이지"}
            </dd>
            <dt className="text-muted-foreground">댓글</dt>
            <dd>{selected.includeComments ? "댓글 포함" : "댓글 제외"}</dd>
          </dl>
        </section>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button onClick={onReturnToDrawing} type="button" variant="outline">
            도면으로 돌아가기
          </Button>
          <Button onClick={onBackToReview} type="button" variant="outline">
            검토로 돌아가기
          </Button>
          <Button onClick={onResetExport} type="button">
            내보내기 설정 다시 보기
          </Button>
          <Button asChild variant="outline">
            <a href={returnHref}>프로젝트/시작 화면으로 돌아가기</a>
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <PanelHeading
        description="형식과 페이지 범위를 고른 뒤 납품 패키지를 구성합니다. 실제 파일은 생성하지 않습니다."
        title="내보내기 설정"
      />
      <DocumentContext
        documentName={documentName}
        page={page}
        pageCount={pageCount}
      />
      {viewer ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          보기 전용 내보내기 화면입니다. 설정과 완료 화면만 확인합니다.
        </p>
      ) : null}
      <form
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          const data = new FormData(event.currentTarget);
          const requestedFormat = String(data.get("format") ?? "");
          const requestedRange = String(data.get("pageRange") ?? "");
          const format = ["pdf", "png", "svg", "dwg"].includes(requestedFormat)
            ? (requestedFormat as DrawingScreenExportSelection["format"])
            : "pdf";
          const pageRange = requestedRange === "all" ? "all" : "current";
          onComplete({
            format,
            includeComments: data.get("includeComments") === "on",
            pageRange,
          });
        }}
      >
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-semibold">파일 형식</legend>
          {[
            ["pdf", "PDF", "문서 화면 예시"],
            ["png", "PNG", "이미지 화면 예시"],
            ["svg", "SVG", "벡터 화면 예시"],
            ["dwg", "DWG", "DWG 변환 엔진 미연결"],
          ].map(([value, label, help]) => (
            <label
              className="flex min-h-12 items-center gap-3 rounded-lg border px-3 text-sm"
              key={value}
            >
              <input
                defaultChecked={value === "pdf"}
                name="format"
                type="radio"
                value={value}
              />
              <span className="font-medium">{label}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {help}
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-semibold">페이지 범위</legend>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              defaultChecked
              name="pageRange"
              type="radio"
              value="current"
            />
            현재 페이지 ({page}쪽)
          </label>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input name="pageRange" type="radio" value="all" />
            전체 페이지 ({Math.max(1, pageCount)}쪽)
          </label>
        </fieldset>
        <label className="flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm">
          <input name="includeComments" type="checkbox" />
          검토 댓글 포함 화면 예시
        </label>
        {!ready ? (
          <p className="text-sm text-muted-foreground" role="status">
            화면 준비 중입니다. 도면이 준비되면 납품 구성을 확인할 수 있습니다.
          </p>
        ) : null}
        <Button disabled={!ready} type="submit">
          납품 구성으로 계속
        </Button>
      </form>
      <div className="grid gap-2 border-t pt-4 sm:grid-cols-2">
        <Button onClick={onReturnToDrawing} type="button" variant="outline">
          도면으로 돌아가기
        </Button>
        <Button onClick={onBackToReview} type="button" variant="outline">
          검토로 돌아가기
        </Button>
        <Button asChild className="sm:col-span-2" variant="outline">
          <a href={returnHref}>프로젝트/시작 화면으로 돌아가기</a>
        </Button>
      </div>
    </>
  );
}

export type DrawingScreenShareSelection = {
  email: string;
  role: "viewer" | "commenter" | "editor";
};

export type DrawingScreenShareBodyProps = {
  confirmed: boolean;
  documentName: string;
  onConfirm: (selection: DrawingScreenShareSelection) => void;
  onReturnToDrawing?: () => void;
  onReset: () => void;
  returnHref?: string;
  selection?: DrawingScreenShareSelection | null;
  draft?: DrawingScreenShareSelection | null;
  onDraftChange?: (draft:DrawingScreenShareSelection)=>void;
  viewer: boolean;
};

export function DrawingScreenShareBody({
  confirmed,
  documentName,
  onConfirm,
  onReturnToDrawing,
  onReset,
  returnHref,
  selection,
  draft,
  onDraftChange,
  viewer,
}: DrawingScreenShareBodyProps) {
  if (viewer)
    return (
      <>
        <PanelHeading
          description="보기 전용에서는 초대 대상이나 역할을 바꿀 수 없습니다."
          title="공유 설정 보기 전용"
        />
        <section className="rounded-xl border p-4 text-sm text-muted-foreground">
          {documentName}의 공유 화면 구성을 확인하고 도면으로 돌아갈 수
          있습니다.
        </section>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button onClick={onReturnToDrawing} type="button" variant="outline">
            도면으로 돌아가기
          </Button>
          {returnHref ? (
            <Button asChild variant="outline">
              <a href={returnHref}>프로젝트/시작 화면으로 돌아가기</a>
            </Button>
          ) : null}
        </div>
      </>
    );

  if (confirmed) {
    const selected = selection ?? { email: "입력한 이메일", role: "viewer" };
    const roleLabel = {
      commenter: "Commenter",
      editor: "Editor",
      viewer: "Viewer",
    }[selected.role];
    return (
      <>
        <PanelHeading
          description="실제 초대는 전송되지 않았습니다. 입력한 값은 이 화면에서만 사용됩니다."
          title="초대 확인 화면 예시"
        />
        <section
          className="grid place-items-center gap-3 rounded-xl border bg-muted/35 px-5 py-8 text-center"
          role="status"
        >
          <Send className="size-7 text-[#2925d9]" />
          <p className="font-semibold">{documentName}</p>
          <p className="text-sm text-muted-foreground">
            초대 확인 화면 예시 · 실제 초대는 전송되지 않았습니다
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">받는 사람</dt>
            <dd className="break-all">{selected.email}</dd>
            <dt className="text-muted-foreground">역할</dt>
            <dd>{roleLabel}</dd>
          </dl>
        </section>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button onClick={onReset} type="button" variant="outline">
            초대 설정으로 돌아가기
          </Button>
          <Button onClick={onReturnToDrawing} type="button" variant="outline">
            도면으로 돌아가기
          </Button>
          {returnHref ? (
            <Button asChild className="sm:col-span-2" variant="outline">
              <a href={returnHref}>프로젝트/시작 화면으로 돌아가기</a>
            </Button>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      <PanelHeading
        description="받는 사람과 역할을 정해 초대 확인 화면을 살펴봅니다."
        title="공유 초대"
      />
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const email = String(data.get("recipientEmail") ?? "").trim();
          const requestedRole = String(data.get("role") ?? "");
          if (!email) return;
          const role = ["viewer", "commenter", "editor"].includes(requestedRole)
            ? (requestedRole as DrawingScreenShareSelection["role"])
            : "viewer";
          onConfirm({ email, role });
        }}
      >
        <div className="grid gap-2">
          <label
            className="text-sm font-medium"
            htmlFor="share-recipient-email"
          >
            받는 사람 이메일
          </label>
          <input
            className={fieldClassName}
            id="share-recipient-email"
            name="recipientEmail"
            defaultValue={draft?.email??""}
            onChange={event=>onDraftChange?.({email:event.target.value,role:draft?.role??"viewer"})}
            placeholder="name@example.com"
            required
            type="email"
          />
        </div>
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="share-role">
            역할
          </label>
          <select className={fieldClassName} id="share-role" name="role" defaultValue={draft?.role??"viewer"} onChange={event=>onDraftChange?.({email:draft?.email??"",role:event.target.value as DrawingScreenShareSelection["role"]})}>
            <option value="viewer">Viewer</option>
            <option value="commenter">Commenter</option>
            <option value="editor">Editor</option>
          </select>
        </div>
        <Button type="submit">초대 화면 확인</Button>
      </form>
      <div className="grid gap-2 border-t pt-4 sm:grid-cols-2">
        <Button onClick={onReturnToDrawing} type="button" variant="outline">
          도면으로 돌아가기
        </Button>
        {returnHref ? (
          <Button asChild variant="outline">
            <a href={returnHref}>프로젝트/시작 화면으로 돌아가기</a>
          </Button>
        ) : null}
      </div>
    </>
  );
}

type WorkflowSession = DeliveryDraft&{
  review: DrawingScreenReviewSession;
  shareSelection: DrawingScreenShareSelection | null;
  shareDraft: DrawingScreenShareSelection | null;
};

const pendingDeliveryDrafts=new Map<string,DeliveryDraft>();
const warnPendingDelivery=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
type DeliveryDraftStatus={restored:boolean;blocked:boolean;error:string;retry:()=>void};
function useWorkflowSession(draftKey?:string,viewer=false,approvedRequest?:ChangeRequestPreview): [
  WorkflowSession,
  Dispatch<SetStateAction<WorkflowSession>>,
  DeliveryDraftStatus,
] {
  const [session,setSession]=useState<WorkflowSession>({
    deliveryConfiguration: initialDeliveryConfiguration,
    deliverySource:null,
    deliveryStage:"package",
    deliveryHistory:[],
    exportSelection: null,
    review: initialReviewSession,
    shareSelection: null,
    shareDraft: null,
  });
  const [loadedKey,setLoadedKey]=useState<string|undefined>(undefined);
  const [blocked,setBlocked]=useState(false);
  const [error,setError]=useState("");
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    if(!draftKey)return;
    setBlocked(false);setError("");
    try{
      const pending=pendingDeliveryDrafts.get(draftKey);
      const raw=pending?JSON.stringify({...pending,schema:1}):sessionStorage.getItem(draftKey);
      if(raw!==null){const saved=parseDeliveryDraft(raw);if(!saved)throw Error("invalid delivery draft");setSession(current=>({...current,...saved}));}
    }catch{setBlocked(true);setError("납품 초안을 복원하지 못했습니다. 기존 기록은 덮어쓰지 않았습니다.");}
    setLoadedKey(draftKey);
  },[draftKey]);
  useEffect(()=>{
    if(viewer||blocked||draftKey&&loadedKey!==draftKey||!approvedRequest?.approval)return;
    setSession(current=>({...current,pendingApprovedRequest:structuredClone(approvedRequest)}));
  },[draftKey,loadedKey,blocked,viewer,approvedRequest]);
  const {deliveryConfiguration,deliverySource,deliveryStage,exportSelection,deliveryHistory,pendingApprovedRequest}=session;
  useEffect(()=>{
    if(!draftKey||loadedKey!==draftKey||blocked||viewer)return;
    const draft={deliveryConfiguration,deliverySource,deliveryStage,exportSelection,deliveryHistory,pendingApprovedRequest};
    try{
      const raw=JSON.stringify({...draft,schema:1});
      if(!parseDeliveryDraft(raw))throw Error("invalid delivery draft");
      sessionStorage.setItem(draftKey,raw);
      pendingDeliveryDrafts.delete(draftKey);if(!pendingDeliveryDrafts.size)window.removeEventListener("beforeunload",warnPendingDelivery);
      setError("");
    }catch{
      pendingDeliveryDrafts.set(draftKey,draft);window.addEventListener("beforeunload",warnPendingDelivery);
      setError("납품 초안을 보관하지 못했습니다. 현재 입력은 메모리에 유지됩니다. 새로고침 전에 보관을 다시 시도하세요.");
    }
  },[draftKey,loadedKey,blocked,viewer,deliveryConfiguration,deliverySource,deliveryStage,exportSelection,deliveryHistory,pendingApprovedRequest,retry]);
  return [session,setSession,{restored:!draftKey||loadedKey===draftKey,blocked,error,retry:()=>setRetry(value=>value+1)}];
}

function DrawingScreenWorkflowContent({
  props,
  session,
  setSession,
  deliveryDraft,
}: {
  props: DrawingScreenWorkflowProps;
  session: WorkflowSession;
  setSession: Dispatch<SetStateAction<WorkflowSession>>;
  deliveryDraft:DeliveryDraftStatus;
}) {
  const [shareTab, setShareTab] = useState<"invite" | "people" | "issues" | "activity">("invite");
  const selectedRequest=props.approvedRequest??session.pendingApprovedRequest;
  const attachedRequest=session.deliverySource?session.deliverySource.approvedRequest:selectedRequest;
  if (!props.open) return null;
  if(props.open==="export"&&(!deliveryDraft.restored||deliveryDraft.blocked))return <><p role={deliveryDraft.blocked?"alert":"status"}>{deliveryDraft.error||"납품 초안을 불러오고 있습니다."}</p><Button onClick={()=>props.onOpenChange(null)}>도면으로 돌아가기</Button></>;
  if (props.open === "share" && !props.ready) return <><SimulationBadge/><PanelHeading title="도면을 먼저 열어 주세요" description="빈 도면 또는 템플릿을 시작한 뒤 공유 화면을 확인할 수 있습니다."/><Button type="button" variant="outline" onClick={() => props.onOpenChange(null)}>도면으로 돌아가기</Button></>;
  return (
    <>
      <SimulationBadge />
      {props.open==="export"&&attachedRequest&&<DrawingDeliveryRequestEvidence request={attachedRequest}/>}
      {props.open==="export"&&!session.deliverySource&&selectedRequest&&<div className="grid gap-2">
        <Button variant="outline" disabled={props.viewer||Boolean(deliveryDraft.error)||Boolean(props.approvedRequest&&!props.onClearApprovedRequest)} onClick={()=>{
          if(props.viewer||deliveryDraft.error)return;
          props.onClearApprovedRequest?.();
          setSession(current=>({...current,pendingApprovedRequest:undefined}));
        }}>첨부 요청 선택 해제</Button>
        <p className="text-xs text-muted-foreground">이 납품 초안의 첨부 선택만 해제합니다. 요청 이력과 승인 의견은 삭제하지 않습니다.</p>
      </div>}
      {props.open==="export"&&session.deliverySource&&selectedRequest&&JSON.stringify(selectedRequest)!==JSON.stringify(session.deliverySource.approvedRequest)&&<p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">선택한 요청은 현재 납품 구성에 첨부되지 않았습니다. 기존 구성은 유지됩니다. 아래 ‘현재 도면으로 새 납품 구성’에서 새 구성을 시작해 주세요.</p>}
      {props.open==="export"&&props.deliveryDraftKey&&<p className="text-xs">납품 초안 · 이 브라우저 탭에만 보관 · 실제 파일 저장·전송 아님</p>}
      {props.open==="export"&&deliveryDraft.error&&<><p role="alert">{deliveryDraft.error}</p><Button variant="outline" onClick={deliveryDraft.retry}>납품 초안 보관 다시 시도</Button></>}
      {props.open === "export" && <DrawingChangeReportPreview returnHref={props.returnHref} viewer={props.viewer}/>}
      {props.open === "export" && <DrawingDeliveryHistory records={session.deliveryHistory}/>}
      {props.open === "share" && <nav aria-label="공유·협업 화면" className="flex flex-wrap gap-2">
        {([["invite", "초대"], ["people", "참여자"], ["issues", "이슈"], ["activity", "활동"]] as const).map(([id, label]) => <Button key={id} type="button" variant={shareTab === id ? "default" : "outline"} aria-pressed={shareTab === id} onClick={() => setShareTab(id)}>{label}</Button>)}
      </nav>}
      {props.open === "review" ? (
        <DrawingScreenReviewBody
          {...props}
          reviewSession={session.review}
          setReviewSession={(next) =>
            setSession((current) => ({
              ...current,
              review: typeof next === "function" ? next(current.review) : next,
            }))
          }
        />
      ) : props.open === "export" && session.exportSelection && session.deliverySource ? (
        <>
          <p className="rounded-lg border p-3 text-sm">구성 당시 도면·페이지·검토 기록을 고정한 화면 예시입니다. 실제 파일 원본이나 납품 파일을 보관한 것은 아닙니다.</p>
          {(session.deliverySource.page!==props.page||JSON.stringify(session.deliverySource.reviewLoop)!==JSON.stringify(props.reviewLoop)||session.deliverySource.drawingSnapshot&&JSON.stringify(session.deliverySource.drawingSnapshot)!==JSON.stringify(props.drawingSnapshot))&&<p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">현재 작업이 구성 당시와 다릅니다. 아래 납품 기준은 자동으로 변경하지 않습니다.</p>}
          <DrawingDeliveryPreview
            documentName={session.deliverySource.documentName} page={session.deliverySource.page} pageCount={session.deliverySource.pageCount} ready={props.ready}
            viewer={props.viewer} reviewState={session.deliverySource.reviewState} selection={session.exportSelection}
            reviewContext={session.deliverySource.reviewContext}
            reviewRecord={session.deliverySource.reviewLoop}
            approvedRequest={session.deliverySource.approvedRequest}
            drawingSnapshot={session.deliverySource.drawingSnapshot}
            onSelectionChange={props.viewer||deliveryDraft.error?undefined:value=>setSession(current=>({...current,exportSelection:value}))}
            stage={session.deliveryStage}
            onStageChange={value=>setSession(current=>({...current,deliveryStage:value}))}
            configuration={session.deliveryConfiguration}
            onConfigurationChange={value => setSession(current => ({...current, deliveryConfiguration:value}))}
            onReturn={() => props.onOpenChange(null)}
          />
          <Button type="button" variant="outline" disabled={props.viewer||Boolean(deliveryDraft.error)} onClick={() => {
            const id=crypto.randomUUID(),createdAt=new Date().toISOString();
            setSession(current => ({...current,deliveryHistory:[...current.deliveryHistory,structuredClone({id,createdAt,deliveryConfiguration:current.deliveryConfiguration,deliverySource:current.deliverySource,deliveryStage:current.deliveryStage,exportSelection:current.exportSelection})],exportSelection: null,deliverySource:null,deliveryStage:"package"}));
          }}>현재 도면으로 새 납품 구성</Button>
        </>
      ) : props.open === "export" ? (
        <DrawingScreenExportBody
          complete={session.exportSelection !== null}
          documentName={props.documentName}
          onBackToReview={() => {
            setSession((current) => ({
              ...current,
              exportSelection: null,
            }));
            props.onOpenChange("review");
          }}
          onComplete={(selection) =>
            setSession((current) => ({
              ...current,
              exportSelection: selection,
              deliveryStage:"package",
              deliverySource:structuredClone({documentName:props.documentName,page:props.page,pageCount:props.pageCount,reviewState:props.reviewState,reviewContext:props.reviewContext,reviewLoop:props.reviewLoop,approvedRequest:selectedRequest,drawingSnapshot:props.drawingSnapshot}),
            }))
          }
          onReturnToDrawing={() => props.onOpenChange(null)}
          onResetExport={() =>
            setSession((current) => ({
              ...current,
              exportSelection: null,
            }))
          }
          page={props.page}
          pageCount={props.pageCount}
          ready={props.ready}
          returnHref={props.returnHref}
          selection={session.exportSelection}
          viewer={props.viewer}
        />
      ) : shareTab !== "invite" ? (
        <>
          <DocumentContext documentName={props.documentName} page={props.page} pageCount={props.pageCount} />
          <DrawingTeamPreview ready={props.ready} viewer={props.viewer} reviewState={props.reviewState} section={shareTab} reviewLoop={props.reviewLoop} onLocateReview={props.onLocateReview} />
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(null)}>도면으로 돌아가기</Button>
        </>
      ) : (
        <DrawingScreenShareBody
          confirmed={session.shareSelection !== null}
          documentName={props.documentName}
          onConfirm={(selection) =>
            setSession((current) => ({ ...current, shareSelection: selection }))
          }
          onReset={() =>
            setSession((current) => ({ ...current, shareSelection: null }))
          }
          onReturnToDrawing={() => props.onOpenChange(null)}
          returnHref={props.returnHref}
          selection={session.shareSelection}
          draft={session.shareDraft}
          onDraftChange={draft=>setSession(current=>({...current,shareDraft:draft}))}
          viewer={props.viewer}
        />
      )}
    </>
  );
}

export function DrawingScreenWorkflowBody(props: DrawingScreenWorkflowProps) {
  const [session, setSession,deliveryDraft] = useWorkflowSession(props.deliveryDraftKey,props.viewer,props.approvedRequest);
  return (
    <DrawingScreenWorkflowContent
      props={props}
      session={session}
      setSession={setSession}
      deliveryDraft={deliveryDraft}
    />
  );
}

export function DrawingScreenWorkflow(props: DrawingScreenWorkflowProps) {
  const [session, setSession,deliveryDraft] = useWorkflowSession(props.deliveryDraftKey,props.viewer,props.approvedRequest);
  const openerRef = useRef<HTMLElement | null>(null);
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) props.onOpenChange(null);
      }}
      open={props.open !== null}
    >
      {props.open ? (
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
          onOpenAutoFocus={() => {
            openerRef.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            if (openerRef.current?.isConnected) {
              event.preventDefault();
              openerRef.current.focus();
            }
          }}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>도면 작업 흐름 화면 시뮬레이션</DialogTitle>
            <DialogDescription>
              검토, 내보내기 또는 공유 화면의 로컬 시뮬레이션입니다.
            </DialogDescription>
          </DialogHeader>
          <DrawingScreenWorkflowContent
            props={props}
            session={session}
            setSession={setSession}
            deliveryDraft={deliveryDraft}
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
