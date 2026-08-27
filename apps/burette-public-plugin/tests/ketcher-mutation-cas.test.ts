import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const appDirectory = fileURLToPath(new URL("../", import.meta.url));
const redisVariables = [
  "KETCHER_CAS_REDIS_REST_URL",
  "KETCHER_CAS_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
] as const;

describe("hosted Ketcher CAS environment", () => {
  test("accepts the complete Vercel Marketplace Upstash pair", () => {
    expect(runProbe({
      KV_REST_API_URL: "https://marketplace.example",
      KV_REST_API_TOKEN: "marketplace-token",
    })).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        url: "https://marketplace.example",
        authorization: "Bearer marketplace-token",
      }),
    });
  });

  test("prefers the complete explicit Ketcher pair", () => {
    expect(runProbe({
      KETCHER_CAS_REDIS_REST_URL: "https://explicit.example",
      KETCHER_CAS_REDIS_REST_TOKEN: "explicit-token",
      KV_REST_API_URL: "https://marketplace.example",
      KV_REST_API_TOKEN: "marketplace-token",
    })).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        url: "https://explicit.example",
        authorization: "Bearer explicit-token",
      }),
    });
  });

  test.each([
    [
      {
        KETCHER_CAS_REDIS_REST_URL: "https://explicit.example",
        KV_REST_API_URL: "https://marketplace.example",
        KV_REST_API_TOKEN: "marketplace-token",
      },
      "KETCHER_CAS_REDIS_REST_URL and KETCHER_CAS_REDIS_REST_TOKEN must be configured together.",
    ],
    [
      {
        KETCHER_CAS_REDIS_REST_TOKEN: "explicit-token",
        KV_REST_API_URL: "https://marketplace.example",
        KV_REST_API_TOKEN: "marketplace-token",
      },
      "KETCHER_CAS_REDIS_REST_URL and KETCHER_CAS_REDIS_REST_TOKEN must be configured together.",
    ],
    [
      { KV_REST_API_URL: "https://marketplace.example" },
      "KV_REST_API_URL and KV_REST_API_TOKEN must be configured together.",
    ],
    [
      { KV_REST_API_TOKEN: "marketplace-token" },
      "KV_REST_API_URL and KV_REST_API_TOKEN must be configured together.",
    ],
  ] as const)("rejects partial pairs without mixing credentials", (environment, message) => {
    const result = runProbe(environment);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(message);
  });

  test("does not fall back to process-local state in production", () => {
    const result = runProbe({});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "A complete KETCHER_CAS_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN pair is required",
    );
  });
});

function runProbe(overrides: Partial<Record<(typeof redisVariables)[number], string>>) {
  const environment: Record<string, string | undefined> = {
    ...process.env,
    NODE_ENV: "production",
  };
  for (const variable of redisVariables) delete environment[variable];
  Object.assign(environment, overrides);

  const subprocess = Bun.spawnSync({
    cmd: [process.execPath, "--eval", probeScript],
    cwd: appDirectory,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: subprocess.exitCode,
    stdout: subprocess.stdout.toString().trim(),
    stderr: subprocess.stderr.toString().trim(),
  };
}

const probeScript = `
globalThis.fetch = async (input, init) => {
  console.log(JSON.stringify({
    url: String(input),
    authorization: new Headers(init?.headers).get("authorization"),
  }));
  return Response.json({ result: null });
};
try {
  const { configuredKetcherMutationCas } = await import("./lib/ketcher-mutation-cas.ts");
  await configuredKetcherMutationCas().read("environment-probe");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
`;
