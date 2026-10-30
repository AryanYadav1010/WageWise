const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export type Source = { title: string; url: string; description: string; topic: string; jurisdiction: string };
export type SearchResponse = { mode: "directory_only"; isGroundedAnswer: false; message: string; sources: Source[] };

export type Jurisdiction = "england-and-wales" | "scotland" | "northern-ireland";
export type PaySchedule =
  | { kind: "fixed_day_of_month"; dayOfMonth: number }
  | { kind: "last_day_of_month" }
  | { kind: "last_working_day_of_month" };
export type NonWorkingDayRule = "unchanged" | "previous_working_day" | "next_working_day";

export type BudgetRequest = {
  jurisdiction: Jurisdiction;
  paySchedule: PaySchedule;
  nonWorkingDayRule: NonWorkingDayRule;
  currentBalancePence: number;
  incomeBeforePaydayPence: number;
  billsBeforePaydayPence: number;
  essentialsBeforePaydayPence: number;
};

export type BudgetResponse = {
  mode: "synthetic_calculator";
  today: string;
  payday: { scheduledDate: string; effectiveDate: string; skippedDates: { date: string; reason: string }[] };
  budget: { daysUntilPayday: number; projectedBalancePence: number; shortfallPence: number; dailyAllowancePence: number };
  bankHolidayData: { source: string; fetchedAt: string; licence: string };
  disclaimer: string;
};

type ApiError = { error?: string; message?: string };

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const value: unknown = await response.json();
  if (response.ok) return value as T;
  if (response.status === 429) throw new Error("Too many requests. Please try again shortly.");
  const apiError = value as ApiError;
  // 422 and 503 messages are written for users (e.g. holiday data missing, search unavailable).
  if ((response.status === 422 || response.status === 503) && typeof apiError.message === "string") throw new Error(apiError.message);
  throw new Error("Request could not be processed. Check your inputs and try again.");
}

export type Nation = "england" | "wales" | "scotland" | "northern-ireland";

export type GuidanceResult = {
  rank: number;
  sectionUrl: string;
  sectionTitle: string;
  documentTitle: string;
  canonicalUrl: string;
  heading: string;
  excerpt: string;
  nations: string[];
  nationsBasis: string;
  applicability: { status: "stated"; appliesFrom: string | null; appliesTo: string | null } | { status: "not_stated" };
  sourceFetchedAt: string;
  sourceCheckedAt: string | null;
  attribution: string;
};

export type GuidanceSearchResponse = {
  mode: "source_discovery";
  isGroundedAnswer: false;
  traceId: string;
  status: "ok" | "partial" | "no_results";
  request: { jurisdiction: Nation | null; asOfDate: string; limit: number };
  results: GuidanceResult[];
  notices: string[];
  disclaimer: string;
};

export type GuidanceSearchRequest = { query: string; jurisdiction: Nation | null; asOfDate?: string; limit?: number };

export const searchGuidance = (request: GuidanceSearchRequest) => postJson<GuidanceSearchResponse>("/api/guidance/search", request);

export type ChatSource = {
  id: string;
  cited: boolean;
  sectionTitle: string;
  documentTitle: string;
  url: string;
  excerpt: string;
  nations: string[];
  applicability: GuidanceResult["applicability"];
  sourceFetchedAt: string;
  attribution: string;
};

export type ChatResponse = {
  mode: "grounded_answer" | "abstained";
  isGroundedAnswer: boolean;
  traceId: string;
  request: { jurisdiction: Nation | null; asOfDate: string };
  answer: { text: string; sourceIds: string[] }[];
  message: string | null;
  sources: ChatSource[];
  notices: string[];
  disclaimer: string;
};

export const askQuestion = (question: string, jurisdiction: Nation | null) => postJson<ChatResponse>("/api/chat", { question, jurisdiction });

export const searchSources = (question: string) => postJson<SearchResponse>("/api/source-search", { question });
export const calculateBudget = (request: BudgetRequest) => postJson<BudgetResponse>("/api/budget", request);
