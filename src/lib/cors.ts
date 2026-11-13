import { NextResponse } from "next/server";

export const EXTENSION_API_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function corsOptionsResponse(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: EXTENSION_API_CORS_HEADERS,
  });
}

export function corsJson(
  payload: unknown,
  init?: { status?: number }
): NextResponse {
  return NextResponse.json(payload, {
    status: init?.status ?? 200,
    headers: EXTENSION_API_CORS_HEADERS,
  });
}
