import { useState } from "react";
import { Form, useNavigation } from "react-router";

import { Button } from "~/core/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/core/components/ui/dialog";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";
import type {
  DrawingTemplateCandidate,
  DrawingWorkspaceFile,
} from "~/lukas/lib/drawing-workspace.server";

type DrawingTemplateDialogProps = {
  actionError?: string;
  candidates: DrawingTemplateCandidate[];
  sourceFile: DrawingWorkspaceFile;
};

function formatApprovedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function DrawingTemplateDialog({
  actionError,
  candidates,
  sourceFile,
}: DrawingTemplateDialogProps) {
  const [open, setOpen] = useState(Boolean(actionError));
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const navigation = useNavigation();
  const saving =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "create_from_template";

  if (candidates.length === 0) return null;

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button className="min-h-11 rounded-lg" type="button" variant="outline">
          템플릿에서 시작
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>승인된 템플릿에서 도면 시작</DialogTitle>
          <DialogDescription>
            이 프로젝트에서 승인된 리비전만 선택할 수 있습니다. 새 도면은
            초안으로 만들어지며 원본 승인 리비전은 변경되지 않습니다.
          </DialogDescription>
        </DialogHeader>
        <Form
          className="grid gap-5"
          method="post"
          onSubmit={(event) => {
            if (saving) event.preventDefault();
          }}
        >
          <input name="intent" type="hidden" value="create_from_template" />
          <input
            name="client_request_id"
            type="hidden"
            value={clientRequestId}
          />
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold">템플릿 선택</legend>
            {candidates.map((candidate, index) => (
              <label
                className="grid cursor-pointer gap-1 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                key={candidate.revisionId}
              >
                <span className="flex items-center gap-2 font-semibold">
                  <input
                    defaultChecked={index === 0}
                    name="source_revision_id"
                    required
                    type="radio"
                    value={candidate.revisionId}
                  />
                  {candidate.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  리비전 v{candidate.version} · 승인{" "}
                  {formatApprovedAt(candidate.approvedAt)}
                </span>
                <code className="break-all text-xs text-muted-foreground">
                  승인 스냅샷 SHA-256: {candidate.snapshotSha256}
                </code>
              </label>
            ))}
          </fieldset>
          <div className="grid gap-2">
            <Label htmlFor="drawing-template-title">새 도면 제목</Label>
            <Input
              autoFocus
              defaultValue={`${candidates[0]?.title ?? "도면"} 사본`}
              id="drawing-template-title"
              maxLength={240}
              name="title"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="drawing-template-source">원본 참조 (선택)</Label>
            <select
              className="min-h-11 rounded-lg border bg-background px-3"
              defaultValue=""
              id="drawing-template-source"
              name="source_file_id"
            >
              <option value="">원본 참조 없이 시작</option>
              <option value={sourceFile.id}>
                현재 원본 사용: {sourceFile.original_filename} (
                {sourceFile.sha256.slice(0, 12)}…)
              </option>
            </select>
            <p className="text-xs text-muted-foreground">
              선택한 원본은 서버에서 템플릿의 승인된 참조와 SHA-256 일치 여부를
              다시 확인합니다.
            </p>
          </div>
          {actionError ? (
            <p className="text-sm text-destructive" role="alert">
              {actionError}
            </p>
          ) : null}
          <DialogFooter>
            <Button disabled={saving} type="submit">
              {saving ? "저장 중…" : "초안 도면 만들기"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
