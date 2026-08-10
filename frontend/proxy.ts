import { clerkMiddleware } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  guestRegex,
  isDevelopmentEnvironment,
  isLocalAuthBypassed,
} from "./lib/constants";

const clerkEnabled = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY
);

async function handleRequest(request: NextRequest, clerkUserId: string | null) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (isLocalAuthBypassed) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const isAuthPage = ["/login", "/register", "/sso-callback"].includes(
    pathname
  );

  if (clerkUserId) {
    if (isAuthPage) {
      return NextResponse.redirect(new URL(`${base}/`, request.url));
    }
    return NextResponse.next();
  }

  // Clerk callback and custom auth pages must remain reachable before a
  // Clerk session exists. They retain the existing Medix route structure.
  if (clerkEnabled && isAuthPage) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  if (!token) {
    const redirectUrl = encodeURIComponent(new URL(request.url).pathname);
    return NextResponse.redirect(
      new URL(`${base}/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
    );
  }

  const isGuest = guestRegex.test(token.email ?? "");

  if (clerkEnabled && !isGuest) {
    return NextResponse.redirect(new URL(`${base}/login`, request.url));
  }

  if (!clerkEnabled && !isGuest && ["/login", "/register"].includes(pathname)) {
    return NextResponse.redirect(new URL(`${base}/`, request.url));
  }

  return NextResponse.next();
}

const clerkProxy = clerkMiddleware(async (auth, request) => {
  const { userId } = await auth();
  return handleRequest(request, userId);
});

export default clerkEnabled
  ? clerkProxy
  : (request: NextRequest) => handleRequest(request, null);

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",
    "/register",
    "/sso-callback",
    "/__clerk/:path*",
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
