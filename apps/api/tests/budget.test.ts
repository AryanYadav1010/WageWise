import { describe, expect, it } from "vitest";
import { calculateBudget, type BudgetInput } from "../src/domain/budget.ts";

const baseInput: BudgetInput = {
  today: "2026-10-28",
  payday: "2026-10-30",
  currentBalancePence: 0,
  incomeBeforePaydayPence: 0,
  billsBeforePaydayPence: 0,
  essentialsBeforePaydayPence: 0
};

describe("integer-pence budget", () => {
  it("projects the balance and splits it across the remaining days", () => {
    const result = calculateBudget({ ...baseInput, currentBalancePence: 50_000, billsBeforePaydayPence: 15_000, essentialsBeforePaydayPence: 10_000 });
    expect(result).toEqual({ daysUntilPayday: 2, projectedBalancePence: 25_000, shortfallPence: 0, dailyAllowancePence: 12_500 });
  });

  it("rounds the daily allowance down so it never exceeds what is available", () => {
    const result = calculateBudget({ ...baseInput, payday: "2026-10-31", currentBalancePence: 1_000 });
    expect(result.daysUntilPayday).toBe(3);
    expect(result.dailyAllowancePence).toBe(333);
    expect(result.dailyAllowancePence * result.daysUntilPayday).toBeLessThanOrEqual(1_000);
  });

  it("avoids floating-point error that pounds would introduce", () => {
    // In floating-point pounds 0.10 + 0.20 is 0.30000000000000004.
    const result = calculateBudget({ ...baseInput, currentBalancePence: 10, incomeBeforePaydayPence: 20 });
    expect(result.projectedBalancePence).toBe(30);
  });

  it("reports a shortfall and no daily allowance when spending exceeds funds", () => {
    const result = calculateBudget({ ...baseInput, currentBalancePence: 5_000, billsBeforePaydayPence: 4_500, essentialsBeforePaydayPence: 1_000 });
    expect(result.projectedBalancePence).toBe(-500);
    expect(result.shortfallPence).toBe(500);
    expect(result.dailyAllowancePence).toBe(0);
  });

  it("returns zero daily allowance when payday is today", () => {
    const result = calculateBudget({ ...baseInput, payday: "2026-10-28", currentBalancePence: 5_000 });
    expect(result.daysUntilPayday).toBe(0);
    expect(result.dailyAllowancePence).toBe(0);
  });

  it("counts days correctly across a BST/GMT change and a leap day", () => {
    expect(calculateBudget({ ...baseInput, today: "2026-10-24", payday: "2026-10-26" }).daysUntilPayday).toBe(2);
    expect(calculateBudget({ ...baseInput, today: "2028-02-28", payday: "2028-03-01" }).daysUntilPayday).toBe(2);
  });

  it("rejects fractional, negative or unsafe amounts", () => {
    expect(() => calculateBudget({ ...baseInput, currentBalancePence: 12.5 })).toThrow(RangeError);
    expect(() => calculateBudget({ ...baseInput, billsBeforePaydayPence: -1 })).toThrow(RangeError);
    expect(() => calculateBudget({ ...baseInput, currentBalancePence: Number.MAX_SAFE_INTEGER + 1 })).toThrow(RangeError);
  });

  it("rejects a payday in the past", () => {
    expect(() => calculateBudget({ ...baseInput, payday: "2026-10-27" })).toThrow(/before today/);
  });
});
