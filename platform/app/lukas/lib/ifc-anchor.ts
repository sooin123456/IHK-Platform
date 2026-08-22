export type IfcCameraState = {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
};

function coordinate(value: number) {
  if (!Number.isFinite(value)) throw new Error("IFC 카메라 좌표가 올바르지 않습니다.");
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function canonicalIfcCameraState(state: IfcCameraState): IfcCameraState {
  return {
    position: state.position.map(coordinate) as [number, number, number],
    target: state.target.map(coordinate) as [number, number, number],
  };
}
