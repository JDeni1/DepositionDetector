import { z } from "zod";

// ---------- Fixed lists ----------

export const TOPICS = [
  "whereabouts",   // where the witness was
  "activity",      // what they were doing
  "companions",    // who they were with / who saw them
  "sleep",         // when they went to bed
  "place_visited", // whether they've been somewhere
  "vehicle",
  "relationship",  // whether they knew someone
  "other",
] as const;

export const CONTRADICTION_TYPES = ["DIRECT", "INFERENTIAL", "FALSE_POSITIVE"] as const;
export const SEVERITIES = ["HIGH", "MEDIUM", "LOW"] as const;

export type Topic = (typeof TOPICS)[number];
export type ContradictionType = (typeof CONTRADICTION_TYPES)[number];
export type Severity = (typeof SEVERITIES)[number];

// ---------- What Claude returns (validated with zod) ----------

export const TimeRangeSchema = z.object({
  earliest: z.number().int().min(0).max(1800)
    .describe("Minutes after midnight. 7pm = 1140, 10:30pm = 1350, midnight = 1440"),
  latest: z.number().int().min(0).max(1800)
    .describe("Same as earliest for a single time; larger for a range like 'around 10, maybe 10:30'"),
});

export const StatementSchema = z.object({
  quote: z.string().describe("The witness's exact words, copied character for character from the answer"),
  subject: z.string().describe("What this statement is about, e.g. 'Daniel Cho', 'Hargrove Street warehouse', 'bedtime'"),
  polarity: z.enum(["affirms", "denies"]).describe("'denies' if the witness says something did not happen or is not true"),
  time: TimeRangeSchema.nullable().describe("The clock time stated in this quote, or null if none"),
});

export const CandidateSchema = z.object({
  id: z.string().describe("C1, C2, C3..."),
  topic: z.enum(TOPICS),
  summary: z.string().describe("One short sentence: what part of the story changed"),
  a: StatementSchema.describe("The statement from transcript A (the earlier deposition)"),
  b: StatementSchema.describe("The statement from transcript B (the later deposition)"),
  conflictKind: z.enum(["time", "fact"])
    .describe("'time' if the only difference is the clock time; 'fact' for anything else"),
  sameTimeFrame: z.boolean()
    .describe("true if both statements describe the same moment or period; false if they could refer to different times"),
  proposedType: z.enum(CONTRADICTION_TYPES).describe("Your first guess. The system re-checks it."),
  note: z.string().describe("One sentence on why you flagged this pair"),
});

export const ExtractionSchema = z.object({ candidates: z.array(CandidateSchema) });

export const AnalyzeRequestSchema = z.object({
  transcriptA: z.string().trim().min(20).max(100_000),
  transcriptB: z.string().trim().min(20).max(100_000),
});

export type TimeRange = z.infer<typeof TimeRangeSchema>;
export type Statement = z.infer<typeof StatementSchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;

// ---------- What the server sends to the UI (built by our own code) ----------

export type QuoteMatch = "exact" | "normalized" | "missing";

export interface LanguageSignals {
  approximate: boolean; // a time was given loosely ("around 7")
  uncertain: string[];  // hedge phrases found ("maybe", "I think")
  absolute: string[];   // absolute phrases found ("never", "all evening")
}

/** One rule that fired, so every label can be traced to the code that set it. */
export interface RuleHit {
  id: string;     // e.g. "G3"
  name: string;   // e.g. "TIME_WITHIN_TOLERANCE"
  detail: string; // plain-English reason with the actual numbers
}

/** One line of the confidence breakdown. */
export interface ConfidenceFactor {
  label: string;
  effect: number; // added to the score; negative lowers it
}

export interface StatementView extends Statement {
  quoteMatch: QuoteMatch;
  timeLabel: string | null;
  signals: LanguageSignals;
}

export interface Finding {
  id: string;
  topic: Topic;
  summary: string;
  type: ContradictionType;
  severity: Severity;
  confidence: number; // 0 to 1, computed by our code
  rules: RuleHit[];
  factors: ConfidenceFactor[];
  a: StatementView;
  b: StatementView;
  modelNote: string;          // Claude's explanation, shown but never scored
  modelProposedType: ContradictionType;
}

export interface AnalyzeResponse {
  mock: boolean;
  findings: Finding[];
}
