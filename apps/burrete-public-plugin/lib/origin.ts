const LOCAL_ORIGIN = "http://localhost:3000";

function normalizeOrigin(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    const isLocalHttp =
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
    if (url.protocol !== "https:" && !isLocalHttp) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getAppOrigin(): string {
  const configuredValue = process.env.PUBLIC_APP_ORIGIN;
  const configured = normalizeOrigin(configuredValue);
  if (configured) return configured;
  if (configuredValue?.trim()) {
    throw new Error("PUBLIC_APP_ORIGIN must be an HTTPS origin or local HTTP origin.");
  }

  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) return `https://${productionHost}`;

  const deploymentHost =
    process.env.VERCEL_BRANCH_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (deploymentHost) return `https://${deploymentHost}`;

  return LOCAL_ORIGIN;
}
