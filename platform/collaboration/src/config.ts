import { z } from "zod";

const ConfigSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    PORT: z.coerce.number().int().min(1).max(65_535).default(1234),
    SUPABASE_URL: z.string().url(),
    COLLABORATION_DATABASE_URL: z
      .string()
      .url()
      .refine((value) => /^postgres(?:ql)?:/.test(value)),
    COLLABORATION_ALLOWED_ORIGINS: z.string().min(1),
    COLLABORATION_INTERNAL_SECRET: z.string().min(32),
  })
  .passthrough();

export type DrawingCollaborationConfig = {
  port: number;
  supabaseUrl: string;
  databaseUrl: string;
  allowedOrigins: Set<string>;
  internalSecret: string;
  authorizationIntervalMs: number;
  debounceMs: number;
  maxDebounceMs: number;
};

export function parseDrawingCollaborationConfig(
  environment: Record<string, string | undefined>,
): DrawingCollaborationConfig {
  const value = ConfigSchema.parse(environment);
  const origins = value.COLLABORATION_ALLOWED_ORIGINS.split(",").map((item) =>
    item.trim(),
  );
  if (
    origins.some(
      (origin) =>
        !origin || origin === "*" || new URL(origin).origin !== origin,
    )
  )
    throw new Error("Collaboration origins must be exact URL origins.");
  return {
    port: value.PORT,
    supabaseUrl: value.SUPABASE_URL.replace(/\/$/, ""),
    databaseUrl: value.COLLABORATION_DATABASE_URL,
    allowedOrigins: new Set(origins),
    internalSecret: value.COLLABORATION_INTERNAL_SECRET,
    authorizationIntervalMs: 30_000,
    debounceMs: 1_000,
    maxDebounceMs: 10_000,
  };
}
