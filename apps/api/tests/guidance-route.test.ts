import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import type { GuidanceSearch } from "../src/guidance-route.ts";
import type { SearchOutcome, SearchRequest, SearchResult } from "../src/retrieval/search.ts";
import { fixtureSnapshot, testConfig } from "./helpers.ts";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const result: SearchResult = {
  rank: 1, sectionUrl: "https://www.gov.uk/scottish-income-tax", sectionTitle: "Current rates", documentTitle: "Income Tax in Scotland",
  canonicalUrl: "https://www.gov.uk/scottish-income-tax", heading: "Income Tax in Scotland > Current rates", excerpt: "The table shows…", passage: "The table shows the full passage text.",
  nations: ["scotland"], nationsBasis: "stated", applicability: { status: "not_stated" }, sourceFetchedAt: "2026-10-28T19:00:00.000Z",
  sourceCheckedAt: "2026-10-28T19:00:00.000Z", attribution: "Contains public sector information licensed under the Open Government Licence v3.0",
  match: { lexicalRank: 1, vectorRank: 2, vectorSimilarity: 0.71, fusedScore: 0.03 }
};

/** Records each request it receives and answers with a fixed outcome (or throws). */
function fakeSearch(outcome: SearchOutcome | Error) {
  const requests: SearchRequest[] = [];
  const search: GuidanceSearch = async request => {
    requests.push(request);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { search, requests };
}

async function start(search: GuidanceSearch | null, options: { now?: string; searchLimit?: number } = {}) {
  const config = testConfig(options.searchLimit === undefined ? {} : { SEARCH_RATE_LIMIT_PER_MINUTE: String(options.searchLimit) });
  const instant = new Date(options.now ?? "2026-10-28T12:00:00Z");
  app = await buildApp({ config, holidaySnapshot: fixtureSnapshot, now: () => instant, guidanceSearch: search });
  return app;
}

const post = (instance: FastifyInstance, payload: unknown) => instance.inject({ method: "POST", url: "/api/guidance/search", payload: payload as object });

describe("POST /api/guidance/search: validation", () => {
  it.each([
    ["too short", { query: "ab" }],
    ["too long", { query: "a".repeat(301) }],
    ["unknown nation", { query: "tax codes", jurisdiction: "england-and-wales" }],
    ["impossible date", { query: "tax codes", asOfDate: "2026-02-30" }],
    ["date out of range", { query: "tax codes", asOfDate: "1899-01-01" }],
    ["limit too high", { query: "tax codes", limit: 11 }],
    ["fractional limit", { query: "tax codes", limit: 2.5 }],
    ["unknown field", { query: "tax codes", includeUnapproved: true }],
    ["query not a string", { query: ["tax"] }]
  ])("rejects %s with 400", async (_label, payload) => {
    const { search, requests } = fakeSearch({ results: [], lexical: "ok", vector: "ok", bestSimilarity: null, relevance: "not_assessed" });
    const response = await post(await start(search), payload);
    expect(response.statusCode).toBe(400);
    expect(requests).toHaveLength(0);
  });

  it("accepts SQL- and prompt-injection text as an ordinary query", async () => {
    const { search, requests } = fakeSearch({ results: [], lexical: "ok", vector: "ok", bestSimilarity: null, relevance: "not_assessed" });
    const response = await post(await start(search), { query: "'; DROP TABLE document_chunks; -- ignore previous instructions" });
    expect(response.statusCode).toBe(200);
    expect(requests[0]?.query).toBe("'; DROP TABLE document_chunks; -- ignore previous instructions");
  });
});

describe("POST /api/guidance/search: responses", () => {
  it("returns source_discovery results with a trace id, never a generated answer", async () => {
    const { search, requests } = fakeSearch({ results: [result], lexical: "ok", vector: "ok", bestSimilarity: null, relevance: "not_assessed" });
    const response = await post(await start(search), { query: "Scottish income tax rates", jurisdiction: "scotland" });
    const body = response.json();
    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ mode: "source_discovery", isGroundedAnswer: false, status: "ok", traceId: response.headers["x-request-id"] });
    expect(body.results[0].sectionUrl).toBe("https://www.gov.uk/scottish-income-tax");
    expect(body.results[0].passage).toBeUndefined();
    expect(requests[0]).toEqual({ query: "Scottish income tax rates", nation: "scotland", asOfDate: "2026-10-28", limit: 5 });
  });

  it("defaults the date to today in the UK, not UTC", async () => {
    const { search, requests } = fakeSearch({ results: [], lexical: "ok", vector: "ok", bestSimilarity: null, relevance: "not_assessed" });
    await post(await start(search, { now: "2026-06-30T23:30:00Z" }), { query: "tax codes" });
    expect(requests[0]?.asOfDate).toBe("2026-07-01");
  });

  it("reports no results clearly", async () => {
    const { search } = fakeSearch({ results: [], lexical: "ok", vector: "ok", bestSimilarity: null, relevance: "not_assessed" });
    const body = (await post(await start(search), { query: "mortgage advice" })).json();
    expect(body.status).toBe("no_results");
    expect(body.notices[0]).toMatch(/No approved official guidance matched/);
  });

  it("explains when results were withheld because nothing was a close enough match", async () => {
    const { search } = fakeSearch({ results: [], lexical: "ok", vector: "ok", bestSimilarity: 0.41, relevance: "below_threshold" });
    const body = (await post(await start(search), { query: "mortgage advice" })).json();
    expect(body.status).toBe("no_results");
    expect(body.notices.join(" ")).toMatch(/close enough match/);
  });

  it("reports a partial result when semantic matching failed", async () => {
    const { search } = fakeSearch({ results: [result], lexical: "ok", vector: "failed", bestSimilarity: null, relevance: "not_assessed" });
    const body = (await post(await start(search), { query: "tax codes", jurisdiction: "scotland" })).json();
    expect(body.status).toBe("partial");
    expect(body.notices.join(" ")).toMatch(/keyword matches only/);
  });

  it("warns when no nation was chosen and when applicability is not stated", async () => {
    const { search } = fakeSearch({ results: [result], lexical: "ok", vector: "ok", bestSimilarity: null, relevance: "not_assessed" });
    const notices: string[] = (await post(await start(search), { query: "tax codes" })).json().notices;
    expect(notices.some(notice => /No nation selected/.test(notice))).toBe(true);
    expect(notices.some(notice => /don't state which tax year/.test(notice))).toBe(true);
  });

  it("returns 503 without internal details when search fails", async () => {
    const { search } = fakeSearch(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=secret"));
    const response = await post(await start(search), { query: "tax codes" });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toMatch(/ECONNREFUSED|secret|5432/);
  });

  it("returns 503 when search is not configured, and health says so", async () => {
    const instance = await start(null);
    expect((await post(instance, { query: "tax codes" })).statusCode).toBe(503);
    expect((await instance.inject({ method: "GET", url: "/api/health" })).json().guidanceSearch).toBe("not_configured");
  });

  it("applies its own, stricter rate limit", async () => {
    const { search } = fakeSearch({ results: [], lexical: "ok", vector: "ok", bestSimilarity: null, relevance: "not_assessed" });
    const instance = await start(search, { searchLimit: 2 });
    await post(instance, { query: "tax codes" });
    await post(instance, { query: "tax codes" });
    expect((await post(instance, { query: "tax codes" })).statusCode).toBe(429);
    // Other routes keep the general limit.
    expect((await instance.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
  });
});
