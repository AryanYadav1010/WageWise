import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Check, Copy, Info, Plus, RotateCcw } from "lucide-react";
import { askQuestion, type ChatResponse, type ChatSource, type Nation, type PastTurn } from "./api.ts";
import { Composer } from "./Composer.tsx";
import { formatIsoDate, groupCitations, sourceNumber } from "./format.ts";
import { SourcesPanel } from "./SourcesPanel.tsx";
import { chipClass, INDEPENDENCE_NOTE, NATION_LABELS, SHORT_INDEPENDENCE_NOTE } from "./ui.tsx";

// Only questions the approved guides can answer. Update these when more guides are approved.
// The most the API accepts. Older questions drop off, and the conversation lives only in this page.
const MAX_HISTORY = 6;

const SUGGESTIONS = ["What does tax code 1257L mean?", "What is an emergency tax code?", "What is the Scottish intermediate rate?", "How much National Insurance do I pay?"];

type TurnBase = { id: number; question: string; nation: Nation | null; startedAt: number };
type Turn = (TurnBase & { status: "loading" }) |
  (TurnBase & { status: "done"; response: ChatResponse; seconds: number }) |
  (TurnBase & { status: "error"; error: string });

type OpenSources = { turnId: number; highlightId: string | null };
type ShowSources = (turnId: number, highlightId: string | null, trigger: HTMLElement) => void;

function Working({ startedAt }: { startedAt: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return <p role="status" className="text-sm text-muted mt-5">Checking official guidance <span className="text-faint tabular-nums">{seconds}s</span></p>;
}

function CitationMarker({ source, onOpen }: { source: ChatSource | undefined; onOpen: (event: MouseEvent<HTMLButtonElement>) => void }) {
  if (source === undefined) return null;
  const label = `${source.documentTitle}: ${source.sectionTitle}`;
  return <button type="button" onClick={onOpen} title={label} aria-label={`Source ${sourceNumber(source.id)}, ${label}`}
    className="relative -top-0.5 mx-0.5 inline-grid h-[18px] min-w-[18px] place-items-center rounded-md bg-ink/10 px-1 font-sans text-[11px] font-medium text-muted hover:bg-accent hover:text-on-accent">
    {sourceNumber(source.id)}
  </button>;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false); // Clipboard access can be refused; the text can still be selected by hand.
    }
  }
  return <button type="button" onClick={() => void copy()} aria-label={copied ? "Copied" : "Copy answer"} className="h-8 w-8 grid place-items-center rounded-lg text-faint hover:bg-ink/5 hover:text-ink">
    {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
  </button>;
}

function copyText(response: ChatResponse): string {
  const cited = response.sources.filter(source => source.cited).map(source => source.url);
  return [response.answer.map(sentence => sentence.text).join(" "), ...cited].join("\n");
}

const describeTurn = (turn: PastTurn) => `${turn.question}${turn.nation === null ? "" : ` (${NATION_LABELS[turn.nation]})`}`;

/** Shows how a follow-up was read, so a wrong reading is easy to spot. */
function Interpretation({ conversation }: { conversation: ChatResponse["conversation"] }) {
  if (conversation.kind === "follow_up") return <p className="text-sm text-muted mt-2">Answering: {conversation.turns.map(describeTurn).join("")}</p>;
  if (conversation.kind === "comparison") return <p className="text-sm text-muted mt-2">Comparing: {conversation.turns.map(describeTurn).join(" and ")}</p>;
  return null;
}

