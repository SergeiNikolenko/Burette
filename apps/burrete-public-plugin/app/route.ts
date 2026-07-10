import { preparePdbStructure } from "@/lib/structure-service";
import { createStandaloneViewerHtml } from "@/lib/widget";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const revalidate = 86_400;
export const maxDuration = 30;

const VIEWER_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
  "Content-Security-Policy": [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'none'",
    "worker-src blob:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; "),
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export async function GET(): Promise<Response> {
  try {
    const prepared = await preparePdbStructure("1CRN");
    return new Response(
      createStandaloneViewerHtml(
        {
          structuredContent: prepared.summary,
          _meta: { structure: prepared.viewer },
        },
        "",
      ),
      { status: 200, headers: VIEWER_HEADERS },
    );
  } catch {
    return new Response(
      "Burrete Molecular Viewer could not load the example structure.",
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
}
