import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod/v4";
import { followUpRewriteSchema, type FollowUpRewrite } from "../chat/follow-up.ts";
import { AnswerModelError, answerDraftSchema, type AnswerModel, type AnswerPrompt, type CostedDraft } from "./answer-model.ts";

export type AnthropicModelOptions = {
  apiKey: string;
  model: string;
  /** Total time allowed for one answer, including the SDK's retries (a user is waiting). */
  timeoutMs: number;
  /** The SDK retries 408/409/429/5xx and connection errors with backoff. */
  maxRetries?: number;
  /** Requests beyond this at once are refused, so a burst can't queue up spend. */
  maxConcurrent: number;
  /** Input + output tokens per UTC day; past this, answers stop until tomorrow. */
  dailyTokenLimit: number;
  /** Tests inject a fake HTTP layer; production uses the global fetch. */
  fetch?: typeof fetch;
};

/** A rewrite is short, and an answer still has to follow within the browser's 45-second limit. */
const REWRITE_TIMEOUT_MS = 8_000;

/**
 * Claude via the official SDK. Structured output constrains the reply to the AnswerDraft
 * schema; no tools are offered, so the model can only return text in that shape.
 */
export class AnthropicAnswerModel implements AnswerModel {
  readonly modelId: string;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private readonly dailyTokenLimit: number;
  private inFlight = 0;
  // ponytail: per process and reset on restart. A shared counter is needed with several instances;
  // the Anthropic console spend limit is the hard ceiling either way.
  private usage = { day: "", tokens: 0 };

  constructor(options: AnthropicModelOptions) {
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.maxConcurrent = options.maxConcurrent;
    this.dailyTokenLimit = options.dailyTokenLimit;
    this.modelId = `anthropic:${options.model}`;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs,
      maxRetries: options.maxRetries ?? 2,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch })
    });
  }

  private tokensToday(): number {
    const day = new Date().toISOString().slice(0, 10);
    if (this.usage.day !== day) this.usage = { day, tokens: 0 };
    return this.usage.tokens;
  }

  draft(prompt: AnswerPrompt): Promise<CostedDraft> {
    // Eight sentences of 40 words with citations fit comfortably: this is the per-request ceiling.
    return this.limited(() => this.request(prompt, answerDraftSchema, 1_200));
  }

  rewrite(prompt: AnswerPrompt): Promise<FollowUpRewrite & { tokens: number }> {
    return this.limited(() => this.request(prompt, followUpRewriteSchema, 200, Math.min(REWRITE_TIMEOUT_MS, this.timeoutMs)));
  }

  private async limited<T>(work: () => Promise<T>): Promise<T> {
    if (this.tokensToday() >= this.dailyTokenLimit) throw new AnswerModelError("rate_limited", "The daily answer budget is used up");
    if (this.inFlight >= this.maxConcurrent) throw new AnswerModelError("rate_limited", "Too many answers in progress");
    this.inFlight += 1;
    try {
      return await work();
    } finally {
      this.inFlight -= 1;
    }
  }

  private async request<Schema extends z.ZodType>(prompt: AnswerPrompt, schema: Schema, maxTokens: number, timeoutMs = this.timeoutMs): Promise<z.infer<Schema> & { tokens: number }> {
    let response: Anthropic.Message;
    try {
      // create(), not parse(): a refusal or a truncated reply may not match the schema, and we
      // must check stop_reason before trying to read JSON (parse() would throw first).
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        // A short extraction-style task: low effort keeps latency and cost down.
        output_config: { effort: "low", format: zodOutputFormat(schema) },
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }]
      // The client timeout applies to each attempt; this signal caps all attempts together.
      }, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw toAnswerModelError(error);
    }
    const tokens = response.usage.input_tokens + response.usage.output_tokens;
    this.usage.tokens += tokens;
    if (response.stop_reason === "refusal") {
      throw new AnswerModelError("refused", "The model declined to answer");
    }
    if (response.stop_reason === "max_tokens") {
      throw new AnswerModelError("invalid_output", "The model's answer was cut off");
    }
    const text = response.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("");
    return { ...(parseReply(text, schema) as object), tokens } as z.infer<Schema> & { tokens: number };
  }
}

/** Validates the model's JSON with the same schema that constrained it; anything else is rejected. */
function parseReply<Schema extends z.ZodType>(text: string, schema: Schema): z.infer<Schema> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AnswerModelError("invalid_output", "The model did not return valid JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AnswerModelError("invalid_output", "The model's answer did not match the expected shape");
  return parsed.data;
}

/** Most specific first; messages are ours, never the provider's raw body. */
function toAnswerModelError(error: unknown): AnswerModelError {
  // Our deadline signal is the only thing that aborts a request.
  if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError) return new AnswerModelError("timeout", "The answer service did not respond in time");
  if (error instanceof Anthropic.RateLimitError) return new AnswerModelError("rate_limited", "The answer service is busy");
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AnswerModelError("configuration", "The answer service is not configured correctly");
  }
  if (error instanceof Anthropic.BadRequestError) return new AnswerModelError("invalid_output", "The answer request was rejected");
  if (error instanceof Anthropic.APIError) return new AnswerModelError("unavailable", "The answer service is unavailable");
  return new AnswerModelError("unavailable", "The answer service could not be reached");
}
