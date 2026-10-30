import { useLayoutEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUp, ChevronDown, MapPin } from "lucide-react";
import type { Nation } from "./api.ts";
import { NATION_LABELS } from "./ui.tsx";

const MIN_QUESTION_CHARS = 3;

type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  nation: Nation | "";
  onNationChange: (nation: Nation | "") => void;
  onSubmit: () => void;
  busy: boolean;
  placeholder: string;
  autoFocus?: boolean;
};

export function Composer({ value, onChange, nation, onNationChange, onSubmit, busy, placeholder, autoFocus = false }: ComposerProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const canSend = !busy && value.trim().length >= MIN_QUESTION_CHARS;

  // Grow with the text; the CSS max height then takes over with a scrollbar.
  useLayoutEffect(() => {
    const element = textarea.current;
    if (element === null) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  function send(event: FormEvent) {
    event.preventDefault();
    if (canSend) onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) send(event);
  }

  return <form onSubmit={send} className="rounded-[20px] border border-ink/15 bg-raised shadow-sm focus-within:border-accent/70 transition-colors">
    <label className="sr-only" htmlFor="question">Your question</label>
    <textarea id="question" ref={textarea} rows={1} value={value} maxLength={500} placeholder={placeholder} autoFocus={autoFocus}
      onChange={event => onChange(event.target.value)} onKeyDown={handleKeyDown}
      className="block w-full max-h-40 resize-none bg-transparent px-4 pt-3 pb-1.5 text-[17px] leading-relaxed text-ink placeholder:text-faint focus:outline-none" />
    <div className="flex items-center justify-between gap-2 px-2.5 pb-2">
      <label className="relative inline-flex items-center h-9 rounded-full border border-ink/10 text-base sm:text-sm text-muted hover:text-ink hover:border-ink/25">
        <MapPin size={14} className="absolute left-3 pointer-events-none" aria-hidden="true" />
        <span className="sr-only">Where you live or work</span>
        <select value={nation} onChange={event => onNationChange(event.target.value as Nation | "")}
          className="appearance-none bg-transparent rounded-full h-full pl-8 pr-8 focus:outline-none cursor-pointer">
          <option value="">Where in the UK?</option>
          {(Object.keys(NATION_LABELS) as Nation[]).map(key => <option key={key} value={key}>{NATION_LABELS[key]}</option>)}
        </select>
        <ChevronDown size={14} className="absolute right-2.5 pointer-events-none" aria-hidden="true" />
      </label>
      <button aria-label={busy ? "Working" : "Ask"} disabled={!canSend}
        className="h-10 w-10 shrink-0 grid place-items-center rounded-full bg-accent text-on-accent hover:opacity-90 disabled:bg-ink/10 disabled:text-faint">
        <ArrowUp size={18} aria-hidden="true" />
      </button>
    </div>
  </form>;
}
