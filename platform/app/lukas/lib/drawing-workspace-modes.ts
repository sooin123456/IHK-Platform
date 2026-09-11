export type DrawingWorkspacePanel =
  | "structure"
  | "styles"
  | "properties"
  | "schedules"
  | "blocks"
  | "collaboration"
  | "history";

export type DrawingInspectorMode = "result" | "object";
export type DrawingWorkspaceMode = "author" | "review" | "quantity";

export const drawingWorkspacePanels: ReadonlyArray<{
  id: DrawingWorkspacePanel;
  label: string;
}> = [
  { id: "structure", label: "페이지·레이어" },
  { id: "styles", label: "스타일" },
  { id: "properties", label: "속성" },
  { id: "schedules", label: "표·일람" },
  { id: "blocks", label: "블록" },
  { id: "collaboration", label: "댓글·이슈" },
  { id: "history", label: "변경 이력" },
];

const modeDefinitions: Record<
  DrawingWorkspaceMode,
  {
    defaultPanel: DrawingWorkspacePanel;
    inspector: DrawingInspectorMode;
    label: string;
    panels: readonly DrawingWorkspacePanel[];
  }
> = {
  author: {
    defaultPanel: "structure",
    inspector: "object",
    label: "작성",
    panels: ["structure", "styles", "blocks"],
  },
  review: {
    defaultPanel: "collaboration",
    inspector: "object",
    label: "검토",
    panels: ["collaboration", "history"],
  },
  quantity: {
    defaultPanel: "schedules",
    inspector: "result",
    label: "수량·금액",
    panels: ["schedules", "properties"],
  },
};

export const drawingWorkspaceModes = (
  Object.keys(modeDefinitions) as DrawingWorkspaceMode[]
).map((id) => ({ id, ...modeDefinitions[id] }));

export function drawingWorkspaceModeDefinition(mode: DrawingWorkspaceMode) {
  return modeDefinitions[mode];
}

export function drawingWorkspaceModeForPanel(
  panel: DrawingWorkspacePanel,
): DrawingWorkspaceMode {
  return drawingWorkspaceModes.find((mode) => mode.panels.includes(panel))!.id;
}

export function drawingWorkspaceModeChangeForPanel(
  activeMode: DrawingWorkspaceMode,
  panel: DrawingWorkspacePanel,
): { inspector: DrawingInspectorMode | null; mode: DrawingWorkspaceMode } {
  const mode = drawingWorkspaceModeForPanel(panel);
  return {
    inspector:
      mode === activeMode
        ? null
        : drawingWorkspaceModeDefinition(mode).inspector,
    mode,
  };
}

export function resolveDrawingWorkspaceModeKey(
  activeMode: DrawingWorkspaceMode,
  key: string,
): DrawingWorkspaceMode | null {
  if (key === "Home") return "author";
  if (key === "End") return "quantity";
  const offset =
    key === "ArrowRight" || key === "ArrowDown"
      ? 1
      : key === "ArrowLeft" || key === "ArrowUp"
        ? -1
        : 0;
  if (!offset) return null;
  const currentIndex = drawingWorkspaceModes.findIndex(
    (mode) => mode.id === activeMode,
  );
  return drawingWorkspaceModes[
    (currentIndex + offset + drawingWorkspaceModes.length) %
      drawingWorkspaceModes.length
  ].id;
}

export function resolveDrawingWorkspacePanelKey(
  activePanel: DrawingWorkspacePanel,
  key: string,
  visiblePanels: readonly DrawingWorkspacePanel[] = drawingWorkspacePanels.map(
    (panel) => panel.id,
  ),
): DrawingWorkspacePanel | null {
  if (!visiblePanels.length) return null;
  if (key === "Home") return visiblePanels[0];
  if (key === "End") return visiblePanels[visiblePanels.length - 1];
  const offset =
    key === "ArrowRight" || key === "ArrowDown"
      ? 1
      : key === "ArrowLeft" || key === "ArrowUp"
        ? -1
        : 0;
  if (!offset) return null;
  const currentIndex = Math.max(0, visiblePanels.indexOf(activePanel));
  return visiblePanels[
    (currentIndex + offset + visiblePanels.length) % visiblePanels.length
  ];
}