function Answer({ turnId, response, seconds, onShowSources, onPick, onUseNation }: { turnId: number; response: ChatResponse; seconds: number; onShowSources: ShowSources; onPick: (question: string) => void; onUseNation: (nation: Nation) => void }) {
  const sourceById = new Map(response.sources.map(source => [source.id, source]));
  const grounded = response.mode === "grounded_answer";

  return <div className="rise">
    <p className="text-sm text-muted mt-5">Finished <span className="text-faint tabular-nums">{seconds}s</span> <span className="text-faint">· {response.request.jurisdiction !== null && `${NATION_LABELS[response.request.jurisdiction]} · `}as of {formatIsoDate(response.request.asOfDate)}</span></p>
    <Interpretation conversation={response.conversation} />

    {grounded
      ? <p className="answer-text mt-3">
          {groupCitations(response.answer).map((run, index) => {
            // The last word stays with its markers, so a marker never wraps onto a line by itself.
            const splitAt = run.text.lastIndexOf(" ") + 1;
            return <span key={index}>
              {run.text.slice(0, splitAt)}
              <span className="whitespace-nowrap">
                {run.text.slice(splitAt)}
                {run.sourceIds.map(id => <CitationMarker key={id} source={sourceById.get(id)} onOpen={event => onShowSources(turnId, id, event.currentTarget)} />)}
              </span>{" "}
            </span>;
          })}
        </p>
      : <p className="answer-text mt-3 text-muted">{response.message}</p>}
    {response.abstainReason === "too_vague" && <SuggestionList onPick={onPick} align="left" />}
    {response.clarifyNations.length > 0 && <ul aria-label="Choose a nation" className="flex flex-wrap gap-2 mt-5">
      {response.clarifyNations.map(nation => <li key={nation}><button type="button" onClick={() => onUseNation(nation)} className={chipClass}>Use {NATION_LABELS[nation]}</button></li>)}
    </ul>}

    {response.notices.length > 0 && <ul className="mt-4 space-y-1.5">
      {response.notices.map(notice => <li key={notice} className="flex gap-2 text-[13px] leading-snug text-muted"><Info size={14} className="shrink-0 mt-0.5 text-faint" aria-hidden="true" />{notice}</li>)}
    </ul>}

    <div className="flex items-center gap-1 mt-3 -ml-1.5">
      {grounded && <CopyButton text={copyText(response)} />}
      {response.sources.length > 0 && <button type="button" onClick={event => onShowSources(turnId, null, event.currentTarget)}
        className="h-8 px-2 rounded-lg text-sm text-muted hover:bg-ink/5 hover:text-ink">
        {response.sources.length} {response.sources.length === 1 ? "source" : "sources"}
      </button>}
    </div>

    <p className="text-xs leading-relaxed text-faint mt-3 pt-3 border-t border-ink/10">{response.disclaimer} Ref {response.traceId.slice(0, 8)}</p>
  </div>;
}

function TurnView({ turn, onShowSources, onRetry, onPick, onUseNation }: { turn: Turn; onShowSources: ShowSources; onRetry: (turn: Turn) => void; onPick: (question: string) => void; onUseNation: (question: string, nation: Nation) => void }) {
  return <section aria-label="Question and answer" className="scroll-mt-6" data-turn={turn.id}>
    <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-ink/[.06] px-4 py-2.5 leading-snug">
      {turn.question}{turn.nation !== null && <span className="text-sm text-faint"> · {NATION_LABELS[turn.nation]}</span>}
    </p>
    {turn.status === "loading" && <Working startedAt={turn.startedAt} />}
    {turn.status === "error" && <div className="mt-5">
      <p role="alert" className="text-danger">{turn.error}</p>
      <button type="button" onClick={() => onRetry(turn)} className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><RotateCcw size={14} aria-hidden="true" /> Try again</button>
    </div>}
    {turn.status === "done" && <Answer turnId={turn.id} response={turn.response} seconds={turn.seconds} onShowSources={onShowSources} onPick={onPick} onUseNation={nation => onUseNation(turn.question, nation)} />}
  </section>;
}

function Welcome() {
  return <div className="text-center mb-7">
    <h1 className="font-serif text-[34px] sm:text-[42px] leading-tight tracking-tight">What would you like to check?</h1>
    <p className="text-muted mt-3 max-w-md mx-auto leading-relaxed">Answers come only from GOV.UK guidance we've reviewed. If it isn't covered, we'll say so.</p>
    <details className="mt-3 text-sm text-muted">
      <summary className="cursor-pointer hover:text-ink">What can WageWise answer?</summary>
      <div className="mt-2 mx-auto max-w-md text-left leading-relaxed space-y-1">
        <p><span className="text-ink">Can explain:</span> tax codes, Income Tax rates across the UK, Scottish and Welsh rates, and National Insurance.</p>
        <p><span className="text-ink">Can't do:</span> personal advice, checking your own tax, or topics like pensions and benefits yet. Key links points to useful resources for those.</p>
      </div>
    </details>
  </div>;
}

function SuggestionList({ onPick, align = "center" }: { onPick: (question: string) => void; align?: "center" | "left" }) {
  return <ul aria-label="Example questions" className={`flex flex-wrap gap-2 mt-5 ${align === "center" ? "justify-center" : ""}`}>
    {SUGGESTIONS.map(suggestion => <li key={suggestion}><button type="button" onClick={() => onPick(suggestion)} className={chipClass}>{suggestion}</button></li>)}
  </ul>;
}

