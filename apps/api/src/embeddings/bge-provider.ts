import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { EmbeddingProviderError, type EmbeddingProvider, type EmbeddingPurpose } from "./provider.ts";

// BAAI bge-small-en-v1.5 (MIT licence), ONNX export by Xenova, run locally in Node.
// Nothing is sent to a third party and there is no per-token cost.
// Pinned to an exact repository commit so vectors are reproducible.
export const BGE_SMALL = {
  repository: "Xenova/bge-small-en-v1.5",
  revision: "ea104dacec62c0de699686887e3f920caeb4f3e3",
  dimensions: 384,
  maxInputTokens: 512,
  // From the model card: queries (not passages) get this instruction for retrieval.
  queryInstruction: "Represent this sentence for searching relevant passages: "
} as const;

const MODEL_CACHE_DIR = new URL("../../../../.cache/models/", import.meta.url).pathname;

// transformers.js types `pipeline()` as a union of every task, which TypeScript cannot
// represent here ("union type too complex"). We only use one task, so narrow it once.
type CreateFeatureExtractor = (
  task: "feature-extraction",
  model: string,
  options: { revision: string; dtype: "fp32" }
) => Promise<FeatureExtractionPipeline>;

/**
 * Imported on first use, not at start-up: transformers.js loads onnxruntime's native library,
 * so an API that never runs the model (search disabled, or an unsupported platform) must not
 * fail to start because of it.
 */
async function loadFeatureExtractor(): Promise<FeatureExtractionPipeline> {
  const transformers = await import("@huggingface/transformers");
  transformers.env.cacheDir = MODEL_CACHE_DIR;
  transformers.env.allowLocalModels = false;
  const createFeatureExtractor = transformers.pipeline as unknown as CreateFeatureExtractor;
  return createFeatureExtractor("feature-extraction", BGE_SMALL.repository, { revision: BGE_SMALL.revision, dtype: "fp32" });
}

export class BgeSmallProvider implements EmbeddingProvider {
  readonly modelId = `local:${BGE_SMALL.repository}@${BGE_SMALL.revision.slice(0, 8)}:cls-normalised-fp32`;
  readonly dimensions = BGE_SMALL.dimensions;
  readonly maxInputTokens = BGE_SMALL.maxInputTokens;
  private extractor: Promise<FeatureExtractionPipeline> | null = null;

  /** Loads the model once (downloading about 133 MB on first use) and reuses it. */
  private load(): Promise<FeatureExtractionPipeline> {
    if (this.extractor === null) {
      this.extractor = loadFeatureExtractor();
      // If loading fails, allow a later call to try again instead of caching the failure.
      this.extractor.catch(() => { this.extractor = null; });
    }
    return this.extractor;
  }

  async embed(texts: readonly string[], purpose: EmbeddingPurpose): Promise<number[][]> {
    let extractor: FeatureExtractionPipeline;
    try {
      extractor = await this.load();
    } catch (error) {
      throw new EmbeddingProviderError("unavailable", `Model failed to load: ${error instanceof Error ? error.message : String(error)}`, true);
    }
    const inputs = texts.map(text => (purpose === "query" ? `${BGE_SMALL.queryInstruction}${text}` : text));
    for (const input of inputs) {
      // Refuse rather than silently truncate: a truncated passage would be embedded without its end.
      const tokenCount = extractor.tokenizer.encode(input).length;
      if (tokenCount > this.maxInputTokens) {
        throw new EmbeddingProviderError("input_too_long", `Input has ${tokenCount} tokens; the limit is ${this.maxInputTokens}`, false);
      }
    }
    const output = await extractor(inputs, { pooling: "cls", normalize: true });
    return output.tolist() as number[][];
  }
}
