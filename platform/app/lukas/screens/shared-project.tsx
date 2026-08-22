import type { Route } from "./+types/shared-project";

import { useEffect, useState } from "react";
import { Link } from "react-router";
import { z } from "zod";

import { Button } from "~/core/components/ui/button";
import { Input } from "~/core/components/ui/input";
import { Label } from "~/core/components/ui/label";

const tokenSchema = z.string().uuid();
const statuses = ["open", "in_review", "resolved", "blocked"] as const;
type SharedData = {
  project: { id: string; name: string; description: string };
  permission: "view" | "review";
  files: Array<{
    id: string;
    kind: string;
    original_filename: string;
    byte_size: number;
    sha256: string;
  }>;
  reviews: Array<{
    id: string;
    status: string;
    note: string;
    updated_at: string;
  }>;
};

const labels: Record<string, string> = {
  open: "미검토",
  in_review: "검토 중",
  resolved: "해결",
  blocked: "보류",
};

export const meta: Route.MetaFunction = () => [
  { title: "공유된 검토 | 한길시스템" },
];

export function loader() {
  return null;
}

async function callShare(
  token: string,
  action: "read" | "review",
  payload?: Record<string, unknown>,
) {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lukas-qto-share`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ token, action, ...payload }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error || "공유 링크를 불러오지 못했습니다.");
  return body as SharedData;
}

export default function SharedProject({ params }: Route.ComponentProps) {
  const token = tokenSchema.safeParse(params.token);
  const [shared, setShared] = useState<SharedData | null>(null);
  const [error, setError] = useState<string | null>(
    token.success ? null : "유효하지 않은 공유 링크입니다.",
  );
  const [loading, setLoading] = useState(token.success);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!token.success) return;
    callShare(token.data, "read")
      .then(setShared)
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false));
  }, [token.success, token.success ? token.data : ""]);

  async function addReview(form: HTMLFormElement) {
    if (!token.success) return;
    setSaving(true);
    setError(null);
    const values = new FormData(form);
    try {
      await callShare(token.data, "review", {
        status: values.get("status"),
        note: values.get("note"),
        file_id: values.get("file_id") || null,
      });
      form.reset();
      setShared(await callShare(token.data, "read"));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "메모를 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <main className="mx-auto max-w-2xl px-5 py-24 text-center text-muted-foreground">
        공유 프로젝트를 불러오는 중입니다.
      </main>
    );
  if (error && !shared)
    return (
      <main className="mx-auto max-w-2xl px-5 py-24 text-center">
        <h1 className="text-2xl font-bold">공유 링크를 열 수 없습니다.</h1>
        <p className="mt-3 text-muted-foreground">{error}</p>
        <Link className="mt-6 inline-block underline" to="/">
          한길시스템으로 돌아가기
        </Link>
      </main>
    );
  if (!shared) return null;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8">
      <p className="text-sm font-semibold text-[#3024d8]">
        한길시스템 / 공유 검토
      </p>
      <h1 className="mt-2 text-3xl font-bold">{shared.project.name}</h1>
      <p className="mt-3 text-muted-foreground">
        {shared.project.description || "프로젝트 설명이 없습니다."}
      </p>
      {error ? (
        <p className="mt-5 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <section className="mt-8 rounded-2xl border bg-card p-6">
        <h2 className="font-semibold">
          공유된 원본 목록 ({shared.files.length})
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          공유 링크에서는 파일 근거를 확인할 수 있으며 원본 다운로드와 변경은
          소유자만 가능합니다.
        </p>
        <div className="mt-4 space-y-3">
          {shared.files.map((file) => (
            <div className="rounded-xl border p-4" key={file.id}>
              <p className="font-medium">{file.original_filename}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                파일 확인번호 · {file.sha256}
              </p>
            </div>
          ))}
        </div>
      </section>
      <section className="mt-8 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        {shared.permission === "review" ? (
          <div className="rounded-2xl border bg-card p-6">
            <h2 className="font-semibold">검토 메모</h2>
            <form
              className="mt-5 grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void addReview(event.currentTarget);
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="file_id">대상 파일 (선택)</Label>
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  id="file_id"
                  name="file_id"
                >
                  <option value="">프로젝트 전체</option>
                  {shared.files.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.original_filename}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="status">상태</Label>
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  defaultValue="in_review"
                  id="status"
                  name="status"
                >
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {labels[status]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="note">메모</Label>
                <textarea
                  className="min-h-28 rounded-md border bg-background p-3 text-sm"
                  id="note"
                  maxLength={5000}
                  name="note"
                  required
                />
              </div>
              <Button disabled={saving} type="submit">
                {saving ? "저장 중…" : "검토 메모 저장"}
              </Button>
            </form>
          </div>
        ) : (
          <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
            이 링크는 보기 전용입니다.
          </div>
        )}
        <div className="rounded-2xl border bg-card p-6">
          <h2 className="font-semibold">검토 이력 ({shared.reviews.length})</h2>
          <div className="mt-5 space-y-4">
            {shared.reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                아직 검토 메모가 없습니다.
              </p>
            ) : (
              shared.reviews.map((review) => (
                <article
                  className="border-l-2 border-primary/30 pl-4"
                  key={review.id}
                >
                  <div className="flex justify-between gap-3">
                    <strong className="text-sm">
                      {labels[review.status] || review.status}
                    </strong>
                    <time className="text-xs text-muted-foreground">
                      {new Intl.DateTimeFormat("ko-KR", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(review.updated_at))}
                    </time>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {review.note}
                  </p>
                </article>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
