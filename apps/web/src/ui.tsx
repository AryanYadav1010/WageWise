import type { ReactNode } from "react";
import type { ChatSource, Nation } from "./api.ts";
import { formatIsoDate } from "./format.ts";

export const NATION_LABELS: Record<Nation, string> = {
  "england": "England",
  "wales": "Wales",
  "scotland": "Scotland",
  "northern-ireland": "Northern Ireland"
};

export const SHORT_INDEPENDENCE_NOTE = "Independent project, not affiliated with GOV.UK. Not financial advice.";
export const INDEPENDENCE_NOTE = "Independent project, not affiliated with or endorsed by GOV.UK, the UK Government, MoneyHelper, the FCA or the FSCS. General information only, not financial advice.";

export const inputClass = "w-full h-11 bg-raised rounded-xl border border-ink/15 px-3 text-ink placeholder:text-faint focus:outline-none focus:border-accent";
export const labelClass = "block text-xs text-muted mb-2";
export const primaryButtonClass = "h-11 rounded-xl bg-accent text-on-accent font-medium px-5 hover:opacity-90 disabled:opacity-40";
export const chipClass = "rounded-full border border-ink/15 text-sm text-muted px-3 py-1.5 hover:border-accent hover:text-ink";

export function nationList(nations: readonly string[]): string {
  if (nations.length === 4) return "All UK nations";
  return nations.map(nation => NATION_LABELS[nation as Nation] ?? nation).join(", ");
}

export function periodText(applicability: ChatSource["applicability"]): string {
  if (applicability.status === "not_stated") return "Dates not stated on the page: check figures on GOV.UK";
  const { appliesFrom, appliesTo } = applicability;
  if (appliesFrom !== null && appliesTo !== null) return `Applies ${formatIsoDate(appliesFrom)} to ${formatIsoDate(appliesTo)}`;
  if (appliesTo !== null) return `Applies up to ${formatIsoDate(appliesTo)}`;
  return `Applies from ${formatIsoDate(appliesFrom ?? "")}`;
}

export function ErrorMessage({ children }: { children: ReactNode }) {
  return <p role="alert" className="mt-4 text-danger text-sm">{children}</p>;
}

/** A plain reading page for everything except Ask: one column, no boxes around the content. */
export function Page({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return <div className="h-full overflow-y-auto">
    <div className="mx-auto max-w-[720px] px-4 sm:px-6 py-8 sm:py-12">
      <h1 className="font-serif text-[32px] leading-tight tracking-tight">{title}</h1>
      <p className="text-muted mt-2 leading-relaxed">{intro}</p>
      <div className="mt-7">{children}</div>
      <p className="text-xs text-faint mt-12">{INDEPENDENCE_NOTE}</p>
    </div>
  </div>;
}
