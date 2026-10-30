import { randomUUID } from "node:crypto";
import Fastify, { LogController } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import type { AppConfig } from "./config.ts";
import { calculateBudget } from "./domain/budget.ts";
import { isValidIsoDate, londonDateFromInstant } from "./domain/dates.ts";
import { nextPayday } from "./domain/payday.ts";
import { bankHolidayLookup, JURISDICTIONS, MissingHolidayDataError, type BankHolidaySnapshot } from "./domain/bank-holidays.ts";
import { findSourceLinks } from "./domain/source-directory.ts";
import { registerChat, type ChatService } from "./chat-route.ts";
import { registerGuidanceSearch, type GuidanceSearch } from "./guidance-route.ts";
import { budgetResponse, linkResponse } from "./responses.ts";

export type AppDependencies = {
  config: AppConfig;
  holidaySnapshot: BankHolidaySnapshot;
  /** Injected so tests can pin the clock, e.g. to either side of a BST/GMT change. */
  now: () => Date;
  /** Retrieval over approved GOV.UK content; null (the default) when no database is configured. */
  guidanceSearch?: GuidanceSearch | null;
  /** Grounded answers; null (the default) without a database and an LLM key. */
  chat?: ChatService | null;
  /** Throws if the database can't be reached; null when none is configured. */
  checkDatabase?: (() => Promise<void>) | null;
};

const isoDate = z.string().refine(isValidIsoDate, "Expected a real calendar date in YYYY-MM-DD format");
const moneyPence = z.number().int().nonnegative().max(100_000_000);

const payScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed_day_of_month"), dayOfMonth: z.number().int().min(1).max(31) }).strict(),
  z.object({ kind: z.literal("last_day_of_month") }).strict(),
  z.object({ kind: z.literal("last_working_day_of_month") }).strict()
]);

const budgetRequestSchema = z.object({
  // Optional override for "what if" planning. When omitted, today is the current UK date.
  today: isoDate.optional(),
  jurisdiction: z.enum(JURISDICTIONS),
  paySchedule: payScheduleSchema,
  // Deliberately no default: employers differ, so the user must say what theirs does.
  nonWorkingDayRule: z.enum(["unchanged", "previous_working_day", "next_working_day"]),
  currentBalancePence: moneyPence,
  incomeBeforePaydayPence: moneyPence.default(0),
  billsBeforePaydayPence: moneyPence.default(0),
  essentialsBeforePaydayPence: moneyPence.default(0)
}).strict();

const searchRequestSchema = z.object({ question: z.string().trim().min(3).max(500) }).strict();

