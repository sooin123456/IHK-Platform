import {
  createLocalJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";
import { z } from "zod";

import { parseDrawingRoomName } from "../../app/lukas/lib/drawing-collaboration-protocol.ts";

const UserIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );

export type VerifiedDrawingUser = { userId: string; email: string | null };
export type DrawingRoomAuthorization = {
  capability: string;
  canWrite: boolean;
  revisionStatus: string;
};
export type DrawingConnectionContext = VerifiedDrawingUser &
  DrawingRoomAuthorization & {
    projectId: string;
    revisionId: string;
    roomName: string;
    displayName: string;
    color: string;
    lastAuthorizedAt: number;
  };

function asymmetricJwks(value: unknown): JSONWebKeySet {
  const parsed = z
    .object({ keys: z.array(z.record(z.unknown())) })
    .strict()
    .parse(value);
  const keys = parsed.keys.filter(
    (key) =>
      (key.alg === "RS256" && key.kty === "RSA") ||
      (key.alg === "ES256" && key.kty === "EC"),
  );
  if (!keys.length)
    throw new Error("Supabase must expose an asymmetric RS256 or ES256 JWKS.");
  return { keys } as JSONWebKeySet;
}

async function fetchJwks(
  supabaseUrl: string,
  fetcher: typeof fetch,
): Promise<JSONWebKeySet> {
  const response = await fetcher(
    `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
    { headers: { accept: "application/json" } },
  );
  if (!response.ok) throw new Error("Supabase JWKS is unavailable.");
  return asymmetricJwks(await response.json());
}

export async function verifyDrawingAccessToken(input: {
  token: string;
  supabaseUrl: string;
  jwks?: unknown;
  fetcher?: typeof fetch;
}): Promise<VerifiedDrawingUser> {
  if (!input.token) throw new Error("Drawing access token is required.");
  const supabaseUrl = input.supabaseUrl.replace(/\/$/, "");
  const jwks = asymmetricJwks(
    input.jwks ?? (await fetchJwks(supabaseUrl, input.fetcher ?? fetch)),
  );
  const result = await jwtVerify(input.token, createLocalJWKSet(jwks), {
    algorithms: ["RS256", "ES256"],
    issuer: `${supabaseUrl}/auth/v1`,
    audience: "authenticated",
  });
  return verifiedPayload(result.payload);
}

export function createDrawingAccessTokenVerifier(input: {
  supabaseUrl: string;
  fetcher?: typeof fetch;
  cacheMs?: number;
  now?: () => number;
}) {
  let cached: { value: JSONWebKeySet; expiresAt: number } | null = null;
  const now = input.now ?? Date.now;
  const fetcher = input.fetcher ?? fetch;
  const cacheMs = input.cacheMs ?? 10 * 60_000;
  async function refresh() {
    cached = {
      value: await fetchJwks(input.supabaseUrl.replace(/\/$/, ""), fetcher),
      expiresAt: now() + cacheMs,
    };
    return cached!.value;
  }
  async function get(token: string) {
    const header = decodeProtectedHeader(token);
    if (
      !cached ||
      cached.expiresAt <= now() ||
      !cached.value.keys.some((key) => key.kid === header.kid)
    )
      await refresh();
    return cached!.value;
  }
  return {
    async verify(token: string) {
      return verifyDrawingAccessToken({
        token,
        supabaseUrl: input.supabaseUrl,
        jwks: await get(token),
      });
    },
    async preflight() {
      await refresh();
    },
    purge() {
      cached = null;
    },
  };
}

function verifiedPayload(payload: JWTPayload): VerifiedDrawingUser {
  const userId = UserIdSchema.parse(payload.sub);
  if (payload.role !== "authenticated" || payload.is_anonymous === true)
    throw new Error("Only authenticated non-anonymous users may collaborate.");
  return {
    userId,
    email:
      typeof payload.email === "string" && payload.email.length <= 320
        ? payload.email
        : null,
  };
}

function stableColor(userId: string): string {
  let hash = 0;
  for (const character of userId)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `#${(hash & 0xffffff).toString(16).padStart(6, "0")}`;
}

export async function authorizeDrawingRoom(input: {
  token: string;
  origin: string | null;
  roomName: string;
  allowedOrigins: Set<string>;
  verifyToken: (token: string) => Promise<VerifiedDrawingUser>;
  authorize: (
    userId: string,
    projectId: string,
    revisionId: string,
  ) => Promise<DrawingRoomAuthorization>;
  now?: () => number;
}): Promise<DrawingConnectionContext> {
  if (!input.origin || !input.allowedOrigins.has(input.origin))
    throw new Error("Drawing collaboration origin is not allowed.");
  const room = parseDrawingRoomName(input.roomName);
  const user = await input.verifyToken(input.token);
  const access = await input.authorize(
    user.userId,
    room.projectId,
    room.revisionId,
  );
  if (!access) throw new Error("Drawing collaboration target is unavailable.");
  const label =
    user.email?.split("@")[0]?.trim() || `사용자 ${user.userId.slice(0, 8)}`;
  return {
    ...user,
    ...access,
    ...room,
    roomName: input.roomName,
    displayName: label.slice(0, 120),
    color: stableColor(user.userId),
    lastAuthorizedAt: (input.now ?? Date.now)(),
  };
}
