// A small, provider-neutral contract for turning text into vectors. Retrieval and the
// embedding job depend only on this interface, never on a specific SDK.

/** Some models embed questions and passages differently (BGE adds an instruction to queries). */
export type EmbeddingPurpose = "query" | "document";

export interface EmbeddingProvider {
  /** Stable identifier including model revision and pooling, stored with every vector. */
  readonly modelId: string;
  readonly dimensions: number;
  /** Largest input the model accepts without truncation, in its own tokens. */
  readonly maxInputTokens: number;
  embed(texts: readonly string[], purpose: EmbeddingPurpose): Promise<number[][]>;
}

export type EmbeddingErrorCode = "timeout" | "rate_limited" | "server_error" | "invalid_response" | "input_too_long" | "unavailable";

export class EmbeddingProviderError extends Error {
  constructor(readonly code: EmbeddingErrorCode, message: string, readonly retryable: boolean) {
    super(message);
    this.name = "EmbeddingProviderError";
  }
}

/**
 * Rejects anything that is not exactly `expectedCount` finite vectors of the model's dimension.
 * A wrong-sized or NaN vector would silently corrupt similarity search, so it is an error.
 */
export function validateVectors(vectors: unknown, expectedCount: number, dimensions: number): number[][] {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    throw new EmbeddingProviderError("invalid_response", `Expected ${expectedCount} vectors`, false);
  }
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== dimensions) {
      throw new EmbeddingProviderError("invalid_response", `Expected vectors of dimension ${dimensions}`, false);
    }
    if (!vector.every(value => typeof value === "number" && Number.isFinite(value))) {
      throw new EmbeddingProviderError("invalid_response", "Vector contains a non-finite value", false);
    }
  }
  return vectors as number[][];
}

/** pgvector text format, e.g. "[0.1,0.2]". Passed as a query parameter, never interpolated. */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(",")}]`;
}

export type RetryOptions = {
  maxAttempts: number;
  timeoutMs: number;
  baseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
};

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new EmbeddingProviderError("timeout", `No result within ${timeoutMs} ms`, true)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Calls the provider with a timeout, retrying only errors marked retryable. */
export async function embedWithRetry(
  provider: EmbeddingProvider,
  texts: readonly string[],
  purpose: EmbeddingPurpose,
  options: RetryOptions
): Promise<{ vectors: number[][]; attempts: number }> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const raw = await withTimeout(provider.embed(texts, purpose), options.timeoutMs);
      return { vectors: validateVectors(raw, texts.length, provider.dimensions), attempts: attempt };
    } catch (error) {
      const retryable = error instanceof EmbeddingProviderError && error.retryable;
      if (!retryable || attempt >= options.maxAttempts) throw error;
      await options.sleep(options.baseDelayMs * 2 ** (attempt - 1));
    }
  }
}
