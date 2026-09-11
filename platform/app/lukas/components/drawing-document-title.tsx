import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";

type RenameResult = {
  ok?: boolean;
  kind?: string;
  error?: string | null;
  result?: { title?: string };
};

export function DrawingDocumentTitle({
  title,
  canRename,
  previewMode = false,
}: {
  title: string;
  canRename: boolean;
  previewMode?: boolean;
}) {
  const fetcher = useFetcher<RenameResult>();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState(title);
  const [dirty, setDirty] = useState(false);
  const error = fetcher.data?.error;

  useEffect(() => {
    setDraft((currentDraft) =>
      drawingDocumentTitleDraftAfterExternalTitle({
        currentDraft,
        externalTitle: title,
        dirty,
      }),
    );
  }, [title]);
  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data?.ok &&
      fetcher.data.kind === "drawing_document_renamed"
    ) {
      setDraft(fetcher.data.result?.title ?? title);
      setDirty(false);
      closeDrawingDocumentTitleEditor(detailsRef.current, summaryRef.current);
    }
  }, [fetcher.data, fetcher.state]);

  return (
    <div className="relative min-w-0">
      <h1 className="truncate text-sm font-bold">{title}</h1>
      {canRename && !previewMode ? (
        <details className="group" ref={detailsRef}>
          <summary
            className="mt-0.5 inline-flex min-h-7 cursor-pointer list-none items-center gap-1 text-xs text-slate-700 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            ref={summaryRef}
          >
            <Pencil className="size-3" /> 도면 이름 변경
          </summary>
          <div className="absolute left-0 z-30 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 shadow-xl">
            <fetcher.Form
              className="grid gap-2"
              method="post"
              onSubmit={() => setDirty(true)}
            >
              <input
                name="intent"
                type="hidden"
                value="rename_drawing_document"
              />
              <input name="expectedTitle" type="hidden" value={title} />
              <Label
                className="text-slate-900"
                htmlFor="drawing-document-title"
              >
                도면 이름
              </Label>
              <Input
                id="drawing-document-title"
                maxLength={160}
                name="title"
                onChange={(event) => {
                  setDraft(event.currentTarget.value);
                  setDirty(true);
                }}
                required
                value={draft}
              />
              {error ? (
                <p className="text-xs text-red-700" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => {
                    setDraft(title);
                    setDirty(false);
                    closeDrawingDocumentTitleEditor(
                      detailsRef.current,
                      summaryRef.current,
                    );
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  취소
                </Button>
                <Button
                  disabled={fetcher.state !== "idle"}
                  size="sm"
                  type="submit"
                >
                  이름 저장
                </Button>
              </div>
            </fetcher.Form>
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function drawingDocumentTitleDraftAfterExternalTitle({
  currentDraft,
  externalTitle,
  dirty,
}: {
  currentDraft: string;
  externalTitle: string;
  dirty: boolean;
}) {
  return dirty ? currentDraft : externalTitle;
}

export function closeDrawingDocumentTitleEditor(
  details: Pick<HTMLDetailsElement, "removeAttribute"> | null,
  summary: Pick<HTMLElement, "focus"> | null,
) {
  details?.removeAttribute("open");
  summary?.focus();
}
