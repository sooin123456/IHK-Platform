import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  LockKeyhole,
  UnlockKeyhole,
} from "lucide-react";
import { Button } from "~/core/components/ui/button";

export type PreviewLayer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
};
export const createPreviewLayers = (): PreviewLayer[] => [
  { id: "review", name: "검토 주석", visible: true, locked: false },
];
const fieldClass =
  "min-h-10 w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-sm";
export function revealPreviewLayer(layers: PreviewLayer[], id: string) {
  if (!layers.some(layer => layer.id === id && !layer.visible)) return layers;
  return layers.map(layer => layer.id === id ? {...layer, visible: true} : layer);
}

export function movePreviewLayer(
  layers: PreviewLayer[],
  id: string,
  direction: -1 | 1,
) {
  const index = layers.findIndex((layer) => layer.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= layers.length) return layers;
  const result = [...layers];
  [result[index], result[next]] = [result[next], result[index]];
  return result;
}

export function DrawingLayerPreview({
  layers,
  viewer,
  onChange,
}: {
  layers: PreviewLayer[];
  viewer: boolean;
  onChange: (layers: PreviewLayer[]) => void;
}) {
  const change = (id: string, values: Partial<PreviewLayer>) =>
    onChange(
      layers.map((layer) =>
        layer.id === id ? { ...layer, ...values } : layer,
      ),
    );
  return (
    <div className="space-y-3">
      <fieldset disabled={viewer} className="space-y-3">
        {layers.map((layer, index) => {
          const name = layer.name.trim() || "이름 없는 레이어";
          return (
            <div
              className="min-w-0 space-y-2 rounded-lg border p-2"
              key={layer.id}
            >
              <label className="grid gap-1 text-xs text-muted-foreground">
                레이어 {index + 1} 이름
                <input
                  className={fieldClass}
                  value={layer.name}
                  maxLength={40}
                  onChange={(event) =>
                    change(layer.id, { name: event.target.value })
                  }
                />
              </label>
              {!layer.name.trim() && (
                <p className="text-xs text-amber-700">
                  레이어 이름을 입력해 주세요.
                </p>
              )}
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`${name} ${layer.visible ? "숨기기" : "표시하기"} 예시`}
                  aria-pressed={layer.visible}
                  onClick={() => change(layer.id, { visible: !layer.visible })}
                >
                  {layer.visible ? (
                    <Eye className="size-3" />
                  ) : (
                    <EyeOff className="size-3" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`${name} ${layer.locked ? "잠금 해제" : "잠그기"} 예시`}
                  aria-pressed={layer.locked}
                  onClick={() => change(layer.id, { locked: !layer.locked })}
                >
                  {layer.locked ? (
                    <LockKeyhole className="size-3" />
                  ) : (
                    <UnlockKeyhole className="size-3" />
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={index === 0}
                  aria-label={`${name} 위로 이동 예시`}
                  onClick={() =>
                    onChange(movePreviewLayer(layers, layer.id, -1))
                  }
                >
                  <ArrowUp className="size-3" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={index === layers.length - 1}
                  aria-label={`${name} 아래로 이동 예시`}
                  onClick={() =>
                    onChange(movePreviewLayer(layers, layer.id, 1))
                  }
                >
                  <ArrowDown className="size-3" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {layer.visible ? "표시" : "숨김"} ·{" "}
                {layer.locked ? "잠김" : "편집 가능"} · 예시
              </p>
            </div>
          );
        })}
        <Button
          className="w-full"
          variant="outline"
          disabled={layers.length >= 5}
          onClick={() =>
            onChange([
              ...layers,
              {
                id: `layer-${layers.length}`,
                name: `새 레이어 ${layers.length}`,
                visible: true,
                locked: false,
              },
            ])
          }
        >
          레이어 추가 · 화면 예시
        </Button>
      </fieldset>
      <p className="text-xs leading-relaxed text-muted-foreground">
        목록 상태만 바뀌며 원본 도면에는 적용되지 않습니다. 최대 5개 ·{" "}
        {viewer ? "보기 전용" : "화면 예시"}
      </p>
    </div>
  );
}

export function DrawingDocumentPreview({
  ready,
  viewer,
  layers,
  onLayersChange,
}: {
  ready: boolean;
  viewer: boolean;
  layers: PreviewLayer[];
  onLayersChange: (layers: PreviewLayer[]) => void;
}) {
  const [paper, setPaper] = useState("A3");
  const [direction, setDirection] = useState("가로");
  const [space, setSpace] = useState("종이 공간");
  const [grid, setGrid] = useState(false);
  return (
    <div className="space-y-4">
      {!ready && (
        <p className="rounded-lg border border-dashed p-3 text-sm">
          도면 미선택 · 문서 설정 양식만 살펴봅니다.
        </p>
      )}
      <fieldset disabled={viewer} className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          용지 크기
          <select
            className={fieldClass}
            value={paper}
            onChange={(e) => setPaper(e.target.value)}
          >
            <option>A4</option>
            <option>A3</option>
            <option>A2</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          용지 방향
          <select
            className={fieldClass}
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option>가로</option>
            <option>세로</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          캔버스 공간
          <select
            className={fieldClass}
            value={space}
            onChange={(e) => setSpace(e.target.value)}
          >
            <option>종이 공간</option>
            <option>모델 공간</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={grid}
            onChange={(e) => setGrid(e.target.checked)}
          />
          그리드 표시 · 예시
        </label>
      </fieldset>
      <section
        className="grid min-h-32 place-items-center rounded-xl border p-4"
        aria-label="페이지 설정 미리보기"
        style={
          grid
            ? {
                backgroundImage:
                  "linear-gradient(#ddd6fe 1px, transparent 1px), linear-gradient(90deg, #ddd6fe 1px, transparent 1px)",
                backgroundSize: "16px 16px",
              }
            : undefined
        }
      >
        <div className="max-w-full rounded border bg-background px-5 py-4 text-center text-sm shadow-sm">
          <strong>
            {paper} · {direction}
          </strong>
          <p>{space} · 예시</p>
        </div>
      </section>
      <p className="text-xs text-muted-foreground">
        이 양식은 PDF 페이지를 추가·삭제하거나 크기를 변경하지 않습니다. 설정은
        위 미리보기만 바꿉니다.
      </p>
      <section className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-semibold">레이어 구성</h3>
        <p className="text-xs text-muted-foreground">
          원본 배경은 항상 잠겨 있습니다. 아래 목록은 왼쪽 레이어 패널과 같은
          화면 예시입니다.
        </p>
        <DrawingLayerPreview
          layers={layers}
          viewer={viewer}
          onChange={onLayersChange}
        />
      </section>
    </div>
  );
}
