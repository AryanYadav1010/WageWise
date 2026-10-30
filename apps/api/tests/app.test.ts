import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { fixtureSnapshot, testConfig } from "./helpers.ts";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function startApp(options: { now?: string; rateLimitPerMinute?: number } = {}) {
  const instant = new Date(options.now ?? "2026-10-28T12:00:00Z");
  const config = testConfig(options.rateLimitPerMinute === undefined ? {} : { RATE_LIMIT_PER_MINUTE: String(options.rateLimitPerMinute) });
  app = await buildApp({ config, holidaySnapshot: fixtureSnapshot, now: () => instant });
  return app;
}

const validBudget = {
  jurisdiction: "england-and-wales",
  paySchedule: { kind: "fixed_day_of_month", dayOfMonth: 28 },
  nonWorkingDayRule: "previous_working_day",
  currentBalancePence: 50_000,
  billsBeforePaydayPence: 15_000,
  essentialsBeforePaydayPence: 10_000
};

describe("health and search", () => {
  it("reports health with the holiday data date", async () => {
    const response = await (await startApp()).inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", bankHolidayDataFetchedAt: fixtureSnapshot.fetchedAt });
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects a too-short search", async () => {
    const response = await (await startApp()).inject({ method: "POST", url: "/api/source-search", payload: { question: "x" } });
    expect(response.statusCode).toBe(400);
  });

  it("returns source links labelled as not a grounded answer", async () => {
    const response = await (await startApp()).inject({ method: "POST", url: "/api/source-search", payload: { question: "What does my tax code mean?" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().isGroundedAnswer).toBe(false);
    expect(response.json().sources[0].url).toMatch(/^https:\/\/www\.gov\.uk\//);
  });
});

describe("POST /api/budget", () => {
  it("computes the next payday with bank holidays and an integer-pence budget", async () => {
    const response = await (await startApp({ now: "2026-12-20T10:00:00Z" })).inject({ method: "POST", url: "/api/budget", payload: validBudget });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.today).toBe("2026-12-20");
    expect(body.payday.effectiveDate).toBe("2026-12-24");
    expect(body.budget).toEqual({ daysUntilPayday: 4, projectedBalancePence: 25_000, shortfallPence: 0, dailyAllowancePence: 6_250 });
    expect(body.bankHolidayData.licence).toMatch(/Open Government Licence/);
  });

  it("derives today from the UK clock, not UTC, during BST", async () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in London.
    const response = await (await startApp({ now: "2026-06-30T23:30:00Z" })).inject({ method: "POST", url: "/api/budget", payload: validBudget });
    expect(response.json().today).toBe("2026-07-01");
  });

  it("uses the selected jurisdiction's holidays", async () => {
    const payload = { ...validBudget, jurisdiction: "scotland", paySchedule: { kind: "fixed_day_of_month", dayOfMonth: 30 } };
    const response = await (await startApp()).inject({ method: "POST", url: "/api/budget", payload: { ...payload, today: "2026-11-20" } });
    expect(response.json().payday.effectiveDate).toBe("2026-11-27");
  });

  it("requires the caller to choose a weekend/holiday rule", async () => {
    const { nonWorkingDayRule: _omitted, ...withoutRule } = validBudget;
    const response = await (await startApp()).inject({ method: "POST", url: "/api/budget", payload: withoutRule });
    expect(response.statusCode).toBe(400);
  });

  it("rejects fractional pence", async () => {
    const response = await (await startApp()).inject({ method: "POST", url: "/api/budget", payload: { ...validBudget, currentBalancePence: 12.3 } });
    expect(response.statusCode).toBe(400);
  });

  it("rejects impossible dates at the validation boundary", async () => {
    const response = await (await startApp()).inject({ method: "POST", url: "/api/budget", payload: { ...validBudget, today: "2026-02-30" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().details.today).toBeDefined();
  });

  it("rejects unknown fields such as caller-supplied holidays", async () => {
    const response = await (await startApp()).inject({ method: "POST", url: "/api/budget", payload: { ...validBudget, bankHolidays: ["2026-12-24"] } });
    expect(response.statusCode).toBe(400);
  });

  it("returns 422 rather than guessing when holiday data does not cover the date", async () => {
    const response = await (await startApp()).inject({ method: "POST", url: "/api/budget", payload: { ...validBudget, today: "2030-01-10" } });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe("HOLIDAY_DATA_UNAVAILABLE");
  });
});

describe("error handling and rate limiting", () => {
  it("returns a safe 400 for malformed JSON without echoing internals", async () => {
    const response = await (await startApp()).inject({
      method: "POST", url: "/api/budget", headers: { "content-type": "application/json" }, payload: "{not json"
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "INVALID_REQUEST", message: "Request could not be processed.", requestId: expect.any(String) });
  });

  it("returns 413 for an oversized body", async () => {
    const response = await (await startApp()).inject({ method: "POST", url: "/api/source-search", payload: { question: "a".repeat(20_000) } });
    expect(response.statusCode).toBe(413);
  });

  it("rate limits with a 429 and a generic message", async () => {
    const limitedApp = await startApp({ rateLimitPerMinute: 2 });
    await limitedApp.inject({ method: "GET", url: "/api/health" });
    await limitedApp.inject({ method: "GET", url: "/api/health" });
    const response = await limitedApp.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(429);
    expect(response.json().error).toBe("RATE_LIMITED");
  });
});

describe("configuration", () => {
  it("names invalid variables without revealing their values", () => {
    expect(() => loadConfig({ PORT: "not-a-port-secret-value" })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: "not-a-port-secret-value" })).not.toThrow(/secret-value/);
  });

  it("sends security headers, and no-store so a browser can't keep a stale answer", async () => {
    const headers = (await (await startApp()).inject({ method: "GET", url: "/api/health" })).headers;
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("reports readiness from the database, without details", async () => {
    const down = await buildApp({ config: testConfig(), holidaySnapshot: fixtureSnapshot, now: () => new Date("2026-10-28T12:00:00Z"), checkDatabase: async () => { throw new Error("password authentication failed"); } });
    const response = await down.inject({ method: "GET", url: "/api/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("password");
    await down.close();
    expect((await (await startApp()).inject({ method: "GET", url: "/api/ready" })).json()).toEqual({ status: "ready", database: "not_configured" });
  });

  it("refuses a non-https web origin in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production", WEB_ORIGIN: "http://example.com" })).toThrow("WEB_ORIGIN");
    expect(loadConfig({ NODE_ENV: "production", WEB_ORIGIN: "https://example.com" }).WEB_ORIGIN).toBe("https://example.com");
  });
});