export function ChatPanel({ onNewConversation }: { onNewConversation: () => void }) {
  const [question, setQuestion] = useState("");
  const [nation, setNation] = useState<Nation | "">("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [openSources, setOpenSources] = useState<OpenSources | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const sourcesTrigger = useRef<HTMLElement | null>(null);
  const busy = turns.some(turn => turn.status === "loading");

  // Earlier questions go with each request, never earlier answers: every turn is retrieved and checked from scratch.
  const history = turns.flatMap(turn => turn.status === "done" && turn.response.conversation.turns.length === 1 ? turn.response.conversation.turns : []).slice(-MAX_HISTORY);

  async function ask(asked: string, chosenNation: Nation | null) {
    const startedAt = Date.now();
    const id = startedAt;
    const base = { id, question: asked, nation: chosenNation, startedAt };
    setTurns(previous => [...previous, { ...base, status: "loading" }]);
    setQuestion("");
    setOpenSources(null);
    try {
      const response = await askQuestion(asked, chosenNation, history);
      const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      setTurns(previous => previous.map(turn => turn.id === id ? { ...base, status: "done", response, seconds } : turn));
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : "Something went wrong.";
      setTurns(previous => previous.map(turn => turn.id === id ? { ...base, status: "error", error } : turn));
    }
  }

  const chosenNation = nation === "" ? null : nation;
  const submit = () => void ask(question.trim(), chosenNation);
  const pick = (picked: string) => void ask(picked, chosenNation);
  const useNation = (asked: string, picked: Nation) => {
    setNation(picked);
    void ask(asked, picked);
  };
  const showSources: ShowSources = (turnId, highlightId, trigger) => {
    sourcesTrigger.current = trigger;
    setOpenSources({ turnId, highlightId });
  };
  const closeSources = useCallback(() => {
    setOpenSources(null);
    sourcesTrigger.current?.focus();
  }, []);

  const latestTurnId = turns.at(-1)?.id;
  useEffect(() => {
    if (latestTurnId === undefined) return;
    thread.current?.querySelector(`[data-turn="${latestTurnId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [latestTurnId]);

  const composer = (placeholder: string, autoFocus: boolean) => <Composer value={question} onChange={setQuestion} nation={nation} onNationChange={setNation}
    onSubmit={submit} busy={busy} placeholder={placeholder} autoFocus={autoFocus} />;

  if (turns.length === 0) {
    return <div className="h-full overflow-y-auto">
      <div className="min-h-full mx-auto max-w-[680px] px-4 py-8 flex flex-col justify-center">
        <Welcome />
        {composer("Ask about tax codes, income tax or National Insurance", true)}
        <SuggestionList onPick={pick} />
        <p className="text-xs text-faint text-center mt-6">{INDEPENDENCE_NOTE}</p>
      </div>
    </div>;
  }

  const sourcesTurn = openSources === null ? undefined : turns.find(turn => turn.id === openSources.turnId);

  return <div className="h-full flex min-w-0">
    <div className="flex-1 min-w-0 flex flex-col">
      <div ref={thread} className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-4 sm:px-6 pt-6 pb-10 space-y-10" aria-live="polite">
          {turns.map(turn => <TurnView key={turn.id} turn={turn} onShowSources={showSources} onRetry={failed => void ask(failed.question, failed.nation)} onPick={pick} onUseNation={useNation} />)}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[720px] px-4 sm:px-6 pb-3">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-xs text-faint">Not saved. Clears when you refresh.</p>
          <button type="button" onClick={onNewConversation} disabled={busy} className="shrink-0 inline-flex items-center gap-1.5 h-8 px-2 rounded-lg text-sm text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-50"><Plus size={15} aria-hidden="true" /> New conversation</button>
        </div>
        {composer("Ask a follow-up or a new question", false)}
        <p className="text-[11px] text-faint text-center mt-1.5">{SHORT_INDEPENDENCE_NOTE}</p>
      </div>
    </div>
    {sourcesTurn?.status === "done" && <SourcesPanel key={sourcesTurn.id} sources={sourcesTurn.response.sources} highlightId={openSources?.highlightId ?? null} onClose={closeSources} />}
  </div>;
}
