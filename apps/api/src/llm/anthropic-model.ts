import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AnswerModelError, answerDraftSchema, type AnswerDraft, type AnswerModel, type AnswerPrompt } from "./answer-model.ts";

export type AnthropicModelOptions = {
  apiKey: string;
  model: string;
  /** Total time allowed for one answer, including the SDK's retries (a user is waiting). */
  timeoutMs: number;
  /** The SDK retries 408/409/429/5xx and connection errors with backoff. */
  maxRetries?: number;
  /** Tests inject a fake HTTP layer; production uses the global fetch. */
  fetch?: typeof fetch;
};

/**
 * Claude via the official SDK. Structured output constrains the reply to the AnswerDraft
 * schema; no tools are offered, so the model can only return text in that shape.
 */
export class AnthropicAnswerModel implements AnswerModel {
  readonly modelId: string;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: AnthropicModelOptions) {
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.modelId = `anthropic:${options.model}`;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs,
      maxRetries: options.maxRetries ?? 2,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch })
    });
  }

  async draft(prompt: AnswerPrompt): Promise<AnswerDraft> {
    let response: Anthropic.Message;
    try {
      // create(), not parse(): a refusal or a truncated reply may not match the schema, and we
      // must check stop_reason before trying to read JSON (parse() would throw first).
      response = await this.client.messages.create({
        model: this.model,
        // Answers are a handful of cited sentences; this cap is generous for that shape.
        max_tokens: 4_000,
        // A short extraction-style task: low effort keeps latency and cost down.
        output_config: { effort: "low", format: zodOutputFormat(answerDraftSchema) },
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }]
      // The client timeout applies to each attempt; this signal caps all attempts together.
      }, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw toAnswerModelError(error);
    }
    if (response.stop_reason === "refusal") {
      throw new AnswerModelError("refused", "The model declined to answer");
    }
    if (response.stop_reason === "max_tokens") {
      throw new AnswerModelError("invalid_output", "The model's answer was cut off");
    }
    const text = response.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("");
    return parseDraft(text);
  }
}

/** Validates the model's JSON with the same schema that constrained it; anything else is rejected. */
function parseDraft(text: string): AnswerDraft {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AnswerModelError("invalid_output", "The model did not return valid JSON");
  }
  const parsed = answerDraftSchema.safeParse(json);
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
