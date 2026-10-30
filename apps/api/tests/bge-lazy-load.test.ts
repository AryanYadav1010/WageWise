import { describe, expect, it } from "vitest";
import { createEmbeddingProvider } from "../src/embeddings/factory.ts";

// Regression test for the Milestone 3 container crash: importing transformers.js at start-up
// loaded onnxruntime's native library, which cannot load on Alpine (musl), so the whole API
// failed to start. Creating the provider must not load native code; only embedding may.

function onnxNativeLibrariesLoaded(): string[] {
  const report = process.report.getReport() as unknown as { sharedObjects: string[] };
  return report.sharedObjects.filter(path => /onnxruntime/i.test(path));
}

describe("local embedding provider start-up", () => {
  it("does not load onnxruntime when the provider is created", () => {
    const provider = createEmbeddingProvider("local-bge-small");
    expect(provider?.dimensions).toBe(384);
    expect(onnxNativeLibrariesLoaded()).toEqual([]);
  });
});
