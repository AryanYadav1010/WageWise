import { useState, type FormEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { searchSources, type SearchResponse } from "./api.ts";
import { chipClass, ErrorMessage, inputClass, Page, primaryButtonClass } from "./ui.tsx";

const SUGGESTIONS = ["tax code", "workplace pension", "budgeting", "debt", "scams", "payslips"];

export function SourceSearch() {
  const [query, setQuery] = useState("What does my tax code mean?");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    setBusy(true);
    try {
      setResult(await searchSources(query));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  return <Page title="Key links" intro="Find useful official and public resources by topic. This is a directory of links, not an answer, and WageWise has no connection with these organisations.">
    <form onSubmit={handleSubmit} className="flex gap-2">
      <label htmlFor="link-question" className="sr-only">Topic</label>
      <input id="link-question" value={query} onChange={event => setQuery(event.target.value)} maxLength={500} placeholder="Ask where to find guidance…" className={inputClass} />
      <button disabled={busy || query.trim().length < 3} className={primaryButtonClass}>{busy ? "…" : "Find"}</button>
    </form>
    <div className="flex flex-wrap gap-2 mt-3">
      {SUGGESTIONS.map(suggestion => <button type="button" key={suggestion} onClick={() => setQuery(suggestion)} className={chipClass}>{suggestion}</button>)}
    </div>

    {error !== "" && <ErrorMessage>{error}</ErrorMessage>}

    {result !== null && <div className="mt-8">
      <p className="text-sm text-muted">{result.sources.length} topic matches · Link directory only</p>
      {result.sources.length === 0 && <p className="mt-4">No matching links found. Try a narrower topic. No answer has been generated.</p>}
      <div className="mt-2 divide-y divide-ink/10">
        {result.sources.map(source => <a href={source.url} target="_blank" rel="noreferrer" key={source.url} className="group block py-4">
          <div className="flex items-center justify-between gap-2"><strong className="font-medium group-hover:underline">{source.title}</strong><ArrowUpRight size={16} className="text-faint group-hover:text-accent" aria-hidden="true" /></div>
          <div className="text-[15px] text-muted mt-1">{source.description}</div>
          <div className="text-xs text-faint mt-2">{source.publisher} · opens their site</div>
        </a>)}
      </div>
    </div>}
  </Page>;
}
