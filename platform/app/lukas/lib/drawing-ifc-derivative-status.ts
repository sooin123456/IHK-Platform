export type DrawingIfcDerivativeStatus =
  | "not_applicable"
  | "not_queued"
  | "queued"
  | "processing"
  | "retry_wait"
  | "completed"
  | "pending"
  | "failed"
  | "ready";

export const IFC_DERIVATIVE_REFRESH_LIMIT = 20;

export function ifcDerivativeStatusPresentation(
  status: DrawingIfcDerivativeStatus | null | undefined,
): { waiting: boolean; message: string } {
  switch (status) {
    case "queued":
      return {
        waiting: true,
        message:
          "검증된 IFC GLB 파생물 생성 작업이 대기 중입니다. 원본 IFC는 브라우저로 전송하지 않습니다.",
      };
    case "processing":
    case "pending":
      return {
        waiting: true,
        message:
          "검증된 IFC GLB 파생물을 생성 중입니다. 원본 IFC는 브라우저로 전송하지 않습니다.",
      };
    case "retry_wait":
      return {
        waiting: true,
        message:
          "IFC 변환이 일시 오류로 재시도 대기 중입니다. 원본 IFC는 안전하게 보존됩니다.",
      };
    case "completed":
      return {
        waiting: true,
        message: "검증된 IFC 파생물 생성이 완료되어 최신 상태를 확인 중입니다.",
      };
    case "failed":
      return {
        waiting: false,
        message:
          "검증된 IFC GLB 파생물을 만들지 못했습니다. 원본 IFC는 브라우저로 전송하지 않습니다.",
      };
    case "not_queued":
      return {
        waiting: false,
        message:
          "IFC 파생물 생성 작업이 등록되지 않았습니다. IFC를 다시 업로드하거나 관리자에게 문의하세요.",
      };
    case "ready":
      return {
        waiting: false,
        message: "검증된 IFC 파생물 읽기 정보가 올바르지 않습니다.",
      };
    default:
      return {
        waiting: false,
        message: "검증된 IFC GLB 파생물이 아직 준비되지 않았습니다.",
      };
  }
}

export function ifcDerivativeRefreshDelay(
  status: DrawingIfcDerivativeStatus | null | undefined,
  refreshCount: number,
): number | null {
  if (
    !Number.isSafeInteger(refreshCount) ||
    refreshCount < 0 ||
    refreshCount >= IFC_DERIVATIVE_REFRESH_LIMIT
  )
    return null;
  const baseDelay =
    status === "completed"
      ? 500
      : status === "processing"
        ? 1_000
        : status === "queued" || status === "pending"
          ? 1_500
          : status === "retry_wait"
            ? 5_000
            : null;
  if (baseDelay === null) return null;
  return Math.min(baseDelay * 2 ** Math.floor(refreshCount / 5), 15_000);
}
