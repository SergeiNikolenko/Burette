import { getAppOrigin } from "@/lib/origin";
import { createViewerWidgetHtml } from "@/lib/widget";

export const runtime = "nodejs";

export function GET(): Response {
  return new Response(createViewerWidgetHtml(getAppOrigin(), {
    fullPage: true,
  }), {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
