import { FileText, LayoutTemplate, Plus } from "lucide-react";
import { Form, Link, useNavigation } from "react-router";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";

type RequestPair = { clientRequestId: string; clientCreatedAt?: string };
type StartActionData = {
  ok: false;
  fieldErrors: Record<string, string>;
  formError: string | null;
  clientRequestId: string | null;
  clientCreatedAt: string | null;
};

function ErrorMessage({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p className="text-sm text-destructive" id={id}>
      {message}
    </p>
  ) : null;
}

export function drawingWorkspaceStartFieldError(
  actionData: StartActionData | undefined,
  pair: RequestPair,
  field: string,
) {
  return actionData?.clientRequestId === pair.clientRequestId
    ? actionData.fieldErrors[field]
    : undefined;
}

export function drawingWorkspaceStartChoiceFocused(
  selected: string | undefined,
  candidate: string,
) {
  return selected === candidate;
}

function StartForm({
  children,
  className = "grid gap-3",
  intent,
  pair,
  actionData,
  submitLabel,
}: {
  children: React.ReactNode;
  className?: string;
  intent: string;
  pair: RequestPair;
  actionData?: StartActionData;
  submitLabel: string;
}) {
  const navigation = useNavigation();
  const effectivePair =
    actionData?.clientRequestId === pair.clientRequestId
      ? {
          clientRequestId: actionData.clientRequestId,
          clientCreatedAt: actionData.clientCreatedAt ?? pair.clientCreatedAt,
        }
      : pair;
  const submitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("clientRequestId") ===
      effectivePair.clientRequestId;
  const failed = actionData?.clientRequestId === effectivePair.clientRequestId;
  return (
    <Form className={className} method="post">
      <input name="intent" type="hidden" value={intent} />
      <input
        name="clientRequestId"
        type="hidden"
        value={effectivePair.clientRequestId}
      />
      {effectivePair.clientCreatedAt ? (
        <input
          name="clientCreatedAt"
          type="hidden"
          value={effectivePair.clientCreatedAt}
        />
      ) : null}
      {children}
      {failed && actionData.formError ? (
        <p className="text-sm text-destructive" role="alert">
          {actionData.formError}
        </p>
      ) : null}
      <Button disabled={submitting} type="submit">
        {submitting ? `${submitLabel} 만드는 중…` : submitLabel}
      </Button>
    </Form>
  );
}

