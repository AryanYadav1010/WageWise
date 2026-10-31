// Zod 4 (bundled in zod 3.25 as "zod/v4"): the Anthropic SDK's structured-output helper expects it.
import { z } from "zod/v4";
import type { FollowUpRewrite } from "../chat/follow-up.ts";

// Provider-neutral contract for the one thing the chatbot asks an LLM to do: draft an answer
// from numbered sources, citing a source id for every sentence, or abstain. The draft is
// untrusted output; it is verified by code before anything reaches a user.

export const answerDraftSchema = z.object({
  abstain: z.boolean(),
  abstainReason: z.string().nullable(),
  sentences: z.array(z.object({
    text: z.string(),
    sourceIds: z.array(z.string())
  }))
});
export type AnswerDraft = z.infer<typeof answerDraftSchema>;
/** A draft plus the tokens it cost, for spend monitoring. */
export type CostedDraft = AnswerDraft & { tokens: number };

export type AnswerPrompt = { system: string; user: string };

export interface AnswerModel {
  /** Stable identifier recorded with every answer, e.g. "anthropic:claude-haiku-5-5". */
  readonly modelId: string;
  draft(prompt: AnswerPrompt): Promise<CostedDraft>;
  /** Rewrites a follow-up as a standalone question. Without this, such a follow-up gets a request to ask in full. */
  rewrite?(prompt: AnswerPrompt): Promise<FollowUpRewrite & { tokens: number }>;
}

export type AnswerModelErrorCode = "timeout" | "rate_limited" | "unavailable" | "refused" | "invalid_output" | "configuration";

export class AnswerModelError extends Error {
  constructor(readonly code: AnswerModelErrorCode, message: string) {
    super(message);
    this.name = "AnswerModelError";
  }
}
