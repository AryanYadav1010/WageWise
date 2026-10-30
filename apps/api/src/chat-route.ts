import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AbstainReason, ChatAnswer, ChatRequest } from "./chat/answer.ts";
import { isValidIsoDate, londonDateFromInstant } from "./domain/dates.ts";
import { NATIONS } from "./ingest/corpus.ts";
import type { WarnLogger } from "./retrieval/search.ts";

/** What the route needs; null when no database or no LLM key is configured. */
export type ChatService = (request: ChatRequest, logger: WarnLogger) => Promise<ChatAnswer>;

const chatRequestSchema = z.object({
  question: z.string().trim().min(3).max(500),
  jurisdiction: z.enum(NATIONS).nullable().default(null),
  asOfDate: z.string().refine(isValidIsoDate, "Expected a real calendar date in YYYY-MM-DD format")
    .refine(date => date >= "2000-01-01" && date <= "2100-12-31", "Date out of supported range").optional()
}).strict();

const ABSTAIN_MESSAGES: Record<AbstainReason, string> = {
  no_evidence: "I couldn't find approved official guidance that covers this, so I won't guess. Try rephrasing, or check GOV.UK directly.",
  relevance_unavailable: "I can't check how relevant the sources are right now, so I'm only listing them. Please read them on GOV.UK.",
  model_abstained: "The sources I found don't answer this clearly enough to summarise. They're listed below so you can check them yourself.",
  no_verified_sentences: "I couldn't produce an answer that I could check against the sources, so I'm not showing one. The sources are listed below.",
  model_unavailable: "The answer service is unavailable right now. Here are the most relevant official sources instead."
};

const DISCLAIMER = "General information from official GOV.UK guidance, not financial advice and not a check of your circumstances. Rules change: confirm on GOV.UK before acting.";
const ADVICE_NOTICE = "You asked what you should do. WageWise can only explain the general rules; for a personal recommendation, speak to a regulated adviser or free guidance such as MoneyHelper.";

function noticesFor(answer: ChatAnswer, jurisdiction: string | null): string[] {
  const notices: string[] = [];
  if (answer.personalAdviceRequested) notices.push(ADVICE_NOTICE);
  if (jurisdiction === null && answer.sources.length > 0) {
    notices.push("You didn't say where you live or work. Tax, employment and benefit rules can differ in Scotland, Wales and Northern Ireland.");
  }
  if (answer.sources.some(source => source.cited && source.applicability.status === "not_stated")) {
    notices.push("Some cited sections don't state which dates they apply to. Check current figures on GOV.UK.");
  }
  return notices;
}

export function registerChat(app: FastifyInstance, chat: ChatService | null, now: () => Date, rateLimitPerMinute: number): void {
  app.post("/api/chat", { config: { rateLimit: { max: rateLimitPerMinute, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = chatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "INVALID_INPUT",
        message: "Questions must be 3–500 characters; nation and date must be valid.",
        details: parsed.error.flatten().fieldErrors,
        requestId: request.id
      });
    }
    if (chat === null) {
      return reply.code(503).send({ error: "CHAT_UNAVAILABLE", message: "Answers are not configured on this server.", requestId: request.id });
    }

    const { question, jurisdiction } = parsed.data;
    const asOfDate = parsed.data.asOfDate ?? londonDateFromInstant(now());
    let answer: ChatAnswer;
    try {
      answer = await chat({ question, nation: jurisdiction, asOfDate }, request.log);
    } catch (error) {
      request.log.error({ err: error instanceof Error ? error.message : String(error) }, "chat failed");
      return reply.code(503).send({ error: "CHAT_UNAVAILABLE", message: "Answers are temporarily unavailable. Please try again.", requestId: request.id });
    }

    // Privacy: record the outcome, never the question.
    request.log.info({
      questionLength: question.length, jurisdiction, asOfDate, mode: answer.mode, abstainReason: answer.abstainReason,
      sources: answer.sources.length, sentences: answer.answer.length, droppedSentences: answer.droppedSentences,
      dropReasons: answer.dropReasons, model: answer.modelId
    }, "chat answered");

    return {
      mode: answer.mode,
      isGroundedAnswer: answer.mode === "grounded_answer",
      traceId: request.id,
      request: { jurisdiction, asOfDate },
      answer: answer.answer,
      message: answer.abstainReason === null ? null : ABSTAIN_MESSAGES[answer.abstainReason],
      abstainReason: answer.abstainReason,
      sources: answer.sources,
      notices: noticesFor(answer, jurisdiction),
      model: answer.modelId,
      disclaimer: DISCLAIMER
    };
  });
}
