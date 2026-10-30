import { GOVUK_ORIGIN, GovukContentError, isSafeGovukPath, parseGovukContent, sha256, type ContentErrorCode, type ParsedDocument } from "./govuk.ts";

export type FailureReason =
  | "timeout"
  | "network_error"
  | "rate_limited"
  | "server_error"
  | "unexpected_status"
  | "malformed_json"
  | ContentErrorCode;

// Only definitive upstream signals (a withdrawal notice, a redirect, a 404/410) change what we
// believe about a page. Every other problem is a "failed" check, which says nothing about the
// page itself: the stored version stays active and retrievable.
export type FetchOutcome =
  | { kind: "ok"; document: ParsedDocument; rawSha256: string; attempts: number }
  | { kind: "withdrawn"; withdrawnAt: string | null; attempts: number }
  | { kind: "redirected"; destination: string | null; httpStatus: number; attempts: number }
  | { kind: "removed"; httpStatus: 404 | 410; attempts: number }
  | { kind: "failed"; reason: FailureReason; message: string; httpStatus: number | null; attempts: number };

export type GovukClientOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxRetryAfterMs?: number;
};

type AttemptResult =
  | { kind: "response"; status: number; location: string | null; retryAfter: string | null; body: string }
  | { kind: "timeout" }
  | { kind: "network_error"; message: string };

const USER_AGENT = "WageWiseUK-portfolio/0.2 (educational project; sequential, low-volume requests)";

export const realSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function attemptFetch(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<AttemptResult> {
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      // The timeout covers reading the body as well as the headers.
      signal: AbortSignal.timeout(timeoutMs),
      // Never follow redirects automatically: a human should update the corpus instead.
      redirect: "manual"
    });
    const body = await response.text();
    return {
      kind: "response",
      status: response.status,
      location: response.headers.get("location"),
      retryAfter: response.headers.get("retry-after"),
      body
    };
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { kind: "timeout" };
    }
    return { kind: "network_error", message: error instanceof Error ? error.message : "Unknown network error" };
  }
}

/** Retry-After in seconds, capped. Returns null if absent or not a number of seconds. */
function retryAfterMs(header: string | null, maxMs: number): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  return Math.min(Number(header.trim()) * 1000, maxMs);
}

function interpretBody(path: string, body: string, attempts: number): FetchOutcome {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { kind: "failed", reason: "malformed_json", message: "Response body was not valid JSON", httpStatus: 200, attempts };
  }
  try {
    const parsed = parseGovukContent(json, path);
    if (parsed.kind === "withdrawn") return { kind: "withdrawn", withdrawnAt: parsed.withdrawnAt, attempts };
    if (parsed.kind === "redirect_item") return { kind: "redirected", destination: parsed.destination, httpStatus: 200, attempts };
    return { kind: "ok", document: parsed.document, rawSha256: sha256(body), attempts };
  } catch (error) {
    if (error instanceof GovukContentError) {
      return { kind: "failed", reason: error.code, message: error.message, httpStatus: 200, attempts };
    }
    throw error;
  }
}

/**
 * Fetches one page from the GOV.UK Content API. Timeouts, network errors, 429 and 5xx
 * are retried with exponential backoff; everything else is final on the first attempt.
 * Never throws for upstream problems: every result is a typed outcome.
 */
export async function fetchGovukDocument(path: string, options: GovukClientOptions = {}): Promise<FetchOutcome> {
  if (!isSafeGovukPath(path)) {
    throw new RangeError(`Unsafe GOV.UK path: ${path}`);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? realSleep;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? 30_000;
  const url = `${GOVUK_ORIGIN}/api/content${path}`;

  let lastFailure: FetchOutcome & { kind: "failed" } = {
    kind: "failed", reason: "network_error", message: "No attempt made", httpStatus: null, attempts: 0
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await attemptFetch(url, fetchImpl, timeoutMs);
    let delayMs = baseDelayMs * 2 ** (attempt - 1);

    if (result.kind === "timeout") {
      lastFailure = { kind: "failed", reason: "timeout", message: `No response within ${timeoutMs} ms`, httpStatus: null, attempts: attempt };
    } else if (result.kind === "network_error") {
      lastFailure = { kind: "failed", reason: "network_error", message: result.message.slice(0, 200), httpStatus: null, attempts: attempt };
    } else if (result.status === 429) {
      lastFailure = { kind: "failed", reason: "rate_limited", message: "GOV.UK returned 429", httpStatus: 429, attempts: attempt };
      delayMs = retryAfterMs(result.retryAfter, maxRetryAfterMs) ?? delayMs;
    } else if (result.status >= 500) {
      lastFailure = { kind: "failed", reason: "server_error", message: `GOV.UK returned ${result.status}`, httpStatus: result.status, attempts: attempt };
    } else if (result.status >= 300 && result.status < 400) {
      return { kind: "redirected", destination: result.location, httpStatus: result.status, attempts: attempt };
    } else if (result.status === 404 || result.status === 410) {
      return { kind: "removed", httpStatus: result.status, attempts: attempt };
    } else if (result.status !== 200) {
      return { kind: "failed", reason: "unexpected_status", message: `GOV.UK returned ${result.status}`, httpStatus: result.status, attempts: attempt };
    } else {
      return interpretBody(path, result.body, attempt);
    }

    if (attempt < maxAttempts) {
      await sleep(delayMs);
    }
  }
  return lastFailure;
}
