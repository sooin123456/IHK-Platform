/**
 * Email Confirmation Screen
 *
 * This component handles the verification of various email-related actions:
 * - Email verification for new accounts
 * - Password recovery confirmation
 * - Email change confirmation
 *
 * When users click on links in verification emails sent by Supabase, they are
 * directed to this page with either a PKCE authorization code or a token hash
 * and type. This component completes the flow and creates the user session.
 *
 * This is a critical security component that ensures email ownership before
 * completing sensitive account actions.
 */
import type { Route } from "./+types/confirm";

import { data, redirect } from "react-router";
import { z } from "zod";

import makeServerClient from "~/core/lib/supa-client.server";
import { exchangeCrossBrowserCode } from "~/features/auth/lib/auth-link.server";

/**
 * Meta function for the confirmation page
 *
 * Sets the page title using the application name from environment variables
 */
export const meta: Route.MetaFunction = () => {
  return [
    {
      title: `Confirm | ${import.meta.env.VITE_APP_NAME}`,
    },
  ];
};

/**
 * Schema for validating URL parameters in the confirmation link
 *
 * The schema validates three key parameters:
 * - token_hash: The verification token provided by Supabase
 * - type: The type of confirmation (email verification, password recovery, or email change)
 * - next: The URL to redirect to after successful confirmation (defaults to home page)
 */
const nextPathSchema = z
  .string()
  .default("/workspace")
  .refine(
    (path) => path.startsWith("/") && !path.startsWith("//"),
    "Invalid redirect path",
  );

const tokenParamsSchema = z.object({
  token_hash: z.string().min(1),
  type: z.enum([
    "signup",
    "invite",
    "email",
    "magiclink",
    "recovery",
    "email_change",
  ]),
});

/**
 * Loader function for the confirmation page
 *
 * This function processes the verification token and completes the respective action:
 * 1. Validates the token hash, type, and next URL from query parameters
 * 2. Verifies the token with Supabase authentication
 * 3. For email change confirmations, redirects with a success message
 * 4. For other confirmations, redirects to the specified next URL
 *
 * The function handles three types of confirmations:
 * - email: Email verification for new accounts
 * - recovery: Password recovery confirmation
 * - email_change: Email change confirmation
 *
 * @param request - The incoming request with confirmation parameters
 * @returns Redirect to next URL with auth cookies or error response
 */
export async function loader({ request }: Route.LoaderArgs) {
  // Extract query parameters from the URL
  const { searchParams } = new URL(request.url);

  const nextResult = nextPathSchema.safeParse(
    searchParams.get("next") ?? undefined,
  );

  if (!nextResult.success) {
    return data({ error: "Invalid confirmation code" }, { status: 400 });
  }

  const callbackError = searchParams.get("error_description");
  if (callbackError) {
    return data({ error: callbackError }, { status: 400 });
  }

  // Create Supabase client and get response headers for auth cookies
  const [client, headers] = makeServerClient(request);
  headers.set("Cache-Control", "private, no-store");

  // @supabase/ssr uses PKCE by default. Supabase redirects email confirmations
  // back to this route with an authorization code that must be exchanged for a
  // session before redirecting the user into the application.
  const code = searchParams.get("code");
  if (code) {
    const state = searchParams.get("auth_state");
    if (state) {
      const result = await exchangeCrossBrowserCode(code, state);
      if (result.error || !result.session) {
        return data(
          { error: result.error?.message ?? "로그인 세션을 만들 수 없습니다." },
          { status: result.error?.status ?? 400, headers },
        );
      }
      const { error } = await client.auth.setSession(result.session);
      if (error) {
        return data({ error: error.message }, { status: 400, headers });
      }
      return redirect(nextResult.data, { headers });
    }

    const { error } = await client.auth.exchangeCodeForSession(code);

    if (error) {
      const message = /PKCE code verifier/i.test(error.message)
        ? "이 링크는 다른 브라우저에서 요청된 이전 방식의 링크입니다. 아래에서 새 로그인 링크를 받아 주세요."
        : error.message;
      return data({ error: message }, { status: 400, headers });
    }

    return redirect(nextResult.data, { headers });
  }

  // Keep supporting direct token-hash links used by custom email templates.
  const tokenResult = tokenParamsSchema.safeParse(
    Object.fromEntries(searchParams),
  );

  if (!tokenResult.success) {
    return data(
      { error: "Invalid confirmation code" },
      { status: 400, headers },
    );
  }

  // Verify the token with Supabase
  const { error, data: verifyOtpData } = await client.auth.verifyOtp({
    ...tokenResult.data,
  });

  // Return error if verification fails
  if (error) {
    return data({ error: error.message }, { status: 400 });
  }

  // Special handling for email change confirmations
  if (tokenResult.data.type === "email_change") {
    return redirect(
      // @ts-ignore - Supabase returns a message in the user object for email changes
      `${nextResult.data}?message=${encodeURIComponent(verifyOtpData.user.msg ?? "Your email has been updated")}`,
      { headers },
    );
  }

  // Redirect to the next URL with auth cookies in headers
  return redirect(nextResult.data, { headers });
}

/**
 * Email Confirmation Component
 *
 * This component is only rendered if there's an error during the confirmation process.
 * Under normal circumstances, the loader function will redirect the user directly to
 * the next URL after successful confirmation before this component is rendered.
 *
 * If there's an error (e.g., expired token, invalid token, already confirmed),
 * this component displays the error message to inform the user about the failure.
 *
 * @param loaderData - Data from the loader containing any error messages
 */
export default function Confirm({ loaderData }: Route.ComponentProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5">
      {/* Display error heading */}
      <h1 className="text-2xl font-semibold">로그인을 완료하지 못했습니다</h1>
      {/* Display specific error message from Supabase */}
      <p className="text-muted-foreground">{loaderData.error}</p>
      <a
        className="mt-4 rounded-md bg-primary px-4 py-2 text-primary-foreground"
        href="/auth/magic-link"
      >
        새 로그인 링크 받기
      </a>
    </div>
  );
}
