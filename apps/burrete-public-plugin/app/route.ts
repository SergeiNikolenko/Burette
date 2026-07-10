export const runtime = "nodejs";

export const PLUGIN_DOCUMENTATION_URL =
  "https://burrete-landing.vercel.app/docs/plugin";

export function GET(): Response {
  return Response.redirect(PLUGIN_DOCUMENTATION_URL, 308);
}
