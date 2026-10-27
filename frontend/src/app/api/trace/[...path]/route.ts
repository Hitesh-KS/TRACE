import type { NextRequest } from "next/server";

const API_URL = (process.env.TRACE_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const API_TOKEN = process.env.TRACE_API_TOKEN ?? "";
const ROLE_TOKENS: Record<string, string> = {
  investigator: API_TOKEN,
  analyst: process.env.TRACE_ANALYST_TOKEN ?? "",
  judge: process.env.TRACE_JUDGE_TOKEN ?? "",
  admin: process.env.TRACE_ADMIN_TOKEN ?? "",
};

type RouteParams = { params: Promise<{ path: string[] }> };

const forwardedRequestHeaders = [
  "accept",
  "content-type",
  "range",
  "if-none-match",
  "if-modified-since",
];

const forwardedResponseHeaders = [
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
  "x-report-sha256",
];

async function proxy(request: NextRequest, { params }: RouteParams) {
  const { path } = await params;
  const role = path[0]?.toLowerCase() ?? "";
  const isRolePath = role in ROLE_TOKENS;
  const roleToken = isRolePath ? ROLE_TOKENS[role] : API_TOKEN;
  const apiPath = isRolePath ? path.slice(1) : path;

  if (!roleToken) {
    return Response.json(
      { detail: `The development token for the ${role} workspace is not configured.` },
      { status: 503 },
    );
  }

  const target = new URL(apiPath.map(encodeURIComponent).join("/"), `${API_URL}/`);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of forwardedRequestHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("authorization", `Bearer ${roleToken}`);

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    body: hasBody ? request.body : undefined,
    cache: "no-store",
    redirect: "manual",
  };
  if (hasBody && request.body) {
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return Response.json({ detail: "TRACE API is unreachable." }, { status: 502 });
  }

  const responseHeaders = new Headers();
  for (const name of forwardedResponseHeaders) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }

  const body = upstream.status === 204 || upstream.status === 304 ? null : upstream.body;
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export function GET(request: NextRequest, context: RouteParams) {
  return proxy(request, context);
}

export function HEAD(request: NextRequest, context: RouteParams) {
  return proxy(request, context);
}

export function POST(request: NextRequest, context: RouteParams) {
  return proxy(request, context);
}

export function PUT(request: NextRequest, context: RouteParams) {
  return proxy(request, context);
}

export function PATCH(request: NextRequest, context: RouteParams) {
  return proxy(request, context);
}

export function DELETE(request: NextRequest, context: RouteParams) {
  return proxy(request, context);
}
