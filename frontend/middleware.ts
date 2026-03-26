import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const token = request.cookies.get("token");
  const role = request.cookies.get("role");

  const url = request.nextUrl;

  // Agar login nahi hai
  if (!token && url.pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Agar client admin page khol raha hai
  if (url.pathname.startsWith("/dashboard/admin") && role?.value !== "admin") {
    return NextResponse.redirect(new URL("/dashboard/client", request.url));
  }

  return NextResponse.next();
}