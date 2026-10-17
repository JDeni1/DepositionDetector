import { z } from "zod";

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

export const TimeRangeSchema = z.object({
  earliest: z.number().int().min(0).max(1800)
    .describe("Minutes after midnight. 7pm = 1140, 10:30pm = 1350, midnight = 1440"),
  latest: z.number().int().min(0).max(1800)
    .describe("Same as earliest for a single time; larger for a range like 'around 10, maybe 10:30'"),
});

export const ClaimSchema = z.object({
  id: z.string().describe("A1, A2... for transcript A; B1, B2... for transcript B"),
  transcript: z.enum(["A", "B"]),
  topic: z.enum(TOPICS),
  subject: z.string().describe("What the claim is about, e.g. 'Daniel Cho', 'Hargrove Street', 'bedtime'"),
  statement: z.string().describe("The claim restated as one short plain sentence"),
  polarity: z.enum(["affirms", "denies"]),
  time: TimeRangeSchema.nullable().describe("Null if the claim states no clock time"),
  quote: z.string().describe("The witness's exact words, copied character for character"),
});

export const ExtractionSchema = z.object({ claims: z.array(ClaimSchema) });

export const AnalyzeRequestSchema = z.object({
  transcriptA: z.string().trim().min(20).max(100_000),
  transcriptB: z.string().trim().min(20).max(100_000),
});

export type Claim = z.infer<typeof ClaimSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;