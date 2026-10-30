import { createHash } from "node:crypto";
import type { EmbeddingProvider, EmbeddingPurpose } from "./provider.ts";

const STOP_WORDS = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from", "how", "i", "if", "in", "is", "it", "my", "of", "on", "or", "the", "to", "what", "when", "will", "with", "you", "your"]);

function bucket(word: string, dimensions: number): number {
  return createHash("sha256").update(word).digest().readUInt32BE(0) % dimensions;
}

/**
 * Deterministic test provider: a hashed bag of words, L2-normalised. Texts that share words
 * get similar vectors, so retrieval tests behave sensibly without loading a real model.
 * It has no understanding of meaning and must never be used for real search.
 */
export class HashingEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly maxInputTokens = 10_000;
  calls: { texts: readonly string[]; purpose: EmbeddingPurpose }[] = [];

  constructor(readonly dimensions = 64, modelSuffix = "v1") {
    this.modelId = `test:hashing-bag-of-words-${dimensions}:${modelSuffix}`;
  }

  async embed(texts: readonly string[], purpose: EmbeddingPurpose): Promise<number[][]> {
    this.calls.push({ texts, purpose });
    return texts.map(text => this.vectorFor(text));
  }

  private vectorFor(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const word of words) {
      if (STOP_WORDS.has(word)) continue;
      const index = bucket(word, this.dimensions);
      vector[index] = (vector[index] ?? 0) + 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    // An all-stop-word text gets a fixed unit vector rather than a zero vector (undefined cosine).
    if (norm === 0) return vector.map((_, index) => (index === 0 ? 1 : 0));
    return vector.map(value => value / norm);
  }
}
