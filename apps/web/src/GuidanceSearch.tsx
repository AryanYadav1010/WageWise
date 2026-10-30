import { useState, type FormEvent } from "react";
import { ArrowUpRight, Info } from "lucide-react";
import { searchGuidance, type GuidanceResult, type GuidanceSearchResponse, type Nation } from "./api.ts";
import { formatIsoDate } from "./format.ts";
import { chipClass, ErrorMessage, inputClass, labelClass, NATION_LABELS, nationList, Page, periodText, primaryButtonClass } from "./ui.tsx";

const EXAMPLES = ["What does tax code 1257L mean?", "Scottish income tax rates", "How much National Insurance do I pay?"];

function nationsText(result: GuidanceResult): string {
  const list = nationList(result.nations);
  return result.nationsBasis === "inferred" ? `${list} (our assessment; the page doesn't say)` : list;
}

function ResultCard({ result }: { result: GuidanceResult }) {
  return <li className="py-5">
    <a href={result.sectionUrl} target="_blank" rel="noreferrer" className="group flex items-start justify-between gap-3">
      <span>
        <span className="block text-xs text-faint">{result.documentTitle}</span>
        <strong className="font-medium group-hover:underline">{result.sectionTitle}</strong>
      </span>
      <ArrowUpRight size={16} className="text-faint group-hover:text-accent shrink-0 mt-1" aria-hidden="true" />
    </a>
    <blockquote className="text-[15px] leading-relaxed text-muted mt-2">{result.excerpt}</blockquote>
    <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted mt-3">
      <div><dt className="inline text-faint">Applies in: </dt><dd className="inline">{nationsText(result)}</dd></div>
      <div><dt className="inline text-faint">Period: </dt><dd className="inline">{periodText(result.applicability)}</dd></div>
      <div><dt className="inline text-faint">Copied from GOV.UK: </dt><dd className="inline">{formatIsoDate(result.sourceFetchedAt.slice(0, 10))}</dd></div>
      <div><dt className="inline text-faint">Last checked: </dt><dd className="inline">{result.sourceCheckedAt === null ? "unknown" : formatIsoDate(result.sourceCheckedAt.slice(0, 10))}</dd></div>
    </dl>
    <p className="text-[11px] text-faint mt-2">Source: <a className="underline" href={result.sectionUrl} target="_blank" rel="noreferrer">{result.sectionUrl.replace("https://", "")}</a>. {result.attribution}.</p>
  </li>;
}

export function GuidanceSearch() {
  const [query, setQuery] = useState("");
  const [nation, setNation] = useState<Nation | "">("");
  const [response, setResponse] = useState<GuidanceSearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResponse(null);
    setBusy(true);
    try {
      setResponse(await searchGuidance({ query, jurisdiction: nation === "" ? null : nation, limit: 5 }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  return <Page title="Search guidance" intro="Finds passages in GOV.UK guidance that match your words. It shows you where to read; it doesn't answer for you.">
    <form onSubmit={handleSubmit} className="grid sm:grid-cols-[minmax(0,1fr)_190px_auto] gap-3 items-end">
      <label className="block">
        <span className={labelClass}>What do you want to find?</span>
        <input value={query} onChange={event => setQuery(event.target.value)} minLength={3} maxLength={300} required
          placeholder="e.g. emergency tax code" className={inputClass} />
      </label>
      <label className="block">
        <span className={labelClass}>Where you live or work</span>
        <select value={nation} onChange={event => setNation(event.target.value as Nation | "")} className={inputClass}>
          <option value="">Not specified</option>
          {(Object.keys(NATION_LABELS) as Nation[]).map(key => <option key={key} value={key}>{NATION_LABELS[key]}</option>)}
        </select>
      </label>
      <button disabled={busy || query.trim().length < 3} className={primaryButtonClass}>{busy ? "Searching…" : "Search"}</button>
    </form>
    <div className="flex flex-wrap gap-2 mt-3">
      {EXAMPLES.map(example => <button type="button" key={example} onClick={() => setQuery(example)} className={chipClass}>{example}</button>)}
    </div>

    {error !== "" && <ErrorMessage>{error}</ErrorMessage>}

    {response !== null && <section className="mt-8" aria-live="polite" aria-label="Search results">
      <p className="text-sm text-muted">
        {response.results.length} {response.results.length === 1 ? "source" : "sources"} · as of {formatIsoDate(response.request.asOfDate)}
        {response.request.jurisdiction !== null && ` · ${NATION_LABELS[response.request.jurisdiction]}`}
      </p>
      {response.notices.length > 0 && <ul className="mt-3 space-y-1.5">
        {response.notices.map(notice => <li key={notice} className="flex gap-2 text-[13px] leading-snug text-muted">
          <Info size={14} className="shrink-0 mt-0.5 text-faint" aria-hidden="true" />{notice}
        </li>)}
      </ul>}
      {response.results.length > 0 && <ol className="mt-2 divide-y divide-ink/10">
        {response.results.map(result => <ResultCard key={result.sectionUrl} result={result} />)}
      </ol>}
      <p className="text-xs text-faint mt-4 pt-3 border-t border-ink/10">{response.disclaimer} Ref {response.traceId.slice(0, 8)}</p>
    </section>}
  </Page>;
}
