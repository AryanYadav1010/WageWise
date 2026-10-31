import { useEffect, useState, type ReactNode } from "react";
import { BookOpenText, Calculator, Menu, MessageSquareText, Moon, Plus, Search, Sun, X, type LucideIcon } from "lucide-react";
import { BudgetPanel } from "./BudgetPanel.tsx";
import { ChatPanel } from "./ChatPanel.tsx";
import { GuidanceSearch } from "./GuidanceSearch.tsx";
import { SourceSearch } from "./SourceSearch.tsx";
import { applyTheme, currentTheme, type Theme } from "./theme.ts";

type View = "ask" | "search" | "links" | "budget";

const NAV: { view: Exclude<View, "ask">; label: string; icon: LucideIcon }[] = [
  { view: "search", label: "Search guidance", icon: Search },
  { view: "links", label: "Key links", icon: BookOpenText },
  { view: "budget", label: "Payday budget", icon: Calculator }
];

const navItemClass = "w-full flex items-center gap-3 h-10 px-3 rounded-lg text-[15px]";

function navClass(active: boolean): string {
  return `${navItemClass} ${active ? "bg-ink/[.07] text-ink" : "text-muted hover:bg-ink/5 hover:text-ink"}`;
}

function Wordmark() {
  return <div className="flex items-baseline gap-2">
    <span className="font-serif text-[22px] tracking-tight">WageWise</span>
    <span className="text-[11px] text-faint">UK preview</span>
  </div>;
}

function ThemeButton() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const toggle = () => {
    applyTheme(next);
    setTheme(next);
  };
  return <button type="button" onClick={toggle} aria-label={`Switch to ${next} theme`} className={`${navItemClass} text-muted hover:bg-ink/5 hover:text-ink`}>
    {theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
    {theme === "dark" ? "Light theme" : "Dark theme"}
  </button>;
}

function Navigation({ view, onSelect, onNewConversation }: { view: View; onSelect: (view: View) => void; onNewConversation: () => void }) {
  const onAsk = view === "ask";
  return <>
    <nav aria-label="Main" className="mt-6 flex-1 space-y-1">
      {/* From another page this returns to the thread; only on Ask does it start again. */}
      <button type="button" onClick={onAsk ? onNewConversation : () => onSelect("ask")} aria-current={onAsk ? "page" : undefined} className={navClass(onAsk)}>
        {onAsk ? <><Plus size={17} aria-hidden="true" /> New conversation</> : <><MessageSquareText size={17} aria-hidden="true" /> Ask</>}
      </button>
      {NAV.map(({ view: target, label, icon: Icon }) => <button type="button" key={target} onClick={() => onSelect(target)}
        aria-current={view === target ? "page" : undefined} className={navClass(view === target)}><Icon size={17} aria-hidden="true" /> {label}</button>)}
    </nav>
    <ThemeButton />
  </>;
}

function MobileMenu({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return <div className="md:hidden">
    <button type="button" aria-label="Close menu" onClick={onClose} className="fixed inset-0 z-40 bg-black/40" />
    <div className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-page p-3 flex flex-col">
      <div className="flex items-center justify-between h-10 pl-3">
        <Wordmark />
        <button type="button" aria-label="Close menu" onClick={onClose} className="h-10 w-10 grid place-items-center rounded-lg text-muted"><X size={19} aria-hidden="true" /></button>
      </div>
      {children}
    </div>
  </div>;
}

export default function App() {
  const [view, setView] = useState<View>("ask");
  const [chatSession, setChatSession] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  const select = (target: View) => {
    setView(target);
    setMenuOpen(false);
  };
  const newConversation = () => {
    setChatSession(session => session + 1);
    select("ask");
  };
  const navigation = <Navigation view={view} onSelect={select} onNewConversation={newConversation} />;
  // Views stay mounted so a thread or a budget survives moving between them.
  const showWhen = (target: View) => (view === target ? "h-full" : "hidden");

  return <div className="h-dvh flex bg-page text-ink">
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-ink/10 p-3">
      <div className="h-10 pl-3 flex items-center"><Wordmark /></div>
      {navigation}
    </aside>

    {menuOpen && <MobileMenu onClose={() => setMenuOpen(false)}>{navigation}</MobileMenu>}

    <div className="flex-1 min-w-0 flex flex-col">
      <header className="md:hidden flex items-center gap-1 h-14 shrink-0 px-2 border-b border-ink/10">
        <button type="button" aria-label="Open menu" onClick={() => setMenuOpen(true)} className="h-10 w-10 grid place-items-center rounded-lg text-muted"><Menu size={20} aria-hidden="true" /></button>
        <Wordmark />
      </header>
      <main className="flex-1 min-h-0">
        <div className={showWhen("ask")}><ChatPanel key={chatSession} onNewConversation={newConversation} /></div>
        <div className={showWhen("search")}><GuidanceSearch /></div>
        <div className={showWhen("links")}><SourceSearch /></div>
        <div className={showWhen("budget")}><BudgetPanel /></div>
      </main>
    </div>
  </div>;
}
