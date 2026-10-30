import { describe, expect, it } from "vitest";
import { fetchGovukDocument, type FetchOutcome } from "../src/ingest/govuk-client.ts";
import { fixtureBody } from "./govuk-fixtures.ts";

type FakeResponse = { status: number; body?: string; headers?: Record<string, string> } | "timeout" | "network";

/** A fetch that plays back scripted responses and records each delay the client asks for. */
function scripted(responses: FakeResponse[]) {
  const requests: string[] = [];
  const sleeps: number[] = [];
  const fetchImpl: typeof fetch = async input => {
    requests.push(String(input));
    const next = responses[requests.length - 1] ?? responses[responses.length - 1];
    if (next === undefined) throw new Error("No scripted response");
    if (next === "timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    if (next === "network") throw new TypeError("fetch failed");
    return new Response(next.body ?? "", { status: next.status, headers: next.headers ?? {} });
  };
  const sleep = async (ms: number) => { sleeps.push(ms); };
  return { fetchImpl, sleep, requests, sleeps };
}

async function fetchWith(responses: FakeResponse[], path = "/welsh-income-tax") {
  const fake = scripted(responses);
  const outcome = await fetchGovukDocument(path, { fetchImpl: fake.fetchImpl, sleep: fake.sleep, baseDelayMs: 100 });
  return { outcome, ...fake };
}

const ok = { status: 200, body: fixtureBody("welsh-income-tax") };

describe("successful fetches", () => {
  it("parses a 200 response and hashes the raw body", async () => {
    const { outcome, requests } = await fetchWith([ok]);
    expect(outcome.kind).toBe("ok");
    expect(outcome.attempts).toBe(1);
    expect(requests).toEqual(["https://www.gov.uk/api/content/welsh-income-tax"]);
    if (outcome.kind === "ok") expect(outcome.rawSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects unsafe paths before making a request", async () => {
    await expect(fetchGovukDocument("/../admin")).rejects.toThrow(RangeError);
    await expect(fetchGovukDocument("https://evil.example/x")).rejects.toThrow(RangeError);
  });
});

describe("retries", () => {
  it("retries a 503 with exponential backoff, then succeeds", async () => {
    const { outcome, sleeps } = await fetchWith([{ status: 503 }, { status: 502 }, ok]);
    expect(outcome.kind).toBe("ok");
    expect(outcome.attempts).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("honours Retry-After on 429, capped", async () => {
    const { outcome, sleeps } = await fetchWith([{ status: 429, headers: { "retry-after": "2" } }, ok]);
    expect(outcome.kind).toBe("ok");
    expect(sleeps).toEqual([2_000]);
    const capped = await fetchWith([{ status: 429, headers: { "retry-after": "3600" } }, ok]);
    expect(capped.sleeps).toEqual([30_000]);
  });

  it("reports repeated timeouts as a failed check, never as withdrawn or removed", async () => {
    const { outcome, requests } = await fetchWith(["timeout"]);
    expect(requests).toHaveLength(3);
    expect(outcome).toMatchObject<Partial<FetchOutcome>>({ kind: "failed", attempts: 3 });
    if (outcome.kind === "failed") expect(outcome.reason).toBe("timeout");
  });

  it("reports network errors as failed after retrying", async () => {
    const { outcome } = await fetchWith(["network", "network", "network"]);
    expect(outcome).toMatchObject({ kind: "failed", reason: "network_error", attempts: 3 });
  });

  it("reports persistent 5xx as server_error", async () => {
    const { outcome } = await fetchWith([{ status: 500 }]);
    expect(outcome).toMatchObject({ kind: "failed", reason: "server_error", httpStatus: 500, attempts: 3 });
  });
});

describe("final answers are not retried", () => {
  it("treats 404 and 410 as removed", async () => {
    for (const status of [404, 410]) {
      const { outcome, requests } = await fetchWith([{ status }]);
      expect(outcome).toEqual({ kind: "removed", httpStatus: status, attempts: 1 });
      expect(requests).toHaveLength(1);
    }
  });

  it("reports an HTTP redirect with its destination and does not follow it", async () => {
    const { outcome, requests } = await fetchWith([{ status: 303, headers: { location: "https://www.gov.uk/api/content/tax-codes" } }]);
    expect(outcome).toEqual({ kind: "redirected", destination: "https://www.gov.uk/api/content/tax-codes", httpStatus: 303, attempts: 1 });
    expect(requests).toHaveLength(1);
  });

  it("reports a redirect content item as redirected", async () => {
    const { outcome } = await fetchWith([{ status: 200, body: fixtureBody("redundant-your-rights") }], "/redundant-your-rights");
    expect(outcome).toEqual({ kind: "redirected", destination: "/redundancy-your-rights", httpStatus: 200, attempts: 1 });
  });

  it("reports a withdrawn page as withdrawn", async () => {
    const withdrawn = JSON.stringify({ ...JSON.parse(fixtureBody("welsh-income-tax")), withdrawn_notice: { explanation: "Replaced", withdrawn_at: "2026-01-01T00:00:00Z" } });
    const { outcome } = await fetchWith([{ status: 200, body: withdrawn }]);
    expect(outcome).toEqual({ kind: "withdrawn", withdrawnAt: "2026-01-01T00:00:00Z", attempts: 1 });
  });

  it("reports malformed JSON and unexpected shapes as failed, with a reason", async () => {
    expect((await fetchWith([{ status: 200, body: "<html>maintenance</html>" }])).outcome)
      .toMatchObject({ kind: "failed", reason: "malformed_json", attempts: 1 });
    expect((await fetchWith([{ status: 200, body: JSON.stringify({ unexpected: true }) }])).outcome)
      .toMatchObject({ kind: "failed", reason: "invalid_schema", attempts: 1 });
    expect((await fetchWith([{ status: 200, body: fixtureBody("plan-for-retirement") }], "/plan-for-retirement")).outcome)
      .toMatchObject({ kind: "failed", reason: "unsupported_format" });
  });

  it("reports other 4xx statuses as unexpected_status", async () => {
    expect((await fetchWith([{ status: 403 }])).outcome).toMatchObject({ kind: "failed", reason: "unexpected_status", httpStatus: 403, attempts: 1 });
  });
});
