import { NextRequest, NextResponse } from "next/server";
import {
  GUARD_COOKIE_NAME,
  GUARD_TOKEN_TTL_SEC,
  signGuardToken,
  verifyGuardToken,
} from "@/lib/guard-token";

export const config = {
  matcher: [
    "/",
    "/buildcheck",
    "/wallet-detox",
    "/dev-lineage",
    "/wallets",
    "/watchdog",
    "/autopsy",
    "/agent-firewall",
    "/report/:path*",
    "/privacy",
  ],
};

/**
 * Mints a signed HttpOnly session cookie when a user loads any SolShield web
 * page so subsequent API requests from the browser UI can be verified cleanly
 * while blocking anonymous script scraping on backend endpoints.
 */
export async function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const userAgent = req.headers.get("user-agent");
  const existing = req.cookies.get(GUARD_COOKIE_NAME)?.value;
  const isValid = await verifyGuardToken(existing, undefined, userAgent);

  if (!isValid) {
    const freshToken = await signGuardToken(undefined, userAgent);
    const isHttps =
      req.headers.get("x-forwarded-proto") === "https" ||
      req.nextUrl.protocol === "https:";

    res.cookies.set(GUARD_COOKIE_NAME, freshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps,
      path: "/",
      maxAge: GUARD_TOKEN_TTL_SEC,
    });
  }

  return res;
}
