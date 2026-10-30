import { createHash } from "node:crypto";
import type { AnswerDraft, AnswerPrompt } from "../llm/answer-model.ts";

// First-person details alongside a figure ("I earn £40,000"): personal, so never cached.
const PERSONAL_PATTERN = /\b(i|i'm|i've|my|me|we|our)\b.*[£\d]|[£\d].*\b(i|i'm|i've|my|me|we|our)\b/i;

export function isCacheable(question: string): boolean {
  return !PERSONAL_PATTERN.test(question);
}

/**
 * Remembers model drafts. The key is a hash of the exact prompt, which contains the question, the
 * nation and the full text of every source, and retrieval runs live on each request. So a withdrawn,
 * superseded or newly approved passage, or another nation or tax year, changes the key: nothing needs
 * invalidating, and a stale draft can't be served. Questions are stored only as part of that hash.
 * Drafts are still re-verified on every hit.
 * ponytail: in memory, per instance, lost on restart. Share it when there is more than one instance.
 */
export class DraftCache {
  private readonly entries = new Map<string, { draft: AnswerDraft; expiresAt: number }>();

  constructor(private readonly maxEntries: number, private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  keyFor(prompt: AnswerPrompt, modelId: string): string {
    return createHash("sha256").update(JSON.stringify([modelId, prompt.system, prompt.user])).digest("hex");
  }

  get(key: string): AnswerDraft | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.entries.delete(key);
    if (entry.expiresAt <= this.now()) return undefined;
    this.entries.set(key, entry); // Map order is insertion order: this makes it the most recently used.
    return entry.draft;
  }

  set(key: string, draft: AnswerDraft): void {
    this.entries.delete(key);
    this.entries.set(key, { draft, expiresAt: this.now() + this.ttlMs });
    const oldest = this.entries.keys().next().value;
    if (this.entries.size > this.maxEntries && oldest !== undefined) this.entries.delete(oldest);
  }
}
