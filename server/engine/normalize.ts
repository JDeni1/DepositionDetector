import type { LanguageSignals, QuoteMatch, TimeRange } from "../../shared/types";

// ---------- Text cleanup ----------

/** Lowercase, straighten curly quotes and dashes, collapse whitespace. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Hedging and certainty ----------

/** Words that make a TIME imprecise: "around 7", "about 10", "7-ish". */
const APPROXIMATE_PATTERNS = [
  /\b(around|about|roughly|approximately)\s+\d/,
  /\d\s*(-?ish|or so)\b/,
];

/** Words that make the WHOLE statement uncertain. */
const UNCERTAIN_PHRASES = [
  "maybe", "i think", "might", "i guess", "probably", "i believe",
  "not sure", "don't remember", "don't recall", "or something",
];

/** Words that make the statement absolute, so a conflict is harder to explain away. */
const ABSOLUTE_PHRASES = ["never", "definitely", "absolutely", "certain", "always", "all evening", "all night"];

function findPhrases(text: string, phrases: string[]): string[] {
  return phrases.filter((phrase) => new RegExp(`\\b${phrase}\\b`).test(text));
}

/** Reads the witness's own words to see how sure they sounded. */
export function analyzeLanguage(quote: string): LanguageSignals {
  const text = normalizeText(quote);
  return {
    approximate: APPROXIMATE_PATTERNS.some((pattern) => pattern.test(text)),
    uncertain: findPhrases(text, UNCERTAIN_PHRASES),
    absolute: findPhrases(text, ABSOLUTE_PHRASES),
  };
}

// ---------- Time comparison ----------

/** Minutes between two time ranges. 0 means they overlap. */
export function timeGap(a: TimeRange, b: TimeRange): number {
  return Math.max(0, Math.max(a.earliest, b.earliest) - Math.min(a.latest, b.latest));
}

/** How far apart two times can be and still count as "the same" time. */
export const EXACT_TOLERANCE_MIN = 10;
export const LOOSE_TOLERANCE_MIN = 30;

export function timeTolerance(a: LanguageSignals, b: LanguageSignals): number {
  const loose = a.approximate || b.approximate || a.uncertain.length > 0 || b.uncertain.length > 0;
  return loose ? LOOSE_TOLERANCE_MIN : EXACT_TOLERANCE_MIN;
}

/** 1140 -> "7:00 PM", 1440 -> "12:00 AM". For display only. */
export function formatMinutes(minutes: number): string {
  const dayMinutes = minutes % 1440;
  const hours24 = Math.floor(dayMinutes / 60);
  const mins = dayMinutes % 60;
  const suffix = hours24 < 12 ? "AM" : "PM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

// ---------- Quote verification ----------

/** Checks that Claude's quote really appears in the transcript. */
export function verifyQuote(quote: string, transcript: string): QuoteMatch {
  if (quote.trim().length > 0 && transcript.includes(quote)) {
    return "exact";
  }
  const cleanQuote = normalizeText(quote);
  if (cleanQuote.length > 0 && normalizeText(transcript).includes(cleanQuote)) {
    return "normalized";
  }
  return "missing";
}

// ---------- Subject matching ----------

const STOPWORDS = new Set(["the", "a", "an", "of", "to", "in", "at", "on", "my", "his", "her"]);

function subjectTokens(subject: string): Set<string> {
  return new Set(
    normalizeText(subject)
      .replace(/[^a-z0-9\s]/g, " ")
      .split(" ")
      .filter((word) => word.length > 0 && !STOPWORDS.has(word)),
  );
}

/** 0 to 1. Share of words two subjects have in common (Jaccard similarity). */
export function subjectSimilarity(a: string, b: string): number {
  const tokensA = subjectTokens(a);
  const tokensB = subjectTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      shared++;
    }
  }
  return shared / (tokensA.size + tokensB.size - shared);
}
