import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const hostedShellCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self' data: blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

const webDemoCsp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self' data: blob:",
  "frame-ancestors 'self' https://burette-landing.vercel.app http://127.0.0.1:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

const crossOriginAssetHeaders = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(appDirectory, "../.."),
  async headers() {
    return [
      {
        source: "/viewer-shell/index.html",
        headers: [{ key: "Content-Security-Policy", value: hostedShellCsp }],
      },
      {
        source: "/web-demo/index.html",
        headers: [{ key: "Content-Security-Policy", value: webDemoCsp }],
      },
      {
        source: "/viewer-shell/:path*",
        headers: crossOriginAssetHeaders,
      },
      {
        source: "/burette-viewer/:path*",
        headers: crossOriginAssetHeaders,
      },
    ];
  },
};

export default nextConfig;
