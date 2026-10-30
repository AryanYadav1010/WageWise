import type { EmbeddingProviderName } from "../config.ts";
import { BgeSmallProvider } from "./bge-provider.ts";
import type { EmbeddingProvider } from "./provider.ts";

export function createEmbeddingProvider(name: EmbeddingProviderName): EmbeddingProvider | null {
  if (name === "local-bge-small") return new BgeSmallProvider();
  return null;
}