function statusCodeOf(error: unknown): number {
  if (typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  return 500;
}

export async function buildApp(dependencies: AppDependencies) {
  const { config, holidaySnapshot, now } = dependencies;

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Request bodies may hold the user's (synthetic) finances or questions: never log them.
      redact: ["req.headers.authorization", "req.headers.cookie", "req.body"]
    },
    // Fastify's default request logs include the client IP; we write our own summary below.
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    bodyLimit: 16_384,
    // Slow clients can't hold connections open; idle sockets outlast the longest answer (LLM_TIMEOUT_MS).
    requestTimeout: 15_000,
    connectionTimeout: 90_000,
    // Trust exactly the configured number of proxy hops (as proxy-addr does for a hop count).
    trustProxy: config.TRUST_PROXY_HOPS === 0 ? false : (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS
  });

  await app.register(cors, { origin: config.WEB_ORIGIN, methods: ["GET", "POST"] });
  await app.register(rateLimit, { max: config.RATE_LIMIT_PER_MINUTE, timeWindow: "1 minute" });

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-request-id", request.id);
    // A JSON API: nothing may be framed, sniffed or kept, so a stale answer can't sit in a browser cache.
    reply.headers({
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "strict-transport-security": "max-age=31536000; includeSubDomains",
      "x-content-type-options": "nosniff"
    });
  });
  app.addHook("onResponse", async (request, reply) => {
    request.log.info({
      method: request.method,
      route: request.routeOptions.url ?? "unmatched",
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime)
    }, "request completed");
  });

  app.get("/api/health", async () => ({
    status: "ok",
    version: "2",
    bankHolidayDataFetchedAt: holidaySnapshot.fetchedAt,
    guidanceSearch: dependencies.guidanceSearch === undefined || dependencies.guidanceSearch === null ? "not_configured" : "configured",
    chat: dependencies.chat === undefined || dependencies.chat === null ? "not_configured" : "configured"
  }));

  // Separate from /api/health so a frequent platform health check doesn't keep the database awake.
  app.get("/api/ready", async (request, reply) => {
    try {
      await dependencies.checkDatabase?.();
      return { status: "ready", database: dependencies.checkDatabase === undefined || dependencies.checkDatabase === null ? "not_configured" : "ok" };
    } catch (error) {
      request.log.error({ err: error instanceof Error ? error.message : String(error) }, "readiness check failed");
      return reply.code(503).send({ status: "unavailable", requestId: request.id });
    }
  });

  registerGuidanceSearch(app, dependencies.guidanceSearch ?? null, now, config.SEARCH_RATE_LIMIT_PER_MINUTE);
  registerChat(app, dependencies.chat ?? null, now, config.CHAT_RATE_LIMIT_PER_MINUTE);

  app.post("/api/source-search", async (request, reply) => {
    const parsed = searchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_INPUT", message: "Question must be 3–500 characters.", requestId: request.id });
    }
    return linkResponse.parse({
      mode: "directory_only",
      isGroundedAnswer: false,
      message: "These are links to useful official and public resources, not AI-generated financial advice or verified excerpts.",
      sources: findSourceLinks(parsed.data.question)
    });
  });

  app.post("/api/budget", async (request, reply) => {
    const parsed = budgetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "INVALID_INPUT",
        message: "Budget fields are invalid.",
        details: parsed.error.flatten().fieldErrors,
        requestId: request.id
      });
    }
    const input = parsed.data;
    const today = input.today ?? londonDateFromInstant(now());

    try {
      const isBankHoliday = bankHolidayLookup(holidaySnapshot, input.jurisdiction);
      const payday = nextPayday(today, input.paySchedule, input.nonWorkingDayRule, isBankHoliday);
      const budget = calculateBudget({
        today,
        payday: payday.effectiveDate,
        currentBalancePence: input.currentBalancePence,
        incomeBeforePaydayPence: input.incomeBeforePaydayPence,
        billsBeforePaydayPence: input.billsBeforePaydayPence,
        essentialsBeforePaydayPence: input.essentialsBeforePaydayPence
      });
      return budgetResponse.parse({
        mode: "synthetic_calculator",
        today,
        jurisdiction: input.jurisdiction,
        payday,
        budget,
        bankHolidayData: {
          source: holidaySnapshot.source,
          fetchedAt: holidaySnapshot.fetchedAt,
          licence: holidaySnapshot.licence
        },
        disclaimer: "Illustrative budgeting with the figures you entered. Check your payday with your employer. Not financial advice."
      });
    } catch (error) {
      if (error instanceof MissingHolidayDataError) {
        return reply.code(422).send({ error: "HOLIDAY_DATA_UNAVAILABLE", message: error.message, requestId: request.id });
      }
      if (error instanceof RangeError) {
        return reply.code(422).send({ error: "INVALID_DATE_OR_AMOUNT", message: error.message, requestId: request.id });
      }
      throw error;
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = statusCodeOf(error);
    if (statusCode === 429) {
      return reply.code(429).send({ error: "RATE_LIMITED", message: "Too many requests. Try again later.", requestId: request.id });
    }
    if (statusCode >= 400 && statusCode < 500) {
      request.log.warn({ statusCode }, "client error");
      return reply.code(statusCode).send({ error: "INVALID_REQUEST", message: "Request could not be processed.", requestId: request.id });
    }
    // Full detail goes to the server log only; clients get a generic message and a request ID.
    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ error: "INTERNAL_ERROR", message: "Request failed.", requestId: request.id });
  });

  return app;
}
