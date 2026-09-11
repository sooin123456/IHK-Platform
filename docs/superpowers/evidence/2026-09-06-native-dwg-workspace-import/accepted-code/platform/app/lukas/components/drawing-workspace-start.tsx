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
          빈 작업실, 검증된 플랫폼 템플릿, PDF·IFC·DXF·DWG 원본을 같은 단계에서
          선택합니다.
        </p>
      </header>

      <section aria-labelledby="native-workspace-title" className="mt-7">
        <h2 id="native-workspace-title" className="text-xl font-bold">예제 도면으로 시작</h2>
        <p className="mt-2 text-sm text-muted-foreground">편집 가능한 기본 도면 · mm · A3 1:50 · 예제·가정값 — 현장 확인 필요</p>
        {loaderData.catalogNotices?.nativeTemplates ? <p className="mt-3 text-sm text-muted-foreground" role="status">{loaderData.catalogNotices.nativeTemplates}</p> : null}
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {(loaderData.nativeTemplates ?? []).map((template: any) => (
            <article aria-label={template.name} className="overflow-hidden rounded-2xl border bg-card" key={template.key}>
              <img alt={`${template.name} 미리보기`} className="aspect-[420/297] w-full bg-white object-contain" src={`/projects/${loaderData.project.id}/drawing-native-assets?kind=workspace_template&key=${encodeURIComponent(template.key)}`} />
              <div className="p-4">
                <h3 className="font-bold">{template.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">1HK 기본 · 예제 · v{template.version}</p>
                <p className="mt-2 text-sm text-muted-foreground">{template.description}</p>
                <StartForm actionData={actionData} className="mt-4 grid gap-3" intent="create_native_template" pair={loaderData.requestPairs.nativeTemplates[template.key]} submitLabel="이 도면으로 시작">
                  <input name="nativeKey" type="hidden" value={template.key} />
                  <input name="nativeVersion" type="hidden" value="1" />
                </StartForm>
              </div>
            </article>
          ))}
        </div>
      </section>

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
          {loaderData.catalogNotices?.starters ? (
            <p className="mt-4 text-sm text-muted-foreground" role="status">
              {loaderData.catalogNotices.starters}
            </p>
          ) : null}
          {loaderData.catalogNotices?.organizationTemplates ? (
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              {loaderData.catalogNotices.organizationTemplates}
            </p>
          ) : null}
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
                    loaderData.starterKey === starter.definition.key ||
                    undefined
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
                        autoFocus={
                          loaderData.starterKey === starter.definition.key
                        }
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
          aria-labelledby="source-workspace-title"
          className="rounded-2xl border bg-card p-5"
        >
          <FileText className="size-6 text-primary" />
          <h2 className="mt-3 text-xl font-bold" id="source-workspace-title">
            원본으로 시작
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            PDF는 잠긴 배경, IFC는 3D 원본으로 연결하고 DXF·DWG는 새
            작업실에서 가져옵니다.
          </p>
          {loaderData.files.length === 0 ? (
            <p className="mt-5 text-sm text-muted-foreground">
              연결할 도면 원본이 없습니다. 빈 작업실이나 템플릿을 선택할 수
              있습니다.
            </p>
          ) : (
            <div className="mt-5 grid gap-4">
              {loaderData.files.map((file: any) => {
                const sourceKind =
                  file.kind === "ifc"
                    ? "IFC"
                    : file.kind === "dxf"
                      ? "DXF"
                      : file.kind === "dwg"
                        ? "DWG"
                        : "PDF";
                const intent =
                  file.kind === "ifc"
                    ? "create_ifc"
                    : file.kind === "dxf"
                      ? "create_dxf"
                      : file.kind === "dwg"
                        ? "create_dwg"
                        : "create_pdf";
                if (file.workspaceId)
                  return (
                    <article
                      className="grid gap-3 rounded-xl border p-4"
                      data-focused={
                        loaderData.sourceFileId === file.id || undefined
                      }
                      key={file.id}
                    >
                      <p className="text-sm font-semibold">
                        {file.original_filename}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        이 원본은 이미 작업실에 연결되어 있습니다.
                      </p>
                      <Link
                        autoFocus={loaderData.sourceFileId === file.id}
                        className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
                        to={`/projects/${loaderData.project.id}/workspaces/${file.workspaceId}`}
                      >
                        {file.original_filename} 작업실 열기
                      </Link>
                    </article>
                  );
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
                    intent={intent}
                    key={file.id}
                    pair={pair}
                    submitLabel={`${file.original_filename} ${sourceKind}로 시작`}
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
                        autoFocus={loaderData.sourceFileId === file.id}
                        defaultValue={file.original_filename.replace(
                          /\.(pdf|ifc|dxf|dwg)$/i,
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
