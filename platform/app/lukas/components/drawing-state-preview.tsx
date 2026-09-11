import { useState } from "react";
import { Button } from "~/core/components/ui/button";
type State = "loading" | "error" | "offline" | "conflict" | "approved";
export function DrawingStatePreview({ state = "loading" }: { state?: State }) {
  const [current, setCurrent] = useState<State>(state);
  const [message, setMessage] = useState("");
  const descriptions = {
    loading: [
      "도면 준비 중 · 예시",
      "원본을 읽고 화면을 준비하는 상태입니다. 실제 로딩을 시작하지 않습니다.",
    ],
    error: [
      "도면을 열 수 없음 · 예시",
      "지원 형식, 파일 손상 여부, 접근 권한을 확인하는 안내입니다. 원본 파일은 변경하지 않습니다.",
    ],
    offline: [
      "연결 끊김 · 예시",
      "현재 화면 입력은 영구 보관되지 않습니다. 새로고침하면 사라질 수 있습니다. 실제 outbox·재전송은 미연결입니다.",
    ],
    conflict: [
      "동시 변경 충돌 · 예시",
      "내 변경과 다른 참여자의 변경을 비교한 후 적용할 내용을 선택하는 단계입니다. 실제 충돌 데이터는 없습니다.",
    ],
    approved: [
      "승인본 잠금 · 예시",
      "승인된 버전을 직접 수정하지 않고 새 개정에서 작업합니다. 실제 승인·개정 생성은 실행하지 않습니다.",
    ],
  };
  return (
    <section className="grid gap-4" aria-label="상태 화면 예시">
      <p className="rounded-lg bg-violet-50 p-3 text-xs text-violet-800">
        QA 화면 예시 · 실제 연결·저장 상태가 아닙니다
      </p>
      <label className="grid gap-2 text-sm">
        상태 선택
        <select
          className="min-h-10 rounded-lg border bg-background px-3"
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value as State);
            setMessage("");
          }}
        >
          <option value="loading">로딩</option>
          <option value="error">오류</option>
          <option value="offline">오프라인</option>
          <option value="conflict">충돌</option>
          <option value="approved">승인 잠금</option>
        </select>
      </label>
      <div className="grid gap-3 rounded-xl border p-4">
        <h3 className="font-semibold">{descriptions[current][0]}</h3>
        <p className="text-sm leading-6 text-muted-foreground">
          {descriptions[current][1]}
        </p>
        {current === "loading" ? (
          <div className="grid gap-2" aria-label="로딩 자리표시자">
            <div className="h-4 w-2/3 rounded bg-muted" />
            <div className="h-20 rounded bg-muted" />
          </div>
        ) : current === "conflict" ? (
          <>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p className="rounded-lg bg-muted p-3">내 변경 · 선 색상 예시</p>
              <p className="rounded-lg bg-muted p-3">상대 변경 · 위치 예시</p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setMessage("비교 확인 표시 · 실제 병합·덮어쓰기 없음")
              }
            >
              비교 확인 · 예시
            </Button>
          </>
        ) : current === "approved" ? (
          <>
            <Button type="button" disabled>
              승인본 직접 수정
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setMessage("새 개정 안내 확인 · 실제 개정 생성 없음")
              }
            >
              새 개정 안내 확인
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setMessage("다시 시도 안내 확인 · 실제 요청·복구 없음")
            }
          >
            다시 시도 안내 · 예시
          </Button>
        )}
        {message && (
          <p role="status" className="text-xs text-violet-800">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
