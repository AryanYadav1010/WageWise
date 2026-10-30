import { useEffect, useRef } from "react";
import { ArrowUpRight, X } from "lucide-react";
import type { ChatSource } from "./api.ts";
import { formatIsoDate, sourceNumber } from "./format.ts";
import { nationList, periodText } from "./ui.tsx";

function SourceRow({ source, highlighted }: { source: ChatSource; highlighted: boolean }) {
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlighted) row.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return <li ref={row} className={`py-4 px-5 ${highlighted ? "bg-accent/10" : ""}`}>
    <a href={source.url} target="_blank" rel="noreferrer" className="group flex items-start gap-3">
      <span className="mt-0.5 h-5 min-w-5 grid place-items-center rounded-md bg-ink/10 text-[11px] font-medium text-muted">{sourceNumber(source.id)}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-faint">{source.documentTitle}</span>
        <span className="block text-sm font-medium text-ink group-hover:underline">{source.sectionTitle}</span>
      </span>
      <ArrowUpRight size={15} className="mt-0.5 shrink-0 text-faint group-hover:text-accent" aria-hidden="true" />
    </a>
    <p className="text-[13px] leading-relaxed text-muted mt-2 ml-8">{source.excerpt}</p>
    <p className="text-xs text-faint mt-2 ml-8">
      {nationList(source.nations)} · {periodText(source.applicability)} · Checked against GOV.UK {formatIsoDate((source.sourceCheckedAt ?? source.sourceFetchedAt).slice(0, 10))}
    </p>
  </li>;
}

function SourceGroup({ title, sources, highlightId }: { title: string; sources: ChatSource[]; highlightId: string | null }) {
  if (sources.length === 0) return null;
  return <section>
    <h3 className="px-5 pt-4 text-xs font-medium text-faint">{title}</h3>
    <ol className="divide-y divide-ink/10">
      {sources.map(source => <SourceRow key={source.id} source={source} highlighted={source.id === highlightId} />)}
    </ol>
  </section>;
}

type SourcesPanelProps = { sources: ChatSource[]; highlightId: string | null; onClose: () => void };

/** A side pane on large screens and a bottom sheet on small ones. */
export function SourcesPanel({ sources, highlightId, onClose }: SourcesPanelProps) {
  const panel = useRef<HTMLElement>(null);
  const attributions = [...new Set(sources.map(source => source.attribution))];

  useEffect(() => {
    panel.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return <>
    <button type="button" aria-label="Close sources" onClick={onClose} className="lg:hidden fixed inset-0 z-20 bg-black/40" />
    <aside ref={panel} tabIndex={-1} aria-label="Sources"
      className="rise fixed inset-x-0 bottom-0 z-30 max-h-[80dvh] rounded-t-2xl bg-raised lg:static lg:z-auto lg:max-h-none lg:w-[380px] lg:shrink-0 lg:rounded-none lg:border-l lg:border-ink/10 lg:bg-page flex flex-col focus:outline-none">
      <div className="flex items-center justify-between h-14 px-5 border-b border-ink/10 shrink-0">
        <h2 className="font-medium">Sources <span className="text-faint font-normal">{sources.length}</span></h2>
        <button type="button" aria-label="Close sources" onClick={onClose} className="h-9 w-9 -mr-2 grid place-items-center rounded-lg text-muted hover:bg-ink/5 hover:text-ink">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="overflow-y-auto pb-4">
        <SourceGroup title="Used in this answer" sources={sources.filter(source => source.cited)} highlightId={highlightId} />
        <SourceGroup title="Found, but not used" sources={sources.filter(source => !source.cited)} highlightId={highlightId} />
        {attributions.map(attribution => <p key={attribution} className="px-5 pt-4 text-xs text-faint">{attribution}.</p>)}
      </div>
    </aside>
  </>;
}
