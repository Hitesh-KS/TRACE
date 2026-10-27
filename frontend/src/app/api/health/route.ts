export async function GET() {
  const apiUrl = process.env.TRACE_API_URL;
  if (!apiUrl) {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }

  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/healthz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) {
      return Response.json({ status: "unavailable" }, { status: 503 });
    }
    return Response.json({ status: "connected" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
