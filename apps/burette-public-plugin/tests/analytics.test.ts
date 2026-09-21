import { afterEach, describe, expect, test } from "bun:test";
import { OPTIONS, POST } from "../app/api/analytics/view/route";

const originalFetch = globalThis.fetch;
type FetchImplementation = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => ReturnType<typeof fetch>;

function stubFetch(implementation: FetchImplementation): void {
  globalThis.fetch = Object.assign(implementation, { preconnect: originalFetch.preconnect });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("hosted widget analytics", () => {
  test("allows the sandbox to post a pageview without credentials", () => {
    const response = OPTIONS();
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
  });

  test("forwards only a canonical widget pageview", async () => {
    let forwardedUrl = "";
    let forwardedBody = "";
    stubFetch(async (input, init) => {
      forwardedUrl = String(input);
      forwardedBody = String(init?.body ?? "");
      return new Response("OK", { status: 200 });
    });

    const response = await POST(new Request("https://burette.example/api/analytics/view", {
      method: "POST",
      headers: { "User-Agent": "Burette analytics contract test" },
      body: JSON.stringify({
        pdbId: "1CRN",
        fileName: "private.pdb",
        chatSessionId: "private-session",
      }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(forwardedUrl).toBe("http://localhost:3000/_vercel/insights/view");
    expect(JSON.parse(forwardedBody)).toMatchObject({
      o: "http://localhost:3000/mcp/widget",
      sdkn: "@vercel/analytics",
      sdkv: "2.0.1",
      dp: "/mcp/widget",
    });
    expect(forwardedBody).not.toContain("1CRN");
    expect(forwardedBody).not.toContain("private.pdb");
    expect(forwardedBody).not.toContain("private-session");
  });

  test("reports an unavailable analytics upstream without throwing", async () => {
    stubFetch(async () => new Response("Unavailable", { status: 503 }));
    const response = await POST(new Request("https://burette.example/api/analytics/view", {
      method: "POST",
    }));
    expect(response.status).toBe(502);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
