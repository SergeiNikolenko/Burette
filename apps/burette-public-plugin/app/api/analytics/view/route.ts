import { getAppOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

const WIDGET_ANALYTICS_PATH = "/mcp/widget";
const ANALYTICS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
} as const;

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: ANALYTICS_HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  const appOrigin = getAppOrigin();
  const upstreamUrl = new URL("/_vercel/insights/view", appOrigin);
  const userAgent = request.headers.get("user-agent")?.slice(0, 512);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(userAgent ? { "User-Agent": userAgent } : {}),
      },
      body: JSON.stringify({
        o: `${appOrigin}${WIDGET_ANALYTICS_PATH}`,
        sv: "0.1.3",
        sdkn: "@vercel/analytics",
        sdkv: "2.0.1",
        ts: Date.now(),
        dp: WIDGET_ANALYTICS_PATH,
      }),
    });
    return new Response(upstream.ok ? "OK" : "Analytics unavailable", {
      status: upstream.ok ? 200 : 502,
      headers: ANALYTICS_HEADERS,
    });
  } catch {
    return new Response("Analytics unavailable", {
      status: 502,
      headers: ANALYTICS_HEADERS,
    });
  }
}
