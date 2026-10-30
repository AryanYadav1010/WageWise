import { useState, type FormEvent } from "react";
import { calculateBudget, type BudgetResponse, type Jurisdiction, type NonWorkingDayRule, type PaySchedule } from "./api.ts";
import { formatIsoDate, formatPence, poundsToPence } from "./format.ts";
import { ErrorMessage, inputClass, labelClass, Page, primaryButtonClass } from "./ui.tsx";

type ScheduleKind = PaySchedule["kind"];

function buildSchedule(kind: ScheduleKind, dayOfMonth: string): PaySchedule | null {
  if (kind === "last_day_of_month" || kind === "last_working_day_of_month") return { kind };
  const day = Number(dayOfMonth);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return { kind, dayOfMonth: day };
}

export function BudgetPanel() {
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>("england-and-wales");
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>("fixed_day_of_month");
  const [dayOfMonth, setDayOfMonth] = useState("28");
  const [rule, setRule] = useState<NonWorkingDayRule | "">("");
  const [balance, setBalance] = useState("500");
  const [income, setIncome] = useState("0");
  const [bills, setBills] = useState("200");
  const [essentials, setEssentials] = useState("100");
  const [result, setResult] = useState<BudgetResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);

    const schedule = buildSchedule(scheduleKind, dayOfMonth);
    const balancePence = poundsToPence(balance);
    const incomePence = poundsToPence(income);
    const billsPence = poundsToPence(bills);
    const essentialsPence = poundsToPence(essentials);
    if (schedule === null) {
      setError("Enter a payday between 1 and 31.");
      return;
    }
    // "Last working day" already lands on a working day, so the rule has no effect there.
    const effectiveRule = scheduleKind === "last_working_day_of_month" ? "unchanged" : rule;
    if (effectiveRule === "") {
      setError("Choose what your employer does when payday is a weekend or bank holiday.");
      return;
    }
    if (balancePence === null || incomePence === null || billsPence === null || essentialsPence === null) {
      setError("Enter amounts in pounds, with no more than two decimal places.");
      return;
    }

    setBusy(true);
    try {
      setResult(await calculateBudget({
        jurisdiction,
        paySchedule: schedule,
        nonWorkingDayRule: effectiveRule,
        currentBalancePence: balancePence,
        incomeBeforePaydayPence: incomePence,
        billsBeforePaydayPence: billsPence,
        essentialsBeforePaydayPence: essentialsPence
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Budget calculation failed.");
    } finally {
      setBusy(false);
    }
  }

  const moneyFields: [string, string, (value: string) => void][] = [
    ["Current balance (£)", balance, setBalance],
    ["Other income before payday (£)", income, setIncome],
    ["Bills before payday (£)", bills, setBills],
    ["Essential spending before payday (£)", essentials, setEssentials]
  ];

  return <Page title="Payday budget" intro="Use example figures. Nothing here connects to a bank or employer, and nothing is stored.">
    <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 gap-4">
      <label className="block">
        <span className={labelClass}>Where you work</span>
        <select value={jurisdiction} onChange={event => setJurisdiction(event.target.value as Jurisdiction)} className={inputClass}>
          <option value="england-and-wales">England and Wales</option>
          <option value="scotland">Scotland</option>
          <option value="northern-ireland">Northern Ireland</option>
        </select>
      </label>

      <label className="block">
        <span className={labelClass}>When you are paid</span>
        <select value={scheduleKind} onChange={event => setScheduleKind(event.target.value as ScheduleKind)} className={inputClass}>
          <option value="fixed_day_of_month">On a set day each month</option>
          <option value="last_day_of_month">Last day of the month</option>
          <option value="last_working_day_of_month">Last working day of the month</option>
        </select>
      </label>

      {scheduleKind === "fixed_day_of_month" && <label className="block">
        <span className={labelClass}>Day of the month (1–31)</span>
        <input type="number" min={1} max={31} required value={dayOfMonth} onChange={event => setDayOfMonth(event.target.value)} className={inputClass} />
        <span className="block text-xs text-faint mt-1">In shorter months, 29–31 means the last day of the month.</span>
      </label>}

      {scheduleKind !== "last_working_day_of_month" && <label className="block">
        <span className={labelClass}>If payday is a weekend or bank holiday, you are paid</span>
        <select required value={rule} onChange={event => setRule(event.target.value as NonWorkingDayRule | "")} className={inputClass}>
          <option value="">Choose (check your contract)</option>
          <option value="previous_working_day">The working day before</option>
          <option value="next_working_day">The next working day</option>
          <option value="unchanged">On that day anyway</option>
        </select>
      </label>}

      {moneyFields.map(([label, value, setValue]) => <label className="block" key={label}>
        <span className={labelClass}>{label}</span>
        <input inputMode="decimal" required value={value} onChange={event => setValue(event.target.value)} className={inputClass} />
      </label>)}

      <button disabled={busy} className={`sm:col-span-2 ${primaryButtonClass}`}>{busy ? "Calculating…" : "Calculate"}</button>
    </form>

    {error !== "" && <ErrorMessage>{error}</ErrorMessage>}

    {result !== null && <div className="rise mt-8 pt-6 border-t border-ink/10" aria-live="polite">
      <p className="text-muted">
        Next payday: <strong className="font-medium text-ink">{formatIsoDate(result.payday.effectiveDate)}</strong> ({result.budget.daysUntilPayday} days from {formatIsoDate(result.today)})
      </p>
      {result.payday.skippedDates.length > 0 && <p className="text-sm text-faint mt-1">
        Moved from {formatIsoDate(result.payday.scheduledDate)}, skipping: {result.payday.skippedDates.map(skipped => `${formatIsoDate(skipped.date)} (${skipped.reason})`).join(", ")}
      </p>}
      <div className="font-serif text-[44px] leading-none tracking-tight text-accent my-4">{formatPence(result.budget.projectedBalancePence)}</div>
      {result.budget.daysUntilPayday === 0
        ? <p className="text-muted">Payday is today, so there are no days left to budget for.</p>
        : <p className="text-muted">left before payday · about {formatPence(result.budget.dailyAllowancePence)} a day</p>}
      {result.budget.shortfallPence > 0 && <p className="text-warn mt-2">Shortfall: {formatPence(result.budget.shortfallPence)}</p>}
      <p className="text-xs text-faint mt-5">{result.disclaimer}</p>
      <p className="text-xs text-faint mt-1">
        Bank holidays: <a className="underline" href="https://www.gov.uk/bank-holidays" target="_blank" rel="noreferrer">GOV.UK</a>, fetched {formatIsoDate(result.bankHolidayData.fetchedAt.slice(0, 10))}. {result.bankHolidayData.licence}.
      </p>
    </div>}
  </Page>;
}
