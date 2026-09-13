type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type KetcherMutationClaim = {
  claimId: string;
  status: "pending" | "completed";
  continuationToken?: string;
};

export interface KetcherMutationCas {
  claim(key: string, claimId: string, ttlMs: number): Promise<
    | { status: "claimed" }
    | { status: "exists"; value: KetcherMutationClaim }
  >;
  complete(key: string, claimId: string, continuationToken: string, ttlMs: number): Promise<boolean>;
  read(key: string): Promise<KetcherMutationClaim | null>;
}

type RedisRestOptions = {
  url: string;
  token: string;
  fetcher?: Fetcher;
};

const COMPLETE_CLAIM_SCRIPT = [
  "local current = redis.call('GET', KEYS[1])",
  "if current ~= ARGV[1] then return 0 end",
  "redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])",
  "return 1",
].join("\n");

export class KetcherMutationCasConfigurationError extends Error {
  constructor(message = "A complete KETCHER_CAS_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN pair is required for hosted Ketcher mutations.") {
    super(message);
    this.name = "KetcherMutationCasConfigurationError";
  }
}

export class RedisRestKetcherMutationCas implements KetcherMutationCas {
  private readonly url: string;
  private readonly token: string;
  private readonly fetcher: Fetcher;

  constructor(options: RedisRestOptions) {
    const url = validatedRedisUrl(options.url);
    const token = options.token.trim();
    if (!token) throw new KetcherMutationCasConfigurationError();
    this.url = url;
    this.token = token;
    this.fetcher = options.fetcher ?? fetch;
  }

  async claim(key: string, claimId: string, ttlMs: number) {
    const pending = serializeClaim({ claimId, status: "pending" });
    const claimed = await this.command(["SET", redisKey(key), pending, "NX", "PX", String(ttlMs)]);
    if (claimed === "OK") return { status: "claimed" as const };
    const existing = await this.read(key);
    if (!existing) {
      throw new Error("Hosted Ketcher CAS lost the mutation claim.");
    }
    return { status: "exists" as const, value: existing };
  }

  async complete(key: string, claimId: string, continuationToken: string, ttlMs: number) {
    const pending = serializeClaim({ claimId, status: "pending" });
    const completed = serializeClaim({ claimId, status: "completed", continuationToken });
    const result = await this.command([
      "EVAL",
      COMPLETE_CLAIM_SCRIPT,
      "1",
      redisKey(key),
      pending,
      completed,
      String(ttlMs),
    ]);
    return result === 1;
  }

  async read(key: string) {
    const value = await this.command(["GET", redisKey(key)]);
    return value === null ? null : parseClaim(value);
  }

  private async command(command: string[]): Promise<unknown> {
    const response = await this.fetcher(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`Hosted Ketcher CAS request failed with HTTP ${response.status}.`);
    }
    const body = await response.json() as { result?: unknown; error?: unknown };
    if (typeof body.error === "string" && body.error) {
      throw new Error("Hosted Ketcher CAS rejected the Redis command.");
    }
    if (!Object.hasOwn(body, "result")) {
      throw new Error("Hosted Ketcher CAS returned an invalid response.");
    }
    return body.result;
  }
}

class TestMemoryKetcherMutationCas implements KetcherMutationCas {
  private readonly values = new Map<string, { value: KetcherMutationClaim; expiresAt: number }>();

  async claim(key: string, claimId: string, ttlMs: number) {
    const existing = this.current(key);
    if (existing) return { status: "exists" as const, value: existing };
    this.values.set(key, {
      value: { claimId, status: "pending" },
      expiresAt: Date.now() + ttlMs,
    });
    return { status: "claimed" as const };
  }

  async complete(key: string, claimId: string, continuationToken: string, ttlMs: number) {
    const current = this.current(key);
    if (!current || current.status !== "pending" || current.claimId !== claimId) return false;
    this.values.set(key, {
      value: { claimId, status: "completed", continuationToken },
      expiresAt: Date.now() + ttlMs,
    });
    return true;
  }

  async read(key: string) {
    return this.current(key);
  }

  private current(key: string) {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }
}

let configuredAdapter: KetcherMutationCas | null = null;

export function configuredKetcherMutationCas(): KetcherMutationCas {
  if (configuredAdapter) return configuredAdapter;
  const redis = configuredRedisRestOptions();
  if (redis) {
    configuredAdapter = new RedisRestKetcherMutationCas(redis);
    return configuredAdapter;
  }
  if (process.env.NODE_ENV === "test") {
    configuredAdapter = new TestMemoryKetcherMutationCas();
    return configuredAdapter;
  }
  throw new KetcherMutationCasConfigurationError();
}

function configuredRedisRestOptions(): RedisRestOptions | null {
  const explicit = {
    url: process.env.KETCHER_CAS_REDIS_REST_URL?.trim() ?? "",
    token: process.env.KETCHER_CAS_REDIS_REST_TOKEN?.trim() ?? "",
  };
  if (explicit.url || explicit.token) {
    if (!explicit.url || !explicit.token) {
      throw new KetcherMutationCasConfigurationError(
        "KETCHER_CAS_REDIS_REST_URL and KETCHER_CAS_REDIS_REST_TOKEN must be configured together.",
      );
    }
    return explicit;
  }

  const marketplace = {
    url: process.env.KV_REST_API_URL?.trim() ?? "",
    token: process.env.KV_REST_API_TOKEN?.trim() ?? "",
  };
  if (marketplace.url || marketplace.token) {
    if (!marketplace.url || !marketplace.token) {
      throw new KetcherMutationCasConfigurationError(
        "KV_REST_API_URL and KV_REST_API_TOKEN must be configured together.",
      );
    }
    return marketplace;
  }

  return null;
}

function validatedRedisUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
    return url.toString().replace(/\/$/u, "");
  } catch {
    throw new KetcherMutationCasConfigurationError("Hosted Ketcher CAS requires a valid HTTPS Redis REST endpoint.");
  }
}

function redisKey(key: string) {
  return `burette:ketcher:mutation:${key}`;
}

function serializeClaim(value: KetcherMutationClaim) {
  return JSON.stringify({ v: 1, ...value });
}

function parseClaim(value: unknown): KetcherMutationClaim {
  if (typeof value !== "string" || value.length > 160 * 1024) {
    throw new Error("Hosted Ketcher CAS returned an invalid mutation claim.");
  }
  const parsed = JSON.parse(value) as Record<string, unknown>;
  if (
    parsed.v !== 1
    || typeof parsed.claimId !== "string"
    || !["pending", "completed"].includes(String(parsed.status))
    || (parsed.status === "completed" && typeof parsed.continuationToken !== "string")
  ) {
    throw new Error("Hosted Ketcher CAS returned an invalid mutation claim.");
  }
  return {
    claimId: parsed.claimId,
    status: parsed.status as KetcherMutationClaim["status"],
    ...(typeof parsed.continuationToken === "string" ? { continuationToken: parsed.continuationToken } : {}),
  };
}
