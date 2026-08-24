import { useEffect, useRef, useState } from "react";

export type DrawingCommandId =
  | "select"
  | "pan"
  | "line"
  | "polyline"
  | "rectangle"
  | "circle"
  | "text"
  | "dimension"
  | "undo"
  | "redo"
  | "duplicate"
  | "delete"
  | "zoom_to_fit";

export type DrawingCommandRegistryItem = {
  id: DrawingCommandId;
  label: string;
};

export const DRAWING_COMMAND_REGISTRY: readonly DrawingCommandRegistryItem[] = [
  { id: "select", label: "선택 도구" },
  { id: "pan", label: "이동 도구" },
  { id: "line", label: "선 도구" },
  { id: "polyline", label: "폴리라인 도구" },
  { id: "rectangle", label: "사각형 도구" },
  { id: "circle", label: "원 도구" },
  { id: "text", label: "텍스트 도구" },
  { id: "dimension", label: "치수 도구" },
  { id: "undo", label: "실행 취소" },
  { id: "redo", label: "다시 실행" },
  { id: "duplicate", label: "복제" },
  { id: "delete", label: "삭제" },
  { id: "zoom_to_fit", label: "화면 맞춤" },
];

export function filterDrawingCommands<T extends { id: string; label: string }>(
  commands: readonly T[],
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...commands];
  return commands.filter(
    (command) =>
      command.id.toLocaleLowerCase().includes(normalized) ||
      command.label.toLocaleLowerCase().includes(normalized),
  );
}

export function resolveDrawingCommandMenuKey(
  key: string,
  commands: readonly { id: string; enabled: boolean }[],
  selectedIndex: number,
): { kind: "close" } | { kind: "run"; commandId: string } | null {
  if (key === "Escape") return { kind: "close" };
  if (key !== "Enter") return null;
  const selected = commands[selectedIndex];
  return selected?.enabled ? { kind: "run", commandId: selected.id } : null;
}

type DrawingCommandMenuProps = {
  enabled: (commandId: DrawingCommandId) => boolean;
  onClose: () => void;
  onRun: (commandId: DrawingCommandId) => void;
  open: boolean;
};

export function DrawingCommandMenu({
  enabled,
  onClose,
  onRun,
  open,
}: DrawingCommandMenuProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const filtered = filterDrawingCommands(DRAWING_COMMAND_REGISTRY, query).map(
    (command) => ({ ...command, enabled: enabled(command.id) }),
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      aria-labelledby="drawing-command-menu-title"
      className="fixed inset-0 z-50 m-auto w-[min(32rem,calc(100%-2rem))] rounded-xl border border-white/15 bg-slate-900 p-3 text-slate-100 shadow-2xl backdrop:bg-black/60"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      open
    >
      <h2
        className="px-2 pb-2 text-sm font-bold"
        id="drawing-command-menu-title"
      >
        도면 명령
      </h2>
      <label className="sr-only" htmlFor="drawing-command-search">
        도면 명령 검색
      </label>
      <input
        aria-activedescendant={
          filtered[selectedIndex]
            ? `drawing-command-${filtered[selectedIndex].id}`
            : undefined
        }
        aria-controls="drawing-command-results"
        aria-expanded="true"
        aria-label="도면 명령 검색"
        className="min-h-11 w-full rounded-md border border-white/15 bg-slate-950 px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-400"
        id="drawing-command-search"
        onChange={(event) => {
          setQuery(event.target.value);
          setSelectedIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSelectedIndex((index) =>
              filtered.length === 0 ? 0 : (index + 1) % filtered.length,
            );
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSelectedIndex((index) =>
              filtered.length === 0
                ? 0
                : (index - 1 + filtered.length) % filtered.length,
            );
            return;
          }
          const action = resolveDrawingCommandMenuKey(
            event.key,
            filtered,
            selectedIndex,
          );
          if (!action) return;
          event.preventDefault();
          if (action.kind === "close") onClose();
          else {
            onRun(action.commandId as DrawingCommandId);
            onClose();
          }
        }}
        ref={inputRef}
        role="combobox"
        value={query}
      />
      <ul
        className="mt-2 max-h-80 space-y-1 overflow-auto"
        id="drawing-command-results"
        role="listbox"
      >
        {filtered.map((command, index) => (
          <li
            aria-disabled={!command.enabled}
            aria-selected={index === selectedIndex}
            id={`drawing-command-${command.id}`}
            key={command.id}
            role="option"
          >
            <button
              className="flex min-h-11 w-full items-center justify-between rounded-md px-3 text-left text-sm hover:bg-white/10 focus:bg-white/10 disabled:text-slate-500 aria-selected:bg-indigo-500/20"
              disabled={!command.enabled}
              onClick={() => {
                onRun(command.id);
                onClose();
              }}
              onMouseEnter={() => setSelectedIndex(index)}
              type="button"
            >
              <span>{command.label}</span>
              <code className="text-xs text-slate-400">{command.id}</code>
            </button>
          </li>
        ))}
      </ul>
      {filtered.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-slate-400">
          일치하는 명령이 없습니다.
        </p>
      ) : null}
    </dialog>
  );
}
