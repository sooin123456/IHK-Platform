import { useState } from "react";
import type { DrawingScreenReviewState } from "./drawing-screen-workflow";
import {DrawingReviewIssueSummary, reviewLoopLabels, type ReviewLoopState} from "./drawing-review-loop";

export function DrawingTeamPreview({
  ready,
  viewer,
  reviewState,
  section = "people",
  reviewLoop,
  onLocateReview = () => {},
}: {
  ready: boolean;
  viewer: boolean;
  reviewState: DrawingScreenReviewState;
  section?: "people" | "issues" | "activity";
  reviewLoop?: ReviewLoopState;
  onLocateReview?: () => void;
}) {
  const [resolved, setResolved] = useState(false);
  if (!ready)
    return (
      <p className="rounded-xl border p-4 text-sm">
        도면을 먼저 열어 주세요. 참여자와 이슈는 도면 맥락에서 확인합니다.
      </p>
    );
  if (section === "issues" && reviewLoop) return <section className="grid gap-3 rounded-xl border p-4" aria-label="협업 이슈">
    <h3 className="font-semibold">이 도면의 검토 의견</h3>
    <p className="text-xs text-muted-foreground">R{reviewLoop.revision} · {reviewLoop.page}쪽 · 검토 패널과 같은 화면 예시 기록입니다.</p>
    {reviewLoop.issue ? <DrawingReviewIssueSummary state={reviewLoop} onLocate={onLocateReview}/> : <p className="text-sm">아직 위치에 연결된 검토 의견이 없습니다.</p>}
    <p className="text-xs text-muted-foreground">의견 반영과 해결 확인은 도면 검토에서 진행합니다. 실제 댓글 전송은 아닙니다.</p>
  </section>;
  if (section === "activity" && reviewLoop) return <section className="grid gap-3 rounded-xl border p-4" aria-label="검토 활동">
    <h3 className="font-semibold">도면 검토 활동</h3><p className="text-xs text-muted-foreground">현재 도면의 화면 예시 기록이며 실제 감사 로그가 아닙니다.</p>
    <ol className="grid gap-3 border-l pl-4 text-sm">{reviewLoop.history.map(revision=><li key={revision.revision}>R{revision.revision} · {revision.page}쪽 · {reviewLoopLabels[revision.phase]}</li>)}<li>현재 R{reviewLoop.revision} · {reviewLoopLabels[reviewLoop.phase]}</li></ol>
    <button type="button" className="text-left text-sm underline" onClick={onLocateReview}>도면에서 검토 기록 확인</button>
  </section>;
  if (section === "activity")
    return (
      <section
        className="grid gap-3 rounded-xl border p-4"
        aria-label="활동 예시"
      >
        <h3 className="font-semibold">활동 타임라인 · 예시</h3>
        <p className="text-xs text-muted-foreground">
          현재 화면의 검토 상태를 표시하며 실제 감사 기록이 아닙니다.
        </p>
        <ol className="grid gap-3 border-l pl-4 text-sm">
          <li>도면 열기 · 현재 화면</li>
          <li>
            현재 단계:{" "}
            {
              {
                draft: "작성 중",
                requested: "검토 요청",
                reviewed: "검토 완료 · 최종 승인 대기",
                changes: "변경 요청",
                approved: "승인 화면 예시",
              }[reviewState]
            }
          </li>
          <li>변경자·변경 시각: 기록 미연결</li>
        </ol>
      </section>
    );
  if (section === "issues")
    return (
      <section
        className="grid gap-3 rounded-xl border p-4"
        aria-label="협업 이슈 예시"
      >
        <h3 className="font-semibold">I01 · 치수 기준 확인 · 예시</h3>
        <p className="text-sm text-muted-foreground">
          김검토 → 설계 담당 · 예시 참여자. 실제 도면의 결함이나 등록된 댓글이
          아닙니다.
        </p>
        <p className="rounded-lg bg-muted p-3 text-sm">
          @설계담당 기준선과 축척을 확인해 주세요. · 댓글 예시
        </p>
        <fieldset disabled={viewer} className="grid gap-2">
          <label className="text-sm">
            답글 초안 · 저장 없음
            <textarea
              maxLength={500}
              className="mt-2 min-h-20 w-full rounded-lg border bg-background p-3"
              placeholder="화면에서만 입력됩니다"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={resolved}
              onChange={(e) => setResolved(e.target.checked)}
            />
            해결 상태 예시
          </label>
        </fieldset>
        <p role="status" className="text-sm">
          {resolved ? "해결됨" : "확인 필요"} · 이 패널만의 예시, 검토 승인과
          무관
        </p>
        {viewer && (
          <p className="text-xs text-muted-foreground">
            Viewer는 이슈를 변경할 수 없습니다.
          </p>
        )}
      </section>
    );
  return (
    <section className="grid gap-3" aria-label="참여자 예시">
      <h3 className="font-semibold">참여자 예시</h3>
      <p className="text-xs text-muted-foreground">
        아래는 역할 설명용 인물입니다. 실제 접속 상태가 아닙니다.
      </p>
      <ul className="divide-y rounded-xl border">
        {[
          ["설계 담당", "Editor", "도형·레이어·속성 편집"],
          ["김검토", "Reviewer", "검토 의견과 변경 요청"],
          ["승인 담당", "Approver", "최종 승인"],
          ["현장 담당", "Commenter", "댓글·이슈 작성"],
          ["발주 담당", "Viewer", "도면과 전달 결과 보기"],
          ["조직 관리자", "Admin", "구성원·공유·보존 정책"],
        ].map(([name, role, scope]) => (
          <li key={role} className="grid gap-1 p-3">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <strong>{name}</strong>
              <span className="text-[#2925d9]">{role}</span>
            </div>
            <p className="text-xs text-muted-foreground">{scope}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
