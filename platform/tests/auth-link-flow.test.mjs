import assert from "node:assert/strict";
import test from "node:test";

process.env.AUTH_LINK_STATE_SECRET =
  "test-only-secret-that-is-at-least-32-characters";
process.env.SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_URL = "https://example.supabase.co";

const authLink = await import("../app/features/auth/lib/auth-link.server.ts");

const {
  exchangeCrossBrowserCode,
  resolveAuthOrigin,
  safeAuthNextPath,
  sendCrossBrowserMagicLink,
} = authLink;

test("unauthenticated deep links return to their exact internal path and query", () => {
  assert.equal(
    authLink.authLoginPath(
      "https://lukas.example/projects/project-42/workspaces/workspace-7?tab=measurements&source=alert",
    ),
    "/login?next=%2Fprojects%2Fproject-42%2Fworkspaces%2Fworkspace-7%3Ftab%3Dmeasurements%26source%3Dalert",
  );
});

test("notification authentication preserves its internal return through magic link", () => {
  assert.equal(
    authLink.authMagicLinkPath(
      "https://lukas.example/notifications?unread=true",
    ),
    "/auth/magic-link?next=%2Fnotifications%3Funread%3Dtrue",
  );
});

test("authentication next paths reject external and protocol-relative redirects", () => {
  for (const unsafe of [
    "https://evil.example/accept",
    "//evil.example/accept",
    "/\\evil.example/accept",
  ])
    assert.equal(safeAuthNextPath(unsafe), null);
});

test("authentication accepts exact internal invitation returns and rejects external redirects", () => {
  const invitation =
    "/organization-invitations/75000000-0000-4000-8000-000000000003/accept";
  assert.equal(safeAuthNextPath(invitation), invitation);
  for (const unsafe of [
    "https://evil.example/accept",
    "//evil.example/accept",
    "/\\evil.example/accept",
    "workspace",
  ])
    assert.equal(safeAuthNextPath(unsafe), null);
});

test("local magic links return to the active development origin", () => {
  assert.equal(
    resolveAuthOrigin(
      "http://127.0.0.1:4173/auth/magic-link",
      "http://localhost:3000",
    ),
    "http://127.0.0.1:4173",
  );
});

test("production magic links use the configured canonical HTTPS origin", () => {
  assert.equal(
    resolveAuthOrigin(
      "https://preview-123.vercel.app/auth/magic-link",
      "https://lukas-qto-platform.vercel.app/some/path",
    ),
    "https://lukas-qto-platform.vercel.app",
  );
  assert.throws(
    () =>
      resolveAuthOrigin(
        "https://preview-123.vercel.app/auth/magic-link",
        "http://lukas-qto-platform.vercel.app",
      ),
    /HTTPS/,
  );
  assert.throws(
    () =>
      resolveAuthOrigin("https://preview-123.vercel.app/auth/magic-link", ""),
    /APP_URL is required outside local development/,
  );
});

test("cross-browser PKCE state survives an email browser without exposing the verifier", async () => {
  const originalFetch = globalThis.fetch;
  let sentRequest;
  globalThis.fetch = async (input, init) => {
    sentRequest = { init, url: String(input) };
    return new Response("{}", { status: 200 });
  };

  try {
    const sent = await sendCrossBrowserMagicLink({
      email: "staff@example.com",
      origin: "https://lukas-qto-platform.vercel.app",
    });
    assert.equal(sent.error, null);
    const otpUrl = new URL(sentRequest.url);
    const callback = new URL(otpUrl.searchParams.get("redirect_to"));
    const state = callback.searchParams.get("auth_state");
    const body = JSON.parse(sentRequest.init.body);
    assert.equal(otpUrl.pathname, "/auth/v1/otp");
    assert.equal(callback.pathname, "/auth/confirm");
    assert.match(state, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(body.code_challenge_method, "s256");
    assert.match(body.code_challenge, /^[A-Za-z0-9_-]{43}$/);

    globalThis.fetch = async (input, init) => {
      const tokenUrl = new URL(String(input));
      const tokenBody = JSON.parse(init.body);
      assert.equal(tokenUrl.searchParams.get("grant_type"), "pkce");
      assert.equal(tokenBody.auth_code, "one-time-code");
      assert.match(tokenBody.code_verifier, /^[A-Za-z0-9_-]{43}$/);
      return Response.json({
        access_token: "access-token",
        refresh_token: "refresh-token",
      });
    };
    const exchanged = await exchangeCrossBrowserCode("one-time-code", state);
    assert.equal(exchanged.error, null);
    assert.deepEqual(exchanged.session, {
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tampered authentication state is rejected before token exchange", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("token endpoint must not be called");
  };
  try {
    const result = await exchangeCrossBrowserCode(
      "code",
      "tampered.state.value",
    );
    assert.equal(result.session, null);
    assert.equal(result.error?.code, "invalid_auth_state");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
