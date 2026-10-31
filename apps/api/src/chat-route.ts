import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { figuresIn, type AbstainReason, type ChatAnswer, type ChatRequest } from "./chat/answer.ts";
import { MAX_HISTORY, type PastTurn } from "./chat/follow-up.ts";
import { isValidIsoDate, londonDateFromInstant } from "./domain/dates.ts";
import { NATIONS } from "./ingest/corpus.ts";
import { chatResponse } from "./responses.ts";
import type { Nation, WarnLogger } from "./retrieval/search.ts";

/** What the route needs; null when no database or no LLM key is configured. */
export type ChatService = (request: ChatRequest, logger: WarnLogger) => Promise<ChatAnswer>;

// Strict, with no place for an answer: what the browser says was asked is treated as a question,
// never as a fact, so a forged history can do no more than typing the same words could.
const pastTurnSchema = z.object({ question: z.string().trim().min(3).max(600), nation: z.enum(NATIONS).nullable() }).strict();

const chatRequestSchema = z.object({
  question: z.string().trim().min(3).max(500),
  history: z.array(pastTurnSchema).max(MAX_HISTORY).default([]),
  jurisdiction: z.enum(NATIONS).nullable().default(null),
  asOfDate: z.string().refine(isValidIsoDate, "Expected a real calendar date in YYYY-MM-DD format")
    .refine(date => date >= "2000-01-01" && date <= "2100-12-31", "Date out of supported range").optional()
}).strict();

const ABSTAIN_MESSAGES: Record<AbstainReason, string> = {
  personal_advice: "WageWise can't say what you should do, and the approved guidance doesn't answer this directly.",
  too_vague: "That's quite broad. Try a full question, such as what you want to know about it and where in the UK you live.",
  nation_conflict: "Your question names a different part of the UK from the one selected. Tax rules can differ, so please choose which one you mean.",
  ambiguous_reference: "I'm not sure what that refers to, so I won't guess. Please ask the full question, including the topic and the nation or tax year you mean.",
  year_not_covered: "The approved guidance doesn't cover that tax year, and I won't use figures from a different year. HMRC publishes past rates on GOV.UK.",
  no_evidence: "I couldn't find approved official guidance that covers this, so I won't guess. Try rephrasing, or check GOV.UK directly.",
  relevance_unavailable: "I can't check how relevant the sources are right now, so I'm only listing them. Please read them on GOV.UK.",
  model_abstained: "The sources I found don't answer this clearly enough to summarise. They're listed below so you can check them yourself.",
  no_verified_sentences: "I couldn't produce an answer that I could check against the sources, so I'm not showing one. The sources are listed below.",
  model_unavailable: "The answer service is unavailable right now. Here are the most relevant official sources instead."
};

const DISCLAIMER = "General information from official GOV.UK guidance, not financial advice and not a check of your circumstances. Rules change: confirm on GOV.UK before acting.";
const ADVICE_NOTICE = "You asked what you should do. WageWise can only explain the general rules; for a personal recommendation, speak to a regulated adviser or free guidance such as MoneyHelper.";

const NATION_NAMES: Record<Nation, string> = { england: "England", scotland: "Scotland", wales: "Wales", "northern-ireland": "Northern Ireland" };

function noticesFor(answer: ChatAnswer, previous: PastTurn | undefined): string[] {
  const notices: string[] = [];
  const { kind, nation } = answer.conversation;
  const earlier = previous?.nation ?? null;
  if (answer.personalAdviceRequested) notices.push(ADVICE_NOTICE);
  if (nation === null && kind !== "comparison" && answer.sources.length > 0) {
    notices.push(earlier === null
      ? "You didn't say where you live or work. Tax, employment and benefit rules can differ in Scotland, Wales and Northern Ireland."
      : `This is a new question, so it isn't limited to ${NATION_NAMES[earlier]} like your last one. Tax rules can differ across the UK.`);
  }
  if (kind === "follow_up" && nation !== null && earlier !== null && earlier !== nation) {
    notices.push(`This answer is for ${NATION_NAMES[nation]}. Your last question was about ${NATION_NAMES[earlier]}.`);
  }
  const undated = new Set(answer.sources.filter(source => source.applicability.status === "not_stated").map(source => source.id));
  if (answer.answer.some(sentence => figuresIn(sentence.text).length > 0 && sentence.sourceIds.some(id => undated.has(id)))) {
    notices.push("A figure in this answer comes from a page that doesn't say which tax year it applies to. Check it's current on GOV.UK.");
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

    const { question, jurisdiction: selected, history } = parsed.data;
    const today = parsed.data.asOfDate ?? londonDateFromInstant(now());
    let answer: ChatAnswer;
    try {
      answer = await chat({ question, nation: selected, asOfDate: today, history }, request.log);
    } catch (error) {
      request.log.error({ err: error instanceof Error ? error.message : String(error) }, "chat failed");
      return reply.code(503).send({ error: "CHAT_UNAVAILABLE", message: "Answers are temporarily unavailable. Please try again.", requestId: request.id });
    }

    const { kind, nation: jurisdiction, asOfDate, clarifyNations, turns } = answer.conversation;
    // Privacy: record the outcome, never the question or the conversation.
    request.log.info({
      questionLength: question.length, conversation: kind, historyTurns: history.length, jurisdiction, asOfDate, mode: answer.mode, abstainReason: answer.abstainReason,
      sources: answer.sources.length, sentences: answer.answer.length, droppedSentences: answer.droppedSentences,
      dropReasons: answer.dropReasons, model: answer.modelId, ...answer.usage
    }, "chat answered");

    return chatResponse.parse({
      mode: answer.mode,
      isGroundedAnswer: answer.mode === "grounded_answer",
      traceId: request.id,
      request: { jurisdiction, asOfDate },
      answer: answer.answer,
      message: answer.abstainReason === null ? null : ABSTAIN_MESSAGES[answer.abstainReason],
      abstainReason: answer.abstainReason,
      clarifyNations,
      conversation: { kind, turns },
      sources: answer.sources,
      notices: noticesFor(answer, history.at(-1)),
      model: answer.modelId,
      disclaimer: DISCLAIMER
    });
  });
}
