import type { LoaderFunctionArgs } from "react-router";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "database.types";
import { redirect } from "react-router";

import makeServerClient from "~/core/lib/supa-client.server";

import { readPublicReleaseConfig } from "../lib/release-config";
import {
  assertReleaseArtifactSha256,
  recordRevitDownloadAudit,
} from "../lib/revit-download-audit.server";

type DownloadDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      lukas_qto_license_entitlements: {
        Row: { user_id: string; plan: "free"; status: "active"; granted_at: string };
        Insert: { user_id: string; plan?: "free"; status?: "active"; granted_at?: string };
        Update: never;
        Relationships: [];
      };
    };
  };
};

export async function loader({ request }: LoaderFunctionArgs) {
  const release = readPublicReleaseConfig({
    url: import.meta.env.VITE_REVIT_2025_BETA_URL as string | undefined,
    sha256: import.meta.env.VITE_REVIT_2025_BETA_SHA256 as string | undefined,
    version: import.meta.env.VITE_REVIT_2025_BETA_VERSION as string | undefined,
  });
  if (!release.ready || !release.url || !release.sha256)
    throw new Response("현재 내려받을 수 있는 검증 릴리스가 없습니다.", { status: 503 });
  try {
    await assertReleaseArtifactSha256(release.url, release.sha256);
  } catch (error) {
    throw new Response(
      error instanceof Error
        ? error.message
        : "릴리스 파일을 확인하지 못했습니다.",
      { status: 409 },
    );
  }

  const [rawClient, headers] = makeServerClient(request);
  const { data: { user } } = await rawClient.auth.getUser();
  if (user && !user.is_anonymous) {
    const client = rawClient as unknown as SupabaseClient<DownloadDatabase>;
    const { data: existing, error: readError } = await client
      .from("lukas_qto_license_entitlements")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) throw new Response("무료 이용권을 확인하지 못했습니다.", { status: 500 });
    if (!existing) {
      const { error: insertError } = await client.from("lukas_qto_license_entitlements").insert({ user_id: user.id });
      if (insertError && insertError.code !== "23505") throw new Response("무료 이용권을 만들지 못했습니다.", { status: 500 });
    }
  }
  const { default: admin } = await import(
    "~/core/lib/supa-admin-client.server"
  );
  try {
    await recordRevitDownloadAudit(admin as any, user?.id ?? null, {
      version: release.version,
      sha256: release.sha256,
    });
  } catch {
    throw new Response("다운로드 기록을 남기지 못했습니다.", { status: 500 });
  }
  headers.set("Location", release.url);
  headers.set("Cache-Control", "private, no-store");
  throw redirect(release.url, { headers });
}
