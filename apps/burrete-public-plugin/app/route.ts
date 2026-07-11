import { getAppOrigin } from "@/lib/origin";
import { createViewerWidgetHtml } from "@/lib/widget";

export const runtime = "nodejs";

export const DEMO_STRUCTURE_URL = "/demo/1htb.pdb";

export function GET(): Response {
  return new Response(createViewerWidgetHtml(getAppOrigin(), {
    demoStructure: {
      format: "pdb",
      label: "1HTB.pdb",
      url: DEMO_STRUCTURE_URL,
    },
    fullPage: true,
  }), {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
