import { calendarDaysBetween } from "./dates.ts";

export type BudgetInput = {
  today: string;
  payday: string;
  currentBalancePence: number;
  incomeBeforePaydayPence: number;
  billsBeforePaydayPence: number;
  essentialsBeforePaydayPence: number;
};

export type BudgetResult = {
  daysUntilPayday: number;
  projectedBalancePence: number;
  shortfallPence: number;
  /** Rounded down to whole pence so the daily amounts never add up to more than is available. */
  dailyAllowancePence: number;
};

function assertSafePence(name: string, amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`${name} must be a non-negative whole number of pence`);
  }
}

// Integer pence only: no floating-point pounds, and no LLM ever produces these numbers.
export function calculateBudget(input: BudgetInput): BudgetResult {
  assertSafePence("currentBalancePence", input.currentBalancePence);
  assertSafePence("incomeBeforePaydayPence", input.incomeBeforePaydayPence);
  assertSafePence("billsBeforePaydayPence", input.billsBeforePaydayPence);
  assertSafePence("essentialsBeforePaydayPence", input.essentialsBeforePaydayPence);

  const daysUntilPayday = calendarDaysBetween(input.today, input.payday);
  if (daysUntilPayday < 0) {
    throw new RangeError("Payday must not be before today");
  }

  const projectedBalancePence = input.currentBalancePence + input.incomeBeforePaydayPence
    - input.billsBeforePaydayPence - input.essentialsBeforePaydayPence;
  if (!Number.isSafeInteger(projectedBalancePence)) {
    throw new RangeError("Monetary total is outside the safe integer range");
  }

  const shortfallPence = projectedBalancePence < 0 ? -projectedBalancePence : 0;
  const spendablePence = projectedBalancePence > 0 ? projectedBalancePence : 0;
  const dailyAllowancePence = daysUntilPayday === 0 ? 0 : Math.floor(spendablePence / daysUntilPayday);

  return { daysUntilPayday, projectedBalancePence, shortfallPence, dailyAllowancePence };
}
