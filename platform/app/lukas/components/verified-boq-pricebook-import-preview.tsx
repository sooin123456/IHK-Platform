import { Form } from "react-router";

import { Button } from "~/core/components/ui/button";

type HeaderMapping = {
  sourceColumn: number;
  sourceHeader: string;
  requiredHeader: string | null;
};

type ImportError = {
  row: number | null;
  field: string | null;
  reason: string;
};

export type VerifiedBoqPriceBookImportPreviewValue = {
  bookId: string;
  filename: string;
  sourceSha256: string;
  reportUrl: string;
  headerMapping: HeaderMapping[];
  validRowCount: number;
  errors: ImportError[];
  totalErrorCount: number;
  errorsTruncated: boolean;
};

function Hidden({ name, value }: { name: string; value: string }) {
  return <input name={name} type="hidden" value={value} />;
}

export function VerifiedBoqPriceBookImportPreview({
  preview,
  returnTo,
}: {
  preview: VerifiedBoqPriceBookImportPreviewValue;
  returnTo: string | null;
}) {
  return (
    <section
      aria-label="단가표 가져오기 미리보기"
      className="mt-4 space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4"
    >
      <div>
        <h3 className="font-semibold">단가표 가져오기 미리보기</h3>
        <p className="mt-1 break-all text-xs text-muted-foreground">
          {preview.filename} · SHA-256 {preview.sourceSha256.slice(0, 12)}…
        </p>
        <p className="mt-2 text-sm">
          유효 {preview.validRowCount}행 · 오류 {preview.totalErrorCount}건
        </p>
      </div>

      <div>
        <h4 className="text-sm font-semibold">헤더 매핑</h4>
        <ul className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
          {preview.headerMapping.map((mapping) => (
            <li
              className="rounded-lg border bg-background p-2"
              key={`${mapping.sourceColumn}:${mapping.sourceHeader}`}
            >
              {mapping.sourceColumn}열 · {mapping.sourceHeader || "(빈 헤더)"}
              <span aria-hidden="true"> → </span>
              {mapping.requiredHeader ?? "매핑 안 됨"}
            </li>
          ))}
        </ul>
      </div>

      {preview.totalErrorCount > 0 ? (
        <div>
          <h4 className="text-sm font-semibold">오류 행과 이유</h4>
          <ul className="mt-2 max-h-48 space-y-2 overflow-auto text-sm">
            {preview.errors.map((error, index) => (
              <li
                className="rounded-lg bg-destructive/10 p-2 text-destructive"
                key={`${error.row ?? "file"}:${error.field ?? "file"}:${index}`}
              >
                {error.row === null ? "파일" : `${error.row}행`}
                {error.field ? ` · ${error.field}` : ""} · {error.reason}
              </li>
            ))}
          </ul>
          {preview.errorsTruncated ? (
            <p className="mt-2 text-xs text-muted-foreground">
              화면과 CSV에는 첫 {preview.errors.length}건 및 전체 오류 건수를
              표시합니다.
            </p>
          ) : null}
          <Button asChild className="mt-3 min-h-11" variant="outline">
            <a download href={preview.reportUrl}>
              오류 CSV 다운로드
            </a>
          </Button>
        </div>
      ) : (
        <Form method="post">
          <Hidden name="intent" value="resource_import" />
          <Hidden name="price_book_id" value={preview.bookId} />
          <Hidden name="return_to" value={returnTo ?? ""} />
          <p className="mb-3 text-xs text-muted-foreground">
            반영할 때 원본 파일과 SHA-256을 다시 확인하며, 일부 행만 저장하지
            않습니다.
          </p>
          <Button className="min-h-11" type="submit">
            검사 결과 반영
          </Button>
        </Form>
      )}
    </section>
  );
}
