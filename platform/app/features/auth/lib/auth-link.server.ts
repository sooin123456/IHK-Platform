import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const AUTH_STATE_AAD = Buffer.from("lukas-auth-link-v1", "utf8");
const AUTH_STATE_TTL_MS = 60 * 60 * 1000;

type AuthError = {
  code?: string;
  message: string;
  status: number;
};

type TokenSession = {
  access_token: string;
  refresh_token: string;
};

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function resolveAuthOrigin(requestUrl: string, configuredAppUrl = process.env.APP_URL) {
  const requestOrigin = new URL(requestUrl);

  // Local development frequently runs on a port selected by the dev server.
  // Returning to a fixed APP_URL such as localhost:3000 would make a link
  // requested on 127.0.0.1:4173 open a server that is not running.
  if (isLoopbackHost(requestOrigin.hostname)) return requestOrigin.origin;

  if (!configuredAppUrl) return requestOrigin.origin;
  const configuredOrigin = new URL(configuredAppUrl);
  if (configuredOrigin.protocol !== "https:") {
    throw new Error("APP_URL must use HTTPS outside local development");
  }
  return configuredOrigin.origin;
}

function stateKey() {
  const secret = requiredEnvironment("AUTH_LINK_STATE_SECRET");
  if (secret.length < 32)
    throw new Error("AUTH_LINK_STATE_SECRET is too short");
  return createHash("sha256").update(secret, "utf8").digest();
}

function sealVerifier(verifier: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", stateKey(), iv);
  cipher.setAAD(AUTH_STATE_AAD);
  const plaintext = Buffer.from(
    JSON.stringify({ expiresAt: Date.now() + AUTH_STATE_TTL_MS, verifier }),
    "utf8",
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [iv, ciphertext, cipher.getAuthTag()]
    .map((part) => part.toString("base64url"))
    .join(".");
}

function openVerifier(state: string) {
  const parts = state.split(".");
  if (parts.length !== 3) throw new Error("Invalid authentication state");
  const [iv, ciphertext, tag] = parts.map((part) =>
    Buffer.from(part, "base64url"),
  );
  if (iv.length !== 12 || tag.length !== 16)
    throw new Error("Invalid authentication state");

  const decipher = createDecipheriv("aes-256-gcm", stateKey(), iv);
  decipher.setAAD(AUTH_STATE_AAD);
  decipher.setAuthTag(tag);
  const payload = JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    ),
  ) as { expiresAt?: unknown; verifier?: unknown };

  if (
    typeof payload.expiresAt !== "number" ||
    payload.expiresAt < Date.now() ||
    typeof payload.verifier !== "string" ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(payload.verifier)
  ) {
    throw new Error("Expired authentication state");
  }
  return payload.verifier;
}

async function authError(response: Response): Promise<AuthError> {
  const body = (await response.json().catch(() => ({}))) as {
    code?: string;
    error_code?: string;
    error_description?: string;
    message?: string;
    msg?: string;
  };
  return {
    code: body.code ?? body.error_code,
    message:
      body.message ??
      body.msg ??
      body.error_description ??
      "Authentication failed",
    status: response.status,
  };
}

function authHeaders() {
  const anonKey = requiredEnvironment("SUPABASE_ANON_KEY");
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "Content-Type": "application/json",
  };
}

export async function sendCrossBrowserMagicLink({
  email,
  next = "/workspace",
  origin,
  shouldCreateUser = true,
}: {
  email: string;
  next?: string;
  origin: string;
  shouldCreateUser?: boolean;
}): Promise<{ error: AuthError | null }> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");
  const callback = new URL("/auth/confirm", origin);
  callback.searchParams.set("next", next);
  callback.searchParams.set("auth_state", sealVerifier(verifier));

  const endpoint = new URL("/auth/v1/otp", requiredEnvironment("SUPABASE_URL"));
  endpoint.searchParams.set("redirect_to", callback.toString());
  const response = await fetch(endpoint, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      code_challenge: challenge,
      code_challenge_method: "s256",
      create_user: shouldCreateUser,
      data: {},
      email,
      gotrue_meta_security: {},
    }),
  });

  return response.ok ? { error: null } : { error: await authError(response) };
}

export async function exchangeCrossBrowserCode(
  code: string,
  state: string,
): Promise<{ error: AuthError | null; session: TokenSession | null }> {
  let verifier: string;
  try {
    verifier = openVerifier(state);
  } catch {
    return {
      error: {
        code: "invalid_auth_state",
        message: "로그인 링크가 만료되었거나 올바르지 않습니다.",
        status: 400,
      },
      session: null,
    };
  }

  const endpoint = new URL(
    "/auth/v1/token?grant_type=pkce",
    requiredEnvironment("SUPABASE_URL"),
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  if (!response.ok) return { error: await authError(response), session: null };

  const body = (await response.json()) as Partial<TokenSession>;
  if (!body.access_token || !body.refresh_token) {
    return {
      error: { message: "로그인 세션을 만들 수 없습니다.", status: 400 },
      session: null,
    };
  }
  return {
    error: null,
    session: {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
    },
  };
}