export function DrawingWorkspaceStart({
  actionData,
  loaderData,
}: {
  actionData?: StartActionData;
  loaderData: any;
}) {
  const blankPair = loaderData.requestPairs.blank as RequestPair;
  const blankTitleError = drawingWorkspaceStartFieldError(
    actionData,
    blankPair,
    "title",
  );
  return (
    <main className="mx-auto w-full max-w-7xl px-5 pb-24 pt-8 sm:px-8">
      <Link
        className="text-sm underline underline-offset-4"
        to={`/projects/${loaderData.project.id}/drawings`}
      >
        ← 도면 파일함
      </Link>
      <header className="mt-5 border-b pb-7">
        <p className="text-sm font-semibold text-primary">
          {loaderData.project.name}
        </p>
        <h1 className="mt-2 text-3xl font-bold">새 작업실</h1>
        <p className="mt-2 text-muted-foreground">
          빈 작업실, 검증된 플랫폼 템플릿, PDF 원본을 같은 단계에서 선택합니다.
        </p>
      </header>

      <div className="mt-7 grid gap-5 lg:grid-cols-3">
        <section
          aria-labelledby="blank-workspace-title"
          className="rounded-2xl border bg-card p-5"
        >
          <Plus className="size-6 text-primary" />
          <h2 className="mt-3 text-xl font-bold" id="blank-workspace-title">
            빈 작업실
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            원본 없이 수기 입력이나 현장 실측부터 시작합니다.
          </p>
          <StartForm
            actionData={actionData}
            className="mt-5 grid gap-3"
            intent="create_blank"
            pair={blankPair}
            submitLabel="빈 작업실로 시작"
          >
            <label className="grid gap-1 text-sm">
              <span>작업실 이름</span>
              <Input
                aria-describedby={
                  blankTitleError ? "start-blank-title-error" : undefined
                }
                aria-invalid={Boolean(blankTitleError)}
                id="start-blank-title"
                maxLength={240}
                name="title"
                required
              />
              <ErrorMessage
                id="start-blank-title-error"
                message={blankTitleError}
              />
            </label>
          </StartForm>
        </section>

        <section
          aria-labelledby="starter-workspace-title"
          className="rounded-2xl border bg-card p-5"
        >
          <LayoutTemplate className="size-6 text-primary" />
          <h2 className="mt-3 text-xl font-bold" id="starter-workspace-title">
            템플릿으로 시작
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            실내건축·리모델링 기본 분류와 내역 구조를 불러옵니다.
          </p>
          <div className="mt-5 grid gap-4">
            {loaderData.starters.map((starter: any) => {
              const pair = loaderData.requestPairs.starters[
                starter.definition.key
              ] as RequestPair;
              const titleError = drawingWorkspaceStartFieldError(
                actionData,
                pair,
                "title",
              );
              const titleId = `start-starter-${starter.definition.key}-title`;
              const errorId = `${titleId}-error`;
              return (
                <article
                  className="rounded-xl border p-4"
                  data-focused={
                    drawingWorkspaceStartChoiceFocused(
                      loaderData.starterKey,
                      starter.definition.key,
                    ) || undefined
                  }
                  key={starter.definition.key}
                >
                  <h3 className="font-bold">{starter.definition.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {starter.definition.description}
                  </p>
                  <StartForm
                    actionData={actionData}
                    className="mt-3 grid gap-3"
                    intent="create_starter"
                    pair={pair}
                    submitLabel={`${starter.definition.name} 템플릿으로 시작`}
                  >
                    <input
                      name="starterKey"
                      type="hidden"
                      value={starter.definition.key}
                    />
                    <input name="starterVersion" type="hidden" value="1" />
                    <label className="grid gap-1 text-sm">
                      <span>작업실 이름</span>
                      <Input
                        aria-describedby={titleError ? errorId : undefined}
                        aria-invalid={Boolean(titleError)}
                        autoFocus={drawingWorkspaceStartChoiceFocused(
                          loaderData.starterKey,
                          starter.definition.key,
                        )}
                        defaultValue={starter.definition.name}
                        id={titleId}
                        maxLength={240}
                        name="title"
                        required
                      />
                      <ErrorMessage id={errorId} message={titleError} />
                    </label>
                  </StartForm>
                </article>
              );
            })}
            {loaderData.organizationTemplates.map((template: any) => {
              const pair = loaderData.requestPairs.libraryTemplates[
                template.id
              ] as RequestPair;
              return (
                <article className="rounded-xl border p-4" key={template.id}>
                  <h3 className="font-bold">{template.entry.name}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    회사 라이브러리 고정 버전 · v{template.version_no}
                  </p>
                  <StartForm
                    actionData={actionData}
                    className="mt-3 grid gap-3"
                    intent="create_library_template"
                    pair={pair}
                    submitLabel={`${template.entry.name} 회사 템플릿으로 시작`}
                  >
                    <input
                      name="libraryVersionId"
                      type="hidden"
                      value={template.id}
                    />
                  </StartForm>
                </article>
              );
            })}
          </div>
        </section>

        <section
          aria-labelledby="pdf-workspace-title"
          className="rounded-2xl border bg-card p-5"
        >
          <FileText className="size-6 text-primary" />
          <h2 className="mt-3 text-xl font-bold" id="pdf-workspace-title">
            PDF로 시작
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            검증된 프로젝트 PDF를 잠긴 배경으로 연결합니다.
          </p>
          {loaderData.files.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">
              연결할 PDF가 없습니다. 빈 작업실이나 템플릿을 선택할 수 있습니다.
            </p>
          ) : (
            <div className="mt-5 grid gap-4">
              {loaderData.files.map((file: any) => {
                const pair = loaderData.requestPairs.pdfs[
                  file.id
                ] as RequestPair;
                const titleError = drawingWorkspaceStartFieldError(
                  actionData,
                  pair,
                  "title",
                );
                const titleId = `start-pdf-${file.id}-title`;
                const errorId = `${titleId}-error`;
                return (
                  <StartForm
                    actionData={actionData}
                    className="grid gap-3 rounded-xl border p-4"
                    intent="create_pdf"
                    key={file.id}
                    pair={pair}
                    submitLabel={`${file.original_filename} PDF로 시작`}
                  >
                    <input name="sourceFileId" type="hidden" value={file.id} />
                    <p className="text-sm font-semibold">
                      {file.original_filename}
                    </p>
                    <label className="grid gap-1 text-sm">
                      <span>작업실 이름</span>
                      <Input
                        aria-describedby={titleError ? errorId : undefined}
                        aria-invalid={Boolean(titleError)}
                        autoFocus={drawingWorkspaceStartChoiceFocused(
                          loaderData.sourceFileId,
                          file.id,
                        )}
                        defaultValue={file.original_filename.replace(
                          /\.pdf$/i,
                          "",
                        )}
                        id={titleId}
                        maxLength={240}
                        name="title"
                        required
                      />
                      <ErrorMessage id={errorId} message={titleError} />
                    </label>
                  </StartForm>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
